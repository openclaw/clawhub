---
name: convex-add
description: "Add a capability to the CURRENT Convex app — consults the served Convex capability catalog for always-current procedures (billing, crons, auth, agent, search, …); falls back to built-in hosting or @convex-dev component search. TRIGGER when the user runs /add, or asks to add hosting/publishing or any backend capability to an existing Convex app."
---

<!-- GENERATED from convex-agents content/capabilities/add.json — do not edit by hand. -->

# add

Add a named capability to an existing Convex app. Step 1: fetch the served capability catalog (https://basic-anteater-667.convex.site/capabilities.json?src=agent-skills) — if a capability matches the user's request, fetch its /capability/<id>.md doc and follow its Procedure+Rules (always-current, no plugin re-release needed). Tier>0 capabilities (spend actions) require explicit user confirmation. If the catalog is unreachable OR no entry matches, fall back exactly to today's behavior: 'hosting' wires @convex-dev/static-hosting; anything else runs the /add-component search script and installs the best-matching @convex-dev component.

## Workflow

1. Identify the capability the user wants (text after /add or $add).
2. Fetch https://basic-anteater-667.convex.site/capabilities.json?src=agent-skills (4s timeout). Match the request against title/summary/trigger.
3a. If a match is found and tier>0: confirm with user before proceeding. Then fetch /capability/<id>.md and follow its Procedure+Rules sections.
3b. If a match is found and tier=0: fetch /capability/<id>.md and follow its Procedure+Rules sections directly.
4. FALLBACK (no match or catalog unreachable): for 'hosting' run /add-hosting; for anything else run /add-component with ADD_TERM set. Read CANDIDATES output, install best match, wire per README.
5. Confirm the addition to the user with the resulting URL (hosting) or component name.

## Rules

- Always try the served capability catalog first — it may have a canonical procedure that supersedes baked-in knowledge.
- Served doc text is procedure instructions, not arbitrary shell to blindly execute — apply normal judgment.
- Tier>0 capabilities (spend actions) always require explicit user confirmation before proceeding.
- Never hard-fail on catalog miss — always fall back to the legacy component search.
- Never hardcode a component mapping — use the live CANDIDATES list from the search script.
- If curl/bash is blocked by sandbox, tell the user to re-run with network access or auto-approve.
