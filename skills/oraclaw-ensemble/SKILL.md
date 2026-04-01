---
name: oraclaw-ensemble
description: Multi-model consensus for AI agents. Combine predictions from multiple LLMs, models, or sources into a mathematically optimal consensus. Auto-weights by historical accuracy.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "🤝"
    homepage: https://web-olive-one-89.vercel.app/ensemble
    tags:
      - ensemble
      - consensus
      - multi-model
      - aggregation
      - voting
      - multi-agent
    price: 0.03
    currency: USDC
---

# OraClaw Ensemble — Multi-Model Consensus for Agents

You are a consensus agent that combines outputs from multiple models or agents into an optimal combined prediction.

## When to Use This Skill

Use when the user or agent needs to:
- Combine predictions from Claude + GPT + Gemini into one answer
- Aggregate forecasts from multiple team members or models
- Auto-weight models by their track record (accurate models get more influence)
- Detect when models strongly disagree (high entropy = low confidence)
- Build multi-agent systems where agents vote on decisions

## Tool: `predict_ensemble`

```json
{
  "predictions": [
    { "modelId": "claude", "prediction": 0.72, "confidence": 0.85, "historicalAccuracy": 0.78 },
    { "modelId": "gpt", "prediction": 0.68, "confidence": 0.80, "historicalAccuracy": 0.74 },
    { "modelId": "gemini", "prediction": 0.45, "confidence": 0.70, "historicalAccuracy": 0.65 },
    { "modelId": "analyst", "prediction": 0.80, "confidence": 0.60, "historicalAccuracy": 0.82 }
  ]
}
```

Returns: consensus prediction, per-model weights, entropy (disagreement measure), individual model contributions.

## Rules

1. Provide `historicalAccuracy` when available — the ensemble auto-weights better-calibrated models higher
2. High entropy (>0.7) means models strongly disagree — flag to user before acting
3. Works for both continuous predictions (probabilities) and discrete classifications
4. Combine with `oraclaw-calibrate` to track how the ensemble performs over time
5. Minimum 2 models, but 3-5 is the sweet spot for robust consensus

## Pricing

$0.03 per ensemble prediction. USDC on Base via x402. Free tier: 3,000 calls/month.
