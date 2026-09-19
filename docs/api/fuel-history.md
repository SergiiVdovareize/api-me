# ⛽ Fuel Price History API (`/fuel/history`)

Endpoint for retrieving historical weighted-average retail fuel prices in Ukraine for a period of **up to 30 days inclusive**.

Data is aggregated and scraped from [Minfin (Fuel)](https://index.minfin.com.ua/ua/markets/fuel/).

---

## 📡 Endpoint Overview

* **HTTP Method**: `GET`
* **Path**: `/fuel/history`
* **Base URLs**:
  * Local: `http://localhost:3000`
  * Production: `https://api.vdovareize.me`

---

## ⚡ Caching (Upstash Redis)

The endpoint integrates with the **Upstash Redis** rotator (`RedisReader`):
* Responses for requested date ranges (`fuel-history-${startDate}-${endDate}`) and daily prices (`fuel-prices-${date}`) are stored in Redis with a TTL of `DEFAULT_TTL` (28 hours).
* Requests for past completed periods and published current-day prices are served instantly from cache without re-fetching or re-parsing Minfin HTML.
* In the event of a Redis network or configuration failure, the service gracefully falls back to fetching fresh data from Minfin without throwing an error to the client.

---

## 📥 Query Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `endDate` | `string` (`YYYY-MM-DD`) | No | Current date (`Europe/Kyiv`) | End date of the period. Cannot be in the future. |
| `days` | `integer` (`1..30`) | No | `30` | Number of days of history to retrieve. |
| `startDate` | `string` (`YYYY-MM-DD`) | No | `endDate - (days - 1)` | Start date of the period (alternative to `days`). |

> ⚠️ **Validation Rules & Constraints (HTTP 400 Bad Request)**:
> 1. `days`: must be an integer between `1` and `30`.
> 2. `startDate`: cannot be after `endDate`.
> 3. **Interval**: the difference `endDate - startDate` cannot exceed **30 days**.
> 4. Dates must follow the `YYYY-MM-DD` format and represent a valid calendar day.
> 5. Dates cannot be in the future or earlier than **June 2015** (`2015-06-01`, start of the Minfin archive).

---

## 📤 Response Schema

```typescript
interface FuelPrices {
  a95Premium?: number;   // A-95+ (UAH/l)
  a95?: number;          // A-95 (UAH/l)
  a92?: number;          // A-92 (UAH/l)
  diesel?: number;       // Diesel (UAH/l)
  dieselPremium?: number;// Diesel+ (UAH/l)
  gas?: number;          // Auto gas (UAH/l)
}

interface FuelHistoryItem {
  date: string;          // Date in YYYY-MM-DD format
  prices: FuelPrices;    // Fuel prices for that day
  delta?: FuelPrices;    // Price change compared to the previous recorded day (UAH/l)
}

interface FuelHistoryResponse {
  startDate: string;     // Period start date (YYYY-MM-DD)
  endDate: string;       // Period end date (YYYY-MM-DD)
  days: number;          // Total calendar days duration
  currency: string;      // Currency (always "UAH")
  unit: string;          // Price unit (always "грн/л")
  items: FuelHistoryItem[]; // Array of daily price records sorted chronologically ascending
  source: string;        // Source data URL
}
```

> ℹ️ **Note**: Minfin only records prices on trading/working days (weekends usually do not introduce new rows in the source table). The `items` array contains only dates for which official entries exist. The `delta` field represents `price_current - price_previous` relative to the preceding recorded day.

---

## 💡 Request Examples

### 1. Default request (last 30 days up to today)
```bash
curl -X GET "https://api.vdovareize.me/fuel/history"
```

### 2. Request for the last 7 days
```bash
curl -X GET "https://api.vdovareize.me/fuel/history?days=7"
```

### 3. Request with specific end date and number of days
```bash
curl -X GET "https://api.vdovareize.me/fuel/history?endDate=2026-09-18&days=14"
```

### 4. Explicit date range (`startDate` and `endDate`)
```bash
curl -X GET "https://api.vdovareize.me/fuel/history?startDate=2026-09-01&endDate=2026-09-15"
```

---

## 📋 Success Response Example (`200 OK`)

```json
{
  "startDate": "2026-08-21",
  "endDate": "2026-09-19",
  "days": 30,
  "currency": "UAH",
  "unit": "грн/л",
  "items": [
    {
      "date": "2026-08-21",
      "prices": {
        "a95Premium": 84.03,
        "a95": 80.32,
        "a92": 76.87,
        "diesel": 91.41,
        "gas": 43.06
      },
      "delta": {
        "a95Premium": 0.18,
        "a95": 0.25,
        "a92": -0.03,
        "diesel": -0.12,
        "gas": -0.01
      }
    },
    {
      "date": "2026-09-04",
      "prices": {
        "a95Premium": 85.17,
        "a95": 82.00,
        "a92": 77.86,
        "diesel": 92.40,
        "gas": 43.38
      },
      "delta": {
        "a95Premium": 1.14,
        "a95": 1.68,
        "a92": 0.99,
        "diesel": 0.99,
        "gas": 0.32
      }
    }
  ],
  "source": "https://index.minfin.com.ua/ua/markets/fuel/"
}
```

---

## ❌ Validation Error Examples (`400 Bad Request`)

| Scenario | Example Request | Response Body |
| :--- | :--- | :--- |
| `days > 30` | `/fuel/history?days=35` | `{"statusCode": 400, "message": "days must be an integer between 1 and 30", "error": "Bad Request"}` |
| `days < 1` or non-integer | `/fuel/history?days=0` | `{"statusCode": 400, "message": "days must be an integer between 1 and 30", "error": "Bad Request"}` |
| Interval > 30 days | `/fuel/history?startDate=2026-08-01&endDate=2026-09-15` | `{"statusCode": 400, "message": "Date interval (endDate - startDate) cannot exceed 30 days", "error": "Bad Request"}` |
| `startDate > endDate` | `/fuel/history?startDate=2026-09-19&endDate=2026-09-01` | `{"statusCode": 400, "message": "startDate cannot be after endDate", "error": "Bad Request"}` |
| Invalid date format | `/fuel/history?startDate=2026/09/01` | `{"statusCode": 400, "message": "startDate must be in YYYY-MM-DD format (e.g. 2026-09-13)", "error": "Bad Request"}` |
| Future date | `/fuel/history?endDate=2099-01-01` | `{"statusCode": 400, "message": "Date cannot be in the future. Today is 2026-09-19", "error": "Bad Request"}` |
| Date before June 2015 | `/fuel/history?startDate=2014-12-01` | `{"statusCode": 400, "message": "Fuel price archive is available starting from June 2015 (2015-06-01)", "error": "Bad Request"}` |
