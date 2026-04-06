---
module: metrics
category: tracking
dependencies: [Read, Bash]
estimated_tokens: 500
---

# Historical Metrics Tracking

Store scan results over time to detect regressions and measure cleanup progress.

## Storage Location

Write scan records to `.slop-history/` at the repo root. Add this directory to `.gitignore`:

```
.slop-history/
```

## File Naming

One JSON file per scan:

```
.slop-history/scan-YYYY-MM-DD-HHMMSS.json
```

Example: `.slop-history/scan-2026-03-01-143022.json`

Generate the timestamp with:

```python
from datetime import datetime
datetime.now().strftime("%Y-%m-%d-%H%M%S")
```

## JSON Schema

```json
{
  "timestamp": "2026-03-01T14:30:22",
  "files_scanned": 12,
  "scores": [
    {"path": "docs/guide.md", "score": 1.4, "word_count": 320}
  ],
  "summary": {
    "avg_score": 1.4,
    "max_score": 3.1,
    "total_markers": 18
  }
}
```

All fields are required. Use `datetime.isoformat()` for the timestamp string.

## Saving Results (`--track`)

When the `--track` flag is present, write a record after every scan:

1. Build the `scores` list from the per-file results.
2. Compute `summary.avg_score` as the mean of all scores (0.0 if no files).
3. Compute `summary.max_score` as the maximum score (0.0 if no files).
4. Count `summary.total_markers` as the sum of all raw marker hits across files.
5. Write the JSON file to `.slop-history/` using the timestamp name.
6. Report the path written: `Saved: .slop-history/scan-YYYY-MM-DD-HHMMSS.json`

## Loading History (`--history`)

When the `--history` flag is present, read all files in `.slop-history/` sorted by
filename (chronological order) and print a trend table:

```
Date                 Files  Avg Score  Delta
2026-02-15-090000       10       1.20      —
2026-02-22-143000       12       1.45  +0.25
2026-03-01-143022       12       1.90  +0.45
```

Column widths: date 20, files 6, avg score 10, delta 8.
Use `—` for the delta on the first row. Prefix positive deltas with `+`.

## Regression Warning

After printing the trend table, check the two most recent records. If
`avg_score` increased by more than 0.5:

```
WARNING: avg score increased by 0.62 since last scan (1.28 -> 1.90)
```

This warning also fires when `--track` saves a new result and the previous
record exists. Compare the new avg against the most recent existing record
before writing.
