---
name: convex-acquire-domain
description: "Find and buy a domain for the current Convex app through Convex, then bind it (labs; spend action)."
---

<!-- GENERATED from convex-agents content/capabilities/acquire-domain.json — do not edit by hand. -->

# Acquire a domain (labs) — find and buy through Convex

Suggest memorable names for the idea, check live availability + price, then (only on explicit yes) register the chosen domain through Convex and bind it to the deployment.

## Workflow

1. Brainstorm a few on-theme names; check live availability + annual price.
2. Present the top options with prices; wait for an explicit pick.
3. Register through Convex (DNSimple) — a Tier-2 spend action performed by the control plane; the agent never holds the registrar credential.
4. Point DNS at the deployment and attach it as a Convex custom domain; rebind the auth origin (RP_ID/ORIGIN) and re-publish.

## Rules

- Never register without an explicit yes on a specific domain.
- Show the price before registering.
- If the user already owns a domain, hand off to the `domains` capability instead of buying a new one.
- Rebinding the domain changes the auth origin — re-publish after.
