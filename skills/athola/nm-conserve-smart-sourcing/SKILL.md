---
name: smart-sourcing
description: |
  Select optimal information sources for tool calls and file reads, balancing accuracy with token efficiency
version: 1.8.1
triggers:
  - sourcing
  - citations
  - accuracy
  - efficiency
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/conserve", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: conserve
---

> **Night Market Skill** — ported from [claude-night-market/conserve](https://github.com/athola/claude-night-market/tree/master/plugins/conserve). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Smart Sourcing

Intelligent sourcing that requires citations only when the cost is justified by the value of verification.

## Philosophy

**Full sourcing is prohibitively expensive** (10-16x token increase). Smart sourcing targets high-value claims where verification materially improves accuracy.

## When to Source

### REQUIRE Sources

| Claim Type | Example | Why Source |
|------------|---------|------------|
| **Version numbers** | "Python 3.12 added..." | Versions change, easy to verify |
| **Performance claims** | "30% faster than..." | Quantitative claims need evidence |
| **Security recommendations** | "Use bcrypt for..." | Security advice must be current |
| **API specifications** | "The function accepts..." | APIs change between versions |
| **Release dates** | "Released in Q4 2025" | Factual, verifiable |
| **Pricing/limits** | "Free tier allows 1000 requests" | Business terms change |
| **Deprecated features** | "X was removed in version Y" | Breaking changes need verification |

### DO NOT Require Sources

| Claim Type | Example | Why No Source |
|------------|---------|---------------|
| **General concepts** | "Async improves concurrency" | Foundational knowledge |
| **Code examples** | Demonstrative snippets | Illustrative, not factual claims |
| **Opinion/preference** | "Consider using..." | Clearly framed as suggestion |
| **Common knowledge** | "Git tracks changes" | Universal understanding |
| **Logical derivations** | "Therefore, X implies Y" | Reasoning, not factual claim |
| **Syntax** | "Use `def` for functions" | Language documentation is stable |

## Decision Framework

```
Is this a factual claim?
├── No → No source needed
└── Yes → Would being wrong cause harm?
    ├── No (minor inconvenience) → No source needed
    └── Yes → Is verification cost-effective?
        ├── No (>5k tokens for low-value claim) → State uncertainty
        └── Yes → Perform web search, cite source
```

## Implementation

### Inline Citations

When sourcing is warranted:

```markdown
Python 3.12 introduced `type` statement for type aliases[1].

Sources:
1. [PEP 695](https://peps.python.org/pep-0695/)
```

### Uncertainty Markers

When sourcing isn't cost-effective but uncertainty exists:

```markdown
Python 3.12 introduced the `type` statement (verify in release notes for your version).
```

### Confidence Levels

| Confidence | Action |
|------------|--------|
| High (stable facts) | State directly |
| Medium (may have changed) | Add verification note |
| Low (uncertain) | Source or acknowledge uncertainty |

## Token Cost Analysis

| Approach | Token Cost | Use Case |
|----------|------------|----------|
| No sourcing | Baseline | General knowledge |
| Uncertainty marker | +5-10 tokens | Medium confidence |
| Single source | +2-5k tokens | High-value claim |
| Multiple sources | +10-20k tokens | Research tasks |

## Examples

### Good: Source Version-Specific Claim

```markdown
User: What's new in FastAPI 0.109?

Response: FastAPI 0.109 added Pydantic v2 support as default[1] and
improved OpenAPI schema generation[2].

Sources:
1. [FastAPI Release Notes](https://fastapi.tiangolo.com/release-notes/)
2. [GitHub Release 0.109.0](https://github.com/tiangolo/fastapi/releases/tag/0.109.0)
```

### Good: No Source for General Concept

```markdown
User: How does async/await work?

Response: Async/await enables non-blocking I/O by allowing coroutines
to yield control while waiting for operations. The event loop manages
execution, resuming coroutines when their awaited operations complete.
```

### Good: Uncertainty Marker

```markdown
The connection pool default is typically 10 connections (verify in your
database driver documentation as this varies by library and version).
```

## Integration

Works with:
- `conserve:response-compression` - Keeps sourced responses concise
- `conserve:token-conservation` - Weighs source cost vs value
- `memory-palace:research` - Full sourcing for knowledge corpus

## When To Use Full Sourcing

## When NOT To Use

- Internal project code that doesn't need citations
- Casual conversation without factual claims

Escalate to full sourcing (accept high token cost) for:
- Knowledge corpus entries (permanent documentation)
- Security advisories (safety-critical)
- Compliance/legal claims (audit requirements)
- Research tasks (user expects thorough investigation)

For these cases, use `memory-palace:research` workflow which is designed for comprehensive sourcing.
