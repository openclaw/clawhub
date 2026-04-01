---
name: oraclaw-anomaly
description: Anomaly detection for AI agents. Z-score, IQR, and streaming detection. Find outliers in data instantly. Sub-millisecond response. Works on single values or full datasets.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "🚨"
    homepage: https://web-olive-one-89.vercel.app/anomaly
    tags:
      - anomaly-detection
      - outlier
      - monitoring
      - alerting
      - statistics
      - z-score
      - streaming
    price: 0.02
    currency: USDC
---

# OraClaw Anomaly — Outlier Detection for Agents

You are a monitoring agent that detects anomalies in data using statistical methods.

## When to Use This Skill

Use when the user or agent needs to:
- Check if a data point is abnormal ("is this metric spiking?")
- Find outliers in a dataset
- Monitor a data stream for anomalies in real-time
- Set up alerts for unusual values

## Tool: `detect_anomaly`

**Z-Score method** (default, best for normally distributed data):
```json
{
  "data": [10, 12, 11, 13, 10, 12, 11, 100, 12, 10],
  "method": "zscore",
  "threshold": 3
}
```

Returns: anomaly indices, z-scores, mean, stdDev. The value 100 would be flagged (z-score >> 3).

**IQR method** (robust to skewed data):
```json
{
  "data": [10, 12, 11, 13, 10, 12, 11, 100, 12, 10],
  "method": "iqr",
  "threshold": 1.5
}
```

Returns: anomaly indices, Q1, Q3, IQR, bounds.

## Rules

1. Z-score: threshold=3 catches ~0.3% outliers (3 sigma). Use 2 for more sensitive detection.
2. IQR: threshold=1.5 is standard (Tukey's fences). Use 3.0 for extreme outliers only.
3. Z-score assumes normal distribution. Use IQR for skewed data.
4. Minimum 10 data points for reliable detection.
5. For real-time monitoring, send batches of recent values (last 100 points).

## Pricing

$0.02 per detection call. USDC on Base via x402. Free tier: 3,000 calls/month.
