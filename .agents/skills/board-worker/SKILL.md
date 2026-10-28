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
  * `Action Required`: `561cabe1` — Awaiting human input, decision, or external setup/activation
  * `In Progress`: `47fc9ee4`
  * `Done`: `98236657`
* **Project Field ID:** `PVTSSF_lAHOADkqQ84BosFczhnK_X0`
  * `api-me`: `ebe4d189` — Backend services, NestJS, Prisma ORM, PostgreSQL, Redis, Outbox notification pipeline (Telegram, WhatsApp), price monitoring scrapers, Sentry error monitoring, backend cron jobs.
  * `catcast`: `fae40303` — Video streaming web and Smart TV (Tizen/webOS) client, torrent streaming, player UI, Lampa / Lampaua player integrations.
  * `alphadate`: `455f0b17` — Dating application, frontend UI/UX, user profiles, matching flows, chat screens, avatar icons, modal loaders.
  * `general`: `f5917314` — Cross-repository tooling, organization-wide scripts, GitHub project board workflows, agent skills and guidelines, repository-agnostic research, Draft Items without assigned repository, shared DevOps/infrastructure.
* **Execution Time Field ID:** `PVTF_lAHOADkqQ84BosFczhnjoZs` (TEXT, e.g. "15m", "1h 10m")
* **Tokens Spent Field ID:** `PVTF_lAHOADkqQ84BosFczhnjobQ` (NUMBER, e.g. 35000)

---

## Autonomous Triage Roles

Before touching any code, the agent sequentially assumes four distinct perspectives:
1. 🔍 **Investigator:** Scans the codebase, inspects stacktraces/functions, and identifies the objective root cause or feature scope (using repository-relative file paths).
2. 📐 **System Architect:** Formulates the technical solution, ensures API compatibility, and outlines the unit testing strategy.
3. 🛡️ **Risk Evaluator:** Challenges the design, audits comment text via `comment-sanitizer` for any secrets, tokens, passwords, PII, or absolute paths, and evaluates risk level (**LOW**, **MEDIUM**, or **HIGH**).
4. ⚖️ **Task Orchestrator:** Weighs consensus, posts the sanitized deliberation report to the GitHub issue comments, and issues the verdict:
   * **🟢 AUTO-APPROVED:** Low/Medium risk, clear solution -> Proceed to implementation.
   * **🟡 ESCALATED TO HUMAN:** High risk, architectural dilemma, or missing business requirements -> Move to `Action Required` and request user input.

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
4. **Intelligent Task Prioritization:**
   Instead of naive FIFO processing, analyze all candidate tasks in the queue and prioritize:
   - **P0 (Foundational / Tooling & Blockers):** Skills, CI/CD, project automation, or tasks that unblock subsequent work.
   - **P1 (Critical Bugs & Outages):** Sentry errors, runtime exceptions, data corruption.
   - **P2 (Core Features):** Implementation of functional roadmap requirements.
   - **P3 (R&D & Spike Investigations):** Exploratory audits, technology assessments.
   Select the highest-priority actionable task that aligns with the active workspace.

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

The task appears to belong to another project repository. Moving board card to **Action Required** for human review and potential transfer/re-creation in the correct repository."
       ```
     - Move the board card to **`Action Required`** (`561cabe1`):
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

Please add **\`<NEW_PROJECT_NAME>\`** to the \`Project\` field options on GitHub Project #4. Moving card to **Action Required**."
          ```
       3. Move the board card to **`Action Required`** (`561cabe1`):
          ```bash
          gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 561cabe1
          ```
       4. Escalate to the human developer and do not proceed with implementation.
   - **Case E: Task is classified as `general`**:
     - Markers for `general`:
       * Item is a Draft Item with no repository attached (`content.repository == null`, `content.type == "DraftIssue"`).
       * Scope targets cross-repo developer tooling, agent skills (`.agents/skills/*`), board automations, or organization standards.
       * Pure R&D, market/technology spike, or architectural blueprint not yet tied to a specific codebase.
       * Organization-level infrastructure, DNS, or global DevOps policies.
     - Action:
       1. Assign board `Project` field to `general` (`f5917314`):
          ```bash
          gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_X0 --single-select-option-id f5917314
          ```
       2. If the task is non-code (research, board configuration, agent skills): Any workspace agent can execute it.
       3. If the task is a Draft Item requiring new code in a specific repository: Convert it by creating an issue in that repository (`gh issue create --repo ...`), add it to the project (`gh project item-add 4 ...`), and archive the draft item.

### 1.5. Pre-Flight Task Refinement (`task-refiner`)
Before starting deliberation, invoke the `task-refiner` skill to translate and structure the task title and description into professional English (`## Overview`, `## Objectives`, `## Acceptance Criteria`, and attribution footer):
1. **Fetch Raw Content:**
   - Regular Issue: Read title and body via `gh issue view <ISSUE_NUMBER> --json title,body`.
   - Draft Item: Read title and body from `gh project item-list` JSON output.
2. **Apply `task-refiner` & `comment-sanitizer`:**
   - **Preserve Automated Templates:** If the issue was created automatically (e.g. Sentry issues with `## Sentry Issue [ID: ...]`, URLs, error details), **NEVER** delete or overwrite the original template. Keep the original diagnostic content at the top and **append** the refined sections below separated by `---`.
   - Format per `task-refiner` guidelines and scrub sensitive data via `comment-sanitizer`.
3. **Save Refined Task:**
   - Regular Issue:
     ```bash
     gh issue edit <ISSUE_NUMBER> --title "<REFINED_TITLE>" --body "<REFINED_BODY>"
     ```
   - Draft Item:
     ```bash
     gh project item-edit --id <ITEM_ID> --title "<REFINED_TITLE>" --body "<REFINED_BODY>"
     ```

### 2. Autonomous Multi-Role Deliberation
1. Read the updated task details:
   - Regular issue: `gh issue view <ISSUE_NUMBER> --comments`
   - Draft item: inspect item fields and updated body.
2. Conduct the automated debate (Investigator -> Architect -> Risk Evaluator -> Orchestrator).
3. **Data Leak Audit:** Apply `comment-sanitizer` to scrub all secrets, passwords, tokens, and replace absolute file paths with relative paths.
4. Record the sanitized deliberation:
   - **For regular issue:** Post directly to the GitHub Issue comments:
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
   - **For Draft item:** Append the consensus report directly to the draft item body:
     ```bash
     gh project item-edit --id <ITEM_ID> --body "<ORIGINAL_BODY>

### 🤖 Autonomous Task Triage & Consensus
..."
     ```

### 3. Handle Orchestrator Verdict

#### Path A: 🟡 ESCALATED TO HUMAN (Action Required before/during implementation)
When high risk, architectural dilemma, or missing business requirements require human approval:
1. **No Trivial Chat Ping-Pong:** Do not ask superficial or fragmented questions in IDE chat.
2. **Comprehensive Decision Package:** Post an all-in-one, fully articulated decision request directly to the GitHub issue comments:
   - **Context:** Core technical problem, architectural constraints, and current blockers.
   - **Options & Trade-offs:** Concrete choices (Option 1 vs Option 2) with advantages, drawbacks, and system impacts.
   - **Agent Recommendation:** Clear recommendation with technical justification.
   - **Action Item:** Exact confirmation required from the human.
   ```bash
   gh issue comment <ISSUE_NUMBER> --body "### 🟡 Decision Required

#### Context
...

#### Options
- **Option 1: [Title]**
  - *Pros:* ...
  - *Cons:* ...
- **Option 2: [Title]**
  - *Pros:* ...
  - *Cons:* ...

#### Agent Recommendation
...

#### Action Required
Please approve an option in the comments and move this card back to \`Todo\` when decided."
   ```
3. **Move the board card to `Action Required` (`561cabe1`):**
   ```bash
   gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 561cabe1
   ```
4. **Human Resolution Lifecycle:** The human reads the package, makes the decision, posts their choice in the issue comment, and moves the card back to **`Todo`** (`f75ad846`).
5. **Never Block the Queue:** Notify the user concisely in chat and immediately proceed to the next unblocked task.

#### Path B: 🟢 AUTO-APPROVED (Implementation & Completion Routing)
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
5. **Conditional Sentry Resolution:**
   If the issue has label `sentry` and the repository provides a Sentry resolution script (e.g. in `api-me`):
   ```bash
   npm run --if-present sentry:resolve -- <SENTRY_ISSUE_ID> resolved
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
7. **Populate Execution Metrics (Time & Tokens)**:
   Record measured or estimated duration and token consumption on the project board:
   ```bash
   # Set Execution Time (TEXT)
   gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTF_lAHOADkqQ84BosFczhnjoZs --text "<DURATION>"

   # Set Tokens Spent (NUMBER)
   gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTF_lAHOADkqQ84BosFczhnjobQ --number <TOKENS_COUNT>
   ```
8. **Post-Implementation Completion Routing (CRITICAL):**
   Evaluate: Does this feature require external human action (secrets, third-party accounts, webhooks, hardware, external credentials) to be fully functional?

   * **Branch 1: Requires External Human Setup / Credentials (e.g. Vercel env secrets, Meta WhatsApp Webhooks, third-party dashboards, manual DB migrations):**
     1. **Add Persistent Checklist & Testing Instructions to Issue Body:** Append a structured `## 🛠️ Required Human Setup & Activation Checklist` section to the issue body. It MUST include:
        - Checkable configuration steps (`- [ ]`) for environment variables, secrets, portal URLs, and permissions.
        - **Step-by-Step Testing & Verification Instructions:** Concrete, copy-pasteable commands (e.g. `curl`, test scripts, CLI invocations, or exact mobile/UI triggers) to verify that the implementation and credentials work end-to-end.
        - **Expected Output / Result:** Exactly what response code, payload, or board state confirms success.
     2. **Post Handoff Comment:** Post comment with commit link, execution metrics, and a clear notification that manual configuration is needed.
     3. **DO NOT close the issue:** Keep the issue open.
     4. **Move the board card to `Action Required` (`561cabe1`):**
        ```bash
        gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 561cabe1
        ```
     5. **Human Lifecycle:** The human completes the external setup, runs the test commands, checks off the boxes in the issue body, closes the issue, and moves the card to **`Done`** (`98236657`).

   * **Branch 2: 100% Self-Contained Task (no external setup required):**
     1. **Check off Acceptance Criteria:** Mark all `- [x]` in the issue description.
     2. **Post Completion Report:** Post sanitized completion report comment with commit link and metrics.
     3. **Close Issue:**
        ```bash
        gh issue close <ISSUE_NUMBER> --reason completed
        ```
     4. **Move the board card to `Done` (`98236657`):**
        ```bash
        gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 98236657
        ```
