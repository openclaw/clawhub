---
name: estimation-patterns
description: Patterns for estimating resource consumption before operations
estimated_tokens: 450
---

# Estimation Patterns

## Token Estimation

### File-Based Estimation

```python
# Tokens per character ratios by file type
TOKEN_RATIOS = {
    "code": 3.2,      # .py, .js, .ts, .go, .rs
    "json": 3.6,      # .json, .yaml, .toml
    "text": 4.2,      # .md, .txt, .rst
    "default": 4.0
}

def estimate_file_tokens(path: Path) -> int:
    """Estimate tokens for a file."""
    size = path.stat().st_size
    suffix = path.suffix.lower()

    if suffix in [".py", ".js", ".ts", ".go", ".rs"]:
        ratio = TOKEN_RATIOS["code"]
    elif suffix in [".json", ".yaml", ".yml", ".toml"]:
        ratio = TOKEN_RATIOS["json"]
    else:
        ratio = TOKEN_RATIOS["text"]

    return int(size / ratio)
```

### Task-Based Estimation

| Task Type | Input Tokens | Output Tokens |
|-----------|--------------|---------------|
| File analysis | 15-50/file | 200-500 |
| Code summarization | 1-3% of source | 300-800 |
| Pattern extraction | 5-20/match | 100-300 |
| Boilerplate generation | 50-200/template | Varies |

## Cost Estimation

### Cost Calculation

```python
def estimate_cost(
    input_tokens: int,
    output_tokens: int,
    model: str
) -> float:
    """Estimate cost in USD."""
    rates = {
        "gemini-pro": {"input": 0.50, "output": 1.50},
        "gemini-flash": {"input": 0.075, "output": 0.30},
        "qwen-max": {"input": 0.40, "output": 1.20},
    }

    rate = rates.get(model, rates["gemini-pro"])
    input_cost = (input_tokens / 1_000_000) * rate["input"]
    output_cost = (output_tokens / 1_000_000) * rate["output"]

    return input_cost + output_cost
```

### Cost Thresholds

| Category | Cost Range | Example Operations |
|----------|------------|-------------------|
| Low | <$0.01 | Pattern counting, imports extraction |
| Medium | $0.01-$0.10 | Module summarization, code analysis |
| High | >$0.10 | Full codebase review, documentation |

## Pre-Flight Checks

### Estimation Workflow

```python
def preflight_check(files: list[Path], prompt: str) -> dict:
    """Estimate resources before operation."""
    input_tokens = sum(estimate_file_tokens(f) for f in files)
    input_tokens += len(prompt) // 4  # Prompt tokens

    output_tokens = estimate_output_tokens(task_type)
    cost = estimate_cost(input_tokens, output_tokens, model)

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "estimated_cost": cost,
        "within_quota": can_handle_task(input_tokens)
    }
```
