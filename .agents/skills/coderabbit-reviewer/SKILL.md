---
name: coderabbit-reviewer
description: Read CodeRabbitAI PR comments/suggestions and implement them cleanly.
---
# CodeRabbit Reviewer Skill

This skill guides the agent in reading, assessing, and implementing suggestions provided by the CodeRabbitAI bot on GitHub Pull Requests.

## How to Fetch Comments

Agents can fetch comments from a pull request using one of the following methods:
1. **GitHub CLI (Preferred)**: If `gh` is authenticated, run:
   ```bash
   gh pr view <pr-number-or-url> --comments
   ```
2. **GitHub API**: If a `GITHUB_TOKEN` is available in the environment, use `curl` to fetch PR review comments:
   ```bash
   curl -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/repos/<owner>/<repo>/pulls/<pr-number>/comments
   ```
3. **User Input**: Ask the user to copy-paste the CodeRabbit comments directly into the chat.

## Instructions

Whenever the user provides a PR number/URL, review feedback, or copy-pastes comments from CodeRabbitAI:

### 1. Parse and Assess the Feedback
- Carefully read the suggestion or code snippet provided by CodeRabbitAI.
- **Critical Evaluation**: Do not blindly implement CodeRabbit suggestions. Verify that:
  - The suggestion aligns with the project's architecture and existing patterns.
  - The suggestion follows the core project rules (e.g. database schema structure, no direct writes to `.env` files, typo checking).
  - The suggested change does not introduce security vulnerabilities or performance degradation.
  - It does not conflict with user-specified design decisions (e.g., custom TypeScript validation over third-party libraries).

### 2. Formulate an Implementation Plan
- If the suggested change is complex, outline the steps in the conversation or update the implementation plan.
- Identify the files that need modification and detail how the code will change.

### 3. Apply the Changes
- Use the code modification tools (`replace_file_content` or `multi_replace_file_content`) to apply the approved changes.
- Ensure all comments and documentation unrelated to the change are preserved.

### 4. Compilation and Test Verification
- Run `npx tsc --noEmit` to ensure the changes compile with zero TypeScript errors.
- Run unit tests (`npm run test`) and/or E2E tests (`npm run test:e2e`) to verify that the changes do not break existing features.

### 5. Log Technical Debt
- If the changes introduce new logic (controllers, services, helpers) that are not covered by tests, log them to `.agents/TEST_DEBT.md` using the `test-debt-logger` skill.
