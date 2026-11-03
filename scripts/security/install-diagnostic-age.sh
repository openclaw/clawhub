#!/bin/sh
# Canonical age release, checksum-pinned. Never install or invoke age-keygen here.
set -eu
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ]
age_root=$(mktemp -d "$RUNNER_TEMP/clawscan-age.XXXXXX")
trap 'rm -f "$age_root/release.tar.gz"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-amd64.tar.gz \
  --output "$age_root/release.tar.gz"
printf '%s  %s\n' cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10 "$age_root/release.tar.gz" | sha256sum --check --status
tar -xzf "$age_root/release.tar.gz" -C "$age_root" age/age
printf '%s  %s\n' eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c "$age_root/age/age" | sha256sum --check --status
chmod 500 "$age_root/age/age"
[ "$("$age_root/age/age" --version)" = v1.3.2 ]
printf 'age-binary=%s\n' "$age_root/age/age" >> "$GITHUB_OUTPUT"
