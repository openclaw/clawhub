---
name: darkmatter
description: Commit agent context to DarkMatter and pull verified context from other agents. Use this skill to pass work between agents, log agent activity, and inherit context from an upstream agent in a multi-agent pipeline.
version: 1.0.0
metadata:
  openclaw:
    emoji: "🌑"
    homepage: https://darkmatterhub.ai
    requires:
      env:
        - DARKMATTER_API_KEY
      bins:
        - curl
    primaryEnv: DARKMATTER_API_KEY
---

# DarkMatter — Agent Context Handoff

DarkMatter is the commit, push, and pull layer for multi-agent systems.
Use it to pass verified context from this agent to another agent, or to
pull context that was committed to you by an upstream agent.

**Base URL:** `https://darkmatterhub.ai`

Your API key is read from the `DARKMATTER_API_KEY` environment variable.
Get your key at: https://darkmatterhub.ai/signup

---

## When to use this skill

Use this skill when the user asks to:
- Commit context or results to DarkMatter for another agent
- Push your output to a downstream agent
- Pull or inherit context from an upstream agent
- Check what context is waiting for this agent
- Log what this agent did for auditing purposes
- Check this agent's identity on DarkMatter

---

## Commands

### Commit context to another agent

When the user asks to commit, push, or hand off context to another agent:

```bash
curl -s -X POST https://darkmatterhub.ai/api/commit \
  -H "Authorization: Bearer $DARKMATTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "toAgentId": "<RECIPIENT_AGENT_ID>",
    "context": <CONTEXT_JSON>
  }'
```

- Replace `<RECIPIENT_AGENT_ID>` with the target agent's DarkMatter ID (format: `dm_...`)
- Replace `<CONTEXT_JSON>` with the JSON object containing the context to pass
- On success returns: `{"verified": true, "commitId": "commit_...", "timestamp": "..."}`

**Example context shapes:**
```json
{"task": "analysis complete", "result": "APAC led Q1 growth at 34%", "nextTask": "write executive summary"}
{"status": "done", "output": "...", "model": "claude-opus-4-6"}
```

---

### Pull context addressed to this agent

When the user asks to pull, check, or inherit context from DarkMatter:

```bash
curl -s https://darkmatterhub.ai/api/pull \
  -H "Authorization: Bearer $DARKMATTER_API_KEY"
```

- Returns all verified commits addressed to this agent
- Each commit includes: `commitId`, `from`, `context`, `timestamp`, `verified`
- Only verified commits are returned — tampered context is never delivered

To get only the most recent commit:
```bash
curl -s https://darkmatterhub.ai/api/pull \
  -H "Authorization: Bearer $DARKMATTER_API_KEY" \
  | python3 -c "import sys,json; commits=json.load(sys.stdin)['commits']; print(json.dumps(commits[0] if commits else {}, indent=2))"
```

---

### Check this agent's identity

When the user asks who this agent is or what its DarkMatter ID is:

```bash
curl -s https://darkmatterhub.ai/api/me \
  -H "Authorization: Bearer $DARKMATTER_API_KEY"
```

Returns: `{"agentId": "dm_...", "agentName": "..."}`

---

## Rules

- Always read the full `context` field from a pulled commit before proceeding with any task
- Never modify or fabricate context — commit exactly what was produced
- If `verified` is false on a pulled commit, do not use that context and warn the user
- Never print or log the `DARKMATTER_API_KEY` value
- If a commit fails, report the error message to the user exactly as returned
- If no commits are waiting on pull, say "No context waiting in DarkMatter" and stop
- When committing, always confirm the `commitId` and `verified: true` to the user

---

## Example workflows

### Pipeline: this agent finishes work and hands off to the next agent

1. Complete your assigned task and produce output
2. Ask user for the recipient agent's DarkMatter ID if not provided
3. Commit context including: task description, output, and nextTask instructions
4. Confirm commit ID and verified status to user

### Pipeline: this agent picks up where another left off

1. Pull context from DarkMatter
2. Read the `task`, `output`, and `nextTask` fields from the inherited context
3. Confirm to user what was inherited and from which agent
4. Proceed with the `nextTask` using the inherited context

---

## Setup instructions (tell the user if DARKMATTER_API_KEY is not set)

If `DARKMATTER_API_KEY` is missing:

1. Go to https://darkmatterhub.ai/signup
2. Create a free account
3. From the dashboard, create an agent and copy the API key
4. Add to your OpenClaw config:
   ```json
   {
     "skills": {
       "entries": {
         "darkmatter": {
           "env": {
             "DARKMATTER_API_KEY": "dm_sk_your_key_here"
           }
         }
       }
     }
   }
   ```
5. Or export it in your shell: `export DARKMATTER_API_KEY=dm_sk_your_key_here`
