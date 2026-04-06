---
name: basic-patterns
description: Core async/await patterns for Python asyncio programming
category: async
tags: [python, async, asyncio, coroutines, tasks, gather]
dependencies: []
estimated_tokens: 250
---

# Basic Async Patterns

## Core Concepts

### 1. Event Loop
Single-threaded cooperative multitasking that schedules coroutines.

### 2. Coroutines
Functions defined with `async def` that can be paused and resumed.

### 3. Tasks
Scheduled coroutines that run concurrently on the event loop.

## Pattern 1: Basic Async/Await
```python
import asyncio

async def fetch_data(url: str) -> dict:
    await asyncio.sleep(1)  # Simulate I/O
    return {"url": url, "data": "result"}

async def main():
    result = await fetch_data("https://api.example.com")
    print(result)

asyncio.run(main())
```

## Pattern 2: Concurrent Execution with gather()
```python
async def fetch_user(user_id: int) -> dict:
    await asyncio.sleep(0.5)
    return {"id": user_id, "name": f"User {user_id}"}

async def fetch_all_users(user_ids: list[int]) -> list[dict]:
    tasks = [fetch_user(uid) for uid in user_ids]
    results = await asyncio.gather(*tasks)
    return results

async def main():
    users = await fetch_all_users([1, 2, 3, 4, 5])
    print(f"Fetched {len(users)} users concurrently")
```

## Pattern 3: Task Creation and Management
```python
async def background_task(name: str, delay: int):
    print(f"{name} started")
    await asyncio.sleep(delay)
    print(f"{name} completed")
    return f"Result from {name}"

async def main():
    # Create tasks
    task1 = asyncio.create_task(background_task("Task 1", 2))
    task2 = asyncio.create_task(background_task("Task 2", 1))

    # Do other work while tasks run
    print("Main: doing other work")
    await asyncio.sleep(0.5)

    # Wait for tasks
    result1, result2 = await asyncio.gather(task1, task2)
    print(f"Results: {result1}, {result2}")
```
