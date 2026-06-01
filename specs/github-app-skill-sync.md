---
summary: "Durable invariants for GitHub App repository sync of source-managed skills."
read_when:
  - Changing GitHub App install, webhook, or repository sync behavior
  - Changing source-managed skill publish boundaries
  - Reviewing org/manual skill ownership interactions
---

# GitHub App Skill Sync

This note captures the behavior that must survive refactors. Public setup docs
belong in `docs/`; this file is for maintainer-facing invariants and trust
boundaries.

## Core Invariant

Linking a ClawHub org to GitHub does not make every org skill source-managed.
Only skills with a non-disabled `skillSourceLinks` row for a linked repository
path are controlled by GitHub sync.

Manual, CLI-managed, imported, or otherwise non-source-linked skills can remain
in the same org. Repository sync must not create, update, delete, rename,
restore, or retag those skills unless an org admin explicitly adopts the skill
into a source link first.

## Source Ownership

- A repository sync job may publish only through an exact source link for that
  repository and path.
- A manual publish to a source-managed skill is rejected unless the source link
  has been disabled first.
- Disabled source links are no longer authoritative. After unlinking, normal
  manual publish behavior applies.
- A discovered repository candidate that collides with an existing manual org
  skill slug becomes a source-link conflict. It must not overwrite the manual
  skill.
- Adopting an existing manual skill into sync requires admin rights on the
  publisher, a matching skill owner publisher, a matching slug, and no other
  non-disabled source link for that skill.
- GitHub sync still uses the normal publish pipeline, including parser,
  scanner, quality, moderation, ownership, and version rules. Sync must not lift
  moderation or bypass bans.

## Install Handshake

The GitHub App setup handshake is intentionally multi-step:

1. A publisher admin starts setup from ClawHub.
2. ClawHub creates a short-lived HMAC-signed state and stores only a hash plus
   nonce, publisher id, requesting user id, optional target GitHub account id,
   and expiry.
3. GitHub redirects back with an installation id and the signed state.
4. ClawHub verifies the state signature, stored hash, nonce, expiry,
   single-consumption status, requesting user, and current publisher admin role.
5. ClawHub fetches the installation with a GitHub App JWT.
6. User-account installs are accepted only when the installation account id
   matches the current ClawHub user's GitHub provider account id.
7. Organization installs require a target GitHub account id in the setup state
   and a signed GitHub installation webhook claim whose installation account id
   matches that target and whose sender account id matches the current ClawHub
   user's GitHub provider account id.

The webhook claim is what ties an org installation redirect to the GitHub user
who performed the install. If the redirect outruns the webhook, completion
should fail cleanly and can be retried after the webhook arrives.

Repository links created by an installation are disabled by default. A publisher
admin must explicitly enable sync for each repository.

## UI Rollout Gate

During internal rollout, the ClawHub UI must expose GitHub Sync controls only to
users who are both:

- owners or admins of the target ClawHub org publisher; and
- members of the `openclaw` ClawHub publisher.

This gate is intentionally a rollout/discoverability gate, not the durable
authorization boundary. Backend GitHub sync functions must continue to enforce
the target publisher admin role themselves.

## Runtime Proof Before Wide Release

Before removing the internal UI rollout gate or treating the feature as broadly
available, capture redacted proof from a real configured GitHub App install:

1. Start setup from an eligible ClawHub org publisher and record the generated
   GitHub App install URL with the signed `state` value redacted.
2. Complete an org installation and confirm the callback succeeds only after the
   matching signed installation webhook claim is received.
3. Confirm newly discovered repositories are present but disabled by default.
4. Enable one repository, configure branch/roots, and queue a manual sync.
5. Push a commit to the configured ref and confirm GitHub webhook delivery
   queues or coalesces the repository sync job.
6. Confirm the sync creates or updates the expected source-managed skill version
   through the normal publish/scanner pipeline.
7. Attempt a manual publish to the active source-managed skill and confirm it is
   rejected until the source link is disabled.
8. Remove or suspend repository access and confirm affected repository/source
   links are disabled while unrelated manual org skills remain untouched.

Acceptable PR proof is redacted terminal output, Convex logs, GitHub webhook
delivery screenshots, ClawHub UI screenshots, or a short recording that covers
the install, webhook claim, repository enablement, sync publish, and manual
publish blocking path.

## Webhook Trust Boundary

- Verify `X-Hub-Signature-256` for every GitHub webhook.
- Deduplicate by `X-GitHub-Delivery`, but mark a delivery processed only after
  event work succeeds. Failed deliveries stay retryable.
- Treat GitHub installation id and repository id as stable identities. Repo
  names may change.
- Repository rename events must update both repository rows and source-link
  `repoFullName` values so source provenance checks continue to match.
- Repository removal, installation deletion, and installation suspension disable
  affected repository links and their non-disabled source links. Manual org
  skills remain untouched.

## Sync Semantics

- Push webhooks queue sync only for enabled repository links whose configured
  ref matches the pushed branch/ref.
- Deletion pushes with GitHub's all-zero `after` SHA are ignored.
- Older queued push jobs for the same repository/ref are cancelled when a newer
  push is queued.
- Sync jobs are serialized per repository so concurrent pushes cannot derive
  and publish the same next version.
- Sync downloads the GitHub archive for the exact commit being processed.
- Candidate discovery can scan all configured roots to mark missing source
  links correctly, but publishing work may be capped per job.
- If candidate file fingerprints are unchanged, sync validates that the source
  link is still publishable and then records the latest commit without storing
  duplicate blobs or creating a new version.
- On failure, repository metadata must preserve the last successful sync commit
  and timestamp.

## Version Security Boundary

Each GitHub sync publish creates an ordinary `skillVersions` row and queues the
normal security scanners for that exact version. Scanner completion must only
promote scan outcomes onto the skill-level moderation row when the scanned
version is still the skill's latest version, so an older async scan result
cannot overwrite the current latest verdict.

Public artifact access must still enforce the requested version's own scan
state. Download, card, raw file, and version-detail endpoints must block a
historical version when that version's stored ClawScan or VirusTotal fields are
malicious or explicitly pending, even if a newer latest version currently
leaves the skill active. Static-scan-only findings remain advisory when
ClawScan/VT do not block the version. Scan and verification endpoints may
remain readable for blocked versions so users and automation can inspect the
reason.

## Required GitHub App Shape

Minimum GitHub App permissions:

- Contents: read-only
- Metadata: read-only

Webhook events:

- `push`
- `installation`
- `installation_repositories`
- `repository`

Required Convex environment:

- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_WEBHOOK_SECRET`
- optional `GITHUB_APP_STATE_SECRET`
