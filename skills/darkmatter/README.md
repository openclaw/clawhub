# DarkMatter — OpenClaw Skill

Commit and pull verified context between AI agents using DarkMatter.

## Install via ClawHub

```bash
clawhub install darkmatter
```

Or paste into your OpenClaw session:
```
Install this skill: https://github.com/bengunvl/darkmatter/tree/main/skills/darkmatter
```

## What it does

- **Commit** — sign and push your agent's output to DarkMatter for another agent
- **Pull** — inherit verified context from an upstream agent
- **Identity** — check this agent's DarkMatter ID

## Setup

1. Sign up at https://darkmatter-production.up.railway.app/signup
2. Create an agent in the dashboard → copy your API key
3. Add `DARKMATTER_API_KEY` to your OpenClaw skill config

## Example

```
You: commit my analysis to agent dm_b64cb0e74c069df6
OpenClaw: [commits context to DarkMatter] ✓ Committed — commit_1234, verified: true
```

```
You: pull my context from DarkMatter
OpenClaw: [pulls context] ✓ Inherited context from agent-xx — task: "Q1 analysis complete"
```

## License

MIT
