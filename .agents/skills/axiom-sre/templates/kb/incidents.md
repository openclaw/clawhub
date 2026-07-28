# Incidents

Past incident summaries, learnings, and playbooks.

---

<!-- Example:

## M-2025-01-05T16:00:00Z INC-1234 orders-api-outage

- type: incident
- tags: orders, database, connection-pool
- used: 2
- last_used: 2025-01-18
- pinned: false
- schema_version: 1

**Summary**

30-minute outage of orders-api due to database connection pool exhaustion.

**Impact**

- Duration: 14:30 - 15:00 UTC (30 min)
- Affected: All checkout attempts (~2,500 users)
- Revenue impact: ~$50k in lost orders

**Timeline**

- 14:30 - PagerDuty alert: orders-api error rate >5%
- 14:35 - Confirmed 503s, started investigation
- 14:45 - Found "connection pool exhausted" in logs
- 14:50 - Restarted pods (temporary mitigation)
- 15:00 - Identified root cause: connection leak in payment handler
- 15:15 - Hotfix deployed

**Root Cause**

Connection leak in payment confirmation handler. On error path, database connection was not released. Flash sale traffic exhausted pool in ~30 min.

**Key Queries**

| Finding | Query | Link |
|---------|-------|------|
| Pool exhaustion pattern | `['orders-logs'] \| where message has_cs "connection pool" \| summarize count() by bin_auto(_time)` | [View in Axiom](https://app.axiom.co/org-id/query?initForm=...) |

**Learnings**

- Add connection pool metrics to dashboard
- Review all error paths for resource cleanup
- Pattern added: connection-pool-exhaustion

**Action Items**

- [x] Fix connection leak (PR #1234)
- [x] Add pool exhaustion alert
- [ ] Add integration test for error path cleanup

---

## M-2024-12-15T10:00:00Z INC-1200 auth-redis-failover (summarized)

- type: incident
- tags: auth, redis, failover
- used: 1
- last_used: 2024-12-20
- pinned: false
- schema_version: 1

**Summary**

3-minute auth outage during Redis failover. Sentinel timeout too aggressive.

**Key Learning**

Redis sentinel failover can cause brief auth outages. Added circuit breaker with cached token validation.

**Full Details**

See archive/incidents.md#M-2024-12-15T10:00:00Z

-->
