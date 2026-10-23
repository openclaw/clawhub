#!/bin/sh
# Install the exact scanner sources and Responses adapters tested with ClawScan.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
: "${CLAWSCAN_SOURCE_DIR:?Run install-clawscan.sh first}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_PATH:?GITHUB_PATH is required}"
expected_commit=$(cat "$script_dir/clawscan-source-commit.txt")
[ "$(git -C "$CLAWSCAN_SOURCE_DIR" rev-parse HEAD)" = "$expected_commit" ] || { echo "ClawScan source revision mismatch" >&2; exit 1; }
runtime_dir="$CLAWSCAN_SOURCE_DIR/docker/clawscan-runtime"
case "${1:-}" in
  skillspector)
    pin_name=SKILLSPECTOR_REF
    repository=https://github.com/NVIDIA/skillspector.git
    ;;
  aig)
    pin_name=AIG_SKILL_SCAN_REF
    repository=https://github.com/Tencent/AI-Infra-Guard.git
    ;;
  *) echo "Usage: install-clawscan-scanners.sh skillspector|aig" >&2; exit 1 ;;
esac
scanner=$1
source_commit=$(sed -n "s/^ARG $pin_name=//p" "$runtime_dir/Dockerfile")
case "$source_commit" in
  *[!a-f0-9]*|'') echo 'Scanner requires a full reviewed source commit' >&2; exit 1 ;;
esac
[ "${#source_commit}" -eq 40 ] || { echo "Scanner source commit must be 40 hex characters" >&2; exit 1; }
source_dir=$(mktemp -d "$RUNNER_TEMP/$scanner-source.XXXXXX")
git init --quiet "$source_dir"
git -C "$source_dir" remote add origin "$repository"
git -C "$source_dir" fetch --quiet --depth 1 origin "$source_commit"
git -C "$source_dir" checkout --quiet --detach FETCH_HEAD
[ "$(git -C "$source_dir" rev-parse HEAD)" = "$source_commit" ]
git -C "$source_dir" apply --check "$runtime_dir/patches/$scanner-responses.patch"
git -C "$source_dir" apply "$runtime_dir/patches/$scanner-responses.patch"
# Pin the existing maintained resolver; SkillSpector ships an upstream uv.lock.
python -m pip install "uv==0.13.5"
if [ "$scanner" = skillspector ]; then
  uv sync --locked --no-dev --project "$source_dir"
  venv="$source_dir/.venv"
else
  venv="$RUNNER_TEMP/aig-venv"
  python -m venv "$venv"
  # Retain the reviewed hash-locked runtime dependencies, replacing only AIG.
  uv pip install --python "$venv/bin/python" --require-hashes -r "$script_dir/aig-worker-requirements.txt"
  uv pip install --python "$venv/bin/python" --no-deps "$source_dir/skill-scan"
fi
uv pip install --python "$venv/bin/python" "pytest==9.0.2"
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 "$venv/bin/python" -m pytest -q "$runtime_dir/tests/test_${scanner}_responses.py"
uv pip check --python "$venv/bin/python"
if [ "$scanner" = aig ]; then command_name=aig-skill-scan; else command_name=skillspector; fi
"$venv/bin/$command_name" --help >/dev/null
printf "%s source: %s (adapters from %s)\n" "$scanner" "$source_commit" "$expected_commit"
# Expose only scanner entrypoints: a venv bin directory shadows setup-python
# in the next workflow step, and unseeded uv environments have no pip.
bin_dir="$RUNNER_TEMP/clawscan-scanner-bin"
mkdir -p "$bin_dir"
ln -s "$venv/bin/$command_name" "$bin_dir/$command_name"
printf "%s\n" "$bin_dir" >> "$GITHUB_PATH"
