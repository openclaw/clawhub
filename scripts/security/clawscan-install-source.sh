# Shared installer-only qualification binding. Sourced after script_dir is set.
# Host producer: merged openclaw/clawscan#155; ordinary profiles unchanged.
# Scanner-tools tree/image retained from runtime run 42292655384, not rebuilt
# for a host-only profile change. Verify both exact trees before installation.
qualified_source_commit=56bf1d9e3bd5247a0622acef8699dc69a10f2938
qualified_source_tree=92d8daba5c181560b4a73e71557b8d54e67e62b9
qualified_runtime_tree=ddfec1285eaf19beb3043e9e5ad043a0d274cb53
qualified_runtime_image=ghcr.io/openclaw/clawscan-runtime@sha256:d494938b84a9f0da40504f611eec472d4637c755b5cef87b123daf8a2014545c

select_clawscan_source() {
  default_commit=$(cat "$script_dir/clawscan-source-commit.txt")
  selected_commit=$default_commit
  # An explicit argument may select only the default or this qualified candidate.
  # In particular, an empty explicit argument is not a request for the default.
  if [ "$#" -ne 0 ]; then selected_commit=$1; fi
  case "$selected_commit" in
    *[!a-f0-9]*|'') echo 'ClawScan requires a full reviewed source commit' >&2; exit 1 ;;
  esac
  [ "${#selected_commit}" -eq 40 ] || { echo 'ClawScan source commit must be 40 hex characters' >&2; exit 1; }
  [ "$selected_commit" = "$default_commit" ] || [ "$selected_commit" = "$qualified_source_commit" ] || {
    echo 'ClawScan install source is not an approved candidate' >&2; exit 1;
  }
}

verify_clawscan_source() {
  [ "$(git -C "$1" rev-parse HEAD)" = "$selected_commit" ] || {
    echo 'ClawScan source revision mismatch' >&2; exit 1;
  }
  if [ "$selected_commit" = "$qualified_source_commit" ]; then
    source_status=$(git -C "$1" status --porcelain=v1 --untracked-files=all --ignored) || {
      echo 'Cannot verify qualified ClawScan source cleanliness' >&2; exit 1;
    }
    [ "$(git -C "$1" rev-parse 'HEAD^{tree}')" = "$qualified_source_tree" ] &&
    [ "$(git -C "$1" rev-parse HEAD:docker/clawscan-runtime)" = "$qualified_runtime_tree" ] &&
    [ -z "$source_status" ] || {
      echo 'Qualified ClawScan source must match its clean source and runtime trees' >&2; exit 1;
    }
  fi
}
