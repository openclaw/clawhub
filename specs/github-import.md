---
summary: "Feature spec: import skills from owned public GitHub repos (auto-detect SKILL.md, selective file upload, provenance)."
read_when:
  - Adding GitHub import (web + API)
  - Reviewing safety limits (SSRF/zip-bombs)
  - Implementing provenance + canonical-claim flows
---

# GitHub import (owned public repos)

Import is restricted to public repositories owned by the signed-in user's
current GitHub account. Server-side validation must compare the repository
owner's immutable GitHub numeric id with the caller's GitHub
`providerAccountId` before previewing candidates or downloading archives.

Do not allow importing another user's public repository through the dashboard,
repo picker, or manual `/import` URL path.

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

Goal: choose one detected `SKILL.md` or legacy `skills.md` candidate from the
signed-in user's owned public GitHub repositories, then preview files → publish
(selective) → persist provenance.

Non-goal (v1): private repos (no OAuth/PAT support).

Related:

- `docs/skill-format.md` (what counts as a skill; artifact limits)
- `docs/api.md` / `docs/http-api.md` (REST patterns + auth)

## UX

Upload page: “Import from GitHub” mode.

Use a functional picker, not a marketing landing page. The first viewport should
make the GitHub import job obvious: account, search, detected skill rows, and
the review state after selection. Design references can use hero-level presence,
but the control surface remains the product.

Flow:

1. Scan the signed-in user's owned public repos
2. List only detected skill candidates (`SKILL.md` or legacy `skills.md`)
3. If multiple candidates: choose one
4. File picker: check/uncheck; smart-select referenced files
5. Confirm slug/name/version/tags
6. Import → publish

Manual URL import is not part of the dashboard picker. Backend preview/import
still accepts the older repo root, tree path, and blob path shapes for
internal/API callers, but only when the URL's repository is owned by the
signed-in user's GitHub account. Blocking third-party public repo imports is an
intentional product/security boundary for new import attempts; it does not
migrate or alter skills that were already published.

Picker details:

- Search is the primary control.
- Rows represent importable skill candidates, not raw repositories.
- A root skill file row uses the repo name.
- A nested skill file row uses the containing folder/project name.
- Rows also show the source repository name.
- Search only appears when there are more than 10 detected candidates.
- Repos without `SKILL.md` or legacy `skills.md`, private repos, forks, repos
  owned by someone else, archived repos, and disabled repos do not appear.
- Do not show private repo prompts, org switchers, or OAuth permission upsells.

## Accepted URLs

Allowlist: `https://github.com/...` only.

Supported shapes:

- Repo root: `https://github.com/<owner>/<repo>`
- Tree path: `https://github.com/<owner>/<repo>/tree/<ref>/<path>`
- Blob path (file): `https://github.com/<owner>/<repo>/blob/<ref>/<path>`

Normalization:

- Strip query/hash for fetch.
- From `blob/.../SKILL.md` or `blob/.../skills.md` derive `path` as parent folder.
- If `ref` missing: use `HEAD`.

Reject:

- Non-GitHub hosts.
- Unknown URL patterns.
- Paths containing `..` after normalization.

## Fetch strategy (public)

Before archive download or preview:

- Resolve the caller's GitHub `providerAccountId` from `authAccounts`.
- Fetch the current GitHub login by immutable numeric id.
- Fetch repository metadata from `GET /repos/{owner}/{repo}`.
- Reject unless `private === false`, `visibility === "public"` when present,
  and `repo.owner.id === providerAccountId`.

Picker discovery:

- When a server `GITHUB_TOKEN` is configured, discover candidates with GitHub
  Code Search (`filename:SKILL.md user:<login>` and
  `filename:skills.md user:<login>`) and filter every result through the
  owned-public repo validation above.
- Do not recursively scan every public repository on page load when Code Search
  is available.
- Without a token, use a bounded repo-page fallback and recursive tree scans only
  for that bounded page.
- If GitHub reports a truncated recursive tree, fall back to archive candidate
  detection for that repository instead of silently omitting it.

Preview/import archive:

- `https://github.com/<owner>/<repo>/archive/<ref>.zip`
- Follow redirects. Final redirect usually pins a commit via `codeload.github.com/.../zip/<sha-or-branch>`.

Unzip server-side (Node or Convex node action). Scan for skill candidates and
selected files.

Skill candidate definition:

- Any repo root or folder containing a real `SKILL.md` file or legacy
  `skills.md` file.
- A `blob/.../SKILL.md` or `blob/.../skills.md` URL targets that file's parent
  folder.
- Do not treat README files, package metadata, repository names, or inferred
  project folders as importable candidates.
- Treat repo root as a folder too.

Multiple skills:

- Return candidate list: `{ path, frontmatter.name, frontmatter.description }`.
- User chooses one.

## Smart file selection

Defaults:

- Always select the detected skill file.
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
- “Select all”
- “Clear”
- Search/filter by path

## Publish behavior

Server publishes using existing pipeline:

- All bounded regular files are preserved (see `docs/skill-format.md`).
- Total ≤ 50MB (selected set).
- Must include the detected skill file.

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

Primary picker flow:

- `listOwnedPublicGitHubRepos({ page, perPage, query? })` → detected owned
  public candidates.
- `previewGitHubImportCandidate(...)` → commit, selected-file preview, and
  suggested publish defaults.
- `importGitHubSkill(...)` → publish the selected candidate from a pinned commit.

Notes:

- `previewGitHubImport(url)` remains available for internal/API callers, but the
  dashboard picker must not expose arbitrary public URL import.
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

- “No SKILL.md or skills.md found.”
- “Multiple skills found; pick one.”
- “Repo too large / too many files.”
- “Selected files exceed 50MB.”

## Manual test checklist

- Repo root skill (`SKILL.md` at root).
- Legacy root skill (`skills.md` at root).
- Nested skill (`skills/foo/SKILL.md` or `skills/foo/skills.md`).
- Multi-skill repo (two skill files).
- Skill file references `docs/usage.md` + images; smart-select picks `.md` and referenced text files; ignores external links.
- Huge repo → clean “too large” error.
- Redirect pinning → import stores commit sha in provenance.
