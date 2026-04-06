---
name: doc-updates
description: |
  Update documentation after code changes with quality gates, slop detection, consolidation, and accuracy verification
version: 1.8.1
triggers:
  - documentation
  - readme
  - adr
  - docstrings
  - writing
  - consolidation
  - debloat
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.sanctum:shared", "night-market.sanctum:git-workspace-review", "night-market.imbue:proof-of-work", "night-market.scribe:slop-detector", "night-market.scribe:doc-generator"]}}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [When to Use](#when-to-use)
- [Required TodoWrite Items](#required-todowrite-items)
- [Step 1: Collect Context](#step-1-collect-context-context-collected)
- [Step 2: Identify Targets](#step-2-identify-targets-targets-identified)
- [Step 2.5: Check for Consolidation](#step-25-check-for-consolidation-consolidation-checked)
- [Step 3: Apply Edits](#step-3-apply-edits-edits-applied)
- [Step 4: Enforce Guidelines](#step-4-enforce-guidelines-guidelines-verified)
- [Step 4.25: AI Slop Detection](#step-425-ai-slop-detection-slop-scanned)
- [Step 4.75: Sync Capabilities Documentation](#step-475-sync-capabilities-documentation-capabilities-synced)
- [Step 5: Verify Accuracy](#step-5-verify-accuracy-accuracy-verified)
- [Step 6: Preview Changes](#step-6-preview-changes-preview)
- [Exit Criteria](#exit-criteria)
- [Flags](#flags)


# Documentation Update Workflow

## When To Use

Use this skill when code changes require updates to the README, plans, wikis, or docstrings. Run `Skill(sanctum:git-workspace-review)` first to capture the change context.

### System Capabilities

The documentation update workflow includes several specialized functions. It identifies redundancy through consolidation detection and enforces directory-specific style rules, with strict limits for `docs/` and more lenient ones for the `book/` directory. The system also verifies the accuracy of version numbers and component counts and integrates with the LSP for semantic documentation verification in supported versions of Claude Code.

## When NOT To Use

- README-specific updates - use update-readme instead
- Complex multi-file consolidation - use doc-consolidation

## Required TodoWrite Items

1. `doc-updates:context-collected` - Git context + CHANGELOG review
2. `doc-updates:targets-identified`
3. `doc-updates:consolidation-checked` (skippable)
4. `doc-updates:edits-applied`
5. `doc-updates:guidelines-verified`
6. `doc-updates:slop-scanned` - AI marker detection via scribe
7. `doc-updates:plugins-synced` - plugin.json ↔ disk audit
8. `doc-updates:capabilities-synced` - plugin.json ↔ documentation sync
9. `doc-updates:accuracy-verified`
10. `doc-updates:preview`

## Step 1: Collect Context (`context-collected`)

- Validate `Skill(sanctum:git-workspace-review)` has been run.
- Use its notes to understand the delta.
- Identify the features or bug fixes that need documentation updates.

**CHANGELOG Reference** (critical for version sync):
```bash
# Check recent CHANGELOG entries for undocumented features
head -100 CHANGELOG.md

# Compare documented version vs plugin versions
grep -E "^\[.*\]" CHANGELOG.md | head -3
for p in plugins/*/.claude-plugin/plugin.json; do
    jq -r '"\(.name): \(.version)"' "$p"
done | head -5
```

Cross-reference CHANGELOG entries against:
- `book/src/reference/capabilities-reference.md` - All skills/commands/agents
- Plugin documentation in `book/src/plugins/` - Per-plugin docs
- Plugin READMEs - Quick reference docs

## Step 2: Identify Targets (`targets-identified`)

- List the relevant files from the scope across all documentation locations:
  - `docs/` - Reference documentation (strict style)
  - `book/` - Technical book content (lenient style)
  - `README.md` files at project and plugin roots
  - `wiki/` entries if present
  - Docstrings in code files
- Prioritize user-facing documentation first, then supporting plans and specifications.
- When architectural work is planned, confirm whether an Architecture Decision Record (ADR) already exists in `wiki/architecture/` (or wherever ADRs are located).
- Add missing ADRs to the target list before any implementation begins.

## Step 2.5: Check for Consolidation (`consolidation-checked`)

Load: `@modules/consolidation-integration.md`

**Purpose**: Detect redundancy and bloat before making edits.

**Scan for:**
- Untracked reports (ALL_CAPS *_REPORT.md, *_ANALYSIS.md files)
- Bloated committed docs (files exceeding 500 lines in docs/, 1000 in book/)
- Stale files (outdated content that should be deleted)

**User approval required before:**
- Merging content from one file to another
- Deleting stale or redundant files
- Splitting bloated files

**Skip options:**
- Use `--skip-consolidation` flag to bypass this phase
- Select specific items instead of processing all

**Exit criteria**: User has approved/skipped all consolidation opportunities.

## Step 3: Apply Edits (`edits-applied`)

- Update each file with grounded language: explain what changed and why.
- Reference specific commands, filenames, or configuration options where possible.
- For docstrings, use the imperative mood and keep them concise.
- For ADRs, see `modules/adr-patterns.md` for complete template structure, status flow, immutability rules, and best practices.

## Step 4: Enforce Guidelines (`guidelines-verified`)

Load: `@modules/directory-style-rules.md`

### Style Enforcement

Maintain consistent documentation by applying directory-specific rules. The system checks for and removes filler phrases such as "in order to" or "it should be noted" and ensures that no emojis are present in the body text of technical documents. Use grounded language with specific references rather than vague claims, and maintain an imperative mood for instructions. For lists of three or more items, prefer bullets over prose to improve scannability.

The audit will issue warnings for paragraphs that exceed length limits or files that surpass the established line count thresholds. We also flag marketing language and abstract adjectives like "capable" or "smooth" to maintain a technical and direct tone across all project documentation.

## Step 4.25: AI Slop Detection (`slop-scanned`)

Run `Skill(scribe:slop-detector)` on edited documentation to detect AI-generated content markers.

### Scribe Integration

The scribe plugin provides comprehensive AI slop detection:

```
Skill(scribe:slop-detector) --target [edited-files]
```

This detects:
- **Tier 1 words**: delve, tapestry, comprehensive, leveraging, etc.
- **Phrase patterns**: "In today's fast-paced world", "cannot be overstated"
- **Structural markers**: Excessive em dashes, bullet overuse, sentence uniformity
- **Sycophantic phrases**: "I'd be happy to", "Great question!"

### Writing Style Guidelines

For enhanced writing quality, check for `elements-of-style:writing-clearly-and-concisely`:

```
# If superpowers/elements-of-style is installed:
Skill(elements-of-style:writing-clearly-and-concisely)

# Fallback if not installed - use scribe:doc-generator principles:
Skill(scribe:doc-generator) --remediate
```

The fallback provides equivalent guidance:
1. Ground every claim with specifics
2. Trim rhetorical crutches (no formulaic openers/closers)
3. Use numbers, commands, filenames over adjectives
4. Balance bullets with narrative prose
5. Show authorial perspective (trade-offs, reasoning)

### Remediation

If slop score exceeds 2.5 (moderate), run:

```
Agent(scribe:doc-editor) --target [file]
```

This provides interactive section-by-section cleanup with user approval.

### Skip Options

- Use `--skip-slop` flag to bypass slop detection
- Slop warnings are non-blocking by default

## Step 4.5: Sync Plugin Registrations (`plugins-synced`)

**Audit plugin.json files against disk** (prevents registration drift):

```bash
# Quick discrepancy check for all plugins
for plugin in plugins/*/; do
  name=$(basename "$plugin")
  pjson="$plugin/.claude-plugin/plugin.json"
  [ -f "$pjson" ] || continue

  # Count commands
  json_cmds=$(jq -r '.commands | length' "$pjson" 2>/dev/null || echo 0)
  disk_cmds=$(ls "$plugin/commands/"*.md 2>/dev/null | wc -l)

  # Count skills (directories only)
  json_skills=$(jq -r '.skills | length' "$pjson" 2>/dev/null || echo 0)
  disk_skills=$(ls -d "$plugin/skills"/*/ 2>/dev/null | wc -l)

  # Report mismatches
  if [ "$json_cmds" != "$disk_cmds" ] || [ "$json_skills" != "$disk_skills" ]; then
    echo "$name: commands=$json_cmds/$disk_cmds skills=$json_skills/$disk_skills"
  fi
done
```

**If mismatches found**: Run `/update-plugins --fix` or manually update plugin.json files.

**Why this matters**: Unregistered commands/skills won't appear in Claude Code's slash command menu or be discoverable.

## Step 4.75: Sync Capabilities Documentation (`capabilities-synced`)

Load: `@modules/capabilities-sync.md`

**Purpose**: Ensure plugin.json registrations are reflected in reference documentation.

**Sync Targets**:
| Source | Documentation Target |
|--------|---------------------|
| `plugin.json.skills[]` | `book/src/reference/capabilities-reference.md` |
| `plugin.json.commands[]` | `book/src/reference/capabilities-reference.md` |
| `plugin.json.agents[]` | `book/src/reference/capabilities-reference.md` |
| `hooks/hooks.json` | `book/src/reference/capabilities-reference.md` |
| Plugin existence | `book/src/plugins/{plugin}.md` |

**Quick Check**:
```bash
# Compare registered vs documented skills
for pjson in plugins/*/.claude-plugin/plugin.json; do
  plugin=$(basename $(dirname $(dirname "$pjson")))
  jq -r --arg p "$plugin" '.skills[]? | sub("^\\./skills/"; "") | "\($p):\(.)"' "$pjson" 2>/dev/null
done | sort > /tmp/registered-skills.txt

grep -E "^\| \`[a-z-]+\` \|" book/src/reference/capabilities-reference.md | \
  head -120 | awk -F'|' '{print $2":"$3}' | sort > /tmp/documented-skills.txt

# Show missing
comm -23 /tmp/registered-skills.txt /tmp/documented-skills.txt
```

**If discrepancies found**:
1. **Missing from docs**: Add entries to capabilities-reference.md tables
2. **Missing plugin pages**: Create `book/src/plugins/{plugin}.md`
3. **Missing from SUMMARY**: Add plugin to `book/src/SUMMARY.md`

**Auto-generate entry format**:
```markdown
| `{skill-name}` | [{plugin}](../plugins/{plugin}.md) | {description} |
```

**Skip options**: Use `--skip-capabilities` to bypass this phase.

## Step 5: Verify Accuracy (`accuracy-verified`)

Load: `@modules/accuracy-scanning.md`

**Validate claims against codebase:**

```bash
# Quick version check
for p in plugins/*/.claude-plugin/plugin.json; do
    jq -r '"\(.name): \(.version)"' "$p"
done

# Quick counts
echo "Plugins: $(ls -d plugins/*/.claude-plugin/plugin.json | wc -l)"
echo "Skills: $(find plugins/*/skills -name 'SKILL.md' | wc -l)"
```
**Verification:** Run the command with `--help` flag to verify availability.

**Flag mismatches:**
- Version numbers that don't match plugin.json
- Plugin/skill/command counts that don't match actual directories
- File paths that don't exist

**LSP-Enhanced Verification (2.0.74+)**:

When `ENABLE_LSP_TOOL=1` is set, enhance accuracy verification with semantic analysis:

1. **API Documentation Coverage**:
   - Query LSP for all public functions/classes
   - Check which lack documentation
   - Verify all exported items are documented

2. **Signature Verification**:
   - Compare documented function signatures with actual code
   - Detect parameter mismatches
   - Flag return type discrepancies

3. **Reference Finding**:
   - Use LSP to find all usages of documented items
   - Include real usage examples in documentation
   - Verify cross-references are accurate

4. **Code Structure Validation**:
   - Check documented file paths exist (via LSP definitions)
   - Verify module organization matches documentation
   - Detect renamed/moved items

**Efficiency**: LSP queries (50ms) vs. manual file tracing (minutes) - dramatically faster verification.

**Default Strategy**: Documentation updates should **prefer LSP** for all verification tasks. Enable `ENABLE_LSP_TOOL=1` permanently for best results.

**Non-blocking**: Warnings are informational; user decides whether to fix.

## Step 6: Preview Changes (`preview`)

- Show diffs for each edited file (`git diff <file>` or `rg` snippets).
- Include accuracy warnings if any were flagged.
- Summarize:
  - Files created/modified/deleted
  - Consolidation actions taken
  - Style violations fixed
  - Remaining TODOs or follow-ups

## Exit Criteria

- All `TodoWrite` items are completed and documentation is updated.
- New ADRs, if any, are in `wiki/architecture/` (or the established ADR directory) with the correct status and links to related work.
- Directory-specific style rules are satisfied.
- Accuracy warnings addressed or acknowledged.
- Content does not sound AI-generated.
- Files are staged or ready for review.

## Flags

| Flag | Effect |
|------|--------|
| `--skip-consolidation` | Skip Phase 2.5 consolidation check |
| `--skip-slop` | Skip Phase 4.25 AI slop detection |
| `--strict` | Treat all warnings as errors |
| `--book-style` | Apply book/ rules to all files |
## Troubleshooting

### Common Issues

**Documentation out of sync**
Run `make docs-update` to regenerate from code

**Build failures**
Check that all required dependencies are installed

**Links broken**
Verify relative paths in documentation files
