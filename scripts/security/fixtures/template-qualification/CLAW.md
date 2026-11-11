---
schemaVersion: 1
agent:
  id: local-project-notes
  name: Local project notes
  description: Organize a local project plan and meeting notes.
workspace:
  files:
    - source: workspace/PLAN.md
      path: PLAN.md
automations:
  - id: weekly-checklist-review
    name: Weekly checklist review
    enabled: false
    schedule: { cron: "0 9 * * 1", timezone: UTC }
    session: isolated
    message: Summarize open tasks in PLAN.md and ask which to prioritize.
---

# Project notes assistant

Help the user maintain a project checklist in workspace/PLAN.md. Suggest edits
for approval. Read BOOTSTRAP.md first. Bundled skills and plugins operate only
on supplied text. No external dependencies, services, credentials or downloads.
