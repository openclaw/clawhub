#!/usr/bin/env bash
# test-script-output.sh: Ensure deployment scripts keep machine-readable stdout
#
# Usage: ./test-script-output.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$SCRIPT_DIR/../scripts"

passed=0
failed=0

ok() {
    ((passed++)) || true
    echo "  ✓ $1"
}

fail() {
    ((failed++)) || true
    echo "  ✗ $1: $2"
}

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cp "$SCRIPTS_DIR/dashboard-create" "$TMPDIR/"
cp "$SCRIPTS_DIR/dashboard-update" "$TMPDIR/"
cp "$SCRIPTS_DIR/dashboard-chart-patch" "$TMPDIR/"
cp "$SCRIPTS_DIR/dashboard-validate" "$TMPDIR/"
cp "$SCRIPTS_DIR/dashboard-normalize.jq" "$TMPDIR/"

chmod +x "$TMPDIR/dashboard-create" "$TMPDIR/dashboard-update" "$TMPDIR/dashboard-chart-patch" "$TMPDIR/dashboard-validate"

cat > "$TMPDIR/input.json" <<'JSON'
{
  "id": "dashboard-root-id",
  "version": "v1",
  "createdAt": "2026-02-01T10:00:00Z",
  "updatedAt": "2026-02-02T11:00:00Z",
  "createdBy": "alice@example.com",
  "updatedBy": "bob@example.com",
  "schemaVersion": 2,
  "name": "Test Dashboard",
  "description": "Test",
  "owner": "user-123",
  "charts": [
    {
      "id": "error-rate",
      "name": "Error Rate",
      "type": "Statistic",
      "query": { "apl": "['logs'] | summarize c=count()" }
    }
  ],
  "layout": [
    { "i": "error-rate", "x": 0, "y": 0, "w": 3, "h": 2 }
  ]
}
JSON

cat > "$TMPDIR/chart.patch.json" <<'JSON'
{
  "name": "Error Rate (5m)",
  "query": { "apl": "['logs'] | summarize errors=countif(status >= 500)" },
  "config": { "stale": null }
}
JSON

cat > "$TMPDIR/axiom-api" <<'BASH'
#!/usr/bin/env bash
set -euo pipefail
METHOD="${2:-}"
PATH_="${3:-}"
BODY="${4:-}"

case "$METHOD:$PATH_" in
  "POST:/dashboards")
    echo '{"status":"created","dashboard":{"uid":"created-uid","id":"created-id","version":1,"dashboard":{"name":"Test Dashboard"},"createdAt":"2026-02-01T10:00:00Z","updatedAt":"2026-02-01T10:00:00Z","createdBy":"alice@example.com","updatedBy":"alice@example.com"}}'
    ;;
  "PUT:/dashboards/uid/dashboard-root-id")
    echo '{"status":"updated","dashboard":{"uid":"dashboard-root-id","id":"dashboard-root-id","version":2,"dashboard":{"name":"Test Dashboard","updated":true},"createdAt":"2026-02-01T10:00:00Z","updatedAt":"2026-02-02T11:00:00Z","createdBy":"alice@example.com","updatedBy":"bob@example.com"}}'
    ;;
  "PATCH:/dashboards/uid/dashboard-root-id/charts/error-rate")
    echo "$BODY" | jq -e '
      .chart.name == "Error Rate (5m)" and
      .chart.query.apl == "['\''logs'\''] | summarize errors=countif(status >= 500)" and
      (.chart.config | has("stale")) and
      .chart.config.stale == null and
      .version == 7 and
      .message == "Tune error chart" and
      (.overwrite | not)
    ' > /dev/null
    echo '{"status":"updated","dashboard":{"uid":"dashboard-root-id","id":"dashboard-root-id","version":8,"dashboard":{"name":"Test Dashboard","chartPatched":true},"createdAt":"2026-02-01T10:00:00Z","updatedAt":"2026-02-02T12:00:00Z","createdBy":"alice@example.com","updatedBy":"bob@example.com"}}'
    ;;
  *)
    echo "Unexpected call: $METHOD $PATH_" >&2
    exit 1
    ;;
esac
BASH

chmod +x "$TMPDIR/axiom-api"

echo "Script Stdout Contract"
echo "======================"

create_out=$("$TMPDIR/dashboard-create" prod "$TMPDIR/input.json")
if [[ "$create_out" == "created-uid" ]]; then
    ok "dashboard-create outputs only dashboard UID"
else
    fail "dashboard-create outputs only dashboard UID" "got: $create_out"
fi

update_out=$("$TMPDIR/dashboard-update" prod dashboard-root-id "$TMPDIR/input.json")
if echo "$update_out" | jq -e '.dashboard.uid == "dashboard-root-id" and .dashboard.dashboard.updated == true' > /dev/null 2>&1; then
    ok "dashboard-update outputs valid JSON only"
else
    fail "dashboard-update outputs valid JSON only" "got: $update_out"
fi

patch_out=$("$TMPDIR/dashboard-chart-patch" prod dashboard-root-id error-rate "$TMPDIR/chart.patch.json" --version 7 --message "Tune error chart")
if echo "$patch_out" | jq -e '.dashboard.uid == "dashboard-root-id" and .dashboard.dashboard.chartPatched == true' > /dev/null 2>&1; then
    ok "dashboard-chart-patch outputs valid JSON only"
else
    fail "dashboard-chart-patch outputs valid JSON only" "got: $patch_out"
fi

apl_fmt=$("$SCRIPTS_DIR/chart-add" --type Statistic --id t --name T \
    --apl "['logs'] | where a=='x' | summarize c=count()" | jq -r '.query.apl')
if [[ "$(printf '%s' "$apl_fmt" | grep -c '^| ')" == "2" && "$apl_fmt" != *" | "* ]]; then
    ok "chart-add breaks each pipeline stage onto its own line"
else
    fail "chart-add breaks each pipeline stage onto its own line" "got: $apl_fmt"
fi

apl_str=$("$SCRIPTS_DIR/chart-add" --type Statistic --id t --name T \
    --apl "['logs'] | where msg=='a | b'" | jq -r '.query.apl')
if [[ "$apl_str" == *"msg=='a | b'"* ]]; then
    ok "chart-add leaves a pipe inside a string literal untouched"
else
    fail "chart-add leaves a pipe inside a string literal untouched" "got: $apl_str"
fi

# Constructs whose string boundaries the split cannot follow must round-trip
# byte-for-byte rather than risk a newline landing inside a literal.
check_verbatim() {
    local label="$1" input="$2" got
    got=$("$SCRIPTS_DIR/chart-add" --type Statistic --id t --name T --apl "$input" | jq -r '.query.apl')
    if [[ "$got" == "$input" ]]; then
        ok "chart-add stores $label untouched"
    else
        fail "chart-add stores $label untouched" "got: $got"
    fi
}

check_verbatim "a backslash-escaped quote" '["logs"] | where msg == "a \" b | c" | project msg'
check_verbatim "an @-verbatim literal" '["logs"] | where p == @"c:\x | y" | project p'
check_verbatim "a // comment" '["logs"] // note | here
| count'

echo ""
echo "======================"
echo "Passed: $passed | Failed: $failed"

[[ $failed -eq 0 ]]
