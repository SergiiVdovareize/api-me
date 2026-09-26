# 💖 AlphaDate Board API (`/alphadate`)

API for creating, managing, and synchronizing shared romantic alphabet date boards (**AlphaDate** / Алфавіт побачень). Couples use the board to pick letters of the alphabet, track whose turn it is to plan a date, record countdowns, and leave notes on date ideas.

---

## 📡 Base URLs & Endpoints Overview

* **Base URLs**:
  * Local: `http://localhost:3000`
  * Production: `https://api.vdovareize.me`

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/alphadate` | Create a new date board and invite partners via email |
| `GET` | `/alphadate/:key/suggestions` | Generate AI date ideas for a specific board and letter (`?letter=А`) |
| `GET` | `/alphadate/:key` | Retrieve the current board state, letters, and metadata |
| `PUT` | `/alphadate/:key` | Update board state (letters, active letter, turn, partners, PIN) |
| `DELETE` | `/alphadate/:key` | Delete a board by its unique key |

---

## 📋 Endpoints

### 1. Create Board (`POST /alphadate`)

Creates a new board, initializes partner turn orders, randomly designates the starting partner, and sends a welcome link to the provided email.

#### Request Body
```json
{
  "partners": ["Олена", "Андрій"],
  "email": "couple@example.com"
}
```

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `partners` | `string[]` | Yes | Array of partner names (at least 1 non-empty name). |
| `email` | `string` | Yes | Valid email address for board recovery and welcome link. |

#### Response (`201 Created`)
```json
{
  "success": true,
  "key": "x9a2k"
}
```

---

### 2. Get Date Suggestions (`GET /alphadate/:key/suggestions`)

Generates creative romantic date ideas starting with a required single-character letter of the alphabet for a specific board using the AI LLM rotator. Also accessible via `GET /alphadate/:key/suggestions/:letter`.

> [!NOTE]
> **Board Validation**: The endpoint verifies the existence of the board `key`. If the board does not exist or is invalid, it returns `403 Forbidden` (`Access denied: board not found or invalid`).
>
> **Automatic Language Detection**: The endpoint automatically detects which alphabet the letter belongs to:
> - **Latin letters** (`A-Z`): Returns suggestions in **English** (`lang: "en"`).
> - **Cyrillic letters** (`А-Я`, `І`, `Ї`, `Є`, `Ґ`): Returns suggestions in **Ukrainian** (`lang: "uk"`).
> 
> **Board-level Caching**: Results are cached in Upstash Redis for **1 hour** (`TTL = 3600s`) per board, letter, and detected language (`alphadate:suggestions:{BOARD_KEY}:{LETTER}:{LANG}`). Repeat calls within the hour for that board are served instantly (sub-200ms) without consuming AI LLM quota.

#### URL Parameters
* `key` (`string`, **Required**): Unique 5-character board key (e.g. `x9a2k`).

#### Query Parameters
* `letter` (`string`, **Required**): Single character representing the target letter (e.g. `А`, `Б`, `A`, `B`).

#### Example Request
```bash
curl "https://api.vdovareize.me/alphadate/x9a2k/suggestions?letter=B"
# or via path param:
curl "https://api.vdovareize.me/alphadate/x9a2k/suggestions/B"
```

#### Response (`200 OK`)
```json
{
  "success": true,
  "letter": "B",
  "lang": "en",
  "suggestions": [
    {
      "title": "Bakery",
      "description": "Explore a cozy, artisanal bakery together, sampling fresh pastries and sourdough bread.",
      "category": "food",
      "estimatedCost": "moderate"
    },
    {
      "title": "Bowling",
      "description": "Playful and lively bowling evening with friendly competition and pizza.",
      "category": "active",
      "estimatedCost": "moderate"
    }
  ]
}
```

---

### 3. Get Board State (`GET /alphadate/:key`)

Retrieves the current state of a board by its unique 5-character key.

#### URL Parameters
* `key` (`string`): Unique board identifier (e.g. `x9a2k`).

#### Response (`200 OK`)
```json
{
  "success": true,
  "letters": [
    {
      "letter": "А",
      "status": "available",
      "note": "Політ на повітряній кулі"
    },
    {
      "letter": "Б",
      "status": "used",
      "note": "Боулінг та піца"
    },
    {
      "letter": "В",
      "status": "skipped"
    }
  ],
  "history": [
    {
      "letter": "Б",
      "partnerId": 1,
      "partnerName": "Олена",
      "playerId": 2,
      "status": "used",
      "note": "Боулінг та піца",
      "selectedAt": "2026-09-18T18:00:00.000Z",
      "completedAt": "2026-09-20T11:30:00.000Z"
    }
  ],
  "metadata": {
    "partners": [
      { "id": 1, "name": "Олена", "playerId": 2 },
      { "id": 2, "name": "Андрій", "playerId": 1 }
    ],
    "currentPartnerId": 2,
    "currentPartnerPlayerId": 1,
    "currentLetter": "А",
    "currentLetterSelectedAt": "2026-09-20T10:00:00.000Z",
    "pinHash": null
  }
}
```

#### Letter Statuses
* `available`: Ready to be selected for a date.
* `used`: Successfully completed date (automatically assigned to the partner whose turn it was in `history`).
* `skipped`: Skipped for now (not assigned to partner history).
* `excluded`: Removed from the current game cycle (not assigned to partner history).

#### History Fields
* `letter`: The completed letter.
* `partnerId`: ID of the partner who completed the date.
* `partnerName`: Name of the partner.
* `playerId`: Board-scoped unique player ID of the partner who completed the date (odd for males, even for females, null if unclassified).
* `status`: Always `"used"`.
* `note`: Optional comment/description of the date.
* `selectedAt`: Timestamp when the letter was originally picked.
* `completedAt`: Timestamp when the date was completed.

#### Metadata Fields
* `partners`: List of partners with:
  * `id`: Internal partner ID.
  * `name`: Partner name.
  * `playerId`: Board-scoped unique player ID serving as a hidden gender marker (males receive odd numbers `1, 3, 5...`, females receive even numbers `2, 4, 6...`, unclassified names receive `null`). Used for partner color coding on frontend.
* `currentPartnerId`: ID of the partner whose turn it is to plan the date.
* `currentPartnerPlayerId`: Player ID of the currently active partner (`1, 2, 3...` or `null`).
* `currentLetter`: Currently active single-character letter, or `null`.
* `currentLetterSelectedAt`: ISO timestamp when `currentLetter` was selected (used for countdowns).
* `pinHash`: Hashed PIN code if protection is configured, otherwise `null`.

---

### 3. Update Board State (`PUT /alphadate/:key`)

Updates letters, active selected letter, notes, partners, or security settings.

#### Request Body
```json
{
  "letters": [
    {
      "letter": "А",
      "status": "used",
      "note": "Астрономічна обсерваторія під зорями"
    },
    {
      "letter": "Б",
      "status": "available"
    }
  ],
  "currentLetter": "Б",
  "metadata": {
    "partners": ["Олена", "Андрій"],
    "pinHash": "optional-hashed-pin"
  }
}
```

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `letters` | `LetterState[]` | Yes | Array of letter objects containing `letter`, `status`, optional `note`, and optional `selectedAt` / `completedAt` overrides. |
| `currentLetter` | `string \| null` | No | Active single-character letter. If changed to a letter, `currentLetterSelectedAt` is set to `now()`. If `null`, selection timestamp resets. |
| `metadata.partners` | `string[]` | No | Updated array of partner names. |
| `metadata.pinHash` | `string \| null` | No | Updated PIN hash or `null` to clear. |

#### Automatic Business Rules & Time Tracking
1. **Turn Rotation**: When any letter transitions from non-used to `used`, the turn automatically advances to the next partner in sequence (`(current + 1) % length`).
2. **Time Tracking & History**:
   - When a letter is set as `currentLetter`, `currentLetterSelectedAt` is recorded.
   - When that letter transitions to `used`, a history entry is saved with:
     - `selectedAt`: Start timestamp (when the letter was chosen).
     - `completedAt`: End timestamp (when the date was finished).
     - `partnerId` / `partnerName` / `playerId`: The partner responsible for this date.
   - **Frontend UI calculations**:
     - **Letter Duration**: `new Date(completedAt).getTime() - new Date(selectedAt).getTime()`.
     - **Active Countdown / Timer**: `Date.now() - new Date(currentLetterSelectedAt).getTime()`.
     - **Partner Stats**: Group `history` by `partnerId` to calculate total time spent by each partner, average completion time, and date count.
3. **Full Reset**: If all letters are reset to `available`, a starting partner is randomly chosen and history is cleared.
4. **Partner Synchronization**: Adding, editing, or deleting partner names preserves turn continuity.

#### Response (`200 OK`)
```json
{
  "success": true,
  "currentPartnerId": 2,
  "currentPartnerPlayerId": 1,
  "partners": [
    { "id": 1, "name": "Олена", "playerId": 2 },
    { "id": 2, "name": "Андрій", "playerId": 1 }
  ],
  "currentLetterSelectedAt": "2026-09-20T12:20:00.000Z"
}
```

---

### 4. Delete Board (`DELETE /alphadate/:key`)

Permanently deletes a board, its partners, and associated history.

#### Response (`200 OK`)
```json
{
  "success": true
}
```

---

## ⚠️ Error Responses

| Status Code | Reason | Example Response |
| :--- | :--- | :--- |
| `400 Bad Request` | Malformed JSON, invalid letter status, multi-character `letter` | `{"statusCode": 400, "message": "Query parameter \"letter\" is required"}` |
| `403 Forbidden` | Board not found or access denied for suggestions | `{"statusCode": 403, "message": "Access denied: board not found or invalid"}` |
| `404 Not Found` | Board key does not exist | `{"statusCode": 404, "message": "Board with key abcde not found"}` |
| `409 Conflict` | Unique key generation collision | `{"statusCode": 409, "message": "Could not generate a unique key after multiple attempts"}` |
| `429 Too Many Requests` | AI service rate limits reached | `{"statusCode": 429, "message": "AI service rate limit exceeded. Please wait a few moments and try again."}` |
| `503 Service Unavailable` | AI service temporary timeout or unavailability | `{"statusCode": 503, "message": "Failed to get a response from AI service due to rate limits or temporary unavailability. Please try again later."}` |

---

## 💡 Example Workflows

### 1. Picking a Letter & Starting Countdown
```bash
curl -X PUT "https://api.vdovareize.me/alphadate/x9a2k" \
  -H "Content-Type: application/json" \
  -d '{
    "letters": [
      { "letter": "А", "status": "available", "note": "Плануємо поїздку" }
    ],
    "currentLetter": "А"
  }'
```

### 2. Completing Date (Advances Turn to Next Partner)
```bash
curl -X PUT "https://api.vdovareize.me/alphadate/x9a2k" \
  -H "Content-Type: application/json" \
  -d '{
    "letters": [
      { "letter": "А", "status": "used", "note": "Чудовий вечір у планетарії!" }
    ],
    "currentLetter": null
  }'
```
