# 🛰️ Human Assist Sync API (`/human`) — Production Specification

Документація та приклади запитів/відповідей для синхронізації налаштувань плагіна Human Assist на продакшні.

* **Base URL**: `https://api.vdovareize.me/human`

---

## 🔒 Заголовки безпеки

| Заголовок | Обов'язковий | Опис |
| :--- | :--- | :--- |
| `Origin` | Так | Має відповідати `^https:\/\/([a-zA-Z0-9-]+\.)?human\.ua$`. Інакше: **`403 Forbidden`**. |
| `x-sync-secret` | Так | Секретний ключ розширення (`HUMAN_ASSIST_SYNC_SECRET`). Інакше: **`401 Unauthorized`**. |
| `Content-Type` | Для `POST` | `application/json` |

---

## 1. Отримати дані: `GET /human/:userId`

### cURL:
```bash
curl -i -X GET "https://api.vdovareize.me/human/964486" \
  -H "Origin: https://human.ua" \
  -H "x-sync-secret: <YOUR_SECRET>"
```

### JavaScript (`fetch` у плагіні):
```javascript
const response = await fetch('https://api.vdovareize.me/human/964486', {
  method: 'GET',
  headers: {
    'x-sync-secret': 'YOUR_SECRET',
  },
});

const result = await response.json();
```

### ✅ Відповідь `HTTP 200 OK` (користувач має збережені дані):
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

### ✅ Відповідь `HTTP 200 OK` (новий користувач, запису ще немає):
```json
{
  "userId": "964486",
  "data": {},
  "updatedAt": null
}
```

---

## 2. Зберегти/Оновити дані: `POST /human/:userId`

Виконує `upsert` за ідентифікатором `userId`. Час оновлення (`updatedAt`) генерується сервером.

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

### JavaScript (`fetch` у плагіні):
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

### ✅ Відповідь `HTTP 200 OK`:
```json
{
  "success": true,
  "updatedAt": 1740000000000
}
```

---

## 3. CORS Preflight (`OPTIONS /human/:userId`)

Браузер відправляє цей запит автоматично перед `POST`:

### Запит браузера:
```http
OPTIONS /human/964486 HTTP/1.1
Host: api.vdovareize.me
Origin: https://school12.human.ua
Access-Control-Request-Method: POST
Access-Control-Request-Headers: content-type, x-sync-secret
```

### ✅ Відповідь сервера (`HTTP 204 No Content`):
```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://school12.human.ua
Access-Control-Allow-Methods: GET, HEAD, PUT, PATCH, POST, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, x-sync-secret, Authorization
```

---

## 4. Помилки валідації та безпеки

### ❌ `HTTP 401 Unauthorized`
Відсутній заголовок `x-sync-secret` або передано невірний секрет:
```json
{
  "error": "Unauthorized: Invalid secret"
}
```

### ❌ `HTTP 403 Forbidden`
Запит надійшов не з домену `human.ua` або його піддоменів:
```json
{
  "error": "Forbidden: Origin not allowed"
}
```

### ❌ `HTTP 400 Bad Request`
У тілі `POST` відсутнє обов'язкове поле `data` або `userId` порожній:
```json
{
  "error": "Invalid payload: data object is required"
}
```
