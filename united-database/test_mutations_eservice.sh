#!/usr/bin/env bash
# =============================================================================
# test_mutations_eservice.sh — E-Services POST / PUT / DELETE / PATCH Route Test
# =============================================================================
# Tests every mutating endpoint in the E-Services (Multysis) backend against
# a running server.
#
# HOW TO RUN:
#   cd united-systems/
#   # Make sure E-Services server is running on port 3000 first:
#   #   cd borongan-eService-system-copy/multysis-backend && node dist/index.js &
#   #
#   chmod +x united-database/test_mutations_eservice.sh
#   ./united-database/test_mutations_eservice.sh
#
# WHAT IT DOES:
#   1. Logs in as admin and gets an access token
#   2. Creates test data in dependency order (permission → role → user →
#      citizen → service → social amelioration → government program → FAQ)
#   3. Tests all mutations: POST, PUT, PATCH, DELETE
#   4. Cleans up all created test records
#   5. Reports pass / fail counts
#
# All test data names use prefix "TEST_MUTATION_" for safe identification.
# =============================================================================

set -eo pipefail   # NO -u — allow unset vars to be empty

BASE="http://localhost:3000/api"
UNIFIED_DB_URL="${UNIFIED_DB_URL:-postgresql://postgres.exahyuahguriwrkkeuvm:rPb3%26gYLXpr%40gH%3F@aws-1-ap-south-1.pooler.supabase.com:5432/postgres}"
SUFFIX=$(date +%s)   # unique suffix per run to avoid name-collision errors

PASS=0
FAIL=0
SKIP=0

# ── Colours ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; NC='\033[0m'
ok()     { echo -e "  ${GREEN}[PASS]${NC} $*"; PASS=$((PASS+1)); }
fail()   { echo -e "  ${RED}[FAIL]${NC} $*"; FAIL=$((FAIL+1)); }
skip()   { echo -e "  ${YELLOW}[SKIP]${NC} $*"; SKIP=$((SKIP+1)); }
header() { echo -e "\n${BOLD}── $* ${NC}"; }

TOKEN=""

# ── HTTP helper ────────────────────────────────────────────────────────────
# req METHOD URL [body] [expected_code_prefix]
# Sets: $HTTP_CODE  $HTTP_BODY
req() {
  local method=$1 url=$2 body=${3:-} expected=${4:-2}
  local args=(-s -m 15 -o /tmp/es_mut.json -w "%{http_code}" -X "$method")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  [[ -n "$body"  ]] && args+=(-H "Content-Type: application/json" -d "$body")
  HTTP_CODE=$(curl "${args[@]}" "$url" 2>/dev/null)
  HTTP_BODY=$(cat /tmp/es_mut.json 2>/dev/null)
  [[ "$HTTP_CODE" == ${expected}* ]] && return 0 || return 1
}

jq_get() { echo "$HTTP_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null || echo ""; }
msg()    { jq_get "d.get('message','') or d.get('error','') or str(d)[:100]"; }
jq_path() { echo "$HTTP_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null || echo ""; }

# form_req — multipart/form-data request (for endpoints with file upload middleware)
# Usage: form_req METHOD URL "key=value" "key2=value2" ...
# Last arg before fields: expected_code_prefix (default "2")
form_req() {
  local method=$1 url=$2; shift 2
  local expected="2"
  local fields=()
  for arg in "$@"; do
    fields+=(-F "$arg")
  done
  local args=(-s -m 15 -o /tmp/es_mut.json -w "%{http_code}" -X "$method")
  [[ -n "$TOKEN" ]] && args+=(-H "Authorization: Bearer $TOKEN")
  HTTP_CODE=$(curl "${args[@]}" "${fields[@]}" "$url" 2>/dev/null)
  HTTP_BODY=$(cat /tmp/es_mut.json 2>/dev/null)
  [[ "$HTTP_CODE" == ${expected}* ]] && return 0 || return 1
}

echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  E-Services Mutation Route Test — $(date)${NC}"
echo -e "${BOLD}============================================================${NC}"

# =============================================================================
# SETUP
# =============================================================================
header "SETUP"

# Server health check
if ! curl -sf -m 5 "http://localhost:3000/health" >/dev/null 2>&1; then
  echo -e "${RED}ERROR: E-Services server is not running on port 3000.${NC}"
  echo "Start it with: cd borongan-eService-system-copy/multysis-backend && node dist/index.js &"
  exit 1
fi
echo "  Server: OK"

# Login — extract access token from Set-Cookie header
LOGIN_RESP=$(curl -si -m 10 -X POST "$BASE/auth/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@eservice.com","password":"Test1234!"}' 2>/dev/null)
TOKEN=$(echo "$LOGIN_RESP" | grep -i "set-cookie: access_token=" | grep -oP 'access_token=\K[^;]+' || echo "")

if [[ -z "$TOKEN" ]]; then
  # Fallback: try Bearer from response body
  LOGIN_BODY=$(echo "$LOGIN_RESP" | tail -1)
  TOKEN=$(echo "$LOGIN_BODY" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('data',{}).get('accessToken',''))" 2>/dev/null || echo "")
fi

if [[ -z "$TOKEN" ]]; then
  echo -e "${RED}Login failed — could not extract access token.${NC}"
  echo "Make sure admin@eservice.com / Test1234! exists in eservice_users."
  exit 1
fi
echo "  Login: OK (token=${TOKEN:0:20}...)"

# =============================================================================
# 1. PERMISSIONS
# =============================================================================
header "PERMISSIONS"

PERM_ID=""
if req POST "$BASE/permissions" \
  "{\"resource\":\"test_mutation_res_$SUFFIX\",\"action\":\"read\"}" 201; then
  PERM_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /permissions → id=$PERM_ID"
else
  fail "POST /permissions — $HTTP_CODE: $(msg)"
fi

if [[ -n "$PERM_ID" ]]; then
  if req PUT "$BASE/permissions/$PERM_ID" \
    "{\"resource\":\"test_mutation_res_${SUFFIX}_upd\",\"action\":\"all\"}" 200; then
    ok "PUT /permissions/:id"
  else
    fail "PUT /permissions/:id — $HTTP_CODE: $(msg)"
  fi
fi

# =============================================================================
# 2. ROLES
# =============================================================================
header "ROLES"

ROLE_ID=""
if req POST "$BASE/roles" \
  '{"name":"TEST_MUTATION_Role","description":"Automated test role"}' 201; then
  ROLE_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /roles → id=$ROLE_ID"
else
  fail "POST /roles — $HTTP_CODE: $(msg)"
fi

if [[ -n "$ROLE_ID" ]]; then
  if req PUT "$BASE/roles/$ROLE_ID" \
    '{"name":"TEST_MUTATION_Role_Updated","description":"Updated test role"}' 200; then
    ok "PUT /roles/:id"
  else
    fail "PUT /roles/:id — $HTTP_CODE: $(msg)"
  fi

  # Assign permission to role
  if [[ -n "$PERM_ID" ]]; then
    if req POST "$BASE/roles/$ROLE_ID/permissions" \
      "{\"permissionIds\":[\"$PERM_ID\"]}" 200; then
      ok "POST /roles/:id/permissions (assign)"
    else
      fail "POST /roles/:id/permissions — $HTTP_CODE: $(msg)"
    fi
  fi
fi

# =============================================================================
# 3. USERS
# =============================================================================
header "USERS"

NEW_USER_ID=""
if req POST "$BASE/users" \
  '{"email":"testmutation_user@eservice.com","password":"TestMut1234!","name":"TEST_MUTATION_User","role":"admin"}' 201; then
  NEW_USER_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /users → id=$NEW_USER_ID"
else
  fail "POST /users — $HTTP_CODE: $(msg)"
fi

if [[ -n "$NEW_USER_ID" ]]; then
  if req PUT "$BASE/users/$NEW_USER_ID" \
    '{"name":"TEST_MUTATION_User_Updated"}' 200; then
    ok "PUT /users/:id"
  else
    fail "PUT /users/:id — $HTTP_CODE: $(msg)"
  fi

  if req PATCH "$BASE/users/$NEW_USER_ID/password" \
    '{"currentPassword":"TestMut1234!","password":"TestMut5678!","confirmPassword":"TestMut5678!"}' 200; then
    ok "PATCH /users/:id/password"
  else
    fail "PATCH /users/:id/password — $HTTP_CODE: $(msg)"
  fi
fi

# =============================================================================
# 4. FAQs
# =============================================================================
header "FAQs"

FAQ_ID=""
if req POST "$BASE/faqs" \
  '{"question":"TEST_MUTATION_Question: How do I register?","answer":"TEST_MUTATION_Answer: Visit the portal and sign up.","order":99}' 201; then
  FAQ_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /faqs → id=$FAQ_ID"
else
  fail "POST /faqs — $HTTP_CODE: $(msg)"
fi

if [[ -n "$FAQ_ID" ]]; then
  if req PUT "$BASE/faqs/$FAQ_ID" \
    '{"question":"TEST_MUTATION_Question_Updated: How do I update my info?","answer":"TEST_MUTATION_Answer_Updated: Log in and go to your profile."}' 200; then
    ok "PUT /faqs/:id"
  else
    fail "PUT /faqs/:id — $HTTP_CODE: $(msg)"
  fi

  if req PATCH "$BASE/faqs/$FAQ_ID/deactivate" "" 200; then
    ok "PATCH /faqs/:id/deactivate"
  else
    fail "PATCH /faqs/:id/deactivate — $HTTP_CODE: $(msg)"
  fi

  if req PATCH "$BASE/faqs/$FAQ_ID/activate" "" 200; then
    ok "PATCH /faqs/:id/activate"
  else
    fail "PATCH /faqs/:id/activate — $HTTP_CODE: $(msg)"
  fi
fi

# =============================================================================
# 5. GOVERNMENT PROGRAMS
# =============================================================================
header "GOVERNMENT PROGRAMS"

PROG_ID=""
if req POST "$BASE/government-programs" \
  '{"name":"TEST_MUTATION_Program","description":"Automated test program","type":"ALL","isActive":true}' 201; then
  PROG_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /government-programs → id=$PROG_ID"
else
  fail "POST /government-programs — $HTTP_CODE: $(msg)"
fi

if [[ -n "$PROG_ID" ]]; then
  if req PUT "$BASE/government-programs/$PROG_ID" \
    '{"name":"TEST_MUTATION_Program_Updated","type":"ALL"}' 200; then
    ok "PUT /government-programs/:id"
  else
    fail "PUT /government-programs/:id — $HTTP_CODE: $(msg)"
  fi

  if req PATCH "$BASE/government-programs/$PROG_ID/deactivate" "" 200; then
    ok "PATCH /government-programs/:id/deactivate"
  else
    fail "PATCH /government-programs/:id/deactivate — $HTTP_CODE: $(msg)"
  fi

  if req PATCH "$BASE/government-programs/$PROG_ID/activate" "" 200; then
    ok "PATCH /government-programs/:id/activate"
  else
    fail "PATCH /government-programs/:id/activate — $HTTP_CODE: $(msg)"
  fi
fi

# =============================================================================
# 6. SOCIAL AMELIORATION SETTINGS
# =============================================================================
header "SOCIAL AMELIORATION SETTINGS"

SA_SETTING_ID=""
if req POST "$BASE/social-amelioration-settings" \
  '{"type":"PENSION_TYPE","name":"TEST_MUTATION_PensionType","description":"Automated test pension","isActive":true}' 201; then
  SA_SETTING_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /social-amelioration-settings → id=$SA_SETTING_ID"
else
  fail "POST /social-amelioration-settings — $HTTP_CODE: $(msg)"
fi

if [[ -n "$SA_SETTING_ID" ]]; then
  if req PUT "$BASE/social-amelioration-settings/$SA_SETTING_ID" \
    '{"name":"TEST_MUTATION_PensionType_Updated"}' 200; then
    ok "PUT /social-amelioration-settings/:id"
  else
    fail "PUT /social-amelioration-settings/:id — $HTTP_CODE: $(msg)"
  fi

  if req PATCH "$BASE/social-amelioration-settings/$SA_SETTING_ID/deactivate" "" 200; then
    ok "PATCH /social-amelioration-settings/:id/deactivate"
  else
    fail "PATCH /social-amelioration-settings/:id/deactivate — $HTTP_CODE: $(msg)"
  fi

  if req PATCH "$BASE/social-amelioration-settings/$SA_SETTING_ID/activate" "" 200; then
    ok "PATCH /social-amelioration-settings/:id/activate"
  else
    fail "PATCH /social-amelioration-settings/:id/activate — $HTTP_CODE: $(msg)"
  fi
fi

# =============================================================================
# 7. SERVICES
# =============================================================================
header "SERVICES"

SVC_ID=""
if req POST "$BASE/services" \
  '{"code":"TEST_MUTATION_SVC","name":"TEST MUTATION Service","description":"Automated test service","requiresPayment":false,"isActive":true}' 201; then
  SVC_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /services → id=$SVC_ID"
else
  fail "POST /services — $HTTP_CODE: $(msg)"
fi

if [[ -n "$SVC_ID" ]]; then
  if req PUT "$BASE/services/$SVC_ID" \
    '{"name":"TEST MUTATION Service Updated","description":"Updated description"}' 200; then
    ok "PUT /services/:id"
  else
    fail "PUT /services/:id — $HTTP_CODE: $(msg)"
  fi

  if req PATCH "$BASE/services/$SVC_ID/deactivate" "" 200; then
    ok "PATCH /services/:id/deactivate"
  else
    fail "PATCH /services/:id/deactivate — $HTTP_CODE: $(msg)"
  fi

  if req PATCH "$BASE/services/$SVC_ID/activate" "" 200; then
    ok "PATCH /services/:id/activate"
  else
    fail "PATCH /services/:id/activate — $HTTP_CODE: $(msg)"
  fi
fi

# =============================================================================
# 8. CITIZEN (requires full profile)
# =============================================================================
header "CITIZEN"

CITIZEN_ID=""
CITIZEN_PHONE="09$(shuf -i 100000000-999999999 -n 1)"

CITIZEN_USERNAME="testmut_$(date +%s)"
if form_req POST "$BASE/citizens" \
  "firstName=TestMutation" "lastName=Citizen" "phoneNumber=$CITIZEN_PHONE" \
  "birthDate=1995-06-15" "civilStatus=Single" "sex=Male" \
  "username=$CITIZEN_USERNAME" "pin=1234" \
  "region=Region VIII" "province=Eastern Samar" "municipality=Borongan" \
  "addressRegion=Region VIII" "addressProvince=Eastern Samar" \
  "addressMunicipality=Borongan" "addressBarangay=Barangay 1" \
  "addressPostalCode=6800" "idType=Passport" \
  "emergencyContactPerson=Test Guardian" "emergencyContactNumber=09991234560" \
  "isResident=true" "isVoter=false" "isEmployed=false"; then
  CITIZEN_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /citizens → id=$CITIZEN_ID"
else
  fail "POST /citizens — $HTTP_CODE: $(msg)"
fi

if [[ -n "$CITIZEN_ID" ]]; then
  if req PUT "$BASE/citizens/$CITIZEN_ID" \
    '{"firstName":"TestMutationUpdated","lastName":"Citizen"}' 200; then
    ok "PUT /citizens/:id"
  else
    fail "PUT /citizens/:id — $HTTP_CODE: $(msg)"
  fi

  # Approve citizen
  if req PATCH "$BASE/citizens/$CITIZEN_ID/approve" \
    '{"remarks":"Approved for test"}' 200; then
    ok "PATCH /citizens/:id/approve"
  else
    fail "PATCH /citizens/:id/approve — $HTTP_CODE: $(msg)"
  fi
fi

# =============================================================================
# 9. TAX PROFILES (requires service)
# =============================================================================
header "TAX PROFILES"

TAX_PROFILE_ID=""
if [[ -n "$SVC_ID" ]]; then
  if req POST "$BASE/tax-profiles" \
    "{\"serviceId\":\"$SVC_ID\",\"name\":\"TEST_MUTATION_TaxProfile\",\"isActive\":true}" 201; then
    TAX_PROFILE_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
    ok "POST /tax-profiles → id=$TAX_PROFILE_ID"
  else
    fail "POST /tax-profiles — $HTTP_CODE: $(msg)"
  fi

  if [[ -n "$TAX_PROFILE_ID" ]]; then
    if req PUT "$BASE/tax-profiles/$TAX_PROFILE_ID" \
      '{"name":"TEST_MUTATION_TaxProfile_Updated"}' 200; then
      ok "PUT /tax-profiles/:id"
    else
      fail "PUT /tax-profiles/:id — $HTTP_CODE: $(msg)"
    fi

    # Tax profile version
    TAX_VERSION_ID=""
    if req POST "$BASE/tax-profiles/$TAX_PROFILE_ID/versions" \
      "{\"version\":\"1.0.0\",\"effectiveFrom\":\"2026-01-01T00:00:00Z\",
        \"status\":\"DRAFT\",\"changeReason\":\"Initial version for automated test\",
        \"configuration\":{\"inputs\":[],\"derivedValues\":[],\"finalTax\":{\"formula\":\"0\"}}}" 2; then
      TAX_VERSION_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
      ok "POST /tax-profiles/:id/versions → id=$TAX_VERSION_ID"
    else
      fail "POST /tax-profiles/:id/versions — $HTTP_CODE: $(msg)"
    fi

    if [[ -n "$TAX_VERSION_ID" ]]; then
      if req PUT "$BASE/tax-profiles/versions/$TAX_VERSION_ID" \
        '{"changeReason":"Updated for automated test run","configuration":{"inputs":[],"derivedValues":[],"finalTax":{"formula":"0"}}}' 200; then
        ok "PUT /tax-profiles/versions/:versionId"
      else
        fail "PUT /tax-profiles/versions/:versionId — $HTTP_CODE: $(msg)"
      fi
    fi
  fi
else
  skip "POST /tax-profiles (no service created)"
fi

# =============================================================================
# 10. SOCIAL AMELIORATION — BENEFICIARIES (requires citizen + sa settings)
# =============================================================================
header "SOCIAL AMELIORATION BENEFICIARIES"

# Need a PENSION_TYPE setting ID for senior citizen beneficiary
PENSION_TYPE_ID=$(psql "$UNIFIED_DB_URL" -t -A -c \
  "SELECT id FROM social_amelioration_settings WHERE type='PENSION_TYPE' AND is_active=true LIMIT 1;" \
  2>/dev/null | tr -d ' ')
DISABILITY_TYPE_ID=$(psql "$UNIFIED_DB_URL" -t -A -c \
  "SELECT id FROM social_amelioration_settings WHERE type='DISABILITY_TYPE' AND is_active=true LIMIT 1;" \
  2>/dev/null | tr -d ' ')
GRADE_LEVEL_ID=$(psql "$UNIFIED_DB_URL" -t -A -c \
  "SELECT id FROM social_amelioration_settings WHERE type='GRADE_LEVEL' AND is_active=true LIMIT 1;" \
  2>/dev/null | tr -d ' ')
SOLO_PARENT_CAT_ID=$(psql "$UNIFIED_DB_URL" -t -A -c \
  "SELECT id FROM social_amelioration_settings WHERE type='SOLO_PARENT_CATEGORY' AND is_active=true LIMIT 1;" \
  2>/dev/null | tr -d ' ')

# Create a separate citizen for each beneficiary type (one citizen per type)
make_citizen() {
  local phone="09$(shuf -i 100000000-999999999 -n 1)"
  local suffix="$(date +%s%N | tail -c 6)"
  req POST "$BASE/citizens" \
    "{\"firstName\":\"BenefTest\",\"lastName\":\"$1\",\"phoneNumber\":\"$phone\",
      \"birthDate\":\"1960-01-01\",\"civilStatus\":\"Single\",\"sex\":\"Male\",
      \"username\":\"benef_${suffix}\",\"pin\":\"5678\",
      \"region\":\"Region VIII\",\"province\":\"Eastern Samar\",\"municipality\":\"Borongan\",
      \"emergencyContactPerson\":\"Guardian\",\"emergencyContactNumber\":\"09991234561\",
      \"isResident\":true,\"isVoter\":false,\"isEmployed\":false}" 201 || true
  jq_path "d.get('data',{}).get('id','') or d.get('id','')"
}

SENIOR_CITIZEN_ID=$(make_citizen "SeniorTest")
PWD_CITIZEN_ID=$(make_citizen "PWDTest")
STUDENT_CITIZEN_ID=$(make_citizen "StudentTest")
SOLO_PARENT_CITIZEN_ID=$(make_citizen "SoloParentTest")

# Senior citizen beneficiary
SENIOR_BEN_ID=""
if [[ -n "$SENIOR_CITIZEN_ID" && -n "$PENSION_TYPE_ID" ]]; then
  if req POST "$BASE/social-amelioration/seniors" \
    "{\"citizenId\":\"$SENIOR_CITIZEN_ID\",\"seniorCitizenId\":\"SC-TEST-001\",
      \"pensionTypes\":[\"$PENSION_TYPE_ID\"]}" 201; then
    SENIOR_BEN_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
    ok "POST /social-amelioration/seniors → id=$SENIOR_BEN_ID"
  else
    fail "POST /social-amelioration/seniors — $HTTP_CODE: $(msg)"
  fi

  if [[ -n "$SENIOR_BEN_ID" ]]; then
    if req PUT "$BASE/social-amelioration/seniors/$SENIOR_BEN_ID" \
      "{\"status\":\"ACTIVE\",\"pensionTypes\":[\"$PENSION_TYPE_ID\"]}" 200; then
      ok "PUT /social-amelioration/seniors/:id"
    else
      fail "PUT /social-amelioration/seniors/:id — $HTTP_CODE: $(msg)"
    fi
  fi
else
  skip "POST /social-amelioration/seniors (missing citizen or pension type setting)"
fi

# PWD beneficiary
PWD_BEN_ID=""
if [[ -n "$PWD_CITIZEN_ID" && -n "$DISABILITY_TYPE_ID" ]]; then
  if req POST "$BASE/social-amelioration/pwd" \
    "{\"citizenId\":\"$PWD_CITIZEN_ID\",\"pwdId\":\"PWD-TEST-001\",
      \"disabilityLevel\":\"Mild\",\"disabilityTypeId\":\"$DISABILITY_TYPE_ID\",
      \"monetaryAllowance\":true,\"assistedDevice\":false}" 201; then
    PWD_BEN_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
    ok "POST /social-amelioration/pwd → id=$PWD_BEN_ID"
  else
    fail "POST /social-amelioration/pwd — $HTTP_CODE: $(msg)"
  fi

  if [[ -n "$PWD_BEN_ID" ]]; then
    if req PUT "$BASE/social-amelioration/pwd/$PWD_BEN_ID" \
      '{"disabilityLevel":"Moderate","status":"ACTIVE"}' 200; then
      ok "PUT /social-amelioration/pwd/:id"
    else
      fail "PUT /social-amelioration/pwd/:id — $HTTP_CODE: $(msg)"
    fi
  fi
else
  skip "POST /social-amelioration/pwd (missing citizen or disability type setting)"
fi

# Student beneficiary
STUDENT_BEN_ID=""
if [[ -n "$STUDENT_CITIZEN_ID" && -n "$GRADE_LEVEL_ID" ]]; then
  if req POST "$BASE/social-amelioration/students" \
    "{\"citizenId\":\"$STUDENT_CITIZEN_ID\",\"studentId\":\"STU-TEST-001\",
      \"gradeLevelId\":\"$GRADE_LEVEL_ID\"}" 201; then
    STUDENT_BEN_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
    ok "POST /social-amelioration/students → id=$STUDENT_BEN_ID"
  else
    fail "POST /social-amelioration/students — $HTTP_CODE: $(msg)"
  fi

  if [[ -n "$STUDENT_BEN_ID" ]]; then
    if req PUT "$BASE/social-amelioration/students/$STUDENT_BEN_ID" \
      '{"status":"ACTIVE"}' 200; then
      ok "PUT /social-amelioration/students/:id"
    else
      fail "PUT /social-amelioration/students/:id — $HTTP_CODE: $(msg)"
    fi
  fi
else
  skip "POST /social-amelioration/students (missing citizen or grade level setting)"
fi

# Solo parent beneficiary
SOLO_BEN_ID=""
if [[ -n "$SOLO_PARENT_CITIZEN_ID" && -n "$SOLO_PARENT_CAT_ID" ]]; then
  if req POST "$BASE/social-amelioration/solo-parents" \
    "{\"citizenId\":\"$SOLO_PARENT_CITIZEN_ID\",\"soloParentId\":\"SP-TEST-001\",
      \"categoryId\":\"$SOLO_PARENT_CAT_ID\"}" 201; then
    SOLO_BEN_ID=$(jq_path "d.get('data',{}).get('id','') or d.get('id','')")
    ok "POST /social-amelioration/solo-parents → id=$SOLO_BEN_ID"
  else
    fail "POST /social-amelioration/solo-parents — $HTTP_CODE: $(msg)"
  fi

  if [[ -n "$SOLO_BEN_ID" ]]; then
    if req PUT "$BASE/social-amelioration/solo-parents/$SOLO_BEN_ID" \
      '{"status":"ACTIVE"}' 200; then
      ok "PUT /social-amelioration/solo-parents/:id"
    else
      fail "PUT /social-amelioration/solo-parents/:id — $HTTP_CODE: $(msg)"
    fi
  fi
else
  skip "POST /social-amelioration/solo-parents (missing citizen or category setting)"
fi

# =============================================================================
# 11. CITIZEN REGISTRATION (subscribe + submit registration request)
# =============================================================================
header "CITIZEN REGISTRATION"

# Create a subscriber linked to a citizen (simulates portal signup)
SUBSCRIBER_ID=""
SUB_PHONE="09$(shuf -i 100000000-999999999 -n 1)"
if req POST "$BASE/auth/portal/signup" \
  "{\"phoneNumber\":\"$SUB_PHONE\",\"password\":\"SubPass1234!\",\"confirmPassword\":\"SubPass1234!\",
    \"firstName\":\"TestSub\",\"lastName\":\"Subscriber\",
    \"birthDate\":\"2000-01-01\",\"civilStatus\":\"Single\",\"sex\":\"Male\"}" 201; then
  SUBSCRIBER_ID=$(jq_path "d.get('data',{}).get('subscriber',{}).get('id','') or d.get('data',{}).get('id','') or d.get('id','')")
  ok "POST /auth/portal/signup (create subscriber) → id=$SUBSCRIBER_ID"
else
  # Portal signup may require OTP flow — check response
  CODE_400=$(echo "$HTTP_CODE")
  fail "POST /auth/portal/signup — $HTTP_CODE: $(msg)"
fi

# =============================================================================
# CLEANUP — DELETE in reverse dependency order
# =============================================================================
header "CLEANUP"

# Social amelioration beneficiaries
[[ -n "$SENIOR_BEN_ID" ]] && {
  req DELETE "$BASE/social-amelioration/seniors/$SENIOR_BEN_ID" "" 200 \
    && ok "DELETE senior beneficiary" || fail "DELETE senior beneficiary — $HTTP_CODE"
}
[[ -n "$PWD_BEN_ID" ]] && {
  req DELETE "$BASE/social-amelioration/pwd/$PWD_BEN_ID" "" 200 \
    && ok "DELETE pwd beneficiary" || fail "DELETE pwd beneficiary — $HTTP_CODE"
}
[[ -n "$STUDENT_BEN_ID" ]] && {
  req DELETE "$BASE/social-amelioration/students/$STUDENT_BEN_ID" "" 200 \
    && ok "DELETE student beneficiary" || fail "DELETE student beneficiary — $HTTP_CODE"
}
[[ -n "$SOLO_BEN_ID" ]] && {
  req DELETE "$BASE/social-amelioration/solo-parents/$SOLO_BEN_ID" "" 200 \
    && ok "DELETE solo parent beneficiary" || fail "DELETE solo parent beneficiary — $HTTP_CODE"
}

# Citizens
for CID in "$CITIZEN_ID" "$SENIOR_CITIZEN_ID" "$PWD_CITIZEN_ID" "$STUDENT_CITIZEN_ID" "$SOLO_PARENT_CITIZEN_ID"; do
  [[ -n "$CID" ]] && {
    req PATCH "$BASE/citizens/$CID/remove" '{"reason":"Test cleanup"}' 200 \
      && ok "PATCH /citizens/:id/remove ($CID)" || fail "PATCH /citizens/:id/remove ($CID) — $HTTP_CODE"
  }
done

# Tax profile + version (version deleted via cascade when profile deleted)
[[ -n "$TAX_PROFILE_ID" ]] && {
  req DELETE "$BASE/tax-profiles/$TAX_PROFILE_ID" "" 200 \
    && ok "DELETE tax-profile" || fail "DELETE tax-profile — $HTTP_CODE"
}

# Service
[[ -n "$SVC_ID" ]] && {
  req DELETE "$BASE/services/$SVC_ID" "" 200 \
    && ok "DELETE service" || fail "DELETE service — $HTTP_CODE"
}

# Social amelioration setting
[[ -n "$SA_SETTING_ID" ]] && {
  req DELETE "$BASE/social-amelioration-settings/$SA_SETTING_ID" "" 200 \
    && ok "DELETE social amelioration setting" || fail "DELETE social amelioration setting — $HTTP_CODE"
}

# Government program
[[ -n "$PROG_ID" ]] && {
  req DELETE "$BASE/government-programs/$PROG_ID" "" 200 \
    && ok "DELETE government program" || fail "DELETE government program — $HTTP_CODE"
}

# FAQ
[[ -n "$FAQ_ID" ]] && {
  req DELETE "$BASE/faqs/$FAQ_ID" "" 200 \
    && ok "DELETE faq" || fail "DELETE faq — $HTTP_CODE"
}

# User
[[ -n "$NEW_USER_ID" ]] && {
  req DELETE "$BASE/users/$NEW_USER_ID" "" 200 \
    && ok "DELETE user" || fail "DELETE user — $HTTP_CODE"
}

# Role
[[ -n "$ROLE_ID" ]] && {
  req DELETE "$BASE/roles/$ROLE_ID" "" 200 \
    && ok "DELETE role" || fail "DELETE role — $HTTP_CODE"
}

# Permission — role_permissions has no FK cascade, so remove orphaned rows first
[[ -n "$PERM_ID" ]] && {
  [[ -n "$ROLE_ID" ]] && psql "$UNIFIED_DB_URL" -q -c \
    "DELETE FROM role_permissions WHERE permission_id='$PERM_ID';" 2>/dev/null
  req DELETE "$BASE/permissions/$PERM_ID" "" 200 \
    && ok "DELETE permission" || fail "DELETE permission — $HTTP_CODE"
}

# Subscriber cleanup (direct DB — no delete API)
[[ -n "$SUBSCRIBER_ID" ]] && {
  psql "$UNIFIED_DB_URL" -q -c \
    "DELETE FROM subscribers WHERE id='$SUBSCRIBER_ID';" 2>/dev/null \
    && ok "DB cleanup subscriber" || fail "DB cleanup subscriber"
}

# =============================================================================
# REPORT
# =============================================================================
echo ""
echo -e "${BOLD}============================================================${NC}"
echo -e "${BOLD}  E-Services Mutation Test Report${NC}"
echo -e "${BOLD}============================================================${NC}"
echo -e "  ${GREEN}PASS: $PASS${NC}"
echo -e "  ${RED}FAIL: $FAIL${NC}"
echo -e "  ${YELLOW}SKIP: $SKIP${NC}"
echo -e "  Total: $((PASS+FAIL+SKIP))"
echo ""
[[ $FAIL -eq 0 ]] && echo -e "  ${GREEN}${BOLD}All mutation tests passed.${NC}" \
                  || echo -e "  ${RED}${BOLD}$FAIL test(s) failed — review output above.${NC}"
echo -e "${BOLD}============================================================${NC}"

exit $FAIL
