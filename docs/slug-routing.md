---
summary: "Internal routing contract for skill slugs, OpenClaw extension aliases, and plugin package URLs."
read_when:
  - Changing web slug redirects
  - Adding or renaming official OpenClaw extensions
  - Debugging skill/plugin URL collisions
  - Updating package or skill detail routes
---

# Slug routing

ClawHub has two extension-like registries today:

- Skills, backed by the skill registry and canonical owner/slug pages.
- Plugins, backed by package names and canonical package pages.

The web router deliberately makes both feel close, but it does not collapse the
two namespaces into one database object. The route resolver decides whether a
request is a skill slug, an official OpenClaw plugin alias, or a package route.

## Canonical URLs

Skills:

- Canonical page: `/<owner>/<slug>`
- API detail: `/api/v1/skills/<slug>`

Plugins:

- Canonical page: `/plugins/@scope/name`
- Encoded compatibility page: `/plugins/%40scope%2Fname`
- Security page: `/plugins/@scope/name/security/<scanner>`
- Encoded security compatibility page: `/plugins/%40scope%2Fname/security/<scanner>`

Encoded compatibility routes are npm-style package-name routes. They redirect
with `308` to the readable scoped route so the address bar shows
`/plugins/@openclaw/codex`, not `/plugins/%40openclaw%2Fcodex`.

## Official OpenClaw aliases

Official OpenClaw extension aliases live in
`src/lib/openClawExtensionSlugs.ts`. Each alias maps to one package name:

```ts
codex -> @openclaw/codex
anthropic -> @openclaw/anthropic-provider
kimi -> @openclaw/kimi-provider
kimi-coding -> @openclaw/kimi-provider
```

These aliases come from the OpenClaw extension inventory. Include the folder
slug, package slug, and any user-facing plugin alias when they differ.

For every official alias, these URLs redirect to the canonical plugin page:

- `/<alias>`
- `/openclaw/<alias>`
- `/@openclaw/<alias>`

Example:

```text
/codex -> /plugins/@openclaw/codex
/openclaw/codex -> /plugins/@openclaw/codex
/@openclaw/codex -> /plugins/@openclaw/codex
```

## Route precedence

The effective precedence is:

1. Static app routes win first, such as `/search`, `/settings`, `/plugins`, and
   `/api/...`.
2. A top-level path matching an official OpenClaw extension alias redirects to
   that plugin package.
3. Any other top-level path may resolve through the skill registry and redirect
   to `/<owner>/<slug>`.
4. `/openclaw/<alias>` and `/@openclaw/<alias>` only resolve official OpenClaw
   plugin aliases.
5. Other `/:owner/:slug` paths resolve as skills.
6. `/:owner/:slug` with an unsupported `@scope` owner returns not found instead
   of accidentally resolving a skill by slug.
7. `/plugins/@scope/name` is the readable scoped plugin package route.
8. `/plugins/<name>` probes package candidates in this order: official OpenClaw
   alias package, `@openclaw/<name>`, then the unscoped package name.

This means official OpenClaw aliases are reserved before skills at the root.
That is intentional: `https://clawhub.ai/codex` must show the official OpenClaw
Codex plugin even if a skill named `codex` exists.

## Collision policy

Do not make every `/:owner/:slug` path a universal package route. Owners can
have skills and plugins, and skill slugs are already unique in the skill
registry. Package names have separate npm-like semantics. The only owner-style
plugin redirects currently reserved are for the official OpenClaw owner:

- `/openclaw/<alias>`
- `/@openclaw/<alias>`

Unknown top-level slugs still fall back to skill resolution. Unknown
`@scope/name` owner routes return not found unless a dedicated package route
handles them under `/plugins/...`.

## Adding an official extension

When OpenClaw ships a new extension:

1. Add all expected aliases to `src/lib/openClawExtensionSlugs.ts`.
2. Keep every alias lowercase.
3. Map aliases to the npm package name, usually `@openclaw/<package>`.
4. Add folder, package, and common short aliases when they differ.
5. Run the slug and package route tests.
6. Live-test the route matrix against production after deploy.

The route tests should cover:

- `/<alias>` redirects to `/plugins/@openclaw/<package>`.
- `/openclaw/<alias>` redirects to `/plugins/@openclaw/<package>`.
- `/@openclaw/<alias>` redirects to `/plugins/@openclaw/<package>`.
- `/plugins/%40openclaw%2F<package>` redirects to
  `/plugins/@openclaw/<package>`.
- `/plugins/@openclaw/<package>` renders the plugin page.
- Security routes keep the same readable scoped URL behavior.
