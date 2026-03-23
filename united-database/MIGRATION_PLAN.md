# Database Merge Plan: BIMS + E-Services → Supabase Unified DB

**Created:** Mar 23, 2026
**Status:** Schema deployed — ready for go-live
**Approach:** Direct Schema Merge
**Target:** Supabase (Borongan Unified System project)
**Schema home:** `united-database/`

---

## Overview

Both the Barangay Information Management System (BIMS) and the Borongan E-Services system (Multysis) will have their PostgreSQL databases merged into a single Supabase PostgreSQL instance. Both backends will then be updated to connect to this unified DB. The `united-database/` directory is the canonical home for the unified schema, migration scripts, and documentation.

**Key decisions:**

| Decision | Choice |
|---|---|
| Migration approach | Direct Schema Merge |
| Database host | Supabase (existing Borongan Unified System project) |
| Schema home | `united-database/` |
| User tables | Separate: `bims_users` + `eservice_users` |
| Requests vs Transactions | Keep as separate tables |
| Identity linking | Fuzzy name matching + birthdate, staff confirmation |
| BIMS ORM | Raw SQL — rename queries manually |
| E-Services ORM | Prisma — one-line `@@map` change |
| BIMS-specific features | GIS (PostGIS), audit triggers — preserved as-is |

---

## System Reference

| Aspect | BIMS | E-Services (Multysis) |
|---|---|---|
| Purpose | Barangay-level resident/household management for municipal staff | Citizen-facing online government service portal |
| Language | JavaScript (ES Modules) | TypeScript |
| Backend | Express.js v5 | Express.js v4 |
| Database | PostgreSQL via raw `pg` pool | PostgreSQL via Prisma ORM v5 |
| Schema source | `main-db.sql` | `prisma/schema.prisma` |
| DB name | `bims_production` | `multysis` |
| Core entity | `residents` (string ID: `RES-2025-001`) | `citizens` / `non_citizens` (UUID) |
| Tables | ~20 tables | 28 models |
| GIS | PostGIS + Leaflet | None |

---

## Conflicts & Resolutions

The two schemas share the following table name collisions that must be resolved before merging:

| Conflict | BIMS Table | E-Services Table | Resolution |
|---|---|---|---|
| Users | `users` (integer PK, municipality/barangay scoped, JWT auth) | `users` (UUID PK, portal admin, RBAC) | Rename to `bims_users` and `eservice_users` |
| Addresses | No direct equivalent (address fields embedded in `residents`/`households`) | `addresses` (reference lookup table) | Keep E-Services `addresses` as-is; no conflict |
| Primary key types | Integer / custom `varchar` (`RES-YYYY-NNN`) | UUID (`gen_random_uuid()`) | No collision — different tables. Both formats are preserved. |

### Bridge Table: `citizen_resident_mapping`

A new table must be added to the unified schema to link E-Services `citizens` to BIMS `residents`. This is the core cross-system link.

```sql
CREATE TABLE citizen_resident_mapping (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id    UUID         NOT NULL REFERENCES citizens(id),
  resident_id   VARCHAR(20)  NOT NULL REFERENCES residents(id),
  match_score   NUMERIC(5,2),             -- fuzzy match confidence 0.00–100.00
  match_method  VARCHAR(20),              -- 'AUTO_FUZZY' | 'MANUAL'
  status        VARCHAR(20)  DEFAULT 'PENDING', -- PENDING | CONFIRMED | REJECTED | NEEDS_REVIEW
  matched_by    VARCHAR(100),             -- staff who confirmed or rejected
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  confirmed_at  TIMESTAMPTZ,
  UNIQUE (citizen_id),
  UNIQUE (resident_id)
);
```

---

## Phase 0 — Preparation

**Goal:** Set up the unified database structure and safety checkpoints before touching either live system.

**Tasks:**

1. **Backup both databases**
   - `pg_dump bims_production > bims_backup_$(date +%Y%m%d).sql`
   - `pg_dump multysis > multysis_backup_$(date +%Y%m%d).sql`
   - Store backups in version control or object storage before proceeding.

2. **Tag both system repos** with a `pre-merge` git tag as safe rollback points.
   ```bash
   git tag pre-merge && git push origin pre-merge
   ```

3. **Verify Supabase project** is accessible and ready:
   - PostGIS extension is enabled (required for BIMS GIS data): `CREATE EXTENSION IF NOT EXISTS postgis;`
   - Connection pooling is configured for both backends (PgBouncer URL for app queries, direct URL for migrations).
   - Check current DB size vs. Supabase plan limits.

4. **Create `united-database/` file structure** (this file is the first step).

**Deliverables:** Full backups stored, baseline git tags created, Supabase connectivity confirmed, PostGIS enabled.

---

## Phase 1 — Unified Schema Definition

**Goal:** Produce the final unified `schema.sql` in `united-database/`.

### Full Table Inventory

**From BIMS** (20 tables):

| Table | Notes |
|---|---|
| `municipalities` | Top-level admin unit |
| `barangays` | Sub-unit of municipality |
| `puroks` | Neighborhood zones within a barangay |
| `residents` | Core resident records; custom string PK (`RES-YYYY-NNN`) |
| `resident_classifications` | Flexible tags per resident (PWD, senior, etc.) |
| `resident_counters` | Auto-increment counter for generating resident IDs |
| `classification_types` | Municipality-configurable classification definitions |
| `households` | Physical dwellings with PostGIS geometry |
| `families` | Family group within a household |
| `family_members` | Links residents to families |
| `officials` | Barangay officials linked to residents |
| `bims_users` | **Renamed from `users`** — municipal/barangay staff accounts |
| `requests` | Walk-in barangay certificate/appointment requests |
| `inventories` | Barangay asset/inventory management |
| `archives` | Document archive per barangay |
| `pets` | Pet registry linked to resident owners |
| `vaccines` | Vaccination records (pets and residents) |
| `audit_logs` | Full change history via database triggers |
| `gis_municipality` | PostGIS spatial data for municipalities |
| `gis_barangay` | PostGIS spatial data for barangays |
| `api_keys` | API key management (dynamic table) |

**From E-Services** (28 tables):

| Table | Notes |
|---|---|
| `eservice_users` | **Renamed from `users`** — portal admin accounts |
| `subscribers` | Portal login gateway; links to citizen or non-citizen |
| `citizens` | Full citizen profile (verified portal users) |
| `non_citizens` | Portal users not yet verified as citizens |
| `citizen_registration_requests` | Registration review workflow |
| `place_of_birth` | Birth location for citizen or non-citizen |
| `mother_info` | Mother's name for non-citizen records |
| `roles` | Role definitions (RBAC) |
| `permissions` | Permission definitions (RBAC) |
| `role_permissions` | Pivot: roles ↔ permissions |
| `user_roles` | Pivot: users ↔ roles |
| `refresh_tokens` | Refresh token store for users and subscribers |
| `sessions` | Active session tracking |
| `services` | Transactional service catalog |
| `eservices` | Informational e-service listings |
| `transactions` | Core online service request records |
| `transaction_notes` | Message thread on a transaction |
| `appointment_notes` | Notes attached to transaction appointments |
| `tax_profiles` | Tax configuration profile per service |
| `tax_profile_versions` | Versioned tax rule configurations |
| `tax_computations` | Detailed tax calculation results |
| `exemptions` | Tax exemption requests |
| `payments` | Payment records |
| `social_amelioration_settings` | Configurable lookup values for beneficiary types |
| `senior_citizen_beneficiaries` | Senior citizen benefit enrollment |
| `senior_citizen_pension_type_pivots` | Pivot: senior citizens ↔ pension types |
| `pwd_beneficiaries` | PWD benefit enrollment |
| `student_beneficiaries` | Student benefit enrollment |
| `solo_parent_beneficiaries` | Solo parent benefit enrollment |
| `government_programs` | Government welfare programs |
| `beneficiary_program_pivots` | Pivot: beneficiaries ↔ programs |
| `otp_verifications` | OTP codes for phone verification |
| `addresses` | Address reference lookup |
| `faqs` | FAQ content management |

**New (bridge):**

| Table | Notes |
|---|---|
| `citizen_resident_mapping` | Links E-Services `citizens` to BIMS `residents` |

**Total: ~55 tables**

### Tasks

1. Start from `main-db.sql` (BIMS source). Rename `users` → `bims_users` throughout all DDL, sequences, indexes, and FK references (e.g., in `audit_logs.changed_by`).
2. Generate E-Services DDL:
   ```bash
   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
   ```
   Then rename `users` → `eservice_users` in the output.
3. Add `citizen_resident_mapping` DDL (see above).
4. Prepend `CREATE EXTENSION IF NOT EXISTS postgis;` at the top.
5. Combine everything into `united-database/schema.sql` with clear section comments (`-- === BIMS TABLES ===`, `-- === ESERVICES TABLES ===`, `-- === BRIDGE TABLES ===`).
6. Produce `united-database/seed.sql` for reference/lookup data: `addresses`, `services`, `social_amelioration_settings`, `faqs`.

**Deliverables:** `united-database/schema.sql`, `united-database/seed.sql`

---

## Phase 2 — Data Migration Scripts

**Goal:** Write idempotent scripts to migrate existing data from both databases into the unified Supabase instance.

### Scripts

All scripts live in `united-database/migrations/`:

| Script | Description |
|---|---|
| `01_migrate_bims.sql` | `INSERT INTO ... SELECT FROM` for all BIMS tables via `dblink`. Renames `users` → `bims_users` in the insert target. |
| `02_migrate_eservices.sql` | Same for all E-Services tables. Renames `users` → `eservice_users` in the insert target. |
| `03_fuzzy_match.sql` | Runs the fuzzy matching algorithm; populates `citizen_resident_mapping`. |
| `04_verify_integrity.sql` | Row count checks, FK validation, orphan record detection. |
| `rollback.sql` | TRUNCATE all tables in reverse dependency order for clean re-runs during development. |

### Fuzzy Matching Algorithm (`03_fuzzy_match`)

Match `citizens` to `residents` using a two-factor scoring approach:

**Step 1 — Exact birthdate filter**
Only compare citizen-resident pairs that share the same `birthDate` / `birthdate`. This eliminates the vast majority of impossible pairs efficiently.

**Step 2 — Normalized name similarity**
For matching pairs, compute name similarity using PostgreSQL's `pg_trgm` extension:
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

SELECT
  c.id        AS citizen_id,
  r.id        AS resident_id,
  (
    similarity(lower(c."lastName"),  lower(r.last_name))  * 50 +
    similarity(lower(c."firstName"), lower(r.first_name)) * 50
  )           AS match_score
FROM citizens c
JOIN residents r ON c."birthDate"::date = r.birthdate
WHERE (
  similarity(lower(c."lastName"),  lower(r.last_name))  > 0.5
  AND
  similarity(lower(c."firstName"), lower(r.first_name)) > 0.5
);
```

**Step 3 — Score thresholds**

| Score | Action |
|---|---|
| >= 95 | Insert into `citizen_resident_mapping` with `status = 'CONFIRMED'`, `match_method = 'AUTO_FUZZY'` |
| 85 – 94 | Insert with `status = 'PENDING'` — awaiting staff confirmation |
| < 85 | Do not insert — too low confidence |
| Multiple residents match one citizen | Insert all candidates with `status = 'NEEDS_REVIEW'` |

**Step 4 — Staff review**
Export all `PENDING` and `NEEDS_REVIEW` records to a CSV or temporary admin view. Staff confirm or reject each mapping. Confirmed mappings update `status = 'CONFIRMED'` and set `confirmed_at`, `matched_by`.

---

## Phase 3 — Backend Updates

**Goal:** Update both backends to connect to the unified Supabase database, accounting for renamed tables.

### 3A — BIMS Backend

BIMS uses raw SQL with no ORM. The impact of renaming `users` → `bims_users` is contained to query files only.

**Tasks:**

1. Update `.env` to set `DATABASE_URL` to the Supabase unified DB connection string (PgBouncer URL).
2. Find all SQL references to the `users` table:
   ```bash
   grep -rn '"users"' server/src/
   grep -rn "'users'" server/src/
   ```
3. Replace `"users"` → `"bims_users"` in all query strings under `server/src/queries/` and `server/src/models/`.
4. Update `server/src/models/User.js` table name references.
5. Update `server/src/scripts/unifiedMigration.js` to reference the unified DB.
6. Test all BIMS API endpoints in a staging environment against the unified DB.

**Risk:** Low. Raw SQL — the rename is a targeted find-and-replace. GIS geometry data may need re-import if PostGIS SRID or format differs between the old server and Supabase.

### 3B — E-Services Backend

E-Services uses Prisma ORM. The `users` → `eservice_users` rename is a one-line schema change.

**Tasks:**

1. In `multysis-backend/prisma/schema.prisma`, update the `User` model mapping:
   ```diff
   - @@map("users")
   + @@map("eservice_users")
   ```
2. Update `DATABASE_URL` and `DIRECT_URL` in `.env` to point to the Supabase unified DB.
3. Run Prisma migration against the unified DB:
   ```bash
   npx prisma migrate deploy
   # or for initial sync:
   npx prisma db push
   ```
4. Update any seed scripts that reference `users` table name directly.
5. Test all E-Services API endpoints and auth flows (JWT, Google OAuth, Facebook OAuth) against the unified DB.

**Risk:** Low. Prisma abstracts the table name — the `@@map` change is the only required schema modification.

---

## Phase 4 — Fuzzy Matching & Data Validation

**Goal:** Run the fuzzy matching pipeline and verify complete data integrity across both migrated datasets.

**Tasks:**

1. Run `03_fuzzy_match.sql` — populate `citizen_resident_mapping`.
2. Produce a **match report**:
   ```sql
   SELECT status, COUNT(*) FROM citizen_resident_mapping GROUP BY status;
   -- Also:
   SELECT COUNT(*) AS unmatched_citizens
   FROM citizens c
   WHERE NOT EXISTS (SELECT 1 FROM citizen_resident_mapping m WHERE m.citizen_id = c.id);
   ```
3. Export `PENDING` and `NEEDS_REVIEW` records for staff review (CSV or admin query).
4. Staff confirm/reject each mapping.
5. Run `04_verify_integrity.sql` checks:
   - Row counts in unified DB match source databases
   - No orphaned foreign keys
   - No duplicate emails within `bims_users` or within `eservice_users`
   - All `citizen_resident_mapping` records are either `CONFIRMED` or `REJECTED` (none left as `PENDING`)
   - CHECK constraint validation (e.g., `residents.civil_status`, `residents.sex`, `requests.status`)
6. Fix any data quality issues discovered (NULL violations, enum mismatches between systems).

**Deliverables:** Clean `citizen_resident_mapping`, integrity report with zero violations.

---

## Phase 5 — Go-Live

**Tasks:**

1. **Schedule a maintenance window** — set both systems to read-only or take them offline briefly.
2. **Final data sync** — re-run `01_migrate_bims.sql` and `02_migrate_eservices.sql` for any records added since Phase 2 (use `INSERT ... ON CONFLICT DO NOTHING` for idempotency).
3. **Deploy updated backends**:
   - BIMS: updated `.env` + renamed query files deployed.
   - E-Services: updated `schema.prisma` + `.env` deployed, `prisma migrate deploy` run.
4. **Smoke tests** — verify login, core data reads, and a complete workflow in both systems.
5. **Monitor** for 48 hours:
   - Supabase query logs and error rates
   - Query response times (target < 500ms)
   - GIS query performance (PostGIS spatial indexes)
6. **Decommission old databases** — after a 30-day stability period, retire `bims_production` and `multysis`.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fuzzy match produces false positives (wrong citizen linked to wrong resident) | Medium | High | Require staff confirmation for all matches below 95%. Never auto-delete unmatched records. |
| PostGIS not available or geometry format mismatch on Supabase | Low | High | Enable `postgis` extension before Phase 1. Test a sample geometry import early. |
| Hardcoded `users` SQL references missed in BIMS during rename | Medium | Medium | Run `grep -rn '"users"' server/src/` and `grep -rn "'users'" server/src/` exhaustively before deploying. |
| Data volume exceeds Supabase plan limits | Low | Medium | Check `pg_database_size('bims_production')` and `pg_database_size('multysis')` before migrating. Upgrade Supabase tier if needed. |
| Downtime exceeds maintenance window | Low | High | Prepare rollback: `rollback.sql` to truncate unified DB + revert both `.env` files to old connection strings. |
| `civil_status` / enum value mismatches between systems | Low | Medium | Run a pre-validation query in Phase 2 before bulk INSERT to detect invalid values early. |
| Duplicate citizen/resident records (same person registered twice in BIMS) | Low | Medium | Run deduplication checks on `residents` before fuzzy matching; flag duplicates for staff review. |

---

## File Structure for `united-database/`

```
united-database/
├── MIGRATION_PLAN.md               ← This file
├── schema.sql                      ← Master unified DDL (~55 tables)
├── seed.sql                        ← Reference/lookup data seed
└── migrations/
    ├── 01_migrate_bims.sql         ← BIMS data import
    ├── 02_migrate_eservices.sql    ← E-Services data import
    ├── 03_fuzzy_match.sql          ← citizen ↔ resident matching
    ├── 04_verify_integrity.sql     ← Data quality checks
    └── rollback.sql                ← Clean slate for re-runs
```

---

## Phase Checklist

| Phase | Description | Status |
|---|---|---|
| 0 | Preparation — backups, git tags, Supabase verification | **Done** |
| 1 | Unified schema definition (`schema.sql`, `seed.sql`) | **Done** |
| 2 | Data migration scripts (`migrations/`) | **Done** |
| 3A | BIMS backend update (raw SQL rename, new `.env`) | **Done** |
| 3B | E-Services backend update (Prisma `@@map`, new `.env`) | **Done** |
| 4 | Fuzzy matching + integrity validation | **N/A — no prior production data; systems start fresh on unified DB** |
| 5 | Go-live — copy `env.unified` → `.env`, deploy both backends | **Done** |
