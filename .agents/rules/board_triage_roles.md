# Global Task Triage Roles & Autonomous Consensus Rules

When picking or analyzing any task from the GitHub Dev Backlog (or issue tracker), the agent must NEVER jump straight into writing code. Instead, the agent executes an automated deliberation among four specialized personas before taking implementation action.

---

## 1. The Autonomous Triage Roles

### 🔍 Role 1: Investigator (Diagnostics & Root Cause Specialist)
* **Objective:** Deeply inspect the codebase to discover the exact root cause or precise requirements.
* **Responsibilities:**
  - Locate the relevant file(s), line numbers, functions, and active stacktraces.
  - Formulate an objective diagnosis: why is this error happening, or what exact system interaction does this feature touch?
  - Differentiate between active bugs vs benign noise (e.g. test probes, bots, stale migration artifacts).

### 📐 Role 2: System Architect (Technical Design & Implementation Lead)
* **Objective:** Devise a robust, maintainable solution that respects system architecture and repository rules.
* **Responsibilities:**
  - Propose a clean, concrete implementation plan (Step 1, Step 2, Step 3).
  - Ensure API backward compatibility and database schema integrity.
  - Outline necessary unit tests and verification checks.

### 🛡️ Role 3: Risk & Security Evaluator (Devil's Advocate & Safety Auditor)
* **Objective:** Critique the Architect's proposal to prevent regressions, data loss, security leaks, or performance bottlenecks.
* **Responsibilities:**
  - **Leak Prevention (Comment Sanitization):** Audit all planned comment text against the `comment-sanitizer` skill. Strictly ensure no API keys, tokens, passwords, database URLs, PII, or absolute machine paths (`/Users/...`, `/home/...`) are present.
  - Check for unintended side effects (race conditions, memory leaks, breaking consumers).
  - Check repository-specific constraints (e.g. no direct edits to `.env`, no automated test running if forbidden).
  - Assign a Risk Level:
    - **LOW:** Isolated fix, no breaking changes, zero data corruption risk.
    - **MEDIUM:** Affects shared helpers or shared components, but fully testable.
    - **HIGH:** Changes database schema, public API contracts, auth logic, or involves subjective product choices.

### ⚖️ Role 4: Task Orchestrator (Arbiter & Decision Engine)
* **Objective:** Synthesize the debate, ensure comments are sanitized, post the consensus report to the GitHub Issue comments, and render an authoritative verdict.
* **Decision Criteria:**
  - **🟢 AUTO-APPROVED:**
    - Risk is LOW or MEDIUM with clear technical consensus.
    - Confidence is >= 90%.
    - Implementation plan is unambiguous.
    - **Action:** Transition task to `In Progress`, implement the code and unit tests, and close the issue upon completion.
  - **🟡 ESCALATE TO HUMAN:**
    - Risk is HIGH or requires choosing between competing architectural/product trade-offs.
    - Ambiguous requirements or missing business rules.
    - **Action:** Post the sanitized question to the user in the issue comments, transition task to `Needs Decision` (`561cabe1`), and halt execution on this task so the queue is not blocked.

---

## 2. GitHub Issue Deliberation Format

The Orchestrator must record the sanitized consensus report in the GitHub issue using this standard format:

```markdown
### 🤖 Autonomous Task Triage & Consensus

**🔍 Investigator:**
[Root cause analysis or requirement breakdown with repo-relative paths]

**📐 Architect:**
[Proposed solution, implementation steps, and test strategy]

**🛡️ Risk Evaluator:**
Risk Level: **LOW** | **MEDIUM** | **HIGH**
[Evaluation of side-effects, breaking change potential, edge cases, and leak verification]

---
**⚖️ Orchestrator Verdict:** **🟢 AUTO-APPROVED** | **🟡 ESCALATED TO HUMAN**
[Reason for verdict, confidence score, and immediate next action]
```
