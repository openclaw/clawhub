#!/bin/sh
set -eu

scan_script=$1
work=$(mktemp -d)
mkdir -p "$work/bin" "$work/source"
printf '%s\n' '{"name":"endor-fixture","private":true}' > "$work/source/package.json"
printf '%s\n' '# Endor fixture' > "$work/source/SKILL.md"

cat > "$work/bin/endorctl" <<'ENDOR_FIXTURE'
#!/bin/sh
set -eu

test "$ENDOR_NAMESPACE" = synthetic-namespace
test "$ENDOR_TOKEN" = synthetic-endor-token
test "$ENDOR_API_CREDENTIALS_KEY" = synthetic-endor-key
test "$ENDOR_API_CREDENTIALS_SECRET" = synthetic-endor-secret
test "$VIRUSTOTAL_API_KEY" = synthetic-virustotal-key
test "$UNKNOWN_ADDITIONAL_SECRET" = synthetic-unknown-secret

probe=$(mktemp -d)
mkdir -p \
	"$probe/tar/package" \
	"$probe/gitdep" \
	"$probe/git-root" \
	"$probe/malicious-gitdep" \
	"$probe/malicious-git-root" \
	"$probe/npm-root" \
	"$probe/npm-gitdep" \
	"$probe/npm-git-root" \
	"$probe/malicious-npm-root"
printf '%s\n' '{"name":"credential-probe-pkg","version":"1.0.0"}' > "$probe/tar/package/package.json"
tar -C "$probe/tar" -czf "$probe/credential-probe-pkg-1.0.0.tgz" package
python3 /fixture/probe_server.py \
	"$ENDOR_FIXTURE_OUTPUT/events.jsonl" \
	"$ENDOR_FIXTURE_OUTPUT/port" \
	"$probe/credential-probe-pkg-1.0.0.tgz" \
	"synthetic-endor-token" \
	"synthetic-endor-key" \
	"synthetic-endor-secret" \
	"synthetic-virustotal-key" \
	"synthetic-unknown-secret" &
server_pid=$!
cleanup_server() {
	kill "$server_pid" 2>/dev/null || true
	wait "$server_pid" 2>/dev/null || true
}
trap cleanup_server EXIT
while test ! -s "$ENDOR_FIXTURE_OUTPUT/port"; do sleep 0.05; done
port=$(cat "$ENDOR_FIXTURE_OUTPUT/port")

cat > "$probe/gitdep/package.json" <<'PACKAGE_JSON'
{"name":"git-prepare-dep","version":"1.0.0","scripts":{"prepare":"node prepare.js"},"dependencies":{"credential-probe-pkg":"1.0.0"}}
PACKAGE_JSON
cat > "$probe/gitdep/prepare.js" <<'PREPARE_SCRIPT'
const crypto = require('crypto');
const fs = require('fs');
const canaries = [
  process.env.ENDOR_TOKEN,
  process.env.VIRUSTOTAL_API_KEY,
  process.env.UNKNOWN_ADDITIONAL_SECRET,
].filter(Boolean);
fs.writeFileSync('/output/prepare.json', JSON.stringify({
  executed: true,
  synthetic_canary_present: canaries.length > 0,
  synthetic_canary_sha256: canaries.map((value) => crypto.createHash('sha256').update(value).digest('hex')),
}) + '\n');
PREPARE_SCRIPT
cat > "$probe/gitdep/.npmrc" <<NPM_CONFIG
registry=http://127.0.0.1:$port/
NPM_CONFIG
git -C "$probe/gitdep" init -q -b main
git -C "$probe/gitdep" -c user.name=Fixture -c user.email=fixture@example.invalid add --all
git -C "$probe/gitdep" -c user.name=Fixture -c user.email=fixture@example.invalid commit -q -m fixture
commit=$(git -C "$probe/gitdep" rev-parse HEAD)
cat > "$probe/git-root/package.json" <<ROOT_PACKAGE
{"name":"probe-root","private":true,"dependencies":{"git-prepare-dep":"git+file://$probe/gitdep#$commit"}}
ROOT_PACKAGE
(
	cd "$probe/git-root"
	yarn install --registry "http://127.0.0.1:$port/" --ignore-scripts --non-interactive --cache-folder "$probe/yarn-cache"
) > "$ENDOR_FIXTURE_OUTPUT/yarn-benign.stdout" 2> "$ENDOR_FIXTURE_OUTPUT/yarn-benign.stderr"
test ! -e "$ENDOR_FIXTURE_OUTPUT/prepare.json"
test -f "$probe/git-root/node_modules/credential-probe-pkg/package.json"

cat > "$probe/malicious-gitdep/package.json" <<'PACKAGE_JSON'
{"name":"malicious-git-prepare-dep","version":"1.0.0","scripts":{"prepare":"node prepare.js"},"dependencies":{"credential-probe-pkg":"1.0.0"}}
PACKAGE_JSON
cp "$probe/gitdep/prepare.js" "$probe/malicious-gitdep/prepare.js"
cat > "$probe/malicious-gitdep/.npmrc" <<NPM_CONFIG
registry=http://127.0.0.1:$port/
//127.0.0.1:$port/:_authToken=\${VIRUSTOTAL_API_KEY}
NPM_CONFIG
git -C "$probe/malicious-gitdep" init -q -b main
git -C "$probe/malicious-gitdep" -c user.name=Fixture -c user.email=fixture@example.invalid add --all
git -C "$probe/malicious-gitdep" -c user.name=Fixture -c user.email=fixture@example.invalid commit -q -m fixture
malicious_commit=$(git -C "$probe/malicious-gitdep" rev-parse HEAD)
cat > "$probe/malicious-git-root/package.json" <<ROOT_PACKAGE
{"name":"malicious-probe-root","private":true,"dependencies":{"malicious-git-prepare-dep":"git+file://$probe/malicious-gitdep#$malicious_commit"}}
ROOT_PACKAGE
if (
	cd "$probe/malicious-git-root"
	yarn install --registry "http://127.0.0.1:$port/" --ignore-scripts --non-interactive --cache-folder "$probe/malicious-yarn-cache"
) > "$ENDOR_FIXTURE_OUTPUT/yarn-malicious.stdout" 2> "$ENDOR_FIXTURE_OUTPUT/yarn-malicious.stderr"; then
	echo "Yarn accepted a dependency config with a missing credential variable" >&2
	exit 1
fi
test ! -e "$ENDOR_FIXTURE_OUTPUT/prepare.json"

cat > "$probe/npm-root/package.json" <<'NPM_ROOT_PACKAGE'
{"name":"npm-probe-root","private":true,"dependencies":{"credential-probe-pkg":"1.0.0"}}
NPM_ROOT_PACKAGE
(
	cd "$probe/npm-root"
	npm install --registry "http://127.0.0.1:$port/" --ignore-scripts --cache "$probe/npm-cache" --no-audit --no-fund
) > "$ENDOR_FIXTURE_OUTPUT/npm-benign.stdout" 2> "$ENDOR_FIXTURE_OUTPUT/npm-benign.stderr"
test -f "$probe/npm-root/node_modules/credential-probe-pkg/package.json"

cat > "$probe/malicious-npm-root/package.json" <<'NPM_ROOT_PACKAGE'
{"name":"malicious-npm-probe-root","private":true,"dependencies":{"credential-probe-pkg":"1.0.0"}}
NPM_ROOT_PACKAGE
cat > "$probe/malicious-npm-root/.npmrc" <<NPM_ROOT_CONFIG
registry=http://127.0.0.1:$port/
//127.0.0.1:$port/:_authToken=\${UNKNOWN_ADDITIONAL_SECRET}
always-auth=true
NPM_ROOT_CONFIG
(
	cd "$probe/malicious-npm-root"
	npm install --ignore-scripts --cache "$probe/malicious-npm-cache" --no-audit --no-fund
) > "$ENDOR_FIXTURE_OUTPUT/npm-malicious.stdout" 2> "$ENDOR_FIXTURE_OUTPUT/npm-malicious.stderr"
test -f "$probe/malicious-npm-root/node_modules/credential-probe-pkg/package.json"

cat > "$probe/npm-gitdep/package.json" <<'NPM_GIT_PACKAGE'
{"name":"npm-git-prepare-dep","version":"1.0.0","scripts":{"prepare":"node prepare.js"},"dependencies":{"credential-probe-pkg":"1.0.0"}}
NPM_GIT_PACKAGE
cat > "$probe/npm-gitdep/prepare.js" <<'NPM_GIT_PREPARE'
const fs = require('fs');
fs.writeFileSync('/output/npm-git-prepare.json', JSON.stringify({executed: true}) + '\n');
NPM_GIT_PREPARE
cat > "$probe/npm-gitdep/.npmrc" <<NPM_GIT_CONFIG
registry=http://127.0.0.1:$port/
NPM_GIT_CONFIG
git -C "$probe/npm-gitdep" init -q -b main
git -C "$probe/npm-gitdep" -c user.name=Fixture -c user.email=fixture@example.invalid add --all
git -C "$probe/npm-gitdep" -c user.name=Fixture -c user.email=fixture@example.invalid commit -q -m fixture
npm_git_commit=$(git -C "$probe/npm-gitdep" rev-parse HEAD)
cat > "$probe/npm-git-root/package.json" <<NPM_GIT_ROOT_PACKAGE
{"name":"npm-git-probe-root","private":true,"dependencies":{"npm-git-prepare-dep":"git+file://$probe/npm-gitdep#$npm_git_commit"}}
NPM_GIT_ROOT_PACKAGE
(
	cd "$probe/npm-git-root"
	npm install --registry "http://127.0.0.1:$port/" --ignore-scripts --cache "$probe/npm-git-cache" --no-audit --no-fund
) > "$ENDOR_FIXTURE_OUTPUT/npm-git.stdout" 2> "$ENDOR_FIXTURE_OUTPUT/npm-git.stderr"
test -f "$probe/npm-git-root/node_modules/npm-git-prepare-dep/package.json"
test -f "$probe/npm-git-root/node_modules/credential-probe-pkg/package.json"
if test -e "$ENDOR_FIXTURE_OUTPUT/npm-git-prepare.json"; then
	echo "npm Git dependency prepare executed despite ignore-scripts" >&2
	exit 1
fi

python3 - "$ENDOR_FIXTURE_OUTPUT/events.jsonl" <<'VERIFY_EVENTS'
import json
import pathlib
import sys

events = [json.loads(line) for line in pathlib.Path(sys.argv[1]).read_text().splitlines()]
paths = [event["path"] for event in events]
assert paths.count("/credential-probe-pkg") >= 4, events
assert paths.count("/credential-probe-pkg/-/credential-probe-pkg-1.0.0.tgz") >= 4, events
assert not any(event["contains_expected_synthetic_canary"] for event in events), events
VERIFY_EVENTS
printf '%s\n' '{"all_findings":[],"blocking_findings":[],"warning_findings":[]}'
ENDOR_FIXTURE
chmod 755 "$work/bin/endorctl"

export PATH="$work/bin:$PATH"
export ENDOR_NAMESPACE=synthetic-namespace
export ENDOR_TOKEN=synthetic-endor-token
export ENDOR_API_CREDENTIALS_KEY=synthetic-endor-key
export ENDOR_API_CREDENTIALS_SECRET=synthetic-endor-secret
export VIRUSTOTAL_API_KEY=synthetic-virustotal-key
export UNKNOWN_ADDITIONAL_SECRET=synthetic-unknown-secret
mkdir -p "$ENDOR_FIXTURE_OUTPUT"
scan_output=$(/bin/sh "$scan_script" "$work/source")
test "$scan_output" = '{"all_findings":[],"blocking_findings":[],"warning_findings":[]}'
printf '%s\n' fixture-ok
