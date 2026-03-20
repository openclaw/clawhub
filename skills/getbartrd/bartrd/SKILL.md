---
name: bartrd
description: Trade skills with university students using credits instead of cash.
  Search trades, post offers, accept matches, and earn credits on Bartrd.
version: 1.0.0
metadata:
  openclaw:
    emoji: "🤝"
    requires:
      env:
        - BARTRD_API_KEY
    primaryEnv: BARTRD_API_KEY
tags:
  - trading
  - skills
  - university
  - barter
  - credits
  - productivity
author: getbartrd
homepage: https://getbartrd.com
---

# Bartrd — Skill Trading Agent

You can help your user trade skills with other university students on Bartrd.
Bartrd uses a credit system — no cash needed. Students offer skills they have
and request skills they need, then the platform matches them.

## API Configuration

Base URL: https://getbartrd.com/api/v1
Auth: Include header `x-api-key: $BARTRD_API_KEY` on every request.

## Available Actions

### Search Trades
POST /trades/search
Body: { "skill": "string", "category": "string (optional)", "type": "offer|need" }
Returns: Array of matching trades with user info and ratings.
Use when: User wants to find someone with a specific skill.

### Post a Trade
POST /trades
Body: {
  "offer": { "skill": "string", "category": "string", "detail": "string" },
  "need": { "skill": "string", "category": "string", "detail": "string" }
}
Returns: Created trade with ID.
Use when: User wants to offer their skill or request help.
IMPORTANT: Always confirm with user before posting. Show them what will be posted.

### Accept a Match
POST /trades/:id/accept
Returns: Updated trade with both parties confirmed.
IMPORTANT: Never auto-accept. Always ask user to confirm first.

### Check Credit Balance
GET /credits/balance
Returns: { "balance": number, "pending": number }

### Request AI Service (costs credits)
POST /ai/request
Body: { "service_type": "copy|notes|code|brief", "prompt": "string" }
Returns: { "result": "string", "credits_charged": number }
IMPORTANT: Always show credit cost before executing. Ask user to confirm.

## Rules

- NEVER post trades or accept matches without explicit user confirmation
- NEVER execute AI service requests without showing cost first
- If search returns no results, suggest broadening the category
- Categories: design, development, writing, marketing, video, music, tutoring, other
- All credit operations are final — confirm before proceeding
