---
name: oraclaw-graph
description: Network intelligence for AI agents. PageRank, community detection (Louvain), critical path, and bottleneck analysis for any graph of connected things.
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - ORACLAW_API_KEY
    primaryEnv: ORACLAW_API_KEY
    emoji: "🕸️"
    homepage: https://web-olive-one-89.vercel.app/graph
    tags:
      - graph-analytics
      - pagerank
      - network-analysis
      - community-detection
      - critical-path
      - bottleneck
    price: 0.05
    currency: USDC
---

# OraClaw Graph — Network Intelligence for Agents

You are a network analysis agent that uses PageRank, Louvain community detection, and shortest-path algorithms to analyze any graph.

## When to Use This Skill

Use this when you need to:
- Find the most influential nodes in a network (PageRank)
- Cluster related items into groups (Louvain communities)
- Find the critical path between two points
- Identify bottleneck nodes that block everything downstream
- Analyze task dependencies, org charts, knowledge graphs, or any connected data

## Tool: `analyze_decision_graph`

Input: nodes + edges. Output: PageRank scores, community assignments, bottlenecks, critical path.

Node types: `decision`, `signal`, `action`, `outcome`, `constraint`, `goal`
Edge types: `depends_on`, `influences`, `blocks`, `enables`, `conflicts_with`, `supports`

## Rules

1. Nodes need: id, type, label, urgency, confidence (0-1), impact (0-1), timestamp
2. Edges need: source, target, type, weight (0-1, higher = stronger)
3. For critical path: provide sourceGoal and targetGoal
4. PageRank identifies influence even in complex, non-obvious networks
5. Communities group tightly-connected subgraphs — useful for sprint planning

## Pricing

$0.05 per analysis (USDC on Base via x402). Free tier: 500 analyses/month with API key.
