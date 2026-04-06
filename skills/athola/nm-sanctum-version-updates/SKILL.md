---
name: version-updates
description: |
  Bump versions, update changelogs, and coordinate version changes across files for releases
version: 1.8.1
triggers:
  - version
  - release
  - changelog
  - semver
  - bump
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.sanctum:shared", "night-market.sanctum:git-workspace-review"]}}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Version Update Workflow

## When To Use
Use this skill when preparing a release or bumping the project version.
Run `Skill(sanctum:git-workspace-review)` first to capture current changes.

## When NOT To Use

- Just documentation updates - use doc-updates
- Full PR preparation - use pr-prep

## Required TodoWrite Items
1. `version-update:context-collected`
2. `version-update:target-files`
3. `version-update:version-set`
4. `version-update:docs-updated`
5. `version-update:verification`

## Step 1: Collect Context (`context-collected`)
- Confirm which version to apply (default: bump patch).
- If the prompt provides an explicit version, note it.
- validate `Skill(sanctum:git-workspace-review)` has already captured the repository status.

## Step 2: Identify Targets (`target-files`)
- Find ALL configuration files that store versions using recursive search:
  - Root level: `Cargo.toml`, `package.json`, `pyproject.toml`
  - **Nested directories**: Use glob to find `*/pyproject.toml`, `*/Cargo.toml`, `*/package.json`
  - **Example**: `plugins/memory-palace/hooks/pyproject.toml` must be included
  - Exclude virtual environments (`.venv`, `node_modules`, `target/`) using grep -v
- Include changelog and README references that mention the version.
- Use: `find plugins -name "pyproject.toml" -o -name "Cargo.toml" | grep -v ".venv"`

## Step 3: Update Versions (`version-set`)
- **Automated approach**: Use `plugins/sanctum/scripts/update_versions.py <version>` to update all version files
  - Supports pyproject.toml, Cargo.toml, package.json
  - Automatically excludes virtual environments
  - Finds nested version files (e.g., `plugins/memory-palace/hooks/pyproject.toml`)
  - Use `--dry-run` flag first to preview changes
- **Manual approach**: Update each target file with the new version
  - For semantic versions, follow `MAJOR.MINOR.PATCH` or the specified format
  - If the project supports multiple packages, document each update

## Step 4: Update Documentation (`docs-updated`)
- Add or update changelog entries with today's date.
- Refresh README and docs references to mention the new version and any release notes.

### Critical Documentation Files with Version References

These files contain version numbers and MUST be checked during version bumps:

| File | Content |
|------|---------|
| `docs/api-overview.md` | Plugin inventory table with all plugin versions |
| `CHANGELOG.md` | Version history and release notes |
| `book/src/reference/capabilities-reference.md` | May reference version-specific features |
| Plugin READMEs | May mention plugin versions |

### Scan for Additional Version References

```bash
# Find all docs mentioning the OLD version
grep -r "1\.2\.6" docs/ book/ --include="*.md" | grep -v node_modules

# Common patterns to search:
# - "v1.2.6", "1.2.6", "(v1.2.6)"
# - Version tables in markdown
# - "Added in X.Y.Z" annotations
```

### Update Sequence
1. Update config files (pyproject.toml, plugin.json, etc.) - automated
2. Update `CHANGELOG.md` - add new version section
3. Update `docs/api-overview.md` - update version table and plugin details
4. Scan for other version references and update as needed

## Step 5: Verification (`verification`)
- Run relevant builds or tests if version bumps require them (e.g., `cargo test`, `npm test`).
- Show `git status -sb` and `git diff` excerpts to confirm the version bumps.

## Output Instructions
- Summarize the files changed and the new version number.
- Mention follow-up steps, such as publishing or tagging, if applicable.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
