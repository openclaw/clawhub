# Accuracy Scanning Module

Validate documentation claims against actual codebase state. Runs as Phase 5.5 before preview to catch stale version numbers, outdated counts, and broken references.

## Scan Types

### 1. Version Number Validation

Compares version references in documentation against `plugin.json` files.

**Patterns to detect:**
- `v1.2.3`, `version: 1.2.3`
- `Plugin Name (v1.2.3)`, `Plugin Name v1.2.3`
- Table cells with version numbers

**Validation:**
```bash
# Extract actual versions
for plugin in plugins/*/.claude-plugin/plugin.json; do
    jq -r '.name + " " + .version' "$plugin"
done

# Sample output:
# abstract 1.0.5
# sanctum 1.0.6
# scry 1.1.0
```

**Warning format:**
```markdown
| File | Claimed | Actual | Action |
|------|---------|--------|--------|
| docs/api-overview.md | abstract v2.1.0 | 1.0.5 | Update version |
| README.md | sanctum v3.0.0 | 1.0.6 | Update version |
```

### 2. Plugin Count Validation

Verifies claims like "13 plugins" against actual directory count.

**Patterns to detect:**
- "N plugins", "contains N plugins"
- Table rows claiming to list all plugins

**Validation:**
```bash
# Count plugin directories with valid plugin.json
ls -d plugins/*/.claude-plugin/plugin.json 2>/dev/null | wc -l
```

### 3. Skill/Command Count Validation

Verifies per-plugin statistics.

**Patterns to detect:**
- "X skills", "Y commands", "Z agents"
- API inventory tables

**Validation:**
```bash
# Count skills for a plugin
ls -d plugins/sanctum/skills/*/SKILL.md 2>/dev/null | wc -l

# Count commands
ls plugins/sanctum/commands/*.md 2>/dev/null | wc -l

# Count agents
ls plugins/sanctum/agents/*.md 2>/dev/null | wc -l
```

### 4. File/Path Reference Validation

Verifies that referenced paths exist.

**Patterns to detect:**
- Backtick paths: `` `plugins/sanctum/skills/doc-updates/SKILL.md` ``
- Relative paths in links: `[link](./modules/foo.md)`
- Configuration examples with paths

**Validation:**
```bash
# Check if path exists
test -e "$path" && echo "EXISTS" || echo "MISSING"
```

## Scan Algorithm

```python
def scan_for_accuracy(file_path: str, content: str) -> list[AccuracyWarning]:
    warnings = []

    # Load current plugin versions
    actual_versions = load_plugin_versions()

    # Find version references
    version_pattern = r'(\w+)[\s\(]v?(\d+\.\d+\.\d+)'
    for match in re.finditer(version_pattern, content):
        plugin_name = match.group(1).lower()
        claimed_version = match.group(2)

        if plugin_name in actual_versions:
            actual = actual_versions[plugin_name]
            if claimed_version != actual:
                warnings.append({
                    'type': 'version_mismatch',
                    'plugin': plugin_name,
                    'claimed': claimed_version,
                    'actual': actual,
                    'line': get_line_number(content, match.start())
                })

    # Find count claims
    count_pattern = r'(\d+)\s+(plugins?|skills?|commands?|agents?)'
    for match in re.finditer(count_pattern, content, re.IGNORECASE):
        claimed_count = int(match.group(1))
        item_type = match.group(2).lower().rstrip('s')
        actual_count = count_items(item_type)

        if abs(claimed_count - actual_count) > 0:
            warnings.append({
                'type': 'count_mismatch',
                'item_type': item_type,
                'claimed': claimed_count,
                'actual': actual_count,
                'line': get_line_number(content, match.start())
            })

    return warnings
```

## Quick Validation Commands

For manual verification during doc updates:

```bash
# All plugin versions
for p in plugins/*/.claude-plugin/plugin.json; do
    jq -r '"\(.name): \(.version)"' "$p"
done | sort

# Total counts
echo "Plugins: $(ls -d plugins/*/.claude-plugin/plugin.json | wc -l)"
echo "Skills: $(find plugins/*/skills -name 'SKILL.md' | wc -l)"
echo "Commands: $(find plugins/*/commands -name '*.md' | wc -l)"
echo "Agents: $(find plugins/*/agents -name '*.md' | wc -l)"
```

## Output Format

### Phase 5.5: Verify Accuracy

```markdown
## Accuracy Scan Results

Scanned: docs/api-overview.md, README.md (2 files)
Time: 0.3 seconds

### Warnings Found

| Type | File | Line | Issue | Fix |
|------|------|------|-------|-----|
| version | docs/api-overview.md | 15 | abstract v2.1.0 → 1.0.5 | Update |
| version | docs/api-overview.md | 18 | sanctum v3.0.0 → 1.0.6 | Update |
| count | README.md | 42 | "11 plugins" → 13 | Update |

### No Issues
- All file paths valid
- Command references exist

**Action**: Review warnings before proceeding to preview.
```

## Integration Notes

- Non-blocking: Warnings don't prevent workflow completion
- Selective: Only scans files being edited (from Phase 2 targets)
- Fast: Bash commands complete in <1 second per file
- Progressive: Loads only when Phase 5 edits are complete

## Cross-Reference: /update-version

When version bumps are performed via `/update-version`, the automated script updates config files but NOT documentation. The `/update-version` command includes Phase 2 to update documentation files. If you're running `/update-docs` after a version bump, pay special attention to `docs/api-overview.md` which contains the plugin version inventory.

## Edge Cases

### Approximate counts
Some docs use "~10 skills" or "about 50 commands". These should be validated but with wider tolerance (±20%).

### Unreleased versions
If a plugin shows "0.0.0" or "dev", skip version validation for that plugin.

### External references
Paths outside the repository (URLs, system paths) are not validated.
