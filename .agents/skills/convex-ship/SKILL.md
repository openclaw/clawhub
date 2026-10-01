---
name: convex-ship
description: "Publish the current Convex app to a live *.convex.app URL (deploy backend + upload web build)."
---

<!-- GENERATED from convex-agents content/capabilities/ship.json — do not edit by hand. -->

# Ship the app live

Take the current project from local to a live, shareable URL: deploy the Convex backend to the cloud (claiming the anonymous deployment if needed), build the web app, and publish it to *.convex.app.

## Workflow

1. If on an anonymous deployment, claim/persist it to the cloud (Tier-2 sign-in).
2. `convex deploy` the backend.
3. Build the web app (static export) and upload via the moderated publish gateway → returns the *.convex.app URL.
4. Give the user the live URL; offer a custom domain (own one → `domains`; find/buy → `labs-acquire-domain`).

## Rules

- Publishing is a privileged action — it runs through the control plane after the moderation gate; the agent never holds the deploy key.
- Confirm before publishing (it produces a public URL).
- Offer a custom domain after a successful publish: `domains` if the user owns one, `labs-acquire-domain` to find/buy.
