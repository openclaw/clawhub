---
name: onboard
description: |
  Guided onboarding path through five stages: big picture, core domain, interfaces, patterns, and hardening
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: gauntlet
---

> **Night Market Skill** — ported from [claude-night-market/gauntlet](https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Guided Onboarding

Walk a new developer through the codebase in structured stages.

## Stages

| Stage | Focus | Categories | Difficulty |
|-------|-------|------------|------------|
| 1 | Big picture | architecture, data_flow | 1-2 |
| 2 | Core domain | business_logic | 2-3 |
| 3 | Interfaces | api_contract, data_flow | 3 |
| 4 | Patterns | pattern, dependency | 3-4 |
| 5 | Hardening | error_handling, business_logic | 4-5 |

## Steps

1. Load onboarding progress
2. Show current stage and progress summary
3. Present 5 challenges from current stage
4. Enable hints on first attempt
5. Track mastery (correct twice = mastered)
6. Check advancement (80% across 10+ challenges)
7. Report progress

## Graduation

After stage 5, the developer enters the regular gauntlet.
Answer history carries over.
