---
name: comment-sanitizer
description: Validate and sanitize comments, issue bodies, and board cards before posting publicly to GitHub, preventing leakage of secrets, API keys, passwords, PII, and absolute local paths.
---
# Comment Sanitizer & Secret Scrubber Skill (Global)

This skill ensures that no sensitive, private, or identifying data is ever leaked when posting comments, issues, pull requests, or cards to GitHub project boards and repositories (which may be public or accessible to unauthorized viewers).

---

## What Must Be Checked & Scrubbed

Before executing any `gh issue comment`, `gh issue create`, `gh pr comment`, `gh project item-edit`, or `gh project item-create`, the content must be inspected against the following risk categories:

### 1. API Keys, Tokens & Credentials
* **GitHub Tokens:** `ghp_[A-Za-z0-9_]{36,}`, `gho_`, `github_pat_`
* **Sentry Tokens:** `sntrys_[A-Za-z0-9_]+`, Sentry DSNs with embedded keys (`https://<key>@sentry.io/...`)
* **Cloud Provider Keys:**
  * AWS: `AKIA[0-9A-Z]{16}`, AWS secret keys
  * Google Cloud / Firebase API keys (`AIza[0-9A-Za-z\\-_]{35}`)
  * OpenAI / Anthropic keys (`sk-[A-Za-z0-9_-]{32,}`)
  * Stripe keys (`sk_live_...`, `rk_live_...`)
  * Generic Bearer tokens, JWT tokens (`ey[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+`)
  * SSH / RSA Private keys (`-----BEGIN PRIVATE KEY-----`, `-----BEGIN RSA PRIVATE KEY-----`)

### 2. Passwords & Connection Strings
* Database URLs with credentials:
  * `postgres://user:password@host:port/db` ➔ Replace with `postgres://<user>:<password>@<host>:<port>/<db>` or redact password.
  * `mongodb://...`, `mysql://...`, `redis://:password@host...`
* Basic Auth URLs: `https://user:password@domain.com` ➔ Replace with `https://<user>:<redacted>@domain.com`
* Explicit password fields in JSON/payloads: `"password": "..."`, `"token": "..."`, `"secret": "..."`

### 3. Absolute Local Paths & User Identifiers
* Absolute file system paths revealing the machine username, workspace location, or environment:
  * Example: `/Users/s.vdovareize/work/api-me/src/index.ts`
  * **Sanitization:** Convert to repo-relative paths: `src/index.ts` or `[api-me]/src/index.ts`.
  * Linux/Mac: `/home/<user>/...`, `/Users/<user>/...`
  * Windows: `C:\Users\<user>\...`

### 4. PII & Internal Network Information
* Real personal emails, phone numbers, or private user IDs unless publicly intended.
* Private internal IP addresses (`10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`) and internal VPN domain names.
* Environment variable contents from `.env` or system environment secrets.

---

## Sanitization Strategy & Replacements

| Detected Entity | Replacement Pattern |
|---|---|
| Secret / Token / Password | `[REDACTED]` or `[FILTERED_SECRET]` |
| Absolute File Path (`/Users/.../repo/path/file.ext`) | Relative path: `path/file.ext` |
| Connection String with Password | `postgres://user:***@host:5432/dbname` |
| Internal IP / Host | `<internal_host>` |

---

## Pre-Post Verification Checklist

Before running any GitHub CLI posting command:
1. [ ] **No Secrets:** Check text for matches against tokens, keys, passwords, and `.env` values.
2. [ ] **No Absolute Paths:** Ensure paths are converted to repository-relative format (e.g. `src/modules/...` instead of `/Users/s.vdovareize/...`).
3. [ ] **No PII:** Verify absence of personal private data.
4. [ ] If any secret is detected, **scrub and replace** before sending to `gh`.
