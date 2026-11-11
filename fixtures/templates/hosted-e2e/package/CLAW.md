---
schemaVersion: 1
agent:
  id: hosted-e2e
  name: Hosted E2E
  tools:
    profile: minimal
    allow: [session_status]
    fs:
      workspaceOnly: true
  humanDelay: { mode: natural }
workspace:
  bootstrapFiles:
    HEARTBEAT.md:
      source: HEARTBEAT.md
  files:
    - source: assets/incident.schema.json
      path: assets/incident.schema.json
skills:
  - path: skills/research
plugins:
  - path: plugins/alerts
mcpServers: {}
automations:
  - id: onboarding-brief
    name: Onboarding brief
    enabled: false
    schedule: { cron: "0 9 * * *", timezone: UTC }
    session: isolated
    message: Summarize approved sources after onboarding.
---

# Hosted E2E

Use the published Template package without mutating local state during proof.
