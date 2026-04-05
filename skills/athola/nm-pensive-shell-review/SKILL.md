---
name: shell-review
description: Audit shell scripts for correctness, portability, and common pitfalls
version: 1.8.1
triggers:
  - shell
  - bash
  - posix
  - scripting
  - ci
  - hooks
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/pensive", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.pensive:shared", "night-market.imbue:proof-of-work"]}}}
source: claude-night-market
source_plugin: pensive
---

> **Night Market Skill** — ported from [claude-night-market/pensive](https://github.com/athola/claude-night-market/tree/master/plugins/pensive). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [Quick Start](#quick-start)
- [When to Use](#when-to-use)
- [Required TodoWrite Items](#required-todowrite-items)
- [Workflow](#workflow)
- [Output Format](#output-format)

# Shell Script Review

Audit shell scripts for correctness, safety, and portability.

## Verification

After review, run `shellcheck <script>` to verify fixes address identified issues.

## Testing

Run `pytest plugins/pensive/tests/skills/test_shell_review.py -v` to validate review patterns.

## Quick Start

```bash
/shell-review path/to/script.sh
```

## When To Use

- CI/CD pipeline scripts
- Git hook scripts
- Wrapper scripts (run-*.sh)
- Build automation scripts
- Pre-commit hook implementations

## When NOT To Use

- Non-shell scripts (Python, JS, etc.)
- One-liner commands that don't need review

## Required TodoWrite Items

1. `shell-review:context-mapped`
2. `shell-review:exit-codes-checked`
3. `shell-review:portability-checked`
4. `shell-review:safety-patterns-verified`
5. `shell-review:evidence-logged`

## Workflow

### Step 1: Map Context (`shell-review:context-mapped`)

Identify shell scripts:
```bash
# Find shell scripts
find . -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" \
  -name "*.sh" -type f | head -20
# Check shebangs
rg -l "^#!/" scripts/ hooks/ 2>/dev/null | head -10
# fallback: grep -l "^#!/" scripts/ hooks/ 2>/dev/null | head -10
```

Document:
- Script purpose and trigger context
- Integration points (make, pre-commit, CI)
- Expected inputs and outputs

### Step 2: Exit Code Audit (`shell-review:exit-codes-checked`)

@include modules/exit-codes.md

### Step 3: Portability Check (`shell-review:portability-checked`)

@include modules/portability.md

### Step 4: Safety Patterns (`shell-review:safety-patterns-verified`)

@include modules/safety-patterns.md

### Step 5: Evidence Log (`shell-review:evidence-logged`)

Use `imbue:proof-of-work` to record findings with file:line references.

Summarize:
- Critical issues (failures masked, security risks)
- Major issues (portability, maintainability)
- Minor issues (style, documentation)

## Output Format

```markdown
## Summary
Shell script review findings

## Scripts Reviewed
- [list with line counts]

## Exit Code Issues
### [E1] Pipeline masks failure
- Location: script.sh:42
- Pattern: `cmd | grep` loses exit code
- Fix: Use pipefail or capture separately

## Portability Issues
[cross-platform concerns]

## Safety Issues
[unquoted variables, missing set flags]

## Recommendation
Approve / Approve with actions / Block
```

## Exit Criteria

- Exit code propagation verified
- Portability issues documented
- Safety patterns checked
- Evidence logged
