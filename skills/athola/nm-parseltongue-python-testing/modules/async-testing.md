---
name: async-testing
description: Testing asynchronous Python code with pytest-asyncio including async fixtures and concurrent operation testing
category: testing
tags: [python, pytest, async, asyncio, pytest-asyncio, concurrent]
dependencies: [unit-testing, fixtures-and-mocking]
estimated_tokens: 275
---

# Async Testing

Patterns for testing asynchronous Python code with pytest-asyncio.

## Table of Contents

- [Basic Async Tests](#basic-async-tests)
- [Async Fixtures](#async-fixtures)
- [Testing Concurrent Operations](#testing-concurrent-operations)
- [Mocking Async Functions](#mocking-async-functions)
- [Testing Timeouts](#testing-timeouts)
- [Testing Exception Handling](#testing-exception-handling)
- [Async Context Managers](#async-context-managers)
- [Async Generators](#async-generators)
- [Configuration](#configuration)
- [Best Practices](#best-practices)
- [Common Pitfalls](#common-pitfalls)

## Basic Async Tests

Test async functions using `pytest.mark.asyncio`:

```python
import pytest

@pytest.mark.asyncio
async def test_async_function():
    result = await async_operation()
    assert result == "success"
```

Verify: Run `pytest tests/test_async.py -v` to execute async tests.

## Async Fixtures

Create async fixtures for setup/teardown:

```python
import pytest
from typing import AsyncGenerator

@pytest.fixture
async def async_client() -> AsyncGenerator[AsyncClient, None]:
    """Async fixture with setup and teardown."""
    client = AsyncClient()
    await client.connect()
    yield client
    await client.disconnect()

@pytest.mark.asyncio
async def test_with_async_client(async_client):
    response = await async_client.get("/users")
    assert response.status == 200
```

Verify: Run `pytest tests/test_async_fixtures.py -v` to test async fixtures with proper setup/teardown.

## Testing Concurrent Operations

Test multiple async operations:

```python
import asyncio
import pytest

@pytest.mark.asyncio
async def test_concurrent_requests():
    async with AsyncAPIClient() as client:
        tasks = [
            client.get_user(1),
            client.get_user(2),
            client.get_user(3),
        ]
        results = await asyncio.gather(*tasks)
        assert len(results) == 3
        assert all(r is not None for r in results)
```

## Mocking Async Functions

Mock async dependencies:

```python
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
@patch("aiohttp.ClientSession.get")
async def test_async_api_call(mock_get):
    mock_response = AsyncMock()
    mock_response.json.return_value = {"id": 1, "name": "Test"}
    mock_get.return_value.__aenter__.return_value = mock_response

    client = AsyncAPIClient()
    user = await client.get_user(1)

    assert user["id"] == 1
```

## Testing Timeouts

Test timeout behavior:

```python
@pytest.mark.asyncio
async def test_operation_timeout():
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(slow_operation(), timeout=0.1)
```

## Testing Exception Handling

Test async exception handling:

```python
@pytest.mark.asyncio
async def test_async_error_handling():
    client = AsyncAPIClient()

    with pytest.raises(ValueError, match="Invalid user ID"):
        await client.get_user(-1)
```

## Async Context Managers

Test async context managers:

```python
@pytest.mark.asyncio
async def test_async_context_manager():
    async with DatabaseConnection() as conn:
        result = await conn.execute("SELECT 1")
        assert result == [(1,)]
```

## Async Generators

Test async generators:

```python
@pytest.mark.asyncio
async def test_async_generator():
    results = []
    async for item in async_stream():
        results.append(item)
        if len(results) >= 3:
            break

    assert len(results) == 3
```

## Configuration

Add to `pyproject.toml`:

```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"  # Automatically detect async tests
```

## Best Practices

1. **Use `asyncio_mode = "auto"`** - Automatically detect async tests
2. **Clean up resources** - Use async fixtures for proper teardown
3. **Test concurrency** - Verify behavior under concurrent execution
4. **Mock async dependencies** - Use `AsyncMock` for async mocks
5. **Test timeout scenarios** - Verify timeout handling
6. **Avoid mixing sync/async** - Keep async tests separate from sync tests

## Common Pitfalls

```python
# Bad: Forgetting await
@pytest.mark.asyncio
async def test_bad():
    result = async_function()  # Returns coroutine, not result
    assert result == "success"  # Fails

# Good: Awaiting properly
@pytest.mark.asyncio
async def test_good():
    result = await async_function()
    assert result == "success"
```

```python
# Bad: Not awaiting in fixture
@pytest.fixture
async def bad_fixture():
    client = AsyncClient()
    client.connect()  # Missing await
    yield client

# Good: Awaiting in fixture
@pytest.fixture
async def good_fixture():
    client = AsyncClient()
    await client.connect()
    yield client
    await client.disconnect()
```
