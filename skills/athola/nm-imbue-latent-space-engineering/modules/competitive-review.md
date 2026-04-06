---
name: competitive-review
description: Frame multi-agent review dispatch with competitive
  incentives for increased rigor. Use when dispatching 3+ parallel
  review agents.
parent_skill: imbue:latent-space-engineering
category: methodology
estimated_tokens: 200
---

# Competitive Review Framing

## Principle

When multiple agents review the same artifact, framing the dispatch
with competitive incentives increases thoroughness and evidence
quality.

## For 3+ Agents (Competitive)

Add this to each agent's dispatch prompt:

~~~
You are one of N independent reviewers analyzing this code. Each
reviewer's findings will be compared. The most thorough and
well-evidenced findings will be prioritized for action. Focus on
depth over breadth.
~~~

## For 2 Agents (Collaborative)

Use collaborative framing instead:

~~~
You and one other reviewer will cover different angles. Your findings
will be integrated into a single report. Focus on your assigned scope.
~~~

Competitive framing adds overhead for fewer than 3 agents and can
cause redundant coverage.

## Avoiding Perverse Incentives

Thoroughness means evidence-backed and prioritized by severity, not
volume. To prevent inflated issue counts:

- Require evidence citations for each finding
- Weight findings by severity, not count
- Discard findings that lack specific code references

## Where To Apply

- `pensive` review agents (code-reviewer, etc.)
- `pr-review-toolkit` multi-agent reviews
- `attune:war-room` expert panels
- Any parallel dispatch of 3+ review subagents

## Anti-Pattern

Do NOT use competitive framing for:

- Implementation agents (cooperation > competition)
- Planning agents (synthesis > competition)
- Single-agent dispatch (no comparison possible)
