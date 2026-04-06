# Branch Tier Checks

The branch tier runs quick quality gates on affected and
related plugins. Designed for fast feedback during
development.

## Checks for Affected Plugins

Run these sequentially for each affected plugin:

### 1. Plugin Structure Validation

Run the plugin validator to check plugin.json schema,
skill/agent frontmatter, hook event types, and path
references against the official Claude Code spec:

```bash
python3 plugins/abstract/scripts/validate_plugin.py \
  plugins/<plugin>
```

If critical issues found, mark plugin as FAIL.
Warnings are non-blocking at branch tier.

### 2. Registration Audit

**Only available in night-market repo.** Check script exists first:

```bash
# Check if the script exists (night-market only)
if [[ -f "plugins/sanctum/scripts/update_plugin_registrations.py" ]]; then
  python3 plugins/sanctum/scripts/update_plugin_registrations.py \
    <plugin-name> --dry-run
else
  echo "Registration audit skipped - not running in night-market"
fi
```

Report any missing or stale registrations. If skipped, note in the
result table that registration audit is unavailable.

### 3. Test Gate

```bash
cd plugins/<plugin> && make test
```

Capture pass/fail and test count. If tests fail, mark
plugin as FAIL.

### 4. Lint Gate

```bash
cd plugins/<plugin> && make lint
```

Capture pass/fail. If lint fails, mark as WARNING (not
blocking at branch tier).

### 5. Typecheck Gate

```bash
cd plugins/<plugin> && make typecheck
```

Capture pass/fail. If typecheck fails, mark as WARNING.

### 6. Diff Analysis

Run `git diff main -- plugins/<plugin>/` to identify:
- New files (commands, skills, hooks, agents)
- Deleted files
- Modified production code vs test-only changes

Flag high-risk patterns:
- Hook changes (security surface)
- `__init__.py` export changes (API surface)
- pyproject.toml dependency changes

## Checks for Related Plugins

Run a lighter subset:

### 1. Registration Audit

Same as affected plugins.

### 2. Test Gate

```bash
cd plugins/<plugin> && make test
```

Tests must pass. This catches side-effect breakage from
dependency changes.

## Result Table

Build a table with columns: plugin, test, lint, type, reg,
verdict. Use `--` for skipped checks on related plugins.

## Verdict Rules

- Any test FAIL on affected or related: overall FAIL
- Any lint/type FAIL on affected: overall PASS-WITH-WARNINGS
- All green: PASS
