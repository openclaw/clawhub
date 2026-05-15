# Local Moderation Fixtures

This note records the intended local-only QA fixtures created by `bun run seed:dev`.
The real-ish catalog density comes from the committed public corpus fixture; these
hand-authored fixtures remain for security and moderation states that need stable
local reproduction.

The fixtures exist so developers can exercise ClawHub moderation, scan, publisher-note, and artifact UI states without hand-editing Convex data. They are not production behavior and should not introduce appeal-specific flows.

## Seed Command

```bash
bun run seed:dev
```

The command uses the local worktree setup helper, then runs the Convex dev seed path.

## Local Persona

The seed owns fixtures with the local user handle:

```text
@local
```

The seeded user is given an old `githubCreatedAt` timestamp so local UI publishes can pass the same GitHub account-age invariant as normal publish paths. This avoids local-only publish bypasses while keeping the dev persona usable.

## Fixture Artifacts

Seeded skill fixtures:

- `local-flagged-wallet-sync`: intentionally malicious/hidden-style skill fixture.
- `local-agentic-risk-demo`: intentionally suspicious/review-style skill fixture with ClawScan findings and a long publisher note.

Seeded plugin fixtures:

- `local-flagged-runtime-plugin`: intentionally malicious plugin/package fixture.
- `local-scanned-runtime-plugin`: intentionally suspicious/review-style plugin/package fixture with ClawScan findings and a long publisher note.

The scanned fixtures should cover:

- artifact detail pages
- scan summary strips
- ClawScan report pages
- publisher note display
- mobile and desktop security layout
- report/moderation state previews

## QA URLs

After running `bun run dev` and `bunx convex dev`, use:

```text
http://localhost:3000/local/local-agentic-risk-demo
http://localhost:3000/local/local-agentic-risk-demo/security/clawscan
http://localhost:3000/plugins/local-scanned-runtime-plugin
http://localhost:3000/plugins/local-scanned-runtime-plugin/security/clawscan
```

The fixture pages should avoid appeal language. Publisher notes are untrusted publisher-provided context, not appeals, staff responses, or moderation decisions.
