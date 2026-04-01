---
name: oraclaw-solver
description: Industrial-grade scheduling and resource optimization for AI agents. Solve task scheduling with energy matching, budget allocation, and any LP/MIP constraint problem in milliseconds.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "📅"
    homepage: https://web-olive-one-89.vercel.app/solver
    tags:
      - scheduling
      - optimization
      - resource-allocation
      - linear-programming
      - operations-research
      - planning
    price: 0.10
    currency: USDC
---

# OraClaw Solver — AI Scheduling & Optimization

You are a planning agent that uses industrial-grade optimization (LP/MIP solver) to find optimal schedules and resource allocations.

## When to Use This Skill

Use this when the user or another agent needs to:
- Plan a daily/weekly schedule matching tasks to energy levels
- Allocate budget across competing priorities with constraints
- Solve any resource allocation problem with hard limits
- Optimize staffing, routing, or capacity planning

## How to Use

### Smart Scheduling

Call `solve_schedule` with tasks and available time slots:

```json
{
  "tasks": [
    { "id": "report", "name": "Quarterly Report", "durationMinutes": 120, "priority": 9, "energyRequired": "high" },
    { "id": "emails", "name": "Clear Inbox", "durationMinutes": 30, "priority": 3, "energyRequired": "low" },
    { "id": "code-review", "name": "Review PRs", "durationMinutes": 60, "priority": 7, "energyRequired": "medium" }
  ],
  "slots": [
    { "id": "morning", "startTime": 1711350000, "durationMinutes": 120, "energyLevel": "high" },
    { "id": "after-lunch", "startTime": 1711360800, "durationMinutes": 60, "energyLevel": "medium" },
    { "id": "late-pm", "startTime": 1711369800, "durationMinutes": 30, "energyLevel": "low" }
  ]
}
```

The solver matches high-priority tasks to high-energy slots automatically.

### Custom Constraint Optimization

Call `solve_constraints` for any optimization with constraints:

```json
{
  "direction": "maximize",
  "objective": { "ads": 2.5, "content": 1.8, "events": 3.2 },
  "variables": [
    { "name": "ads", "lower": 0, "upper": 50000 },
    { "name": "content", "lower": 0, "upper": 30000 },
    { "name": "events", "lower": 0, "upper": 20000, "type": "integer" }
  ],
  "constraints": [
    { "name": "total_budget", "coefficients": { "ads": 1, "content": 1, "events": 1 }, "upper": 80000 },
    { "name": "min_content", "coefficients": { "content": 1 }, "lower": 10000 }
  ]
}
```

## Rules

1. Tasks can only be assigned to slots with sufficient duration
2. The solver is deterministic — same input always produces same output
3. For scheduling: energy matching is automatic (high task → high slot scores best)
4. For constraints: use `"type": "integer"` for whole-number quantities, `"binary"` for yes/no decisions
5. Infeasible problems return `"status": "infeasible"` — relax constraints and retry

## Pricing

$0.10 per optimization call (USDC on Base via x402). Free tier: 3,000 calls/month with API key.
