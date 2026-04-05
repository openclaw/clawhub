# Research Enrichment

External evidence from the tome plugin adjusts feature-review
scoring factors. Research findings produce deltas applied to
initial human assessments, not replacement scores.

## Channel-to-Factor Mapping

Each tome research channel maps to primary and secondary
scoring factors:

| Channel | Primary Factor | Secondary Factor | Evidence Produced |
|---------|---------------|-----------------|-------------------|
| code-search | Reach | Complexity | Competitor count, star counts, implementation prevalence |
| discourse | Impact | Business Value | Sentiment score, mention volume, request frequency |
| papers | Impact | Risk | Citation count, novelty assessment, validation level |
| triz | Business Value | Impact | Cross-domain analogy count, inventive principle match |

## Score Delta Calculation

Research findings produce an adjustment delta for each factor:

```
research_delta = findings_consensus * evidence_strength

Where:
  findings_consensus: -2 to +2 (direction and magnitude)
  evidence_strength: 0.0 to 1.0 (how reliable the findings are)

applied_delta = research_delta * channel_weight

If abs(applied_delta) < evidence_threshold:
    applied_delta = 0  (insufficient evidence, discard)
```

### Channel Weight

The channel weight reflects how directly a channel's findings
map to its primary factor:

| Channel | Weight | Rationale |
|---------|--------|-----------|
| code-search | 0.8 | Star counts approximate adoption well |
| discourse | 0.7 | Sentiment is noisy but indicative |
| papers | 0.9 | Peer-reviewed evidence is strong |
| triz | 0.6 | Analogies are suggestive, not conclusive |

### Evidence Strength Sources

| Source | Strength | When |
|--------|----------|------|
| > 10 independent findings | 0.8-1.0 | High-volume channels |
| 5-10 findings | 0.5-0.8 | Moderate evidence |
| 1-5 findings | 0.3-0.5 | Sparse evidence |
| 0 findings | 0.0 | No evidence (discard delta) |

## Fibonacci Clamping

Adjusted scores must remain on the Fibonacci scale used by
the scoring framework: [1, 2, 3, 5, 8, 13].

```python
FIBONACCI = [1, 2, 3, 5, 8, 13]

def clamp_to_fibonacci(raw_score: float) -> int:
    """Clamp raw score to nearest Fibonacci value."""
    return min(FIBONACCI, key=lambda f: abs(f - raw_score))
```

### Clamping Rules

1. Calculate `raw_adjusted = initial_score + applied_delta`
2. Clamp to nearest Fibonacci value
3. Result must differ from initial by at most `max_delta`
   Fibonacci steps
4. If the clamped result exceeds `max_delta` steps from
   initial, use the value `max_delta` steps away

Example (max_delta = 2 steps):
- Initial: 5, raw_adjusted: 7 -> clamp: 8 (1 step away) OK
- Initial: 3, raw_adjusted: 11 -> clamp: 8 (3 steps away)
  exceeds max_delta -> use 13 (2 steps away from 3)
  Wait: 13 is 4 steps from 3. So use 8 (2 steps from 3).
  Correction: count Fibonacci index steps, not arithmetic.

Fibonacci indices: 1=0, 2=1, 3=2, 5=3, 8=4, 13=5

```python
def max_delta_clamp(initial: int, target: int, max_steps: int = 2) -> int:
    initial_idx = FIBONACCI.index(initial)
    target_idx = FIBONACCI.index(target)
    if abs(target_idx - initial_idx) <= max_steps:
        return target
    direction = 1 if target_idx > initial_idx else -1
    return FIBONACCI[initial_idx + direction * max_steps]
```

## Graceful Degradation

When the tome plugin is not installed or research fails:

1. **Tome not installed**: Print warning, skip Phase 4.5
   entirely. Initial scores stand unchanged.
2. **Individual channel fails**: Continue with remaining
   channels. Only apply deltas from successful channels.
3. **All channels fail**: Equivalent to tome not installed.
   Log the failure, proceed with initial scores.
4. **Timeout exceeded**: Use whatever findings collected so
   far. Partial results are acceptable.

### Detection Protocol

Check for tome availability:

1. Look for `plugins/tome/` directory in the project
2. If not found, check for tome in the global plugin path
3. If neither found, activate graceful degradation

## Integration with tome Skill Interfaces

Phase 4.5 dispatches research via tome's public skill
interfaces:

| Step | Action | tome Skill |
|------|--------|------------|
| 1 | Classify the project domain | `tome:research` (domain classifier) |
| 2 | Dispatch parallel research agents | `tome:research` (agent dispatch) |
| 3 | Synthesize findings | `tome:synthesize` |
| 4 | (Optional) Refine high-potential areas | `tome:dig` |

The feature-review skill invokes these via `Skill()` calls,
not direct Python imports. This maintains loose coupling.

### Research Topic Construction

For each feature under review, construct research topics:

```
topic = f"{feature_name} {feature_category} plugin/tool"
```

Example: "auto-save drafts developer tool" or "token
optimization LLM CLI"

### Synthesis Integration

After tome returns findings, extract deltas:

1. Parse synthesized report for quantitative signals
   (star counts, mention counts, citation counts)
2. Map quantitative signals to delta values using the
   channel-to-factor table
3. Extract qualitative signals (sentiment, novelty) for
   secondary factor adjustments
4. Apply delta calculation formula
5. Clamp to Fibonacci scale with max_delta constraint

## Output Enhancement

When research enrichment runs, add to the feature inventory:

```markdown
## Research Evidence

### Code Search (GitHub)
- Found 12 similar implementations, avg 340 stars
- **Reach adjustment**: +1 (broad ecosystem adoption)

### Discourse (HN/Reddit)
- 47 mentions in last 90 days, 78% positive sentiment
- **Impact adjustment**: +1 (strong community demand)

### Score Adjustments

| Feature | Factor | Initial | Delta | Adjusted | Evidence |
|---------|--------|---------|-------|----------|----------|
| Auth    | Reach  | 5       | +1    | 8        | 3 sources |
| Auth    | Impact | 3       | 0     | 3        | Low      |
```
