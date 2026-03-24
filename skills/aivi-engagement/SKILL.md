---
name: aivi-engagement
description: AIVI is the AI engagement layer for lead generation, contact centers, and customer re-activation. Every conversation is analyzed in real-time, building Conversational Intelligence that makes every future interaction smarter.
version: 1.0.0
author: AIVI
url: https://aivi.io
requires:
  env:
    - AIVI_API_KEY
---

## Getting Started

### Step 1 — Create your AIVI account
Go to app.aivi.io and sign up.
Complete one-time setup (15-30 minutes):
- Business profile and vertical
- A2P 10DLC registration (SMS compliance)
- Phone number purchase or port
- AI agent voice and script configuration
- Add billing credits ($100 minimum)

### Step 2 — Get your API key
app.aivi.io → Profile → Settings → API Keys → Generate API Key
Copy it — shown once only.

### Step 3 — Connect to your AI agent

Claude Code:
```
claude mcp add --transport http aivi https://mcp.aivi.io/mcp
```

Claude Desktop — add to config:
```json
{"mcpServers":{"aivi":{"url":"https://mcp.aivi.io/mcp"}}}
```

OpenClaw:
```
clawhub install aivi/aivi-engagement
```

### Step 4 — Tell your agent your credentials
"My AIVI API key is aivi_sk_xxxxx
 My org ID is [app.aivi.io → Settings → Organization]"

---

## MCP Connection

| | |
|---|---|
| Transport | HTTP (streamable-http) |
| Endpoint | https://mcp.aivi.io/mcp |
| Health | https://mcp.aivi.io/health |
| Compatible | Claude Code, Claude Desktop, OpenClaw, NemoClaw, any MCP client |

---

## Agent Behavior Rules

ALWAYS ask for API key before any skill call.
NEVER proceed without a valid api_key.

If user has no API key:
> "Get your API key at app.aivi.io → Profile → Settings → API Keys"

If skill returns invalid_api_key:
> "That key didn't work. Verify at app.aivi.io → Settings → API Keys"

If skill returns insufficient_funds:
> "Add credits at app.aivi.io → Billing. Minimum $100 to activate campaigns"

---

# AIVI Lead Engagement

Use this skill when the user wants to:
- Score a lead before contacting them
- Launch an AI voice + SMS sequence
- Check if a phone number is valid or a litigator
- Get ML recommendation on best channel and timing
- Launch a premium Supercharged campaign

## Setup Required
Get your API key at app.aivi.io → Profile → Settings → API Keys

MCP endpoint: https://mcp.aivi.io/mcp

## Available Skills

### score_lead
Use when: user wants to score or evaluate a lead before outreach.

Example prompts:
- "Score this lead at +12065551234"
- "Is this lead worth calling?"
- "What does AIVI know about +13105551234?"

Returns: score 0-100, tier, ML recommendation, phone validity, litigator check, income level, property data, best channel and timing.

### launch_sequence
Use when: user wants to start an outreach campaign for a lead.

Example prompts:
- "Launch a 3-day sequence for this lead"
- "Start the Supercharged 1-day campaign"
- "Enroll +12065551234 in a 12-day sequence with booking enabled"

Sequences: one_day ($1.00), three_day ($1.50), twelve_day ($3.00). Add $1.00 for booking.

### onboard_organization
Use when: user wants to create a new AIVI account.

Example prompts:
- "Set up a new account for Acme Solar"
- "Create an org for a debt collection company"
- "Onboard a healthcare practice with callback scheduling"

Returns: org_id, API key (shown once), AI agent config, $5 trial credits.

### decide_next_action
Use when: user wants the ML model to recommend the best next step.

Example prompts:
- "What should I do next with this lead?"
- "Should I call or text +12065551234?"
- "What's the ML recommendation for this contact?"

Returns: recommended action, channel, timing, all 14 action scores, confidence, exploration flag. Free — no charge.

### Prerequisites
For best results, run in this order:
1. score_lead ($0.75) — enriches the lead
2. launch_sequence ($1.00-3.00) — starts engagement
3. decide_next_action (free) — optimizes every step

You can use decide_next_action standalone but it works best after at least one score_lead or launch_sequence has run.

### get_outcome
Use when: user wants to know what happened on a call or sequence.

Example prompts:
- "What happened on that call?"
- "Did the sequence convert?"
- "Show me the topics from the last call"

## Conversational Intelligence

Every call processed by AIVI generates:
- Topics discussed (automatically extracted)
- Key moments (objections, callbacks, compliance, escalations)
- Sentiment arc (positive, negative, neutral)
- Outcome classification

773 calls analyzed. 494 moments detected:
- 140 objections raised
- 117 callback promises
- 24 compliance misses
- 12 escalation requests

Works across:
- Lead generation (new prospects)
- Contact center (inbound + outbound)
- Customer re-activation (lapsed base)
- Ongoing care (existing customers)

Every call makes the next one smarter.

## Billing
All skills require AIVI credits. Add credits at app.aivi.io → Billing.

| Skill | Cost |
|-------|------|
| score_lead | $0.75 |
| launch_sequence (one_day) | $1.00 |
| launch_sequence (three_day) | $1.50 |
| launch_sequence (twelve_day) | $3.00 |
| Booking add-on | +$1.00 |
| decide_next_action | Free |
| get_outcome | Free |
| onboard_organization | Free (includes $5 trial credits) |
