---
name: storage-patterns
description: Structured formats for storing different types of external knowledge
category: storage
tags: [storage, formats, templates, organization]
dependencies: [knowledge-intake]
complexity: beginner
estimated_tokens: 400
---

# Knowledge Storage Patterns

Structured templates for storing different types of external knowledge.

## Storage Location Matrix

| Knowledge Type | Location | Format |
|----------------|----------|--------|
| Meta-learning patterns | `docs/knowledge-corpus/` | Full palace entry |
| Skill design insights | `skills/*/modules/` | Technique module |
| Tool/library knowledge | `docs/references/` | Quick reference |
| Temporary insights | Digital garden seedling | Lightweight note |
| Version-specific info | `docs/references/dated/` | Timestamped entry |

## Entry Templates

### Full Palace Entry (Evergreen)

For high-value, durable knowledge:

```yaml
---
title: [Descriptive Title]
source: [URL]
author: [Author name]
date_captured: [YYYY-MM-DD]
palace: [Thematic grouping]
district: [Subcategory]
maturity: evergreen
tags: [relevant, tags]
---

# [Title]

## Core Thesis
[1-2 sentences summarizing the main argument]

## Memory Palace Layout
[Spatial structure mapping key concepts]

## Key Concepts
[Detailed breakdown with sensory encoding]

## Connections
- Internal: [Links to skills/modules]
- External: [Related sources]

## Application Notes
[How to apply this knowledge]

## Source Attribution
[Full citation]
```

### Technique Module (Skill Integration)

For patterns that enhance existing skills:

```yaml
---
name: [technique-name]
description: [One line description]
category: techniques
tags: [relevant, tags]
dependencies: [parent-skill]
source: [URL]
complexity: beginner|intermediate|advanced
estimated_tokens: [number]
---

# [Technique Name]

## Origin
[Where this came from, attribution]

## The Pattern
[Core technique explanation]

## Application
[How to use it]

## Integration
[Links to related modules]
```

### Quick Reference (Tool Knowledge)

For version-specific or tool-focused info:

```yaml
---
title: [Tool/Library Name]
source: [URL]
date_captured: [YYYY-MM-DD]
version: [relevant version]
maturity: reference
expires: [optional expiry date]
---

# [Title]

## Quick Summary
[2-3 bullet points]

## Key Commands/Patterns
[Code examples]

## Gotchas
[Common pitfalls]

## See Also
[Related references]
```

### Seedling (Lightweight Note)

For ideas to revisit:

```yaml
---
title: [Brief Title]
source: [URL]
captured: [YYYY-MM-DD]
maturity: seedling
review_after: [YYYY-MM-DD]
---

## Key Insight
[One paragraph]

## Why It Matters
[One sentence]

## Next Action
[What to do with this]
```

## File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Corpus entry | `topic-name.md` | `franklin-protocol-learning.md` |
| Module | `technique-name.md` | `structured-concurrency.md` |
| Reference | `tool-version.md` | `python-3.12-features.md` |
| Seedling | `YYYY-MM-DD-topic.md` | `2025-12-04-async-pattern.md` |

## Maturity Progression

```
seedling → growing → evergreen → (archive)
    ↓         ↓          ↓           ↓
 1-2 weeks  1-3 months  permanent  deprecated
```

### Promotion Criteria

**Seedling → Growing**:
- Accessed more than once
- Connected to other entries
- Expanded with new insights

**Growing → Evergreen**:
- Proven useful over 3+ months
- Stable, not frequently edited
- Well-connected in knowledge graph

**Evergreen → Archive**:
- Superseded by newer knowledge
- Technology/approach deprecated
- No longer applicable
