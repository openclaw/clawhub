---
name: advanced-patterns
description: Advanced async patterns including context managers, iterators, and producer-consumer
category: async
tags: [python, async, context-managers, iterators, queues, producer-consumer]
dependencies: [basic-patterns, error-handling-timeouts]
estimated_tokens: 350
---

# Advanced Async Patterns

## Pattern 6: Async Context Managers

Implement `__aenter__` and `__aexit__` for async resource management.

```python
import asyncio

class AsyncDatabaseConnection:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self.connection = None

    async def __aenter__(self):
        print("Opening connection")
        await asyncio.sleep(0.1)  # Simulate connection
        self.connection = {"dsn": self.dsn, "connected": True}
        return self.connection

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        print("Closing connection")
        await asyncio.sleep(0.1)  # Simulate cleanup
        self.connection = None

async def query_database():
    async with AsyncDatabaseConnection("postgresql://localhost") as conn:
        print(f"Using connection: {conn}")
        await asyncio.sleep(0.2)  # Simulate query
        return {"rows": 10}
```

## Pattern 7: Async Iterators

Use `async for` to iterate over asynchronous data sources.

```python
from typing import AsyncIterator

async def fetch_pages(url: str, max_pages: int) -> AsyncIterator[dict]:
    for page in range(1, max_pages + 1):
        await asyncio.sleep(0.2)  # Simulate API call
        yield {
            "page": page,
            "url": f"{url}?page={page}",
            "data": [f"item_{page}_{i}" for i in range(5)]
        }

async def consume_pages():
    async for page_data in fetch_pages("https://api.example.com", 3):
        print(f"Page {page_data['page']}: {len(page_data['data'])} items")
```

## Pattern 8: Producer-Consumer

Decouple producers and consumers using async queues.

```python
from asyncio import Queue

async def producer(queue: Queue, producer_id: int, num_items: int):
    for i in range(num_items):
        item = f"Item-{producer_id}-{i}"
        await queue.put(item)
        print(f"Producer {producer_id}: {item}")
        await asyncio.sleep(0.1)
    await queue.put(None)  # Signal completion

async def consumer(queue: Queue, consumer_id: int):
    while True:
        item = await queue.get()
        if item is None:
            queue.task_done()
            break
        print(f"Consumer {consumer_id} processing: {item}")
        await asyncio.sleep(0.2)
        queue.task_done()
```

## Usage Notes

- Context managers validate proper resource cleanup
- Async iterators enable memory-efficient streaming
- Queues decouple producers from consumers
- Always signal completion in producer-consumer patterns
