---
name: convex-explain-app
description: "Explain an existing Convex app — data model + relationships, public vs internal functions, auth/ownership model, components, a request→data flow — read from the schema and function surface. Read-only."
---

<!-- GENERATED from convex-agents content/capabilities/explain-app.json — do not edit by hand. -->

# Explain this Convex app

Before you can safely change an app you have to know what it is — and reading 15 function files top-to-bottom is slow and error-prone. This capability produces the map fast and accurately by reading the two sources that can't lie: the schema (the data model) and the function surface (`functionSpec` / the exported queries/mutations/actions). It is deliberately DESCRIPTIVE — it explains what IS, hands judgment to the audit capabilities and changes to the fixers. It is also the natural first step of an optimize or self-heal session, and the reusable 're-explain the current architecture' that 'change what you built' depends on.

## Workflow

1. DETECT the app: the `convex/` directory, `schema.ts`, and whether a deployment exists (if one does, `functionSpec`/`tables` via the official MCP give the authoritative live surface; if not, read the source directly). deploy-guard classifies any deployment read as read-only.
2. DATA MODEL: from `schema.ts`, list every table with its fields and, crucially, its RELATIONSHIPS — which `v.id("other")` fields point where, and which indexes exist (indexes reveal the intended access paths). Draw the foreign-key graph in words: 'tasks belong to projects (projectId) and users (ownerId); messages belong to conversations'.
3. FUNCTION SURFACE: enumerate every exported function, split PUBLIC (query/mutation/action — the attack/API surface) from INTERNAL (internalQuery/... — not client-reachable), and for each give a one-line 'what it does + what it touches'. The public/internal split is the single most important thing a newcomer needs and the thing source-skimming most often gets wrong.
4. AUTH / OWNERSHIP MODEL: state how identity is established (auth.config.ts provider? a users table keyed by tokenIdentifier?) and how ownership is enforced (is there a requireOwner-style check? which field is the owner?). Say plainly if there is NO auth foundation — that is load-bearing context for anyone about to change the app. (Describe the model; do not audit it for holes — that's convex-authz.)
5. COMPONENTS + EXTERNAL EDGES: list the `@convex-dev/*` components installed (convex.config.ts) and what they provide, the HTTP routes (http.ts) and crons, and any external calls in actions (which APIs, which env vars).
6. FLOW: trace 1-2 representative end-to-end paths ('client calls createTask → validates → inserts into tasks scoped to the caller → listMyTasks reads it back by the by_owner index') so the reader sees the moving parts connected, not just catalogued.
7. PRESENT as a scannable map (data model → public/internal functions → auth model → components/edges → a flow or two), accurate to the source. End by pointing at the next verbs: convex-reviewer/convex-authz to audit it, launch-readiness to score it, design/convex-expert to extend it. Never invent behavior the source doesn't show; if something is ambiguous, say so rather than guessing.

## Rules

- Read the schema + function surface (functionSpec/source) as the source of truth — never describe behavior the code doesn't show; flag ambiguity instead of guessing.
- Lead with the two things a newcomer most needs and skimming most often gets wrong: the data-model relationship graph and the public-vs-internal function split.
- State the auth/ownership model plainly, including 'there is no auth foundation' when that's the case — but DESCRIBE it; auditing it for holes is convex-authz's job.
- Descriptive, not evaluative: explain-app maps what IS and hands judgment to the audit capabilities and changes to the fixers.
- Read-only: any deployment introspection is read-only (deploy-guard); the app is not modified.
- End by pointing at the right next verb (audit → reviewer/authz, score → launch-readiness, extend → design/expert).
