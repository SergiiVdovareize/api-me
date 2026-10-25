---
name: board-worker
description: Pick, implement, test, and update tasks from GitHub Dev Backlog Project Board (#4).
---
# Board Worker Skill (Multi-Project)

This skill guides the agent in autonomously fetching tasks from the multi-project GitHub Dev Backlog board across any repository (`api-me`, `tizen-flix`, etc.), implementing the requested changes according to repository rules, verifying code quality, and updating the card's status and comments.

## Project Board Details

* **Board URL:** [https://github.com/users/SergiiVdovareize/projects/4](https://github.com/users/SergiiVdovareize/projects/4)
* **Project Number:** `4`
* **Owner:** `@me` (`SergiiVdovareize`)
* **Project ID:** `PVT_kwHOADkqQ84BosFc`

### Fields & Option IDs

* **Status Field ID:** `PVTSSF_lAHOADkqQ84BosFczhnK_Jk`
  * `Backlog`: `4b06c0fa`
  * `Todo`: `f75ad846`
  * `In Progress`: `47fc9ee4`
  * `Done`: `98236657`
* **Project Field ID:** `PVTSSF_lAHOADkqQ84BosFczhnK_X0`
  * `api-me`: `ebe4d189`
  * `tizen-flix`: `fae40303`
  * `general`: `f5917314`

---

## Workflow

### 1. Identify Context and Fetch Tasks
1. Detect current project repository:
   ```bash
   gh repo view --json nameWithOwner,name -q '.name'
   ```
2. Fetch items from the board using `gh project item-list`:
   ```bash
   gh project item-list 4 --owner SergiiVdovareize --format json
   ```
3. Filter items where:
   * Status is `Todo` (`f75ad846`)
   * Project field matches the current repository (`api-me`, `tizen-flix`, or `general`)
4. **Sequential Processing (FIFO):** Always take the very first/top task in the list in order. Do not skip tasks unless explicitly instructed.

### 2. Mark as In Progress
Move the task card to `In Progress`:
```bash
gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 47fc9ee4
```

### 3. Read Task Details
* If the item is a repository **Issue**:
  ```bash
  gh issue view <ISSUE_NUMBER> --comments
  ```
* If the item is a **Draft Issue**:
  Read the title and body directly from the `item-list` JSON.

### 4. Implement the Solution
* Carefully plan and execute the code modifications.
* Follow all repository rules:
  - Do not edit `.env` files directly.
  - Watch for typos in identifiers and database models.
  - Maintain documentation and existing comments.
* Write corresponding unit tests and test coverage where applicable.

### 5. Verify Quality
1. Verify TypeScript types:
   ```bash
   npx tsc --noEmit
   ```
2. **Important Rule:** Do NOT run automated test suites (`npm run test`, `jest`) or linters (`eslint`, `npm run validate`) automatically unless the user explicitly asks. The user runs validation and tests manually before pushing (per `AGENTS.md`).

### 6. Update Card and Move to Done
1. If the item is a GitHub Issue, post a comment summarizing what was done:
   ```bash
   gh issue comment <ISSUE_NUMBER> --body "✅ **Completed by AI Agent**\n\n- Summary of changes...\n- Verified with TypeScript check."
   ```
2. Close the GitHub Issue:
   ```bash
   gh issue close <ISSUE_NUMBER> --reason completed
   ```
3. Move the board item to `Done`:
   ```bash
   gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 98236657
   ```

---

## Sentry Error Triage & Auto-Remediation

When a task has the `sentry` label or title starting with `[Sentry]`:

### 1. Identify Sentry Metadata
* Extract the **Sentry Issue ID** from the issue body:
  `<!-- sentry-issue-id: <ID> -->` or `Sentry Issue [ID: <ID>]`
* Check the culprit file/line and error details provided in the issue description.

### 2. Triage & Decision
* **Actionable Bug:** An unhandled error, null pointer exception, crash, or unexpected API failure in `src/`.
  -> Implement fix in source code, create unit test.
* **Benign / Non-Actionable Noise:** Bot scanning 404s, malformed client requests already handled by HTTP filters, or intentional behavior.
  -> Explain why in a comment on the GitHub issue, close it, and resolve or ignore in Sentry:
  ```bash
  npm run sentry:resolve -- <SENTRY_ISSUE_ID> ignored
  ```

### 3. Implement Fix & Resolve in Sentry
1. Modify the relevant file in `src/`.
2. Add or update unit tests for the component.
3. Verify TypeScript types:
   ```bash
   npx tsc --noEmit
   ```
4. Resolve the issue in Sentry REST API:
   ```bash
   npm run sentry:resolve -- <SENTRY_ISSUE_ID> resolved
   ```
5. Comment on GitHub Issue, close it, and move board card to `Done`.

