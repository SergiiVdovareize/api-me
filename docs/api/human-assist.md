# 🛰️ Human Assist Sync API (`/human`) — Production Specification

Documentation and request/response specifications for synchronizing Human Assist Chrome extension settings and student statuses across multiple Google accounts in production.

* **Base URL**: `https://api.vdovareize.me/human`

---

## 🔒 Security Headers

| Header | Required | Description |
| :--- | :--- | :--- |
| `Origin` | Yes | Must match `^https:\/\/([a-zA-Z0-9-]+\.)?human\.ua$`. Otherwise: **`403 Forbidden`**. |
| `x-sync-secret` | Yes | Extension secret key (`HUMAN_ASSIST_SYNC_SECRET`). Otherwise: **`401 Unauthorized`**. |
| `Content-Type` | For `POST` | `application/json` |

---

## 1. Retrieve Data: `GET /human/:userId`

### cURL:
```bash
curl -i -X GET "https://api.vdovareize.me/human/964486" \
  -H "Origin: https://human.ua" \
  -H "x-sync-secret: <YOUR_SECRET>"
```

### JavaScript (`fetch` inside extension):
```javascript
const response = await fetch('https://api.vdovareize.me/human/964486', {
  method: 'GET',
  headers: {
    'x-sync-secret': 'YOUR_SECRET',
  },
});

const result = await response.json();
```

### ✅ Response `HTTP 200 OK` (user has existing data):
```json
{
  "userId": "964486",
  "data": {
    "studentStatuses": {
      "1094594": {
        "332145": "abroad",
        "554122": "family"
      }
    },
    "settings": {
      "showStudentStatuses": true,
      "highlightAbsentForInactive": true,
      "highlightMandatoryWorks": true
    }
  },
  "updatedAt": 1740000000000
}
```

### ✅ Response `HTTP 200 OK` (new user, no record in DB yet):
```json
{
  "userId": "964486",
  "data": {},
  "updatedAt": null
}
```

---

## 2. Save / Update Data: `POST /human/:userId`

Performs an `upsert` by `userId`. Server automatically updates `updatedAt` to the current timestamp.

### cURL:
```bash
curl -i -X POST "https://api.vdovareize.me/human/964486" \
  -H "Origin: https://human.ua" \
  -H "Content-Type: application/json" \
  -H "x-sync-secret: <YOUR_SECRET>" \
  -d '{
    "data": {
      "studentStatuses": {
        "1094594": {
          "332145": "abroad",
          "554122": "family"
        }
      },
      "settings": {
        "showStudentStatuses": true,
        "highlightAbsentForInactive": true
      }
    },
    "clientUpdatedAt": 1740000000000
  }'
```

### JavaScript (`fetch` inside extension):
```javascript
const payload = {
  data: {
    studentStatuses: {
      '1094594': {
        '332145': 'abroad',
        '554122': 'family',
      },
    },
    settings: {
      showStudentStatuses: true,
      highlightAbsentForInactive: true,
    },
  },
  clientUpdatedAt: Date.now(),
};

const response = await fetch('https://api.vdovareize.me/human/964486', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-sync-secret': 'YOUR_SECRET',
  },
  body: JSON.stringify(payload),
});

const result = await response.json();
```

### ✅ Response `HTTP 200 OK`:
```json
{
  "success": true,
  "updatedAt": 1740000000000
}
```

---

## 3. CORS Preflight (`OPTIONS /human/:userId`)

The browser sends this request automatically prior to `POST`:

### Browser Request:
```http
OPTIONS /human/964486 HTTP/1.1
Host: api.vdovareize.me
Origin: https://school12.human.ua
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type, x-sync-secret
```

### ✅ Server Response (`HTTP 204 No Content`):
```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://school12.human.ua
Access-Control-Allow-Methods: GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, x-sync-secret, Authorization
```

---

## 4. Validation and Security Errors

### ❌ `HTTP 401 Unauthorized`
Missing `x-sync-secret` header or invalid secret:
```json
{
  "error": "Unauthorized: Invalid secret"
}
```

### ❌ `HTTP 403 Forbidden`
Request origin is not `human.ua` or its subdomains:
```json
{
  "error": "Forbidden: Origin not allowed"
}
```

### ❌ `HTTP 400 Bad Request`
Missing required `data` object in `POST` body or empty `userId`:
```json
{
  "error": "Invalid payload: data object is required"
}
```
