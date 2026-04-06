---
name: index-structure
description: Data structures for spatial indexing of memory palace content
category: technical
tags: [indexing, data-structure, storage]
dependencies: [knowledge-locator]
complexity: advanced
estimated_tokens: 350
---

# Index Structure

The Knowledge Locator maintains multiple indices for efficient multi-modal search.

## Primary Index Schema

```json
{
  "spatial_index": {
    "coordinates": {
      "palace": "string",
      "district": "string",
      "building": "string",
      "room": "string",
      "area": "string"
    },
    "concept_data": {
      "primary_concept": "string",
      "keywords": ["list"],
      "sensory_signature": "object",
      "associations": ["related_concepts"],
      "access_frequency": "number",
      "last_accessed": "timestamp"
    }
  },
  "semantic_index": {
    "concept_clusters": {},
    "relationship_graph": {},
    "context_mappings": {}
  },
  "temporal_index": {
    "creation_timeline": {},
    "access_patterns": {},
    "decay_rates": {}
  }
}
```

## Index Types

### Spatial Index
- Hierarchical path-based lookup
- O(log n) traversal for location queries
- Supports wildcard matching at any level

### Semantic Index
- Keyword-to-concept mapping
- Concept clustering for similarity search
- Relationship graph for association traversal

### Temporal Index
- Creation timeline for history queries
- Access frequency for hot/cold optimization
- Decay rates for staleness detection

## Index Maintenance

- **Rebuild**: Full reindex when structure changes significantly
- **Incremental**: Update affected entries on concept changes
- **Compact**: Remove deleted entries and optimize storage
