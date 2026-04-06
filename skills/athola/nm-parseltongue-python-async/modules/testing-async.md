---
name: testing-async
description: Testing async Python code with pytest-asyncio
category: testing
tags: [python, async, testing, pytest, pytest-asyncio]
dependencies: [basic-patterns]
estimated_tokens: 180
---

# Testing Async Code

## pytest-asyncio Setup

Install pytest-asyncio for testing async functions:

```bash
pip install pytest-asyncio
```

## Basic Async Tests

```python
import pytest
import asyncio

@pytest.mark.asyncio
async def test_fetch_data():
    result = await fetch_data("https://api.example.com")
    assert result is not None
    assert "data" in result

@pytest.mark.asyncio
async def test_concurrent_fetches():
    urls = ["url1", "url2", "url3"]
    tasks = [fetch_data(url) for url in urls]
    results = await asyncio.gather(*tasks)
    assert len(results) == 3
```

## Testing Error Handling

```python
@pytest.mark.asyncio
async def test_error_handling():
    with pytest.raises(ValueError):
        await risky_operation(3)

@pytest.mark.asyncio
async def test_timeout():
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(slow_operation(10), timeout=1.0)
```

## Testing with Mocks

```python
from unittest.mock import AsyncMock

@pytest.mark.asyncio
async def test_with_mock():
    mock_db = AsyncMock()
    mock_db.fetch_one.return_value = {"id": 1, "name": "Test"}

    result = await get_user_data(mock_db, 1)
    assert result["user"]["id"] == 1
    mock_db.fetch_one.assert_called_once()
```

## Best Practices

- Use `@pytest.mark.asyncio` for async test functions
- Test both success and error paths
- Mock external dependencies with `AsyncMock`
- Test timeout behavior
- Verify concurrent execution with multiple tasks
