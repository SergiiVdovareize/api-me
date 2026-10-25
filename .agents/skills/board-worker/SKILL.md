---
name: board-worker
description: Pick, debate, implement, and update tasks from GitHub Dev Backlog Project Board (#4) using multi-agent deliberation.
---
# Board Worker Skill (Autonomous Multi-Role Orchestration)

This skill guides the agent in fetching tasks from the multi-project GitHub Dev Backlog board across any repository (`api-me`, `tizen-flix`, etc.), conducting an automated multi-role consensus deliberation, recording the debate in the issue comments, and either autonomously implementing approved tasks or escalating high-risk decisions to the human developer.

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
  * `api-me`: `ebe4d189`
  * `tizen-flix`: `fae40303`
  * `general`: `f5917314`

---

## Autonomous Triage Roles

Before touching any code, the agent sequentially assumes four distinct perspectives:
1. 🔍 **Investigator:** Scans the codebase, inspects stacktraces/functions, and identifies the objective root cause or feature scope.
2. 📐 **System Architect:** Formulates the technical solution, ensures API compatibility, and outlines the unit testing strategy.
3. 🛡️ **Risk Evaluator:** Challenges the design, checks for breaking changes or edge cases, and evaluates risk level (**LOW**, **MEDIUM**, or **HIGH**).
4. ⚖️ **Task Orchestrator:** Weighs consensus, posts the deliberation report to the GitHub issue comments, and issues the verdict:
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
3. Filter items where:
   * Status is `Todo` (`f75ad846`)
   * Project field matches the current repository (`api-me`, `tizen-flix`, or `general`)
4. **Sequential Processing (FIFO):** Take the very first task in order.

### 2. Autonomous Multi-Role Deliberation
1. Read the issue details:
   ```bash
   gh issue view <ISSUE_NUMBER> --comments
   ```
2. Conduct the automated debate (Investigator -> Architect -> Risk Evaluator -> Orchestrator).
3. Post the deliberation comment directly to the GitHub Issue:
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
7. **Post completion comment with commit link**:
   ```bash
   gh issue comment <ISSUE_NUMBER> --body "✅ **Completed Autonomously by AI Agent**

- Summary of changes...
- Commit: https://github.com/${REPO_NWO}/commit/${COMMIT_SHA}
- Verified with type checks and unit tests."
   ```
8. Close the issue:
   ```bash
   gh issue close <ISSUE_NUMBER> --reason completed
   ```
9. Move the board card to **`Done`**:
   ```bash
   gh project item-edit --project-id PVT_kwHOADkqQ84BosFc --id <ITEM_ID> --field-id PVTSSF_lAHOADkqQ84BosFczhnK_Jk --single-select-option-id 98236657
   ```
