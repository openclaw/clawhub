---
name: doc-generator
description: Generate or remediate documentation with human-quality writing and style
version: 1.8.1
triggers:
  - documentation
  - writing
  - generation
  - remediation
  - polish
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/scribe", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.scribe:shared", "night-market.scribe:slop-detector"]}}}
source: claude-night-market
source_plugin: scribe
---

> **Night Market Skill** — ported from [claude-night-market/scribe](https://github.com/athola/claude-night-market/tree/master/plugins/scribe). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Documentation Generator

Documentation must be grounded in specific claims rather than abstract adjectives. We avoid filler phrases like "In today's fast-paced world" and focus on delivering useful information directly. Each claim should be supported by evidence, such as specific version numbers or request rates, rather than vague descriptors like "comprehensive."

## Core Writing Principles

We prioritize authorial perspective and active voice to maintain a consistent team tone. This involves explaining the reasoning behind technical choices, such as selecting one database over another, rather than providing neutral boilerplate. Bullets should be used sparingly for actionable summaries; multi-line bullet waterfalls should be converted to short paragraphs to preserve nuance.

### Vocabulary and Style

Avoid business jargon and linguistic tics like mirrored sentence structures or excessive em dashes. We use the imperative mood for docstrings (e.g., "Validate input") and strictly avoid humanizing non-living constructs like code.

| Instead of | Use |
|------------|-----|
| fallback | default, secondary |
| leverage | use |
| utilize | use |
| facilitate | help, enable |
| comprehensive | thorough, complete |

### 9. Limit Humanizing Constructs

"Lives under," "speaks to," and similar phrases only make sense for living things.

### 10. Imperative Mood for Docstrings

"Validate" not "Validates" (per PEP 257, pydocstyle, ruff).

## Required TodoWrite Items

1. `doc-generator:scope-defined` - Target files and type identified
2. `doc-generator:style-loaded` - Style profile applied (if available)
3. `doc-generator:content-drafted` - Initial content created
4. `doc-generator:slop-scanned` - AI markers checked
5. `doc-generator:quality-verified` - Principles checklist passed
6. `doc-generator:user-approved` - Final approval received

## Mode: Generation

For new documentation:

### Step 1: Define Scope

```markdown
## Generation Request

**Type**: [README/Guide/API docs/Tutorial]
**Audience**: [developers/users/admins]
**Length target**: [~X words or sections]
**Style profile**: [profile name or "default"]
```

### Step 2: Load Style (if available)

If a style profile exists:
```bash
cat .scribe/style-profile.yaml
```

Apply voice, vocabulary, and structural guidelines.

### Step 3: Draft Content

Follow the 10 core principles above. For each section:

1. Start with the essential information
2. Add context only if it adds value
3. Use specific examples
4. Prefer prose over bullets
5. End when information is complete (no summary padding)

### Step 4: Run Slop Detector

```
Skill(scribe:slop-detector)
```

Fix any findings before proceeding.

### Step 5: Quality Gate

Verify against checklist:
- [ ] No tier-1 slop words
- [ ] Em dash count < 3 per 1000 words
- [ ] Bullet ratio < 40%
- [ ] All claims grounded with specifics
- [ ] No formulaic openers or closers
- [ ] Authorial perspective present
- [ ] No emojis (unless explicitly requested)

## Mode: Remediation

For cleaning up existing content:

Load: `@modules/remediation-workflow.md`

### Step 1: Analyze Current State

```bash
# Get slop score
Skill(scribe:slop-detector) --target file.md
```

### Step 2: Section-by-Section Approach

For large files (>200 lines), edit incrementally:

```markdown
## Section: [Name] (Lines X-Y)

**Current slop score**: X.X
**Issues found**: [list]

**Proposed changes**:
1. [Change 1]
2. [Change 2]

**Before**:
> [current text]

**After**:
> [proposed text]

Proceed? [Y/n/edit]
```

### Step 3: Preserve Intent

Never change WHAT is said, only HOW. If meaning is unclear, ask.

### Step 4: Re-verify

After edits, re-run slop-detector to confirm improvement.

## Docstring-Specific Rules

When editing code comments:

1. **ONLY modify docstring/comment text**
2. **Never change surrounding code**
3. **Use imperative mood** ("Validate input" not "Validates input")
4. **Brief is better** - remove filler
5. **Keep Args/Returns structure** if present

## Module Reference

- See `modules/generation-guidelines.md` for content creation patterns
- See `modules/quality-gates.md` for validation criteria

## Integration with Other Skills

| Skill | When to Use |
|-------|-------------|
| slop-detector | After drafting, before approval |
| style-learner | Before generation to load profile |
| sanctum:doc-updates | For broader doc maintenance |

## Exit Criteria

- Content created or remediated
- Slop score < 1.5 (clean rating)
- Quality gate checklist passed
- User approval received
- No emojis present (unless specified)
