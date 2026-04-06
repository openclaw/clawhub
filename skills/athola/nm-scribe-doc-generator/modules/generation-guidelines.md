---
module: generation-guidelines
category: writing-quality
dependencies: []
estimated_tokens: 400
---

# Documentation Generation Guidelines

Detailed guidance for creating human-quality documentation.

## Opening Patterns

### What to Avoid

```markdown
BAD: "In today's fast-paced development environment, documentation plays a crucial role..."
BAD: "Welcome to the comprehensive guide to..."
BAD: "This document aims to provide an in-depth overview of..."
```

### What to Use

```markdown
GOOD: "scribe detects AI-generated content and helps you fix it."
GOOD: "Install with: npm install scribe"
GOOD: "This guide covers installation, configuration, and common workflows."
```

Start with what it IS or what it DOES. Skip the preamble.

## Section Structure

### Length Targets

| Section Type | Target Length |
|--------------|---------------|
| Overview | 50-100 words |
| Feature description | 30-60 words |
| Step in guide | 20-50 words |
| API endpoint | 40-80 words |

### Paragraph Guidance

Paragraphs should contain 2-4 sentences on a single topic. If a paragraph exceeds 5 sentences, split it.

One paragraph = one idea.

## Line Wrapping

Wrap prose text at 80 characters per line using hybrid
wrapping. This makes git diffs readable and mobile-friendly.

### Rules (in priority order)

1. Keep sentences on one line if they fit within 80 chars
2. Break long sentences at clause boundaries (after `, ; :`)
3. Break before conjunctions (`and`, `but`, `or`)
4. Break at word boundaries as a last resort

### Exempt from wrapping

Tables, code blocks, headings, frontmatter, HTML blocks,
link definitions, and image references stay on one line.

### Example

```markdown
BEFORE:
The system validates all input against the schema and rejects
malformed requests with a 400 status code, logging the
validation failure for debugging.

AFTER:
The system validates all input against the schema
and rejects malformed requests with a 400 status code,
logging the validation failure for debugging.
```

### Additional formatting rules

- Blank line before and after every heading
- ATX headings only (`#` style, never setext underlines)
- Blank line before every list
- Use reference-style links when inline links push past
  80 chars

Full specification: `Skill(leyline:markdown-formatting)`

## Concrete Examples

Every feature claim needs a concrete example:

```markdown
BAD: "The system provides flexible configuration options."

GOOD: "Configure via `scribe.yaml` or environment variables.
Set `SCRIBE_STRICT=1` to treat warnings as errors."
```

## Trade-off Discussions

Include reasoning, not just conclusions:

```markdown
BAD: "We recommend Redis for caching."

GOOD: "We chose Redis over Memcached for its sorted sets,
which power the leaderboard. Memcached would use less memory
but require additional application logic."
```

## Ending Patterns

### What to Avoid

```markdown
BAD: "In conclusion, we have covered the essential aspects of..."
BAD: "We hope this guide has been helpful in your journey..."
BAD: "Happy coding!"
```

### What to Use

End with the last useful piece of information. No summary paragraph unless the document exceeds 2000 words.

```markdown
GOOD: "For issues, open a ticket at github.com/org/repo/issues."
GOOD: "Next: Advanced Configuration"
GOOD: [Just end. No closing needed.]
```

## Voice Consistency

Maintain consistent perspective throughout:

| Style | Example |
|-------|---------|
| Direct | "Run `npm install`" |
| Team | "We recommend..." |
| Instructional | "You can configure..." |

Don't mix: "One should note that you can..."

## Handling Uncertainty

When information is incomplete:

```markdown
GOOD: "Exact performance varies by hardware. Our tests showed 50-200ms on M1 Mac."
GOOD: "This feature is experimental. API may change."
GOOD: "We haven't tested on Windows. Linux and macOS confirmed working."
```

Acknowledge limits rather than overgeneralizing.
