---
name: board-worker
description: Pick, debate, implement, and update tasks from GitHub Dev Backlog Project Board (#4) using multi-agent deliberation.
---
# Board Worker Skill (Autonomous Multi-Role Orchestration)

This skill guides the agent in fetching tasks from the multi-project GitHub Dev Backlog board across any repository (`api-me`, `catcast`, `alphadate`, etc.), conducting an automated multi-role consensus deliberation, sanitizing content to prevent data leaks, recording the debate in the issue comments, and either autonomously implementing approved tasks or escalating high-risk decisions to the human developer.

## Project Board Details

* **Board URL:** [https://github.com/users/SergiiVdovareize/projects/4](https://github.com/users/SergiiVdovareize/projects/4)
* **Project Number:** `4`
* **Owner:** `@me` (`SergiiVdovareize`)
* **Project ID:** `PVT_kwHOADkqQ84BosFc`

### Fields & Option IDs

* **Status Field ID:** `PVTSSF_lAHOADkqQ84BosFczhnK_Jk`
  * `Backlog`: `4b06c0fa`
  * `Todo`: `f75ad846`
  * `Needs Decision`: `561cabe1`
  * `In Progress`: `47fc9ee4`
  * `Done`: `98236657`
* **Project Field ID:** `PVTSSF_lAHOADkqQ84BosFczhnK_X0`
  * `api-me`: `ebe4d189` — Backend services, NestJS, Prisma ORM, PostgreSQL, Redis, Outbox notification pipeline (Telegram, WhatsApp), price monitoring scrapers, Sentry error monitoring, backend cron jobs.
  * `catcast`: `fae40303` — Video streaming web and Smart TV (Tizen/webOS) client, torrent streaming, player UI, Lampa / Lampaua player integrations.
  * `alphadate`: `455f0b17` — Dating application, frontend UI/UX, user profiles, matching flows, chat screens, avatar icons, modal loaders.
  * `general`: `f5917314` — Cross-repository tooling, organization-wide scripts, GitHub project board workflows, agent skills and guidelines.

---

## Autonomous Triage Roles

Before touching any code, the agent sequentially assumes four distinct perspectives:
1. 🔍 **Investigator:** Scans the codebase, inspects stacktraces/functions, and identifies the objective root cause or feature scope (using repository-relative file paths).
2. 📐 **System Architect:** Formulates the technical solution, ensures API compatibility, and outlines the unit testing strategy.
3. 🛡️ **Risk Evaluator:** Challenges the design, audits comment text via `comment-sanitizer` for any secrets, tokens, passwords, PII, or absolute paths, and evaluates risk level (**LOW**, **MEDIUM**, or **HIGH**).
4. ⚖️ **Task Orchestrator:** Weighs consensus, posts the sanitized deliberation report to the GitHub issue comments, and issues the verdict:
   * **🟢 AUTO-APPROVED:** Low/Medium risk, clear solution -> Proceed to implementation.
   * **🟡 ESCALATED TO HUMAN:** High risk, architectural dilemma, or missing business requirements -> Move to `Needs Decision` and request user input.

---

## Workflow

### 1. Identify Context and Fetch Next Task
1. Detect current project repository:
   ```bash
   gh repo view --json nameWithOwner,name -q '.name'
   ```
2. Fetch items from the board using `gh project item-list`:
   ```bash
   gh project item-list 4 --owner SergiiVdovareize --format json
   ```
3. Inspect candidates in `Todo` (`f75ad846`).

### 1.2. Repository Alignment & Board Metadata Synchronization
Before task refinement or code modifications, analyze the task's context against the repository taxonomy:

1. **Evaluate Task Alignment:**
   - Inspect issue repository (`content.repository`), issue title, and body.
   - Match against domain keywords and architectural scope (`api-me`, `catcast`, `alphadate`, `general`).
   - Determine detected target project (`DETECTED_PROJECT`).

2. **Synchronize Board `Project` Field:**
   - If the item's `Project` field on the board is unset (`null`), set the matching option ID:
     ```bash
     gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_X0 --single-select-option-id <PROJECT_OPTION_ID>
     ```

3. **Handle Repository Discrepancies & Mismatches:**
   - **Case A: Issue repository matches detected repository**:
     - If the repository matches the active workspace, proceed to Step 1.5 (Task Refinement).
   - **Case B: Issue repository does NOT match detected repository** (e.g., issue filed under `api-me` but describes `catcast` player or `alphadate` UI):
     - Update the board `Project` field to the detected target project.
     - Post an advisory comment on the issue:
       ```bash
       gh issue comment <ISSUE_NUMBER> --body "⚠️ **Repository Alignment Conflict Detected**

- **Current Issue Repository:** \`<CURRENT_REPO>\`
- **Detected Target Project:** \`<DETECTED_PROJECT>\` (based on domain keywords and task scope)

The task appears to belong to another project repository. Moving board card to **Needs Decision** for human review and potential transfer/re-creation in the correct repository."
       ```
     - Move the board card to **`Needs Decision`** (`561cabe1`):
       ```bash
       gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 561cabe1
       ```
     - Do not implement in the current workspace. Pick the next valid task matching the current repository.
   - **Case C: Issue belongs to another repository**:
     - If an issue is correctly filed in another repository (e.g. `cat-cast`), the agent in `api-me` must skip it. Only work on tasks matching the current workspace repository (or `general`).
   - **Case D: Detected project is NOT in the list of `Project` field options**:
     - If the task pertains to a new repository, service, or domain that is not currently represented in the `Project` field options (`api-me`, `catcast`, `alphadate`, `general`):
       1. Do not set an arbitrary option.
       2. Post an advisory comment on the issue requesting the addition of the new project option:
          ```bash
          gh issue comment <ISSUE_NUMBER> --body "⚠️ **New Project Option Required**

- **Current Issue Repository:** \`<CURRENT_REPO>\`
- **Detected Project:** \`<NEW_PROJECT_NAME>\`
- **Reasoning:** The task scope corresponds to a project/repository that is not currently an available option in the board's \`Project\` single-select field (\`api-me\`, \`catcast\`, \`alphadate\`, \`general\`).

Please add **\`<NEW_PROJECT_NAME>\`** to the \`Project\` field options on GitHub Project #4. Moving card to **Needs Decision**."
          ```
       3. Move the board card to **`Needs Decision`** (`561cabe1`):
          ```bash
          gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 561cabe1
          ```
       4. Escalate to the human developer and do not proceed with implementation.

### 1.5. Pre-Flight Task Refinement (`task-refiner`)
Before starting deliberation, improve and structure the task title and description into professional English:
1. Read the raw issue title and body.
2. Translate and structure into `## Overview`, `## Objectives`, `## Acceptance Criteria`.
3. Append the mandatory attribution footer:
   ```markdown
   ---
   *Task title and description refined with AI.*
   ```
4. Audit for sensitive data via `comment-sanitizer` and update the issue:
   ```bash
   gh issue edit <ISSUE_NUMBER> --title "<REFINED_TITLE>" --body "<REFINED_BODY>"
   ```

### 2. Autonomous Multi-Role Deliberation
1. Read the updated issue details:
   ```bash
   gh issue view <ISSUE_NUMBER> --comments
   ```
2. Conduct the automated debate (Investigator -> Architect -> Risk Evaluator -> Orchestrator).
3. **Data Leak Audit:** Apply `comment-sanitizer` to scrub all secrets, passwords, tokens, and replace absolute file paths with relative paths.
4. Post the sanitized deliberation comment directly to the GitHub Issue:
   ```bash
   gh issue comment <ISSUE_NUMBER> --body "### 🤖 Autonomous Task Triage & Consensus

**🔍 Investigator:**
...

**📐 Architect:**
...

**🛡️ Risk Evaluator:**
Risk Level: **LOW** | **MEDIUM** | **HIGH**
...

---
**⚖️ Orchestrator Verdict:** **🟢 AUTO-APPROVED** | **🟡 ESCALATED TO HUMAN**
..."
   ```

### 3. Handle Orchestrator Verdict

#### Path A: 🟡 ESCALATED TO HUMAN
1. Move the board card to **`Needs Decision`**:
   ```bash
   gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 561cabe1
   ```
2. Inform the user in chat with the specific decision needed.
3. **Do not block the queue:** Move on to the next `Todo` task if instructed.

#### Path B: 🟢 AUTO-APPROVED
1. Move the board card to **`In Progress`**:
   ```bash
   gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 47fc9ee4
   ```
2. Implement the solution according to the Architect's approved plan.
3. Follow all repository rules (`AGENTS.md`):
   - Never write directly to `.env` files.
   - Do not run automated test suites/linters unless allowed.
   - Always verify types (`npx tsc --noEmit`).
4. Write unit tests for the changes.
5. If the issue has label `sentry`, resolve in Sentry REST API:
   ```bash
   npm run sentry:resolve -- <SENTRY_ISSUE_ID> resolved
   ```
6. **Commit changes and obtain commit link**:
   Stage, commit, and push changes to the repository:
   ```bash
   git add <FILES>
   git commit -m "fix/feat: <description>"
   git push origin <BRANCH>
   COMMIT_SHA=$(git rev-parse HEAD)
   REPO_NWO=$(gh repo view --json nameWithOwner -q '.nameWithOwner')
   ```
7. **Post sanitized completion comment with commit link**:
   Verify content through `comment-sanitizer` before posting:
   ```bash
   gh issue comment <ISSUE_NUMBER> --body "✅ **Completed Autonomously by AI Agent**

- Summary of changes...
- Commit: https://github.com/${REPO_NWO}/commit/${COMMIT_SHA}
- Verified with type checks and unit tests."
   ```
8. **Check off Acceptance Criteria in the Issue Description**:
   Before closing the issue, update the issue body to mark all completed Acceptance Criteria checkboxes as checked (`- [x]`):
   ```bash
   gh issue edit <ISSUE_NUMBER> --body "<UPDATED_BODY_WITH_CHECKED_BOXES>"
   ```
9. **Close the issue**:
   ```bash
   gh issue close <ISSUE_NUMBER> --reason completed
   ```
10. **Move the board card to `Done`**:
   ```bash
   gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 98236657
   ```
