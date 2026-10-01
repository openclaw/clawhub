---
name: convex-check-updates
description: "Check the current app's pinned Convex components against recommended versions and upgrade them behind a build gate."
---

<!-- GENERATED from convex-agents content/capabilities/check-updates.json — do not edit by hand. -->

# check-updates

Detect stale Convex components in the current app against the anteater registry and, with explicit user consent, upgrade them one at a time behind a build gate (typecheck + next build). Each upgrade is gated and smoke-tested before the next.

## Workflow

1. Run `curl -fsSL https://graceful-tiger-715.convex.site/check-updates.mjs -o /tmp/cu.mjs && node /tmp/cu.mjs` from the project root.
2. If COMPONENTS_UP_TO_DATE: tell the user; done.
3. If COMPONENTS_STALE=<n>: list each stale entry (component name, installed → current, summary, breaking flag) and ask the user before touching anything.
4. On yes: install the new ref, apply each migration.steps change (delegate convex/ edits to convex-expert), run every migration.gate command.
5. If any gate command fails: revert (git checkout -- . or reinstall old ref) and report; never leave the app half-migrated.
6. Give the user the smoke check (migration.smoke) to run after each successful upgrade.
7. Repeat for each stale component, one at a time.

## Rules

- Never upgrade without an explicit user yes — not even a minor version.
- Gate each component individually before moving to the next.
- breaking:true upgrades require a snapshot (commit or branch) before applying.
- Do not auto-republish a live *.convex.app site after upgrading without user confirmation.
