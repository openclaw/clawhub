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

const pkg = JSON.parse(readFileSync("./packages/clawhub/package.json", "utf8"));
process.stdout.write(String(pkg.version ?? "").trim());
EOF
)"

if [[ -z "${package_version}" ]]; then
  echo "Unable to resolve packages/clawhub/package.json version." >&2
  exit 1
fi

if [[ ! "${package_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "clawhub CLI npm publish only supports stable X.Y.Z versions; found ${package_version}." >&2
  exit 1
fi

echo "Resolved package version: ${package_version}"
echo "Resolved npm dist-tag: latest"
echo "Publish auth: GitHub OIDC trusted publishing"
if [[ -n "${publish_target}" ]]; then
  echo "Resolved publish target: ${publish_target}"
  npm publish "${publish_target}" --access public --tag latest --provenance
  exit 0
fi

(
  cd packages/clawhub
  npm publish --access public --tag latest --provenance
)
