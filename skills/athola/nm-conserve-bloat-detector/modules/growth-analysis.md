---
module: growth-analysis
category: tier-1
dependencies: [Bash, Grep, Glob]
estimated_tokens: 1500
---

# Growth Analysis Module

Track codebase growth velocity using git history.
Forecast future size, predict threshold crossings,
and rank directories by urgency.

This module replaces the former standalone
`/analyze-growth` command (removed in v1.6.0).
It runs as part of `/bloat-scan --growth`.

## When to Load

Load this module when:

- Running `/bloat-scan --growth`
- Investigating rapid file or line count increases
- Planning capacity for skill files approaching token limits
- Preparing quarterly growth reports

## Core Metrics

### 1. File Count Velocity

Track how fast new files appear in a directory tree.

```bash
# File count per week for the last 8 weeks
for i in $(seq 0 7); do
  date=$(date -d "$((i * 7)) days ago" +%Y-%m-%d)
  count=$(git log --until="$date" --diff-filter=A \
    --name-only --pretty=format: -- "$TARGET_DIR" | \
    sort -u | wc -l)
  echo "$date $count"
done | sort
```

**Output columns:** date, cumulative file count

### 2. Line Count Velocity

Measure net line growth over recent commits.

```bash
# Net lines added per week for last 8 weeks
for i in $(seq 0 7); do
  start=$(date -d "$(( (i+1) * 7 )) days ago" +%Y-%m-%d)
  end=$(date -d "$((i * 7)) days ago" +%Y-%m-%d)
  git log --since="$start" --until="$end" \
    --numstat --pretty=format: -- "$TARGET_DIR" | \
    awk '{added+=$1; deleted+=$2}
      END {print added - deleted}'
done
```

**Negative values** indicate shrinkage (good after cleanup).

### 3. Commit Frequency

Count commits touching a path over rolling windows.

```bash
# Commits per week for last 8 weeks
for i in $(seq 0 7); do
  start=$(date -d "$(( (i+1) * 7 )) days ago" +%Y-%m-%d)
  end=$(date -d "$((i * 7)) days ago" +%Y-%m-%d)
  count=$(git log --since="$start" --until="$end" \
    --oneline -- "$TARGET_DIR" | wc -l)
  echo "week-$i: $count commits"
done
```

### 4. Size Snapshot

Current state measurement for the target path.

```bash
# Total lines in tracked files (exclude cache dirs)
git ls-files -- "$TARGET_DIR" | \
  grep -v -E '(\.venv|__pycache__|node_modules|\.git)' | \
  xargs wc -l 2>/dev/null | tail -1
```

## 30-Day Forecast

Use simple linear regression on the last 8 weekly
data points to project 30 days forward.

### Algorithm

```python
def forecast_30d(weekly_counts):
    """
    Linear least-squares fit on weekly data.
    Returns projected value 4.3 weeks from now.
    """
    n = len(weekly_counts)
    if n < 3:
        return None  # Not enough data

    xs = list(range(n))
    x_mean = sum(xs) / n
    y_mean = sum(weekly_counts) / n

    numerator = sum(
        (x - x_mean) * (y - y_mean)
        for x, y in zip(xs, weekly_counts)
    )
    denominator = sum((x - x_mean) ** 2 for x in xs)

    if denominator == 0:
        return y_mean  # Flat line

    slope = numerator / denominator
    intercept = y_mean - slope * x_mean

    # 30 days = ~4.3 weeks beyond last data point
    future_x = (n - 1) + 4.3
    return slope * future_x + intercept
```

### Interpreting Forecasts

- **Slope > 0**: Growing. Report weekly rate.
- **Slope ~ 0**: Stable. No action needed.
- **Slope < 0**: Shrinking. Recent cleanup likely working.

Report the R-squared value when possible.
Low R-squared (< 0.5) means the trend is noisy
and the forecast is unreliable.

## Threshold Crossing Predictions

Given a target limit (e.g., 500-line skill file limit),
calculate when the current growth rate will cross it.

### Algorithm

```python
def weeks_until_threshold(current_size, weekly_rate, limit):
    """
    Returns weeks until current_size reaches limit
    at the given weekly_rate.
    Returns None if rate <= 0 (will never cross).
    """
    if weekly_rate <= 0:
        return None
    remaining = limit - current_size
    if remaining <= 0:
        return 0  # Already exceeded
    return remaining / weekly_rate
```

### Default Thresholds

| Target | Limit | Rationale |
|--------|-------|-----------|
| Skill file | 500 lines | Progressive loading boundary |
| Module file | 300 lines | Single-responsibility cap |
| Python source | 500 lines | God class indicator |
| Markdown doc | 300 lines | Reader attention limit |

Override thresholds with `--threshold <lines>`.

## Urgency Rankings

Rank directories or files by how soon they will
need attention.

### Scoring Formula

```
urgency = growth_rate * (current_size / threshold) * recency_weight
```

Where:

- `growth_rate`: Lines per week (normalized 0-1)
- `current_size / threshold`: How close to the limit (0-1+)
- `recency_weight`: 1.5 if accelerating, 1.0 if steady,
  0.5 if decelerating

### Urgency Categories

| Category | Score Range | Action |
|----------|------------|--------|
| Critical | > 0.8 | Modularize or split now |
| High | 0.5 - 0.8 | Plan optimization this sprint |
| Medium | 0.2 - 0.5 | Add to backlog |
| Low | < 0.2 | No action needed |

### Acceleration Detection

Compare the growth rate of the last 4 weeks against
the preceding 4 weeks.

```python
def detect_acceleration(weekly_rates):
    if len(weekly_rates) < 8:
        return "insufficient_data"
    recent = sum(weekly_rates[-4:]) / 4
    earlier = sum(weekly_rates[-8:-4]) / 4
    if earlier == 0:
        return "new_growth" if recent > 0 else "stable"
    ratio = recent / earlier
    if ratio > 1.5:
        return "accelerating"
    elif ratio < 0.5:
        return "decelerating"
    return "steady"
```

## Output Format

### Terminal Report

```
=== Growth Analysis: plugins/conserve/skills/ ===

Current State:
  Files:  47
  Lines:  8,234
  Avg:    175 lines/file

30-Day Forecast:
  Files:  +5  (52 projected)
  Lines:  +820 (9,054 projected)
  Rate:   ~205 lines/week

Threshold Alerts:
  bloat-detector/SKILL.md    412/500 lines  ~4 weeks to limit
  context-optimization.md    289/300 lines  ~1 week to limit  [!]

Urgency Rankings:
  [CRITICAL] context-optimization.md   0.92
  [HIGH]     bloat-detector/SKILL.md   0.67
  [MEDIUM]   token-conservation.md     0.34
  [LOW]      performance-monitoring.md 0.11
```

### Machine-Readable Output

```yaml
growth_analysis:
  target: plugins/conserve/skills/
  snapshot:
    files: 47
    lines: 8234
    date: "2026-03-10"
  forecast_30d:
    files: 52
    lines: 9054
    confidence: 0.78
  weekly_rate:
    files: 1.2
    lines: 205
  threshold_alerts:
    - path: context-optimization.md
      current: 289
      limit: 300
      weeks_remaining: 1
      urgency: critical
    - path: bloat-detector/SKILL.md
      current: 412
      limit: 500
      weeks_remaining: 4
      urgency: high
  rankings:
    - path: context-optimization.md
      urgency: 0.92
      category: critical
      acceleration: accelerating
    - path: bloat-detector/SKILL.md
      urgency: 0.67
      category: high
      acceleration: steady
```

## Integration with Bloat Scan

Growth analysis feeds into the bloat detection pipeline:

- **Fast-growing files** get flagged for proactive review
  before they become bloated
- **Threshold alerts** trigger modularization suggestions
  from the `remediation-types` module
- **Urgency rankings** prioritize the bloat scan report's
  findings list

### Coordination with Other Modules

- `quick-scan`: Growth data adds time dimension to
  size-based findings
- `git-history-analysis`: Shares git log data;
  growth-analysis focuses on trends while
  git-history focuses on staleness and churn
- `remediation-types`: Growth-triggered items map to
  REFACTOR (split) or ARCHIVE (stabilize) actions

## Limitations

- Requires at least 3 weeks of git history for
  meaningful forecasts
- Linear projection does not capture seasonal patterns
  or burst development cycles
- Merge commits can skew line counts; use `--no-merges`
  when possible
- Renamed files appear as delete + add, inflating
  apparent growth
