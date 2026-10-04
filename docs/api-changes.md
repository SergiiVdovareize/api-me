# API Changes & Migration Guide

This document describes recent architectural and REST improvements to the backend API, including updated endpoints, request contracts, and migration instructions for client applications (Frontend).

**Date:** October 4, 2026
**Status:** In Effect (Backward-Compatible Rollout)

---

## 📌 Table of Contents
1. [Overview of Changes](#overview-of-changes)
2. [Track Deactivation: `POST /track/deactivate/:trackId`](#1-track-deactivation-post-trackdeactivatetrackid)
3. [CNAP Slot Checking: `POST /cnap/check`](#2-cnap-slot-checking-post-cnapcheck)
4. [Backward Compatibility](#backward-compatibility)

---

## Overview of Changes

| Endpoint | Old Method / Format | New Method / Format | Backward Compatibility Status |
| :--- | :--- | :--- | :--- |
| `/track/deactivate/:trackId` | `GET` (state mutation) | `POST` | `GET` kept as a **Deprecated** alias |
| `/cnap/check` | `POST` + URL Query params | `POST` + JSON Request Body | URL Query params supported as fallback |

---

## 1. Track Deactivation: `POST /track/deactivate/:trackId`

### Reason for Change
The track deactivation operation mutates state in the database (Redis). In accordance with REST best practices, state-changing operations should use the `POST` method (or `PATCH`/`PUT`), rather than `GET`.

### Request Contract

- **URL:** `/track/deactivate/:trackId`
- **Method:** `POST`
- **URL Parameters:**
  - `trackId` *(string, required)* — Identifier of the track to deactivate.
- **Headers:** None required beyond default headers.
- **Response:**
  - `200 OK` — Success status message or payload indicating successful deactivation.

### Usage Examples

#### cURL
```bash
curl -X POST https://api.vdovareize.me/track/deactivate/12345
```

#### JavaScript / TypeScript (`fetch`)
```javascript
// Old (Deprecated):
// await fetch('/track/deactivate/12345', { method: 'GET' });

// New (Recommended):
const response = await fetch('/track/deactivate/12345', {
  method: 'POST',
});

const data = await response.json();
```

#### Axios
```typescript
// Old (Deprecated):
// await axios.get('/track/deactivate/12345');

// New (Recommended):
await axios.post('/track/deactivate/12345');
```

---

## 2. CNAP Slot Checking: `POST /cnap/check`

### Reason for Change
In `POST` requests, parameters should be sent in the request body rather than in URL query strings. The endpoint now accepts a structured JSON payload (`Content-Type: application/json`), aligning with REST standards and simplifying payload validation.

### Request Contract

- **URL:** `/cnap/check`
- **Method:** `POST`
- **Headers:**
  - `Content-Type: application/json`
- **Body Schema (`application/json`):**

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `category` | `string` | **Yes** | Service category identifier |
| `service` | `string` | **Yes** | Specific service identifier |
| `location` | `string` | **Yes** | CNAP location/branch identifier or name |
| `notify` | `string` | No | Flag indicating whether to dispatch notifications (e.g., `"true"`) |
| `force` | `string` | No | Flag to bypass cache (e.g., `"true"`) |
| `chatId` | `string` | No | Telegram Chat ID for targeted notifications |

### Usage Examples

#### cURL
```bash
curl -X POST https://api.vdovareize.me/cnap/check \
  -H "Content-Type: application/json" \
  -d '{
    "category": "pasport",
    "service": "id-card",
    "location": "centr",
    "notify": "true"
  }'
```

#### JavaScript / TypeScript (`fetch`)
```javascript
// Old (Query params in POST):
// await fetch('/cnap/check?category=pasport&service=id-card&location=centr&notify=true', {
//   method: 'POST',
// });

// New (JSON Body):
const response = await fetch('/cnap/check', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    category: 'pasport',
    service: 'id-card',
    location: 'centr',
    notify: 'true',
    // force: 'true',
    // chatId: '12345678',
  }),
});

const result = await response.json();
```

#### Axios
```typescript
await axios.post('/cnap/check', {
  category: 'pasport',
  service: 'id-card',
  location: 'centr',
  notify: 'true',
});
```

---

## Backward Compatibility

To ensure uninterrupted service for existing clients:
1. `GET /track/deactivate/:trackId` continues to work and returns identical results. It is marked as **deprecated** and will be phased out in future releases.
2. `POST /cnap/check` checks for a JSON request body first. If the body is missing or empty, it automatically falls back to URL query parameters.
