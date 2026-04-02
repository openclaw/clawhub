#!/usr/bin/env bash

set -euo pipefail

mode="${1:-}"
publish_target="${2:-}"

if [[ "${mode}" != "--publish" ]]; then
  echo "usage: bash scripts/clawhub-cli-npm-publish.sh --publish [package.tgz]" >&2
  exit 2
fi

if [[ -n "${publish_target}" && -f "${publish_target}" ]]; then
  case "${publish_target}" in
    /*|./*|../*) ;;
    *) publish_target="./${publish_target}" ;;
  esac
fi

package_version="$(
  node --input-type=module <<'EOF'
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("./packages/clawdhub/package.json", "utf8"));
process.stdout.write(String(pkg.version ?? "").trim());
EOF
)"

if [[ -z "${package_version}" ]]; then
  echo "Unable to resolve packages/clawdhub/package.json version." >&2
  exit 1
fi

publish_tag="latest"
if [[ "${package_version}" == *-* ]]; then
  publish_tag="beta"
fi

echo "Resolved package version: ${package_version}"
echo "Resolved npm dist-tag: ${publish_tag}"
echo "Publish auth: GitHub OIDC trusted publishing"
if [[ -n "${publish_target}" ]]; then
  echo "Resolved publish target: ${publish_target}"
  npm publish "${publish_target}" --access public --tag "${publish_tag}" --provenance
  exit 0
fi

(
  cd packages/clawdhub
  npm publish --access public --tag "${publish_tag}" --provenance
)
