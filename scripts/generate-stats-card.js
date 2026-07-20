/**
 * generate-stats-card.js
 *
 * Fetches real GitHub stats via the GraphQL API and renders a self-contained,
 * animated SVG card — no dependency on a third-party rendering server.
 * Run on a schedule via GitHub Actions; the output SVG is committed to the repo
 * and referenced directly from README.md, so it never goes down or rate-limits
 * on someone else's shared quota.
 *
 * Requires env vars:
 *   GH_USERNAME      - the GitHub username to report on
 *   GH_TOKEN         - a token with `read:user` + `public_repo` (or `repo`) scope
 */

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GH_TOKEN;

if (!USERNAME || !TOKEN) {
  console.error("Missing GH_USERNAME or GH_TOKEN env vars.");
  process.exit(1);
}

const QUERY = `
query($login: String!) {
  user(login: $login) {
    name
    followers { totalCount }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      nodes { stargazerCount }
    }
    pullRequests { totalCount }
    issues { totalCount }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
      totalCommitContributions
    }
  }
}
`;

async function main() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
  }

  const user = json.data.user;
  const totalStars = user.repositories.nodes.reduce((sum, r) => sum + r.stargazerCount, 0);
  const totalContributions = user.contributionsCollection.contributionCalendar.totalContributions;
  const totalCommits = user.contributionsCollection.totalCommitContributions;
  const totalPRs = user.pullRequests.totalCount;
  const totalIssues = user.issues.totalCount;
  const totalRepos = user.repositories.totalCount;
  const followers = user.followers.totalCount;

  const streak = computeCurrentStreak(user.contributionsCollection.contributionCalendar.weeks);

  const svg = renderCard({
    name: user.name || USERNAME,
    totalContributions,
    totalCommits,
    totalPRs,
    totalIssues,
    totalStars,
    totalRepos,
    followers,
    streak,
  });

  const fs = await import("fs");
  fs.mkdirSync("assets", { recursive: true });
  fs.writeFileSync("assets/stats-card.svg", svg);
  console.log("Wrote assets/stats-card.svg");
}

function computeCurrentStreak(weeks) {
  const days = weeks.flatMap((w) => w.contributionDays).sort((a, b) => (a.date < b.date ? 1 : -1));
  let streak = 0;
  for (const day of days) {
    if (day.contributionCount > 0) {
      streak += 1;
    } else {
      // allow today to be zero (day not over yet) without breaking the streak
      if (streak === 0 && day.date === days[0].date) continue;
      break;
    }
  }
  return streak;
}

function renderCard(stats) {
  const rows = [
    ["Total Contributions (past year)", stats.totalContributions],
    ["Current Streak", `${stats.streak} days`],
    ["Total Commits", stats.totalCommits],
    ["Pull Requests", stats.totalPRs],
    ["Issues", stats.totalIssues],
    ["Stars Earned", stats.totalStars],
    ["Public Repos", stats.totalRepos],
    ["Followers", stats.followers],
  ];

  const rowHeight = 34;
  const startY = 70;
  const width = 480;
  const height = startY + rows.length * rowHeight + 20;

  const rowsSvg = rows
    .map((row, i) => {
      const y = startY + i * rowHeight;
      const delay = (0.15 * i).toFixed(2);
      return `
    <g>
      <text x="24" y="${y}" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="14" fill="#CBD5E1">${row[0]}</text>
      <text x="${width - 24}" y="${y}" text-anchor="end" font-family="Consolas, Menlo, monospace" font-size="15" font-weight="700" fill="#60A5FA" opacity="0">
        ${row[1]}
        <animate attributeName="opacity" from="0" to="1" begin="${delay}s" dur="0.5s" fill="freeze"/>
      </text>
      <rect x="24" y="${y + 8}" width="${width - 48}" height="1" fill="#2563EB" opacity="0.12"/>
    </g>`;
    })
    .join("\n");

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="cardBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0B1E3D"/>
      <stop offset="100%" stop-color="#152A54"/>
    </linearGradient>
    <clipPath id="clip"><rect x="0" y="0" width="${width}" height="${height}" rx="14"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#cardBg)"/>
    <rect x="0" y="0" width="${width}" height="4" fill="#2563EB">
      <animate attributeName="width" from="0" to="${width}" dur="1s" fill="freeze"/>
    </rect>
    <text x="24" y="38" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="#F8FAFC">
      ${stats.name} — Live GitHub Stats
    </text>
    ${rowsSvg}
  </g>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="14" fill="none" stroke="#2563EB" stroke-opacity="0.35"/>
</svg>`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
