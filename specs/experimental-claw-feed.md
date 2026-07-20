---
summary: "Experimental ClawHub feed contract for versioned Claw package discovery."
read_when:
  - Publishing or consuming the experimental Claws feed
  - Changing Claw feed entries, gating, or package proof
---

# Experimental Claw Feed

The Claws feed is a separate experimental wire contract. It does not add
`type: "claw"` to the stable hosted catalog feed schema version 1.

## Contract

- Route: `/api/v1/feeds/claws`, proxied as `/v1/feeds/claws`
- Feed id: `clawhub-official-claws`
- Experimental schema version: `1`
- Gate: `CLAWHUB_EXPERIMENTAL_CLAWS=1`
- Entry type: `claw` only
- Install coordinate: canonical package name plus exact release version
- Integrity: `sha256:<immutable artifact sha256>`
- Metadata: bounded `clawManifestSummary`; never the full manifest

The route returns `404` with `Cache-Control: no-store` before reading stored
publication state when the gate is disabled. It has no unversioned Vercel
redirect and is not advertised by `/.well-known/openclaw-registry.json` while
experimental.

Eligible releases must be public, official, unblocked, and retain an immutable
artifact digest plus the bounded summary derived during publication. The exact
package artifact remains authoritative; Convex does not retain a second full
manifest copy.

The experimental parser rejects generic plugin and skill entries, unknown feed
ids, unknown fields, invalid timestamps, and unsupported schema versions. The
serializer provides deterministic entry, bootstrap-file, and install-candidate
ordering.

## Proof Boundary

`scripts/claws-feed-openclaw-e2e.test.ts` is a registry-to-OpenClaw bridge
proof. It parses the experimental feed, selects one exact ClawHub candidate,
checks artifact metadata and downloaded bytes against the feed digest, performs
bounded safe extraction, and passes the resulting package directory to the real
OpenClaw `claws add --dry-run --json` command in isolated state.

This proves that a package advertised by ClawHub can produce a non-mutating
OpenClaw plan. It does not claim that OpenClaw itself resolves ClawHub feed URLs;
that consumer integration is a separate dependent track.

Downloads are capped at 64 MiB. TGZ parsing shares ClawHub's npm-pack path,
which enforces canonical `package/` paths, regular files/directories only,
10,000 entries, 50 MiB expanded content, and portable duplicate rejection.
Legacy ZIP extraction applies the same entry, expanded-size, path, and portable
collision bounds and supports either `package/` or archive-root package layout.
