---
name: task-refiner
description: Automatically refine and structure GitHub issue titles and descriptions in English before implementation, appending a standardized AI refinement footnote.
---
# Task Refiner Skill (Pre-Flight Issue Enhancement)

This skill guides the agent in analyzing raw or hastily written task descriptions (which may be written informally or in Ukrainian/other languages), structuring them into a professional, clear English specification, and updating the issue directly on GitHub.

## When to Use
- **Board Workflow:** Automatically invoked by `board-worker` immediately after picking a task from `Todo` and before consensus deliberation.
- **Standalone:** Whenever a developer asks to polish, clarify, or refine an existing GitHub task/issue.

---

## Refinement Guidelines

1. **Language:**
   - Always translate and format into **clear, concise English**, regardless of the language used in the original task draft.
2. **Title Format:**
   - Use conventional commit style prefixes when applicable: `feat(...)`, `fix(...)`, `refactor(...)`, `docs(...)`, etc.
   - Keep titles descriptive and under 80 characters.
3. **Preserving Automated / Sentry Templates (CRITICAL):**
   - If an issue was created automatically (e.g., Sentry sync issues containing `## Sentry Issue [ID: ...]`, `Culprit:`, `Sentry URL:`, `Error Details`), **DO NOT delete or overwrite** the existing automated content.
   - The diagnostic data, links, event counts, and culprits must remain permanently accessible at the top of the issue.
   - **APPEND** the refined specification (`## Overview`, `## Objectives`, `## Acceptance Criteria`, etc.) **BELOW** the original automated content, separated by a horizontal divider (`---`).
   - For regular human-written tasks without existing automated structures: standard full refinement replaces the informal text.
4. **Body Structure:**
   A refined specification section should be structured with markdown headings:
   - **`## Overview`**: 1-3 sentences stating the user problem, feature goal, or context clearly.
   - **`## Objectives`**: Bulleted list of concrete deliverables and technical scope.
   - **`## Acceptance Criteria`**: Checkbox list (`- [ ] ...`) defining testable success conditions.
   - **`## Technical Notes`** *(optional)*: Stack details, architectural notes, or links.
5. **Mandatory Footnote:**
   Every refined issue description **MUST** conclude with the exact separator and attribution note:
   ```markdown
   ---
   *Task title and description refined with AI.*
   ```
6. **Data Protection:**
   - Run `comment-sanitizer` audit on the generated body:
     - Never expose secrets, auth tokens, passwords, or PII.
     - Replace any absolute paths with repository-relative paths (`src/...`, `.agents/...`).

---

## Workflow Steps

### 1. Fetch Existing Task
```bash
gh issue view <ISSUE_NUMBER> --json title,body,number
```

### 2. Formulate Refined Title & Body
- **Check for Pre-Existing Structure:**
  - If the body contains automated templates (e.g. `## Sentry Issue`, `Created automatically by Sentry Issue Sync`):
    - Retain the entire original text intact.
    - Append `---`, followed by the refined sections (`## Overview`, `## Objectives`, `## Acceptance Criteria`).
  - If the task is a human draft: formulate the refined body directly.
- Preserve all essential constraints, business intent, and technical details from the author.
- Eliminate ambiguity, informal phrasing, and chaotic formatting.
- Append the attribution footnote.

### 3. Update the GitHub Issue
Execute `gh issue edit`:
```bash
gh issue edit <ISSUE_NUMBER> --title "<REFINED_TITLE>" --body "<REFINED_BODY>"
```
