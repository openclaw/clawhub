---
name: template-patterns
description: Detailed template structures for different content types and storage domains
category: templates
tags: [templates, structures, formats, examples]
dependencies: [storage-templates]
complexity: beginner
estimated_tokens: 800
---

# Template Patterns

Detailed template structures for different content types and storage domains.

## Evergreen Template

For stable, proven knowledge that has long-term value:

```yaml
---
title: [Descriptive Title]
created: [YYYY-MM-DD]
updated: [YYYY-MM-DD]
maturity: evergreen
tags: [relevant, tags]
source: [URL or attribution]
author: [Original author if applicable]
---

# [Title]

## Core Thesis
[1-2 sentences summarizing the main concept or pattern]

## Key Concepts
[Detailed breakdown of core ideas]

## Application
[How to apply this knowledge in practice]

## Connections
[Links to related content or concepts]

## Attribution
[Full source citation and credits]
```

### Domain Variants

**Knowledge Management** (memory-palace):
```yaml
---
title: Franklin Protocol for Learning
created: 2025-12-05
maturity: evergreen
palace: learning-methods
district: meta-learning
tags: [learning, memory, techniques]
source: https://example.com/franklin-protocol
---

# Franklin Protocol for Learning

## Core Thesis
Deliberate practice through imitation, analysis, and reconstruction.

## Memory Palace Layout
[Spatial structure mapping key concepts]

## Key Concepts
[Detailed breakdown with sensory encoding]
```

**Configuration Storage** (sanctum):
```yaml
---
title: Conventional Commit Format
created: 2025-12-05
maturity: evergreen
scope: commit-messages
version: 1.0.0
tags: [git, commits, conventions]
source: https://conventionalcommits.org
---

# Conventional Commit Format

## Core Pattern
type(scope): subject

## Valid Types
[feat, fix, docs, style, refactor, test, chore]

## Examples
[Concrete examples]
```

## Growing Template

For content under active development:

```yaml
---
title: [Working Title]
created: [YYYY-MM-DD]
updated: [YYYY-MM-DD]
maturity: growing
review_date: [YYYY-MM-DD]
tags: [relevant, tags]
---

# [Title]

## Current Understanding
[What we know so far]

## Open Questions
[What needs further exploration]

## Recent Updates
[Change log of significant modifications]

## Evolution Path
[Expected direction of development]

## Related Content
[Links to connected topics]
```

### Domain Variants

**Specification Development** (spec-kit):
```yaml
---
title: Feature Specification Template
created: 2025-12-05
updated: 2025-12-05
maturity: growing
phase: planning
status: draft
tags: [spec, planning, template]
---

# Feature Specification

## Requirements
[What must be satisfied]

## Design Considerations
[Open design questions]

## Implementation Notes
[Current implementation ideas]

## Pending Decisions
[Items requiring resolution]
```

## Seedling Template

For early ideas and exploration:

```yaml
---
title: [Brief Title]
created: [YYYY-MM-DD]
maturity: seedling
review_after: [YYYY-MM-DD]
tags: [exploratory, idea]
source: [URL if applicable]
---

# [Title]

## Key Insight
[One paragraph capturing the core idea]

## Why It Matters
[One sentence on significance]

## Next Action
[What to do with this - research, test, discard, promote]
```

### Domain Variants

**Quick Captures** (memory-palace):
```yaml
---
title: Async Pattern Observation
created: 2025-12-05
maturity: seedling
review_after: 2025-12-19
tags: [async, python, pattern]
source: https://stackoverflow.com/questions/12345
---

# Async Pattern Observation

## Key Insight
Using asyncio.gather() with return_exceptions=True prevents one failure
from canceling all concurrent tasks.

## Why It Matters
More resilient async workflows without complex error handling.

## Next Action
Test in current async module, consider promoting to pattern library.
```

## Reference Template

For version-specific or tool-focused information:

```yaml
---
title: [Tool/Library Name]
created: [YYYY-MM-DD]
maturity: reference
version: [relevant version]
expires: [optional YYYY-MM-DD]
tags: [tool, reference, version]
source: [official docs URL]
---

# [Title]

## Quick Summary
[2-3 bullet points]

## Key Features/Commands
[Most useful capabilities with examples]

## Gotchas
[Common pitfalls and surprising behaviors]

## Version Notes
[What's specific to this version]

## See Also
[Related tools or newer versions]
```

### Domain Variants

**Tool Documentation**:
```yaml
---
title: Python 3.12 Features
created: 2025-12-05
maturity: reference
version: 3.12
expires: 2027-12-05
tags: [python, version, features]
source: https://docs.python.org/3.12/
---

# Python 3.12 Features

## Quick Summary
- Type parameter syntax (PEP 695)
- Improved error messages
- Performance optimizations

## Key Features
[Code examples for each feature]
```

## Template Selection Matrix

| Content Type | Initial Maturity | Expected Lifetime | Template |
|--------------|------------------|-------------------|----------|
| Proven pattern | Evergreen | Permanent | Evergreen |
| Active research | Growing | 1-3 months | Growing |
| Quick idea | Seedling | 1-2 weeks | Seedling |
| Tool docs | Reference | Until deprecated | Reference |
| Draft spec | Growing | Until approved | Growing |
| Final spec | Evergreen | Project lifetime | Evergreen |

## Common Frontmatter Fields

### Required
- `title`: Human-readable title
- `created`: ISO date (YYYY-MM-DD)
- `maturity`: Lifecycle stage

### Optional but Recommended
- `updated`: Last modification date
- `tags`: Searchable keywords
- `source`: Attribution URL
- `version`: For versioned content
- `expires`: For time-sensitive content
- `review_after`: For periodic review

### Domain-Specific
- `palace`, `district`: Knowledge organization (memory-palace)
- `scope`, `phase`, `status`: Workflow state (spec-kit, sanctum)
- `author`: Attribution for external content
- `dependencies`: Related content requirements

## Usage Examples

### Creating New Content

```bash
# Seedling for quick capture
cat > 2025-12-05-new-idea.md <<EOF
---
title: New Idea
created: 2025-12-05
maturity: seedling
review_after: 2025-12-19
---

## Key Insight
[Your idea]

## Next Action
[What to do]
EOF
```

### Promoting Content

```bash
# Update maturity and reorganize
# seedling: 2025-12-05-async-pattern.md
# to
# growing: async-pattern.md

mv 2025-12-05-async-pattern.md async-pattern.md
# Update frontmatter: maturity: growing
```

## Best Practices

1. **Start Small**: Use seedling for new ideas
2. **Date Prefix**: Only seedlings get date prefixes
3. **Review Schedule**: Set review_after for growing content
4. **Clean Metadata**: Remove unused frontmatter fields
5. **Stable Names**: Don't rename evergreen content
6. **Archive Clearly**: Mark deprecated content explicitly

## Integration

Import templates in your domain:

```python
from leyline.storage_templates import (
    EvergreenTemplate,
    GrowingTemplate,
    SeedlingTemplate,
    ReferenceTemplate
)

# Generate new document from template
doc = SeedlingTemplate.create(
    title="New Pattern",
    insight="Core idea here",
    action="Test and validate"
)
```
