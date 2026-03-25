# QA Report — United Systems Monorepo

**Date:** 2026-03-25  
**Analyst:** Vex 🔬  
**Scope:** `/home/anivaryam/github/repositories/united-systems/`  
**Systems Covered:** BIMS Frontend, BIMS Backend, E-Services (Multysis) Frontend + Backend, Database Schema + Seeds + Migrations

---

## Executive Summary

The United Systems monorepo is in a **partially overhaul state**. The v2 database schema (`schema.sql`) is clean and correctly removes puroks, deprecated entity tables, and old auth flows. However, **all four application layers (BIMS frontend, BIMS backend, E-Services frontend, E-Services backend) contain significant regressions** — active code and live API calls that reference the now-removed `puroks` table, deprecated entity names, and old architectural patterns.

**The biggest risk:** Multiple BIMS backend statistics and export endpoints actively JOIN the `puroks` table. The BIMS frontend actively calls purok API endpoints and enforces purok as a required form field. If the v2 schema (which has no `puroks` table) is deployed to the database, large portions of the application will crash at runtime.

---

## Severity Legend

| Symbol | Level | Meaning |
|---|---|---|
| 🔴 | CRITICAL | Will crash, corrupt data, or expose credentials in production |
| 🟠 | MAJOR | Functional violation, architecture breach, or significant security gap |
| 🟡 | MEDIUM | Stale code, incorrect labeling, usability issue |
| 🟢 | INFO | Low-risk observation, clean pass |

---

## Section 1 — BIMS Frontend

### 🔴 CRITICAL-1: Purok is an Active Required Form Field

**File:** `src/features/household/components/HouseholdLocationForm.jsx`  
**File:** `src/features/household/components/HouseholdForm.jsx`  
**File:** `src/utils/householdSchema.jsx` (line 6)

`purokId` is validated as a **required field** via Zod schema (`z.string().min(1, "Purok is required")`). Both household creation and editing forms:
- Fetch puroks on mount via `GET /list/{id}/purok`
- Render a dropdown for purok selection
- Submit `purokId` in the payload

**Impact:** If the backend `puroks` table is gone, household create/edit will fail to load (API error on mount) and form submission will send a field that no longer exists in the schema.

**Steps to Reproduce:**
1. Log in as barangay admin
2. Navigate to Households → Add/Edit Household
3. Observe network request to `/list/{id}/purok` (will 500 if table is dropped)
4. Attempt to submit without selecting a purok → validation blocks submission

---

### 🔴 CRITICAL-2: Dashboard Makes Per-Purok API Calls

**File:** `src/features/dashboard/hooks/useDashboardData.js`  
**File:** `src/hooks/useDashboardData.js`

Dashboard fetches `GET /list/{id}/purok` on load, then iterates over results to fetch per-purok population and household stats. If puroks table is gone:
- Dashboard will fail to load entirely
- All statistics panels depending on purok-filtered data will error

---

### 🔴 CRITICAL-3: Purok Displayed on Resident ID Card

**File:** `src/features/barangay/residents/components/ResidentIDCard.jsx` (lines 470–471)

The resident ID card prints `, {viewResident.purok_name.toUpperCase()}` inline. If `purok_name` is `null` or `undefined` (which it will be once puroks are removed), this will throw a JavaScript runtime error (`Cannot read properties of null (reading 'toUpperCase')`), crashing the ID card render.

---

### 🔴 CRITICAL-4: GuidePage Has Live Puroks Management Section

**File:** `src/pages/admin/shared/GuidePage.jsx` (lines 242–249)

The user-facing help guide contains a full "Puroks Management" section with:
- Feature description
- Navigable path `/admin/barangay/puroks`
- Bullet-point feature list

Users reading the guide will attempt to navigate to this path. The route is unmounted, so they will hit a 404/blank page with no explanation.

---

### 🔴 CRITICAL-5: Architecture Violation — Add Resident in BIMS (R2)

**File:** `src/features/barangay/residents/AddResidentDialog.jsx`  
**File:** `src/pages/admin/shared/ResidentsPage.jsx` (lines 1300–1308)

`AddResidentDialog` is a fully functional multi-step resident creation form (personal info, classification, photo upload, POST to create endpoint). It is mounted and accessible to barangay admin roles. Per architecture requirement **R2**: *"No resident and household registration in BIMS. All registration will happen in the front-facing portal."*

**This is a confirmed architecture violation.**

---

### 🟠 MAJOR-1: Purok Column Rendered in Residents and Households Tables

**File:** `src/features/barangay/residents/components/ResidentsTable.jsx` (lines 66, 91)  
**File:** `src/features/household/components/HouseholdTable.jsx` (lines 72, 113, 128)  
**File:** `src/features/household/components/HouseholdViewDialog.jsx` (lines 494, 674–676, 999–1001)  
**File:** `src/features/barangay/residents/components/ResidentViewDialog.jsx` (lines 451, 673–675)

All table views and detail dialogs include a "Purok" column/field displaying `purok_name`. With no purok data in the v2 schema, these will render empty or throw if `purok_name` is accessed without null-guarding.

---

### 🟠 MAJOR-2: Purok Filter Active in All List Pages

**Files:** `ResidentsFilters.jsx`, `HouseholdsFilters.jsx`, `PetFilters.jsx`, `FilterControls.jsx`

All list pages (Residents, Households, Pets, Dashboard) include a purok filter dropdown that:
- Fetches puroks from the API
- Sends `purokId` as a query param to filter results

With no purok data these dropdowns will be empty, but the API calls fire regardless.

---

### 🟠 MAJOR-3: BarangaySetupForm Creates Puroks

**File:** `src/features/barangay/BarangaySetupForm.jsx` (lines 92–216, 292–298)

The barangay setup wizard includes a step to create puroks via `POST /purok`. This is part of the onboarding flow. If a new installation follows this setup, it will attempt to insert into a non-existent `puroks` table.

---

### 🟠 MAJOR-4: Legacy MainApp.jsx Has Broken Import

**File:** `src/pages/admin/client/MainApp.jsx` (lines 9, 36–37)

Imports `PuroksPage` from `@/pages/admin/PuroksPage` (path doesn't exist in current structure). Renders it on `case "puroks":`. This file is a legacy client entrypoint — broken import will cause a build/runtime error if this code path is reached.

---

### 🟡 MEDIUM-1: Hardcoded "Borongan" References (20+ occurrences)

Violates R3 (multi-municipality reusability):

| File | Type |
|---|---|
| `Navigation.jsx` | Hardcoded logo filename `lgu-borongan.png`, alt text "LGU Borongan" |
| `MunicipalityBarangaysMap.jsx` | Fallback coordinates hardcoded to Borongan City |
| `LeafletMap.jsx`, `BarangayGeoMap.jsx` | Default center comments and fallback coords for Borongan |
| `HeroSection.jsx` | Image alt text "Borongan City" |
| Multiple component files | Comments with Borongan-specific coordinates |

---

### 🟡 MEDIUM-2: `routes.js` Stale PUROKS Constant

**File:** `src/constants/routes.js` (line 41)  
`PUROKS: '/admin/barangay/puroks'` still defined. Any code that imports `ADMIN_ROUTES.BARANGAY.PUROKS` will find a value pointing to an unmounted route.

---

### 🟡 MEDIUM-3: Map Popups Render Purok

**File:** `src/components/common/BarangayBoundaryMap.jsx` (lines 318–320)  
**File:** `src/components/common/LeafletMap.jsx` (lines 210, 233, 262)

Map popups include `Purok: {popup.purok}` in address display. Will render "Purok: undefined" or similar with no data.

---

### 🟡 MEDIUM-4: Household Import Template Lists purok_name as Required

**File:** `src/pages/admin/shared/HouseholdsPage.jsx` (lines 1051, 1141, 1143)

Bulk import documentation tells users `purok_name` is a required field and "Purok name must exist in the system." This instruction is now incorrect.

---

### 🟢 PASS: No Deprecated Entity References in Frontend

No references to `citizens`, `non_citizens`, `subscribers`, `otp_verifications`, or `addresses` (lookup table) found in BIMS frontend source files.

---

## Section 2 — BIMS Backend

### 🔴 CRITICAL-1: Live Statistics SQL JOINs `puroks` Table

**File:** `src/services/statisticsServices.js`  
Lines: 380, 1119, 1194, 1236, 1269, 1312

Six active statistics service functions perform `JOIN puroks p ON p.id = h.purok_id`. These are called by active, routed endpoints. If the `puroks` table is absent from the database, every stats API call will throw a PostgreSQL relation-not-found error.

**Affected endpoints (via statisticsControllers.js):**
- `getHouseholdSizeDemographics`
- `getDetailedPopulationStatsByPurok`
- `getDetailedHouseholdStatsByPurok`
- `getDetailedFamilyStatsByPurok`
- And related queries

---

### 🔴 CRITICAL-2: Household Excel Import Queries `puroks` Table

**File:** `src/services/barangayServices.js` (line 2106)

```sql
SELECT id FROM puroks WHERE purok_name = $1 AND barangay_id = $2
```

This is in the active household bulk Excel import code path. Any import will fail at runtime if `puroks` table is dropped.

---

### 🔴 CRITICAL-3: Full Purok CRUD Stack Still in Codebase (Unrouted But Armed)

**Files:** `src/controllers/barangayControllers.js` (lines 597–714), `src/services/barangayServices.js` (lines 283–588)

Complete CRUD stack (`upsertPurok`, `deletePurok`, `purokList`, `purokInfo`) exists and is exported. Routes were removed, but the code is live. One accidental route binding reinstates the full purok API.

---

### 🟠 MAJOR-1: `purokId` Passed Throughout All Active Controller Paths

**Files:** `barangayControllers.js`, `municipalityControllers.js`, `statisticsControllers.js`, `householdControllers.js`, `petsControllers.js`

`purokId` is extracted from `req.query.purokId` and passed to service layers across all major controllers. The parameter flows through to SQL queries that either:
- JOIN the puroks table (crash risk), or
- Filter by `purok_id` on the households table (column also removed in v2 schema)

---

### 🟠 MAJOR-2: Rate Limiter Built But Never Applied

**File:** `src/middlewares/rateLimiter.js` + `app.js`

A fully-implemented Redis-backed rate limiter exists with per-IP, per-user, per-endpoint, and burst variants. It is **never imported or applied** in `app.js` or any route file. All API endpoints are unprotected against brute force and spam.

---

### 🟠 MAJOR-3: Internal Error Messages Exposed to Client

**File:** `src/routes/registrationRoutes.js` (multiple catch blocks)

Raw `err.message` is returned directly in 500 error responses to API consumers. This can leak internal table names, query structure, or stack trace fragments.

---

### 🟠 MAJOR-4: `smartCache.js` Has Dead Purok Cache Rules

**File:** `src/middlewares/smartCache.js` (lines 37, 180–184)

Cache rule for `/puroks` endpoint and invalidation patterns for `smart:puroks:*` / `smart:purok:*` remain. Dead but adds confusion and unnecessary cache checks.

---

### 🟡 MEDIUM-1: Hardcoded Credential Fragments in Scripts

**File:** `src/scripts/convertShapefileToSQL.js` (lines 114, 153)  
**File:** `src/scripts/testOgr2ogr.js` (line 25)

`password=1234` appears in SQL comment strings. If this matches any live database credential it must be rotated. Regardless, credentials (even stale ones) should be scrubbed from committed scripts.

---

### 🟡 MEDIUM-2: Bug — `purokInfo` Controller Returns Error Instead of `next(error)`

**File:** `src/controllers/barangayControllers.js` (line 710)

```js
} catch (error) {
    if (error instanceof ApiError) return error;  // ← BUG
```

Should be `return next(error)`. Error is returned as a resolved async value, not passed to Express error handler. Endpoint will hang with no response on certain errors. (Dead code currently, but the pattern may be copy-pasted elsewhere.)

---

### 🟡 MEDIUM-3: Orphaned Migration Scripts Targeting `puroks`

| Script | Issue |
|---|---|
| `add_purok_unique_constraint.js` | Full migration targeting `puroks` table |
| `optimizeDatabase.js` | Creates 3 indexes on `puroks` + 7 composite indexes with `purok_id` |
| `rollbackMigration.js` | `DELETE FROM puroks` in rollback; `COUNT(*) FROM puroks` in health check |
| `seedDatabase.js` | Creates `puroks` DDL + `households.purok_id` FK |
| `completeMigration.js`, `unifiedMigration.js`, `migrateDB.js` | Reference `puroks` in table lists |

All these will fail or produce misleading output if run against the v2 schema.

---

### 🟢 PASS: No Resident CREATE Endpoint in BIMS (R2 Compliant)

Resident routes are confirmed read-only. No `INSERT_RESIDENT` query exists. Registration approval flow is correctly implemented (approve/reject portal submissions — not direct creation). **R2 is architecturally compliant on the backend.**

### 🟢 PASS: No Deprecated Table References in Active SQL

No queries referencing `citizens`, `non_citizens`, `subscribers`, or `addresses` (lookup) found in active BIMS backend code.

### 🟢 PASS: SQL Injection — Clean

All dynamic WHERE clauses use parameterized `$N` placeholders throughout. One dynamic table name in `vaccineControllers.js` is whitelisted before use. No SQL injection vectors found.

### 🟢 PASS: CORS Configured via Environment Variable

---

## Section 3 — E-Services (Multysis)

### 🔴 CRITICAL-1: `upload.routes.ts` Prisma Query Includes Non-Existent Relations

**File:** `multysis-backend/src/routes/upload.routes.ts` (lines 33, 51, 104–105)

```ts
prisma.resident.findUnique({ include: { nonCitizen: true } })
prisma.resident.findUnique({ include: { citizen: {...}, nonCitizen: {...} } })
```

`nonCitizen` and `citizen` relations **do not exist** on the `Resident` Prisma model. These are removed v1 models. Hitting this upload endpoint at runtime will throw a **Prisma validation error**, breaking profile picture uploads entirely.

---

### 🔴 CRITICAL-2: FAQ Seed Contains Wrong Login Instructions

**File:** `multysis-backend/src/database/seeds/faq.seed.ts` (lines 12, 19)

FAQ seed text states:
- `"two types of subscribers: Non-Citizens and Citizens"` — old model, doesn't exist
- `"phone number and password"` — old login method, replaced by username+password

If this seed is re-run (e.g., on a fresh install or staging reset), the portal FAQ will actively mislead users about how to register and log in.

---

### 🟠 MAJOR-1: Upload Routes Use Old `/subscribers/:id/` URL Pattern

**File:** `multysis-backend/src/routes/upload.routes.ts` (lines 17, 97)

Active route paths: `POST /subscribers/:id/profile-picture`. These are registered in the router. The naming is stale (`subscribers` → `residents`) and the Prisma queries inside are broken (see CRITICAL-1 above).

---

### 🟠 MAJOR-2: Dashboard Stats Use Old `totalCitizens` / `totalNonCitizens` Field Names

**File:** `multysis-frontend/src/components/admin/dashboard/OverviewCards.tsx` (line 41)  
**File:** `multysis-frontend/src/services/api/dashboard.service.ts` (lines 10–11)  
**File:** `multysis-frontend/src/components/admin/dashboard/SubscriberAnalytics.tsx` (lines 15, 37, 44, 53)

TypeScript interface and dashboard components still reference `totalCitizens` and `totalNonCitizens`. If the backend returns `totalResidents` (the v2 field name), these panels will display `undefined` or 0.

---

### 🟠 MAJOR-3: Full Deprecated Modal Directories Still Present

**Frontend:**
- `components/modals/citizens/` — 7 citizen modals (`AddCitizenModal`, `EditCitizenModal`, `ApproveCitizenModal`, etc.)
- `components/modals/subscribers/` — subscriber management modals
- `components/subscribers/forms/` — all forms under old subscribers namespace

These components may or may not be reachable from active routes, but their presence and exports create import ambiguity and inflate the bundle.

---

### 🟠 MAJOR-4: `audit.ts` Middleware Audits Non-Existent Routes

**File:** `multysis-backend/src/middleware/audit.ts` (lines 136–137)

Audit middleware is configured to flag `/api/subscribers` and `/api/citizens` as sensitive paths. Neither route exists. Actual resident endpoints (`/api/residents`) are not in the audit sensitive list — meaning resident data access is silently unaudited.

---

### 🟠 MAJOR-5: Sidebar Routes Reference Old Paths

**File:** `multysis-frontend/src/components/layout/Sidebar.tsx` (lines 28–29)  
**File:** `multysis-frontend/src/config/admin-menu.tsx` (lines 74, 181)

Admin sidebar contains `/admin/subscribers` and `/admin/citizens` paths. The label was updated to `"Residents"` in `admin-menu.tsx` but the path was not, causing a label/route mismatch.

---

### 🟠 MAJOR-6: `PortalSignupSheet.tsx` References Old Citizen/Non-Citizen Model

**File:** `multysis-frontend/src/components/...PortalSignupSheet.tsx` (line 143)

Still labels the form as "for non-resident subscribers only" and references "Citizens of Borongan" needing to register elsewhere. This two-tier citizen/non-citizen model no longer exists in v2.

---

### 🟡 MEDIUM-1: `.env` File Committed to Repository

**File:** `multysis-backend/.env`

The actual `.env` file is present in the repo. While current content contains only placeholder values, the file being committed means it may be tracked by git. If a developer ever puts real credentials in it and commits, secrets are exposed. Standard practice is to `.gitignore` all `.env` files and only commit `.env.example`.

---

### 🟡 MEDIUM-2: Dead OTP/SMS Service Files in Backend

**Files:** `src/services/sms.service.ts`, `src/validations/auth.schema.ts` (OTP schemas)

`sendOtpSms()`, `verifyOtpValidation`, `portalLoginValidation` (phone) are all still present. Confirmed not imported by any active route. Dead code, but creates confusion and inflates the codebase.

---

### 🟡 MEDIUM-3: `admin-resources.ts` Still Lists `subscribers` and `citizens` as Permission Resources

**File:** `multysis-backend/src/utils/admin-resources.ts` (lines 14–15)

RBAC resource values include `'subscribers'` and `'citizens'`. These should be `'residents'` to match the v2 unified model. Any permissions seeded using these resource names will not match actual endpoints.

---

### 🟡 MEDIUM-4: `displayInSubscriberTabs` Field on `Service` Model

**File:** `multysis-backend/prisma/schema.prisma`

Field retains old `subscriber` terminology. Should be `displayInResidentTabs` for consistency with v2 naming.

---

### 🟢 PASS: Purok — Fully Clean

Zero purok references in E-Services frontend or backend. Registration wizard uses `barangayId` + `streetAddress`. Prisma schema has no purok columns. **Fully compliant.**

### 🟢 PASS: Prisma Schema Core — Aligned to v2

Unified `Resident` model in place. `ResidentCredential` separation correct. No `citizens`, `non_citizens`, `subscribers`, `otp_verifications`, `citizen_resident_mapping` tables. OAuth fields present. No purok FK.

### 🟢 PASS: Portal Login — Correct

`PortalLogin.tsx` uses username+password. No phone number field. Google OAuth supported. OTP flow is correctly removed from active UI.

### 🟢 PASS: Registration Wizard — No Purok

Registration steps use `barangayId` + `streetAddress`. No purok step. No phone OTP step. Correct per R4 and R5.

### 🟢 PASS: JWT Implementation — Correct

JWT secret loaded from env, validated ≥32 chars on startup. Refresh token rotation implemented.

### 🟢 PASS: CORS — Configured via Environment Variable

---

## Section 4 — Database Schema & Migrations

### 🔴 CRITICAL-1: Production Credentials in Test Script

**File:** `united-database/test_fuzzy_match.sh`

```bash
UNIFIED_DB_URL="${UNIFIED_DB_URL:-postgresql://postgres.exahyuahguriwrkkeuvm:rPb3%26gYLXpr%40gH%3F@aws-1-ap-south-1.pooler.supabase.com:5432/postgres}"
```

A **Supabase production connection string with embedded credentials** is hardcoded as the default fallback in a test script committed to the repository. This is a credential exposure. The password must be rotated immediately and the script cleaned up.

---

### 🔴 CRITICAL-2: Test Script References Dropped Tables

**File:** `united-database/test_fuzzy_match.sh`

Script inserts test data into `citizens` and `citizen_resident_mapping` — both dropped in v2. Running this test script against the new schema will fail immediately with a relation-not-found error. The test suite is completely broken for v2.

---

### 🟠 MAJOR-1: Missing Enforced FK Constraints

Several columns documented as FKs in schema comments have no actual `ALTER TABLE ADD CONSTRAINT` statement:

| Table | Column | Risk |
|---|---|---|
| `exemptions` | `requested_by` (→ residents) | Orphaned exemptions on resident delete |
| `exemptions` | `approved_by` (→ eservice_users) | Ghost approver references |
| `payments` | `received_by` (→ eservice_users) | Ghost receiver references |
| `certificate_templates` | `created_by` | Comment explicitly says FK, no constraint exists |

---

### 🟠 MAJOR-2: No Unique Constraint on `resident_classifications`

No `UNIQUE(resident_id, classification_type)` constraint. A resident can be classified as "Senior Citizen" twice with no database-level prevention.

---

### 🟠 MAJOR-3: Audit Triggers Missing on Sensitive Tables

`audit_logs` triggers are not attached to:
- `officials` — changes to elected barangay officials are untracked (politically sensitive)
- `bims_users` — staff account creation/deletion untracked
- `vaccines` — vaccination record changes untracked
- `resident_classifications` — classification changes untracked

---

### 🟠 MAJOR-4: Data Loss Risks in Migration

| Risk | Detail |
|---|---|
| `resident_status` → `status` | Column renamed, not documented in migration plan. Existing data would need column rename during migration or data will be inaccessible. |
| `birthplace` → `birth_region`, `birth_province`, `birth_municipality` | Old single text field split into 3 columns. No migration logic exists to parse old data into new columns. |
| `residents.suffix` → `extension_name` | Column renamed. Not in migration plan. |
| `households.purok_id` removed | Intentional per R4, but not documented as a known data loss event in the migration plan. |

---

### 🟠 MAJOR-5: `MIGRATION_PLAN.md` Is Stale and Contradictory

- Still lists `puroks` as a living table in Phase 1 inventory
- Phase 1, 2, and 4 are built around `citizens` and `citizen_resident_mapping` tables that no longer exist
- Header targets "Borongan" specifically — contradicts R3 multi-municipality requirement
- Phase 1 table inventory lists 28 tables to migrate including `citizens`, `non_citizens`, `subscribers`, `otp_verifications` — all removed in v2

---

### 🟠 MAJOR-6: Missing Index on `audit_logs.changed_by`

FK column with no supporting index. As audit logs grow, queries filtering by user (`WHERE changed_by = ?`) will require full table scans.

---

### 🟡 MEDIUM-1: `MIGRATION_PLAN.md` Stale Purok Reference

Migration plan labels `puroks` as an active table in the table inventory section despite it being removed from the actual schema. Documentation contradicts implementation.

---

### 🟡 MEDIUM-2: `resident_classifications.resident_id` Is Nullable

FK column declared as `text` with no `NOT NULL` constraint, but has `ON DELETE CASCADE`. A classification with `resident_id = NULL` would survive any resident deletion and persist indefinitely.

---

### 🟢 PASS: `schema.sql` — Fully Clean

No `puroks` table. No `purok_id` columns in `households`, `residents`, or `families`. No `citizens`, `non_citizens`, `subscribers`, `otp_verifications`, `citizen_resident_mapping`, or `addresses` (lookup) tables.

### 🟢 PASS: `seed.sql` — Clean

Zero purok references. Roles and permissions properly seeded.

### 🟢 PASS: `residents.id` Correctly Changed to UUID

PK is now `text DEFAULT gen_random_uuid()`. Globally unique, safe to expose in API responses.

---

## Consolidated Severity Matrix

| # | Finding | System | Severity |
|---|---|---|---|
| 1 | Production Supabase credentials hardcoded in test script | Database | 🔴 CRITICAL |
| 2 | Live statistics SQL JOINs `puroks` table — runtime crash if table dropped | BIMS Backend | 🔴 CRITICAL |
| 3 | Household creation form: purok is a required field, API called on mount | BIMS Frontend | 🔴 CRITICAL |
| 4 | Dashboard per-purok API iteration — will crash if puroks table gone | BIMS Frontend | 🔴 CRITICAL |
| 5 | `upload.routes.ts` Prisma includes non-existent `nonCitizen` relation — runtime error on upload | E-Services Backend | 🔴 CRITICAL |
| 6 | Resident ID card crashes on `purok_name.toUpperCase()` if null | BIMS Frontend | 🔴 CRITICAL |
| 7 | AddResidentDialog mounted and accessible — violates R2 | BIMS Frontend | 🔴 CRITICAL |
| 8 | GuidePage help section links to removed `/admin/barangay/puroks` route | BIMS Frontend | 🔴 CRITICAL |
| 9 | Household Excel import queries `puroks` table — runtime crash | BIMS Backend | 🔴 CRITICAL |
| 10 | Full purok CRUD stack unrouted but live — one binding reinstates it | BIMS Backend | 🔴 CRITICAL |
| 11 | Test script references dropped `citizens` / `citizen_resident_mapping` tables — test suite broken | Database | 🔴 CRITICAL |
| 12 | FAQ seed describes old phone+OTP login and citizen/non-citizen model | E-Services Backend | 🔴 CRITICAL |
| 13 | Rate limiter middleware never applied — all endpoints unprotected | BIMS Backend | 🟠 MAJOR |
| 14 | Missing FK constraints on `exemptions`, `payments`, `certificate_templates` | Database | 🟠 MAJOR |
| 15 | No unique constraint on `resident_classifications` — duplicate classification possible | Database | 🟠 MAJOR |
| 16 | Audit triggers missing on `officials`, `bims_users`, `vaccines` | Database | 🟠 MAJOR |
| 17 | Data loss risks in migration (column renames, birthplace split) — not in migration plan | Database | 🟠 MAJOR |
| 18 | `MIGRATION_PLAN.md` stale — describes v1 architecture, references dropped tables | Database | 🟠 MAJOR |
| 19 | `purokId` passed through all active controller query paths | BIMS Backend | 🟠 MAJOR |
| 20 | Internal `err.message` exposed in API error responses | BIMS Backend | 🟠 MAJOR |
| 21 | Upload routes use old `/subscribers/:id/` URL pattern | E-Services Backend | 🟠 MAJOR |
| 22 | Dashboard stats use `totalCitizens`/`totalNonCitizens` field names — will show 0 in v2 | E-Services Frontend | 🟠 MAJOR |
| 23 | Deprecated modal directories (`/citizens/`, `/subscribers/`) still present | E-Services Frontend | 🟠 MAJOR |
| 24 | Audit middleware tracks non-existent `/api/subscribers` path, misses `/api/residents` | E-Services Backend | 🟠 MAJOR |
| 25 | Sidebar routes reference old `/admin/subscribers` and `/admin/citizens` paths | E-Services Frontend | 🟠 MAJOR |
| 26 | PortalSignupSheet references old citizen/non-citizen distinction | E-Services Frontend | 🟠 MAJOR |
| 27 | Purok rendered in table columns, view dialogs, and map popups | BIMS Frontend | 🟠 MAJOR |
| 28 | BarangaySetupForm creates puroks during onboarding — will crash | BIMS Frontend | 🟠 MAJOR |
| 29 | Hardcoded `password=1234` in script comments | BIMS Backend | 🟡 MEDIUM |
| 30 | 20+ hardcoded Borongan references — violates R3 | BIMS Frontend | 🟡 MEDIUM |
| 31 | `routes.js` PUROKS constant still defined | BIMS Frontend | 🟡 MEDIUM |
| 32 | `routes.js` PUROKS route constant stale | BIMS Frontend | 🟡 MEDIUM |
| 33 | Dead OTP/SMS service files remain in E-Services backend | E-Services Backend | 🟡 MEDIUM |
| 34 | `.env` committed to repo (placeholder values, but hygiene violation) | E-Services Backend | 🟡 MEDIUM |
| 35 | `admin-resources.ts` lists `subscribers`/`citizens` as RBAC resources | E-Services Backend | 🟡 MEDIUM |
| 36 | `displayInSubscriberTabs` field name — stale terminology | E-Services Backend | 🟡 MEDIUM |
| 37 | Orphaned migration scripts targeting puroks table | BIMS Backend | 🟡 MEDIUM |
| 38 | `smartCache.js` has dead purok cache rules | BIMS Backend | 🟡 MEDIUM |
| 39 | `resident_classifications.resident_id` nullable — orphaned records possible | Database | 🟡 MEDIUM |
| 40 | Missing index on `audit_logs.changed_by` | Database | 🟡 MEDIUM |

---

## Pre-Deployment Blockers

The following must be resolved **before deploying the v2 schema to any live database:**

1. Rotate the Supabase credentials exposed in `test_fuzzy_match.sh`
2. Fix all backend SQL that JOINs or queries `puroks` table (statistics services, export, Excel import)
3. Remove `purokId` as a required field from all household forms
4. Fix `upload.routes.ts` Prisma includes for non-existent `nonCitizen`/`citizen` relations
5. Fix `ResidentIDCard.jsx` null guard on `purok_name`
6. Remove or gate `AddResidentDialog` from BIMS (R2 violation)
7. Fix or disable the FAQ seed content
8. Fix dashboard stats field names (`totalCitizens` → `totalResidents`)

---

## Section 5 — Schema v2 Patch Verification (Post-Report Delta)

*Schema updated: 2026-03-25 10:09 — after initial report was generated. This section verifies fixes applied.*

### 🟢 FIXED: `resident_classifications.resident_id` Now NOT NULL
`ALTER TABLE resident_classifications ALTER COLUMN resident_id SET NOT NULL;` — confirmed applied at end of schema.sql.

### 🟢 FIXED: Unique Constraint on `resident_classifications`
`UNIQUE (resident_id, classification_type)` constraint added. Duplicate classification entries are now DB-enforced.

### 🟢 FIXED: Missing FK on `exemptions.requested_by` and `exemptions.approved_by`
Both FK constraints now present in schema with appropriate `ON DELETE` behavior.

### 🟢 FIXED: Missing FK on `payments.received_by`
FK to `eservice_users(id)` with `ON DELETE SET NULL` applied.

### 🟢 FIXED: Missing Index on `audit_logs.changed_by`
`CREATE INDEX idx_audit_logs_changed_by ON public.audit_logs USING btree (changed_by);` confirmed.

### 🟢 FIXED: Missing Audit Triggers on `officials`, `bims_users`, `vaccines`, `resident_classifications`
All four triggers confirmed at end of schema.sql. Audit coverage now complete on sensitive tables.

### 🟢 FIXED (Backend): Purok Stats Methods Stubbed Out
`getDetailedHouseholdStatsByPurok`, `getDetailedFamilyStatsByPurok` now return empty arrays. No runtime crash risk from these methods.

---

## Section 6 — Database Performance Analysis

**Focus:** Query design, index coverage, and runtime cost of high-frequency operations.

### 🔴 PERF-1: `EXTRACT()` Date Filters Prevent Index Use on `created_at`

**Files:** `statisticsServices.js` (lines 497, 520–521, 561–562, 778–779, 801–802, 871–872, 996–997, 1011–1012, 1041–1042)

All "added this month" queries across residents, households, families, and pets use:

```sql
WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)
AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
```

`EXTRACT()` applied to a column is a **non-SARGable predicate** — PostgreSQL cannot use a standard B-tree index on `created_at` with this pattern. The planner will perform a **full sequential scan** on the entire table, applying the function to every row.

**Correct approach:**
```sql
WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
AND created_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
```
This is index-friendly and will use a range scan if an index on `created_at` exists.

**Additionally:** No index exists on `residents.created_at`, `households.created_at`, `families.created_at`, or `pets.created_at`. These queries will always full-scan regardless of pattern until both are fixed.

**Affected query count:** 10+ occurrences across statisticsServices.js alone.
**Severity at scale:** As resident/household counts grow, each dashboard load triggers multiple full table scans.

---

### 🔴 PERF-2: Resident Search Uses `ILIKE` on `CONCAT_WS` — GIN Index Bypassed

**File:** `residentServices.js` (lines 117–119)

```sql
WHERE CONCAT_WS(' ', r.first_name, r.middle_name, r.last_name, r.extension_name) ILIKE $1
OR r.resident_id ILIKE $1
OR r.username ILIKE $1
```

The schema defines a GIN full-text index (`idx_residents_full_text`) on `to_tsvector('english', last_name || ' ' || first_name || ...)`. However, the actual search query uses `ILIKE` on a `CONCAT_WS` expression — **the GIN index is never used**. Every resident search is a full sequential scan with expression evaluation on every row.

**Additionally:** `ILIKE` with a leading wildcard (`%search%`) cannot use a B-tree index either — separate indexes on `first_name` and `last_name` are also bypassed by this pattern.

**Impact:** Any search on the residents list performs O(n) work. At 10,000+ residents per barangay, this is a noticeable bottleneck.

**Correct approach:** Use the GIN index via `to_tsvector` / `@@` operator, or use `pg_trgm` GIN index for partial `ILIKE` support.

---

### 🔴 PERF-3: Household List Query — Triple UNION Subquery for Income Calculation Per Page

**File:** `householdServices.js` (lines ~570–615)

The paginated household list runs a nested UNION subquery on every page load to calculate `total_monthly_income` per household:

```sql
LEFT JOIN (
  SELECT household_id, SUM(monthly_income)
  FROM (
    SELECT h.id, r.monthly_income FROM households h JOIN residents r ON ...
    UNION
    SELECT fam.household_id, r.monthly_income FROM families fam JOIN residents r ...
    UNION
    SELECT fam2.household_id, r_mem.monthly_income FROM families fam2 JOIN family_members ...
    JOIN residents r_mem ...
  )
  GROUP BY household_id
) income_stats ON h.id = income_stats.household_id
```

This subquery runs a 3-way UNION across three separate JOIN chains for **every page request**, even when income data isn't needed by the caller. There is no index to support the income aggregation paths (no index on `residents.monthly_income`, `families.household_id` join chain).

**Impact:** Compound O(n) cost per page. As households scale, list pagination degrades.

**Recommendation for dev team:** Either pre-aggregate income at write time (denormalized column on `households`), or separate the income calculation into a dedicated on-demand query.

---

### 🟠 PERF-4: Statistics Dashboard Makes Sequential Separate DB Round-Trips

**File:** `statisticsServices.js`

Dashboard statistics calls `getPopulationStats`, `getSexDistribution`, `getCivilStatusDistribution`, `getEducationDistribution`, `getEmploymentDistribution`, `getHouseholdStats`, `getFamilyStats` — each as a **separate independent query**. These fire sequentially (or at best in parallel via `Promise.all` in the controller layer, to be confirmed).

Each query re-scans the `residents` table independently. A single well-structured query with `FILTER` aggregates could return all demographic stats in one pass.

**Impact:** Multiple sequential scans per dashboard load. On a large barangay, each is a full table scan (compounded by PERF-1).

---

### 🟠 PERF-5: N+1 Pattern — Transaction List Fetches Tax Computation Per Transaction

**File:** `transaction.service.ts` (lines 291–335)

```ts
const transactionsWithTaxData = await Promise.all(
  transactions.map(async (transaction) => {
    // per-transaction tax/payment computation
  })
);
```

While `Promise.all` runs in parallel, this still fires **N Prisma queries** (one per transaction on the page) to resolve `taxComputations` and `payments`. With a page size of 20, that's 20 parallel DB hits every time the transaction list loads.

The correct approach is to use Prisma `include` with eager loading so Prisma fetches all tax computations in a single JOIN query.

**Note:** A separate `findMany` for `taxComputations` by `transactionIds` is done on lines 719–721, which partially addresses this for admin view. The subscriber view (lines 291–335) still has the per-item pattern.

---

### 🟠 PERF-6: Missing `created_at` Indexes on High-Traffic Tables

**Source:** `schema.sql` index section (lines 1329–1451)

No `created_at` indexes exist on:

| Table | Impact |
|---|---|
| `residents` | "Added this month" stat scans entire table |
| `households` | Same |
| `families` | Same |
| `pets` | Same |
| `audit_logs` | `changed_at` is indexed, but `created_at` is not (same column, different naming) — confirm |

Combined with PERF-1 (non-SARGable predicates), stats queries will always full-scan until both the predicate pattern and index coverage are fixed.

---

### 🟠 PERF-7: Household Search Uses `ILIKE` on Unindexed Columns

**File:** `householdServices.js` (lines 528–531)

```sql
WHERE h.house_number ILIKE $1
OR h.street ILIKE $1
OR r.first_name ILIKE $1
OR r.last_name ILIKE $1
```

`idx_households_search` covers `(house_number, street)` as a partial B-tree index — but `ILIKE` with a leading wildcard (`%term%`) **cannot use a B-tree index**. The search is a full scan. `r.first_name` and `r.last_name` are indexed individually but also bypassed by the `ILIKE %term%` pattern.

---

### 🟡 PERF-8: `getUnemployedHouseholdStats` — Deeply Nested Subquery with No Index Support

**File:** `statisticsServices.js` (lines ~1230–1310)

The unemployed household stats query uses a two-level nested subquery with a UNION inside a correlated subquery to gather house heads + family members, then groups at the outer level. No composite index supports the `household_id` → `family_head` → `family_member` join chain. At scale this will be one of the slowest queries in the system.

---

### Performance Summary

| # | Finding | Severity |
|---|---|---|
| PERF-1 | `EXTRACT()` on `created_at` — non-SARGable, full table scans on every "this month" stat | 🔴 CRITICAL |
| PERF-2 | Resident search uses `ILIKE CONCAT_WS` — GIN index bypassed, full scan on every search | 🔴 CRITICAL |
| PERF-3 | Household list runs triple UNION income subquery on every paginated page load | 🔴 CRITICAL |
| PERF-4 | Dashboard stats fire independent sequential queries — each a full scan on residents | 🟠 MAJOR |
| PERF-5 | Transaction list: N+1 per-transaction tax/payment fetch in subscriber view | 🟠 MAJOR |
| PERF-6 | No `created_at` indexes on `residents`, `households`, `families`, `pets` | 🟠 MAJOR |
| PERF-7 | Household search `ILIKE %term%` cannot use any B-tree index | 🟠 MAJOR |
| PERF-8 | Unemployed household stats: deeply nested UNION subquery with no index support | 🟡 MEDIUM |

---

*Report updated: 2026-03-25 10:30 | Vex 🔬*
