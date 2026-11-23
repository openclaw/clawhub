---
name: convex-env
description: "Set and wire Convex deployment env vars / secrets for the app."
---

<!-- GENERATED from convex-agents content/capabilities/env.json — do not edit by hand. -->

# Manage env vars + secrets

Store secrets as Convex deployment env vars (npx convex env set), read them in any Convex function through the typed `env` export, never commit them.

## Workflow

1. Declare the var in the `env` section of `defineApp` (or `defineComponent` for a component) in `convex.config.ts`, e.g. `env: { KEY: v.string() }`. This generates the typed `env` export. Components don't see the app's env vars, so pass any a component declares through its `.use()` call, e.g. `app.use(myComponent, { env: { KEY: app.env.KEY } })`.
2. `npx convex env set KEY value` (per deployment). For secrets, keep the value out of shell history: omit it to be prompted (`npx convex env set KEY`) or pipe it in on stdin (e.g. `pbpaste | npx convex env set KEY`).
3. Read via `env.KEY` from `import { env } from "./_generated/server"` in queries, mutations or actions. Prefer it over `process.env.KEY`.
4. Never hardcode or commit secrets; `.env.local` values don't reach Convex functions, so set the dev deployment's value too.
5. Confirm it's set with `npx convex env list --names-only`, which lists names without printing the secret values.

## Rules

- Secrets live in Convex env vars, never in code or git.
- Read env vars through the typed `env` export in queries, mutations and actions. `process.env` remains available as a legacy/fallback path, e.g. for existing or third-party code that expects to read env vars there.
- Different deployments need their own values.
- Check what is set with `npx convex env list --names-only`; never print secret values into the conversation.
