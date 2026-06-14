# api-me 🚀

[![Unit Tests](https://img.shields.io/badge/Unit%20Tests-passing-brightgreen?style=flat-square&logo=jest)](https://github.com/SergiiVdovareize/api-me)
[![E2E Tests](https://img.shields.io/badge/E2E%20Tests-passing-brightgreen?style=flat-square&logo=jest)](https://github.com/SergiiVdovareize/api-me)
[![Sanity Tests](https://img.shields.io/badge/Sanity%20Tests-passing-brightgreen?style=flat-square&logo=jest)](https://github.com/SergiiVdovareize/api-me)
[![Lint & Format](https://img.shields.io/badge/Lint%20%26%20Format-passing-brightgreen?style=flat-square&logo=eslint)](https://github.com/SergiiVdovareize/api-me)
[![Deploy Status](https://github.com/SergiiVdovareize/api-me/actions/workflows/deploy.yml/badge.svg?style=flat-square)](https://github.com/SergiiVdovareize/api-me/actions)
[![Version](https://img.shields.io/badge/Version-v1.4.1-blue?style=flat-square)](https://github.com/SergiiVdovareize/api-me/releases)




A modular NestJS API designed for personal utility, serverless computation, bank account tracking, and media extraction. Built with TypeScript, Prisma, and PostgreSQL, and optimized for deployment on Vercel.

---

## 🛠️ Technology Stack

* **Framework**: NestJS (v11)
* **Language**: TypeScript
* **Database & ORM**: PostgreSQL & Prisma ORM
* **Caching**: Upstash Redis
* **Analytics**: Sentry & PostHog
* **Deployment**: Vercel Serverless Functions & Vercel Blob Storage

---

## 📂 Project Architecture & Modules

The application is split into highly modular, decoupled domains:

### 1. Memes (Media Extraction) — `src/memes`
Steals and processes media resources from external social media URLs (Instagram, Facebook, Threads, etc.) using multiple concurrent scraper/downloader attempts.
* **Controller**: `GET /memes/:url` — Extracted media info is fetched from different providers concurrently.
* **Decoupled Downloaders**: Under `src/memes/downloaders/`, each scraping provider has its own folder containing a downloader class and a response adapter class:
  * **Snapsave**: Uses `snapsave-adapter` to query and format Instagram/Facebook/Threads URLs.
  * **Mediasnap**: Integrates `mediasnap` library.
  * **Vidssave**: Scrapes and parses direct layout configs/auth tokens to fetch resources.
  * **Highreach** & **Next**: Scrapers for other custom endpoints.
* **Unified Data Model**: All adapters format different responses into a consistent `DownloadResult` interface.
* **Nextdownloader Proxy**: `GET /memes/download/next` — Handles specialized media chunk proxying.
* **Security**: Enforces origin verification through the `OriginGuard` to only allow incoming requests from `https://snip.vdovareize.me/` (or `localhost` in local development mode).

### 2. General File Proxy — `src/app.controller.ts`
* **Route**: `GET /download?url=...&filename=...`
* **Logic**: Downloads remote files on-the-fly, auto-detects standard mime-types (video, audio, images), and returns a `StreamableFile` attachment to bypass CORS restrictions for media streaming.

### 3. Track (Bank Account Tracking) — `src/track`
Monitors bank account balances and keeps history inside PostgreSQL.
* **Routes**:
  * `GET /track`: Syncs all bank accounts.
  * `GET /track/refresh`: Refreshes and logs track analytics.
  * `GET /track/deactivate/:trackId`: Deactivates balance tracking for a specific account.
  * `GET /track/check/:type/:id`: Queries the Mono/Privat bank API for account info and balance.
  * `GET /track/mono/:id`: Mono-specific balance checker.
  * `GET /track/watch/:type/:id`: Starts tracking/watching a specific bank account.

### 4. Clouds (Serverless Computations) — `src/clouds`
Provides microservice mathematical computations with monthly quotas (900 calls/month).
* **Routes**:
  * `GET /clouds/fibonacci/:index` — Computes the N-th Fibonacci number.
  * `GET /clouds/prime/:index` — Computes the N-th Prime number.
  * `GET /clouds/armstrong/:index` — Computes the N-th Armstrong number.
  * `GET /clouds/result/:id` — Retries and queries Vercel Blob storage for delayed background job JSON results.

### 5. Game Results (Leaderboards) — `src/game-results`
Maintains score leaderboards for mini-games (e.g., Stroop color matching game).
* **Routes**:
  * `POST /game-results`: Creates a new record with cryptographic expiration tokens to prevent spoofing/tampering.
  * `GET /game-results`: Returns all game records.
  * `GET /game-results/leaders?type=...`: Returns descending highscore leaders grouped by `GameType`.

---

## 🗄️ Database Schema (Prisma)

The application uses a PostgreSQL database structured via Prisma:
* **`Request`**: Stores logs of microservice api calculations to enforce limits.
* **`Account`**: Represents a tracked bank account (e.g., Mono bank).
* **`AccountIncoming`**: Stores periodic balance statements linked to an `Account`.
* **`GameResult`**: Stores player names, scores, and timestamps for games like `stroop`.



## 🚀 Running the Server

### Installation
```bash
npm install
```

### Prisma Client & Migrations
```bash
# Generate Prisma Client
npx prisma generate

# Apply local migrations
npx prisma migrate dev
```

### Run Locally
```bash
# Development
npm run start:dev

# Production Build & Run
npm run build
npm run start:prod
```

### Verification & Testing
```bash
# Run unit tests
npm run test

# Run E2E tests
npm run test:e2e

# Run Live Sanity Scraper tests
npm run test:sanity

# Run Linting and Formatting checks
npm run validate
```
