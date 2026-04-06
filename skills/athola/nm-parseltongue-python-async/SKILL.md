---
name: python-async
description: |
  Async Python patterns and concurrency: async APIs, I/O-bound apps, rate limiting, context managers
version: 1.8.1
triggers:
  - python
  - async
  - asyncio
  - concurrency
  - await
  - coroutines
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/parseltongue", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: parseltongue
---

> **Night Market Skill** — ported from [claude-night-market/parseltongue](https://github.com/athola/claude-night-market/tree/master/plugins/parseltongue). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Async Python Patterns

asyncio and async/await patterns for Python applications.

## Quick Start

```python
import asyncio

async def main():
    print("Hello")
    await asyncio.sleep(1)
    print("World")

asyncio.run(main())
```

## When To Use

- Building async web APIs (FastAPI, aiohttp)
- Implementing concurrent I/O operations
- Creating web scrapers with concurrent requests
- Developing real-time applications (WebSockets)
- Processing multiple independent tasks simultaneously
- Building microservices with async communication

## When NOT To Use

- CPU-bound optimization - use python-performance instead
- Testing async code - use python-testing async module

## Modules

This skill uses progressive loading. Content is organized into focused modules:

- See `modules/basic-patterns.md` - Core async/await, gather(), and task management
- See `modules/concurrency-control.md` - Semaphores and locks for rate limiting
- See `modules/error-handling-timeouts.md` - Error handling, timeouts, and cancellation
- See `modules/advanced-patterns.md` - Context managers, iterators, producer-consumer
- See `modules/testing-async.md` - Testing with pytest-asyncio
- See `modules/real-world-applications.md` - Web scraping and database operations
- See `modules/pitfalls-best-practices.md` - Common mistakes and best practices

Load specific modules based on your needs, or reference all for detailed guidance.

## Exit Criteria

- Async patterns applied correctly
- No blocking operations in async code
- Proper error handling implemented
- Rate limiting configured where needed
- Tests pass with pytest-asyncio
## Troubleshooting

### Common Issues

**RuntimeError: no current event loop**
Use `asyncio.run()` as the entry point. Avoid `get_event_loop()` in Python 3.10+.

**Blocking call in async context**
Move sync I/O to `asyncio.to_thread()` or `loop.run_in_executor()`.

**Tests hang indefinitely**
Ensure pytest-asyncio is installed and test functions are decorated with `@pytest.mark.asyncio`.
