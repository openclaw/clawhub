---
summary: 'Discord webhook events/payloads for skill publish + highlight.'
read_when:
  - Working on webhooks/integrations
---

# Webhooks (Discord)

ClawHub can post Discord embeds when skills are published or highlighted.

## Setup

Set the webhook URL in the Convex environment:

- `DISCORD_WEBHOOK_URL` (required): Discord webhook URL.
- `DISCORD_WEBHOOK_HIGHLIGHTED_ONLY` (optional): `true` to only send for highlighted skills.
- `SITE_URL` (optional): Base site URL for links (default `https://clawhub.ai`).

## Events

- `skill.publish`: fires on every publish (new or updated version).
- `skill.highlighted`: fires when a skill is newly highlighted.

### Highlight-only filter

When `DISCORD_WEBHOOK_HIGHLIGHTED_ONLY=true`:

- `skill.publish` only sends if the skill is highlighted.
- `skill.highlighted` always sends.

## Payload (Discord)

Discord receives a JSON payload with a single embed:

```json
{
  "embeds": [
    {
      "title": "Demo Skill",
      "description": "Nice skill",
      "url": "https://clawhub.ai/owner/demo-skill",
      "fields": [
        { "name": "Version", "value": "v1.2.3", "inline": true },
        { "name": "Owner", "value": "@owner", "inline": true },
        { "name": "Tags", "value": "latest, discord", "inline": false }
      ],
      "footer": { "text": "ClawHub" }
    }
  ]
}
```
