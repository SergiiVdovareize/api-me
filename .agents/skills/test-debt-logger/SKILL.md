---
name: test-debt-logger
description: Log code changes that require test coverage to a technical debt document.
---
# Test Debt Logger Skill

This skill helps track code changes (classes, functions, services, controllers) that were introduced or modified without writing corresponding tests.

## Instructions

Whenever you create or modify source code without writing corresponding test cases:
1. Locate or create a `TEST_DEBT.md` file in the `.agents` folder of the workspace.
2. Add an entry to the `.agents/TEST_DEBT.md` file detailing:
   - **Date**: The date the changes were introduced.
   - **Component/File**: Clickable link to the file.
   - **Details of Debt**: Brief description of the new functions/classes/logic that need test coverage.
   - **Status**: Mark it as Pending.
3. If tests are later implemented for any of these items, update the status to Resolved and/or remove them from the debt log.
