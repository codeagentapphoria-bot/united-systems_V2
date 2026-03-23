# Borongan United Systems

A unified digital governance platform for the **City of Borongan, Eastern Samar** combining the Barangay Information Management System (BIMS) and the Borongan E-Services portal (Multysis) into a single integrated solution backed by a shared Supabase database.

---

## Systems

### BIMS — Barangay Information Management System

A municipal-level management system used by barangay and city hall staff to manage:

- Resident records, households, and puroks
- Barangay officials and classifications
- Pets and vaccination records
- Inventories and archives
- Certificate and appointment requests
- GIS mapping and demographic statistics
- Open API for third-party integrations

### E-Services — Borongan E-Services Portal (Multysis)

A citizen-facing portal where Borongan residents can:

- Register as verified citizens
- Apply for government services online (birth/death certificates, business permits, health certificates, and 60+ more)
- Track transaction and request statuses
- Access social amelioration and government programs
- Sign in with Google OAuth

---

## Repository Structure

```
united-systems/
│
├── barangay-information-management-system-copy/
│   ├── client/                  ← BIMS Frontend (React + Vite + shadcn/ui)
│   └── server/                  ← BIMS Backend  (Node.js + Express + raw SQL)
│
├── borongan-eService-system-copy/
│   ├── multysis-frontend/       ← E-Services Frontend (React + Vite + shadcn/ui)
│   └── multysis-backend/        ← E-Services Backend  (TypeScript + Express + Prisma)
│
├── united-database/
│   ├── migrations/
│   │   ├── 01_migrate_bims.sql       ← BIMS schema migration
│   │   ├── 02_migrate_eservices.sql  ← E-Services schema migration
│   │   ├── 03_fuzzy_match.sql        ← Citizen ↔ Resident identity linking
│   │   ├── 04_verify_integrity.sql   ← Post-migration integrity checks
│   │   └── rollback.sql              ← Full rollback script
│   ├── schema.sql                    ← Unified schema (source of truth)
│   ├── seed.sql                      ← Base seed (roles, permissions, GIS)
│   ├── seed_gis.sql                  ← GIS boundary data
│   ├── test_mutations_bims.sh        ← BIMS POST/PUT/DELETE route tests
│   ├── test_mutations_eservice.sh    ← E-Services POST/PUT/DELETE route tests
│   ├── test_fuzzy_match.sh           ← Fuzzy matching integration tests
│   ├── MIGRATION_PLAN.md             ← Database merge design document
│   └── prepare.sh                    ← Pre-migration preparation script
│
├── archive/                     ← Original unmodified codebases (reference only)
│
├── DEPLOYMENT.md                ← Full deployment guide for DevOps
└── README.md                    ← This file
```

---

## Tech Stack

| Layer | BIMS | E-Services |
|---|---|---|
| **Frontend** | React 18 + Vite + shadcn/ui | React 18 + Vite + shadcn/ui |
| **Backend** | Node.js + Express.js | TypeScript + Express.js |
| **ORM / DB access** | Raw SQL (pg) | Prisma ORM |
| **Database** | Supabase PostgreSQL (unified) | Supabase PostgreSQL (unified) |
| **Auth** | JWT (httpOnly cookies) | JWT (httpOnly cookies) |
| **File uploads** | Multer | Multer |
| **Real-time** | — | Socket.io |
| **Email** | Nodemailer (Gmail SMTP) | Nodemailer (Gmail SMTP) |
| **Maps / GIS** | PostGIS + Leaflet | — |
| **OAuth** | — | Google OAuth + Supabase Auth |

---

## Local Development

### Prerequisites

- Node.js 18+
- PostgreSQL client (`psql`) — for running seed scripts
- Access to the Supabase project

### 1. Clone and install dependencies

```bash
git clone <repo-url> united-systems
cd united-systems

# BIMS Backend
cd barangay-information-management-system-copy/server && npm install && cd ../..

# BIMS Frontend
cd barangay-information-management-system-copy/client && npm install && cd ../..

# E-Services Backend
cd borongan-eService-system-copy/multysis-backend && npm install && cd ../..

# E-Services Frontend
cd borongan-eService-system-copy/multysis-frontend && npm install && cd ../..
```

### 2. Configure environment variables

Each service has its own `.env` file. Copy the examples and fill in the values:

```bash
# BIMS Backend
cp barangay-information-management-system-copy/server/.env.example \
   barangay-information-management-system-copy/server/.env

# E-Services Backend
cp borongan-eService-system-copy/multysis-backend/.env.example \
   borongan-eService-system-copy/multysis-backend/.env

# E-Services Frontend
cp borongan-eService-system-copy/multysis-frontend/.env.example \
   borongan-eService-system-copy/multysis-frontend/.env
```

The minimum required values are the Supabase database credentials.
See `DEPLOYMENT.md` for the full list of environment variables.

### 3. Start all services

Open four terminals:

```bash
# Terminal 1 — BIMS Backend (port 5000)
cd barangay-information-management-system-copy/server
node server.js

# Terminal 2 — BIMS Frontend (port 5173)
cd barangay-information-management-system-copy/client
npm run dev

# Terminal 3 — E-Services Backend (port 3000)
cd borongan-eService-system-copy/multysis-backend
npm run build && node dist/index.js

# Terminal 4 — E-Services Frontend (port 5174)
cd borongan-eService-system-copy/multysis-frontend
npm run dev
```

| Service | URL |
|---|---|
| BIMS Frontend | http://localhost:5173 |
| BIMS Backend API | http://localhost:5000/api |
| E-Services Frontend | http://localhost:5174 |
| E-Services Backend API | http://localhost:3000/api |

### 4. Default admin accounts

| System | Email | Password | Role |
|---|---|---|---|
| BIMS | `bims_admin@borongan.gov.ph` | `Admin1234!` | admin (municipality) |
| E-Services | `admin@eservice.com` | `Test1234!` | super_admin |

> ⚠️ Change these passwords before going to production.

---

## Database

Both systems share a single **Supabase PostgreSQL** instance.

- **Supabase Project:** Borongan Unified System
- **Project ID:** `exahyuahguriwrkkeuvm`
- **Region:** ap-south-1 (AWS Singapore)

### Schema highlights

| Table group | Tables |
|---|---|
| BIMS core | `municipalities`, `barangays`, `puroks`, `residents`, `households`, `officials` |
| BIMS features | `inventories`, `archives`, `pets`, `vaccines`, `requests`, `classification_types`, `resident_classifications` |
| BIMS auth | `bims_users`, `api_keys` |
| GIS | `gis_municipality`, `gis_barangays` |
| E-Services core | `citizens`, `non_citizens`, `subscribers`, `services`, `transactions`, `appointments` |
| E-Services features | `eservices`, `faqs`, `government_programs`, `social_amelioration_settings` |
| E-Services auth | `eservice_users`, `roles`, `permissions`, `user_roles`, `role_permissions` |
| Integration | `citizen_resident_mapping` — links E-Services citizens to BIMS residents |

### Running migrations (fresh database)

```bash
export UNIFIED_DB_URL="postgresql://postgres.<project-id>:<password>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres"

# Apply unified schema
psql "$UNIFIED_DB_URL" -f united-database/schema.sql

# Run base seed
psql "$UNIFIED_DB_URL" -f united-database/seed.sql

# Import GIS data
psql "$UNIFIED_DB_URL" -f united-database/seed_gis.sql

# Seed E-Services data (services + e-government listings)
cd borongan-eService-system-copy/multysis-backend
npx ts-node src/database/seeds/run_missing_seeds.ts
```

### Fuzzy matching — citizen ↔ resident identity linking

The `citizen_resident_mapping` table links E-Services citizens to their BIMS resident records using `pg_trgm` similarity scoring.

```bash
# Run after importing resident and citizen data
psql "$UNIFIED_DB_URL" -f united-database/migrations/03_fuzzy_match.sql
```

| Score | Status | Meaning |
|---|---|---|
| ≥ 95 | `CONFIRMED` | Auto-confirmed match |
| 85–94 | `PENDING` | Probable match — awaiting staff review |
| Multiple matches | `NEEDS_REVIEW` | Ambiguous — staff must select the correct resident |
| < 85 | *(not inserted)* | No reliable match found |

---

## Testing

All mutation tests run against the live unified database. Both servers must be running first.

```bash
cd united-systems/

# Test all BIMS POST/PUT/DELETE routes
bash united-database/test_mutations_bims.sh

# Test all E-Services POST/PUT/DELETE routes
bash united-database/test_mutations_eservice.sh

# Test fuzzy matching integration
bash united-database/test_fuzzy_match.sh
```

Expected results on a clean database:

| Test suite | Tests | Expected |
|---|---|---|
| BIMS mutations | 39 | 39 PASS, 0 FAIL |
| E-Services mutations | 42 | 42 PASS, 0 FAIL, 4 SKIP |
| Fuzzy match | 12 | 12 PASS, 0 FAIL |

---

## Key Integration Points

### 1. BIMS warning on E-Services citizen approval

When an admin reviews a citizen registration request in E-Services, the approval UI shows a banner indicating whether a matching BIMS resident record was found:

| Status | Banner |
|---|---|
| `CONFIRMED` | Green — residency verified via BIMS |
| `PENDING` | Blue — probable match, awaiting confirmation |
| `NEEDS_REVIEW` | Orange — ambiguous, multiple residents matched |
| `NOT_FOUND` | Amber — no BIMS record found, verify before approving |

### 2. Open API (BIMS)

BIMS exposes a public API for third-party integrations secured with API keys:

```
GET /api/openapi/residents    — resident data
GET /api/openapi/households   — household data
GET /api/openapi/families     — family groupings
GET /api/openapi/barangays    — barangay list
GET /api/openapi/statistics   — demographic statistics
```

Manage API keys at: **BIMS Admin → Open API**

---

## Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full DevOps deployment guide covering:

- Vercel project setup for all four services
- Environment variable reference tables
- Pre-deployment fixes required (file uploads, `vercel.json`)
- Google OAuth + Supabase configuration
- Post-deployment checklist
- Known limitations on Vercel (Socket.io, Redis)

---

## Project Status

| Item | Status |
|---|---|
| Unified database schema | ✅ Deployed |
| BIMS backend — unified DB | ✅ Complete |
| E-Services backend — unified DB | ✅ Complete |
| BIMS GET routes | ✅ All passing |
| BIMS mutation routes | ✅ 39/39 passing |
| E-Services GET routes | ✅ All passing |
| E-Services mutation routes | ✅ 42/42 passing |
| Fuzzy matching | ✅ Implemented and tested |
| BIMS ↔ E-Services warning integration | ✅ Complete |
| File uploads → Supabase Storage | ⏳ Pre-deployment task |
| `vercel.json` for backends | ⏳ Pre-deployment task |
| Production deployment | ⏳ Pending |

---

*Borongan United Systems — City of Borongan, Eastern Samar*
*Built March 2026*
