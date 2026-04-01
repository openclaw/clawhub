---
name: oraclaw-pathfind
description: A* pathfinding and task sequencing for AI agents. Find the optimal path through workflows, dependencies, and decision trees. K-shortest paths via Yen's algorithm. Cost/time/risk breakdown.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "🗺️"
    homepage: https://web-olive-one-89.vercel.app/pathfind
    tags:
      - pathfinding
      - routing
      - workflow
      - dependencies
      - critical-path
      - task-sequencing
      - astar
    price: 0.03
    currency: USDC
---

# OraClaw Pathfind — Workflow Navigation for Agents

You are a pathfinding agent that finds optimal routes through task graphs, dependency networks, and decision trees using A* with configurable heuristics.

## When to Use This Skill

Use when the user or agent needs to:
- Find the fastest/cheapest/safest path through a task dependency graph
- Sequence tasks optimally considering time, cost, and risk
- Find K alternative paths (not just the best one)
- Navigate complex workflows with multiple routes to completion
- Plan project execution order with dependency constraints

## Tool: `plan_pathfind`

```json
{
  "nodes": [
    { "id": "start", "cost": 0 },
    { "id": "design", "cost": 5, "time": 3, "risk": 0.1 },
    { "id": "build", "cost": 20, "time": 10, "risk": 0.3 },
    { "id": "test", "cost": 8, "time": 5, "risk": 0.1 },
    { "id": "deploy", "cost": 3, "time": 1, "risk": 0.2 },
    { "id": "done", "cost": 0 }
  ],
  "edges": [
    { "from": "start", "to": "design", "cost": 5 },
    { "from": "design", "to": "build", "cost": 20 },
    { "from": "design", "to": "test", "cost": 8 },
    { "from": "build", "to": "test", "cost": 8 },
    { "from": "build", "to": "deploy", "cost": 3 },
    { "from": "test", "to": "deploy", "cost": 3 },
    { "from": "deploy", "to": "done", "cost": 0 }
  ],
  "start": "start",
  "end": "done",
  "heuristic": "cost",
  "kPaths": 3
}
```

Returns: optimal path + cost breakdown + K alternative routes.

## Heuristics

- `cost` — Minimize total monetary cost
- `time` — Minimize total time
- `risk` — Minimize cumulative risk
- `weighted` — Balanced (default: equal weight to cost/time/risk)
- `zero` — Dijkstra (no heuristic, guaranteed shortest)

## Rules

1. All edges are directed (A→B doesn't mean B→A unless you add both)
2. Edge costs must be non-negative (A* requires this)
3. K-shortest paths uses Yen's algorithm — set kPaths=1 for just the best path
4. If no path exists between start and end, returns empty path with Infinity cost
5. Risk values should be 0-1 probabilities; they're summed along the path

## Pricing

$0.03 per pathfinding query. USDC on Base via x402. Free tier: 3,000 calls/month.
