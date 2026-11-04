#!/bin/sh
# Build the reviewed source and retain it for matching host scanner adapters.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
source_commit=$(cat "$script_dir/clawscan-source-commit.txt")
case "$source_commit" in
  *[!a-f0-9]*|'') echo 'ClawScan requires a full reviewed source commit' >&2; exit 1 ;;
esac
[ "${#source_commit}" -eq 40 ] || { echo "ClawScan source commit must be 40 hex characters" >&2; exit 1; }
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_PATH:?GITHUB_PATH is required}"
: "${GITHUB_ENV:?GITHUB_ENV is required}"
source_dir=$(mktemp -d "$RUNNER_TEMP/clawscan-source.XXXXXX")
git init --quiet "$source_dir"
git -C "$source_dir" remote add origin https://github.com/openclaw/clawscan.git
git -C "$source_dir" fetch --quiet --depth 1 origin "$source_commit"
git -C "$source_dir" checkout --quiet --detach FETCH_HEAD
[ "$(git -C "$source_dir" rev-parse HEAD)" = "$source_commit" ]
export GOTOOLCHAIN=go1.27.3
bin_dir="$RUNNER_TEMP/clawscan-bin"
mkdir -p "$bin_dir"
# A repeated installation must not retain a judge from a different source.
rm -f "$bin_dir/clawscan-decisions-judge"
(cd "$source_dir" && go build -trimpath -o "$bin_dir/clawscan" ./cmd/clawscan)
"$bin_dir/clawscan" --version
go version -m "$bin_dir/clawscan"
# Older reviewed sources have no Decisions judge. When either half is present,
# require and qualify the source's matching stdlib command/tests before exposing
# it. Do not fetch a second judge version or install a provider SDK.
runtime_dir="$source_dir/docker/clawscan-runtime"
judge_source="$runtime_dir/judges/clawscan_decisions_judge.py"
judge_tests="$runtime_dir/tests/test_decisions_judge.py"
if [ -e "$judge_source" ] || [ -L "$judge_source" ] || [ -e "$judge_tests" ] || [ -L "$judge_tests" ]; then
  for file in "$judge_source" "$judge_tests"; do
    [ -f "$file" ] && [ ! -L "$file" ] || {
      echo 'Decisions judge requires matching regular source and qualification tests' >&2; exit 1;
    }
  done
  # -I avoids ambient Python modules; -B preserves the retained source checkout.
  CLAWSCAN_DECISIONS_JUDGE="$judge_source" python3 -I -B "$judge_tests"
  python3 -I -B "$judge_source" --help >/dev/null
  cp "$judge_source" "$bin_dir/clawscan-decisions-judge"
  chmod 0755 "$bin_dir/clawscan-decisions-judge"
fi
printf "ClawScan source: %s\n" "$source_commit"
printf "%s\n" "$bin_dir" >> "$GITHUB_PATH"
printf "CLAWSCAN_SOURCE_DIR=%s\n" "$source_dir" >> "$GITHUB_ENV"
