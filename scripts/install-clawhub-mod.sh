#!/usr/bin/env bash
set -euo pipefail

repo="${CLAWHUB_MOD_RELEASE_REPO:-openclaw/clawhub}"
tag=""
version=""
tag_prefix="clawhub-mod-v"
npm_args=()

usage() {
  cat >&2 <<'EOF'
usage: bash scripts/install-clawhub-mod.sh [--tag clawhub-mod-v0.1.0 | --version 0.1.0] [--repo owner/repo] [-- npm-install-args...]

Installs or upgrades clawhub-mod from a GitHub Release asset.
Requires gh, node, and npm. Run `gh auth login` with access to the ClawHub repo first.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      tag="${2:-}"
      shift 2
      ;;
    --version)
      version="${2:-}"
      shift 2
      ;;
    --repo)
      repo="${2:-}"
      shift 2
      ;;
    --prefix)
      tag_prefix="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      npm_args=("$@")
      break
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd gh
require_cmd node
require_cmd npm

if [[ -n "$tag" && -n "$version" ]]; then
  echo "Use either --tag or --version, not both." >&2
  exit 2
fi

if [[ -n "$version" ]]; then
  version="${version#v}"
  tag="${tag_prefix}${version}"
fi

if [[ -z "$tag" ]]; then
  releases_json="$(gh api "repos/${repo}/releases?per_page=100")"
  tag="$(RELEASES_JSON="$releases_json" TAG_PREFIX="$tag_prefix" node --input-type=module <<'EOF'
  const releases = JSON.parse(process.env.RELEASES_JSON ?? "[]");
  const prefix = process.env.TAG_PREFIX;
  const release = releases.find((item) => {
    if (!String(item.tag_name ?? "").startsWith(prefix)) return false;
    return Array.isArray(item.assets) && item.assets.some((asset) => String(asset.name ?? "").endsWith(".tgz"));
  });
  if (!release) process.exit(1);
  process.stdout.write(release.tag_name);
EOF
  )" || {
    echo "No ${tag_prefix} release with a .tgz asset found in ${repo}." >&2
    exit 1
  }
fi

tmpdir="$(mktemp -d)"
cleanup() {
  rm -rf "$tmpdir"
}
trap cleanup EXIT

echo "Downloading ${tag} from ${repo}..."
gh release download "$tag" --repo "$repo" --pattern "*.tgz" --dir "$tmpdir" --clobber

tarball_count="$(find "$tmpdir" -type f -name "*.tgz" -print | wc -l | tr -d " ")"
if [[ "$tarball_count" != "1" ]]; then
  echo "Expected exactly one .tgz asset, found ${tarball_count}." >&2
  exit 1
fi
tarball="$(find "$tmpdir" -type f -name "*.tgz" -print | sort | head -n 1)"

echo "Installing ${tarball}..."
npm install -g "${tarball}" "${npm_args[@]}"

echo "Installed:"
clawhub-mod --cli-version
