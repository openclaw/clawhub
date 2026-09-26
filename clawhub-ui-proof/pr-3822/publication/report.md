# Plugin discovery before/after proof

Captured from real Chromium-rendered OpenClaw Control UI source. The native Control UI E2E WebSocket fixture delivers the output of the actual fetchClawHubPluginOverview and joinClawHubPluginCatalog code connected to real isolated Convex backends. Runtime presence is a named disabled bundled-plugin fixture populated from actual manifests/package metadata. No generated HTML cards are used as screenshots.

- Baseline: ClawHub 8166335196; OpenClaw 11ce05bac7c6.
- Backend URLs: baseline http://127.0.0.1:14517, candidate http://127.0.0.1:14518.
- Browser capture URLs: baseline http://127.0.0.1:49635/, candidate http://127.0.0.1:50097/. These temporary browser servers closed after capture.
- Real ClawHub built previews: baseline http://127.0.0.1:14317, candidate http://127.0.0.1:14328.
- Baseline has 63 public fixture packages plus bundled unpublished CUA. Candidate has 64 public fixture packages, modeling the prospective CUA publication. Packages use canonical identities and controlled download counts. The local @catalog-proof publisher and its badges do not establish production company ownership.
- CUA is bundled-only in Infrastructure before. Candidate models its prospective publication and categorization in Computer use, alongside Browser Use. The actual trusted official plugin catalog entry and management resolver derive CUA identity; exactly one canonical CUA card renders. Browser Use moves from Web to Computer use.

Verified: pinned Channels; only OpenAI, Anthropic, Google pinned in Models; Honcho/Mem0/Cognee first; Meet/Zoom/Teams first; Web priorities; new Computer use; eight English Research rows with high-download Chinese-title rows excluded; Other and Uncategorized absent. Actual paginated HTTP responses prove 13 unique Memory entries with Honcho/Mem0/Cognee first, 16 unique Channel entries, and canonical-name ties across 2-item pages. View all Research retains all 14 entries including both Chinese-title packages; the homepage contains eight English Research entries. Paired real ClawHub Research category screenshots show that the full category remains multilingual.

Full Gateway proof was attempted using supported pnpm openclaw with isolated state/profile/port. Untouched baseline build fails its INEFFECTIVE_DYNAMIC_IMPORT gate, so the supported UI fixture is used for the WebSocket boundary. The real backend, HTTP client, catalog join, controller, and rendering code are exercised.

Production publisher verification, CUA publication/featured replacement, and third-party PR merges are separate status items; screenshots do not assert those external changes are completed.

Memory provider research: no confirmed official native OpenClaw plugins found for LangMem, Letta or Zep in the reviewed public sources. Letta's official trajectory repository includes a transcript adapter; community openclaw-memory-engine is inspired by Letta, not published by the company. This does not establish that no private or unindexed plugins exist. Sources: https://github.com/letta-ai/trajectory and https://github.com/icex-labs/openclaw-memory-engine.

Fresh capture verifies exactly one canonical CUA item using the real source-owned trusted catalog registration and identity resolver. Candidate ClawHub commit: 8479d3f4d58a2a11d9c0bf7611159b77f0b69b99. OpenClaw candidate commit: 2539eb110b6f8aba9b72e3a03acc7cdad74cc7b2.
