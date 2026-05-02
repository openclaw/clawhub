---
summary: "ClawPack artifact contract, integrity model, and download behavior."
read_when:
  - Working on plugin artifact storage
  - Changing package download APIs
  - Debugging ClawPack verification
---

# ClawPack

ClawPack is ClawHub's stored artifact format for plugin releases. A ClawPack
is a deterministic ZIP archive built by ClawHub from publisher-provided package
source. Publishers may upload `CLAWPACK.json`, but ClawHub ignores it and
generates the canonical manifest itself.

ClawPack is not OpenClaw install support by itself. OpenClaw consumption is a
future downstream step. This repository owns artifact creation, storage,
moderation, API, CLI, and operator readiness surfaces.

## Contract

Every active ClawPack has:

- a canonical package name
- a release version
- `package/CLAWPACK.json`
- normalized package files under `package/`
- a SHA-256 digest of the final ZIP bytes
- a manifest SHA-256 digest
- a file count and byte size
- a spec version
- a build timestamp
- a storage id in Convex file storage
- artifact status: `active`, `superseded`, or `revoked`

The ZIP digest is the immutable artifact identity. The release row stores a hot
summary for UI/API reads, while the artifact row owns detailed storage identity
and status.

## Manifest

`package/CLAWPACK.json` describes the archive ClawHub actually produced. It
includes package identity, source attribution, compatibility, host targets,
environment requirements, and file summaries.

Required properties for plugin confidence:

- package family: `code-plugin` or `bundle-plugin`
- package name and version
- source repository, path, ref, or commit where known
- OpenClaw compatibility range for code plugins
- plugin API compatibility range for code plugins
- host target matrix where declared
- environment flags such as browser, desktop, network, native dependencies, or external services

Missing host or environment facts do not always block publish, but they lower
readiness and should be visible in UI, API, and moderation tools.

## Build Rules

The artifact builder must:

- reject unsafe archive paths, absolute paths, and traversal paths
- normalize path separators
- ignore local junk such as dependency folders and build cache files
- ignore publisher-provided `CLAWPACK.json`
- sort manifest entries deterministically
- build deterministic ZIP bytes
- hash the final archive bytes
- store the artifact in Convex storage
- write release summary fields and artifact records together
- avoid making a failed artifact publicly installable

## Download Paths

Public download routes return stored artifacts, not regenerated archives.

- `GET /api/v1/packages/{name}/download`
- `GET /api/v1/packages/{name}/versions/{version}/clawpack`
- `GET /api/v1/clawpacks/{sha256}`

Expected headers:

```http
ETag: "sha256:<hex>"
Digest: sha-256=<base64>
X-ClawHub-ClawPack-Sha256: <hex>
X-ClawHub-ClawPack-Spec-Version: 1
X-ClawHub-Artifact-Status: active
```

Revoked artifacts must not be served from any path.

## CLI Verification

Download:

```bash
clawhub package download <name> --version <version>
```

Inspect:

```bash
clawhub package inspect <name> --version <version>
clawhub package clawpack <name> --version <version> --json
```

Verify a downloaded artifact:

```bash
clawhub package verify <file>.clawpack.zip --sha256 <digest>
```

The verifier checks the archive digest when `--sha256` is provided and confirms
that `package/CLAWPACK.json` exists.

## Storage

V1 source of truth is Convex file storage. The database stores the Convex
storage id, artifact digest, status, and release summary.

S3 is intentionally not required for the first platform release. A later mirror
can add provider, bucket/key, mirror digest, status, and repair metadata, but
the mirror must never be trusted until digest verification passes against the
Convex source artifact.

## Failure Model

Common failure states:

- metadata validation blocked publish
- archive expansion failed
- unsafe path rejected
- ClawPack build failed
- Convex storage write failed
- artifact row write failed
- search index backfill failed
- artifact revoked after publish

Admin and moderator tooling should show the failed step, reason code, release
identity, and retry path where retry is safe.
