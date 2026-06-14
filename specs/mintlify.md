---
summary: "Superseded Mintlify notes for publishing docs/."
read_when:
  - Setting up docs site
---

# Mintlify

Status: superseded for the CLAW-201 ClawHub docs migration.

The current migration plan is to build `docs/` with the shared
`openclaw/docs` renderer and serve the generated output from ClawHub under
`https://clawhub.ai/docs`. Do not set up Mintlify for this migration unless a
new issue explicitly reopens that direction.

## Historical note

Mintlify was evaluated as a simpler docs host, but the project direction moved
back to reusing the existing `openclaw/docs` framework so ClawHub docs keep the
same shell, Ask Molty integration, search/index generation, and route behavior
as OpenClaw docs without introducing a second docs product.
