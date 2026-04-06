---
name: update-readme
description: |
  Refresh README structure and content using repo context from git-workspace-review
version: 1.8.1
triggers:
  - readme
  - documentation
  - exemplars
  - research
  - structure
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.sanctum:shared", "night-market.sanctum:git-workspace-review", "night-market.imbue:proof-of-work", "night-market.scribe:slop-detector", "night-market.scribe:doc-generator"]}}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# README Update Workflow

## When To Use
Use this skill whenever the README requires a structural refresh.
Run `Skill(sanctum:git-workspace-review)` first to capture repo context and diffs.

## When NOT To Use

- Updating inline docs: use doc-updates
- Consolidating ephemeral reports: use doc-consolidation

## Required TodoWrite Items
1. `update-readme:language-audit`
2. `update-readme:exemplar-research`
3. `update-readme:outline-aligned`
4. `update-readme:edits-applied`
5. `update-readme:slop-scanned` - AI marker detection via scribe
6. `update-readme:verification-reporting`

## Step 1 - Language Audit (`update-readme:language-audit`)
- Confirm `pwd`, `git status -sb`, and the baseline branch for reference.
- Detect dominant languages using repository heuristics (manifest files, file counts).
- Note secondary languages that influence documentation (e.g., a TypeScript frontend and a Rust backend) so the README can surface both.
- Record the method and findings.

See `modules/language-audit.md` for detailed detection patterns and commands.

## Step 2 - Exemplar Research (`update-readme:exemplar-research`)
- For each primary and secondary language, use web search to locate high-quality READMEs (star count, recency, maintainer activity).
- Capture 2-3 exemplar repositories per language and summarize why each is relevant (section order, visuals, quickstart clarity, governance messaging, math exposition, etc.).
- Store citations for every exemplar so the final summary references them explicitly.

See `modules/exemplar-research.md` for search query patterns and evaluation criteria.

## Step 3 - Outline Alignment (`update-readme:outline-aligned`)
- Compare current README headings (`rg -n '^#' README.md`) against patterns observed in exemplars.
- Draft a target outline covering: value proposition, installation, quickstart, deeper usage/configuration, architecture/feature highlights, performance or math guarantees, documentation links, contribution/governance, roadmap/status, and licensing/security notes.
- validate internal documents (docs/, specs/, wiki, commands/) are mapped to the relevant sections so the README anchors them with context-sensitive links.

## Step 4 - Apply Edits (`update-readme:edits-applied`)
- Implement the new structure directly in `README.md`
  (or the specified file).
- Follow `Skill(leyline:markdown-formatting)` conventions:
  wrap prose at 80 chars (prefer sentence/clause boundaries),
  blank lines around headings, ATX headings only, blank line
  before lists, reference-style links for long URLs.
- Maintain concise, evidence-based prose; avoid marketing fluff.
- Add comparison tables, feature lists, or diagrams only if
  they originate from current repository assets (no speculative
  content).
- When referencing algorithms or performance claims, point to
  benchmarks or tests within the repository or documented math
  reviews.

## Step 4.5 - AI Slop Detection (`update-readme:slop-scanned`)

Run `Skill(scribe:slop-detector)` on the updated README to detect AI-generated content markers.

### Scribe Integration

The scribe plugin provides AI slop detection:

```
Skill(scribe:slop-detector) --target README.md
```

This detects:
- **Tier 1 words**: delve, tapestry, comprehensive, leveraging, etc.
- **Phrase patterns**: "In today's fast-paced world", "cannot be overstated"
- **Structural markers**: Excessive em dashes, bullet overuse, sentence uniformity
- **Marketing language**: "enterprise-ready", "cutting-edge", "seamless"

### Remediation

If slop score exceeds 2.0 (moderate), apply `Skill(scribe:doc-generator)` principles:

1. Ground every claim with specifics
2. Remove formulaic openers/closers
3. Use numbers, commands, filenames over adjectives
4. Balance bullets with narrative prose
5. Show authorial perspective (trade-offs, reasoning)

For significant cleanup needs, use:

```
Agent(scribe:doc-editor) --target README.md
```

## Step 5 - Verification & Reporting (`update-readme:verification-reporting`)
- Re-read the updated README for clarity, accessibility (section lengths, bullet balance), and accurate links.
- Run `git diff README.md` (or the edited file) and capture snippets for the final report.
- Summarize detected languages, exemplar sources (with citations), key structural decisions, and follow-up TODOs (e.g., add badges, upload diagrams).

## Exit Criteria
- All `TodoWrite` items are complete.
- The README reflects a modern, language-aware structure, referencing both internal docs and external inspiration with citations.
- Research notes and command references are captured so future reviewers can reproduce the process.
## Troubleshooting

### Common Issues

**Documentation out of sync**
Run `make docs-update` to regenerate from code

**Build failures**
Check that all required dependencies are installed

**Links broken**
Verify relative paths in documentation files
