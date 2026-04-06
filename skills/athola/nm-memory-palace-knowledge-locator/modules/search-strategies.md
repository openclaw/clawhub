---
name: search-strategies
description: Multi-modal search strategies and optimization techniques
category: algorithms
tags: [search, algorithms, optimization]
dependencies: [knowledge-locator]
complexity: intermediate
estimated_tokens: 300
---

# Search Strategies

Effective search combines multiple strategies based on query type and context.

## Strategy Selection

| Query Type | Primary Strategy | Secondary |
|-----|-----|-----|
| Exact path | Spatial lookup | - |
| Keyword | Semantic search | Fuzzy match |
| Partial info | Multi-modal fusion | Associative walk |
| Discovery | Graph traversal | Random walk |

## Strategy Implementations

### Spatial Lookup
1. Parse path components
2. Traverse hierarchy
3. Return exact match or nearest ancestors

### Semantic Search
1. Extract query keywords
2. Match against semantic index
3. Rank by relevance score
4. Return top-k results

### Fuzzy Matching
1. Apply edit distance tolerance
2. Check phonetic similarity
3. Expand query with synonyms
4. Merge and rank results

### Associative Walk
1. Start from known concept
2. Follow association edges
3. Score by path relevance
4. Return connected concepts

## Optimization Techniques

- **Query caching** - Cache frequent queries
- **Index partitioning** - Split by palace for parallelism
- **Hot path optimization** - Preload frequently accessed paths
- **Lazy loading** - Load deep indices on demand
