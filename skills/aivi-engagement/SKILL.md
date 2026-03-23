---
name: aivi-engagement
description: Score leads and launch AI voice and SMS engagement sequences for real estate, debt collection, healthcare, and home services. Includes RRDB enrichment, ML-driven sequencing, and premium Supercharged campaigns.
version: 1.0.0
author: AIVI
url: https://aivi.io
requires:
  env:
    - AIVI_API_KEY
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

### get_outcome
Use when: user wants to know what happened on a call or sequence.

Example prompts:
- "What happened on that call?"
- "Did the sequence convert?"
- "Show me the topics from the last call"

## Billing
All skills require AIVI credits. Add credits at app.aivi.io → Billing.

| Skill | Cost |
|-------|------|
| score_lead | $0.75 |
| launch_sequence (one_day) | $1.00 |
| launch_sequence (three_day) | $1.50 |
| launch_sequence (twelve_day) | $3.00 |
| Booking add-on | +$1.00 |
| onboard_organization | Free (includes $5 trial credits) |
