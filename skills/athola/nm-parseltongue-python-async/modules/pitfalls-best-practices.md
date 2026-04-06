---
name: pitfalls-best-practices
description: Common pitfalls and best practices for async Python development
category: async
tags: [python, async, best-practices, pitfalls, antipatterns]
dependencies: [basic-patterns]
estimated_tokens: 300
---

# Common Pitfalls and Best Practices

## Common Pitfalls

### 1. Forgetting await
```python
# Wrong - returns coroutine object
result = async_function()

# Correct
result = await async_function()
```

### 2. Blocking the Event Loop
```python
# Wrong - blocks event loop
import time
async def bad():
    time.sleep(1)  # Blocks entire event loop!

# Correct
async def good():
    await asyncio.sleep(1)  # Non-blocking
```

### 3. Not Handling Cancellation
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

### 4. Creating Event Loops Incorrectly
```python
# Wrong - multiple event loops
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)

# Correct (Python 3.7+)
asyncio.run(main())
```

### 5. Mixing Sync and Async Code
```python
# Wrong - calling sync blocking function
async def bad():
    requests.get(url)  # Blocking!

# Correct - use async library
async def good():
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            return await response.text()
```

## Best Practices

1. **Use asyncio.run()** for entry point (Python 3.7+)
2. **Always await coroutines** to execute them
3. **Use gather()** for concurrent execution
4. **Implement proper error handling** with try/except
5. **Use timeouts** to prevent hanging operations
6. **Pool connections** for better performance
7. **Avoid blocking operations** in async code
8. **Use semaphores** for rate limiting
9. **Handle task cancellation** properly
10. **Test with pytest-asyncio**

## Performance Tips

- Reuse connections and sessions
- Use connection pools for databases
- Implement backpressure with queues
- Monitor event loop blocking with debug mode
- Profile async code to identify bottlenecks

## Debugging

```python
# Enable asyncio debug mode
import asyncio
asyncio.run(main(), debug=True)
```
