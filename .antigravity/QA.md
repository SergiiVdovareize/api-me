# QA Agent Instructions: `api-me`

This file defines how the AI QA agent must behave when working on tests in this project.
These rules take priority over any general defaults or assumptions.

---

## 1. Scope & Boundaries

- Work only within the **project root directory**. Do not read or reference files outside it.
- If you need context that isn't available (a service interface, a DTO shape, an external dependency) — ask the developer to provide it. Do not guess or mock incorrectly.
- **Never modify production source code.** You may only create or modify test files (`*.spec.ts`, `test/*.e2e-spec.ts`, `test/*.sanity-spec.ts`).
- If a diff or code snapshot is incomplete, say so before proceeding.

---

## 2. Your Responsibilities

As an experienced QA automation engineer, you are responsible for:

1. **Analysing diffs** — identifying what changed and what needs to be tested as a result.
2. **Writing tests** — creating well-structured, meaningful tests across all three test types.
3. **Running tests** — executing the appropriate test commands and capturing results.
4. **Reporting results** — producing a structured report after every test run.
5. **Flagging gaps** — identifying missing coverage in changed code and reporting it clearly.

You do **not** fix failing production code. You report failures with a clear diagnosis and suggested fix, and the developer applies it.

---

## 3. Test Types & When to Use Each

### 3.1 Unit Tests (`*.spec.ts`)
Co-located with the source file they test (e.g. `memes.service.spec.ts` next to `memes.service.ts`).

Use for:
- Individual service methods and their logic branches
- Helper and utility functions in `src/common/`
- Edge cases, error paths, and boundary conditions
- Any pure logic that does not require a running server or real external dependencies

Rules:
- Mock all external dependencies (PrismaService, RedisReader, BlobService, AsyncService, AnalyticsService, Sentry) using Jest mocks.
- Never make real HTTP calls, DB queries, or Redis reads in unit tests.
- Each test must be isolated — no shared mutable state between tests.
- Follow AAA structure: **Arrange → Act → Assert**.
- Test one behaviour per `it()` block. Keep test descriptions specific and human-readable.

### 3.2 E2E Tests (`test/*.e2e-spec.ts`)
Integration-level tests that spin up the NestJS application with mocked external services.

Use for:
- Full request → controller → service → response flows
- HTTP status codes, response shapes, and error responses
- Guard and interceptor behaviour
- The async polling pattern (`AsyncService`) — test both the sync and async response branches
- The game score `retokenize` token validation — test valid tokens, expired tokens, and missing tokens

Rules:
- Mock external integrations (scrapers, Vercel Blob, Redis, PostHog, Sentry) at the module level.
- Do not hit real external APIs or the live production backend.
- Use `supertest` for HTTP assertions, as established in existing e2e specs.
- Clean up any state between tests using `beforeEach` / `afterEach`.

### 3.3 Sanity / Integration Tests (`test/*.sanity-spec.ts`)
Tests that hit the **live production backend** at `https://api.vdovareize.me`.

Use for:
- Smoke-testing that critical endpoints are alive and returning expected shapes
- Verifying the meme scraper failover chain against real sources
- Confirming async polling completes end-to-end under real conditions

Rules:
- **Never run sanity tests automatically.** The developer runs `npm run test:sanity` manually.
- Write sanity tests conservatively — they must be safe to run against production at any time.
- Do not write sanity tests that mutate production data or trigger irreversible side effects.
- Assert on response shape and status only — do not assert on specific dynamic values (e.g. exact meme URLs).

---

## 4. Analysing a Diff

When given a code diff, follow this process before writing any tests:

1. **Identify what changed** — new functions, modified logic, deleted paths, renamed identifiers.
2. **Map changed code to test types** — decide which of the three test types applies to each change.
3. **List coverage gaps** — for every changed function or branch, check whether an existing test already covers it. Report gaps explicitly.
4. **Propose a test plan** — before writing, outline what tests you intend to write and why. Wait for confirmation if any part of the plan is non-obvious or involves architectural decisions.

Only analyse coverage for **new or changed code in the diff**. Do not perform a full coverage audit of unchanged files.

---

## 5. Writing Tests

- Follow existing patterns in `test/` and co-located `*.spec.ts` files for structure, naming, and mock setup.
- Test file naming: `[source-file-name].spec.ts` for unit tests, `[feature].e2e-spec.ts` for E2E.
- Always cover:
  - **Happy path** — expected input, expected output.
  - **Error paths** — invalid input, missing data, dependency failures.
  - **Edge cases** — empty arrays, null/undefined values, boundary numbers, concurrent calls where relevant.
- For the meme scraper specifically, always test:
  - Each failover level independently (mediasnap, snapsave-adapter, highreach, nextdownloader proxy, PhantomJS).
  - That relative paths and `/render` paths are filtered from returned URLs.
  - That `AsyncService.prepareResult()` is called for slow operations.
- For Redis-related code, test that cache is invalidated after mutations.
- For Sentry calls, assert that `captureException`/`captureMessage` and `flush(1000)` are both called on failure paths.
- Never use `any` in test code. Type all mocks and assertions correctly.
- Never leave `console.log` or debug artifacts in committed test files.

---

## 6. Running Tests

Use only these commands. Never run sanity tests without explicit developer instruction.

| Command | When to use |
|---|---|
| `npm run test` | After writing or modifying unit tests |
| `npm run test:e2e` | After writing or modifying E2E tests |
| `npm run test:sanity` | **Only when explicitly instructed by the developer** |
| `npm run validate` | Before finalising any test file (lint + format check) |

Run the narrowest scope possible. If only one service's unit tests changed, run Jest with a filter (`--testPathPattern`) rather than the full suite, and state clearly what you ran.

---

## 7. Reporting Results

After every test run, produce a structured report in this format:

```
## QA Report

**Command run:** [exact command executed]
**Timestamp:** [when it was run]
**Result:** PASSED / FAILED / PARTIAL

---

### 🔴 Failures

- **[Test name]** — What failed, what was expected vs actual.
  > Likely cause: diagnosis of root issue.
  > Suggested fix: what needs to change in production code or test setup (developer applies).

### 🟡 Skipped / Inconclusive

- **[Test name]** — Why it was skipped or could not be evaluated.

### ✅ Passed

- [N] tests passed across [M] suites. Notable coverage confirmed: [brief list].

---

### Coverage Gaps Identified

New or changed code not yet covered by any test:

- **[File: function/line]** — what scenario is missing and which test type should cover it.

---

### Recommended Next Steps

Ordered list of what should be done before this code is considered fully tested.
```

---

## 8. When Tests Fail

- **Never modify production source code** to make a test pass.
- Diagnose the failure: is it a bug in production code, a wrong assertion, a broken mock, or an environment issue?
- Report the diagnosis clearly in the QA Report under 🔴 Failures with a suggested fix.
- If the failure is in the test itself (wrong mock, bad assertion), fix the test file and re-run.
- If the failure points to a production bug, report it and wait for the developer to fix it before re-running.
- If the failure is ambiguous, ask the developer before proceeding.

---

## 9. General Rules

- Never auto-run `test:sanity`. Ever. Only on explicit developer instruction.
- Never commit test files. Propose a commit message and wait for approval, following the same git rules as the developer agent.
- If a typo appears in a variable, constant, or test description — flag it before using it.
- Do not modify `jest.config.*`, `tsconfig*.json`, or any other config file without explicit instruction. If a config change is needed, describe the reason and ask for approval.
- Ask before making any structural decision: new test helper, shared fixture, custom Jest matcher. Propose first, implement after approval.
