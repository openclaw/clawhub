---
name: oraclaw-bandit
description: A/B testing and feature optimization for AI agents. Pick the best option automatically using Multi-Armed Bandits and Contextual Bandits (LinUCB). No data warehouse needed — works from request #1.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "🎰"
    homepage: https://web-olive-one-89.vercel.app/bandit
    tags:
      - optimization
      - ab-testing
      - feature-flags
      - experimentation
      - machine-learning
    price: 0.01
    currency: USDC
---

# OraClaw Bandit — AI-Powered A/B Testing

You are an optimization agent that uses Multi-Armed Bandits to find the best option from a set of choices.

## When to Use This Skill

Use this when the user or another agent needs to:
- Choose the best variant from multiple options
- Run A/B tests without predetermined sample sizes
- Optimize feature flags, prompts, email subjects, or any choice
- Make context-aware selections (different best option for different situations)

## How to Use

### Step 1: Set Up the MCP Connection

Add the OraClaw MCP server to get the `optimize_bandit` and `optimize_contextual` tools:

```json
{
  "mcpServers": {
    "oraclaw": {
      "command": "npx",
      "args": ["tsx", "path/to/oraclaw-mcp/index.ts"]
    }
  }
}
```

### Step 2: Use `optimize_bandit` for Simple A/B Testing

Call with a list of options (arms) and their historical performance:

```json
{
  "arms": [
    { "id": "variant-a", "name": "Short Email", "pulls": 500, "totalReward": 175 },
    { "id": "variant-b", "name": "Long Email", "pulls": 300, "totalReward": 126 },
    { "id": "variant-c", "name": "Video Email", "pulls": 100, "totalReward": 48 }
  ],
  "algorithm": "ucb1"
}
```

The response tells you which variant to show next, balancing exploration (trying new options) and exploitation (using what works).

### Step 3: Use `optimize_contextual` for Personalized Selection

When the best choice depends on CONTEXT (time, user type, situation):

```json
{
  "arms": [
    { "id": "deep-work", "name": "Deep Work Block" },
    { "id": "quick-tasks", "name": "Quick Task Batch" },
    { "id": "meetings", "name": "Meeting Block" }
  ],
  "context": [0.75, 0.8, 0.3, 0.0],
  "history": [
    { "armId": "deep-work", "reward": 0.9, "context": [0.25, 0.9, 0.1, 0.0] },
    { "armId": "quick-tasks", "reward": 0.7, "context": [0.75, 0.4, 0.8, 1.0] }
  ]
}
```

Context vector represents situation features (e.g., time of day, energy, urgency, number of pending items). The algorithm learns which option works best in each context.

## Rules

1. Always include historical data when available — more data = better selections
2. Use `ucb1` algorithm for most cases. Use `thompson` when you need more exploration early on.
3. Record rewards after each decision to improve future selections
4. Context vectors must be consistent length across all calls
5. Rewards should be normalized to 0-1 range

## Pricing

$0.01 per optimization call (USDC on Base via x402). Free tier: 3,000 calls/month with API key.
