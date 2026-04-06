---
name: waste-signals
description: Definitions and detection criteria for 5 categories of
  agent token waste in parallel dispatch workflows.
parent_skill: conserve:agent-expenditure
category: resource-optimization
estimated_tokens: 250
---

# Waste Signal Definitions

## 1. Ghost Agent

An agent that consumes tokens without producing actionable output.

**Detection criteria** (ALL must be true):
- Token expenditure >1.5x median for task type
- Findings count <30% of median for agent type
- Findings lack evidence citations (no code refs, no line numbers, no
  file paths)

**Exception**: Zero-finding results from low-risk scans
(e.g., security audit of already-linted code) are valid, not waste.

## 2. Redundant Reader

An agent that re-reads files already loaded by another agent in the
same dispatch.

**Detection**: Compare file access logs across agents. If agent B
reads the same files as agent A and produces overlapping findings,
agent B's reads were redundant.

**Mitigation**: Assign distinct file scopes to each agent before
dispatch.

## 3. Duplicate Worker

An agent whose findings overlap >50% with another agent's output.

**Detection**: Compare finding descriptions across agents. Semantic
overlap (same issue described differently) counts as duplication.

**Mitigation**: Assign distinct review dimensions (e.g., one agent
reviews security, another reviews performance).

## 4. Token Hog

An agent that exceeds 3x the median token count for its task type
without proportional output.

**Detection**: Compare agent token usage to historical median for the
same task type. If output quality or quantity does not justify the
excess, flag as waste.

**Mitigation**: Set token budgets per agent. Use haiku for
well-scoped tasks (see conjure cheapest-capable model selection).

## 5. Coordination Overhead

When N > 5 agents and shared-file conflicts exceed 20% of total agent
runtime.

**Detection**: Count concurrent Read/Write operations on the same file
by different agents, as percentage of total runtime.

**Mitigation**: Reduce agent count, use git worktrees for isolation,
or assign non-overlapping file scopes.
