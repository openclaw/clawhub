# Experimental Claw packages

ClawHub's Claw support implements the registry side of
[OpenClaw RFC #27](https://github.com/openclaw/rfcs/pull/27). A Claw package
describes one complete new agent using the grouped `CLAW.md` schema. ClawHub
owns publication, ownership, discovery, package detail APIs, and hosted feed
export. OpenClaw remains authoritative for local planning, consent, mutation,
provenance, update, and removal.

The portable agent object carries only identity and purpose. Harness-specific
settings live in package-local profiles addressed through opaque string
metadata. OpenClaw recognizes `metadata.openclaw.config`; export conventionally
uses `profiles/openclaw.yml`, but the pointer is normative and authors may use
another safe package-relative YAML path.

That profile exists only inside the Claw package. ClawHub requires the pointer
to resolve to an exact, bounded UTF-8 YAML package file and validates the
profile's strict v1 OpenClaw policy during publication. OpenClaw validates it
again during application, includes it in package integrity, and never copies it
into ordinary OpenClaw configuration. Other harnesses may ignore OpenClaw's
namespaced key or define their own profile-pointer contract.

## Experimental contract

- Backend Claw publication and read surfaces require
  `CLAWHUB_EXPERIMENTAL_CLAWS=1`.
- The gate is not user consent and must not bypass validation, moderation,
  ownership, or scanner checks.
- Disabled deployments must not accept Claw publication or expose Claws through
  Claw-specific discovery surfaces.
- Public Claw schemas and APIs may change while the gate is required. Removing
  the gate requires a separate compatibility and migration decision.

## Staged implementation

1. Add the shared grouped manifest contract, safe summary, and storage model
   ([PR #3089](https://github.com/openclaw/clawhub/pull/3089)).
2. Add feature-gated authenticated publication, package-content validation,
   CLI authoring support, and authoring docs
   ([PR #3090](https://github.com/openclaw/clawhub/pull/3090)).
3. Add feature-gated search, detail, and API surfaces
   ([PR #3091](https://github.com/openclaw/clawhub/pull/3091)).
4. Add hosted feed export and a published-package end-to-end proof through
   OpenClaw `claws add --dry-run`.

The shared validator follows the RFC's strict v1 contract: strings are not
trimmed into validity, MCP package selectors must resolve exact versions,
process environment keys follow OpenClaw's host-wide safety policy, and tool
filters accept only exact names plus `*` wildcards. Registry validation must
not accept a declaration that the applying OpenClaw client rejects.

Claws use the existing package publication pipeline. `package.json` declares
the package identity, version, and package-relative `openclaw.claw` manifest
path. Publication parses `CLAW.md` YAML frontmatter or the JSON compatibility
form and validates the grouped manifest, referenced workspace files, and any
declared package-local OpenClaw profile. The release retains the exact artifact
and a bounded derived summary rather than duplicating the full manifest or
OpenClaw profile into Convex storage. The server rejects
`family: claw` before mutation when the experimental gate is disabled; the gate
does not bypass ownership, moderation, scanning, or release invariants when
enabled.
