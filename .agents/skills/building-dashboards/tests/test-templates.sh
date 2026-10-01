#!/usr/bin/env bash
# test-templates.sh: Validate dashboard templates
#
# Checks only high-value things:
#   - Valid JSON
#   - Chart IDs match layout IDs (catches real bugs)
#   - Scripts are executable
#
# Usage: ./test-templates.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/../reference/templates"
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

echo "Template Validation"
echo "==================="

# Check jq is available
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required" >&2
    exit 1
fi

echo ""
echo "[Templates]"

for template in "$TEMPLATES_DIR"/*.json; do
    name=$(basename "$template")
    
    # Valid JSON?
    if ! jq empty "$template" 2>/dev/null; then
        fail "$name" "invalid JSON"
        continue
    fi
    
    # Chart IDs match layout IDs?
    chart_ids=$(jq -r '.charts[].id // empty' "$template" 2>/dev/null | sort)
    layout_ids=$(jq -r '.layout[].i // empty' "$template" 2>/dev/null | sort)
    
    if [[ "$chart_ids" == "$layout_ids" ]]; then
        ok "$name"
    else
        fail "$name" "chart/layout ID mismatch"
    fi
done

echo ""
echo "[Scripts]"

for script in "$SCRIPTS_DIR"/*; do
    name=$(basename "$script")
    
    if [[ -x "$script" ]]; then
        ok "$name"
    else
        fail "$name" "not executable"
    fi
done

echo ""
echo "==================="
echo "Passed: $passed | Failed: $failed"

[[ $failed -eq 0 ]]
