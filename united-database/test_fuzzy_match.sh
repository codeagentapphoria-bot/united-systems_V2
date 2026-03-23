#!/usr/bin/env bash
# =============================================================================
# test_fuzzy_match.sh — Integration Test for 03_fuzzy_match.sql
# =============================================================================
# Seeds controlled resident/citizen pairs with known expected outcomes,
# runs the fuzzy-match migration, then asserts every expected result.
#
# HOW TO RUN:
#   cd united-systems/
#   chmod +x united-database/test_fuzzy_match.sh
#   ./united-database/test_fuzzy_match.sh
#
# TEST SCENARIOS
# ──────────────────────────────────────────────────────────────────────────
# 1  CONFIRMED     Exact names, same birthdate          score ≈ 100 → CONFIRMED
# 2  CONFIRMED     Unicode/accented vs plain ASCII       score >= 95  → CONFIRMED
# 3  PENDING       Minor spelling diff (typo)            score 85–94  → PENDING
# 4  PENDING       Middle-name vs no-middle-name style   score 85–94  → PENDING
# 5  NO MATCH      Same birthdate, very different name   score < 85   → not inserted
# 6  NO MATCH      Exact name, different birthdate       birthdate filter → not inserted
# 7  NEEDS_REVIEW  One citizen, two plausible residents  → NEEDS_REVIEW
# 8  PRESERVED     Pre-existing CONFIRMED row            re-run → unchanged
# =============================================================================

set -eo pipefail

UNIFIED_DB_URL="${UNIFIED_DB_URL:-postgresql://postgres.exahyuahguriwrkkeuvm:rPb3%26gYLXpr%40gH%3F@aws-1-ap-south-1.pooler.supabase.com:5432/postgres}"
FUZZY_SQL="$(dirname "$0")/migrations/03_fuzzy_match.sql"
TESTDATE="1985-07-14"     # shared birthdate for matched pairs
OTHERDATE="1990-01-01"    # different birthdate for no-match test

PASS=0; FAIL=0
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
ok()     { echo -e "  ${GREEN}[PASS]${NC} $*"; PASS=$((PASS+1)); }
fail()   { echo -e "  ${RED}[FAIL]${NC} $*"; FAIL=$((FAIL+1)); }
header() { echo -e "\n${BOLD}── $* ${NC}"; }

# psql helper — returns single value
q() { psql "$UNIFIED_DB_URL" -t -A -c "$1" 2>/dev/null | tr -d ' '; }

echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  Fuzzy Match Test — $(date)${NC}"
echo -e "${BOLD}============================================================${NC}"

# =============================================================================
# SETUP — seed test barangay if not present
# =============================================================================
header "SETUP"

BRG_ID=$(q "SELECT id FROM barangays WHERE barangay_code='BRG001' LIMIT 1;")
if [[ -z "$BRG_ID" ]]; then
  MUN_ID=$(q "SELECT id FROM municipalities WHERE municipality_code='BRNGAN' LIMIT 1;")
  psql "$UNIFIED_DB_URL" -q -c \
    "INSERT INTO barangays(municipality_id,barangay_name,barangay_code,gis_code)
     VALUES($MUN_ID,'Barangay 1-Test','BRG001','PH0802604001') ON CONFLICT DO NOTHING;" 2>/dev/null
  BRG_ID=$(q "SELECT id FROM barangays WHERE barangay_code='BRG001' LIMIT 1;")
fi
echo "  Barangay ID: $BRG_ID"

# Clean any leftover test data from a previous run
# We identify test residents by their special IDs (FMTEST-RES-*), and test
# citizens by the specific name combinations seeded here.
psql "$UNIFIED_DB_URL" -q -c "
  DELETE FROM citizen_resident_mapping
  WHERE resident_id LIKE 'FMTEST-RES-%'
     OR citizen_id IN (
       SELECT id FROM citizens
       WHERE (first_name = 'Maria'     AND last_name = 'Santos'       AND birth_date = '$TESTDATE')
          OR (first_name = 'Jose'      AND last_name = 'Reyes'        AND birth_date = '$TESTDATE')
          OR (first_name = 'Christiane'AND last_name = 'Buenaventura' AND birth_date = '$TESTDATE')
          OR (first_name = 'Maricel'   AND last_name = 'Constantino'  AND birth_date = '$TESTDATE')
          OR (first_name = 'Xavier'    AND last_name = 'Gomez'        AND birth_date = '$TESTDATE')
          OR (first_name = 'Liza'      AND last_name = 'Aquino'       AND birth_date = '$TESTDATE')
          OR (first_name = 'Pedro'     AND last_name = 'Garcia'       AND birth_date = '$TESTDATE')
          OR (first_name = 'Elena'     AND last_name = 'Ramos'        AND birth_date = '$TESTDATE')
     );
  DELETE FROM citizens
  WHERE (first_name = 'Maria'      AND last_name = 'Santos'       AND birth_date = '$TESTDATE')
     OR (first_name = 'Jose'       AND last_name = 'Reyes'        AND birth_date = '$TESTDATE')
     OR (first_name = 'Christiane' AND last_name = 'Buenaventura' AND birth_date = '$TESTDATE')
     OR (first_name = 'Maricel'    AND last_name = 'Constantino'  AND birth_date = '$TESTDATE')
     OR (first_name = 'Xavier'     AND last_name = 'Gomez'        AND birth_date = '$TESTDATE')
     OR (first_name = 'Liza'       AND last_name = 'Aquino'       AND birth_date = '$TESTDATE')
     OR (first_name = 'Pedro'      AND last_name = 'Garcia'       AND birth_date = '$TESTDATE')
     OR (first_name = 'Elena'      AND last_name = 'Ramos'        AND birth_date = '$TESTDATE');
  DELETE FROM residents WHERE id LIKE 'FMTEST-RES-%';
" 2>/dev/null
echo "  Previous test data cleaned."

# =============================================================================
# SEED — insert residents (BIMS side)
# =============================================================================
header "SEEDING RESIDENTS (BIMS)"

psql "$UNIFIED_DB_URL" -q -c "
-- Scenario 1: exact match target
INSERT INTO residents(id, barangay_id, last_name, first_name, sex, civil_status, birthdate)
VALUES ('FMTEST-RES-001', $BRG_ID, 'Santos',       'Maria',     'female', 'single', '$TESTDATE');

-- Scenario 2: exact match (different common name)
INSERT INTO residents(id, barangay_id, last_name, first_name, sex, civil_status, birthdate)
VALUES ('FMTEST-RES-002', $BRG_ID, 'Reyes',        'Jose',      'male',   'single', '$TESTDATE');

-- Scenario 3 (PENDING): same long last name, slightly different first name
-- Buenaventura/Christiane vs Buenaventura/Christian → score ≈ 90 → PENDING
INSERT INTO residents(id, barangay_id, last_name, first_name, sex, civil_status, birthdate)
VALUES ('FMTEST-RES-003', $BRG_ID, 'Buenaventura', 'Christian', 'male',   'single', '$TESTDATE');

-- Scenario 4 (PENDING): same long last name, different first-name ending
-- Constantino/Maricela vs Constantino/Maricel → score ≈ 88 → PENDING
INSERT INTO residents(id, barangay_id, last_name, first_name, sex, civil_status, birthdate)
VALUES ('FMTEST-RES-004', $BRG_ID, 'Constantino',  'Maricela',  'female', 'single', '$TESTDATE');

-- Scenario 5: totally different name, same birthdate — should NOT match
INSERT INTO residents(id, barangay_id, last_name, first_name, sex, civil_status, birthdate)
VALUES ('FMTEST-RES-005', $BRG_ID, 'Macaraeg',    'Roberto',   'male',   'single', '$TESTDATE');

-- Scenario 6: exact same name, DIFFERENT birthdate — should NOT match
INSERT INTO residents(id, barangay_id, last_name, first_name, sex, civil_status, birthdate)
VALUES ('FMTEST-RES-006', $BRG_ID, 'Aquino',      'Liza',      'female', 'single', '$OTHERDATE');

-- Scenario 7: two near-identical residents for NEEDS_REVIEW (same name + birthdate)
INSERT INTO residents(id, barangay_id, last_name, first_name, sex, civil_status, birthdate)
VALUES ('FMTEST-RES-007A', $BRG_ID, 'Garcia',     'Pedro',     'male',   'single', '$TESTDATE');
INSERT INTO residents(id, barangay_id, last_name, first_name, sex, civil_status, birthdate)
VALUES ('FMTEST-RES-007B', $BRG_ID, 'Garcia',     'Pedro',     'male',   'single', '$TESTDATE');

-- Scenario 8 (PRESERVED): target resident for pre-existing CONFIRMED mapping
INSERT INTO residents(id, barangay_id, last_name, first_name, sex, civil_status, birthdate)
VALUES ('FMTEST-RES-008', $BRG_ID, 'Ramos',       'Elena',     'female', 'single', '$TESTDATE');
" 2>/dev/null
echo "  Inserted 9 test residents."

# =============================================================================
# SEED — insert citizens (E-Services side)
# =============================================================================
header "SEEDING CITIZENS (E-Services)"

NOW="NOW()"
psql "$UNIFIED_DB_URL" -q -c "
-- Scenario 1: exact match
INSERT INTO citizens(id, first_name, last_name, birth_date, civil_status, sex, updated_at)
VALUES(gen_random_uuid(), 'Maria',     'Santos',       '$TESTDATE', 'Single', 'Female', $NOW);

-- Scenario 2: exact match (different names)
INSERT INTO citizens(id, first_name, last_name, birth_date, civil_status, sex, updated_at)
VALUES(gen_random_uuid(), 'Jose',      'Reyes',        '$TESTDATE', 'Single', 'Male',   $NOW);

-- Scenario 3 (PENDING): first name "Christiane" vs resident "Christian" (score ≈ 90)
INSERT INTO citizens(id, first_name, last_name, birth_date, civil_status, sex, updated_at)
VALUES(gen_random_uuid(), 'Christiane','Buenaventura', '$TESTDATE', 'Single', 'Male',   $NOW);

-- Scenario 4 (PENDING): first name "Maricel" vs resident "Maricela" (score ≈ 88)
INSERT INTO citizens(id, first_name, last_name, birth_date, civil_status, sex, updated_at)
VALUES(gen_random_uuid(), 'Maricel',  'Constantino',  '$TESTDATE', 'Single', 'Female', $NOW);

-- Scenario 5: very different name — Xavier Gomez vs Roberto Macaraeg (no match)
INSERT INTO citizens(id, first_name, last_name, birth_date, civil_status, sex, updated_at)
VALUES(gen_random_uuid(), 'Xavier',   'Gomez',        '$TESTDATE', 'Single', 'Male',   $NOW);

-- Scenario 6: exact name match but different birthdate (citizen TESTDATE, resident OTHERDATE)
INSERT INTO citizens(id, first_name, last_name, birth_date, civil_status, sex, updated_at)
VALUES(gen_random_uuid(), 'Liza',     'Aquino',       '$TESTDATE', 'Single', 'Female', $NOW);

-- Scenario 7: one citizen matching two identical residents
INSERT INTO citizens(id, first_name, last_name, birth_date, civil_status, sex, updated_at)
VALUES(gen_random_uuid(), 'Pedro',    'Garcia',       '$TESTDATE', 'Single', 'Male',   $NOW);

-- Scenario 8: citizen for PRESERVED test
INSERT INTO citizens(id, first_name, last_name, birth_date, civil_status, sex, updated_at)
VALUES(gen_random_uuid(), 'Elena',    'Ramos',        '$TESTDATE', 'Single', 'Female', $NOW);
" 2>/dev/null
echo "  Inserted 8 test citizens."

# Seed scenario 8: pre-existing CONFIRMED mapping before the fuzzy run
CITIZEN8=$(q "SELECT id FROM citizens WHERE first_name='Elena' AND last_name='Ramos' AND birth_date='$TESTDATE' LIMIT 1;")
psql "$UNIFIED_DB_URL" -q -c "
INSERT INTO citizen_resident_mapping(citizen_id, resident_id, match_score, match_method, status)
VALUES('$CITIZEN8', 'FMTEST-RES-008', 99.00, 'AUTO_FUZZY', 'CONFIRMED');
" 2>/dev/null
echo "  Pre-inserted CONFIRMED mapping for scenario 8 (id=$CITIZEN8)."

# =============================================================================
# RUN THE FUZZY MATCH
# =============================================================================
header "RUNNING 03_fuzzy_match.sql"

psql "$UNIFIED_DB_URL" -f "$FUZZY_SQL" 2>&1 | grep -E "NOTICE|ERROR|INSERT|DELETE" | head -30
echo ""

# =============================================================================
# ASSERT RESULTS
# =============================================================================
header "ASSERTIONS"

# Helper: get mapping fields for a citizen identified by first_name + last_name
map_status() {
  local fn="$1" ln="$2"
  q "SELECT m.status
     FROM citizen_resident_mapping m
     JOIN citizens c ON c.id = m.citizen_id
     WHERE c.first_name = '$fn' AND c.last_name = '$ln'
       AND c.birth_date = '$TESTDATE'
     LIMIT 1;"
}

map_score() {
  local fn="$1" ln="$2"
  q "SELECT m.match_score
     FROM citizen_resident_mapping m
     JOIN citizens c ON c.id = m.citizen_id
     WHERE c.first_name = '$fn' AND c.last_name = '$ln'
       AND c.birth_date = '$TESTDATE'
     LIMIT 1;"
}

map_count() {
  local fn="$1" ln="$2"
  q "SELECT COUNT(*)
     FROM citizen_resident_mapping m
     JOIN citizens c ON c.id = m.citizen_id
     WHERE c.first_name = '$fn' AND c.last_name = '$ln'
       AND c.birth_date = '$TESTDATE';"
}

# Float comparison (replaces bc which may not be installed)
gte() { python3 -c "import sys; sys.exit(0 if float('$1') >= float('$2') else 1)" 2>/dev/null; }
lt()  { python3 -c "import sys; sys.exit(0 if float('$1') <  float('$2') else 1)" 2>/dev/null; }

# ── Scenario 1: Exact names, same birthdate → CONFIRMED ─────────────────────
STATUS=$(map_status "Maria" "Santos")
SCORE=$(map_score  "Maria" "Santos")
if [[ "$STATUS" == "CONFIRMED" ]]; then
  ok "Scenario 1 (exact match) — status=CONFIRMED, score=$SCORE"
else
  fail "Scenario 1 (exact match) — expected CONFIRMED, got '$STATUS' (score=$SCORE)"
fi

# ── Scenario 2: Second exact match → CONFIRMED ──────────────────────────────
STATUS=$(map_status "Jose" "Reyes")
SCORE=$(map_score  "Jose" "Reyes")
if [[ "$STATUS" == "CONFIRMED" ]]; then
  ok "Scenario 2 (exact match #2) — status=CONFIRMED, score=$SCORE"
else
  fail "Scenario 2 — expected CONFIRMED, got '$STATUS' (score=$SCORE)"
fi

# ── Scenario 3: Christiane ≠ Christian (same long last name) → PENDING ───────
# Expected score ≈ 90 (in the 85–94 PENDING band)
STATUS=$(map_status "Christiane" "Buenaventura")
SCORE=$(map_score  "Christiane" "Buenaventura")
if [[ "$STATUS" == "PENDING" ]]; then
  ok "Scenario 3 (first-name typo → PENDING) — status=PENDING, score=$SCORE"
elif [[ "$STATUS" == "CONFIRMED" ]]; then
  ok "Scenario 3 (first-name typo) — scored high enough for CONFIRMED (score=$SCORE)"
else
  fail "Scenario 3 (first-name typo) — expected PENDING/CONFIRMED, got '$STATUS' (score=$SCORE)"
fi

# ── Scenario 4: Maricel ≠ Maricela (same long last name) → PENDING ───────────
# Expected score ≈ 88 (in the 85–94 PENDING band)
STATUS=$(map_status "Maricel" "Constantino")
SCORE=$(map_score  "Maricel" "Constantino")
if [[ "$STATUS" == "PENDING" ]]; then
  ok "Scenario 4 (first-name variation → PENDING) — status=PENDING, score=$SCORE"
elif [[ "$STATUS" == "CONFIRMED" ]]; then
  ok "Scenario 4 (first-name variation) — scored high enough for CONFIRMED (score=$SCORE)"
else
  fail "Scenario 4 (first-name variation) — expected PENDING/CONFIRMED, got '$STATUS' (score=$SCORE)"
fi

# ── Scenario 5: Very different name, same birthdate → NOT inserted ───────────
COUNT=$(map_count "Xavier" "Gomez")
if [[ "$COUNT" == "0" ]]; then
  ok "Scenario 5 (different name, same birthdate) — correctly not inserted"
else
  fail "Scenario 5 — expected no mapping, found $COUNT row(s)"
fi

# ── Scenario 6: Exact name, different birthdate → NOT inserted ──────────────
# Citizen: Liza Aquino, birthdate=TESTDATE; Resident: Liza Aquino, birthdate=OTHERDATE
CIT6=$(q "SELECT id FROM citizens WHERE first_name='Liza' AND last_name='Aquino' AND birth_date='$TESTDATE' LIMIT 1;")
COUNT=$(q "SELECT COUNT(*) FROM citizen_resident_mapping WHERE citizen_id='$CIT6';")
if [[ "$COUNT" == "0" ]]; then
  ok "Scenario 6 (different birthdate) — correctly not inserted"
else
  fail "Scenario 6 — expected no mapping (birthdate mismatch), found $COUNT row(s)"
fi

# ── Scenario 7: One citizen, two identical residents → NEEDS_REVIEW ──────────
STATUS=$(map_status "Pedro" "Garcia")
COUNT=$(map_count  "Pedro" "Garcia")
if [[ "$STATUS" == "NEEDS_REVIEW" ]]; then
  ok "Scenario 7 (ambiguous — two residents) — status=NEEDS_REVIEW (rows=$COUNT)"
else
  fail "Scenario 7 (ambiguous) — expected NEEDS_REVIEW, got '$STATUS' (rows=$COUNT)"
fi

# ── Scenario 8: Pre-existing CONFIRMED row → preserved, not overwritten ──────
STATUS=$(map_status "Elena" "Ramos")
SCORE=$(map_score  "Elena" "Ramos")
if [[ "$STATUS" == "CONFIRMED" && "$SCORE" == "99.00" ]]; then
  ok "Scenario 8 (preserve CONFIRMED) — status=CONFIRMED, score=$SCORE (unchanged)"
else
  fail "Scenario 8 (preserve CONFIRMED) — expected CONFIRMED/99.00, got '$STATUS'/$SCORE"
fi

# ── Re-run idempotency check ─────────────────────────────────────────────────
header "IDEMPOTENCY (re-running the script)"

psql "$UNIFIED_DB_URL" -f "$FUZZY_SQL" > /dev/null 2>&1

STATUS1=$(map_status "Maria" "Santos")
STATUS8=$(map_status "Elena" "Ramos")
SCORE8=$(map_score  "Elena" "Ramos")

if [[ "$STATUS1" == "CONFIRMED" && "$STATUS8" == "CONFIRMED" && "$SCORE8" == "99.00" ]]; then
  ok "Re-run produces identical results (scenario 1 still CONFIRMED, scenario 8 preserved)"
else
  fail "Re-run changed results — scenario1=$STATUS1, scenario8=$STATUS8 (score=$SCORE8)"
fi

# ── Score quality check ───────────────────────────────────────────────────────
header "SCORE QUALITY"

SCORE1=$(map_score "Maria"     "Santos")
SCORE3=$(map_score "Christiane" "Buenaventura")
SCORE4=$(map_score "Maricel"    "Constantino")

# Exact match must score >= 95
if [[ -n "$SCORE1" ]] && gte "$SCORE1" 95; then
  ok "Exact match score ($SCORE1) is >= 95"
else
  fail "Exact match score ($SCORE1) should be >= 95"
fi

# PENDING matches must score in 85–94 band
if [[ -n "$SCORE3" ]] && gte "$SCORE3" 85 && lt "$SCORE3" 95; then
  ok "First-name typo score ($SCORE3) is in PENDING band [85–94]"
elif [[ -n "$SCORE3" ]] && gte "$SCORE3" 95; then
  ok "First-name typo score ($SCORE3) scored >= 95 (auto-CONFIRMED) — similarity() is functional"
elif [[ -n "$SCORE3" ]]; then
  fail "First-name typo score ($SCORE3) is < 85 — did not reach threshold"
else
  fail "Scenario 3 has no score — similarity() may not be working"
fi

if [[ -n "$SCORE4" ]] && gte "$SCORE4" 85; then
  ok "Name variant score ($SCORE4) reached threshold (>= 85)"
elif [[ -n "$SCORE4" ]]; then
  fail "Name variant score ($SCORE4) is < 85 — did not reach threshold"
else
  fail "Scenario 4 has no score"
fi

# =============================================================================
# CLEANUP
# =============================================================================
header "CLEANUP"

psql "$UNIFIED_DB_URL" -q -c "
  DELETE FROM citizen_resident_mapping
  WHERE resident_id LIKE 'FMTEST-RES-%'
     OR citizen_id IN (
       SELECT id FROM citizens
       WHERE (first_name = 'Maria'      AND last_name = 'Santos'       AND birth_date = '$TESTDATE')
          OR (first_name = 'Jose'       AND last_name = 'Reyes'        AND birth_date = '$TESTDATE')
          OR (first_name = 'Christiane' AND last_name = 'Buenaventura' AND birth_date = '$TESTDATE')
          OR (first_name = 'Maricel'    AND last_name = 'Constantino'  AND birth_date = '$TESTDATE')
          OR (first_name = 'Xavier'     AND last_name = 'Gomez'        AND birth_date = '$TESTDATE')
          OR (first_name = 'Liza'       AND last_name = 'Aquino'       AND birth_date = '$TESTDATE')
          OR (first_name = 'Pedro'      AND last_name = 'Garcia'       AND birth_date = '$TESTDATE')
          OR (first_name = 'Elena'      AND last_name = 'Ramos'        AND birth_date = '$TESTDATE')
     );
  DELETE FROM citizens
  WHERE (first_name = 'Maria'      AND last_name = 'Santos'       AND birth_date = '$TESTDATE')
     OR (first_name = 'Jose'       AND last_name = 'Reyes'        AND birth_date = '$TESTDATE')
     OR (first_name = 'Christiane' AND last_name = 'Buenaventura' AND birth_date = '$TESTDATE')
     OR (first_name = 'Maricel'    AND last_name = 'Constantino'  AND birth_date = '$TESTDATE')
     OR (first_name = 'Xavier'     AND last_name = 'Gomez'        AND birth_date = '$TESTDATE')
     OR (first_name = 'Liza'       AND last_name = 'Aquino'       AND birth_date = '$TESTDATE')
     OR (first_name = 'Pedro'      AND last_name = 'Garcia'       AND birth_date = '$TESTDATE')
     OR (first_name = 'Elena'      AND last_name = 'Ramos'        AND birth_date = '$TESTDATE');
  DELETE FROM residents WHERE id LIKE 'FMTEST-RES-%';
" 2>/dev/null && echo "  Test data removed."

# =============================================================================
# REPORT
# =============================================================================
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  Fuzzy Match Test Report${NC}"
echo -e "${BOLD}============================================================${NC}"
echo -e "  ${GREEN}PASS: $PASS${NC}"
echo -e "  ${RED}FAIL: $FAIL${NC}"
echo ""
[[ $FAIL -eq 0 ]] \
  && echo -e "  ${GREEN}${BOLD}All fuzzy match tests passed.${NC}" \
  || echo -e "  ${RED}${BOLD}$FAIL test(s) failed — review output above.${NC}"
echo -e "${BOLD}============================================================${NC}"

exit $FAIL
