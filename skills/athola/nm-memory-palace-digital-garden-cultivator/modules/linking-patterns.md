---
name: linking-patterns
description: Strategies for creating effective bidirectional links in digital gardens
category: patterns
tags: [linking, bidirectional, connections]
dependencies: [digital-garden-cultivator]
complexity: beginner
estimated_tokens: 300
---

# Linking Patterns

Effective linking creates a navigable knowledge network that supports both focused retrieval and serendipitous discovery.

## Link Types

### Direct Links
Explicit connections between related content.
- **Use when**: Clear topical relationship exists
- **Example**: "OAuth" → "Authentication Methods"

### Contextual Links
Links embedded within explanatory sentences.
- **Use when**: Connection needs context to understand
- **Example**: "This pattern uses [dependency injection] for testability"

### Hub Links
Central nodes that connect many related topics.
- **Use when**: Topic serves as organizing principle
- **Example**: "API Design" as hub for REST, GraphQL, RPC topics

### Bridge Links
Connections between seemingly unrelated domains.
- **Use when**: Cross-domain insight exists
- **Example**: "Memory Palace techniques" → "Software Architecture"

## Linking Guidelines

1. **Always bidirectional** - If A links to B, B should link to A
2. **Contextual anchors** - Explain why the link exists
3. **Avoid orphans** - Every note should have at least one inbound link
4. **Limit outbound** - 3-7 outbound links per note is optimal
5. **Review regularly** - Remove stale or unhelpful links

## Anti-Patterns

- **Link dumping** - Adding links without context
- **Self-linking** - Circular references within same note
- **Overconnection** - Linking everything to everything
- **Stale links** - Links to archived or deleted content
