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
bin_dir="$RUNNER_TEMP/clawscan-scanner-bin"
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
needs_bash_parser=0
if [ "$scanner" = skillspector ]; then
  if [ -e "$source_dir/src/skillspector/shell_source.py" ]; then
    test -f "$source_dir/src/skillspector/shell_source.py"
    test ! -L "$source_dir/src/skillspector/shell_source.py"
    needs_bash_parser=1
    test -f "$runtime_dir/tests/test_skillspector_shell_source.py"
    shfmt_version=$(sed -n 's/^ARG SHFMT_VERSION=//p' "$runtime_dir/Dockerfile")
    case "$shfmt_version" in
      *[!v0-9.]*|'') echo 'Bash parser requires one reviewed version' >&2; exit 1 ;;
    esac
    printf '%s\n' "$shfmt_version" | LC_ALL=C grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || {
      echo 'Invalid reviewed Bash parser version' >&2; exit 1;
    }
    mkdir -p "$bin_dir"
    GOTOOLCHAIN=go1.27.3 CGO_ENABLED=0 GOBIN="$bin_dir" go install "mvdan.cc/sh/v3/cmd/shfmt@$shfmt_version"
    [ "$("$bin_dir/shfmt" --version)" = "$shfmt_version" ] || {
      echo 'Installed Bash parser version mismatch' >&2; exit 1;
    }
    # Adapter checks and the scanner must resolve the same source-pinned helper.
    PATH="$bin_dir:$PATH"
    export PATH
  elif grep -Eq '^ARG SHFMT_VERSION(=|$)' "$runtime_dir/Dockerfile"; then
    echo 'Bash parser pin has no matching scanner module' >&2; exit 1
  fi
  python_executable=$(python -c 'import sys; print(sys.executable)')
  uv sync --locked --no-dev --python "$python_executable" --project "$source_dir"
  venv="$source_dir/.venv"
  # The upstream lock predates the deferred-serializer repair. Replace only the
  # reviewed Pydantic/core pair and required typing dependencies; keep the rest.
  uv pip install --python "$venv/bin/python" --no-deps --require-hashes -r "$script_dir/skillspector-pydantic-requirements.txt"
else
  venv="$RUNNER_TEMP/aig-venv"
  python -m venv "$venv"
  # Retain the reviewed hash-locked runtime dependencies, replacing only AIG.
  uv pip install --python "$venv/bin/python" --require-hashes -r "$script_dir/aig-worker-requirements.txt"
  uv pip install --python "$venv/bin/python" --no-deps "$source_dir/skill-scan"
fi
uv pip install --python "$venv/bin/python" "pytest==9.0.2"
if [ "$scanner" = skillspector ]; then
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 "$venv/bin/python" -m pytest -q "$script_dir/test_skillspector_serialization.py"
fi
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 "$venv/bin/python" -m pytest -q "$runtime_dir/tests/test_${scanner}_responses.py"
if [ "$needs_bash_parser" = 1 ]; then
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 "$venv/bin/python" -m pytest -q "$runtime_dir/tests/test_skillspector_shell_source.py"
fi
# Historical incident pins predate these controls. Current source includes both;
# verify them in the installed scanner environment before exposing its entrypoint.
if [ "$scanner" = skillspector ] && [ -f "$runtime_dir/tests/test_skillspector_destructive_quoted_operand_boundaries.py" ]; then
  test -f "$runtime_dir/tests/test_skillspector_fragment_quote_ownership.py"
  PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 "$venv/bin/python" -m pytest -q "$runtime_dir/tests/test_skillspector_destructive_quoted_operand_boundaries.py" "$runtime_dir/tests/test_skillspector_fragment_quote_ownership.py"
fi
uv pip check --python "$venv/bin/python"
if [ "$scanner" = aig ]; then command_name=aig-skill-scan; else command_name=skillspector; fi
"$venv/bin/$command_name" --help >/dev/null
printf "%s source: %s (adapters from %s)\n" "$scanner" "$source_commit" "$expected_commit"
# Expose only scanner entrypoints: a venv bin directory shadows setup-python
# in the next workflow step, and unseeded uv environments have no pip.
mkdir -p "$bin_dir"
ln -s "$venv/bin/$command_name" "$bin_dir/$command_name"
printf "%s\n" "$bin_dir" >> "$GITHUB_PATH"
