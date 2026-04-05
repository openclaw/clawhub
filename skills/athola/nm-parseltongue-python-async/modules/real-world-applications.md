---
name: real-world-applications
description: Real-world async applications including web scraping and database operations
category: async
tags: [python, async, aiohttp, web-scraping, database, real-world]
dependencies: [basic-patterns, concurrency-control]
estimated_tokens: 220
---

# Real-World Applications

## Web Scraping with aiohttp

Efficiently scrape multiple URLs concurrently.

```python
import aiohttp
import asyncio

async def fetch_url(session: aiohttp.ClientSession, url: str) -> dict:
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as response:
            text = await response.text()
            return {"url": url, "status": response.status, "length": len(text)}
    except Exception as e:
        return {"url": url, "error": str(e)}

async def scrape_urls(urls: list[str]) -> list[dict]:
    async with aiohttp.ClientSession() as session:
        tasks = [fetch_url(session, url) for url in urls]
        return await asyncio.gather(*tasks)
```

## Async Database Operations

Fetch related data concurrently for improved performance.

```python
async def get_user_data(db, user_id: int) -> dict:
    # Fetch related data concurrently
    user_task = db.fetch_one(f"SELECT * FROM users WHERE id = {user_id}")
    orders_task = db.execute(f"SELECT * FROM orders WHERE user_id = {user_id}")
    profile_task = db.fetch_one(f"SELECT * FROM profiles WHERE user_id = {user_id}")

    user, orders, profile = await asyncio.gather(user_task, orders_task, profile_task)

    return {"user": user, "orders": orders, "profile": profile}
```

## Best Practices

- Reuse `ClientSession` for multiple requests
- Implement proper timeouts for HTTP requests
- Handle exceptions for individual operations
- Use connection pooling for database operations
- Fetch related data concurrently instead of sequentially
- Respect rate limits with semaphores
