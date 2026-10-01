#!/usr/bin/env bash
# tests/unit-for.sh — golden tests for scripts/metrics/unit-for
#
# Run from anywhere:
#   skills/building-dashboards/tests/unit-for.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$SCRIPT_DIR/scripts/metrics/unit-for"

if [[ ! -x "$SCRIPT" ]]; then
    echo "FAIL: $SCRIPT is not executable" >&2
    exit 2
fi

PASS=0
FAIL=0

# Compare two JSON blobs as sorted objects so key order doesn't matter.
check() {
    local label="$1" input="$2" expected="$3"
    local actual
    if actual=$("$SCRIPT" "$input" 2>&1); then
        :
    else
        echo "FAIL [$label]: '$input' -> script errored: $actual"
        FAIL=$((FAIL+1))
        return
    fi
    local actual_sorted expected_sorted
    actual_sorted=$(echo "$actual" | jq -S .)
    expected_sorted=$(echo "$expected" | jq -S .)
    if [[ "$actual_sorted" == "$expected_sorted" ]]; then
        PASS=$((PASS+1))
    else
        echo "FAIL [$label]: '$input'"
        echo "  expected: $expected_sorted"
        echo "  actual:   $actual_sorted"
        FAIL=$((FAIL+1))
    fi
}

# Time units
check "time:s"            "s"             '{"unit":"TimeSec"}'
check "time:seconds"      "seconds"       '{"unit":"TimeSec"}'
check "time:ms"           "ms"            '{"unit":"TimeMS"}'
check "time:us"           "us"            '{"unit":"TimeUS"}'
check "time:ns"           "ns"            '{"unit":"TimeNS"}'
check "time:min"          "min"           '{"unit":"TimeMin"}'
check "time:h"            "h"             '{"unit":"TimeHour"}'
check "time:hour"         "hour"          '{"unit":"TimeHour"}'
check "time:d"            "d"             '{"unit":"TimeDay"}'

# Bytes
check "bytes:By"          "By"            '{"unit":"Byte"}'
check "bytes:bytes"       "bytes"         '{"unit":"Byte"}'
check "bytes:KBy"         "KBy"           '{"unit":"Kilobyte"}'
check "bytes:MBy"         "MBy"           '{"unit":"Megabyte"}'
check "bytes:GBy"         "GBy"           '{"unit":"Gigabyte"}'
check "bytes:KiBy"        "KiBy"          '{"unit":"Kilobyte"}'

# Rates
check "rate:By/s"         "By/s"          '{"unit":"BytesSec"}'
check "rate:bit/s"        "bit/s"         '{"unit":"BitsSec"}'

# Percent
# Special case: "%" emits BOTH `unit` and `customUnits` because Percent100
# alone scales the value but does not paint the suffix. See unit-for header
# and reference/chart-config.md § Unit Configuration.
check "percent"           "%"             '{"unit":"Percent100","customUnits":"%"}'

# Currency (a representative subset)
check "currency:EUR"      "EUR"           '{"unit":"CurrencyEUR"}'
check "currency:USD"      "USD"           '{"unit":"CurrencyUSD"}'
check "currency:JPY"      "JPY"           '{"unit":"CurrencyJPY"}'

# Custom (unmapped) — these are real units observed in the homeassistant-metrics
# dataset on the axiom deployment, so the tests double as regression coverage
# for the fallback path against real-world inputs.
check "custom:Cel"        "Cel"           '{"unit":"Auto","customUnits":"Cel"}'
check "custom:kW.h"       "kW.h"          '{"unit":"Auto","customUnits":"kW.h"}'
check "custom:[ppm]"      "[ppm]"         '{"unit":"Auto","customUnits":"[ppm]"}'
check "custom:m3/h"       "m3/h"          '{"unit":"Auto","customUnits":"m3/h"}'
check "custom:lx"         "lx"            '{"unit":"Auto","customUnits":"lx"}'
check "custom:ug/m3"      "ug/m3"         '{"unit":"Auto","customUnits":"ug/m3"}'
check "custom:A"          "A"             '{"unit":"Auto","customUnits":"A"}'
check "custom:V"          "V"             '{"unit":"Auto","customUnits":"V"}'

# Ambiguous — by design, NOT auto-mapped. These properties are documented in
# unit-for's header and in reference/metrics-mpl.md; a regression here means
# we have unintentionally introduced a footgun.
check "ambiguous:m"       "m"             '{"unit":"Auto","customUnits":"m"}'
check "ambiguous:B"       "B"             '{"unit":"Auto","customUnits":"B"}'

# Special sentinels
check "sentinel:1"        "1"             '{"unit":"Auto"}'
check "sentinel:empty"    ""              '{"unit":"Auto"}'

# Missing arg should behave like empty string (bash ${1-})
if MISSING_OUT=$("$SCRIPT" 2>&1); then
    actual_sorted=$(echo "$MISSING_OUT" | jq -S .)
    expected_sorted=$(echo '{"unit":"Auto"}' | jq -S .)
    if [[ "$actual_sorted" == "$expected_sorted" ]]; then
        PASS=$((PASS+1))
    else
        echo "FAIL [missing-arg]: expected $expected_sorted, got $actual_sorted"
        FAIL=$((FAIL+1))
    fi
else
    echo "FAIL [missing-arg]: script errored: $MISSING_OUT"
    FAIL=$((FAIL+1))
fi

echo "---"
echo "Passed: $PASS  Failed: $FAIL"
[[ $FAIL -eq 0 ]] || exit 1
