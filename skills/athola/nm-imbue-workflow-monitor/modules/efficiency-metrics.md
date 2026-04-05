# Efficiency Metrics

Metrics and scoring algorithms for workflow efficiency analysis.

## Efficiency Score

Overall efficiency is scored 0.0 to 1.0:

```
efficiency_score = 1.0 - (penalty_sum / max_penalty)
```

Where penalties are accumulated for detected inefficiencies.

## Penalty Categories

### Output Verbosity (max 0.3 penalty)

| Lines | Penalty | Rationale |
|-------|---------|-----------|
| < 100 | 0.0 | Acceptable |
| 100-500 | 0.05 | Minor verbosity |
| 500-1000 | 0.15 | Significant verbosity |
| > 1000 | 0.30 | Excessive verbosity |

**Common offenders:**
```yaml
npm_install:
  default: 500+ lines
  with_silent: ~10 lines
  recommendation: "npm install --silent"

pip_install:
  default: 200+ lines
  with_quiet: ~5 lines
  recommendation: "pip install --quiet"

git_log:
  default: unlimited
  with_limit: controlled
  recommendation: "git log --oneline -10"
```

### Redundant Operations (max 0.25 penalty)

| Repetitions | Penalty | Rationale |
|-------------|---------|-----------|
| 2 | 0.0 | May be intentional |
| 3 | 0.05 | Possibly avoidable |
| 4-5 | 0.15 | Likely avoidable |
| > 5 | 0.25 | Definitely avoidable |

**Detection:**
```python
def calculate_redundancy_penalty(operations: list[dict]) -> float:
    """Calculate penalty for redundant operations."""
    from collections import Counter

    # Group by operation signature (command + key args)
    signatures = [op.get("signature", op.get("command")) for op in operations]
    counts = Counter(signatures)

    max_repetitions = max(counts.values()) if counts else 0

    if max_repetitions <= 2:
        return 0.0
    elif max_repetitions == 3:
        return 0.05
    elif max_repetitions <= 5:
        return 0.15
    else:
        return 0.25
```

### Parallelization Misses (max 0.2 penalty)

| Missed Opportunities | Penalty |
|---------------------|---------|
| 0 | 0.0 |
| 1-2 | 0.05 |
| 3-5 | 0.10 |
| > 5 | 0.20 |

**Detection criteria:**
- Operations with no data dependencies
- Different target resources
- No ordering requirements
- Could be batched in single tool call

### Over-Fetching (max 0.15 penalty)

| Over-Fetch Instances | Penalty |
|---------------------|---------|
| 0 | 0.0 |
| 1-2 | 0.05 |
| > 2 | 0.15 |

**Detection:**
- Large file read (>1000 lines) followed by small extraction
- Full file read when offset/limit would suffice
- Entire directory listing when glob pattern would work

### Context Waste (max 0.1 penalty)

| Context Usage | Penalty |
|--------------|---------|
| < 60% | 0.0 |
| 60-80% | 0.03 |
| 80-90% | 0.06 |
| > 90% | 0.10 |

## Efficiency Score Interpretation

| Score | Rating | Action |
|-------|--------|--------|
| 0.9-1.0 | Excellent | No action needed |
| 0.7-0.9 | Good | Minor improvements possible |
| 0.5-0.7 | Fair | Review and optimize |
| 0.3-0.5 | Poor | Significant optimization needed |
| < 0.3 | Critical | Workflow needs redesign |

## Metric Collection

### Required Data Points

```python
@dataclass
class WorkflowMetrics:
    """Metrics collected during workflow execution."""

    # Output metrics
    total_output_lines: int = 0
    verbose_commands: list[str] = field(default_factory=list)

    # Redundancy metrics
    operation_counts: dict[str, int] = field(default_factory=dict)
    file_read_counts: dict[str, int] = field(default_factory=dict)

    # Parallelization metrics
    sequential_independent_ops: int = 0
    parallel_opportunities_missed: int = 0

    # Over-fetching metrics
    large_reads_without_limit: int = 0
    full_reads_with_extraction: int = 0

    # Context metrics
    context_usage_percent: float = 0.0
    context_warnings: int = 0
```

### Calculation Example

```python
def calculate_efficiency_score(metrics: WorkflowMetrics) -> float:
    """Calculate overall efficiency score."""
    penalties = 0.0

    # Output verbosity penalty
    if metrics.total_output_lines > 1000:
        penalties += 0.30
    elif metrics.total_output_lines > 500:
        penalties += 0.15
    elif metrics.total_output_lines > 100:
        penalties += 0.05

    # Redundancy penalty
    max_repeats = max(metrics.operation_counts.values(), default=0)
    if max_repeats > 5:
        penalties += 0.25
    elif max_repeats > 3:
        penalties += 0.15
    elif max_repeats == 3:
        penalties += 0.05

    # Parallelization penalty
    if metrics.parallel_opportunities_missed > 5:
        penalties += 0.20
    elif metrics.parallel_opportunities_missed > 2:
        penalties += 0.10
    elif metrics.parallel_opportunities_missed > 0:
        penalties += 0.05

    # Over-fetching penalty
    over_fetches = metrics.large_reads_without_limit + metrics.full_reads_with_extraction
    if over_fetches > 2:
        penalties += 0.15
    elif over_fetches > 0:
        penalties += 0.05

    # Context waste penalty
    if metrics.context_usage_percent > 90:
        penalties += 0.10
    elif metrics.context_usage_percent > 80:
        penalties += 0.06
    elif metrics.context_usage_percent > 60:
        penalties += 0.03

    # Cap at 1.0 total penalty
    return max(0.0, 1.0 - min(penalties, 1.0))
```

## Reporting

### Efficiency Report Format

```markdown
## Workflow Efficiency Report

**Session:** {{SESSION_ID}}
**Duration:** {{DURATION}}
**Overall Score:** {{SCORE}} ({{RATING}})

### Penalty Breakdown

| Category | Penalty | Details |
|----------|---------|---------|
| Output verbosity | 0.15 | 3 verbose commands (750 lines total) |
| Redundant ops | 0.05 | Same file read 3 times |
| Parallelization | 0.00 | No missed opportunities |
| Over-fetching | 0.05 | 1 large file read |
| Context waste | 0.03 | 65% context used |
| **Total** | **0.28** | |

### Recommendations

1. Use `npm install --silent` (saves ~500 lines)
2. Cache config.json after first read
3. Consider using offset/limit for large-file.md
```

## Thresholds

Default thresholds (configurable in `.workflow-monitor.yaml`):

```yaml
efficiency:
  score_threshold: 0.7  # Report if below
  output_limit: 500     # Lines before penalty
  max_file_reads: 2     # Per file before penalty
  context_warning: 80   # Percent before penalty
```
