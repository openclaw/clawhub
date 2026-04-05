# Tradeoff Dimensions

Quality attributes for evaluating features. Based on ISO 25010 software quality model, CAP/PACELC theorems, and practical engineering concerns.

## Overview

Every feature makes tradeoffs. This module provides structured evaluation across nine dimensions, each with specific criteria and scoring guidance.

**Scoring Scale:** 1-5 for each dimension

| Score | Meaning |
|-------|---------|
| 1 | Poor - Significant issues |
| 2 | Below average - Notable gaps |
| 3 | Adequate - Meets basic needs |
| 4 | Good - Above expectations |
| 5 | Excellent - Best in class |

## Dimension 1: Quality of Results

**Question:** Does the feature deliver correct, accurate results?

### Evaluation Criteria

| Score | Criteria |
|-------|----------|
| 5 | Always correct, handles all edge cases, validated against ground truth |
| 4 | Correct in normal cases, handles most edge cases |
| 3 | Usually correct, some known edge case issues |
| 2 | Occasionally incorrect, multiple edge case failures |
| 1 | Frequently incorrect, unreliable outputs |

### Considerations

- **Correctness:** Does it produce right answers?
- **Completeness:** Does it handle all expected inputs?
- **Precision:** How accurate are numerical/search results?
- **Recall:** Does it find everything it should?

### Tradeoff Partners

- Quality often trades against **Latency** (more checks = slower)
- Quality often trades against **Resource Usage** (validation costs)

---

## Dimension 2: Latency

**Question:** Does the feature meet timing requirements for its classification?

### Evaluation Criteria by Type

**For Reactive Features:**

| Score | Criteria |
|-------|----------|
| 5 | < 50ms response, feels instant |
| 4 | 50-100ms response, very responsive |
| 3 | 100-300ms response, acceptable |
| 2 | 300ms-1s response, noticeable delay |
| 1 | > 1s response, frustrating delay |

**For Proactive Features:**

| Score | Criteria |
|-------|----------|
| 5 | Completes before needed, no user awareness |
| 4 | Usually ready when needed |
| 3 | Sometimes user waits briefly |
| 2 | Often not ready, visible loading |
| 1 | Rarely ready, defeats purpose |

### Considerations

- **P50 latency:** Typical case
- **P99 latency:** Worst case (matters for reliability)
- **Cold start:** First invocation time
- **Warm path:** Subsequent invocations

### Tradeoff Partners

- Latency trades against **Quality** (PACELC theorem)
- Latency trades against **Consistency** (eventual vs strong)

---

## Dimension 3: Token Usage

**Question:** Is the feature context-efficient for LLM interactions?

### Evaluation Criteria

| Score | Criteria |
|-------|----------|
| 5 | Minimal tokens, highly compressed, efficient prompts |
| 4 | Reasonable tokens, well-structured |
| 3 | Average tokens, some verbosity |
| 2 | High token usage, could be optimized |
| 1 | Excessive tokens, bloated context |

### Considerations

- **Input tokens:** How much context needed?
- **Output tokens:** How verbose are results?
- **Caching potential:** Can results be reused?
- **Streaming:** Can partial results reduce perception?

### Measurement

```
Token Efficiency = Useful Output / Total Tokens
```

Target: > 0.5 for most features

### Tradeoff Partners

- Token usage trades against **Quality** (more context = better results)
- Token usage trades against **Readability** (compression reduces clarity)

---

## Dimension 4: Resource Usage (CPU/Memory)

**Question:** Is CPU and memory consumption reasonable?

### Evaluation Criteria

| Score | Criteria |
|-------|----------|
| 5 | Minimal footprint, efficient algorithms |
| 4 | Low resource usage, well-optimized |
| 3 | Moderate usage, acceptable overhead |
| 2 | High usage, performance impact on system |
| 1 | Excessive usage, causes degradation |

### Considerations

- **Peak memory:** Maximum allocation
- **Sustained memory:** Ongoing consumption
- **CPU intensity:** Processing load
- **I/O patterns:** Disk/network usage

### Measurement Guidance

| Resource | Good | Acceptable | Poor |
|----------|------|------------|------|
| Memory delta | < 10MB | 10-50MB | > 50MB |
| CPU spike | < 100ms | 100-500ms | > 500ms |
| Sustained CPU | < 5% | 5-20% | > 20% |

### Tradeoff Partners

- Resources trade against **Latency** (caching uses memory)
- Resources trade against **Scalability** (per-user costs)

---

## Dimension 5: Redundancy (Fault Tolerance)

**Question:** Does the feature handle failures gracefully?

### Evaluation Criteria

| Score | Criteria |
|-------|----------|
| 5 | Full redundancy, automatic failover, no data loss |
| 4 | Good failover, minimal disruption |
| 3 | Basic error handling, recoverable failures |
| 2 | Some failure handling, may require retry |
| 1 | No redundancy, failures cause data loss or crashes |

### Considerations

- **Graceful degradation:** Does it fail partially vs completely?
- **Retry logic:** Does it handle transient failures?
- **Data durability:** Is data protected from loss?
- **Recovery time:** How fast to recover?

### CAP Theorem Implications

For distributed features:
- **CP systems:** May sacrifice availability for consistency
- **AP systems:** May sacrifice consistency for availability

### Tradeoff Partners

- Redundancy trades against **Complexity** (more failure modes)
- Redundancy trades against **Latency** (replication delays)

---

## Dimension 6: Readability (Maintainability)

**Question:** Can others understand and modify this feature?

### Evaluation Criteria

| Score | Criteria |
|-------|----------|
| 5 | Self-documenting, clear abstractions, easy to extend |
| 4 | Well-structured, good comments, learnable |
| 3 | Understandable with effort, some complexity |
| 2 | Hard to follow, requires tribal knowledge |
| 1 | Opaque, only original author understands |

### Considerations

- **Code clarity:** Is logic obvious?
- **Documentation:** Are complex parts explained?
- **Naming:** Are variables/functions descriptive?
- **Structure:** Is code well-organized?

### Measurement Proxies

- Cyclomatic complexity < 10
- Functions < 50 lines
- Clear separation of concerns
- Test coverage > 80%

### Tradeoff Partners

- Readability trades against **Token Usage** (verbose = clearer)
- Readability trades against **Resource Usage** (abstractions have cost)

---

## Dimension 7: Scalability

**Question:** Will the feature handle 10x load?

### Evaluation Criteria

| Score | Criteria |
|-------|----------|
| 5 | Linear or sub-linear scaling, handles massive load |
| 4 | Good scaling, handles significant growth |
| 3 | Adequate scaling, may need attention at 5x |
| 2 | Poor scaling, issues at 2-3x load |
| 1 | Doesn't scale, breaks under modest increase |

### Considerations

- **Horizontal scaling:** Can add more instances?
- **Vertical scaling:** Can add more resources?
- **Bottlenecks:** Where does it fail first?
- **State management:** How is state distributed?

### Scaling Patterns

| Pattern | Scalability | Complexity |
|---------|-------------|------------|
| Stateless | Excellent | Low |
| Cached | Very good | Medium |
| Sharded | Good | High |
| Stateful single | Poor | Low |

### Tradeoff Partners

- Scalability trades against **Complexity** (distributed systems are hard)
- Scalability trades against **Redundancy** (more nodes = more failure modes)

---

## Dimension 8: Integration (Interoperability)

**Question:** Does the feature play well with existing systems?

### Evaluation Criteria

| Score | Criteria |
|-------|----------|
| 5 | smooth integration, follows all conventions, composable |
| 4 | Good integration, minor adaptations needed |
| 3 | Integrates with effort, some friction |
| 2 | Difficult integration, significant workarounds |
| 1 | Isolated, doesn't integrate without major changes |

### Considerations

- **API consistency:** Matches existing patterns?
- **Data formats:** Uses standard formats?
- **Dependencies:** Minimal coupling?
- **Extension points:** Can be extended/wrapped?

### Integration Checklist

- [ ] Uses project's standard data formats
- [ ] Follows naming conventions
- [ ] Integrates with existing logging/metrics
- [ ] Works with existing auth/permissions
- [ ] Compatible with existing tooling

### Tradeoff Partners

- Integration trades against **Innovation** (conventions limit novelty)
- Integration trades against **Optimization** (generic > specialized)

---

## Dimension 9: API Surface

**Question:** Is the API backward compatible and well-designed?

### Evaluation Criteria

| Score | Criteria |
|-------|----------|
| 5 | Stable API, versioned, excellent documentation, no breaking changes |
| 4 | Good API, rare breaking changes with migration path |
| 3 | Adequate API, occasional breaking changes |
| 2 | Unstable API, frequent breaking changes |
| 1 | No stable API, constant churn |

### Considerations

- **Breaking changes:** How often do consumers break?
- **Deprecation policy:** Are changes communicated?
- **Versioning:** Is there a versioning strategy?
- **Documentation:** Is the contract clear?

### API Design Checklist

- [ ] Additive changes only (no removal)
- [ ] Optional new fields with defaults
- [ ] Deprecation warnings before removal
- [ ] Semantic versioning
- [ ] Clear error contracts

### Tradeoff Partners

- API stability trades against **Innovation** (can't change freely)
- API stability trades against **Quality** (may keep suboptimal designs)

---

## Composite Scoring

Calculate overall tradeoff score:

```
Tradeoff Score = Σ(dimension_score * dimension_weight) / Σ(weights)
```

### Default Weights

| Dimension | Default Weight | Rationale |
|-----------|---------------|-----------|
| Quality | 1.0 | Core requirement |
| Latency | 1.0 | User experience |
| Token Usage | 1.0 | LLM efficiency |
| Resource Usage | 0.8 | Important but secondary |
| Redundancy | 0.5 | Context-dependent |
| Readability | 1.0 | Maintainability |
| Scalability | 0.8 | Future-proofing |
| Integration | 1.0 | Ecosystem fit |
| API Surface | 1.0 | Contract stability |

### Guardrail

**Minimum 5 dimensions must be evaluated.** Cannot skip all tradeoff analysis.

---

## Using Tradeoffs in Review

### For Existing Features

1. Score each dimension
2. Identify dimensions below 3
3. Determine if improvement is feasible
4. Prioritize based on impact

### For Proposed Features

1. Estimate scores for each dimension
2. Compare against existing features
3. Identify which tradeoffs are acceptable
4. Document accepted tradeoffs explicitly

### Red Flag Combinations

| Pattern | Concern | Action |
|---------|---------|--------|
| High Quality + High Latency | May frustrate users | Optimize or classify as Proactive |
| Low Readability + Low API Surface | Maintenance nightmare | Refactor before extending |
| High Token + Low Quality | Wasteful | Optimize prompts |
| Low Redundancy + High Integration | Cascading failures | Add fault tolerance |
