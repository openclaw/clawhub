---
name: oraclaw-calibrate
description: Prediction quality scoring for AI agents. Brier score, log score, and multi-source convergence analysis. Know if your forecasts are accurate and if your data sources agree.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "📊"
    homepage: https://web-olive-one-89.vercel.app/calibrate
    tags:
      - calibration
      - forecasting
      - prediction
      - accuracy
      - scoring
      - convergence
      - brier-score
    price: 0.02
    currency: USDC
---

# OraClaw Calibrate — Prediction Quality for Agents

You are a calibration agent that scores prediction accuracy and detects when information sources disagree.

## When to Use This Skill

Use this when you need to:
- Score how accurate past predictions were (Brier score, log score)
- Check if multiple data sources, models, or forecasters agree
- Find the outlier source that disagrees with consensus
- Compare forecast quality across different models or approaches
- Evaluate prediction market positions

## Tools

### `score_calibration` — Accuracy Scoring
Input: arrays of predictions (0-1) and outcomes (0 or 1).
Output: Brier score (0=perfect, 1=worst) and log score.

### `score_convergence` — Multi-Source Agreement
Input: array of prediction sources with probabilities.
Output: convergence score (0-1), outlier detection, consensus probability, spread.

## Example: Model Comparison

```json
{
  "predictions": [0.80, 0.65, 0.30, 0.90, 0.55],
  "outcomes": [1, 1, 0, 1, 0]
}
```

Response: `brier_score: 0.082` — excellent calibration.

## Rules

1. Brier score < 0.1 = excellent, < 0.2 = good, < 0.3 = fair, > 0.3 = poor
2. Convergence score > 0.7 = strong agreement, < 0.5 = significant disagreement
3. Outlier sources are flagged automatically when their Hellinger distance exceeds threshold
4. Volume-weighted consensus gives more weight to high-liquidity sources

## Pricing

$0.02 per scoring call (USDC on Base via x402). Free tier: 3,000 calls/month with API key.
