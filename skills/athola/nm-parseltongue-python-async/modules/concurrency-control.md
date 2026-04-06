---
name: concurrency-control
description: Semaphores and locks for controlling concurrent async operations
category: async
tags: [python, async, semaphore, locks, rate-limiting, synchronization]
dependencies: [basic-patterns]
estimated_tokens: 220
---

# Concurrency Control

## Pattern 9: Semaphore for Rate Limiting

Semaphores limit the number of concurrent operations, essential for API rate limiting and resource management.

```python
import asyncio

async def api_call(url: str, semaphore: asyncio.Semaphore) -> dict:
    async with semaphore:
        print(f"Calling {url}")
        await asyncio.sleep(0.5)
        return {"url": url, "status": 200}

async def rate_limited_requests(urls: list[str], max_concurrent: int = 5):
    semaphore = asyncio.Semaphore(max_concurrent)
    tasks = [api_call(url, semaphore) for url in urls]
    results = await asyncio.gather(*tasks)
    return results
```

## Pattern 10: Async Locks

Locks validate exclusive access to shared resources in async code.

```python
class AsyncCounter:
    def __init__(self):
        self.value = 0
        self.lock = asyncio.Lock()

    async def increment(self):
        async with self.lock:
            current = self.value
            await asyncio.sleep(0.01)
            self.value = current + 1

    async def get_value(self) -> int:
        async with self.lock:
            return self.value
```

## Cost Awareness

Python's GIL serializes CPU-bound threads, but
contention costs still apply to asyncio locks:

- **Uncontended lock**: Near-zero cost (no kernel
  involvement, just a Python attribute check)
- **Contended lock**: Coroutine suspension and
  event-loop rescheduling (~microseconds)
- **Semaphore with backpressure**: Bounded queue depth
  prevents memory growth under burst load

For CPU-bound parallelism, use `multiprocessing` or
`concurrent.futures.ProcessPoolExecutor` to bypass
the GIL entirely. With free-threaded Python (3.13t+),
the native concurrency cost hierarchy applies: prefer
per-thread state over shared atomics over contended
locks.

## Usage Notes

- Use semaphores for limiting concurrent operations
  (API calls, connections)
- Use locks for protecting shared state
- Always use context managers (`async with`) for
  proper cleanup
- Choose appropriate limits based on resource
  constraints
