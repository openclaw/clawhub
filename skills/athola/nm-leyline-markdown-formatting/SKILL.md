---
name: markdown-formatting
description: |
  >- Canonical markdown formatting conventions for diff-friendly documentation. Consult this skill when generating, editing, or reviewing markdown prose. Defines hybrid line wrapping, heading style, list spacing, and link conventions
version: 1.8.1
triggers:
  - markdown
  - formatting
  - documentation
  - line-wrapping
  - style
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/leyline", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: leyline
---

> **Night Market Skill** — ported from [claude-night-market/leyline](https://github.com/athola/claude-night-market/tree/master/plugins/leyline). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Markdown Formatting Conventions

## When To Use

- Writing or editing any markdown documentation
- Reviewing prose for line-wrapping compliance
- Generating markdown from plugins (scribe, sanctum, etc.)

## When NOT To Use

- Editing code blocks, tables, or frontmatter (these have
  their own formatting rules)
- Quick scratch notes that will not be committed

These conventions apply to all markdown documentation generated
or modified by any plugin. The goal: produce prose that creates
clean, reviewable git diffs and reads well on mobile devices.

## Quick Reference

When writing or editing markdown prose:

1. **Wrap prose at 80 chars** using hybrid wrapping (prefer
   sentence/clause boundaries over arbitrary word breaks)
2. **Blank line before and after every heading**
3. **ATX headings only** (`# Heading`, never setext underlines)
4. **Blank line before every list**
5. **Reference-style links** when inline links push lines
   beyond 80 chars

## What to Wrap

Wrap these content types at 80 characters:

- Paragraphs (flowing prose text)
- Blockquote text (the content after `>`)
- List item descriptions (text after `- ` or `1. `)
- Descriptions in definition lists

## What NOT to Wrap

Never wrap or reflow these content types:

- **Tables**: pipe-delimited rows stay on one line
- **Code blocks**: fenced (` ``` `) or indented content
- **Headings**: lines starting with `#`
- **Frontmatter**: YAML/TOML between `---` or `+++`
- **HTML blocks**: raw HTML elements
- **Link definitions**: `[id]: url` reference lines
- **Image references**: `![alt](url)` on their own line
- **Single-line list items**: short bullets that fit on one line

## Wrapping Algorithm (Summary)

For each prose paragraph:

1. If a sentence fits within 80 chars, keep it on one line
2. If a sentence exceeds 80 chars, break at the nearest
   **sentence boundary** (`. ` `! ` `? `) before column 80
3. If no sentence boundary, break at the nearest **clause
   boundary** (`, ` `; ` `: `) before column 80
4. If no clause boundary, break before a **conjunction**
   (`and ` `but ` `or `) before column 80
5. If none of the above, break at the last **word boundary**
   before column 80
6. Never break inside backtick spans, link text, or URLs

See `modules/wrapping-rules.md` for the full algorithm with
examples.

## Structural Rules

### Blank Lines Around Headings

```markdown
WRONG:
Some text.
## Heading
More text.

RIGHT:
Some text.

## Heading

More text.
```

Exception: the first line of a file may be a heading without
a preceding blank line.

### ATX Headings Only

```markdown
WRONG:
Heading
=======

WRONG:
Subheading
----------

RIGHT:
# Heading

RIGHT:
## Subheading
```

### Blank Line Before Lists

```markdown
WRONG:
Some introductory text:
- Item one
- Item two

RIGHT:
Some introductory text:

- Item one
- Item two
```

### Reference-Style Links for Long URLs

When an inline link pushes a line beyond 80 characters, use
reference-style syntax:

```markdown
WRONG (line too long):
See the [formatting guide](https://google.github.io/styleguide/docguide/style.html) for details.

RIGHT:
See the [formatting guide][fmt-guide] for details.

[fmt-guide]: https://google.github.io/styleguide/docguide/style.html
```

Place link definitions at the end of the current section or
at the end of the document. When the same URL appears multiple
times, use a single shared reference definition.

Short inline links that keep the line under 80 chars are fine:

```markdown
OK:
See [the guide](https://example.com) for details.
```
