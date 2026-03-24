---
summary: "Copy/paste CLI smoke checklist for local verification."
read_when:
  - Pre-merge validation
  - Reproducing a reported CLI bug
---

# Manual testing (CLI)

## Setup

- Ensure logged in: `bun clawhub whoami` (or `bun clawhub login`).
- Optional: set env
  - `CLAWHUB_SITE=https://clawhub.ai`
  - `CLAWHUB_REGISTRY=https://clawhub.ai`

## Smoke

- `bun clawhub --help`
- `bun clawhub --cli-version`
- `bun clawhub whoami`

## Search

- `bun clawhub search gif --limit 5`

## Prod HTTP smoke

- Public prod smoke via Vitest:
  - `bun run test:e2e:prod-http`
- Optional overrides:
  - `CLAWHUB_E2E_SITE=https://clawhub.ai`
  - `CLAWHUB_E2E_SKILL_OWNER=steipete`
  - `CLAWHUB_E2E_SKILL_SLUG=gifgrep`

## Install / list / update

- `mkdir -p /tmp/clawhub-manual && cd /tmp/clawhub-manual`
- `bunx clawhub@beta install gifgrep --force`
- `bunx clawhub@beta list`
- `bunx clawhub@beta update gifgrep --force`

## Publish (changelog optional)

- `mkdir -p /tmp/clawhub-skill-demo/SKILL && cd /tmp/clawhub-skill-demo`
- Create files:
  - `SKILL.md`
  - `notes.md`
- Publish:
  - `bun clawhub publish . --slug clawhub-manual-<ts> --name "Manual <ts>" --version 1.0.0 --tags latest`
- Publish update with empty changelog:
  - `bun clawhub publish . --slug clawhub-manual-<ts> --name "Manual <ts>" --version 1.0.1 --tags latest`

## Delete / undelete (owner/admin)

- `bun clawhub delete clawhub-manual-<ts> --yes`
- Verify hidden:
- `curl -i "https://clawhub.ai/api/v1/skills/clawhub-manual-<ts>"`
- Restore:
  - `bun clawhub undelete clawhub-manual-<ts> --yes`
- Cleanup:
  - `bun clawhub delete clawhub-manual-<ts> --yes`

## Sync

- `bun clawhub sync --dry-run --all`

## Playwright (menu smoke)

Run against prod:

```
PLAYWRIGHT_BASE_URL=https://clawhub.ai bun run test:pw
```

This smoke gate should fail on visible error UI, page errors, and browser
console errors.

Recommended workflow coverage in Playwright:

- home/install-switcher + browse CTA
- `/search` redirect into skills browse
- skills browse -> detail -> owner profile
- souls browse -> detail -> owner profile
- upload signed-out gate
- import signed-out gate
- authenticated upload/import canaries when storage state is configured

Authenticated prod canary:

```
PLAYWRIGHT_BASE_URL=https://clawhub.ai \
PLAYWRIGHT_AUTH_STORAGE_STATE=/path/to/storage-state.json \
bunx playwright test e2e/upload-auth-smoke.pw.test.ts
```

Capture `storage-state.json` once with Playwright or browser devtools after GitHub login.

Run against a local preview server:

```
bun run test:e2e:local
```
