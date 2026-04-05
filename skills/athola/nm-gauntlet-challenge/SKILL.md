---
name: challenge
description: |
  Run a gauntlet challenge session with adaptive difficulty. Tests codebase understanding through multiple choice, code completion, trace exercises, and more
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: gauntlet
---

> **Night Market Skill** — ported from [claude-night-market/gauntlet](https://github.com/athola/claude-night-market/tree/master/plugins/gauntlet). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Run Gauntlet Challenge

Present challenges from the knowledge base and evaluate answers.

## Steps

1. **Load state**: read `.gauntlet/knowledge.json` and developer
   progress

2. **Check for pending challenge**: if
   `.gauntlet/state/pending_challenge.json` exists, evaluate the
   developer's most recent message as an answer before generating
   a new one

3. **Generate challenge**: use adaptive weighting to select a
   knowledge entry and challenge type

4. **Present challenge**: show the question with context

5. **Evaluate answer**: score the response (pass/partial/fail)

6. **Record result**: update developer progress and streak

7. **On pass**: write pass token if from pre-commit gate. Show
   next challenge if in session.

8. **On fail**: show correct answer with explanation. Present a
   new challenge.

## Scoring

| Result | Score | Streak |
|--------|-------|--------|
| Pass | 1.0 | +1 |
| Partial | 0.5 | reset |
| Fail | 0.0 | reset |
