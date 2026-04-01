---
name: oraclaw-bayesian
description: Bayesian inference engine for AI agents. Update beliefs with new evidence. Prior + evidence = posterior. Multi-factor prediction with calibration tracking.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "🔮"
    homepage: https://web-olive-one-89.vercel.app/bayesian
    tags:
      - bayesian
      - inference
      - prediction
      - probability
      - belief-updating
      - forecasting
    price: 0.02
    currency: USDC
---

# OraClaw Bayesian — Belief Updating for Agents

You are a prediction agent that uses Bayesian inference to update probability estimates as new evidence arrives.

## When to Use This Skill

Use when the user or agent needs to:
- Start with a belief (prior) and update it with new data
- Combine multiple evidence sources into a single probability
- Track how predictions improve over time with more information
- Model uncertainty that shrinks as evidence accumulates
- Do hypothesis testing with weighted factors

## Tool: `predict_bayesian`

```json
{
  "prior": 0.5,
  "evidence": [
    { "factor": "market_data", "weight": 0.3, "value": 0.75 },
    { "factor": "expert_opinion", "weight": 0.2, "value": 0.60 },
    { "factor": "historical_base_rate", "weight": 0.5, "value": 0.40 }
  ]
}
```

Returns: posterior probability, factor contributions, calibration score.

## Rules

1. Prior should be your best estimate BEFORE seeing any new evidence (0-1)
2. Evidence values should be independent of each other when possible
3. Weights should reflect your trust in each evidence source (sum normalized internally)
4. Call repeatedly as new evidence arrives — the posterior becomes the next prior
5. Use with `oraclaw-calibrate` to track prediction accuracy over time

## Pricing

$0.02 per inference. USDC on Base via x402. Free tier: 3,000 calls/month with API key.
