#!/bin/sh
set -eu
# ClawScan mounts the submitted artifact read-only. All writes stay in the container.
if [ ! -d "$1" ]; then set -- "$(dirname "$1")"; fi
if [ ! -f "$1/package.json" ]; then
  echo "Endor requires package.json at the target root" >&2
  exit 1
fi
if [ -n "$(find "$1" -name .npmrc -print -quit)" ]; then
  echo "Endor cannot safely scan targets containing .npmrc" >&2
  exit 1
fi
export NPM_CONFIG_IGNORE_SCRIPTS=true
export YARN_IGNORE_PATH=1
export YARN_IGNORE_SCRIPTS=true
resolver_bin=$(mktemp -d)
resolver_path=$PATH
if ! env_executable=$(command -v env); then
	echo "Endor runtime is missing env" >&2
	exit 1
fi
if ! npm_executable=$(command -v npm); then
	echo "Endor runtime is missing npm" >&2
	exit 1
fi
if ! yarn_executable=$(command -v yarn); then
	echo "Endor runtime is missing Yarn Classic" >&2
	exit 1
fi
case "$env_executable:$npm_executable:$yarn_executable" in
	/*:/*:/*) ;;
	*)
		echo "Endor runtime tool paths must be absolute" >&2
		exit 1
		;;
esac
resolver_home="$resolver_bin/home"
mkdir "$resolver_home"
write_resolver_shim() {
	shim_name=$1
	shim_executable=$2
	cat > "$resolver_bin/$shim_name" <<EOF
#!/bin/sh
exec "$env_executable" -i \
	HOME="$resolver_home" \
	PATH="$resolver_path" \
	NPM_CONFIG_IGNORE_SCRIPTS=true \
	YARN_CACHE_FOLDER="$resolver_home/yarn-cache" \
	YARN_IGNORE_PATH=1 \
	YARN_IGNORE_SCRIPTS=true \
	"$shim_executable" "\$@"
EOF
	chmod 755 "$resolver_bin/$shim_name"
}
write_resolver_shim npm "$npm_executable"
write_resolver_shim yarn "$yarn_executable"
export PATH="$resolver_bin:$PATH"
scan_root=$(mktemp -d)
cp -R "$1"/. "$scan_root"/
# Never reuse submitted Git hooks/config or installed dependencies.
find "$scan_root" \( -name .git -o -name node_modules \) -prune -exec rm -rf {} +
export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0=safe.directory
export GIT_CONFIG_VALUE_0="$scan_root"
git -c core.hooksPath=/dev/null -c user.name=ClawScan -c user.email=clawscan@example.invalid -C "$scan_root" init -q -b main
git -C "$scan_root" config core.hooksPath /dev/null
git -C "$scan_root" config user.name ClawScan
git -C "$scan_root" config user.email clawscan@example.invalid
git -c core.hooksPath=/dev/null -c user.name=ClawScan -c user.email=clawscan@example.invalid -C "$scan_root" add --all --force
git -c core.hooksPath=/dev/null -c user.name=ClawScan -c user.email=clawscan@example.invalid -C "$scan_root" commit -q --allow-empty -m "ClawScan scan snapshot"
git -c core.hooksPath=/dev/null -C "$scan_root" remote add origin https://example.invalid/clawscan/scan-target.git
cd "$scan_root"
report=$(mktemp)
diagnostic=$(mktemp)
status=0
endorctl scan --dry-run --dependencies --languages=javascript,typescript --call-graph-languages=javascript,typescript --build=false --output-type=json --path "$scan_root" >"$report" 2>"$diagnostic" || status=$?
# The custom-scanner protocol requires JSON, including for a successful empty scan.
# Endor's 128 means policy findings; analysis failures must still fail the scanner.
node - "$status" "$report" "$diagnostic" <<'JS'
const fs = require("node:fs");
const [status, reportPath, diagnosticPath] = process.argv.slice(2);
const diagnostic = fs.readFileSync(diagnosticPath, "utf8");
process.stderr.write(diagnostic);
function fail(message) {
  console.error(message);
  process.exit(1);
}
if (status !== "0" && status !== "128") fail(`Endor exited ${status}`);
if (diagnostic.includes("ERROR ") || /\b[1-9][0-9]* (scan failure|call graph error)\(s\)/.test(diagnostic)) {
  fail("Endor reported one or more analysis errors");
}
let raw = fs.readFileSync(reportPath, "utf8");
if (raw === "" && status === "0") {
  raw = '{"all_findings":[],"blocking_findings":[],"warning_findings":[]}';
}
let report;
try { report = JSON.parse(raw); } catch { fail("Endor returned invalid findings JSON"); }
for (const name of ["all_findings", "blocking_findings", "warning_findings"]) {
  if (!Array.isArray(report?.[name]) || report[name].some(value => value === null || typeof value !== "object" || Array.isArray(value))) {
    fail("Endor returned invalid findings JSON");
  }
}
process.stdout.write(raw);
JS
