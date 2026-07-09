#!/usr/bin/env bash
# test-normalize.sh: Test dashboard-normalize.jq layout normalization
#
# Usage: ./test-normalize.sh

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

normalize() {
    jq -L "$SCRIPTS_DIR" 'include "dashboard-normalize"; normalize_dashboard_layout'
}

echo "Layout Normalization"
echo "===================="

# 1. Fills missing fields with defaults
result=$(echo '{"layout":[{"i":"a","x":0,"y":0,"w":6,"h":4}]}' | normalize)
if echo "$result" | jq -e '.layout[0] | .minH == 2 and .minW == 2 and .moved == false and .static == false' > /dev/null 2>&1; then
    ok "fills missing fields with defaults"
else
    fail "fills missing fields with defaults" "got: $result"
fi

# 2. Preserves existing values
result=$(echo '{"layout":[{"i":"a","x":0,"y":0,"w":6,"h":4,"minH":3,"minW":4,"moved":true,"static":true}]}' | normalize)
if echo "$result" | jq -e '.layout[0] | .minH == 3 and .minW == 4 and .moved == true and .static == true' > /dev/null 2>&1; then
    ok "preserves existing values"
else
    fail "preserves existing values" "got: $result"
fi

# 3. minH capped at h when h <= 2
result=$(echo '{"layout":[{"i":"a","x":0,"y":0,"w":6,"h":1}]}' | normalize)
if echo "$result" | jq -e '.layout[0].minH == 1' > /dev/null 2>&1; then
    ok "minH equals h when h <= 2"
else
    fail "minH equals h when h <= 2" "got minH=$(echo "$result" | jq '.layout[0].minH')"
fi

# 4. minH defaults to 2 when h > 2
result=$(echo '{"layout":[{"i":"a","x":0,"y":0,"w":6,"h":8}]}' | normalize)
if echo "$result" | jq -e '.layout[0].minH == 2' > /dev/null 2>&1; then
    ok "minH defaults to 2 when h > 2"
else
    fail "minH defaults to 2 when h > 2" "got minH=$(echo "$result" | jq '.layout[0].minH')"
fi

# 5. Empty layout array
result=$(echo '{"layout":[]}' | normalize)
if echo "$result" | jq -e '.layout == []' > /dev/null 2>&1; then
    ok "empty layout array"
else
    fail "empty layout array" "got: $result"
fi

# 6. No layout key (should pass through unchanged)
result=$(echo '{"name":"test"}' | normalize)
if echo "$result" | jq -e '.name == "test" and .layout == null' > /dev/null 2>&1; then
    ok "no layout key passes through"
else
    fail "no layout key passes through" "got: $result"
fi

# 7. Multiple layout entries
result=$(echo '{"layout":[{"i":"a","x":0,"y":0,"w":6,"h":4},{"i":"b","x":6,"y":0,"w":6,"h":1}]}' | normalize)
if echo "$result" | jq -e '.layout | length == 2 and .[0].minH == 2 and .[1].minH == 1' > /dev/null 2>&1; then
    ok "multiple layout entries"
else
    fail "multiple layout entries" "got: $result"
fi

# 8. Other fields preserved
result=$(echo '{"name":"dash","owner":"me","layout":[{"i":"a","x":0,"y":0,"w":6,"h":4}]}' | normalize)
if echo "$result" | jq -e '.name == "dash" and .owner == "me"' > /dev/null 2>&1; then
    ok "other fields preserved"
else
    fail "other fields preserved" "got: $result"
fi

echo ""
echo "===================="
echo "Passed: $passed | Failed: $failed"

[[ $failed -eq 0 ]]
