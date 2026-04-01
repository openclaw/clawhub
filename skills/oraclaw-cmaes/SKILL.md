---
name: oraclaw-cmaes
description: CMA-ES continuous optimization for AI agents. State-of-the-art derivative-free optimizer. 10-100x more sample-efficient than genetic algorithms on continuous problems. Hyperparameter tuning, portfolio optimization, parameter calibration.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "🔬"
    homepage: https://web-olive-one-89.vercel.app/cmaes
    tags:
      - cma-es
      - optimization
      - continuous
      - hyperparameter
      - derivative-free
      - black-box
      - evolution-strategy
    price: 0.10
    currency: USDC
---

# OraClaw CMA-ES — SOTA Continuous Optimizer for Agents

You are an optimization agent that uses CMA-ES (Covariance Matrix Adaptation Evolution Strategy) — the gold standard for derivative-free continuous optimization. Used by Google for hyperparameter tuning.

## When to Use This Skill

Use when the user or agent needs to:
- Optimize continuous parameters (learning rates, weights, thresholds)
- Tune hyperparameters for ML models
- Calibrate model parameters to match observed data
- Find optimal continuous allocations (portfolio weights, pricing)
- Any black-box optimization where you can evaluate f(x) but don't have gradients

## Why CMA-ES vs. Genetic Algorithm?

- **CMA-ES**: 10-100x more sample-efficient on smooth continuous problems. Learns the correlation structure of the search space. SOTA for continuous optimization.
- **GA** (`oraclaw-evolve`): Better for discrete/combinatorial problems, multi-objective Pareto frontiers.
- Use CMA-ES for continuous. Use GA for discrete.

## Tool: `optimize_cmaes`

```json
{
  "dimension": 3,
  "initialMean": [0.5, 0.5, 0.5],
  "initialSigma": 0.3,
  "maxIterations": 200,
  "objectiveWeights": [2.0, 1.5, 1.0]
}
```

Returns: bestSolution, bestFitness, iterations, evaluations, converged, executionTimeMs.

## Rules

1. `dimension` = number of continuous parameters to optimize
2. `initialMean` = starting point (center of search). If unknown, use 0.5 for normalized params.
3. `initialSigma` = initial step size (0.1-0.5 typical). Too small = slow convergence, too large = unstable.
4. CMA-ES MINIMIZES the objective. To maximize, negate the weights.
5. Converges in O(dimension^2) iterations typically. Dimension 10 needs ~100-300 iterations.

## Pricing

$0.10 per optimization. USDC on Base via x402. Free tier: 1,000 calls/month.
