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
skills: []
plugins: []
mcpServers: {}
automations: []
---

# Hosted E2E

Use the published Template package without mutating local state during proof.
