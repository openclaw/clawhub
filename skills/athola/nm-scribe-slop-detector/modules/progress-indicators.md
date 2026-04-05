---
module: progress-indicators
category: ux
dependencies: [Bash]
estimated_tokens: 500
---

# Progress Indicators

Instructions for displaying progress when scanning multiple files.

## When to Show Progress

Skip progress output entirely for single files or pairs of files. Show progress
when scanning 3 or more files. This avoids noise for the common single-file case.

| File count | Default behavior |
|------------|-----------------|
| 1-2 | No progress output |
| 3+ | Show file count progress |

## Output Modes

Three modes control what gets printed during a scan.

### Default Mode

Show a counter line for each file as it is processed:

```
[1/49] Scanning plugins/scribe/README.md...
[2/49] Scanning plugins/scribe/SKILL.md...
...
[49/49] Scanning plugins/abstract/README.md...

Scanned 49 files in 3.2s
```

Format for each progress line:

```
[{current}/{total}] Scanning {filepath}...
```

Format for the completion summary:

```
Scanned {total} files in {elapsed:.1f}s
```

### Quiet Mode (`--quiet`)

Suppress all progress output. Print only the final report. Use this in CI
pipelines and scripts where progress lines would pollute logs.

No per-file lines. No summary line. Only the report.

### Verbose Mode (`--verbose`)

Print the per-file slop score immediately after each file is processed:

```
[1/49] Scanning plugins/scribe/README.md... score=2.1 (Light)
[2/49] Scanning plugins/scribe/SKILL.md... score=0.4 (Clean)
...

Scanned 49 files in 3.2s
```

Score label mapping:

| Score range | Label |
|-------------|-------|
| 0 - 1.0 | Clean |
| 1.0 - 2.5 | Light |
| 2.5 - 5.0 | Moderate |
| 5.0+ | Heavy |

## Implementation Notes

- Write progress lines to stdout so they can be redirected or captured.
- Compute elapsed time from scan start to the final file completion.
- Round elapsed time to one decimal place.
- Use 1-based indexing in the counter (`[1/49]`, not `[0/49]`).
- If a file cannot be read, print a warning on that line and continue:

```
[7/49] Scanning path/to/file.md... WARNING: could not read file
```

Do not abort the scan on a single unreadable file.
