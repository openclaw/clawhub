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

That profile exists only inside the Claw package. It is validated during
publication and application, participates in package integrity, and is never
copied into ordinary OpenClaw configuration. Other harnesses may ignore
OpenClaw's namespaced key or define their own profile-pointer contract.

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

1. Add the shared grouped manifest contract, safe summary, and storage model.
2. Add feature-gated authenticated publication, validation, and authoring docs.
3. Add feature-gated search, detail, and API surfaces.
4. Add hosted feed export and a published-package end-to-end proof through
   OpenClaw `claws add --dry-run`.

The publish schema intentionally remains narrower than the storage family in
the first slice. This prevents existing generic package endpoints from
accepting Claws before their dedicated validation and gate are in place.

The shared validator follows the RFC's strict v1 contract: strings are not
trimmed into validity, MCP package selectors must resolve exact versions,
process environment keys follow OpenClaw's host-wide safety policy, and tool
filters accept only exact names plus `*` wildcards. Registry validation must
not accept a declaration that the applying OpenClaw client rejects.
