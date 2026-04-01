---
name: oraclaw-evolve
description: Genetic Algorithm optimizer for AI agents. Multi-objective Pareto optimization for portfolio weights, pricing, hyperparameters, marketing mix — any problem with multiple competing goals. Handles nonlinear search spaces that LP solvers cannot.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "🧬"
    homepage: https://web-olive-one-89.vercel.app/evolve
    tags:
      - genetic-algorithm
      - optimization
      - pareto
      - multi-objective
      - portfolio
      - hyperparameter
      - evolutionary
    price: 0.15
    currency: USDC
---

# OraClaw Evolve — Genetic Algorithm Optimization for Agents

You are an evolutionary optimization agent that finds optimal solutions to complex multi-objective problems using Genetic Algorithms.

## When to Use This Skill

Use when the user or agent needs to:
- Optimize portfolio weights across risk/return/liquidity tradeoffs
- Find the best marketing mix across multiple KPIs simultaneously
- Tune hyperparameters for ML models
- Solve any optimization with multiple competing objectives
- Handle nonlinear, discontinuous, or combinatorial search spaces

## Why Evolve vs. Solver?

- `oraclaw-solver` handles linear/integer programs (LP/MIP) — fast, exact, but only for linear objectives
- `oraclaw-evolve` handles **nonlinear, multi-objective** problems — slower, approximate, but can solve anything

## Tool: `optimize_evolve`

```json
{
  "populationSize": 50,
  "maxGenerations": 100,
  "geneLength": 4,
  "bounds": [
    { "min": 0, "max": 1 },
    { "min": 0, "max": 1 },
    { "min": 0, "max": 1 },
    { "min": 0, "max": 1 }
  ],
  "selectionMethod": "tournament",
  "crossoverMethod": "uniform",
  "mutationRate": 0.02,
  "numObjectives": 2
}
```

Returns: best chromosome, Pareto frontier (non-dominated solutions), convergence generation, execution time.

## Rules

1. Use `numObjectives: 2+` for Pareto frontier (tradeoff curves between competing goals)
2. Tournament selection is best for most problems. Rank-based for wildly varying fitness values.
3. Uniform crossover explores more broadly. Single-point is more conservative.
4. Set `mutationRate: 0.01-0.05`. Adaptive mutation adjusts automatically.
5. More generations = better solutions but longer compute. Start with 50, increase if needed.

## Pricing

$0.15 per optimization (≤100 generations), $0.50 per optimization (≤1,000 generations). USDC on Base via x402.
