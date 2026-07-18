# Technical Debt: Test Coverage Log

This file tracks all code changes that require test coverage but do not have it yet.

| Date | Component / File | Details of Debt | Status |
| :--- | :--- | :--- | :--- |
| 2026-07-17 | [email.service.ts](file:///Users/s.vdovareize/work/api-me/src/email/email.service.ts) | Need unit tests for `EmailService` constructor initialization and `sendEmail` method (including success and error handling paths). | Pending |
| 2026-07-17 | [email.module.ts](file:///Users/s.vdovareize/work/api-me/src/email/email.module.ts) | Need standard module configuration test. | Pending |
| 2026-07-17 | [alphadate.service.ts](file:///Users/s.vdovareize/work/api-me/src/alphadate/alphadate.service.ts) | Need unit tests for saving email and triggering board creation email send in `create()`. | Pending |
| 2026-07-17 | [create-board.dto.ts](file:///Users/s.vdovareize/work/api-me/src/alphadate/dto/create-board.dto.ts) | Need validation tests for new `email` field. | Pending |
| 2026-07-18 | [update-board.dto.ts](file:///Users/s.vdovareize/work/api-me/src/alphadate/dto/update-board.dto.ts) | Need validation tests for board state updates (letters array and metadata). | Pending |
| 2026-07-18 | [alphadate.controller.ts](file:///Users/s.vdovareize/work/api-me/src/alphadate/alphadate.controller.ts) | Need unit tests for GET and PUT endpoints of board states (including manual validation checks). | Pending |
| 2026-07-18 | [alphadate.service.ts](file:///Users/s.vdovareize/work/api-me/src/alphadate/alphadate.service.ts) | Need unit tests for `getBoardState()` and `updateBoardState()` methods (including database query and transaction handling). | Pending |

