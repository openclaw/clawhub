---
name: doc-consolidation
description: |
  Merge report and analysis artifacts into permanent docs, then delete source files
version: 1.8.1
triggers:
  - docs
  - consolidation
  - cleanup
  - git-hygiene
  - knowledge-management
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\ud83d\udcdd"}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [When to Use](#when-to-use)
- [Quick Start](#quick-start)
- [Two-Phase Workflow](#two-phase-workflow)
- [Phase 1: Triage (Fast Model)](#phase-1:-triage-(fast-model))
- [Phase 2: Execute (Main Model)](#phase-2:-execute-(main-model))
- [Workflow Details](#workflow-details)
- [Step 1: Candidate Detection](#step-1:-candidate-detection)
- [Step 2: Content Analysis](#step-2:-content-analysis)
- [Step 3: Destination Routing](#step-3:-destination-routing)
- [Step 4: Generate Plan](#step-4:-generate-plan)
- [Source: API_REVIEW_REPORT.md](#source:-api_review_reportmd)
- [Post-Consolidation](#post-consolidation)
- [Step 5: Execute Merges](#step-5:-execute-merges)
- [Fast Model Delegation](#fast-model-delegation)
- [Content Categories](#content-categories)
- [Merge Strategies](#merge-strategies)
- [Intelligent Weave](#intelligent-weave)
- [Replace Section](#replace-section)
- [Append with Context](#append-with-context)
- [Create New File](#create-new-file)
- [Integration](#integration)
- [Example Session](#example-session)
- [Troubleshooting](#troubleshooting)
- [No candidates found](#no-candidates-found)
- [Low-quality extractions](#low-quality-extractions)
- [Merge conflicts](#merge-conflicts)
- [Related Skills](#related-skills)


# Doc Consolidation

Extracts valuable knowledge from ephemeral LLM outputs and merges it into permanent documentation.

## When To Use

Use this skill when:
- You have untracked `*_REPORT.md` or `*_ANALYSIS.md` files from Claude sessions
- Git status shows markdown files that shouldn't be committed but contain useful content
- You want to preserve insights from code reviews, refactoring reports, or API audits
- Preparing a PR and need to clean up working artifacts

Do NOT use when:
- Files are already in proper documentation locations
  (`docs/`, `skills/`)
- Files are intentionally temporary scratch notes
- User explicitly wants to preserve the original report format
- Source files have no extractable value (pure log output)

## Formatting

When merging content into permanent documentation, follow
`Skill(leyline:markdown-formatting)` conventions: wrap prose
at 80 chars (prefer sentence/clause boundaries), blank lines
around headings, ATX headings only, blank line before lists,
and reference-style links for long URLs.

## Quick Start

```
/consolidate-docs
```

Or invoke directly:

```
I have some report files that need consolidating into permanent docs.
```

## Two-Phase Workflow

### Phase 1: Triage (Fast Model)

Read-only analysis to generate a consolidation plan:

1. **Detect candidates** - Find untracked markdown files with LLM output markers
2. **Analyze content** - Extract and categorize valuable sections
3. **Route destinations** - Match content to existing docs or propose new files
4. **Present plan** - Show user what will be consolidated and where

**Checkpoint**: User reviews and approves plan before execution.

### Phase 2: Execute (Main Model)

After approval, performs the consolidation:

1. **Merge content** - Weave into existing docs or create new files
2. **Delete sources** - Remove ephemeral files after successful merge
3. **Generate summary** - Report what was created/updated/deleted

## Workflow Details

### Step 1: Candidate Detection

Load: `@modules/candidate-detection.md`

Identifies files using:
- Git status (untracked `.md` files)
- Location (not in standard doc directories)
- Naming (ALL_CAPS non-standard names)
- Content markers (Executive Summary, Findings, Action Items)

### Step 2: Content Analysis

Load: `@modules/content-analysis.md`

For each candidate:
- Extract sections as content chunks
- Categorize: Actionable Items, Decisions, Findings, Metrics, Migration Guides, API Changes
- Score value: high/medium/low

### Step 3: Destination Routing

Load: `@modules/destination-routing.md`

For each valuable chunk:
- Semantic match against existing documentation
- Apply default mappings if no good match
- Determine merge strategy (weave, replace, append, create)

### Step 4: Generate Plan

Present consolidation plan to user:

```markdown
# Consolidation Plan

## Source: API_REVIEW_REPORT.md

| Content | Category | Value | Destination | Action |
|---------|----------|-------|-------------|--------|
| API inventory | Findings | High | docs/api-overview.md | Create |
| Action items | Actionable | High | docs/plans/2025-12-06-api.md | Create |

### Post-Consolidation
- Delete: API_REVIEW_REPORT.md

Proceed with consolidation? [Y/n]
```

### Step 5: Execute Merges

Load: `@modules/merge-execution.md`

After user approval:
- Group operations by destination file
- Apply merge strategies
- Validate results (frontmatter intact, structure preserved)
- Delete source files
- Generate execution summary

## Fast Model Delegation

Phase 1 tasks are delegated to haiku-class models for efficiency:

```python
# plugins/sanctum/scripts/consolidation_planner.py handles:
- scan_for_candidates()
- extract_content_chunks()
- categorize_chunks()
- score_value()
- find_semantic_matches()
```

Phase 2 stays on the main model for careful merge execution.

## Content Categories

| Category | Description | Default Destination |
|----------|-------------|---------------------|
| Actionable Items | Tasks, TODOs, next steps | `docs/plans/YYYY-MM-DD-{topic}.md` |
| Decisions Made | Architecture choices | `docs/adr/NNNN-{date}-{topic}.md` |
| Findings/Insights | Audit results, analysis | Best-match existing doc |
| Metrics/Baselines | Before/after comparisons | `docs/benchmarks/` |
| Migration Guides | Step-by-step procedures | `docs/migration-guide.md` |
| API Changes | Breaking changes, deprecations | CHANGELOG or api docs |

## Merge Strategies

### Intelligent Weave
Insert content into matching existing sections, preserving style.

  Use when: Destination has relevant section, content is additive.

### Replace Section
Replace existing section with more detailed new content.

  Use when: New content 2x+ more detailed or has later date.

### Append with Context
Add new section with date and source reference.

  Use when: No matching section, content doesn't fit existing structure.

### Create New File
Generate complete new document.

  Use when: No suitable destination exists, content warrants standalone doc.

## Integration

Works with other sanctum skills:

- **git-workspace-review**: May suggest consolidation when untracked reports detected
- **pr-prep**: Warns about untracked analysis files before PR creation
- **doc-updates**: Can invoke for final polish after consolidation

## Example Session

```
User: I have API_REVIEW_REPORT.md from our review session. Can you consolidate it?

Claude: I'll consolidate the report into permanent documentation.

**Phase 1: Triage**

Scanning for candidates...
- Found: API_REVIEW_REPORT.md (untracked, LLM markers detected)

Analyzing content...
- Extracted 6 content chunks
- High value: API inventory, action items, CLI recommendation
- Medium value: security assessment
- Low value: executive summary (generic)

Routing destinations...
- API inventory → docs/api-overview.md (CREATE)
- Action items → docs/plans/2025-12-06-api-consistency.md (CREATE)
- CLI naming → docs/adr/0002-cli-naming.md (CREATE ADR)
- Security → Already covered in docs/security.md (SKIP)

**Consolidation Plan**
[table shown]

Proceed? [Y/n]

User: Y

Claude: **Phase 2: Executing**

Created: docs/api-overview.md (1,247 bytes)
Created: docs/plans/2025-12-06-api-consistency.md (892 bytes)
Created: docs/adr/0002-2025-12-06-cli-naming.md (634 bytes)
Deleted: API_REVIEW_REPORT.md

Consolidation complete. Review the created files and commit when ready.
```

## Troubleshooting

### No candidates found
- Check git status for untracked files
- Files may already be in standard locations
- Try explicit file path: "Consolidate API_REVIEW_REPORT.md"

### Low-quality extractions
- Source file may lack structured sections
- Content may be too generic to categorize
- Try manual extraction for unstructured reports

### Merge conflicts
- Destination file structure changed
- Try APPEND strategy instead of WEAVE
- Manual intervention may be needed

## Related Skills

- `sanctum:doc-updates` - General documentation updates
- `sanctum:git-workspace-review` - Pre-flight workspace analysis
- `sanctum:pr-prep` - Pull request preparation
- `imbue:catchup` - Understanding recent changes
