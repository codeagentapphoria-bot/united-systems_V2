# United Systems — Deployment Guide

> **Version:** v2 (March 2026)  
> **Architecture:** Two Express backends + two Vite frontends sharing one PostgreSQL database

---

## Overview

United Systems consists of four components that must be deployed together:

| Component | Directory | Default Port | Purpose |
|---|---|---|---|
| BIMS Backend | `barangay-information-management-system-copy/server/` | 5000 | Resident/barangay management, registration approvals, certificate generation |
| E-Services Backend | `borongan-eService-system-copy/multysis-backend/` | 3000 | Portal auth, transactions, services catalogue |
| BIMS Frontend | `barangay-information-management-system-copy/client/` | 5173 | Staff admin UI (barangay + municipality) |
| E-Services Frontend | `borongan-eService-system-copy/multysis-frontend/` | 5174 | Resident-facing portal |

**Both backends connect to the same PostgreSQL database.** They share tables: `residents`, `barangays`, `municipalities`, `registration_requests`, `transactions`, `services`, `certificate_templates`.

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | ≥ 20 | Both backends |
| PostgreSQL | ≥ 14 (with PostGIS) | Shared database |
| Redis | ≥ 7 | Session caching (optional in dev) |
| Chromium / Chrome | any | Required by Puppeteer for certificate PDF generation |
| `psql` CLI | any | For running schema + seed scripts |

---

## Step 1 — Database Setup

Both backends must point to the same database. Run the scripts once on a fresh database:

```bash
# 1. Apply the schema (creates all tables, indexes, triggers, extensions)
psql -U postgres -d your_database -f united-database/schema.sql

# 2. Load seed data (roles, permissions, services, FAQs, etc.)
psql -U postgres -d your_database -f united-database/seed.sql

# 3. Load GIS municipality/barangay geometry data
psql -U postgres -d your_database -f united-database/seed_gis.sql

# Expected output from seed.sql:
#   Roles:                        4
#   Permissions:                  15
#   Role-Permission mappings:     27
#   Social amelioration settings: 22
#   Government programs:          8
#   FAQs:                         7
#   Services (certificates):      9
```

> **Important:** Always run `schema.sql` → `seed.sql` → `seed_gis.sql` in order.
> Without `seed_gis.sql`, the GeoMap page will show an empty map and barangay auto-creation from the GeoSetup page will fail.

### PostGIS

The schema requires the PostGIS extension. It is automatically enabled by `schema.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;
```

If you are using Supabase, PostGIS is available by default. For self-hosted PostgreSQL, install the `postgis` package for your OS before running the schema.

### Local dev database

```bash
createdb united_systems_dev
psql -U postgres -d united_systems_dev -f united-database/schema.sql
psql -U postgres -d united_systems_dev -f united-database/seed.sql
```

---

## Step 2 — Environment Variables

### Critical: JWT_SECRET must be identical on both backends

The BIMS backend validates JWT tokens issued by the E-Services backend (e.g. residents calling BIMS household routes). Both backends must share the same secret:

```env
# Both .env files must have the exact same value:
JWT_SECRET=your-long-random-secret-min-32-chars
```

Generate a strong secret:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

### BIMS Backend — `barangay-information-management-system-copy/server/.env`

See `.env.example` in the same directory for the full template. Key variables:

```env
# Database (same instance as E-Services backend)
PG_USER=postgres
PG_HOST=localhost
PG_DATABASE=united_systems
PG_PASSWORD=your_db_password
PG_PORT=5432
PG_SSL=false

# JWT — must match E-Services backend exactly
JWT_SECRET=your-long-random-secret-min-32-chars
JWT_EXPIRES_IN=1d

PORT=5000
NODE_ENV=production

# CORS — comma-separate to allow both frontends
# The E-Services portal calls BIMS directly for household data
CORS_ORIGIN=https://bims.your-domain.com,https://portal.your-domain.com

# Portal URL — used in QR codes and redirect notices
PORTAL_URL=https://portal.your-domain.com

# Puppeteer (required for certificate PDF generation — see Step 4)
# PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
# PUPPETEER_NO_SANDBOX=true

# Email (optional)
GMAIL_USER=your_gmail@gmail.com
GMAIL_PASS=your_gmail_app_password

# First admin account (created on first boot)
DEFAULT_ADMIN_EMAIL=admin@your-domain.gov.ph
DEFAULT_ADMIN_PASSWORD=ChangeThisPassword123!
DEFAULT_MUNICIPALITY_NAME=Your Municipality
DEFAULT_REGION=Your Region
DEFAULT_PROVINCE=Your Province
```

---

### E-Services Backend — `borongan-eService-system-copy/multysis-backend/.env`

See `.env.example` in the same directory for the full template. Key variables:

```env
# Database (Prisma — same DB as BIMS backend)
DATABASE_URL=postgres://user:password@host:5432/dbname
DIRECT_URL=postgres://user:password@host:5432/dbname

# JWT — must match BIMS backend exactly
JWT_SECRET=your-long-random-secret-min-32-chars
JWT_REFRESH_SECRET=another-long-random-secret-for-refresh

PORT=3000
NODE_ENV=production

# CORS — E-Services portal frontend
CORS_ORIGIN=https://portal.your-domain.com

# Portal URL (used in approval email login links)
PORTAL_URL=https://portal.your-domain.com

# Email (Gmail App Password)
SMTP_USER=your_gmail@gmail.com
SMTP_PASS=your_gmail_app_password
SMTP_FROM=noreply@your-domain.gov.ph

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=https://eservice-api.your-domain.com/api/auth/portal/google/callback
```

---

### BIMS Frontend — `barangay-information-management-system-copy/client/.env`

```env
VITE_API_BASE_URL=https://bims-api.your-domain.com/api
VITE_SERVER_URL=https://bims-api.your-domain.com
VITE_ESERVICE_URL=https://portal.your-domain.com

# E-Services backend base URL — used to resolve household images uploaded via the portal
# Must point to the E-Services backend (not BIMS). Required for household photos to display.
VITE_ESERVICE_SERVER_URL=https://eservice-api.your-domain.com
```

---

### E-Services Frontend — `borongan-eService-system-copy/multysis-frontend/.env`

```env
VITE_API_BASE_URL=https://eservice-api.your-domain.com/api
VITE_BIMS_API_BASE_URL=https://bims-api.your-domain.com/api
VITE_PORTAL_URL=https://portal.your-domain.com

# Supabase (for Google OAuth only)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_SUPABASE_TIMEOUT=120000
```

---

## Step 3 — Install Dependencies

```bash
# BIMS backend
cd barangay-information-management-system-copy/server && npm install

# E-Services backend
cd borongan-eService-system-copy/multysis-backend
npm install
npx prisma generate          # regenerate Prisma client against current schema

# BIMS frontend
cd barangay-information-management-system-copy/client && npm install

# E-Services frontend
cd borongan-eService-system-copy/multysis-frontend && npm install
```

---

## Step 4 — Puppeteer (PDF Generation)

The BIMS backend generates certificate PDFs using Puppeteer (headless Chrome). Chromium is downloaded automatically on `npm install`.

**Linux server / no display:**

```env
# Add to BIMS backend .env:
PUPPETEER_NO_SANDBOX=true
```

**Docker:** Install Chromium dependencies in your Dockerfile:

```dockerfile
RUN apt-get update && apt-get install -y \
    chromium fonts-liberation libatk-bridge2.0-0 libatk1.0-0 \
    libcups2 libdbus-1-3 libnspr4 libnss3 libx11-xcb1 \
    libxcomposite1 libxdamage1 libxrandr2 xdg-utils \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_NO_SANDBOX=true
```

---

## Step 5 — Build Frontends

```bash
# BIMS frontend
cd barangay-information-management-system-copy/client
npm run build
# Output → dist/ (serve as static files)

# E-Services frontend
cd borongan-eService-system-copy/multysis-frontend
npm run build
# Output → dist/ (serve as static files)
```

Serve `dist/` with nginx, Caddy, or a CDN. For SPAs, configure your server to serve `index.html` for all routes.

---

## Step 6 — Start Backends

```bash
# BIMS backend
cd barangay-information-management-system-copy/server
node server.js
# With PM2:  pm2 start server.js --name bims-backend

# E-Services backend
cd borongan-eService-system-copy/multysis-backend
npm run build               # compile TypeScript → dist/
node dist/index.js
# With PM2:  pm2 start dist/index.js --name eservice-backend
```

Health checks:
- BIMS: `GET http://localhost:5000/health`
- E-Services: the app logs its port on startup

---

## Step 7 — Initial Municipality Setup (GeoJSON)

**This must be done before any resident can register.**

The GeoJSON setup auto-creates all barangays for the municipality from official PSGC data. Without this, the portal's address dropdown is empty and registration requests have no barangay to route to.

### Prerequisites for setup

The `gis_municipality` and `gis_barangay` tables must contain PSGC GeoJSON polygon data. Load the included GIS seed before running setup:

```bash
psql "$DB_URL" -f united-database/seed_gis.sql
```

This populates Eastern Samar province geometry data. For a different province see **Deploying to a Different Province** below.

### Running setup

1. Log in to the BIMS admin UI as the **municipality admin**
2. Go to **Setup** in the sidebar
3. The interactive map shows all municipalities in the loaded GeoJSON
4. Click your municipality on the map
5. Enter **Province** and **Region** in the confirmation dialog
6. Click **Confirm**

All barangays are auto-created from GIS data. The municipality is marked `active` and the portal becomes functional.

### Deploying to a Different Province

The included `seed_gis.sql` contains Eastern Samar municipality and barangay geometries only. To deploy in another province:

1. Obtain GeoJSON polygon data for your province's municipalities and barangays (available from the Philippine Statistics Authority PSGC portal or OpenStreetMap/GADM exports)
2. Review `united-database/prepare.sh` — it converts shapefiles/GeoJSON to SQL INSERT statements targeting `gis_municipality` and `gis_barangay`. Adapt the input file paths and PSGC code mappings for your province.
3. Run `prepare.sh` to generate a new `seed_gis.sql` for your province
4. Load it with `psql "$DB_URL" -f united-database/seed_gis.sql`

The seed must populate `gis_municipality` (municipal boundaries + PSGC municipality codes) and `gis_barangay` (barangay boundaries + PSGC barangay codes) before the setup wizard can auto-create barangays.

---

## Step 8 — Verify with the Test Script

```bash
# Run from the repository root
chmod +x united-database/test_mutations_bims.sh

# Default (local dev):
./united-database/test_mutations_bims.sh

# Custom DB / server:
DB_URL="postgresql://user:pass@host/dbname" \
BIMS_URL="http://your-server:5000/api" \
./united-database/test_mutations_bims.sh
```

Expected: all tests PASS, 0 FAIL.

---

## Step 9 — End-to-End Smoke Tests

Run these manually in order after a fresh deployment:

### 1 — GeoJSON setup → barangays exist
- BIMS admin → Setup → click municipality → confirm
- Verify barangays appear in the Barangays list

### 2 — Resident registration → approval → login
- Portal `/portal/register` → 4-step wizard
- BIMS admin → Registrations → Approve
- Resident receives `resident_id` (e.g. `RES-2026-0000001`)
- Resident logs in with username/password
- My Profile shows correct address; My ID shows QR card

### 3 — Service request (resident)
- Portal → E-Government → Request Service
- Submit form → reference number shown
- Portal → Track Application → enter reference

### 4 — Guest application
- Log out → E-Government → Apply as Guest
- Barangay Certificate services show "residents only" notice
- Select a non-certificate service → submit → reference number shown
- Portal → Track → enter reference

### 5 — Certificate template + PDF
- BIMS municipality admin → Certificate Templates → New Template (Barangay Clearance)
- BIMS barangay staff → Certificates → pending clearance request → Generate & Download
- PDF downloads with resident name filled in

### 6 — Bulk ID
- BIMS municipality admin → Bulk ID → select barangay → Download PDF
- PDF contains ID cards for active residents

---

## Troubleshooting

### PDF generation fails (`Failed to launch the browser process`)
Add `PUPPETEER_NO_SANDBOX=true` to BIMS backend `.env`.

### CORS errors in browser console
`CORS_ORIGIN` in both backend `.env` files must include the exact origin (protocol + host + port, no trailing slash) of the calling frontend. Comma-separate multiple origins.

### Portal household shows 401
The E-Services portal calls the BIMS backend directly for household data. Both backends must have **identical** `JWT_SECRET` values.

### "Barangay not found" during registration
Complete Step 7 (GeoJSON municipality setup) before accepting registrations.

### Resident can log in with `pending` status
Ensure the E-Services backend is on the latest version. `auth.service.ts → portalLogin()` must check for `pending` and `rejected` statuses in addition to `inactive`.

### Prisma schema drift
If you get Prisma errors, regenerate the client:
```bash
cd borongan-eService-system-copy/multysis-backend
npx prisma generate
```

---

## Key Design Notes

| Topic | Detail |
|---|---|
| **Single approver** | Registration requests are approved/rejected in BIMS only. The E-Services admin panel shows them read-only to prevent race conditions. |
| **No manual barangay entry** | Barangays are always auto-created from GeoJSON via Setup. |
| **Resident status lifecycle** | `pending` → `active` (on approval) or `pending` → `rejected`. Active residents can log in; pending and rejected cannot. |
| **Guest transactions** | Transactions with no `resident_id` are guest submissions. They appear in the E-Services admin list but NOT in the BIMS certificate queue (no barangay to route to). |
| **Certificate templates** | One active template per certificate type per municipality. All barangays in the municipality share the same template. Templates are managed by the municipality admin in BIMS. |
| **Shared database** | Both backends write to the same PostgreSQL instance. There is no HTTP communication between the two backends — they share data via the DB. The only exception is the E-Services frontend calling the BIMS backend directly for household data (cross-origin, handled via CORS + JWT). |

---

*United Systems Deployment Guide — v2, March 2026*
