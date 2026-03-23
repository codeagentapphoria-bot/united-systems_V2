#!/usr/bin/env bash
# =============================================================================
# test_mutations_bims.sh — BIMS POST / PUT / DELETE Route Test
# =============================================================================
# Tests every mutating endpoint in the BIMS backend against a running server.
#
# HOW TO RUN:
#   cd united-systems/
#   chmod +x united-database/test_mutations_bims.sh
#   ./united-database/test_mutations_bims.sh
# =============================================================================

set -eo pipefail   # -e + pipefail; NOT -u so unset vars default to empty

BASE="http://localhost:5000/api"
UNIFIED_DB_URL="${UNIFIED_DB_URL:-postgresql://postgres.exahyuahguriwrkkeuvm:rPb3%26gYLXpr%40gH%3F@aws-1-ap-south-1.pooler.supabase.com:5432/postgres}"
SUFFIX=$(date +%s)   # unique suffix per run to avoid name collisions

PASS=0; FAIL=0; SKIP=0

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
ok()     { echo -e "  ${GREEN}[PASS]${NC} $*"; PASS=$((PASS+1)); }
fail()   { echo -e "  ${RED}[FAIL]${NC} $*"; FAIL=$((FAIL+1)); }
skip()   { echo -e "  ${YELLOW}[SKIP]${NC} $*"; SKIP=$((SKIP+1)); }
header() { echo -e "\n${BOLD}── $* ${NC}"; }

# ── HTTP helpers ───────────────────────────────────────────────────────────
# req METHOD URL [json_body] [expected_prefix]
req() {
  local method=$1 url=$2 body=${3:-} expected=${4:-2}
  local args=(-s -m 15 -o /tmp/bims_mut.json -w "%{http_code}" -X "$method")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  [[ -n "$body"  ]] && args+=(-H "Content-Type: application/json" -d "$body")
  HTTP_CODE=$(curl "${args[@]}" "$url" 2>/dev/null)
  HTTP_BODY=$(cat /tmp/bims_mut.json 2>/dev/null)
  [[ "$HTTP_CODE" == ${expected}* ]] && return 0 || return 1
}

jq_get() { echo "$HTTP_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null || echo ""; }
msg()    { jq_get "d.get('message','') or d.get('error','') or str(d)[:80]"; }

echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  BIMS Mutation Route Test — $(date)${NC}"
echo -e "${BOLD}============================================================${NC}"

# =============================================================================
# SETUP
# =============================================================================
header "SETUP"

if ! curl -sf -m 5 "http://localhost:5000/health" >/dev/null 2>&1; then
  echo -e "${RED}ERROR: BIMS server not running on port 5000.${NC}"
  echo "Start: cd barangay-information-management-system-copy/server && node server.js &"
  exit 1
fi
echo "  Server: OK"

# Ensure municipality + barangay exist
MUN_ID=$(psql "$UNIFIED_DB_URL" -t -A -c \
  "SELECT id FROM municipalities WHERE municipality_code='BRNGAN' LIMIT 1;" 2>/dev/null | tr -d ' ')
[[ -z "$MUN_ID" ]] && {
  psql "$UNIFIED_DB_URL" -q -c \
    "INSERT INTO municipalities (municipality_name,municipality_code,region,province,description,gis_code)
     VALUES ('City of Borongan','BRNGAN','Region VIII','Eastern Samar','Test','PH0802604')
     ON CONFLICT DO NOTHING;" 2>/dev/null
  MUN_ID=$(psql "$UNIFIED_DB_URL" -t -A -c \
    "SELECT id FROM municipalities WHERE municipality_code='BRNGAN' LIMIT 1;" 2>/dev/null | tr -d ' ')
}
echo "  Municipality ID: $MUN_ID"

BRG_ID=$(psql "$UNIFIED_DB_URL" -t -A -c \
  "SELECT id FROM barangays WHERE barangay_code='BRG001' LIMIT 1;" 2>/dev/null | tr -d ' ')
[[ -z "$BRG_ID" ]] && {
  psql "$UNIFIED_DB_URL" -q -c \
    "INSERT INTO barangays (municipality_id,barangay_name,barangay_code,gis_code)
     VALUES ($MUN_ID,'Barangay 1-Test','BRG001','PH0802604001')
     ON CONFLICT DO NOTHING;" 2>/dev/null
  BRG_ID=$(psql "$UNIFIED_DB_URL" -t -A -c \
    "SELECT id FROM barangays WHERE barangay_code='BRG001' LIMIT 1;" 2>/dev/null | tr -d ' ')
}
echo "  Barangay  ID: $BRG_ID"

# Ensure admin user exists (municipality-scoped so token carries target_id = MUN_ID)
ADM_EMAIL="admin@test.com"
HASHED_PW=$(node -e "
const b=require('$(pwd)/barangay-information-management-system-copy/server/node_modules/bcrypt');
b.hash('Test1234!',12).then(h=>{process.stdout.write(h);process.exit(0);});
" 2>/dev/null || echo "")
[[ -n "$HASHED_PW" ]] && psql "$UNIFIED_DB_URL" -q -c \
  "INSERT INTO bims_users (target_type,target_id,full_name,email,password,role)
   VALUES ('municipality','$MUN_ID','Test Admin','$ADM_EMAIL','$HASHED_PW','admin')
   ON CONFLICT (email) DO NOTHING;" 2>/dev/null

TOKEN=""
if req POST "$BASE/auth/login" '{"email":"admin@test.com","password":"Test1234!"}' 200; then
  TOKEN=$(jq_get "d.get('token','')")
  echo "  Login: OK (token=${TOKEN:0:20}...)"
else
  echo -e "  ${RED}Login failed — $HTTP_CODE: $(msg)${NC}"; exit 1
fi

# =============================================================================
# 1. MUNICIPALITY  — PUT /:municipalityId/municipality
# =============================================================================
header "MUNICIPALITY"

if req PUT "$BASE/$MUN_ID/municipality" \
  '{"municipalityName":"City of Borongan","municipalityCode":"BRNGAN","description":"Updated by test","region":"Region VIII","province":"Eastern Samar"}' 200; then
  ok "PUT /:municipalityId/municipality"
else
  fail "PUT /:municipalityId/municipality — $HTTP_CODE: $(msg)"
fi

# =============================================================================
# 2. CLASSIFICATION TYPES
# =============================================================================
header "CLASSIFICATION TYPES"

CT_ID=""
# targetId + targetType come from the JWT; just send name/color/description/details
if req POST "$BASE/classification-types" \
  "{\"name\":\"TEST_MUTATION_ClassType_$SUFFIX\",\"description\":\"Test classification\",\"color\":\"#FF5733\",\"details\":[]}" 201; then
  CT_ID=$(jq_get "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /classification-types → id=$CT_ID"
else
  fail "POST /classification-types — $HTTP_CODE: $(msg)"
fi

[[ -n "$CT_ID" ]] && {
  if req PUT "$BASE/classification-types/$CT_ID" \
    "{\"name\":\"TEST_MUTATION_ClassType_${SUFFIX}_Updated\",\"color\":\"#00FF00\"}" 200; then
    ok "PUT /classification-types/:id"
  else
    fail "PUT /classification-types/:id — $HTTP_CODE: $(msg)"
  fi
}

# =============================================================================
# 3. RESIDENT  — POST /resident  PUT /:residentId/resident  (camelCase fields)
# =============================================================================
header "RESIDENT"

RES_ID=""
if req POST "$BASE/resident" \
  "{\"barangayId\":$BRG_ID,\"lastName\":\"TestLast\",\"firstName\":\"TestFirst\",\"sex\":\"male\",\"civilStatus\":\"single\",\"birthdate\":\"1990-01-15\"}" 200; then
  RES_ID=$(jq_get "d.get('data',{}).get('resident',{}).get('id','') or d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /resident → id=$RES_ID"
else
  fail "POST /resident — $HTTP_CODE: $(msg)"
fi

[[ -n "$RES_ID" ]] && {
  if req PUT "$BASE/$RES_ID/resident" \
    "{\"barangayId\":$BRG_ID,\"lastName\":\"TestLast\",\"firstName\":\"TestFirstUpdated\",\"sex\":\"male\",\"civilStatus\":\"single\",\"birthdate\":\"1990-01-15\"}" 200; then
    ok "PUT /:residentId/resident"
  else
    fail "PUT /:residentId/resident — $HTTP_CODE: $(msg)"
  fi

  # Resident classification
  CLASS_ID=""
  if req POST "$BASE/classification" \
    "{\"residentId\":\"$RES_ID\",\"classificationType\":\"Senior Citizen\",\"classificationDetails\":[]}" 201; then
    CLASS_ID=$(jq_get "d.get('data',{}).get('id','') or d.get('id','')")
    ok "POST /classification → id=$CLASS_ID"
  else
    fail "POST /classification — $HTTP_CODE: $(msg)"
  fi

  [[ -n "$CLASS_ID" ]] && {
    req PUT "$BASE/classification/$CLASS_ID" \
      '{"classificationType":"PWD","classificationDetails":[]}' 200 \
      && ok "PUT /classification/:id" || fail "PUT /classification/:id — $HTTP_CODE: $(msg)"

    req DELETE "$BASE/classification/$CLASS_ID" "" 200 \
      && ok "DELETE /classification/:id" || fail "DELETE /classification/:id — $HTTP_CODE: $(msg)"
  }
}

# =============================================================================
# 4. PUROK  — POST /purok  PUT /:purokId/purok  (camelCase, returns 200)
# =============================================================================
header "PUROK"

PUROK_ID=""
if req POST "$BASE/purok" \
  "{\"barangayId\":$BRG_ID,\"purokName\":\"TEST_MUTATION_Purok_$SUFFIX\",\"purokLeader\":\"Test Leader\"}" 200; then
  PUROK_ID=$(jq_get "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /purok → id=$PUROK_ID"
else
  fail "POST /purok — $HTTP_CODE: $(msg)"
fi

[[ -n "$PUROK_ID" ]] && {
  req PUT "$BASE/$PUROK_ID/purok" \
    "{\"barangayId\":$BRG_ID,\"purokName\":\"TEST_MUTATION_Purok_Updated\",\"purokLeader\":\"Updated Leader\"}" 200 \
    && ok "PUT /:purokId/purok" || fail "PUT /:purokId/purok — $HTTP_CODE: $(msg)"
}

# =============================================================================
# 5. OFFICIAL  — POST /official  PUT /:officialId/official  (camelCase)
# =============================================================================
header "OFFICIAL"

OFF_ID=""
if [[ -n "$RES_ID" ]]; then
  if req POST "$BASE/official" \
    "{\"barangayId\":$BRG_ID,\"residentId\":\"$RES_ID\",\"position\":\"TEST_MUTATION_Kagawad\",\"termStart\":\"2023-01-01\"}" 200; then
    OFF_ID=$(jq_get "d.get('data',{}).get('id','') or d.get('id','')")
    ok "POST /official → id=$OFF_ID"
  else
    fail "POST /official — $HTTP_CODE: $(msg)"
  fi

  [[ -n "$OFF_ID" ]] && {
    req PUT "$BASE/$OFF_ID/official" \
      "{\"barangayId\":$BRG_ID,\"residentId\":\"$RES_ID\",\"position\":\"TEST_MUTATION_Kagawad_Updated\",\"termStart\":\"2023-01-01\"}" 200 \
      && ok "PUT /:officialId/official" || fail "PUT /:officialId/official — $HTTP_CODE: $(msg)"

    req DELETE "$BASE/$OFF_ID/official" "" 200 \
      && ok "DELETE /:officialId/official" || fail "DELETE /:officialId/official — $HTTP_CODE: $(msg)"
  }
else
  skip "POST/PUT/DELETE /official (no resident created)"
fi

# =============================================================================
# 6. HOUSEHOLD  — POST/PUT /:householdId/household  (camelCase)
# =============================================================================
header "HOUSEHOLD"

HH_ID=""
if [[ -n "$PUROK_ID" && -n "$RES_ID" ]]; then
  if req POST "$BASE/household" \
    "{\"houseNumber\":\"999\",\"street\":\"Test St\",\"purokId\":$PUROK_ID,\"barangayId\":$BRG_ID,\"houseHead\":\"$RES_ID\",\"housingType\":\"concrete\"}" 200; then
    HH_ID=$(jq_get "str(d.get('data','')) if not isinstance(d.get('data'), dict) else (d.get('data',{}).get('id','') or d.get('id',''))")
    ok "POST /households → id=$HH_ID"
  else
    fail "POST /households — $HTTP_CODE: $(msg)"
  fi

  [[ -n "$HH_ID" ]] && {
    req PUT "$BASE/$HH_ID/household" \
      "{\"houseNumber\":\"999\",\"street\":\"Test St Updated\",\"purokId\":$PUROK_ID,\"barangayId\":$BRG_ID,\"houseHead\":\"$RES_ID\"}" 200 \
      && ok "PUT /:householdId/household" || fail "PUT /:householdId/household — $HTTP_CODE: $(msg)"
  }
else
  skip "POST/PUT /household (requires purok + resident)"
fi

# =============================================================================
# 7. PET + VACCINE  (pet uses camelCase; vaccine uses snake_case in controller)
# =============================================================================
header "PET & VACCINE"

PET_ID=""; VAC_ID=""; VAC_RES_ID=""
if [[ -n "$RES_ID" ]]; then
  if req POST "$BASE/pet" \
    "{\"ownerId\":\"$RES_ID\",\"petName\":\"TEST_MUTATION_Dog\",\"species\":\"dog\",\"breed\":\"Aspin\",\"sex\":\"male\",\"birthdate\":\"2022-01-01\",\"color\":\"brown\"}" 200; then
    PET_ID=$(jq_get "d.get('data',{}).get('id','') or d.get('id','')")
    ok "POST /pets → id=$PET_ID"
  else
    fail "POST /pets — $HTTP_CODE: $(msg)"
  fi

  [[ -n "$PET_ID" ]] && {
    req PUT "$BASE/$PET_ID/pet" \
      "{\"ownerId\":\"$RES_ID\",\"petName\":\"TEST_MUTATION_Dog_Updated\",\"species\":\"dog\",\"breed\":\"Aspin\",\"sex\":\"male\",\"birthdate\":\"2022-01-01\",\"color\":\"black\"}" 200 \
      && ok "PUT /:petId/pet" || fail "PUT /:petId/pet — $HTTP_CODE: $(msg)"

    # Vaccine for pet (controller uses snake_case)
    if req POST "$BASE/vaccine" \
      "{\"target_type\":\"pet\",\"target_id\":\"$PET_ID\",\"vaccine_name\":\"TEST_MUTATION_Rabies\",\"vaccination_date\":\"2024-01-01\"}" 201; then
      VAC_ID=$(jq_get "d.get('data',{}).get('id','') or d.get('id','')")
      ok "POST /vaccine (pet) → id=$VAC_ID"
    else
      fail "POST /vaccine (pet) — $HTTP_CODE: $(msg)"
    fi
  }

  # Vaccine for resident
  if req POST "$BASE/vaccine" \
    "{\"target_type\":\"resident\",\"target_id\":\"$RES_ID\",\"vaccine_name\":\"TEST_MUTATION_COVID\",\"vaccination_date\":\"2024-06-01\"}" 201; then
    VAC_RES_ID=$(jq_get "d.get('data',{}).get('id','') or d.get('id','')")
    ok "POST /vaccine (resident) → id=$VAC_RES_ID"
  else
    fail "POST /vaccine (resident) — $HTTP_CODE: $(msg)"
  fi

  [[ -n "$VAC_ID" ]] && {
    req PUT "$BASE/vaccine/$VAC_ID" \
      '{"vaccine_name":"TEST_MUTATION_Rabies_Updated","vaccination_date":"2024-02-01"}' 200 \
      && ok "PUT /vaccine/:id" || fail "PUT /vaccine/:id — $HTTP_CODE: $(msg)"

    req DELETE "$BASE/vaccine/$VAC_ID" "" 200 \
      && ok "DELETE /vaccine/:id" || fail "DELETE /vaccine/:id — $HTTP_CODE: $(msg)"
  }
else
  skip "POST /pets, /vaccine (no resident)"
fi

# =============================================================================
# 8. INVENTORY  — POST /inventory  PUT /:inventoryId/inventory  (camelCase)
# =============================================================================
header "INVENTORY"

INV_ID=""
if req POST "$BASE/inventory" \
  "{\"barangayId\":$BRG_ID,\"itemName\":\"TEST_MUTATION_Chair\",\"itemType\":\"furniture\",\"description\":\"Test chair\",\"quantity\":10,\"unit\":\"pcs\"}" 200; then
  INV_ID=$(jq_get "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /inventory → id=$INV_ID"
else
  fail "POST /inventory — $HTTP_CODE: $(msg)"
fi

[[ -n "$INV_ID" ]] && {
  req PUT "$BASE/$INV_ID/inventory" \
    "{\"barangayId\":$BRG_ID,\"itemName\":\"TEST_MUTATION_Chair_Updated\",\"itemType\":\"furniture\",\"description\":\"Updated\",\"quantity\":20,\"unit\":\"pcs\"}" 200 \
    && ok "PUT /:inventoryId/inventory" || fail "PUT /:inventoryId/inventory — $HTTP_CODE: $(msg)"
}

# =============================================================================
# 9. ARCHIVE  — POST /archive  PUT /:archiveId/archive  (camelCase; barangayId from token)
# =============================================================================
header "ARCHIVE"

ARC_ID=""
if req POST "$BASE/archive" \
  "{\"title\":\"TEST_MUTATION_Archive_$SUFFIX\",\"description\":\"Test archive document\",\"documentType\":\"ordinance\"}" 200; then
  ARC_ID=$(jq_get "d.get('data',{}).get('archive_id','') or d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /archive → id=$ARC_ID"
else
  fail "POST /archive — $HTTP_CODE: $(msg)"
fi

[[ -n "$ARC_ID" ]] && {
  req PUT "$BASE/$ARC_ID/archive" \
    '{"title":"TEST_MUTATION_Archive_Updated","description":"Updated archive","documentType":"resolution"}' 200 \
    && ok "PUT /:archiveId/archive" || fail "PUT /:archiveId/archive — $HTTP_CODE: $(msg)"
}

# =============================================================================
# 10. REQUESTS  (certificate needs residentId; appointment needs fullName+address)
# =============================================================================
header "REQUESTS (certificate & appointment)"

CERT_REQ_ID=""; APPT_REQ_ID=""
TOKEN_SAVE="$TOKEN"; TOKEN=""   # these are public routes (no auth)

if [[ -n "$RES_ID" ]]; then
  if req POST "$BASE/public/requests/certificate" \
    "{\"residentId\":\"$RES_ID\",\"barangayId\":$BRG_ID,\"certificateType\":\"Barangay Clearance\",\"purpose\":\"For employment requirements\"}" 201; then
    CERT_REQ_ID=$(jq_get "d.get('data',{}).get('id','') or d.get('id','')")
    ok "POST /public/requests/certificate → id=$CERT_REQ_ID"
  else
    fail "POST /public/requests/certificate — $HTTP_CODE: $(msg)"
  fi
else
  skip "POST /public/requests/certificate (no resident)"
fi

if req POST "$BASE/public/requests/appointment" \
  "{\"fullName\":\"TEST_MUTATION_Citizen\",\"address\":\"Test Street, Borongan\",\"barangayId\":$BRG_ID,\"appointmentWith\":\"Barangay Captain\",\"appointmentDate\":\"2026-04-01\",\"purpose\":\"Barangay matter\",\"contactNumber\":\"09991234568\"}" 201; then
  APPT_REQ_ID=$(jq_get "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /public/requests/appointment → id=$APPT_REQ_ID"
else
  fail "POST /public/requests/appointment — $HTTP_CODE: $(msg)"
fi

TOKEN="$TOKEN_SAVE"   # restore auth token

# Admin: update request status
[[ -n "$CERT_REQ_ID" ]] && {
  req PUT "$BASE/requests/$CERT_REQ_ID/status" \
    '{"status":"approved","notes":"Approved for test"}' 200 \
    && ok "PUT /requests/:id/status (approve)" || fail "PUT /requests/:id/status — $HTTP_CODE: $(msg)"
}
[[ -n "$APPT_REQ_ID" ]] && {
  req PUT "$BASE/requests/$APPT_REQ_ID/status" \
    '{"status":"approved","notes":"Approved for test"}' 200 \
    && ok "PUT /requests/:id/status (appt approve)" || fail "PUT /requests/:id/status (appt) — $HTTP_CODE: $(msg)"
}

# =============================================================================
# 11. USER  — POST /users  PUT /:userId/user  (targetType, targetId, fullname)
# =============================================================================
header "USER"

NEW_USER_ID=""
if req POST "$BASE/user" \
  "{\"targetType\":\"barangay\",\"targetId\":\"$BRG_ID\",\"fullname\":\"TEST_MUTATION_Staff\",\"email\":\"testmutation_staff_${SUFFIX}@test.com\",\"password\":\"Staff1234!\",\"role\":\"staff\"}" 200; then
  NEW_USER_ID=$(jq_get "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /users → id=$NEW_USER_ID"
else
  fail "POST /users — $HTTP_CODE: $(msg)"
fi

[[ -n "$NEW_USER_ID" ]] && {
  req PUT "$BASE/$NEW_USER_ID/user" \
    "{\"fullname\":\"TEST_MUTATION_Staff_Updated\",\"email\":\"testmutation_staff_${SUFFIX}@test.com\",\"role\":\"staff\"}" 200 \
    && ok "PUT /:userId/user" || fail "PUT /:userId/user — $HTTP_CODE: $(msg)"
}

# =============================================================================
# 12. COUNTER / PREFIX
# =============================================================================
header "COUNTER"

req PUT "$BASE/prefix" '{"year":2026,"prefix":"RES-"}' 200 \
  && ok "PUT /prefix" || fail "PUT /prefix — $HTTP_CODE: $(msg)"

# =============================================================================
# CLEANUP
# =============================================================================
header "CLEANUP"

[[ -n "$HH_ID"       ]] && { req DELETE "$BASE/$HH_ID/household"              "" 200 && ok "DELETE household"           || fail "DELETE household — $HTTP_CODE"; }
[[ -n "$PET_ID"      ]] && { req DELETE "$BASE/$PET_ID/pet"                   "" 200 && ok "DELETE pet"                 || fail "DELETE pet — $HTTP_CODE"; }
[[ -n "$RES_ID"      ]] && { req DELETE "$BASE/$RES_ID/resident"              "" 200 && ok "DELETE resident"            || fail "DELETE resident — $HTTP_CODE"; }
[[ -n "$PUROK_ID"    ]] && { req DELETE "$BASE/$PUROK_ID/purok"               "" 200 && ok "DELETE purok"               || fail "DELETE purok — $HTTP_CODE"; }
[[ -n "$NEW_USER_ID" ]] && { req DELETE "$BASE/$NEW_USER_ID/user"             "" 200 && ok "DELETE user"                || fail "DELETE user — $HTTP_CODE"; }
[[ -n "$CT_ID"       ]] && { req DELETE "$BASE/classification-types/$CT_ID"   "" 200 && ok "DELETE classification-type" || fail "DELETE classification-type — $HTTP_CODE"; }

psql "$UNIFIED_DB_URL" -q -c "
  DELETE FROM requests    WHERE full_name LIKE 'TEST_MUTATION_%' OR resident_id='$RES_ID';
  DELETE FROM inventories WHERE item_name LIKE 'TEST_MUTATION_%';
  DELETE FROM archives    WHERE title     LIKE 'TEST_MUTATION_%';
  DELETE FROM vaccines    WHERE vaccine_name LIKE 'TEST_MUTATION_%';
" 2>/dev/null && ok "DB cleanup (requests, inventories, archives, vaccines)" || fail "DB cleanup"

# =============================================================================
# REPORT
# =============================================================================
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  BIMS Mutation Test Report${NC}"
echo -e "${BOLD}============================================================${NC}"
echo -e "  ${GREEN}PASS: $PASS${NC}"
echo -e "  ${RED}FAIL: $FAIL${NC}"
echo -e "  ${YELLOW}SKIP: $SKIP${NC}"
echo -e "  Total: $((PASS+FAIL+SKIP))"
echo ""
[[ $FAIL -eq 0 ]] \
  && echo -e "  ${GREEN}${BOLD}All mutation tests passed.${NC}" \
  || echo -e "  ${RED}${BOLD}$FAIL test(s) failed — review output above.${NC}"
echo -e "${BOLD}============================================================${NC}"

exit $FAIL
