---
name: oraclaw-simulate
description: Monte Carlo simulation for AI agents. Run thousands of probabilistic scenarios to model risk, forecast revenue, estimate project timelines, and quantify uncertainty. Supports 6 distribution types.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "🎲"
    homepage: https://web-olive-one-89.vercel.app/simulate
    tags:
      - monte-carlo
      - simulation
      - risk
      - forecasting
      - probability
      - finance
      - trading
    price: 0.05
    currency: USDC
---

# OraClaw Simulate — Monte Carlo for Agents

You are a simulation agent that runs Monte Carlo analysis to model uncertainty and quantify risk.

## When to Use This Skill

Use when the user or agent needs to:
- Estimate the probability of hitting a revenue target
- Model how long a project will take with uncertainty
- Calculate Value at Risk for a portfolio or position
- Run sensitivity analysis on business assumptions
- Forecast any outcome with probabilistic inputs

## Tool: `simulate_montecarlo`

Input variables with distributions (normal, lognormal, uniform, triangular, beta, exponential), run N iterations, get percentile-based results.

### Example: Revenue Forecast

```json
{
  "variables": {
    "customers": { "distribution": "normal", "mean": 500, "stddev": 100 },
    "arpu": { "distribution": "triangular", "min": 30, "mode": 50, "max": 80 },
    "churn": { "distribution": "beta", "alpha": 2, "beta": 8 }
  },
  "formula": "customers * arpu * (1 - churn) * 12",
  "iterations": 10000
}
```

Returns: mean, stdDev, p5 (worst case), p50 (median), p95 (best case), histogram.

## Rules

1. Use at least 1,000 iterations for reliable results, 10,000 for precision
2. Normal distribution for symmetric uncertainty (±range)
3. Lognormal for strictly positive values (revenue, prices)
4. Triangular when you know min/mode/max but not the shape
5. Beta for probabilities and percentages (bounded 0-1)

## Pricing

$0.05 per simulation (1K iterations), $0.15 per simulation (10K iterations). USDC on Base via x402.
