# Agent Rules & Instructions

- **No automated test/lint execution on every change**: Do not run tests (`npm run test`, `jest`, etc.) or linter commands (`npm run linter`, `eslint`, etc.) on every change. The user will run validation/tests/lint manually before pushing.
- **No direct writes to env files**: Never write or update `.env` files (including `.env.development.local`, `.env.production.local`, etc.) directly. If there are database connections, config options, or values that should be added or updated in `.env`, ask the user for confirmation and they will do it manually.
- **Typo detection in database tables, fields, or variable names**: If you notice potential typos in database tables, table fields, or variable names, point them out to the user and do not use the values with typos. If you are unsure, ask for clarification.
