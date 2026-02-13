---
summary: 'System overview: web app + Convex backend + CLI + shared schema.'
read_when:
  - Orienting in codebase
  - Tracing a user flow across layers
---

# Architecture

## Pieces

- Web app: TanStack Start (React) under `src/`.
- Backend: Convex under `convex/` (DB, storage, actions, HTTP routes).
- CLI: `packages/clawdhub/` (published as `clawhub`, legacy `clawdhub`).
- Shared schemas/routes: `packages/schema/` (`clawhub-schema`).

## Data + storage

- Skill “bundle” = versioned set of text files stored in Convex `_storage`.
- Metadata extracted from `SKILL.md` frontmatter.
- Stats stored on `skills` (downloads, installs, stars, comments, …).

## Main flows

### Browse (web)

- UI reads skill metadata + latest version from Convex queries/actions.
- `SKILL.md` rendered as Markdown.

### Search (HTTP)

- `/api/v1/search?q=...` routes to Convex action for vector search.
- Embeddings currently generated during publish.

### Install (CLI)

- Resolve latest version via `/api/v1/skills/<slug>`.
- Download zip via `/api/v1/download?slug=...&version=...`.
- Extract into `./skills/<slug>` (default).
- Persist install state:
  - `./.clawhub/lock.json` (per workdir, legacy `.clawdhub`)
  - `./skills/<slug>/.clawhub/origin.json` (per skill folder, legacy `.clawdhub`)

### Update (CLI)

- Hash local files, call `/api/v1/resolve?slug=...&hash=<sha256>`.
- If local matches a known version → use that for “current”.
- If local doesn’t match:
  - refuse by default
  - or overwrite with `--force`

### Publish (CLI)

- Publish via `POST /api/v1/skills` (multipart; requires Bearer token).

### Sync (CLI)

- Scan roots for skill folders (contain `SKILL.md`).
- Compute fingerprint; compare to registry state.
- Optionally reports telemetry (see `docs/telemetry.md`).
- Publishes new/changed skills (skips modified installed skills inside install root).
