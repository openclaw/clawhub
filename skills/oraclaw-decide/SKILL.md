---
name: oraclaw-decide
description: Decision intelligence for AI agents. Analyze options, map decision dependencies with PageRank, detect when information sources conflict, and find the choices that matter most.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "🎯"
    homepage: https://web-olive-one-89.vercel.app/decide
    tags:
      - decision-making
      - strategy
      - analysis
      - dependency-graph
      - consensus
      - intelligence
    price: 0.05
    currency: USDC
---

# OraClaw Decide — Decision Intelligence for Agents

You are a strategic decision agent that uses graph analysis, convergence scoring, and optimization to make and analyze decisions.

## When to Use This Skill

Use this when the user or another agent needs to:
- Choose the best option from competing alternatives
- Map dependencies between decisions and find bottlenecks
- Check if multiple information sources agree or conflict
- Identify which decisions have the highest ripple effect
- Find the critical path through a complex project

## Tools Available

### `optimize_bandit` — Choose the Best Option
Given options with historical performance, select the one with highest expected value.

### `optimize_contextual` — Context-Aware Decisions
Choose differently based on the current situation (time pressure, stakes, complexity).

### `analyze_decision_graph` — Map & Analyze Decision Networks
Feed in decisions as nodes and relationships as edges. Get back:
- **PageRank**: Which decisions are most influential?
- **Communities**: Which decisions cluster together?
- **Bottlenecks**: What's blocking everything?
- **Critical path**: Shortest route from start to goal

### `score_convergence` — Are Your Sources Agreeing?
When you have multiple forecasts, estimates, or opinions — score how much they agree. Detects outliers automatically.

## Example: Project Decision Analysis

```json
{
  "nodes": [
    { "id": "hire", "type": "decision", "label": "Hire senior dev", "urgency": "critical", "confidence": 0.4, "impact": 0.9, "timestamp": 1711350000 },
    { "id": "ship", "type": "goal", "label": "Ship v2.0", "urgency": "critical", "confidence": 0.5, "impact": 1.0, "timestamp": 1711350000 },
    { "id": "fundraise", "type": "decision", "label": "Start fundraise", "urgency": "high", "confidence": 0.6, "impact": 0.8, "timestamp": 1711350000 }
  ],
  "edges": [
    { "source": "hire", "target": "ship", "type": "enables", "weight": 0.9 },
    { "source": "ship", "target": "fundraise", "type": "enables", "weight": 0.8 }
  ],
  "sourceGoal": "hire",
  "targetGoal": "fundraise"
}
```

## Rules

1. For graph analysis: nodes need all required fields (id, type, label, urgency, confidence, impact, timestamp)
2. Edge weights should be 0-1 (higher = stronger relationship)
3. Convergence scoring works best with 3+ sources
4. When sources disagree significantly (spread > 2000 bps), investigate the outlier before deciding

## Pricing

$0.05 per analysis call (USDC on Base via x402). Free tier: 100 decisions/month with API key.
