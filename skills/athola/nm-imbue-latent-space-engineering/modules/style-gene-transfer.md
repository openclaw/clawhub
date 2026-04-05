---
name: style-gene-transfer
description: Pattern for injecting exemplar code or prose into context
  before requesting output to transfer stylistic attributes.
parent_skill: imbue:latent-space-engineering
category: methodology
estimated_tokens: 200
---

# Style Gene Transfer

## Principle

Agents reproduce stylistic attributes from pre-loaded samples. By
injecting a representative exemplar before requesting output, you
transfer naming conventions, comment style, error handling patterns,
and prose voice.

## Template

~~~
Review this prior work for style and conventions:
---
[exemplar snippet, 50-200 lines]
---
Now apply the same style to your output for: [task]
~~~

## When To Use

- Generating code that must match codebase conventions
- Writing documentation in an established voice
- Creating tests that follow existing test patterns
- Producing configuration that matches project style

## When NOT To Use

- Greenfield projects with no style precedent
- Exemplar exceeds 200 lines (diminishing returns, wasted tokens)
- Task is purely algorithmic (style is irrelevant)
- Output format is rigidly specified (template-driven)

## Size Guidelines

| Exemplar Size | Effectiveness | Token Cost |
|---------------|---------------|------------|
| 20-50 lines | Basic style transfer | Low |
| 50-100 lines | Good pattern coverage | Medium |
| 100-200 lines | Excellent fidelity | High |
| 200+ lines | Diminishing returns | Wasteful |

## Selection Criteria

Choose exemplar code that:

1. Is from the same codebase and language
2. Represents the BEST style (not legacy code)
3. Contains the patterns you want reproduced
4. Is recent (reflects current conventions)
