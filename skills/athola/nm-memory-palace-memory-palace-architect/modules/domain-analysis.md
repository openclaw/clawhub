---
name: domain-analysis
description: Systematic approach to analyzing knowledge domains for memory palace design
category: workflow
tags: [analysis, domain, concepts, hierarchy]
dependencies: [memory-palace-architect]
complexity: intermediate
estimated_tokens: 400
---

# Domain Analysis for Memory Palaces

Thorough domain analysis validates your memory palace accurately reflects the knowledge structure you're organizing.

## Analysis Process

### Step 1: Identify Core Concepts
- List all primary concepts in the domain
- Note the relative importance of each concept
- Identify foundational vs. advanced concepts

### Step 2: Map Relationships
- Document parent-child relationships (hierarchy)
- Identify sibling concepts (same level)
- Note cross-cutting concerns that span categories

### Step 3: Assess Complexity
- Rate each concept's complexity (1-5)
- Identify concepts requiring prerequisite knowledge
- Note areas with high information density

### Step 4: Define Access Patterns
- How often will each concept be accessed?
- What are typical entry points?
- Which concepts are frequently accessed together?

## Analysis Template

```yaml
domain:
  name: "Domain Name"
  scope: "What this domain covers"

concepts:
  - name: "Concept A"
    importance: high | medium | low
    complexity: 1-5
    prerequisites: []
    related_to: []
    access_frequency: frequent | occasional | rare

relationships:
  hierarchical:
    - parent: "Category"
      children: ["Concept A", "Concept B"]
  associative:
    - from: "Concept A"
      to: "Concept B"
      type: "complementary | sequential | contrasting"

boundaries:
  included: ["topics in scope"]
  excluded: ["topics out of scope"]
  adjacent: ["related domains"]
```

## Best Practices

1. **Start broad, then narrow** - Begin with major categories before details
2. **Use domain expert input** - Validate your analysis with subject matter experts
3. **Consider evolution** - Design for how the domain might grow
4. **Document uncertainties** - Note areas where relationships are unclear
