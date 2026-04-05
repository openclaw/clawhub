---
module: config-file
category: configuration
dependencies: [Read]
estimated_tokens: 600
---

# Config File Support

Load a `.slop-config.yaml` file to adjust detection behavior for the current project.

## Discovery

Walk up the directory tree from the target file toward the repo root. Stop at the first `.slop-config.yaml` found. If none exists, use built-in defaults.

```
target file: /project/docs/guide.md
check:       /project/docs/.slop-config.yaml
check:       /project/.slop-config.yaml      <- found, use this
check:       /.slop-config.yaml              (would stop here at repo root)
```

To find the repo root, check for a `.git` directory while walking up.

## YAML Schema

```yaml
# .slop-config.yaml

# Extra words treated as tier-1 markers (score: 3 each)
custom_words:
  tier1:
    - synergize
    - ideate
  tier2:
    - impactful
    - learnings

# Words to skip during detection (exact match, case-insensitive)
allowlist:
  - robust      # used correctly in our engineering specs
  - leverage    # used correctly in our physics docs

# Score thresholds (warn < error required)
thresholds:
  warn: 2.0     # flag for review
  error: 5.0    # fail CI check

# Glob patterns for files to skip entirely
exclude_patterns:
  - "vendor/**"
  - "**/*.generated.md"
  - "CHANGELOG.md"

# Inherit from a base config, then apply overrides above
extends: "../../.slop-config.yaml"
```

### Field Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `custom_words.tier1` | list[str] | `[]` | Additional tier-1 words (score 3 each) |
| `custom_words.tier2` | list[str] | `[]` | Additional tier-2 words (score 2 each) |
| `allowlist` | list[str] | `[]` | Words to ignore during detection |
| `thresholds.warn` | float | `2.0` | Score at which to warn |
| `thresholds.error` | float | `5.0` | Score at which to fail |
| `exclude_patterns` | list[str] | `[]` | Glob patterns for files to skip |
| `extends` | str | none | Path to a base config to inherit from |

## Loading Procedure

1. Walk directories from target file up to repo root, collecting any `.slop-config.yaml` files found.
2. If `extends` is set in a config, load that base config first.
3. Merge: base config values are the defaults; the child config overrides them.
4. For list fields (`custom_words.tier1`, `allowlist`, etc.), merge lists rather than replace.
5. Validate that `thresholds.warn < thresholds.error`. If not, warn and use built-in defaults.

## Merging Custom Words with Built-in Patterns

After loading the config:

- Append `custom_words.tier1` to the built-in TIER1 word list before scanning.
- Append `custom_words.tier2` to the built-in TIER2 word list before scanning.
- After each match, check if the matched word appears in the `allowlist`. If so, discard the match.

The allowlist check is case-insensitive and applied per-match, not per-word-list.

## Exclude Pattern Matching

Before scanning a file, check its path against each pattern in `exclude_patterns` using `fnmatch`. If any pattern matches, skip the file and report it as excluded.

```python
import fnmatch

def is_excluded(file_path: str, patterns: list) -> bool:
    for pattern in patterns:
        if fnmatch.fnmatch(file_path, pattern):
            return True
    return False
```

## Reporting

When a config file is active, include it in the report header:

```
Config: /project/.slop-config.yaml
Allowlist: robust, leverage (2 words)
Custom tier-1: synergize, ideate (2 words)
Thresholds: warn=2.0, error=5.0
```
