---
module: exemplar-reference
category: style-analysis
dependencies: [Read]
estimated_tokens: 350
---

# Exemplar Reference Module

Select and document representative passages for style guidance.

## Selection Criteria

Choose passages that demonstrate:

1. **Characteristic rhythm**: Sentence length variation patterns
2. **Vocabulary choices**: Typical word selection
3. **Tone markers**: How formality/informality is expressed
4. **Structural preferences**: Paragraph and list usage

## Anti-Selection Criteria

Avoid passages that:

- Are atypically long or short
- Contain unusual formatting
- Quote external sources
- Are transitional/boilerplate
- Contain code blocks (unless style includes code)

## Passage Length

Optimal exemplar length: **50-150 words**

- Too short: Insufficient pattern demonstration
- Too long: Dilutes key characteristics

## Annotation Format

```markdown
### Exemplar: Technical Explanation

**Source**: docs/architecture.md, lines 45-52
**Word count**: 87
**Demonstrates**: Concise technical explanation with grounded examples

> The cache layer sits between the API and database. When a request
> arrives, we check Redis first. Cache hits return in under 5ms;
> misses fall through to Postgres, adding 50-200ms depending on
> query complexity. We chose Redis over Memcached for its richer
> data structures—sorted sets power our leaderboard feature.

**Key characteristics**:
- Short, direct sentences (avg 12 words)
- Specific numbers (5ms, 50-200ms)
- One em dash for aside
- Trade-off explanation ("chose X over Y because")
- No filler phrases
- Technical but accessible
```

## Minimum Exemplar Set

For a complete style profile, collect at least:

| Type | Purpose |
|------|---------|
| Explanation | How concepts are introduced |
| Instruction | How steps are given |
| Transition | How sections connect |

For narrative content, add:

| Type | Purpose |
|------|---------|
| Description | Scene/object portrayal |
| Dialogue | Character voice |
| Action | Event pacing |

## Usage in Generation

When generating new content, present exemplars as reference:

```
Write in a style similar to this passage:

> [exemplar text]

Key aspects to match:
- Sentence length around X words
- [Specific vocabulary preferences]
- [Tone markers to include]
- [Patterns to avoid]
```
