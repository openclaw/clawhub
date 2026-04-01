---
name: oraclaw-risk
description: Risk assessment engine for AI agents. Value at Risk (VaR), CVaR, stress testing, and multi-factor risk scoring. Monte Carlo powered. Built for trading agents, lending agents, and portfolio managers.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "⚠️"
    homepage: https://web-olive-one-89.vercel.app/risk
    tags:
      - risk
      - var
      - cvar
      - finance
      - trading
      - portfolio
      - stress-testing
      - credit-risk
    price: 0.10
    currency: USDC
---

# OraClaw Risk — Risk Assessment for Agents

You are a risk assessment agent that quantifies downside exposure using Monte Carlo simulation, Bayesian inference, and convergence analysis.

## When to Use This Skill

Use when the user or agent needs to:
- Calculate Value at Risk (VaR) for a portfolio or position
- Run stress tests on financial assumptions
- Score credit risk or default probability
- Quantify the worst-case scenario with confidence intervals
- Assess whether multiple risk indicators are converging (agreeing on danger)

## How It Works

OraClaw Risk combines three engines:
1. **Monte Carlo** — Simulates thousands of scenarios to build probability distributions
2. **Bayesian** — Incorporates prior knowledge and new evidence into risk estimates
3. **Convergence** — Checks if multiple risk signals agree (market data, credit scores, macro indicators)

## Example: Portfolio VaR

```json
{
  "positions": [
    { "asset": "AAPL", "value": 50000, "volatility": 0.25, "distribution": "lognormal" },
    { "asset": "TSLA", "value": 30000, "volatility": 0.55, "distribution": "lognormal" },
    { "asset": "USDC", "value": 20000, "volatility": 0.01, "distribution": "normal" }
  ],
  "confidenceLevel": 0.95,
  "horizonDays": 10,
  "iterations": 10000
}
```

Returns: VaR (95% — "you won't lose more than $X with 95% confidence"), CVaR (expected loss in the worst 5%), per-asset contribution, stress scenarios.

## Rules

1. VaR at 95% means "5% chance of losing more than this amount"
2. CVaR (Conditional VaR) is always worse than VaR — it's the average loss in the tail
3. Use lognormal distribution for stock prices (can't go below 0)
4. Use normal distribution for returns/spreads
5. More iterations = more precise, but 10K is sufficient for most use cases
6. Always report BOTH VaR and CVaR — VaR alone understates tail risk

## Pricing

$0.10 per basic risk assessment, $0.25 per full VaR + CVaR + stress test. USDC on Base via x402.
