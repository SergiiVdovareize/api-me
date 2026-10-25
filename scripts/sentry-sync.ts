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
const REPO_NAME = 'SergiiVdovareize/api-me';

// Status & Project Field / Option IDs
const STATUS_FIELD_ID = 'PVTSSF_lAHOADkqQ84BosFczhnK_Jk';
const STATUS_TODO_OPTION_ID = 'f75ad846';
const PROJECT_FIELD_ID = 'PVTSSF_lAHOADkqQ84BosFczhnK_X0';
const PROJECT_API_ME_OPTION_ID = 'ebe4d189';

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

function getExistingGithubSentryIssueIds(): Set<string> {
  const existingIds = new Set<string>();
  try {
    const raw = execSync(
      `gh issue list --repo ${REPO_NAME} --label sentry --state all --limit 100 --json number,title,body`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const issues = JSON.parse(raw);

    for (const item of issues) {
      const match =
        item.body?.match(/<!--\s*sentry-issue-id:\s*(\S+?)\s*-->/) ||
        item.body?.match(/Sentry Issue\s*\[ID:\s*(\S+?)\]/i);
      if (match && match[1]) {
        existingIds.add(match[1]);
      }
    }
  } catch (err: any) {
    console.warn(`Warning: Could not fetch existing issues via gh: ${err.message}`);
  }
  return existingIds;
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

  // Add to Project Board
  try {
    const addResultRaw = execFileSync(
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
    const addResult = JSON.parse(addResultRaw);
    const itemId = addResult.id;

    if (itemId) {
      // Set Status to Todo
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
      // Set Project to api-me
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
        PROJECT_API_ME_OPTION_ID,
      ]);
      console.log(`Added issue to Project #${PROJECT_NUMBER} (Status: Todo, Project: api-me)`);
    }
  } catch (err: any) {
    console.warn(`Warning: Could not link issue to project board: ${err.message}`);
  }

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
    // If running in CI without token configured yet, don't fail the workflow hard
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

  const existingIds = getExistingGithubSentryIssueIds();
  console.log(`Found ${existingIds.size} already tracked Sentry issue(s) on GitHub.`);

  let newCount = 0;
  for (const issue of sentryIssues) {
    if (existingIds.has(issue.id)) {
      console.log(`Skipping Sentry ID ${issue.id} (already tracked on GitHub).`);
      continue;
    }

    createGithubIssue(issue, dryRun);
    existingIds.add(issue.id);
    newCount++;
  }

  console.log(`Sync completed. Added ${newCount} new task(s) to Dev Backlog.`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
