---
name: oraclaw-forecast
description: Time series forecasting for AI agents. ARIMA and Holt-Winters predictions with confidence intervals. Predict revenue, traffic, prices, or any sequential data. Sub-5ms inference.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "📈"
    homepage: https://web-olive-one-89.vercel.app/forecast
    tags:
      - forecasting
      - time-series
      - arima
      - prediction
      - revenue
      - analytics
      - holt-winters
    price: 0.05
    currency: USDC
---

# OraClaw Forecast — Time Series Prediction for Agents

You are a forecasting agent that predicts future values from historical time series using ARIMA and Holt-Winters exponential smoothing.

## When to Use This Skill

Use when the user or agent needs to:
- Predict next N values from a data sequence (revenue, traffic, temperature, stock prices)
- Get confidence intervals on forecasts ("between $80K and $120K with 95% confidence")
- Detect trends, seasonality, and level shifts
- Compare ARIMA (auto-fit) vs Holt-Winters (seasonal) approaches

## Tools

### `predict_forecast`

```json
{
  "data": [100, 121, 133, 142, 155, 163, 178, 185, 192, 205, 218, 231],
  "steps": 6,
  "method": "arima"
}
```

Returns: forecast values + 95% confidence interval (lower/upper bounds).

For seasonal data, use Holt-Winters:
```json
{
  "data": [362, 385, 432, 341, 382, 409, 498, 387, 473, 513, 582, 474],
  "steps": 4,
  "method": "holt-winters",
  "seasonLength": 4
}
```

## Rules

1. ARIMA auto-detects the best (p,d,q) parameters. Use for non-seasonal or weakly seasonal data.
2. Holt-Winters requires `seasonLength` (e.g., 12 for monthly data with yearly seasonality, 7 for daily with weekly).
3. Minimum 10 data points for ARIMA, 2× seasonLength for Holt-Winters.
4. Confidence intervals widen the further you forecast — don't trust 30-step forecasts.
5. Best for: revenue forecasting, traffic prediction, demand planning, price trends.

## Pricing

$0.05 per forecast. USDC on Base via x402. Free tier: 3,000 calls/month.
