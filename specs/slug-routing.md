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

Publisher profiles:

- Canonical page: `/<handle>`
- Legacy compatibility pages: `/user/<handle>`, `/p/<handle>`, `/u/<handle>`,
  and `/orgs/<handle>` redirect to `/<handle>`
- Existing publisher handles that predate an official OpenClaw alias remain
  reachable at `/user/<handle>` so the alias can keep its canonical top-level
  shortcut.

Skills:

- Canonical page: `/<owner>/skills/<slug>`
- Legacy compatibility page: `/<owner>/<slug>` redirects to
  `/<owner>/skills/<slug>`
- Security audit page: `/<owner>/skills/<slug>/security-audit`
- Legacy security audit page: `/<owner>/<slug>/security-audit` redirects to
  `/<owner>/skills/<slug>/security-audit`
- Legacy scanner pages: `/<owner>/<slug>/security/:scanner` and
  `/<owner>/skills/<slug>/security/:scanner` redirect to
  `/<owner>/skills/<slug>/security-audit`
- API detail: `/api/v1/skills/<slug>`

Plugins:

- Canonical page: `/<publisher>/plugins/<slug>`
- Legacy readable scoped page: `/plugins/@scope/name`
- Encoded compatibility page: `/plugins/%40scope%2Fname`
- Security audit page: `/<publisher>/plugins/<slug>/security-audit`
- Legacy readable scoped security page: `/plugins/@scope/name/security-audit`
- Encoded security compatibility page: `/plugins/%40scope%2Fname/security-audit`
- Legacy scanner pages redirect to the corresponding plugin security audit page.

Bare `/<handle>` routes are profile routes after static routes and official
OpenClaw plugin aliases have won precedence.

Encoded compatibility routes are npm-style package-name routes. They redirect
with `308` to the readable scoped route so the address bar shows
`/openclaw/plugins/codex`, not `/plugins/%40openclaw%2Fcodex`.

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
/codex -> /openclaw/plugins/codex
/openclaw/codex -> /openclaw/plugins/codex
/@openclaw/codex -> /openclaw/plugins/codex
```

## Route precedence

The effective precedence is:

1. Static app routes win first, such as `/search`, `/settings`, `/plugins`, and
   `/api/...`.
2. A top-level path matching an official OpenClaw extension alias redirects to
   that plugin package.
3. Any other top-level path may resolve as a publisher profile.
4. Unknown top-level paths may still resolve through the historical skill slug
   fallback and redirect to `/<owner>/skills/<slug>`.
5. `/openclaw/<alias>` and `/@openclaw/<alias>` only resolve official OpenClaw
   plugin aliases.
6. Other `/:owner/:slug` paths are legacy skill routes and redirect to
   `/:owner/skills/:slug`.
7. `/:owner/:slug` with an unsupported `@scope` owner returns not found instead
   of accidentally resolving a skill by slug.
8. `/:owner/plugins/:slug` is the canonical publisher plugin route.
9. `/plugins/@scope/name` and `/plugins/<name>` remain compatibility routes.
   `/plugins/<name>` probes package candidates in this order: official OpenClaw
   alias package, `@openclaw/<name>`, then the unscoped package name.

This means official OpenClaw aliases are reserved before skills at the root.
That is intentional: `https://clawhub.ai/codex` must show the official OpenClaw
Codex plugin even if a skill named `codex` exists.

Publisher handle creation and rename paths reserve the full official alias set.
This prevents new profiles from taking over those top-level plugin shortcuts.

## Collision policy

Do not make every `/:owner/:slug` path a universal package route. Owners can
have skills and plugins, and skill slugs are already unique in the skill
registry. Package names have separate npm-like semantics. Publisher plugin
routes must include the `plugins` segment.

Unknown top-level slugs still fall back to skill resolution. Unknown
`@scope/name` owner routes return not found unless a dedicated package route
handles them under `/:owner/plugins/...` or the legacy `/plugins/...`
compatibility routes.

Skill write paths must reject platform and trust-signal namespace squatting.
Exact route/brand/role words are reserved, and slugs that start or end with
protected affixes such as `openclaw-`, `-openclaw`, `official-`, or
`-official` are blocked unless an internal/admin path explicitly bypasses the
reserved list for a controlled migration.

Historical slug redirects are also bounded. Rename and merge may preserve old
slugs as aliases, but a single skill can keep at most five historical slug
redirects and an owner/publisher can keep at most 25. These limits prevent
alias-hoarding while preserving ordinary rename and duplicate-merge redirects.

Owner-initiated unpublishes must not reserve a slug forever. When an owner
soft-deletes a skill, the slug remains reserved for 30 days so they can restore
or republish accidental deletes. After that TTL, availability checks may show
the slug as claimable and the next publish by another owner lazily moves the old
hidden row to an internal `__unpublished_<skill-id>` slug before creating the new
skill. That internal namespace must remain outside the public slug validator and
the release path must collision-check both skill slugs and historical aliases
before patching the hidden row. The audit actor for a lazy release is the caller
who triggered the post-expiry claim; the previous owner is preserved in audit
metadata. The release path may honor a stored reservation timestamp only while
the current hide provenance is still owner-initiated (`hiddenBy === ownerUserId`).
Moderator/security hides are not owner unpublishes and do not expire.

## Adding an official extension

When OpenClaw ships a new extension:

1. Add all expected aliases to `src/lib/openClawExtensionSlugs.ts`.
2. Keep every alias lowercase.
3. Map aliases to the npm package name, usually `@openclaw/<package>`.
4. Add folder, package, and common short aliases when they differ.
5. Run the slug and package route tests.
6. Live-test the route matrix against production after deploy.

The route tests should cover:

- `/<alias>` redirects to `/openclaw/plugins/<package>`.
- `/openclaw/<alias>` redirects to `/openclaw/plugins/<package>`.
- `/@openclaw/<alias>` redirects to `/openclaw/plugins/<package>`.
- `/plugins/%40openclaw%2F<package>` redirects to
  `/openclaw/plugins/<package>`.
- `/plugins/@openclaw/<package>` redirects to `/openclaw/plugins/<package>`.
- `/openclaw/plugins/<package>` renders the plugin page.
- Security routes keep the same canonical publisher plugin URL behavior.
