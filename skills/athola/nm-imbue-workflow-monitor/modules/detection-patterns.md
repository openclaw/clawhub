# Detection Patterns

Patterns for detecting workflow errors and inefficiencies.

## Error Patterns

### Command Failure

```bash
# Detection: Exit code > 0
command_output=$(some_command 2>&1)
exit_code=$?
if [ $exit_code -ne 0 ]; then
  echo "ERROR: Command failed with exit code $exit_code"
fi
```

**Signals:**
- Non-zero exit code
- stderr output containing "error", "failed", "exception"
- Traceback patterns in output

### Timeout Events

```bash
# Detection: Command exceeds timeout
timeout 120 some_long_command
if [ $? -eq 124 ]; then
  echo "TIMEOUT: Command exceeded 120s limit"
fi
```

**Signals:**
- Exit code 124 (timeout)
- "timed out" in output
- Session timeout warnings

### Retry Loops

**Detection:** Same command executed more than 3 times in a session.

```python
def detect_retry_loop(commands: list[str]) -> bool:
    """Detect if same command is retried excessively."""
    from collections import Counter
    counts = Counter(commands)
    return any(count > 3 for count in counts.values())
```

**Signals:**
- Repeated identical commands
- Similar commands with minor variations
- "retrying" patterns in output

### Context Exhaustion

**Detection:** Context usage exceeds threshold.

**Signals:**
- "/context" shows >90% usage
- Truncation warnings
- "context limit" messages

## Efficiency Patterns

### Verbose Output

**Detection:** Command produces excessive output.

```bash
# Check output line count
output_lines=$(some_command | wc -l)
if [ $output_lines -gt 500 ]; then
  echo "WARNING: Verbose output ($output_lines lines)"
  echo "Suggestion: Use --quiet or redirect to file"
fi
```

**Common offenders:**
- `npm install` without `--silent`
- `pip install` without `--quiet`
- `git log` without `-n` limit
- `find` without `| head`

### Redundant File Reads

**Detection:** Same file read multiple times.

```python
def detect_redundant_reads(read_events: list[dict]) -> list[str]:
    """Find files read more than twice."""
    from collections import Counter
    file_counts = Counter(e["file_path"] for e in read_events)
    return [f for f, count in file_counts.items() if count > 2]
```

**Suggestions:**
- Cache file contents in variables
- Use Read tool with offset/limit for large files
- Batch related reads together

### Sequential vs Parallel

**Detection:** Independent operations run sequentially.

```python
def detect_parallelizable(operations: list[dict]) -> bool:
    """Check if operations could be parallelized."""
    # Operations are independent if:
    # - No data dependencies between them
    # - Different target files/resources
    # - No ordering requirements
    pass
```

**Examples:**
- Multiple independent `gh` API calls
- Reading unrelated files
- Running independent tests

### Over-Fetching

**Detection:** Large file read when only portion needed.

**Signals:**
- Full file read followed by small extraction
- Large files read without offset/limit
- Regex search on entire file content

## Severity Classification

| Pattern | Default Severity | Context-Dependent |
|---------|-----------------|-------------------|
| Command failure | High | Lower if in test context |
| Timeout | High | Medium if expected long |
| Retry loop | Medium | High if >5 retries |
| Context exhaustion | Medium | High if mandatory phases pending |
| Verbose output | Low | Medium if >1000 lines |
| Redundant reads | Low | Medium if >5 reads |

## Evidence Collection

For each detected pattern, collect:

1. **Command/action** - What was executed
2. **Output** - Full or relevant excerpt
3. **Timing** - When it occurred, duration
4. **Context** - What was happening before/after
5. **Severity** - Based on classification above

Format as evidence log entry:

```json
{
  "id": "E1",
  "type": "command_failure",
  "severity": "high",
  "command": "npm test",
  "exit_code": 1,
  "output_excerpt": "FAIL src/test.js\n  Test failed: expected...",
  "timestamp": "2025-01-14T10:30:00Z",
  "context": "Running validation phase"
}
```
