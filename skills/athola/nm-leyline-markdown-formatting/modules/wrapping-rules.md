---
module: wrapping-rules
category: cross-plugin-patterns
dependencies: []
estimated_tokens: 600
---

# Hybrid Line Wrapping Rules

Wrap prose text at 80 characters per line, preferring semantic
boundaries (sentences, clauses) over arbitrary word breaks.
This produces clean git diffs while keeping lines readable.

## The Algorithm

When writing a prose paragraph, apply these rules in order:

### Priority 1: Sentence Boundaries

If a sentence (ending with `.` `!` or `?` followed by a space)
fits within 80 characters, keep it on one line.

```markdown
BEFORE (single long line):
Install the plugin with npm. Configure it in your settings file. Restart the editor to activate.

AFTER (one sentence per line, each under 80 chars):
Install the plugin with npm.
Configure it in your settings file.
Restart the editor to activate.
```

### Priority 2: Clause Boundaries

If a sentence exceeds 80 characters, break after the nearest
comma, semicolon, or colon before column 80.

```markdown
BEFORE (one 95-char sentence):
When the configuration file is missing, the system falls back to sensible defaults for all settings.

AFTER (break after comma at position 43):
When the configuration file is missing,
the system falls back to sensible defaults
for all settings.
```

### Priority 3: Conjunctions

If no clause boundary exists before column 80, break before
a conjunction: `and`, `but`, `or`, `nor`, `yet`, `so`.

```markdown
BEFORE:
The parser reads the input file and transforms each node into an output token.

AFTER:
The parser reads the input file
and transforms each node into an output token.
```

### Priority 4: Word Boundaries

If none of the above apply, break at the last word boundary
before column 80.

```markdown
BEFORE:
The implementation requires understanding the underlying architecture thoroughly.

AFTER:
The implementation requires understanding the underlying
architecture thoroughly.
```

## Never Break Inside

These constructs must stay intact on a single line:

- **Inline code**: `` `some_function_name` `` stays together
- **Link text**: `[link text]` stays on one line
- **Link URLs**: `(https://example.com/path)` stays on one line
- **Image syntax**: `![alt](url)` stays together
- **Bold/italic spans**: `**bold text**` stays together

If keeping these intact pushes a line beyond 80 chars,
that is acceptable. Do not break the construct.

## Exempt Content Types

Do NOT apply wrapping to any of these:

| Content Type | How to Identify |
|-------------|-----------------|
| Tables | Lines containing `\|` pipe characters |
| Code blocks | Between ` ``` ` fences or indented 4+ spaces |
| Headings | Lines starting with `#` |
| Frontmatter | Between `---` or `+++` delimiters at file start |
| HTML blocks | Lines starting with `<` HTML tags |
| Link defs | Lines matching `[id]: url` pattern |
| Image lines | Lines that are only `![alt](url)` |

## Blockquotes

For blockquote content, wrap the text inside the quote at 78
characters (80 minus the `> ` prefix) following the same
algorithm:

```markdown
BEFORE:
> This is a very long blockquote line that exceeds 80 characters when you include the prefix marker.

AFTER:
> This is a very long blockquote line that exceeds
> 80 characters when you include the prefix marker.
```

## List Items

For list items with long descriptions, wrap the continuation
lines with appropriate indentation:

```markdown
BEFORE:
- **markdown-formatting**: Canonical markdown formatting conventions for diff-friendly documentation generation and review.

AFTER:
- **markdown-formatting**: Canonical markdown formatting
  conventions for diff-friendly documentation generation
  and review.
```

Continuation lines align with the text start (2 spaces for
`- `, 3 spaces for `1. `).

## Reference-Style Links

When an inline link would push a line beyond 80 characters,
convert to reference-style:

```markdown
BEFORE:
See the [complete formatting guide](https://google.github.io/styleguide/docguide/style.html) for more details.

AFTER:
See the [complete formatting guide][fmt] for more details.

[fmt]: https://google.github.io/styleguide/docguide/style.html
```

Place definitions at the end of the current section (after the
last paragraph, before the next heading) or at the end of the
document.

## Examples: Full Paragraph

### Before (no wrapping)

```markdown
The scribe plugin detects AI-generated content markers and helps you remediate them. It analyzes vocabulary patterns, structural markers, and phrase patterns to calculate a slop density score on a 0-10 scale. Documents scoring above 2.5 should receive section-by-section review, while documents above 5.0 need a full rewrite to remove artificial patterns.
```

### After (hybrid wrapping)

```markdown
The scribe plugin detects AI-generated content markers
and helps you remediate them.
It analyzes vocabulary patterns, structural markers,
and phrase patterns to calculate a slop density score
on a 0-10 scale.
Documents scoring above 2.5 should receive
section-by-section review,
while documents above 5.0 need a full rewrite to remove
artificial patterns.
```

Note how each sentence starts on its own line when possible,
and long sentences break at clause boundaries (after commas)
or before conjunctions (and, while).
