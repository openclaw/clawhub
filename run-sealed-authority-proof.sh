#!/usr/bin/env bash
set -euo pipefail

readonly repo="openclaw/openclaw"
readonly storage_id="kg278qenzw5xn1rw8aqafy8w3d8fsr52"

seed_case() {
  local case_name="$1"
  local package_name="$2"
  local parent_run_id="$3"
  local artifact_json artifact_name artifact_id artifact_digest receipt_dir input
  artifact_json="$(gh api "repos/${repo}/actions/runs/${parent_run_id}/artifacts?per_page=100" --jq '[.artifacts[] | select(.name|startswith("openclaw-clawhub-parent-authorization-v2-"))][0]')"
  artifact_name="$(jq -r '.name' <<<"$artifact_json")"
  artifact_id="$(jq -r '.id | tostring' <<<"$artifact_json")"
  artifact_digest="$(jq -r '.digest' <<<"$artifact_json")"
  receipt_dir="$(mktemp -d "/private/tmp/${case_name}-receipt.XXXXXX")"
  gh run download "$parent_run_id" --repo "$repo" --name "$artifact_name" --dir "$receipt_dir"
  input="$(jq -n \
    --arg caseName "$case_name" \
    --arg packageName "$package_name" \
    --arg artifactId "$artifact_id" \
    --arg artifactDigest "$artifact_digest" \
    --arg fileStorageId "$storage_id" \
    --arg archiveStorageId "$storage_id" \
    --slurpfile receipt "$receipt_dir/authorization.json" \
    '{caseName:$caseName,packageName:$packageName,artifactId:$artifactId,artifactDigest:$artifactDigest,fileStorageId:$fileStorageId,archiveStorageId:$archiveStorageId,identity:{repository:$receipt[0].childRepository,workflow:$receipt[0].childWorkflow,runId:$receipt[0].childRunId,runAttempt:$receipt[0].childRunAttempt,ref:$receipt[0].childRef,fullRef:$receipt[0].childFullRef,sha:$receipt[0].childHeadSha,candidateRepository:$receipt[0].candidateRepository,candidateSha:$receipt[0].candidateSha,toolingRef:$receipt[0].toolingRef,toolingFullRef:$receipt[0].toolingFullRef,toolingSha:$receipt[0].toolingSha,parentRepository:$receipt[0].repository,parentWorkflow:$receipt[0].workflow,parentRunId:$receipt[0].runId,parentRunAttempt:$receipt[0].runAttempt}}')"
  bunx convex run sealedAuthorityProof:seed "$input"
  trash "$receipt_dir"
}

run_status() {
  local seed_json="$1"
  bunx convex run sealedAuthorityProof:status "$(jq -nc \
    --arg releaseId "$(jq -r '.releaseId' <<<"$seed_json")" \
    --arg attemptId "$(jq -r '.attemptId' <<<"$seed_json")" \
    '{releaseId:$releaseId,attemptId:$attemptId}')"
}

finalize_case() {
  local case_name="$1"
  local package_name="$2"
  local parent_run_id="$3"
  local expected_error="$4"
  local mutation="${5:-}"
  local seed_json mutation_input finalize_input output exit_code status_json
  seed_json="$(seed_case "$case_name" "$package_name" "$parent_run_id")"
  if [[ "$mutation" == "revoke" ]]; then
    mutation_input="$(jq -nc --arg tokenId "$(jq -r '.tokenId' <<<"$seed_json")" '{tokenId:$tokenId}')"
    bunx convex run sealedAuthorityProof:revoke "$mutation_input" >/dev/null
  elif [[ "$mutation" == "reassign" ]]; then
    mutation_input="$(jq -nc --arg trustedPublisherId "$(jq -r '.trustedPublisherId' <<<"$seed_json")" '{trustedPublisherId:$trustedPublisherId}')"
    bunx convex run sealedAuthorityProof:reassign "$mutation_input" >/dev/null
  fi
  finalize_input="$(jq -nc --arg attemptId "$(jq -r '.attemptId' <<<"$seed_json")" '{attemptId:$attemptId}')"
  set +e
  output="$(bunx convex run sealedAuthorityProof:finalize "$finalize_input" 2>&1)"
  exit_code=$?
  set -e
  status_json="$(run_status "$seed_json")"
  if [[ -z "$expected_error" ]]; then
    [[ $exit_code -eq 0 ]]
    [[ "$(jq -r '.publicationStatus' <<<"$status_json")" == "published" ]]
    [[ "$(jq -r '.attemptStatus' <<<"$status_json")" == "finalized" ]]
    echo "case=${case_name} result=allowed publication=published attempt=finalized"
    return
  fi
  [[ $exit_code -ne 0 ]]
  [[ "$output" == *"$expected_error"* ]]
  [[ "$(jq -r '.publicationStatus' <<<"$status_json")" == "pending" ]]
  echo "case=${case_name} result=rejected publication=pending reason=${expected_error}"
}

finalize_case allowed @openclaw/sealed-live-allowed 37412370306 ""
finalize_case cancelled @openclaw/sealed-live-cancelled 37412508427 "is not authorized by automated-sealed"
finalize_case nonbot @openclaw/sealed-live-nonbot 37412612685 "is missing or ambiguous"
finalize_case revoked @openclaw/sealed-live-revoked 37412370306 "Staged OpenClaw publish authorization no longer matches the release" revoke
finalize_case reassigned @openclaw/sealed-live-reassigned 37412370306 "Trusted publish authorization no longer matches the current trusted publisher" reassign
finalize_case mismatch @openclaw/sealed-live-mismatch 37412370306 "does not contain one exact package transaction"
