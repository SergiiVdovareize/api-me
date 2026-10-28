import 'dotenv/config';
import { execSync, execFileSync } from 'child_process';

interface SentryIssue {
  id: string;
  shortId?: string;
  title: string;
  culprit?: string;
  permalink?: string;
  count?: string | number;
  userCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  level?: string;
  metadata?: {
    value?: string;
    type?: string;
    filename?: string;
  };
  status?: string;
}

const PROJECT_BOARD_ID = 'PVT_kwHOADkqQ84BosFc';
const PROJECT_NUMBER = 4;
const PROJECT_OWNER = 'SergiiVdovareize';

function getRepoName(): string {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }
  try {
    const raw = execSync('gh repo view --json nameWithOwner -q .nameWithOwner', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    if (raw) return raw;
  } catch {}
  return 'SergiiVdovareize/api-me';
}
const REPO_NAME = getRepoName();

// Status & Project Field / Option IDs
const STATUS_FIELD_ID = 'PVTSSF_lAHOADkqQ84BosFczhnK_Jk';
const STATUS_TODO_OPTION_ID = 'f75ad846';
const PROJECT_FIELD_ID = 'PVTSSF_lAHOADkqQ84BosFczhnK_X0';

function getProjectOptionId(repoName: string): string {
  const shortName = repoName.split('/')[1]?.toLowerCase() || '';
  if (shortName.includes('api-me')) {
    return 'ebe4d189'; // api-me
  }
  if (shortName.includes('catcast') || shortName.includes('tizen')) {
    return 'fae40303'; // catcast
  }
  if (shortName.includes('alphadate')) {
    return '455f0b17'; // alphadate
  }
  return 'f5917314'; // general
}
const PROJECT_OPTION_ID = getProjectOptionId(REPO_NAME);

function getSentryToken(): string {
  let token =
    process.env.SENTRY_USER_TOKEN ||
    process.env.SENTRY_API_TOKEN ||
    process.env.SENTRY_AUTH_TOKEN;

  // If token is org-level sntrys_ (only scoped for CI/sourcemaps), check if a user token sntryu_ exists in .env
  if (!token || token.startsWith('sntrys_')) {
    try {
      const fs = require('fs');
      if (fs.existsSync('.env')) {
        const envContent = fs.readFileSync('.env', 'utf-8');
        const match = envContent.match(/SENTRY_AUTH_TOKEN=(sntryu_[a-zA-Z0-9]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    } catch {}
  }

  if (!token) {
    throw new Error(
      'SENTRY_AUTH_TOKEN is not set. Please provide a valid Sentry token with event:read / issue:read scopes.'
    );
  }
  return token;
}

async function fetchSentryIssues(): Promise<SentryIssue[]> {
  const token = getSentryToken();
  const defaultHost = process.env.SENTRY_URL || 'https://de.sentry.io';
  const targetProject = process.env.SENTRY_PROJECT || 'api-me';
  let org = process.env.SENTRY_ORG || 'home-api';

  // Attempt auto-discovery of org & project via /api/0/projects/
  try {
    const listRes = await fetch(`${defaultHost}/api/0/projects/`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (listRes.ok) {
      const projects = (await listRes.json()) as any[];
      const found = projects.find(
        (p) => p.slug === targetProject || p.name === targetProject
      );
      if (found?.organization?.slug) {
        org = found.organization.slug;
        console.log(`Auto-detected Sentry organization: "${org}" for project "${targetProject}"`);
      }
    }
  } catch (err: any) {
    // ignore auto-discovery error and proceed with defaults
  }

  const urlsToTry = [
    `${defaultHost}/api/0/projects/${org}/${targetProject}/issues/?query=is:unresolved`,
    `https://sentry.io/api/0/projects/${org}/${targetProject}/issues/?query=is:unresolved`,
  ];

  let lastError: Error | null = null;

  for (const url of urlsToTry) {
    try {
      console.log(`Querying Sentry API: ${url}`);
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Sentry API returned ${res.status}: ${text}`);
      }

      const data = (await res.json()) as SentryIssue[];
      return data;
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error('Failed to fetch issues from Sentry');
}

interface ExistingGithubIssue {
  sentryId: string;
  number: number;
  url: string;
  state: string;
}

function getExistingGithubSentryIssues(): Map<string, ExistingGithubIssue> {
  const existingMap = new Map<string, ExistingGithubIssue>();
  try {
    const raw = execSync(
      `gh issue list --repo ${REPO_NAME} --label sentry --state all --limit 100 --json number,title,body,url,state`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const issues = JSON.parse(raw);

    for (const item of issues) {
      const match =
        item.body?.match(/<!--\s*sentry-issue-id:\s*(\S+?)\s*-->/) ||
        item.body?.match(/Sentry Issue\s*\[ID:\s*(\S+?)\]/i);
      if (match && match[1]) {
        existingMap.set(match[1], {
          sentryId: match[1],
          number: item.number,
          url: item.url,
          state: item.state,
        });
      }
    }
  } catch (err: any) {
    console.warn(`Warning: Could not fetch existing issues via gh: ${err.message}`);
  }
  return existingMap;
}

function getProjectBoardIssueUrls(): Set<string> {
  const boardUrls = new Set<string>();
  try {
    const raw = execSync(
      `gh project item-list ${PROJECT_NUMBER} --owner ${PROJECT_OWNER} --format json --limit 100`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const data = JSON.parse(raw);
    for (const item of data.items || []) {
      if (item.content?.url) {
        boardUrls.add(item.content.url);
      }
    }
  } catch (err: any) {
    console.warn(`Warning: Could not fetch project board items: ${err.message}`);
  }
  return boardUrls;
}

function linkIssueToProjectBoard(issueUrl: string): boolean {
  console.log(`Linking issue to Project Board #${PROJECT_NUMBER} (${issueUrl})...`);
  try {
    let addResultRaw: string;
    try {
      addResultRaw = execFileSync(
        'gh',
        [
          'project',
          'item-add',
          String(PROJECT_NUMBER),
          '--owner',
          PROJECT_OWNER,
          '--url',
          issueUrl,
          '--format',
          'json',
        ],
        { encoding: 'utf-8' }
      );
    } catch {
      // Fallback with --owner @me if explicit owner failed
      addResultRaw = execFileSync(
        'gh',
        [
          'project',
          'item-add',
          String(PROJECT_NUMBER),
          '--owner',
          '@me',
          '--url',
          issueUrl,
          '--format',
          'json',
        ],
        { encoding: 'utf-8' }
      );
    }

    const addResult = JSON.parse(addResultRaw);
    const itemId = addResult.id;

    if (itemId) {
      execFileSync('gh', [
        'project',
        'item-edit',
        '--project-id',
        PROJECT_BOARD_ID,
        '--id',
        itemId,
        '--field-id',
        STATUS_FIELD_ID,
        '--single-select-option-id',
        STATUS_TODO_OPTION_ID,
      ]);
      execFileSync('gh', [
        'project',
        'item-edit',
        '--project-id',
        PROJECT_BOARD_ID,
        '--id',
        itemId,
        '--field-id',
        PROJECT_FIELD_ID,
        '--single-select-option-id',
        PROJECT_OPTION_ID,
      ]);
      console.log(`Successfully added issue to Project #${PROJECT_NUMBER} (Status: Todo, Project: ${REPO_NAME})`);
      return true;
    }
  } catch (err: any) {
    console.warn(`Warning: Could not link issue to project board: ${err.message}`);
  }
  return false;
}

function createGithubIssue(issue: SentryIssue, dryRun: boolean): string | null {
  const title = `[Sentry] ${issue.title}`;
  const culprit = issue.culprit ? `\`${issue.culprit}\`` : 'Unknown';
  const details =
    issue.metadata?.value ||
    issue.metadata?.type ||
    issue.culprit ||
    'No detailed stack trace available.';

  const body = `## Sentry Issue [ID: ${issue.id}]
**Title:** ${issue.title}
**Culprit:** ${culprit}
**Level:** \`${issue.level || 'error'}\`
**Events:** ${issue.count ?? 1} | **Users:** ${issue.userCount ?? 1}
**First Seen:** ${issue.firstSeen || 'N/A'} | **Last Seen:** ${issue.lastSeen || 'N/A'}
**Sentry URL:** ${issue.permalink || `https://home-sr9.sentry.io/issues/${issue.id}/`}

### Error Details
\`\`\`
${details}
\`\`\`

<!-- sentry-issue-id: ${issue.id} -->

---
*Created automatically by Sentry Issue Sync workflow.*
`;

  if (dryRun) {
    console.log(`[DRY RUN] Would create issue: "${title}" for Sentry ID ${issue.id}`);
    return null;
  }

  console.log(`Creating GitHub Issue for Sentry ID: ${issue.id}...`);
  const issueUrl = execFileSync(
    'gh',
    [
      'issue',
      'create',
      '--repo',
      REPO_NAME,
      '--title',
      title,
      '--body',
      body,
      '--label',
      'sentry,bug',
    ],
    { encoding: 'utf-8' }
  ).trim();
  console.log(`Created GitHub Issue: ${issueUrl}`);

  linkIssueToProjectBoard(issueUrl);

  return issueUrl;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log(`=== Sentry Issue Ingestion === (dryRun: ${dryRun})`);

  let sentryIssues: SentryIssue[] = [];
  try {
    sentryIssues = await fetchSentryIssues();
    console.log(`Found ${sentryIssues.length} unresolved issue(s) in Sentry.`);
  } catch (err: any) {
    console.error(`Sentry query error: ${err.message}`);
    if (process.env.GITHUB_ACTIONS) {
      console.log('Skipping sync: Sentry credentials need to be configured in GitHub Secrets.');
      process.exit(0);
    }
    process.exit(1);
  }

  if (sentryIssues.length === 0) {
    console.log('No unresolved Sentry issues found. All clean!');
    return;
  }

  const existingMap = getExistingGithubSentryIssues();
  console.log(`Found ${existingMap.size} already tracked Sentry issue(s) on GitHub.`);

  const boardUrls = getProjectBoardIssueUrls();
  console.log(`Found ${boardUrls.size} item(s) on Project Board #${PROJECT_NUMBER}.`);

  let newCount = 0;
  let reconciledCount = 0;

  for (const issue of sentryIssues) {
    const existing = existingMap.get(issue.id);

    if (existing) {
      if (existing.state.toUpperCase() === 'OPEN' && !boardUrls.has(existing.url)) {
        console.log(`Sentry ID ${issue.id} has open issue #${existing.number} (${existing.url}) but is MISSING from Project #${PROJECT_NUMBER}. Linking now...`);
        if (!dryRun) {
          const linked = linkIssueToProjectBoard(existing.url);
          if (linked) {
            boardUrls.add(existing.url);
            reconciledCount++;
          }
        }
      } else {
        console.log(`Skipping Sentry ID ${issue.id} (already tracked on GitHub and project board).`);
      }
      continue;
    }

    const createdUrl = createGithubIssue(issue, dryRun);
    if (createdUrl) {
      boardUrls.add(createdUrl);
    }
    existingMap.set(issue.id, {
      sentryId: issue.id,
      number: 0,
      url: createdUrl || '',
      state: 'OPEN',
    });
    newCount++;
  }

  console.log(`Sync completed. Added ${newCount} new issue(s), reconciled ${reconciledCount} missing board item(s).`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
