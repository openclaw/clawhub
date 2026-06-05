# GitHub-backed skills

GitHub-backed skills are source-backed ClawHub catalog entries. ClawHub indexes
metadata, security state, and display content, but the install artifact remains
the upstream GitHub repository at a specific commit.

This exists for trusted upstream catalogs such as `NVIDIA/skills`, where the
publisher wants one canonical source of truth and does not want ClawHub to
republish byte copies as if they were ClawHub-owned artifacts.

## Model

There are two ClawHub skill models:

- Hosted upload: ClawHub stores versioned skill artifacts and installs from
  ClawHub bytes.
- GitHub-backed: ClawHub stores catalog metadata and cached Markdown for display,
  then install/update resolves to GitHub source bytes at a commit.

For GitHub-backed skills, `skills.latestVersionId` is normally absent. The real
install identity is the GitHub commit and skill-folder content hash:

- `githubCurrentCommit`: upstream repo commit currently known by ClawHub
- `githubCurrentContentHash`: hash of the skill folder content at that commit
- `githubScanStatus`: ClawHub security result for that exact content hash

If an upstream manifest includes a version-like field for a skill, ClawHub may
display it, but it is not the install identity. The commit is the install
version.

## Source Tables

`githubSkillSources` represents a synced GitHub skills repository:

- `repo`: GitHub `owner/repo`, for example `NVIDIA/skills`
- `ownerPublisherId`: ClawHub publisher that owns the synced catalog
- `defaultBranch`: optional branch value discovered from GitHub
- `displayManifestKind`: currently only `skills.sh`
- `displayManifestCommit`, `displayManifestHash`, `displayManifestFetchedAt`
- `displayManifestStatus` and `displayManifest`
- sync status and invalid-skill diagnostics

`githubSkillContents` stores display-only content for individual source-backed
skills:

- `skillMarkdown` and source path for `SKILL.md`
- optional `skillCardMarkdown` and source path for `skill-card.md`
- `githubCommit` and `githubContentHash` that the cached content came from

This table is not an install artifact store. OpenClaw must not install from
`githubSkillContents`.

`skills` stores the public catalog row and install state:

- `installKind: "github"`
- `githubSourceId`
- `githubPath`
- `githubHasSkillCard`
- `githubCurrentCommit`
- `githubCurrentContentHash`
- `githubCurrentStatus`: `present`, `missing`, or `unknown`
- `githubCurrentCheckedAt`
- `githubScanStatus`: `pending`, `clean`, `suspicious`, `malicious`, or `failed`
- `githubRemovedAt`

## Publisher Gate

GitHub-backed source sync is official-publisher-only for now.

Official means an exact row exists in `officialPublishers` for the publisher.
It is not inherited from org membership, GitHub identity, OIDC, or
`trustedPublisher`.

Default official publishers are not seeded from deploy. Maintainers should mark
`openclaw` and `nvidia` official explicitly using the moderation/admin CLI
before enabling their source sync.

## Sync

ClawHub owns the sync loop. Upstream repositories do not push payloads into
ClawHub.

The production cron runs every 15 minutes:

```text
github-skill-source-sync -> githubSkillSync.syncGitHubSkillSourcesInternal
```

That cron fetches the current public GitHub repo, reads `skills.sh.json`, builds
a source snapshot, and applies it to ClawHub. Pagination must use a stable source
cursor, not `updatedAt`, because syncing a row updates the row.

Sync must not pass the full repo Markdown payload through one large Convex
mutation. The intended split is:

1. Apply source metadata and skill state.
2. Fetch small target rows for changed/current skills.
3. Persist `SKILL.md` / `skill-card.md` content per skill.

## Manifest Rendering

The only supported display manifest today is `skills.sh.json`.

ClawHub parses it into the structured `displayManifest` shape used by publisher
profile rendering. The UI should not interpret arbitrary raw manifest JSON at
render time.

Unsupported, invalid, or missing manifest data should not block the source sync.
The catalog can still render skills in the normal fallback order.

Repo labels such as `NVIDIA/skills` and "Source-backed" chrome are implementation
details and should not be required visible UI copy.

## Security Invariants

GitHub-backed security scanning follows the same core invariant as hosted
uploads:

> A normal install/update may only install content whose exact current content
> hash has a clean ClawHub scan result.

When a new source-backed skill appears or an existing skill's content hash
changes:

- set `githubScanStatus: "pending"`
- hide the skill from public installability with `moderationStatus: "hidden"`
  and `moderationReason: "pending.scan"`
- enqueue verification for the current content hash

When verification succeeds cleanly:

- set `githubScanStatus: "clean"`
- make the skill active/installable

When verification fails, is suspicious, or is malicious:

- keep/block the skill from normal install
- return a structured install block such as `github_scan_failed`

If the upstream path disappears:

- set `githubCurrentStatus: "missing"`
- set `githubRemovedAt`
- hide the skill with `moderationReason: "github.upstream.removed"`
- block install/update with `github_upstream_removed` or
  `github_upstream_missing`

The row may remain for audit/history, but users must not silently install an old
ClawHub-cached revision after upstream removed or changed it.

## Install Resolver

Normal install/update resolves through ClawHub:

```text
OpenClaw -> ClawHub install resolver -> pinned GitHub descriptor
```

For clean GitHub-backed skills, ClawHub returns:

```json
{
  "ok": true,
  "installKind": "github",
  "github": {
    "repo": "NVIDIA/skills",
    "path": "skills/aiq-deploy",
    "commit": "<40-char sha>",
    "contentHash": "<skill-folder hash>",
    "sourceUrl": "https://github.com/NVIDIA/skills/tree/<sha>/skills/aiq-deploy"
  }
}
```

OpenClaw downloads the GitHub archive for that commit and extracts only the skill
path. The local lock/origin version is the commit SHA.

Pending verification keeps the skill visible in ClawHub search and detail UI,
but normal install/update returns a structured block:

```json
{
  "ok": false,
  "reason": "github_verification_pending",
  "status": 423,
  "message": "GitHub-backed skill security scan is in progress. Try again shortly, or rerun with --force-install to install the unverified upstream commit."
}
```

`--force-install` may bypass only pending GitHub-backed verification. It must not
bypass failed, suspicious, malicious, missing, or removed upstream states.

## No Mirror Contract

ClawHub must not create hosted `skillVersions` or ClawHub download artifacts for
GitHub-backed skills.

This avoids two NVIDIA concerns:

- Signature drift: any byte-level transformation in a mirror can invalidate
  upstream detached signatures.
- Stale security chain: if a mirror lags after upstream update/removal, users
  might silently install old bytes.

Because installs use GitHub source at a specific commit, ClawHub does not claim
to preserve or verify upstream OMS signatures in v1. Signature verification can
be added later as an additional verification input, but it must not require
ClawHub to republish transformed skill bytes.

## UI

Publisher profiles may group GitHub-backed skills by the parsed `skills.sh.json`
manifest. Skill detail pages read cached `SKILL.md` and optional `skill-card.md`
from `githubSkillContents`.

UI display state is advisory. Installability is controlled by the install
resolver and current scan/upstream state, not by stale cached UI metadata.

## Testing Expectations

Keep coverage for:

- configuring only official publishers
- parsing `skills.sh.json`
- 15-minute cron registration
- new skill -> pending scan -> blocked install
- changed content hash -> pending scan -> no stale commit served
- clean verification -> pinned GitHub install descriptor
- failed/suspicious/malicious scan -> blocked install
- removed upstream path -> hidden/blocked install
- cached `SKILL.md` and `skill-card.md` display content
- no `skillVersions` for GitHub-backed skills
- OpenClaw installing the pinned GitHub commit/path rather than ClawHub bytes
