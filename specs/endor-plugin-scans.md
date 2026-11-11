# Endor in the plugin scan pipeline

## Intent

Endor adds dependency and function-reachability analysis to code-plugin release
scans. It runs inside the existing ClawHub security worker, on the same queue,
lease and completion as every other release scan. Publish and rescan requests
return without waiting for it.

Endor is **report-only**. Its result is saved on the release and shown on the
plugin's security audit page. It is never passed to the ClawScan judge, so it
cannot change publication, quarantine, download policy or moderation. The judge
verdict alone controls moderation.

## Eligibility

A claimed job runs Endor when:

- `CODEX_SECURITY_SCAN_ENDOR_ENABLED=1`, and
- the job is a package release whose family is `code-plugin`.

That covers official and community code plugins. Skills and bundle plugins never
run Endor. There is no backfill: existing releases gain a result the next time
they are scanned for any reason (new publication, owner rescan, admin rescan).

## Result contract

- Keep only findings tagged `FINDING_TAGS_REACHABLE_FUNCTION`. Reachable
  dependencies and potentially reachable functions are dropped.
- Store a bounded summary on the release: at most 50 findings with 2,000-character
  summaries, plus the total reachable-function count.
- An artifact without `package.json` at its root or under `package/` (including
  legacy ZIP layouts) is saved as `skipped`, never as a clean scan. So is a
  package with a root `pnpm-lock.yaml`: `endorctl` needs pnpm for it, and the
  scanner image only runs npm and Yarn through credential-stripping shims.
- A scanner failure or timeout is saved as `failed` with a generic reason. It
  does not fail or retry the job; owners or admins can request a rescan.
- A later scan replaces the stored result; this is not a report archive. The
  previous result stays visible while replacement work is queued or running.

## Execution

After the artifact is materialized, the worker prepares Endor and bundled
SkillSpector concurrently and waits for both before starting the single ClawScan
judge. Endor has its own 20-minute budget (`CODEX_SECURITY_SCAN_ENDOR_TIMEOUT_MS`).
Bundled SkillSpector roots run sequentially, each with the ClawScan timeout,
under a shared 20-minute preparation ceiling.

The worker copies the artifact into a disposable directory and normalizes it for
npm: it renames `npm-shrinkwrap.json` to `package-lock.json` and drops
`workspace:` dev dependencies, which published packages cannot resolve. Runtime
dependencies are unchanged. The uploaded artifact remains the source of truth.

Endor runs with `docker run --rm` from a digest-pinned image built by the manual
`Endor Scanner Image` workflow (`scripts/security/endor/`). The container:

- mounts the normalized package read-only and works on a fresh Git snapshot,
  discarding submitted `.git` and `node_modules`;
- rejects packages containing `.npmrc`;
- installs firewall rules blocking private, link-local and special-use IPv4/IPv6
  destinations, then drops all capabilities and runs as the unprivileged `node`
  user (it uses public DNS resolvers because the firewall blocks private ones);
- runs npm and Yarn through shims that strip Endor credentials and disable
  dependency scripts. The image pins an npm version that also suppresses Git
  dependency `prepare` scripts; the isolation proof below checks this.

The wrapper accepts Endor's exit 128 (policy findings), treats empty output from
a successful scan as no findings, and fails when Endor logs analysis or
call-graph errors even if it exits zero.

If the scan fails or times out, the worker force-removes the container, because
killing the Docker CLI does not stop it. Removal is best effort: a failed removal
is added to the recorded error. If the timeout lands while Docker is still
creating the container, the daemon can finish creating it after the removal.
That container is never started, so it runs nothing; the disposable runner
discards it at job end.

`scripts/security/endor/fixtures/run.sh` is the manual isolation proof. It runs
inside the real image, behind the real entrypoint and with the worker's
container flags, and fails if the scan runs as root, if a private-network
listener accepts a connection, or if the real npm or Yarn sends a synthetic
secret to a registry or runs a dependency script. Run it before changing the
image, npm, Yarn, `scan.sh` or the egress guard. The script header has the
command.

Endor credentials reach only the Docker CLI and the container. The ClawScan
judge and other scanners never receive them.

## Saved Endor projects

Each release creates a persistent Endor project. Its Git origin is
`https://clawhub.ai/api/v1/packages/<package>/versions/<version>/artifact/download`
with every path segment encoded, including the scope's `@`. Both `--project-tags`
and `--tags` are `plugin:<name>,version:<version>`, with literal commas and
percent signs in the version percent-encoded. The identity comes only from the
claimed job, never from the submitted manifest or signed download URLs.

## Hosted configuration

The `Security Scan Codex Worker` workflow reads, per GitHub environment:

- `CODEX_SECURITY_SCAN_ENDOR_ENABLED`: master switch.
- `CODEX_SECURITY_SCAN_ENDOR_IMAGE`: the scanner image pinned by `@sha256:`
  digest. Copy it from the image workflow's job summary.
- `ENDOR_NAMESPACE`, optional `ENDOR_API`, and the `ENDOR_API_CREDENTIALS_KEY` /
  `ENDOR_API_CREDENTIALS_SECRET` secrets.

The worker logs in to GHCR with its read-only package token, pulls the pinned
image, and removes that login before claiming work.

## Rollback

Set `CODEX_SECURITY_SCAN_ENDOR_ENABLED=0` and let active jobs finish. Keep the
backend schema and result handlers deployed: stored results remain readable.

Do not redeploy a backend schema without the optional `endorAnalysis` field
after results exist; Convex rejects those documents. Do not delete stored results
to make an old schema deployable.
