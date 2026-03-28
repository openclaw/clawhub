---
name: aivi-engagement
description: AIVI is the AI engagement layer for lead generation, contact centers, and customer re-activation. Every conversation is analyzed in real-time, building Conversational Intelligence that makes every future interaction smarter.
version: 1.1.0
author: AIVI
url: https://aivi.io
requires: {}
---

## Getting Started

### Setup (One Time)

1. Create your account at app.aivi.io
   Sign in with Google or email.

2. Connect AIVI to your agent:

**Claude Code:**
```
claude mcp add --transport http aivi https://mcp.aivi.io/mcp
```

Then authenticate:
`/mcp` → select AIVI → Authenticate
Browser opens → sign in with Google → click Allow Access → done.
Tokens persist across server redeploys (Redis-backed).

**Claude Desktop / claude.ai:**
Settings → Connectors → Add
URL: `https://mcp.aivi.io/mcp`
Sign in when browser opens.

**ChatGPT Developer Mode:**
Settings → Connectors → Developer Mode
Add URL: `https://mcp.aivi.io/mcp`
Sign in when prompted.

**OpenClaw / NemoClaw:**
```
clawhub install aivi-engagement
```
Add to `~/.openclaw/.env`:
`AIVI_API_KEY=your_key_from_app.aivi.io`

**All other MCP clients:**
Endpoint: `https://mcp.aivi.io/mcp`
Supports OAuth 2.1 + PKCE
or `AIVI_API_KEY` env var as fallback.

Need help? app.aivi.io/getting-started

---

## MCP Connection

| | |
|---|---|
| Transport | HTTP (streamable-http) |
| Endpoint | https://mcp.aivi.io/mcp |
| Health | https://mcp.aivi.io/health |
| Auth Resolve | https://mcp.aivi.io/auth/resolve?authorization_id={id} |
| Compatible | Claude Code, Claude Desktop, OpenClaw, NemoClaw, ChatGPT, any MCP client |

---

## Agent Behavior Rules

Authentication is handled automatically via OAuth 2.1. If credentials are missing, direct user to run `/mcp` auth in Claude Code or reconnect via Settings → Connectors. Do not ask for API keys.

If skill returns insufficient_funds:
> "Add credits at app.aivi.io → Billing"

---

## Quick Start Prompts

Copy and paste to get started immediately:

1. Score a lead:
   "Score the lead at +12065551234"

2. Launch a sequence:
   "Launch a 3-day sequence for +12065551234"

3. Check what happened:
   "What happened on the last call with +12065551234?"

4. Get ML recommendation:
   "What should I do next with +12065551234?"

---

# AIVI Lead Engagement

Use this skill when the user wants to:
- Score a lead before contacting them
- Launch an AI voice + SMS sequence
- Check if a phone number is valid or a litigator
- Get ML recommendation on best channel and timing
- Launch a premium Supercharged campaign

## Setup Required
MCP endpoint: https://mcp.aivi.io/mcp
Auth: OAuth 2.1 (automatic) or AIVI_API_KEY fallback.

## Available Skills

### qualify_lead ($0.75)
Use when: user wants to verify and qualify a lead before outreach.

Prerequisites — Enable AIVI Insights:
app.aivi.io → Profile icon → Settings → Integrations → AIVI Insights → Activate → Configure tier rules

Example prompts:
- "Qualify this lead at +12065551234"
- "Is +12065551234 worth contacting?"
- "Verify this lead before we call"

Returns: phone validity and litigator status, contactability level, lead tier (Premium/Standard/Manual/Reject), economic propensity indicators, recommended sequence type, auto-reject flag with reason.

Auto-rejected leads are not charged.

AIVI Insights data is cached for up to 30 days. Cached results are returned free of charge. Re-qualification at $0.75 is recommended when:
- Lead has been inactive for 30+ days
- Phone ownership may have changed
- Time-sensitive financial qualification (mortgage, auto, insurance, debt consolidation)

Note: Economic indicators are propensity signals at segment level — they reflect likely household characteristics, not verified individual facts.

### score_lead ($0.75)
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
| qualify_lead | $0.75 (cached free, auto-reject free) |
| score_lead | $0.75 |
| launch_sequence (one_day) | $1.00 |
| launch_sequence (three_day) | $1.50 |
| launch_sequence (twelve_day) | $3.00 |
| Booking add-on | +$1.00 |
| decide_next_action | Free |
| get_outcome | Free |
