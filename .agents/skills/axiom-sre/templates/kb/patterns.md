# Patterns

Failure signatures, recurring causes, and debugging heuristics.

---

<!-- Example:

## M-2025-01-10T14:00:00Z connection-pool-exhaustion

- type: pattern
- tags: database, connection-pool, timeout
- used: 4
- last_used: 2025-01-20
- pinned: false
- schema_version: 1

**Symptoms**

- Gradual latency increase over 10-30 minutes
- Then sudden spike in 500s
- Error messages: "connection pool exhausted", "timeout acquiring connection"

**Detection Query**

```apl
['app-logs']
| where _time between (ago(1h) .. now())
| where message has_cs "connection" and message has_cs "pool"
| summarize count() by bin_auto(_time), service
```

**Common Causes**

- Connection leak (missing close/release on error path)
- Traffic spike without pool scaling
- Long-running transactions holding connections
- Slow downstream causing connections to pile up

**Resolution**

1. Immediate: Restart affected pods
2. Investigate: Check for recent deploys, traffic changes
3. Permanent: Fix leak, increase pool size, add connection timeout

**Evidence**

- 2025-01-05 (INC-1234): orders-api, caused by leak in payment handler
- 2025-01-20 (INC-1250): auth-service, traffic spike from bot

---

## M-2025-01-12T09:00:00Z ingress-config-mismatch

- type: pattern
- tags: ingress, nginx, deploy, 502
- used: 2
- last_used: 2025-01-18
- pinned: false
- schema_version: 1

**Symptoms**

- 502s immediately after deploy
- Only affects subset of pods
- NGINX logs show "upstream not found"

**Root Cause**

Ingress config reloads faster than new pods are ready. Requests route to pods that aren't serving yet.

**Resolution**

- Add readiness probes with sufficient delay
- Use rolling deploy with maxUnavailable: 0

-->
