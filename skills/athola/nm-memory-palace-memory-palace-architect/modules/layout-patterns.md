---
name: layout-patterns
description: Architectural patterns and spatial hierarchy designs for memory palaces
category: patterns
tags: [layout, architecture, spatial, hierarchy]
dependencies: [memory-palace-architect]
complexity: intermediate
estimated_tokens: 450
---

# Layout Patterns for Memory Palaces

Effective layouts map conceptual relationships to spatial structures, making navigation intuitive.

## Spatial Hierarchy

The standard hierarchy maps domain structure to architectural levels:

```
District (Domain)
├── Building (Major Category)
│   ├── Floor (Sub-category)
│   │   ├── Room (Concept)
│   │   │   ├── Area (Detail)
│   │   │   │   └── Object (Specific fact)
```

## Pattern Catalog

### Linear Path
Best for: Sequential learning, step-by-step processes

```
Entry → Room 1 → Room 2 → Room 3 → Exit
```
- Natural for tutorials and workflows
- Clear progression from start to finish
- Limited for non-linear access

### Hub and Spoke
Best for: Central concept with related topics

```
        Topic A
           ↑
Topic D ← HUB → Topic B
           ↓
        Topic C
```
- Quick access to all topics from center
- Good for reference material
- Can become crowded with many spokes

### Nested Boxes
Best for: Hierarchical taxonomies

```
┌─────────────────────────────────┐
│ Category                        │
│  ┌─────────────┬─────────────┐  │
│  │ Subcategory │ Subcategory │  │
│  │  ┌───┐ ┌───┐│  ┌───┐ ┌───┐│  │
│  │  │ A │ │ B ││  │ C │ │ D ││  │
│  │  └───┘ └───┘│  └───┘ └───┘│  │
│  └─────────────┴─────────────┘  │
└─────────────────────────────────┘
```

### Network Grid
Best for: Highly interconnected domains

```
A ─── B ─── C
│     │     │
D ─── E ─── F
│     │     │
G ─── H ─── I
```
- Multiple paths to any node
- Good for cross-references
- Can be disorienting without landmarks

## Design Guidelines

1. **Match pattern to domain structure** - Linear for sequential, hub for centralized
2. **Create clear landmarks** - Distinctive features at key navigation points
3. **Limit room count per floor** - 5-7 rooms is ideal for recall
4. **Design clear entry points** - Users should know where to start
5. **Plan for growth** - Leave expansion space in your layout
