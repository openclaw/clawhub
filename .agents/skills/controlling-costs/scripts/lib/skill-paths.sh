#!/usr/bin/env bash

# Keep explicit overrides, then prefer bundled siblings over legacy installs.
resolve_skill_script() {
    local skill="$1" script="$2" override="${3:-}"
    local legacy_dir="$HOME/.config/agents/skills"
    if [[ -n "$override" ]]; then
        printf '%s\n' "$override"
        return
    fi

    local skills_dir
    skills_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd -P)" || return
    local names=("$skill")
    if [[ "$skill" == "sre" ]]; then
        names+=("axiom-sre")
    fi

    local root name candidate
    for root in "$skills_dir" "$legacy_dir"; do
        for name in "${names[@]}"; do
            candidate="$root/$name/scripts/$script"
            if [[ -x "$candidate" ]]; then
                printf '%s\n' "$candidate"
                return
            fi
        done
    done

    # Let callers report a missing dependency after parsing arguments/help.
    printf '%s\n' "$skills_dir/$skill/scripts/$script"
}
