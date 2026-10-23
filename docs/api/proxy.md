# 🌐 Upstream Video Proxy API (`/proxy`)

Proxy endpoint designed for Smart TV (TizenFlix) and web clients to resolve video player pages and streams that require specific headers (`Referer`, `User-Agent`) where client-side environments (such as `file:///index.html`) cannot set unsafe headers directly.

* **Base URL**: `https://api.vdovareize.me/proxy` (also supports `/api/proxy`)

---

## 📡 Endpoint Overview

* **HTTP Method**: `GET`
* **Path**: `/proxy`
* **Query Parameter**: `url` (URL-encoded target URL)

### Constraints & Security Whitelist:
Allowed target hosts are restricted to:
* `zetvideo.net` (and subdomains)
* `uafix.net` (and subdomains)

Any target URL outside this whitelist returns **`403 Forbidden`**.

---

## 📥 Request Example

### cURL:
```bash
curl -i "https://api.vdovareize.me/proxy?url=https%3A%2F%2Fzetvideo.net%2Fvod%2F1122"
```

### JavaScript (`fetch` inside Smart TV app / browser):
```javascript
const targetUrl = 'https://zetvideo.net/vod/1122';
const proxyUrl = `https://api.vdovareize.me/proxy?url=${encodeURIComponent(targetUrl)}`;

const response = await fetch(proxyUrl, {
  method: 'GET',
});

const htmlContent = await response.text();
```

---

## 📤 Response

* **Status**: Upstream response status (e.g. `200 OK`)
* **Headers**:
  * `Access-Control-Allow-Origin: *`
  * `Content-Type`: Upstream content type (e.g. `text/html; charset=utf-8`)
  * `Cache-Control`: `no-store, no-cache, must-revalidate`
* **Body**: Upstream page / player content

---

## ❌ Error Responses

### `HTTP 400 Bad Request`
Missing or malformed `url` query parameter:
```json
{
  "error": "Missing \"url\" query parameter"
}
```

### `HTTP 403 Forbidden`
Target host is not permitted:
```json
{
  "error": "Host \"google.com\" is not allowed"
}
```

### `HTTP 502 Bad Gateway`
Network failure communicating with upstream server:
```json
{
  "error": "Proxy request to upstream failed"
}
```
