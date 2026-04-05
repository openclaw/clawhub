---
module: ci-integration
category: automation
dependencies: [Bash]
estimated_tokens: 500
---

# CI Integration

Use the `--ci` flag to produce machine-readable output and exit with a non-zero code when
slop density exceeds a threshold. Intended for use in GitHub Actions and pre-commit hooks.

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--ci` | off | Emit JSON output instead of the markdown report |
| `--threshold <float>` | `3.0` | Score above which the run fails (exit code 1) |

## JSON Output Schema

When `--ci` is set, write a single JSON object to stdout:

```json
{
  "files": [
    {
      "path": "docs/guide.md",
      "score": 2.4,
      "rating": "Light",
      "markers": 7
    }
  ],
  "summary": {
    "total_files": 1,
    "avg_score": 2.4,
    "max_score": 2.4,
    "pass": true
  }
}
```

### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `files[].path` | str | Path to the scanned file (relative to repo root) |
| `files[].score` | float | Slop density score (0–10+) |
| `files[].rating` | str | One of: Clean, Light, Moderate, Heavy |
| `files[].markers` | int | Total marker count in the file |
| `summary.total_files` | int | Number of files scanned |
| `summary.avg_score` | float | Mean score across all files |
| `summary.max_score` | float | Highest score across all files |
| `summary.pass` | bool | True when max_score <= threshold |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All files pass (max_score <= threshold) |
| 1 | One or more files exceed the threshold |
| 2 | Execution error (file not found, parse failure, etc.) |

## Instructions for Claude

When `--ci` appears in the invocation:

1. Run the full detection workflow as normal.
2. Collect per-file results: path, score, rating, marker count.
3. Compute summary fields: total_files, avg_score (round to 2 decimal places), max_score.
4. Set `pass` to `true` when `max_score <= threshold`, `false` otherwise.
5. Write the JSON object to stdout. Do not write the markdown report.
6. Report exit code 1 if `pass` is false, 0 if true, 2 on any error.

Do not mix prose with the JSON output. The JSON must be the only content on stdout so
it can be parsed by downstream tools.

## GitHub Actions Example

```yaml
- name: Slop check
  run: |
    result=$(claude -p "Skill(scribe:slop-detector) --ci --threshold 3.0 docs/")
    echo "$result" | jq .
    pass=$(echo "$result" | jq -r '.summary.pass')
    if [ "$pass" != "true" ]; then
      echo "Slop threshold exceeded" >&2
      exit 1
    fi
```

## Pre-commit Hook Example

```yaml
# .pre-commit-config.yaml
- repo: local
  hooks:
    - id: slop-check
      name: Slop density check
      language: system
      entry: bash -c 'claude -p "Skill(scribe:slop-detector) --ci --threshold 3.0" "$@"'
      types: [markdown]
      pass_filenames: true
```
