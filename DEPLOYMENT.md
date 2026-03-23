# Deployment Guide — Borongan United Systems

**Systems:** BIMS (Barangay Information Management System) + E-Services (Multysis)
**Database:** Unified Supabase PostgreSQL
**Target:** Vercel (frontends + backends)

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Pre-Deployment Fixes Required](#3-pre-deployment-fixes-required)
4. [Supabase Configuration](#4-supabase-configuration)
5. [Google OAuth Configuration](#5-google-oauth-configuration)
6. [BIMS Deployment](#6-bims-deployment)
7. [E-Services Deployment](#7-e-services-deployment)
8. [Post-Deployment Checklist](#8-post-deployment-checklist)
9. [Known Limitations on Vercel](#9-known-limitations-on-vercel)
10. [Seeding Production Database](#10-seeding-production-database)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                        VERCEL                           │
│                                                         │
│  ┌──────────────┐        ┌────────────────────────┐     │
│  │ BIMS Frontend│        │ E-Services Frontend    │     │
│  │  (React/Vite)│        │   (React/Vite)         │     │
│  │  Port: 5173  │        │   Port: 5174           │     │
│  └──────┬───────┘        └───────────┬────────────┘     │
│         │                            │                  │
│  ┌──────▼───────┐        ┌───────────▼────────────┐     │
│  │ BIMS Backend │        │ E-Services Backend     │     │
│  │ (Express.js) │        │ (Express.js/TypeScript)│     │
│  │  Port: 5000  │        │   Port: 3000           │     │
│  └──────┬───────┘        └───────────┬────────────┘     │
└─────────┼────────────────────────────┼──────────────────┘
          │                            │
          └──────────────┬─────────────┘
                         │
              ┌──────────▼───────────┐
              │  Supabase PostgreSQL │
              │  (Unified Database)  │
              │  exahyuahguriwrkk... │
              └──────────────────────┘
```

### Repository Structure
```
united-systems/
├── barangay-information-management-system-copy/
│   ├── client/          ← BIMS Frontend
│   └── server/          ← BIMS Backend
├── borongan-eService-system-copy/
│   ├── multysis-frontend/   ← E-Services Frontend
│   └── multysis-backend/    ← E-Services Backend
└── united-database/         ← Migrations, seed scripts, test scripts
```

---

## 2. Prerequisites

- [ ] Vercel account (https://vercel.com)
- [ ] GitHub repository with all four projects
- [ ] Supabase project already set up (project ID: `exahyuahguriwrkkeuvm`)
- [ ] Google Cloud Console project with OAuth 2.0 credentials
- [ ] Gmail account with App Password for SMTP (or any SMTP provider)
- [ ] Node.js 18+ installed locally for running seed scripts

---

## 3. Pre-Deployment Fixes Required

Two things **must** be done before deploying backends to Vercel:

### 3.1 File Uploads → Supabase Storage

Both backends currently save uploaded files to a local `uploads/` folder using `multer`.
Vercel's filesystem is **ephemeral** — files are lost between deployments.

**Action required:** Replace `multer` disk storage with Supabase Storage in both backends.

Affected upload paths:
- **BIMS:** resident photos, ID documents, archive documents, inventory images
  - `server/src/middlewares/upload.js` — change `diskStorage` to Supabase Storage upload
- **E-Services:** citizen photos, proof of identification, selfie verification
  - `multysis-backend/src/middleware/upload.middleware.ts` — change `diskStorage` to Supabase Storage upload

**Supabase Storage buckets to create:**
```
bims-uploads        (public: false — serve via signed URLs)
eservice-uploads    (public: false — serve via signed URLs)
```

Create buckets in: Supabase Dashboard → Storage → New Bucket

**Implementation pattern (replace multer diskStorage):**
```ts
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Instead of writing to disk, upload to Supabase Storage:
const { data, error } = await supabase.storage
  .from('bims-uploads')           // or 'eservice-uploads'
  .upload(`residents/${filename}`, fileBuffer, { contentType: mimeType });

const publicUrl = supabase.storage
  .from('bims-uploads')
  .getPublicUrl(`residents/${filename}`).data.publicUrl;
// Store publicUrl in the database instead of a local file path
```

Add `SUPABASE_SERVICE_ROLE_KEY` to backend env vars (get from Supabase Dashboard → Settings → API → service_role key — **keep secret**).

### 3.2 Add `vercel.json` to Both Backends

Each backend needs a `vercel.json` at its root so Vercel knows to route all requests through Express.

**BIMS Backend** — create `barangay-information-management-system-copy/server/vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "server.js"
    }
  ]
}
```

**E-Services Backend** — create `borongan-eService-system-copy/multysis-backend/vercel.json`:
```json
{
  "version": 2,
  "builds": [
    {
      "src": "dist/index.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "dist/index.js"
    }
  ]
}
```

Also add a `build` script to E-Services backend `package.json` (already present: `"build": "tsc"`).
Vercel will run `npm run build` automatically before deploying.

---

## 4. Supabase Configuration

### 4.1 Authentication → URL Configuration

In Supabase Dashboard → Authentication → URL Configuration:

**Site URL:**
```
https://<eservice-frontend>.vercel.app
```

**Redirect URLs (add all):**
```
https://<eservice-frontend>.vercel.app
https://<eservice-frontend>.vercel.app/**
http://localhost:5174
http://localhost:5174/**
```

### 4.2 Storage Buckets (after fix 3.1)

Create in Supabase Dashboard → Storage:

| Bucket | Public | Purpose |
|--------|--------|---------|
| `bims-uploads` | No | BIMS file uploads (residents, archives, inventory) |
| `eservice-uploads` | No | E-Services file uploads (citizen docs, ID photos) |

### 4.3 Google OAuth Provider

In Supabase Dashboard → Authentication → Providers → Google:
- **Enable** the Google provider
- **Client ID:** `686060403294-2v8vh2662spp7j5rpo3s55msinpnl00j.apps.googleusercontent.com`
- **Client Secret:** *(get from Google Cloud Console — kept secret)*

---

## 5. Google OAuth Configuration

### 5.1 Google Cloud Console

In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials → your OAuth 2.0 Client:

**Authorized JavaScript Origins:**
```
http://localhost:5174
http://localhost:3000
https://<eservice-frontend>.vercel.app
https://<eservice-backend>.vercel.app
```

**Authorized Redirect URIs:**
```
https://exahyuahguriwrkkeuvm.supabase.co/auth/v1/callback
http://localhost:3000/api/auth/google/callback
https://<eservice-backend>.vercel.app/api/auth/google/callback
```

> **Note:** Replace `<eservice-frontend>` and `<eservice-backend>` with the actual Vercel project URLs assigned after first deployment.

---

## 6. BIMS Deployment

### 6.1 BIMS Backend

**Vercel Project Settings:**
- Root Directory: `barangay-information-management-system-copy/server`
- Framework Preset: Other
- Build Command: *(leave empty — no build step for plain Node.js)*
- Output Directory: *(leave empty)*
- Install Command: `npm install`

**Environment Variables (set in Vercel Dashboard):**

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `5000` |
| `PG_USER` | `postgres.exahyuahguriwrkkeuvm` |
| `PG_HOST` | `aws-1-ap-south-1.pooler.supabase.com` |
| `PG_DATABASE` | `postgres` |
| `PG_PASSWORD` | *(Supabase DB password)* |
| `PG_PORT` | `6543` |
| `PG_SSL` | `true` |
| `JWT_SECRET` | *(generate: `openssl rand -base64 64`)* |
| `JWT_EXPIRES_IN` | `1d` |
| `CORS_ORIGIN` | `https://<bims-frontend>.vercel.app` |
| `CORS_CREDENTIALS` | `true` |
| `CLIENT_URL` | `https://<bims-frontend>.vercel.app` |
| `GMAIL_USER` | `rosettascript@gmail.com` |
| `GMAIL_PASS` | *(Gmail App Password)* |
| `SMTP_FROM` | `noreply@borongan.gov.ph` |
| `BCRYPT_ROUNDS` | `12` |
| `OPENAPI_ENABLED` | `true` |
| `OPENAPI_DEFAULT_RATE_LIMIT_PER_MINUTE` | `60` |
| `RATE_LIMIT_WINDOW_MS` | `900000` |
| `RATE_LIMIT_MAX_REQUESTS` | `100` |
| `LOG_LEVEL` | `info` |
| `SUPABASE_URL` | `https://exahyuahguriwrkkeuvm.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | *(from Supabase Dashboard → Settings → API)* |
| `DEFAULT_MUNICIPALITY_NAME` | `City of Borongan` |
| `DEFAULT_REGION` | `Region VIII` |
| `DEFAULT_PROVINCE` | `Eastern Samar` |
| `DB_SEEDED` | `true` |
| `GIS_DATA_IMPORTED` | `true` |

> **Redis:** BIMS uses Redis for caching. On Vercel serverless, Redis connections may not persist.
> Option A: Remove Redis caching (set `REDIS_HOST` to empty — the app degrades gracefully).
> Option B: Use [Upstash Redis](https://upstash.com) (serverless-compatible, free tier available).
>
> | `REDIS_HOST` | `<upstash-endpoint>` or leave empty |
> | `REDIS_PORT` | `6379` |
> | `REDIS_PASSWORD` | *(Upstash password or empty)* |

### 6.2 BIMS Frontend

**Vercel Project Settings:**
- Root Directory: `barangay-information-management-system-copy/client`
- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

**`vercel.json`** — create in `barangay-information-management-system-copy/client/vercel.json`:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Environment Variables:**

| Variable | Value |
|----------|-------|
| `VITE_API_BASE_URL` | `https://<bims-backend>.vercel.app/api` |

---

## 7. E-Services Deployment

### 7.1 E-Services Backend

**Vercel Project Settings:**
- Root Directory: `borongan-eService-system-copy/multysis-backend`
- Framework Preset: Other
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

**Environment Variables (set in Vercel Dashboard):**

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `DATABASE_URL` | `postgres://postgres.exahyuahguriwrkkeuvm:<password>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true` |
| `DIRECT_URL` | `postgres://postgres.exahyuahguriwrkkeuvm:<password>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres` |
| `JWT_SECRET` | *(generate: `openssl rand -base64 64`)* |
| `JWT_REFRESH_SECRET` | *(generate: `openssl rand -base64 64`)* |
| `JWT_EXPIRES_IN` | `1h` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `SESSION_SECRET` | *(generate: `openssl rand -base64 64`)* |
| `SESSION_MAX_AGE` | `86400000` |
| `FRONTEND_URL` | `https://<eservice-frontend>.vercel.app` |
| `CORS_ORIGIN` | `https://<eservice-frontend>.vercel.app` |
| `EMAIL_ENABLED` | `true` |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_SECURE` | `false` |
| `SMTP_USER` | `rosettascript@gmail.com` |
| `SMTP_PASS` | *(Gmail App Password)* |
| `SMTP_FROM` | `noreply@borongan.gov.ph` |
| `GOOGLE_CLIENT_ID` | `686060403294-2v8vh2662spp7j5rpo3s55msinpnl00j.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | *(from Google Cloud Console)* |
| `GOOGLE_CALLBACK_URL` | `https://<eservice-backend>.vercel.app/api/auth/google/callback` |
| `SUPABASE_URL` | `https://exahyuahguriwrkkeuvm.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | *(from Supabase Dashboard → Settings → API)* |
| `RATE_LIMIT_WINDOW_MS` | `900000` |
| `RATE_LIMIT_MAX_REQUESTS` | `100` |
| `MAX_FILE_SIZE` | `5242880` |
| `API_PREFIX` | `/api` |
| `LOG_LEVEL` | `info` |
| `OTP_EXPIRY_MINUTES` | `5` |
| `OTP_LENGTH` | `6` |
| `DEBUG_DB` | `false` |

> **Redis:** Same as BIMS — use Upstash or leave empty.
>
> | `REDIS_HOST` | `<upstash-endpoint>` or leave empty |
> | `REDIS_PORT` | `6379` |
> | `REDIS_PASSWORD` | *(Upstash password or empty)* |

### 7.2 E-Services Frontend

**Vercel Project Settings:**
- Root Directory: `borongan-eService-system-copy/multysis-frontend`
- Framework Preset: Vite
- Build Command: `npm run build`
- Output Directory: `dist`

**`vercel.json`** — create in `borongan-eService-system-copy/multysis-frontend/vercel.json`:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Environment Variables:**

| Variable | Value |
|----------|-------|
| `VITE_API_BASE_URL` | `https://<eservice-backend>.vercel.app/api` |
| `VITE_API_TIMEOUT` | `30000` |
| `VITE_APP_NAME` | `Borongan E-Services` |
| `VITE_APP_VERSION` | `2.0.0` |
| `VITE_SUPABASE_URL` | `https://exahyuahguriwrkkeuvm.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4YWh5dWFoZ3VyaXdya2tldXZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMDAzMDksImV4cCI6MjA4OTc3NjMwOX0.gfPJwTsk7vRUBhvNvLqKIBOtQY0Ucg1XYRaR30VwgDA` |
| `VITE_SUPABASE_TIMEOUT` | `120000` |
| `VITE_GOOGLE_CLIENT_ID` | `686060403294-2v8vh2662spp7j5rpo3s55msinpnl00j.apps.googleusercontent.com` |
| `VITE_WS_URL` | `wss://<eservice-backend>.vercel.app` |
| `VITE_ENABLE_ANALYTICS` | `false` |
| `VITE_ENABLE_DEBUG` | `false` |

---

## 8. Post-Deployment Checklist

After all four Vercel projects are deployed, verify in order:

### Step 1 — Update URLs in Google Cloud Console
Replace all `<placeholder>` entries with actual Vercel URLs (see Section 5.1).

### Step 2 — Update Supabase Auth URLs
Replace all `<placeholder>` entries with actual Vercel URLs (see Section 4.1).

### Step 3 — Update CORS / Frontend URLs
In both backend deployments, update these env vars with the actual Vercel URLs:
- BIMS Backend: `CORS_ORIGIN`, `CLIENT_URL`
- E-Services Backend: `CORS_ORIGIN`, `FRONTEND_URL`, `GOOGLE_CALLBACK_URL`

After updating env vars, **redeploy both backends** (Vercel → Deployments → Redeploy).

### Step 4 — Verify health endpoints
```
GET https://<bims-backend>.vercel.app/health
GET https://<eservice-backend>.vercel.app/health
```
Both should return `200 OK`.

### Step 5 — Test admin logins
- **BIMS admin:** `bims_admin@borongan.gov.ph` / `Admin1234!`
- **E-Services admin:** `admin@eservice.com` / `Test1234!`

### Step 6 — Run database seed (if fresh Supabase project)
From a local machine with the repo cloned:
```bash
# Set the unified DB URL
export UNIFIED_DB_URL="postgresql://postgres.<project-id>:<password>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres"

# Run the unified seed
psql "$UNIFIED_DB_URL" -f united-database/seed.sql

# Run E-Services specific seeds
cd borongan-eService-system-copy/multysis-backend
npx ts-node src/database/seeds/run_missing_seeds.ts
```

### Step 7 — Run GIS data import (BIMS)
```bash
cd barangay-information-management-system-copy/server
node scripts/importGisData.js
```

---

## 9. Known Limitations on Vercel

| Feature | Status | Notes |
|---------|--------|-------|
| REST API | ✅ Works | All endpoints function normally |
| Auth (JWT + cookies) | ✅ Works | Standard stateless auth |
| Email (SMTP) | ✅ Works | Stateless, no issue |
| Google OAuth | ✅ Works | Requires correct redirect URIs |
| Database (Supabase) | ✅ Works | Already production-ready |
| File uploads | ⚠️ Requires fix | Must migrate multer → Supabase Storage before deploying |
| Redis caching | ⚠️ Requires fix | Use Upstash Redis (serverless-compatible) or disable |
| Socket.io real-time | ❌ Broken | Vercel serverless does not support persistent WebSockets. Citizens must manually refresh to see transaction status updates. All other functionality works. |
| Cron jobs / background tasks | ❌ Not supported | If any background jobs are added later, use Vercel Cron or a separate worker |

### Socket.io Impact
The only feature affected by missing WebSockets is **live transaction status updates** on the citizen portal. When an admin updates a transaction status:
- **With WebSockets (local dev):** Citizen's page auto-updates immediately
- **Without WebSockets (Vercel):** Citizen needs to manually refresh the page

All other features — submitting requests, admin approval, email notifications, file uploads (after fix), Google OAuth — work normally.

### Recommended alternative if WebSockets are critical
Deploy backends to **Railway** (https://railway.app) instead of Vercel:
- Supports persistent WebSocket connections
- Supports persistent filesystem (or use Supabase Storage)
- Deploys directly from GitHub
- Free tier available
- Frontends can still be on Vercel

---

## 10. Seeding Production Database

If deploying to a new/empty Supabase project, run seeds in this order:

```bash
# 1. Run schema migrations
psql "$UNIFIED_DB_URL" -f united-database/migrations/01_create_schema.sql
psql "$UNIFIED_DB_URL" -f united-database/migrations/02_seed_gis.sql

# 2. Run base seed (roles, permissions, E-Services data)
psql "$UNIFIED_DB_URL" -f united-database/seed.sql

# 3. Run E-Services specific seeds (services + e-government listings)
cd borongan-eService-system-copy/multysis-backend
npx ts-node src/database/seeds/run_missing_seeds.ts

# 4. Enable pg_trgm extension (for fuzzy matching)
psql "$UNIFIED_DB_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"

# 5. (Optional) Run fuzzy match after importing real resident + citizen data
psql "$UNIFIED_DB_URL" -f united-database/migrations/03_fuzzy_match.sql
```

### Default Admin Accounts

**BIMS Admin** (municipality-level, full access):
- Email: `bims_admin@borongan.gov.ph`
- Password: `Admin1234!`
- Role: `admin` → `municipality` scope

**E-Services Admin** (super_admin, full access):
- Email: `admin@eservice.com`
- Password: `Test1234!`
- Role: `super_admin`

> ⚠️ **Change both passwords immediately after first login in production.**

---

## Quick Reference — Vercel Project Setup Order

1. Deploy **BIMS Backend** first → note its URL
2. Deploy **BIMS Frontend** → set `VITE_API_BASE_URL` to BIMS Backend URL
3. Deploy **E-Services Backend** → note its URL
4. Deploy **E-Services Frontend** → set `VITE_API_BASE_URL` to E-Services Backend URL
5. Update Google Cloud Console + Supabase with all production URLs
6. Redeploy both backends with updated `CORS_ORIGIN` / `FRONTEND_URL`

---

*Document prepared for DevOps handoff — Borongan United Systems v1.0*
*Last updated: March 2026*
