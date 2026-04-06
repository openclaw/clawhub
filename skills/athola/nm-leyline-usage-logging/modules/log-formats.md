---
name: log-formats
description: Structured log formats and schemas for usage logging
estimated_tokens: 300
---

# Log Formats

## JSONL Schema

### Standard Entry
```json
{
  "timestamp": "ISO-8601 datetime",
  "session_id": "session_UNIX_TIMESTAMP",
  "service": "service-name",
  "operation": "operation-name",
  "tokens": 0,
  "success": true,
  "duration_seconds": 0.0,
  "metadata": {}
}
```

### Error Entry
```json
{
  "timestamp": "ISO-8601 datetime",
  "session_id": "session_xxx",
  "service": "service-name",
  "operation": "operation-name",
  "tokens": 0,
  "success": false,
  "error_type": "RateLimitError",
  "error_message": "Rate limit exceeded",
  "duration_seconds": 0.5
}
```

## Metadata Patterns

### File Operations
```json
{
  "metadata": {
    "files_processed": 10,
    "total_bytes": 50000,
    "file_types": [".py", ".md"]
  }
}
```

### API Operations
```json
{
  "metadata": {
    "model": "gemini-2.5-pro",
    "input_tokens": 5000,
    "output_tokens": 1000,
    "temperature": 0.7
  }
}
```

## Query Patterns

### By Time Range
```bash
# Last 24 hours
jq 'select(.timestamp > "2025-12-04")' usage.jsonl

# Specific date
grep "2025-12-05" usage.jsonl | jq .
```

### By Success/Failure
```bash
# Failures only
jq 'select(.success == false)' usage.jsonl

# Success rate
jq -s '[.[] | .success] | add / length' usage.jsonl
```

### By Token Usage
```bash
# High token operations
jq 'select(.tokens > 10000)' usage.jsonl

# Total tokens
jq -s '[.[] | .tokens] | add' usage.jsonl
```
