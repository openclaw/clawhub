#!/usr/bin/env bash
set -euo pipefail

readonly SOURCE_SHA="f7d1d8e12bdde83fb2b20d4be763acdf4ccf3179"
readonly DEPLOYMENT="academic-chihuahua-392"
readonly CONVEX_URL_EXPECTED="https://${DEPLOYMENT}.convex.cloud"
readonly CONVEX_SITE="https://${DEPLOYMENT}.convex.site"
readonly OPERATOR_URL="${CONVEX_SITE}/api/v1/operator/skills-sh/catalog-test"
readonly PUBLIC_URL="${CONVEX_SITE}/api/v1/skills-sh/patrick-erichsen/skills/html"
readonly VERIFY_URL="${CONVEX_SITE}/api/v1/skills/html/verify?reference=skills-sh%2Fpatrick-erichsen%2Fskills%2Fhtml"
readonly CANARY_ID="patrick-erichsen/skills/html"
readonly CANARY_COMMIT="050daba89f6b6636470add5cb300aac46a412cf8"
readonly CANARY_FOLDER_HASH="a47adb2c1ac33c088f664b5187971b63d2b958a7b9f01516d26005ca941a108f"
readonly CANARY_FILE_SHA="42d2e89358ea927441dfede45c3b0cf89a21603bc7c32246f098d24a9cbea1ff"
readonly CANARY_ARTIFACT_HASH="c3e39b71c040e694d041b94eabdd5f80defe5c82e09bb744825a6810bd0d8515"
readonly ARTIFACT_DIR=".artifacts/claw558-test"

mkdir -p "$ARTIFACT_DIR"

convex_run() {
  bunx convex run --no-push "$@"
}

assert_exact_test() {
  if [[ "${VITE_CONVEX_URL:-}" != "$CONVEX_URL_EXPECTED" ]]; then
    echo "::error::VITE_CONVEX_URL must target ${DEPLOYMENT}"
    exit 1
  fi
  if [[ "${CONVEX_DEPLOY_KEY:-}" != prod:${DEPLOYMENT}\|* ]]; then
    echo "::error::CONVEX_DEPLOY_KEY must target ${DEPLOYMENT}"
    exit 1
  fi
  convex_run appMeta:getDeploymentInfo '{}' > "$ARTIFACT_DIR/deployment.json"
  jq -e --arg sha "$SOURCE_SHA" '.appBuildSha == $sha' "$ARTIFACT_DIR/deployment.json" >/dev/null
}

seed_operator_token() {
  local token_seed
  token_seed="$(convex_run devSeed:seedCliRoleHelpFixtures '{}')"
  operator_token="$(jq -r '.admin.token // empty' <<<"$token_seed")"
  token_seed=""
  if [[ -z "$operator_token" ]]; then
    echo "::error::Test admin fixture token is missing"
    exit 1
  fi
  echo "::add-mask::$operator_token"
}

operator_post() {
  local output="$1"
  local payload="$2"
  local expected_status="${3:-200}"
  local response_status
  response_status="$(
    curl \
      --silent \
      --show-error \
      --output "$output" \
      --write-out '%{http_code}' \
      --request POST \
      --header "Authorization: Bearer $operator_token" \
      --header "Content-Type: application/json" \
      --data "$payload" \
      "$OPERATOR_URL"
  )"
  if [[ "$response_status" != "$expected_status" ]]; then
    echo "::error::Operator request returned HTTP $response_status, expected $expected_status"
    cat "$output"
    exit 1
  fi
}

configure_controls() {
  local publication="$1"
  local max_native_queued="$2"
  local max_native_in_flight="$3"
  convex_run skillsShCatalog:configureFixtureControlInternal "$(
    jq -nc \
      --argjson publication "$publication" \
      --argjson maxNativeQueued "$max_native_queued" \
      --argjson maxNativeInFlight "$max_native_in_flight" \
      '{
        actor:"CLAW-558 exact-head Test proof",
        reason:"One exact controlled catalog scan with native queue protection",
        confirm:"enable-skills-sh-fixture-control",
        mode:"staging-live",
        discoveryEnabled:false,
        writesEnabled:false,
        scanPlanningEnabled:true,
        scanAdmissionEnabled:true,
        publicVisibilityEnabled:$publication,
        maxEntriesPerRun:1,
        maxEntriesPerBatch:1,
        maxWritesPerBatch:10,
        maxPlannedScans:1,
        maxScanAdmissionsPerBatch:1,
        maxScanAdmissionsPerRun:1,
        maxScanAdmissionsPerDay:10,
        maxCatalogQueued:1,
        maxCatalogInFlight:1,
        maxNativeQueued:$maxNativeQueued,
        maxNativeInFlight:$maxNativeInFlight,
        realScanAllowlist:["patrick-erichsen/skills/html"]
      }'
  )"
}

seed_canary_fixture() {
  bunx convex env set GITHUB_TOKEN "$OPENCLAW_GH_TOKEN" --prod >/dev/null
  convex_run skillsShCatalog:configureFixtureControlInternal '{
    "actor":"CLAW-558 exact-head Test proof",
    "reason":"Recreate the exact authenticated hidden CLAW-557 canary before scan admission",
    "confirm":"enable-skills-sh-fixture-control",
    "mode":"fixture",
    "discoveryEnabled":true,
    "writesEnabled":true,
    "scanPlanningEnabled":true,
    "scanAdmissionEnabled":false,
    "publicVisibilityEnabled":false,
    "maxEntriesPerRun":1,
    "maxEntriesPerBatch":1,
    "maxWritesPerBatch":2,
    "maxPlannedScans":1,
    "maxScanAdmissionsPerBatch":0,
    "maxScanAdmissionsPerRun":0,
    "maxScanAdmissionsPerDay":0,
    "maxCatalogQueued":0,
    "maxCatalogInFlight":0,
    "maxNativeQueued":0,
    "maxNativeInFlight":0,
    "realScanAllowlist":[]
  }' > "$ARTIFACT_DIR/control-canary-seed.json"
  operator_post "$ARTIFACT_DIR/canary-seed-start.json" \
    '{"operation":"start-canary","reason":"CLAW-558 exact authenticated canary seed"}'
  local run_id
  run_id="$(jq -r '.runId' "$ARTIFACT_DIR/canary-seed-start.json")"
  [[ -n "$run_id" ]]
  operator_post "$ARTIFACT_DIR/canary-seed-run.json" "$(
    jq -nc --arg runId "$run_id" '{operation:"process-fixture",runId:$runId}'
  )"
  operator_post "$ARTIFACT_DIR/canary-seed-reconcile.json" "$(
    jq -nc --arg runId "$run_id" '{operation:"reconcile",runId:$runId}'
  )"
  jq -e '
    .status == "completed" and
    .cursor == 1 and
    .counts.observed == 1 and
    .counts.scansAdmitted == 0
  ' "$ARTIFACT_DIR/canary-seed-run.json" >/dev/null
  jq -e '
    .reconciled == true and
    (.mismatches | length) == 0 and
    (.entries | length) == 1
  ' "$ARTIFACT_DIR/canary-seed-reconcile.json" >/dev/null
}

set_publication() {
  local enabled="$1"
  operator_post "$ARTIFACT_DIR/set-publication-${enabled}.json" "$(
    jq -nc \
      --argjson enabled "$enabled" \
      '{
        operation:"set-publication",
        enabled:$enabled,
        reason:"CLAW-558 exact-attempt publication proof",
        confirm:"set-skills-sh-test-publication"
      }'
  )"
}

set_pause() {
  local paused="$1"
  operator_post "$ARTIFACT_DIR/set-pause-${paused}.json" "$(
    jq -nc \
      --argjson paused "$paused" \
      '{
        operation:"set-pause",
        paused:$paused,
        reason:"CLAW-558 catalog-only pause proof",
        confirm:"set-skills-sh-test-pause"
      }'
  )"
}

start_scan() {
  local output="$1"
  operator_post "$output" \
    '{"operation":"start-canary-scan","reason":"CLAW-558 exact controlled canary scan"}'
}

build_artifact_payload() {
  local github_api_url
  github_api_url="https://api.github.com/repos/Patrick-Erichsen/skills/contents/skills/html/SKILL.md?ref=${CANARY_COMMIT}"
  curl \
    --fail-with-body \
    --silent \
    --show-error \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer $OPENCLAW_GH_TOKEN" \
    --header "User-Agent: clawhub-claw558-test-gate" \
    --header "X-GitHub-Api-Version: 2022-11-28" \
    "$github_api_url" > "$ARTIFACT_DIR/github-file.json"
  jq -r '.content' "$ARTIFACT_DIR/github-file.json" | tr -d '\n' | base64 --decode \
    > "$ARTIFACT_DIR/SKILL.md"
  local file_sha file_size folder_hash artifact_hash content_base64
  file_sha="$(sha256sum "$ARTIFACT_DIR/SKILL.md" | cut -d' ' -f1)"
  file_size="$(wc -c < "$ARTIFACT_DIR/SKILL.md" | tr -d ' ')"
  folder_hash="$(
    printf 'SKILL.md\0%s\0%s' "$file_size" "$file_sha" |
      sha256sum |
      cut -d' ' -f1
  )"
  artifact_hash="$(
    printf 'SKILL.md\0%s\n' "$file_sha" |
      sha256sum |
      cut -d' ' -f1
  )"
  [[ "$file_sha" == "$CANARY_FILE_SHA" ]]
  [[ "$file_size" == "5688" ]]
  [[ "$folder_hash" == "$CANARY_FOLDER_HASH" ]]
  [[ "$artifact_hash" == "$CANARY_ARTIFACT_HASH" ]]
  content_base64="$(base64 -w 0 "$ARTIFACT_DIR/SKILL.md")"
  jq -nc \
    --arg externalId "$CANARY_ID" \
    --arg artifactContentHash "$artifact_hash" \
    --arg contentBase64 "$content_base64" \
    --arg sha256 "$file_sha" \
    --argjson size "$file_size" \
    '{
      operation:"admit",
      runId:"",
      externalIds:[$externalId],
      artifacts:[{
        externalId:$externalId,
        artifactContentHash:$artifactContentHash,
        files:[{
          path:"SKILL.md",
          size:$size,
          sha256:$sha256,
          contentBase64:$contentBase64,
          contentType:"text/markdown"
        }]
      }]
    }' > "$ARTIFACT_DIR/admit-template.json"
}

admit_scan() {
  local output="$1"
  local run_id="$2"
  local expected_status="${3:-200}"
  local payload
  payload="$(jq --arg runId "$run_id" '.runId = $runId' "$ARTIFACT_DIR/admit-template.json")"
  operator_post "$output" "$payload" "$expected_status"
}

read_status() {
  local output="$1"
  convex_run skillsShCatalog:getStatusInternal '{}' > "$output"
  local cursor="null"
  while true; do
    local args page canary
    if [[ "$cursor" == "null" ]]; then
      args='{"paginationOpts":{"cursor":null,"numItems":100}}'
    else
      args="$(jq -nc --arg cursor "$cursor" \
        '{paginationOpts:{cursor:$cursor,numItems:100}}')"
    fi
    page="$(convex_run skillsShCatalog:listEntriesPageInternal "$args")"
    canary="$(jq -c --arg externalId "$CANARY_ID" \
      '.page[] | select(.externalId == $externalId)' <<<"$page")"
    if [[ -n "$canary" ]]; then
      jq --argjson canary "$canary" --arg externalId "$CANARY_ID" \
        '.entries = ([.entries[] | select(.externalId != $externalId)] + [$canary])' \
        "$output" > "${output}.tmp"
      mv "${output}.tmp" "$output"
      return
    fi
    if [[ "$(jq -r '.isDone' <<<"$page")" == "true" ]]; then
      echo "::error::Controlled canary is missing from Test catalog state"
      exit 1
    fi
    cursor="$(jq -r '.continueCursor' <<<"$page")"
    if [[ -z "$cursor" || "$cursor" == "null" ]]; then
      echo "::error::Catalog entry pagination returned an incomplete cursor"
      exit 1
    fi
  done
}

assert_public_status() {
  local output="$1"
  curl --fail-with-body --silent --show-error "$PUBLIC_URL" > "$output"
  jq -e \
    --arg sha "$CANARY_COMMIT" \
    --arg hash "$CANARY_FOLDER_HASH" \
    '
      .ref == "skills-sh/patrick-erichsen/skills/html" and
      .route == "/skills-sh/patrick-erichsen/skills/html" and
      (.security.verdict == "clean" or .security.verdict == "suspicious") and
      .security.source == "clawhub" and
      .install.installKind == "github" and
      .install.github.repo == "patrick-erichsen/skills" and
      .install.github.path == "skills/html" and
      .install.github.commit == $sha and
      .install.github.contentHash == $hash
    ' "$output" >/dev/null
}

assert_hidden() {
  local output="$1"
  local status
  status="$(
    curl \
      --silent \
      --show-error \
      --output "$output" \
      --write-out '%{http_code}' \
      "$PUBLIC_URL"
  )"
  [[ "$status" == "404" ]]
}

assert_verify_status() {
  local output="$1"
  local expected_attempt="$2"
  curl --fail-with-body --silent --show-error "$VERIFY_URL" > "$output"
  jq -e \
    --arg attemptId "$expected_attempt" \
    --arg commit "$CANARY_COMMIT" \
    --arg folderHash "$CANARY_FOLDER_HASH" \
    --arg artifactHash "$CANARY_ARTIFACT_HASH" \
    --arg fileSha "$CANARY_FILE_SHA" \
    '
      .schema == "clawhub.skill.verify.v1" and
      .slug == "skills-sh/patrick-erichsen/skills/html" and
      .version == $commit and
      .resolvedFrom == "latest" and
      .tag == null and
      (
        (.security.verdict == "clean" and .ok == true and .decision == "pass" and
          .security.passed == true and (.reasons | length) == 0) or
        (.security.verdict == "suspicious" and .ok == false and .decision == "fail" and
          .security.passed == false and .reasons == ["security.status_not_clean"])
      ) and
      .security.attemptId == $attemptId and
      .artifact.sourceFingerprint == $folderHash and
      .artifact.bundleFingerprints == [$artifactHash] and
      .artifact.files == [{
        path:"SKILL.md",
        size:5688,
        sha256:$fileSha,
        contentType:"text/markdown"
      }] and
      .provenance.reference == "skills-sh/patrick-erichsen/skills/html" and
      .provenance.repository == "patrick-erichsen/skills" and
      .provenance.path == "skills/html" and
      .provenance.commit == $commit and
      .provenance.contentHash == $folderHash and
      .provenance.scanAttemptId == $attemptId and
      .provenance.artifactContentHash == $artifactHash
    ' "$output" >/dev/null
}

run_catalog_worker() {
  local label="$1"
  CODEX_SECURITY_SCAN_DIAGNOSTICS_DIR="$ARTIFACT_DIR/worker-${label}" \
  CODEX_SECURITY_SCAN_SHARD="catalog-${label}" \
  CODEX_SECURITY_SCAN_WORKER_ID="github-actions:${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:catalog-${label}" \
  bun scripts/security/run-codex-scan-worker.ts \
    --batch-limit 1 \
    --lane catalog \
    --max-jobs 1 \
    --max-runtime-minutes 20 \
    --lease-minutes 60
}

prove_clawhub_cli() {
  bun run --cwd packages/clawhub build
  local workdir install_dir
  workdir="$(mktemp -d)"
  install_dir="$workdir/skills"
  node packages/clawhub/bin/clawdhub.js \
    --registry "$CONVEX_SITE" \
    --workdir "$workdir" \
    --dir "$install_dir" \
    --no-input \
    install skills-sh/patrick-erichsen/skills/html \
    > "$ARTIFACT_DIR/clawhub-install.txt" 2>&1
  sha256sum "$install_dir/html/SKILL.md" > "$ARTIFACT_DIR/clawhub-installed-sha256.txt"
  grep -F "$CANARY_FILE_SHA" "$ARTIFACT_DIR/clawhub-installed-sha256.txt" >/dev/null
  find "$workdir" -maxdepth 5 -type f -print -exec sed -n '1,80p' {} \; \
    > "$ARTIFACT_DIR/clawhub-installed-state.txt"
  grep -F "skills-sh/patrick-erichsen/skills/html" \
    "$ARTIFACT_DIR/clawhub-installed-state.txt" >/dev/null
  local verify_status
  set +e
  node packages/clawhub/bin/clawdhub.js \
    --registry "$CONVEX_SITE" \
    skill verify skills-sh/patrick-erichsen/skills/html \
    > "$ARTIFACT_DIR/clawhub-verify.json" 2>&1
  verify_status="$?"
  set -e
  jq -e \
    --arg commit "$CANARY_COMMIT" \
    --arg folderHash "$CANARY_FOLDER_HASH" \
    --arg artifactHash "$CANARY_ARTIFACT_HASH" \
    --arg fileSha "$CANARY_FILE_SHA" \
    '
      .schema == "clawhub.skill.verify.v1" and
      .slug == "skills-sh/patrick-erichsen/skills/html" and
      .version == $commit and
      .artifact.sourceFingerprint == $folderHash and
      .artifact.bundleFingerprints == [$artifactHash] and
      .artifact.files[0].sha256 == $fileSha
    ' "$ARTIFACT_DIR/clawhub-verify.json" >/dev/null
  if [[ "$(jq -r '.security.status' "$ARTIFACT_DIR/clawhub-verify.json")" == "clean" ]]; then
    [[ "$verify_status" == "0" ]]
  else
    [[ "$verify_status" == "1" ]]
  fi
  if node packages/clawhub/bin/clawdhub.js \
    --registry "http://127.0.0.1:1" \
    --workdir "$workdir/colon" \
    --dir "$workdir/colon/skills" \
    --no-input \
    install skills-sh:patrick-erichsen/skills/html \
    > "$ARTIFACT_DIR/clawhub-colon-rejection.txt" 2>&1
  then
    echo "::error::Colon-form ClawHub reference unexpectedly succeeded"
    exit 1
  fi
  grep -F "use skills-sh/owner/repo/slug" "$ARTIFACT_DIR/clawhub-colon-rejection.txt" >/dev/null
  rm -rf "$workdir"
}

rollback_attempt() {
  local output="$1"
  local attempt_id="$2"
  operator_post "$output" "$(
    jq -nc \
      --arg externalId "$CANARY_ID" \
      --arg attemptId "$attempt_id" \
      '{
        operation:"rollback-publication",
        externalId:$externalId,
        attemptId:$attemptId,
        reason:"CLAW-558 exact publication rollback proof",
        confirm:"rollback-skills-sh-test-publication"
      }'
  )"
}

disable_catalog() {
  local reason="$1"
  convex_run skillsShCatalog:disableCatalogInternal "$(
    jq -nc \
      --arg reason "$reason" \
      '{
        actor:"CLAW-558 Test workflow",
        reason:$reason,
        confirm:"disable-skills-sh-catalog"
      }'
  )"
}

proof() {
  assert_exact_test
  seed_operator_token
  bunx convex env set SECURITY_SCAN_WORKER_TOKEN "$SECURITY_SCAN_WORKER_TOKEN" --prod >/dev/null
  seed_canary_fixture
  read_status "$ARTIFACT_DIR/status-before.json"
  jq -e \
    --arg externalId "$CANARY_ID" \
    --arg commit "$CANARY_COMMIT" \
    --arg hash "$CANARY_FOLDER_HASH" \
    '
      ([.scanAttempts[] | select(.status == "queued" or .status == "running")] | length) == 0 and
      ([.entries[] |
        select(
          .externalId == $externalId and
          .githubOwnerId == 20157849 and
          .githubPath == "skills/html" and
          .githubCommit == $commit and
          .githubContentHash == $hash
        )
      ] | length) == 1
    ' "$ARTIFACT_DIR/status-before.json" >/dev/null
  convex_run skillsShCatalog:getIsolationDigestInternal '{}' \
    > "$ARTIFACT_DIR/isolation-before.json"
  native_queued="$(jq -r '.nativeScanJobs.queued' "$ARTIFACT_DIR/isolation-before.json")"
  native_running="$(jq -r '.nativeScanJobs.running' "$ARTIFACT_DIR/isolation-before.json")"
  if (( native_queued < 1 )); then
    echo "::error::CLAW-558 native queue-health proof requires an existing Test native queue"
    exit 1
  fi
  blocked_native_queued=$((native_queued - 1))

  operator_post "$ARTIFACT_DIR/verify-canary.json" \
    '{"operation":"verify-canary","reason":"CLAW-558 exact GitHub verification"}'
  jq -e \
    --arg commit "$CANARY_COMMIT" \
    --arg hash "$CANARY_FOLDER_HASH" \
    '
      .externalId == "patrick-erichsen/skills/html" and
      .githubOwnerId == 20157849 and
      .githubRepo == "patrick-erichsen/skills" and
      .githubPath == "skills/html" and
      .githubCommit == $commit and
      .githubContentHash == $hash and
      .githubFetches >= 4
    ' "$ARTIFACT_DIR/verify-canary.json" >/dev/null
  build_artifact_payload

  configure_controls false "$blocked_native_queued" "$native_running" \
    > "$ARTIFACT_DIR/control-guarded.json"
  start_scan "$ARTIFACT_DIR/start-a.json"
  run_a="$(jq -r '.runId' "$ARTIFACT_DIR/start-a.json")"
  admit_scan "$ARTIFACT_DIR/admit-blocked.json" "$run_a" 400
  grep -F "blocked by queue health" "$ARTIFACT_DIR/admit-blocked.json" >/dev/null

  configure_controls false "$native_queued" "$native_running" \
    > "$ARTIFACT_DIR/control-active-hidden.json"
  admit_scan "$ARTIFACT_DIR/admit-a.json" "$run_a"
  jq -e \
    --arg externalId "$CANARY_ID" \
    '
      .admitted == 1 and
      .admittedExternalIds == [$externalId] and
      .queueHealth.catalogQueued == 0 and
      .queueHealth.catalogInFlight == 0 and
      .queueHealth.healthy == true
    ' "$ARTIFACT_DIR/admit-a.json" >/dev/null
  assert_hidden "$ARTIFACT_DIR/public-before-verdict.txt"
  run_catalog_worker a

  read_status "$ARTIFACT_DIR/status-a-scanned.json"
  attempt_a="$(
    jq -r \
      --arg externalId "$CANARY_ID" \
      '[.scanAttempts[] |
        select(.externalId == $externalId and .status == "succeeded")
      ] | sort_by(.createdAt) | last | ._id // empty' \
      "$ARTIFACT_DIR/status-a-scanned.json"
  )"
  [[ -n "$attempt_a" ]]
  jq -e \
    --arg attemptId "$attempt_a" \
    --arg commit "$CANARY_COMMIT" \
    --arg hash "$CANARY_FOLDER_HASH" \
    '
      ([.scanAttempts[] |
        select(
          ._id == $attemptId and
          .dispatchKind == "real" and
          .source == "skills-sh-catalog-test" and
          .priority == "low" and
          .status == "succeeded" and
          (.verdict == "clean" or .verdict == "suspicious") and
          .githubOwnerId == 20157849 and
          .owner == "patrick-erichsen" and
          .repo == "skills" and
          .slug == "html" and
          .githubPath == "skills/html" and
          .githubCommit == $commit and
          .githubContentHash == $hash and
          .artifactContentHash == "c3e39b71c040e694d041b94eabdd5f80defe5c82e09bb744825a6810bd0d8515"
        )
      ] | length) == 1 and
      ([.entries[] |
        select(.externalId == "patrick-erichsen/skills/html" and .publicVisible == false)
      ] | length) == 1
    ' "$ARTIFACT_DIR/status-a-scanned.json" >/dev/null

  set_publication true
  set_pause true
  assert_hidden "$ARTIFACT_DIR/public-paused.txt"
  operator_post "$ARTIFACT_DIR/start-paused.txt" \
    '{"operation":"start-canary-scan","reason":"CLAW-558 paused admission rejection"}' 400
  grep -F "paused" "$ARTIFACT_DIR/start-paused.txt" >/dev/null
  set_pause false
  start_scan "$ARTIFACT_DIR/resume-promotion.json"
  jq -e --arg runId "$run_a" '.reused == true and .runId == $runId' \
    "$ARTIFACT_DIR/resume-promotion.json" >/dev/null
  assert_public_status "$ARTIFACT_DIR/public-a.json"
  assert_verify_status \
    "$ARTIFACT_DIR/verify-a.json" \
    "$(jq -r '.security.attemptId' "$ARTIFACT_DIR/public-a.json")"
  prove_clawhub_cli

  rollback_attempt "$ARTIFACT_DIR/rollback-a.json" "$attempt_a"
  jq -e '.publicVisible == false and .alreadyRolledBack == false' \
    "$ARTIFACT_DIR/rollback-a.json" >/dev/null
  assert_hidden "$ARTIFACT_DIR/public-after-rollback-a.txt"

  start_scan "$ARTIFACT_DIR/start-b.json"
  run_b="$(jq -r '.runId' "$ARTIFACT_DIR/start-b.json")"
  [[ "$run_b" != "$run_a" ]]
  admit_scan "$ARTIFACT_DIR/admit-b.json" "$run_b"
  run_catalog_worker b
  assert_public_status "$ARTIFACT_DIR/public-b.json"
  attempt_b="$(jq -r '.security.attemptId' "$ARTIFACT_DIR/public-b.json")"
  [[ -n "$attempt_b" && "$attempt_b" != "$attempt_a" ]]
  assert_verify_status "$ARTIFACT_DIR/verify-b.json" "$attempt_b"

  convex_run skillsShCatalog:recordRealScanResultInternal "$(
    jq -nc \
      --arg attemptId "$attempt_a" \
      --arg artifactContentHash "$CANARY_ARTIFACT_HASH" \
      '{
        attemptId:$attemptId,
        artifactContentHash:$artifactContentHash,
        verdict:"clean"
      }'
  )" > "$ARTIFACT_DIR/stale-callback-a.json"
  jq -e '.applied == false and .reason == "attempt-not-active"' \
    "$ARTIFACT_DIR/stale-callback-a.json" >/dev/null
  assert_public_status "$ARTIFACT_DIR/public-after-stale-callback.json"
  jq -e --arg attemptId "$attempt_b" '.security.attemptId == $attemptId' \
    "$ARTIFACT_DIR/public-after-stale-callback.json" >/dev/null
  assert_verify_status "$ARTIFACT_DIR/verify-after-stale-callback.json" "$attempt_b"

  rollback_attempt "$ARTIFACT_DIR/old-rollback-a.json" "$attempt_a"
  jq -e '.alreadyRolledBack == true and .publicVisible == true' \
    "$ARTIFACT_DIR/old-rollback-a.json" >/dev/null
  assert_public_status "$ARTIFACT_DIR/public-after-old-rollback.json"
  jq -e --arg attemptId "$attempt_b" '.security.attemptId == $attemptId' \
    "$ARTIFACT_DIR/public-after-old-rollback.json" >/dev/null

  start_scan "$ARTIFACT_DIR/idempotent-b.json"
  jq -e --arg runId "$run_b" '.reused == true and .runId == $runId' \
    "$ARTIFACT_DIR/idempotent-b.json" >/dev/null
  disable_catalog "CLAW-558 kill-control proof" > "$ARTIFACT_DIR/control-killed.json"
  assert_hidden "$ARTIFACT_DIR/public-killed.txt"
  operator_post "$ARTIFACT_DIR/start-killed.txt" \
    '{"operation":"start-canary-scan","reason":"CLAW-558 killed admission rejection"}' 400
  grep -F "disabled" "$ARTIFACT_DIR/start-killed.txt" >/dev/null

  configure_controls true "$native_queued" "$native_running" \
    > "$ARTIFACT_DIR/control-browser-hold.json"
  start_scan "$ARTIFACT_DIR/republish-after-kill.json"
  jq -e --arg runId "$run_b" '.reused == true and .runId == $runId' \
    "$ARTIFACT_DIR/republish-after-kill.json" >/dev/null
  assert_public_status "$ARTIFACT_DIR/public-final.json"

  convex_run skillsShCatalog:getIsolationDigestInternal '{}' \
    > "$ARTIFACT_DIR/isolation-after.json"
  jq -e --slurpfile before "$ARTIFACT_DIR/isolation-before.json" '
    .nativeSkills == $before[0].nativeSkills and
    .nativeScanJobs.queued == $before[0].nativeScanJobs.queued and
    .nativeScanJobs.running == $before[0].nativeScanJobs.running
  ' "$ARTIFACT_DIR/isolation-after.json" >/dev/null
  read_status "$ARTIFACT_DIR/status-final.json"
  jq -e \
    --arg attemptId "$attempt_b" \
    '
      .control.mode == "staging-live" and
      .control.paused == false and
      .control.publicVisibilityEnabled == true and
      .control.realScanAllowlist == ["patrick-erichsen/skills/html"] and
      ([.scanAttempts[] | select(.status == "queued" or .status == "running")] | length) == 0 and
      ([.entries[] |
        select(
          .externalId == "patrick-erichsen/skills/html" and
          .publicVisible == true and
          .publishedScanAttemptId == $attemptId
        )
      ] | length) == 1
    ' "$ARTIFACT_DIR/status-final.json" >/dev/null
  jq -n \
    --arg sourceSha "$SOURCE_SHA" \
    --arg attemptA "$attempt_a" \
    --arg attemptB "$attempt_b" \
    --arg testSiteUrl "${TEST_SITE_URL:-}" \
    --arg publicRoute "${TEST_SITE_URL:-}/skills-sh/patrick-erichsen/skills/html" \
    '{
      sourceSha:$sourceSha,
      attemptA:$attemptA,
      attemptB:$attemptB,
      testSiteUrl:$testSiteUrl,
      publicRoute:$publicRoute,
      state:"public-for-codex-app-browser-proof",
      cleanupAction:"dispatch claw558_action=cleanup"
    }' > "$ARTIFACT_DIR/proof-summary.json"
}

cleanup() {
  assert_exact_test
  seed_operator_token
  read_status "$ARTIFACT_DIR/cleanup-before.json"
  mapfile -t active_run_ids < <(
    jq -r '
      [.scanAttempts[] |
        select(.status == "queued" or .status == "running") |
        .runId
      ] | unique[]
    ' "$ARTIFACT_DIR/cleanup-before.json"
  )
  for run_id in "${active_run_ids[@]}"; do
    convex_run skillsShCatalog:cancelCatalogRunInternal "$(
      jq -nc --arg runId "$run_id" '{runId:$runId,limit:100}'
    )" > "$ARTIFACT_DIR/cleanup-cancel-${run_id}.json"
  done
  read_status "$ARTIFACT_DIR/cleanup-after-cancel.json"
  active_attempts="$(
    jq '[.scanAttempts[] | select(.status == "queued" or .status == "running")] | length' \
      "$ARTIFACT_DIR/cleanup-after-cancel.json"
  )"
  if [[ "$active_attempts" != "0" ]]; then
    echo "::error::Refusing cleanup with active catalog scan work"
    exit 1
  fi
  published_attempt="$(
    jq -r \
      --arg externalId "$CANARY_ID" \
      '[.entries[] |
        select(.externalId == $externalId and .publishedScanAttemptId != null)
      ] | first | .publishedScanAttemptId // empty' \
      "$ARTIFACT_DIR/cleanup-before.json"
  )"
  if [[ -n "$published_attempt" ]]; then
    rollback_attempt "$ARTIFACT_DIR/cleanup-rollback.json" "$published_attempt"
  fi
  disable_catalog "CLAW-558 permanent Test cleanup" > "$ARTIFACT_DIR/cleanup-disabled.json"
  bunx convex env remove GITHUB_TOKEN --prod >/dev/null
  read_status "$ARTIFACT_DIR/cleanup-after.json"
  jq -e '
    .control.mode == "off" and
    .control.paused == true and
    .control.discoveryEnabled == false and
    .control.writesEnabled == false and
    .control.scanPlanningEnabled == false and
    .control.scanAdmissionEnabled == false and
    .control.publicVisibilityEnabled == false and
    .control.realScanAllowlist == [] and
    ([.scanAttempts[] | select(.status == "queued" or .status == "running")] | length) == 0 and
    ([.entries[] |
      select(
        .externalId == "patrick-erichsen/skills/html" and
        (.publicVisible == true or .publishedScanAttemptId != null)
      )
    ] | length) == 0
  ' "$ARTIFACT_DIR/cleanup-after.json" >/dev/null
  assert_hidden "$ARTIFACT_DIR/cleanup-public.txt"

  old_operator_token="$operator_token"
  seed_operator_token
  revoked_status="$(
    curl \
      --silent \
      --output /dev/null \
      --write-out '%{http_code}' \
      --header "Authorization: Bearer $old_operator_token" \
      "$OPERATOR_URL"
  )"
  [[ "$revoked_status" == "401" ]]
  jq -n \
    --arg sourceSha "$SOURCE_SHA" \
    --arg revokedStatus "$revoked_status" \
    '{
      sourceSha:$sourceSha,
      controlsDisabled:true,
      activeCatalogWork:0,
      publicCanary:false,
      githubTokenRemoved:true,
      usedOperatorTokenRevoked:($revokedStatus == "401"),
      revokedStatus:$revokedStatus
    }' > "$ARTIFACT_DIR/cleanup-summary.json"
}

case "${1:-}" in
  proof)
    proof
    ;;
  cleanup)
    cleanup
    ;;
  *)
    echo "usage: $0 <proof|cleanup>" >&2
    exit 2
    ;;
esac
