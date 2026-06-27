# Local Moderation Fixtures

This note records the intended local-only QA fixtures created by `bun run seed:dev`.
The real-ish catalog density comes from the committed public corpus fixture; these
hand-authored fixtures remain for security and moderation states that need stable
local reproduction.

The fixtures exist so developers can exercise ClawHub moderation, scan, and artifact UI states without hand-editing Convex data. They are not production behavior and should not introduce appeal-specific flows.

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
- `local-agentic-risk-demo`: intentionally suspicious/review-style skill fixture with ClawScan findings.

Both skill versions persist deterministic SkillSpector analyses with issue metadata, source ranges,
explanations, and remediation so local dashboard sheets and security-audit pages can render the
complete review UI without invoking an external scanner.

Seeded plugin fixtures:

- `local-flagged-runtime-plugin`: intentionally malicious plugin/package fixture.
- `local-scanned-runtime-plugin`: intentionally suspicious/review-style plugin/package fixture with ClawScan findings.

The scanned fixtures should cover:

- artifact detail pages
- security audit sidebar summaries
- security audit pages
- security audit clean, review, and malicious states
- mobile and desktop security layout
- report/moderation state previews

## QA URLs

After running `bun run dev` and `bunx convex dev`, use:

```text
http://localhost:3000/local/local-agentic-risk-demo
http://localhost:3000/local/local-agentic-risk-demo/security-audit
http://localhost:3000/plugins/local-scanned-runtime-plugin
http://localhost:3000/plugins/local-scanned-runtime-plugin/security-audit
```

The fixture pages should avoid appeal language; scanner evidence, staff responses, and moderation decisions are separate UI concepts.
