import 'dotenv/config';

interface ResolveOptions {
  issueId: string;
  status: 'resolved' | 'ignored' | 'unresolved';
}

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
      'SENTRY_AUTH_TOKEN is not set. Please provide a valid Sentry token with event:write / issue:write scopes.'
    );
  }
  return token;
}

async function resolveSentryIssue(options: ResolveOptions): Promise<void> {
  const token = getSentryToken();

  const defaultHost = process.env.SENTRY_URL || 'https://de.sentry.io';
  const urlsToTry = [
    `${defaultHost}/api/0/issues/${options.issueId}/`,
    `https://sentry.io/api/0/issues/${options.issueId}/`,
  ];

  let lastError: Error | null = null;
  for (const url of urlsToTry) {
    try {
      console.log(`Sending resolve request to Sentry: ${url}`);
      const res = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: options.status,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Sentry API returned ${res.status}: ${text}`);
      }

      const data = await res.json();
      console.log(
        `✅ Successfully updated Sentry issue ${options.issueId} to status "${data.status || options.status}".`
      );
      return;
    } catch (err: any) {
      lastError = err;
    }
  }

  throw lastError || new Error(`Failed to resolve Sentry issue ${options.issueId}`);
}

async function main() {
  const args = process.argv.slice(2);
  const issueId = args[0];

  if (!issueId) {
    console.error('Usage: npm run sentry:resolve -- <sentry-issue-id> [status]');
    console.error('Example: npm run sentry:resolve -- 4508043969298512 resolved');
    process.exit(1);
  }

  const status = (args[1] || 'resolved') as 'resolved' | 'ignored' | 'unresolved';

  console.log(`=== Resolving Sentry Issue ${issueId} (${status}) ===`);
  try {
    await resolveSentryIssue({ issueId, status });
  } catch (err: any) {
    console.error(`❌ Error updating Sentry issue: ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
