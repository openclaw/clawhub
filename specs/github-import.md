---
summary: "Feature spec: import a skill from a public GitHub URL (auto-detect SKILL.md, selective file upload, provenance)."
read_when:
  - Adding GitHub import (web + API)
  - Reviewing safety limits (SSRF/zip-bombs)
  - Implementing provenance + canonical-claim flows
---

# GitHub import (public repos)

## CLI

For plugin authors, the recommended GitHub import path is now the CLI:

```bash
clawhub package publish owner/repo
clawhub package publish owner/repo@v1.0.0
clawhub package publish https://github.com/owner/repo

# Preview only
clawhub package publish owner/repo --dry-run

# CI-friendly output
clawhub package publish owner/repo --dry-run --json
```

This keeps package metadata zero-config where possible and auto-populates GitHub provenance.

Goal: paste a GitHub URL → auto-detect skill → preview files → publish (selective) → persist provenance.

Non-goal (v1): private repos (no OAuth/PAT support).

Related:

- `docs/skill-format.md` (what counts as a skill; text-only limits)
- `docs/api.md` / `docs/http-api.md` (REST patterns + auth)

## UX

Upload page: “Import from GitHub” mode.

Flow:

1. URL input
2. Detect skill candidates (SKILL.md)
3. If multiple candidates: choose one
4. File picker: check/uncheck; smart-select referenced files
5. Confirm slug/name/version/tags
6. Import → publish

## Accepted URLs

Allowlist: `https://github.com/...` only.

Supported shapes:

- Repo root: `https://github.com/<owner>/<repo>`
- Tree path: `https://github.com/<owner>/<repo>/tree/<ref>/<path>`
- Blob path (file): `https://github.com/<owner>/<repo>/blob/<ref>/<path>`

Normalization:

- Strip query/hash for fetch.
- From `blob/.../SKILL.md` derive `path` as parent folder.
- If `ref` missing: use `HEAD`.

Reject:

- Non-GitHub hosts.
- Unknown URL patterns.
- Paths containing `..` after normalization.

## Fetch strategy (public)

Download archive:

- `https://github.com/<owner>/<repo>/archive/<ref>.zip`
- Follow redirects. Final redirect usually pins a commit via `codeload.github.com/.../zip/<sha-or-branch>`.

Unzip server-side (Node or Convex node action). Scan for skill candidates.

Skill candidate definition:

- Any folder containing `SKILL.md` or `skill.md` (also accept `skills.md` for compatibility).
- Treat repo root as a folder too.

Multiple skills:

- Return candidate list: `{ path, frontmatter.name, frontmatter.description }`.
- User chooses one.

## Smart file selection

Defaults:

- Always select `SKILL.md` (or chosen readme file).
- Prefer selecting only within chosen skill folder; allow “include out-of-folder refs” if explicitly toggled.

Referenced file expansion:

- Parse Markdown links/images from selected `.md` files:
  - `[](<rel>)`, `![](<rel>)`, `<rel>` only when relative.
  - Ignore `http(s):`, `mailto:`, `#anchors`.
  - Strip query/hash from relative targets.
- Resolve against the current file’s directory.
- Normalize, reject escapes (`..`).
- Add referenced file if present in archive and is text-allowed.
- Recurse for newly added `.md` files.

Hard caps:

- Max recursion depth (e.g. 4).
- Max referenced additions (e.g. 200).

UI affordances:

- “Select referenced”
- “Select all text”
- “Clear”
- Search/filter by path

## Publish behavior

Server publishes using existing pipeline:

- Text-only enforced (see `docs/skill-format.md`).
- Total ≤ 50MB (selected set).
- Must include `SKILL.md` (or accepted variant).

Suggested defaults (UI):

- `displayName`: frontmatter `name` else folder basename → title case.
- `slug`: sanitize folder basename; if collision, suffix (`-2`, `-3`, …).
- `version`: if new skill → `0.1.0`; if updating own existing skill → bump patch.
- `tags`: default `latest`.

## Provenance (persist source)

Persist on each published version (server-side injection; no mutation of imported files):

- Store in `skillVersions.parsed.metadata.source`:

Example:

```json
{
  "kind": "github",
  "url": "https://github.com/visionik/ouracli",
  "repo": "visionik/ouracli",
  "ref": "HEAD",
  "commit": "66ac8fb266b7c5ff6519431862be6a375bbfb883",
  "path": "",
  "importedAt": 1767930000000
}
```

Why `parsed.metadata`:

- Already optional and stored with each version.
- No schema churn for v1.

Future: canonical-claim

- “claim canonical” can key off `{ kind:'github', repo, path }`.
- Prefer commit-pinned provenance for auditability; allow UI to show “Imported from …”.

## API sketch (internal actions)

Two-step (recommended):

- `previewGitHubImport(url)` → `{ commit, candidates:[...], files:[...], defaults:{...} }`
- `importGitHubSkill({ url, commit, candidatePath, selectedPaths, slug, displayName, version, tags })`

Notes:

- `importGitHubSkill` should re-fetch by pinned `commit` (not floating branch), to avoid TOCTOU.
- Validate `selectedPaths` subset of fetched archive manifest.

## Security / abuse controls

SSRF:

- Only `github.com` (+ `codeload.github.com` during redirect follow).
- No arbitrary redirects to other hosts.

Zip safety:

- Max compressed bytes (from `Content-Length` if present; else streaming cap).
- Max uncompressed total bytes.
- Max file count.
- Max single file size.
- Reject symlinks; reject absolute paths; reject `..` segments.

Rate limits:

- Tie to existing write limits (import == publish).
- Cache preview results briefly (e.g. 60s) keyed by `{repo, commit}`.

Error UX:

- “No SKILL.md found.”
- “Multiple skills found; pick one.”
- “Repo too large / too many files.”
- “Selected files exceed 50MB.”

## Manual test checklist

- Repo root skill (`SKILL.md` at root).
- Nested skill (`skills/foo/SKILL.md`).
- Multi-skill repo (two SKILL.md).
- SKILL.md references `docs/usage.md` + images; smart-select picks `.md` and referenced text files; ignores external links.
- Huge repo → clean “too large” error.
- Redirect pinning → import stores commit sha in provenance.
