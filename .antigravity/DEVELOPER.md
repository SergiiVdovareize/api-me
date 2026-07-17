# Developer Agent Instructions: `api-me`

This file defines how the AI developer agent must behave when working on this project.
These rules take priority over any general defaults or assumptions.

---

## 1. Before Writing Any Code

- If any implementation detail is unclear or ambiguous — **stop and ask** before writing a single line.
- If the user's message contains a typo in a variable name, constant, file name, or identifier — **point it out and ask for confirmation** before using it. Never silently propagate a typo into code.
- If there is not enough context to proceed (missing file content, unknown interface, unclear requirement) — **ask for the missing information**. Do not attempt to read files or explore directories outside the project root to fill the gap.
- Only start implementing once you have enough confidence that the approach is correct.

---

## 2. Scope & File Access

- You may only read and modify files within the **project root directory**.
- Do **not** explore, read, or infer from files outside the project root (system files, parent directories, other projects).
- If you need to understand something that would require reading an external path — ask the user to provide the relevant content directly.

---

## 3. Code Style

All generated code must follow these rules without exception:

- **TypeScript strict mode** — never use `any`. Use `unknown` with a type guard if the shape is truly unknown, or ask the user for the correct type.
- **Explicit return types** on all functions and methods, including callbacks where the type is non-obvious.
- **Early returns** over nested conditionals. Flatten control flow; avoid deeply nested `if/else` blocks.
- **Small, focused functions** — each function does one thing. If a function is growing, split it.
- **No mutation** of function parameters or external state unless it is the explicit purpose of the function.
- **No dead code** — do not leave unused variables, imports, or commented-out blocks behind.
- **Consistent naming** — follow the naming conventions already present in the file you're editing. If unsure, ask.

---

## 4. Testing

- **Never run tests automatically.** The developer runs tests manually when ready.
- You may write or update test files when asked.
- When writing tests, follow existing patterns in `test/` and co-located `*.spec.ts` files.
- Do not modify test configuration files (`jest.config.*`, `tsconfig` test overrides) without being explicitly asked.

---

## 5. Git & Version Control

- **Never commit autonomously.**
- When a task is complete and a commit makes sense, propose a commit message and **wait for explicit approval** before running `git commit`.
- Suggested commit messages should follow the format already used in the repo (check recent `git log` if visible, otherwise use conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`).
- Never `push`, `rebase`, `reset`, or modify git history without explicit instruction.
- Never stage or touch unrelated files as part of a task.

---

## 6. Making Changes

- **One concern per change.** Don't refactor unrelated code while implementing a feature, and don't add features while fixing a bug — unless explicitly asked.
- Before modifying an existing function or module, briefly describe what you're about to change and why, then wait for a go-ahead if the change is non-trivial.
- When adding a new module, service, or controller, follow the NestJS structure already established in the project (see `PROJECT_CONTEXT.md`).
- Do not install new npm packages without asking first. Propose the package, explain why it's needed, and wait for approval.

---

## 7. Communication Style

- Be direct and concise. Don't over-explain obvious things.
- When you spot something questionable in existing code (a potential bug, a naming inconsistency, a missing error handler) — mention it briefly as a side note, but don't fix it unless asked.
- If you make an assumption despite uncertainty, state it explicitly: _"I'm assuming X — let me know if that's wrong."_
- Never silently change something and hope it goes unnoticed. Surface every non-trivial decision.

---

## 8. Logging

- Never use `console.log` in production code.
- Use `Logger` from `@nestjs/common` for all logging. Instantiate it per class: `private readonly logger = new Logger(MyService.name)`.

---

## 9. Environment & Configuration

- Never hardcode environment-specific values (URLs, tokens, ports, timeouts, feature flags) directly in source files.
- Always use `ConfigService` to read values from environment variables.
- Do **not** modify any config files (`.env`, `nest-cli.json`, `tsconfig*.json`, `jest.config.*`, etc.) unless the task explicitly requires it. If a config change is needed, describe the reason and the exact change, and wait for approval before touching the file.

---

## 10. Database & Prisma

- Do **not** touch `prisma/schema.prisma` or write any database migration.
- If a task genuinely requires a schema change, stop — describe what change is needed and why, and wait for explicit approval. The developer will apply and run the migration.
- This applies to seed files and any other Prisma CLI operations as well.

---

## 11. Code Reuse

- Before writing a new utility or helper function, check `src/common/` for an existing one that covers the need.
- If something close exists but doesn't quite fit, mention it and ask whether to extend it or create a new one.

---

## 12. Error Handling

- When throwing errors from controllers, always use NestJS built-in HTTP exceptions: `NotFoundException`, `BadRequestException`, `UnauthorizedException`, `ForbiddenException`, etc.
- Never return raw error objects or custom error shapes from controllers — this breaks consistent API error formatting.

---

## 13. Task Completion Checklist

After finishing any task, always provide a brief summary:

- **Files changed** — list every file that was created or modified.
- **Decisions made** — any assumption or non-obvious choice that was made during implementation.
- **Follow-ups needed** — anything the developer must do manually: run a migration, add an env var, register a module, run tests, etc.
