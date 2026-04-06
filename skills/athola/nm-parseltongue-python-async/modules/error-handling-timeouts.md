---
name: error-handling-timeouts
description: Error handling, timeouts, and cancellation in async Python
category: async
tags: [python, async, error-handling, timeouts, exceptions, cancellation]
dependencies: [basic-patterns]
estimated_tokens: 280
---

# Error Handling and Timeouts

## Pattern 4: Error Handling

Handle errors gracefully in concurrent operations using try/except and gather's return_exceptions.

```python
from typing import Optional
import asyncio

async def risky_operation(item_id: int) -> dict:
    await asyncio.sleep(0.1)
    if item_id % 3 == 0:
        raise ValueError(f"Item {item_id} failed")
    return {"id": item_id, "status": "success"}

async def safe_operation(item_id: int) -> Optional[dict]:
    try:
        return await risky_operation(item_id)
    except ValueError as e:
        print(f"Error: {e}")
        return None

async def process_items(item_ids: list[int]):
    tasks = [safe_operation(iid) for iid in item_ids]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    successful = [r for r in results if r and not isinstance(r, Exception)]
    return successful
```

## Pattern 5: Timeout Handling

Prevent operations from hanging indefinitely with timeouts.

```python
async def slow_operation(delay: int) -> str:
    await asyncio.sleep(delay)
    return f"Completed after {delay}s"

async def with_timeout():
    try:
        result = await asyncio.wait_for(slow_operation(5), timeout=2.0)
        print(result)
    except asyncio.TimeoutError:
        print("Operation timed out")
```

## Handling Cancellation

Properly handle task cancellation to clean up resources.

```python
async def cancelable_task():
    try:
        while True:
            await asyncio.sleep(1)
            print("Working...")
    except asyncio.CancelledError:
        print("Cleaning up...")
        raise  # Re-raise to propagate cancellation
```

## Best Practices

- Use `return_exceptions=True` in gather() to handle errors without stopping other tasks
- Always implement timeouts for external operations
- Handle `CancelledError` and re-raise it
- Use context managers for automatic cleanup
