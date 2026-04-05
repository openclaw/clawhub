---
name: architecture-paradigm-serverless
description: |
  Apply serverless FaaS patterns for event-driven workloads with minimal infrastructure
version: 1.8.1
triggers:
  - architecture
  - serverless
  - faas
  - event-driven
  - cost-optimization
  - cost scales with usage
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/archetypes", "emoji": "\ud83c\udfd7\ufe0f"}}
source: claude-night-market
source_plugin: archetypes
---

> **Night Market Skill** — ported from [claude-night-market/archetypes](https://github.com/athola/claude-night-market/tree/master/plugins/archetypes). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# The Serverless Architecture Paradigm


## When To Use

- Event-driven workloads with variable traffic
- Minimizing operational overhead for cloud-native apps

## When NOT To Use

- Long-running processes exceeding function timeout limits
- Applications requiring persistent connections or local state

## When to Employ This Paradigm
- When workloads are event-driven and exhibit intermittent or "bursty" traffic patterns.
- When the goal is to minimize infrastructure management and adopt a pay-per-execution cost model.
- When latency constraints from "cold starts" are acceptable for the use case or can be effectively mitigated.

## Adoption Steps
1. **Identify Functions**: Decompose workloads into small, stateless function handlers triggered by events such as HTTP requests, message queues, or scheduled timers.
2. **Externalize State**: use managed services like databases and queues for all persistent state. Design handlers to be idempotent to validate that repeated executions do not have unintended side effects.
3. **Plan Cold-Start Mitigation**: For latency-sensitive paths, keep function dependencies minimal. Employ strategies such as provisioned concurrency or "warmer" functions to reduce cold-start times.
4. **Implement Instrumentation and Security**: Enable detailed tracing and logging for all functions. Adhere to the principle of least privilege with IAM roles and set per-function budgets to control costs.
5. **Automate Deployment**: Use Infrastructure-as-Code (IaC) frameworks like SAM, CDK, or Terraform to create repeatable and reliable release processes.

## Key Deliverables
- An Architecture Decision Record (ADR) that describes function triggers, runtime choices, state management strategies, and cost projections.
- A complete Infrastructure-as-Code (IaC) and CI/CD pipeline for automatically packaging and deploying functions.
- Observability dashboards to monitor key metrics including function duration, error rates, cold-start frequency, and cost.

## Risks & Mitigations
- **Vendor Lock-in**:
  - **Mitigation**: Where feasible, abstract away provider-specific APIs behind your own interfaces or adopt portable frameworks (e.g., Serverless Framework) to reduce dependency on a single cloud vendor.
- **Debugging Challenges**:
  - **Mitigation**: Tracing execution across distributed functions can be complex. Standardize on specific instrumentation libraries and structured logging to simplify debugging.
- **Resource Limits**:
  - **Mitigation**: Actively monitor provider-imposed limits, such as concurrency and memory quotas. Design workloads to be shardable or horizontally scalable to stay within these constraints.
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
