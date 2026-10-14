# Lobster Packs discovery proof

This proof uses the actual ClawHub frontend and locally deployed Convex code. It
contains no mocked HTTP responses or generated UI screenshots.

- Frontend: `http://127.0.0.1:4320`
- Convex: `http://127.0.0.1:3210` (HTTP actions: `http://127.0.0.1:3211`)
- Fixture: `@lobsterdex-demo/reef-lobsters`, version `1.0.0`
- Route: `/plugins?sort=updated&category=lobster-packs`

The fixture is explicitly labeled as a local discovery fixture. Its seed-created
statistics and verification metadata are test data, not a published pack's history.
This proves category discovery, not pack publication, validation, installation,
or artwork rendering.

## Reproduce

Use an isolated local checkout and local Convex deployment. Do not run the fixture
against a shared or production deployment. `fixture.json` resets only the local
`lobsterdex-demo` seed owner's public-corpus records.

```sh
bun install --frozen-lockfile
bun run --cwd packages/schema build
CONVEX_AGENT_MODE=anonymous bunx convex dev
```

Once the local functions are ready, in a second terminal:

```sh
bunx convex run devSeed:seedPublicCorpusBatch "$(cat proof/lobster-packs/fixture.json)"
bun --bun vite dev --host 127.0.0.1 --port 4320
```

Open `/plugins?sort=updated`, select **Lobster Packs**, and confirm the Reef Lobsters
row remains visible and the selected category appears in the URL. Refresh that
URL to verify the filter persists.

`category-before.png` shows the unchanged frontend at commit
`b0e34a98cd56581f770989ef3713455a0e00fd87`, served at
`http://127.0.0.1:4321/plugins?sort=updated` against the same local fixture backend.
There is no Lobster Packs sidebar entry. The baseline uses its own archived schema
artifacts and shares installed dependencies; only the development server filesystem
allowlist is widened to read those shared dependencies.

`category-desktop.png` shows the selected category and the seeded result. The
browser reported no console errors; existing TanStack development code-splitting
warnings remained.

The real HTTP response is saved in `filter-response.json`. The category registry
also exposes `lobster-packs`, label `Lobster Packs`, icon `shapes`, order `9`.

```sh
curl 'http://127.0.0.1:3211/api/v1/plugins?category=lobster-packs&sort=updated&limit=25'
curl 'http://127.0.0.1:3211/api/v1/plugins/categories'
```

## Package compatibility check

The built ClawHub CLI ran `package validate` on the companion OpenClaw example
at `examples/plugins/lobster-pack`, using the pinned Plugin Inspector `0.3.23`.

- Default published target (`openclaw@2026.9.6`): exit 0, no hard errors, one
  `manifest-unknown-fields` warning for `lobsterPacks`.
- Explicit companion OpenClaw checkout: exit 0, no hard errors or warnings.

The summaries are saved in `inspector-summary.json` and
`inspector-local-summary.json`. The published target must include the new manifest
contract before this warning disappears for default validation. These static
compatibility checks do not prove artwork validation, runtime playback, or actual
publication.
