# Telegram Outbox Queue API

This module manages the asynchronous outbox queue for Telegram notifications. Services such as Series Tracker and CNAP queue pending notifications into the Telegram Outbox Google Sheet, where `api-me` processes and delivers them via the Telegram Bot API.

---

## Architecture

1. **Producer:** Services call `OutboxQueueService.appendMessageToOutbox(message, chatId)` to append rows to the Google Sheet with status `PENDING`.
2. **Consumer:** `OutboxQueueService.processOutboxQueue()` scans the sheet for `PENDING` messages, chunks text (>4000 chars), delivers them to Telegram via `TelegramService`, and marks rows as `SENT` with a timestamp or `ERROR`.
3. **Triggers:**
   - **CLI:** `npm run outbox:process`
   - **HTTP Endpoint:** `POST /outbox/process` or `GET /outbox/process`

---

## Environment Variables

| Variable | Required | Description |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Yes (for sending) | Telegram Bot API token. |
| `TELEGRAM_DEFAULT_CHAT_ID` | Optional | Fallback Telegram Chat ID (defaults to `1252877`). |
| `TELEGRAM_OUTBOX_SPREADSHEET_ID` | Optional | Google Sheet ID (defaults to configured fallback). |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Yes | Service Account Email with access to the Google Sheet. |
| `GOOGLE_PRIVATE_KEY` | Yes | Service Account Private Key. |
| `OUTBOX_SECRET_TOKEN` / `CRON_SECRET` | Optional | If set, required in `x-outbox-secret` header or `?secret=` query param. |

---

## Endpoints

### 1. Process Outbox Queue
Triggers delivery of all `PENDING` messages in the queue.

* **Method:** `POST` or `GET`
* **Path:** `/outbox/process`
* **Headers:**
  * `x-outbox-secret`: `<token>` *(if configured)*

#### Response Example (`200 OK`)
```json
{
  "totalRows": 15,
  "processed": 2,
  "sent": 2,
  "errors": 0,
  "details": [
    {
      "row": 4,
      "chatId": "1252877",
      "status": "SENT"
    },
    {
      "row": 5,
      "chatId": "1252877",
      "status": "SENT"
    }
  ]
}
```

---

## CLI Execution

Run queue processing directly from the terminal or in CI/CD cron jobs:
```bash
npm run outbox:process
```
