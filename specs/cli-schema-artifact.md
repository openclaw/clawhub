---
summary: "Keep canonical schema implementations shared while publishing a standalone CLI."
read_when:
  - Changing CLI schema modules or package build output
  - Adding a shared schema module to the CLI
---

# CLI schema artifact boundary

The registry owns the canonical implementations in `packages/schema/src`.
The CLI reuses nine canonical modules: `ark`, `openclawContract`, `packageShared`,
`packageUploadLimits`, `pluginInput`, `schemaShared`, `templatePackage`, `templates`,
and `textFiles`. Their CLI source modules forward to the canonical built `dist`
modules so source tests and typechecks do not require a second implementation or a
wider TypeScript source root.

`packages/schema/dist` is generated and ignored. The root `bun install` builds it
with the installed development toolchain before app, Convex, worker, and CI
consumers run. Worktrunk rebuilds it after reusing dependencies. A checkout that
skips install scripts or copies dependencies must run
`bun run --cwd packages/schema build` before those consumers. Rebuild after
editing canonical schema sources; never commit generated schema output. Keep
package exports pointed at built JavaScript and declarations.

Both CLI builds first rebuild the canonical schema package, then compile their sources.
The shared build helper replaces emitted forwarders with canonical JavaScript and
declarations at the public CLI's existing `dist/schema/*` paths and the admin CLI's
existing `dist/clawhub/src/schema/*` paths. The published artifact must contain no
workspace-relative forwarders or dependency on the private `clawhub-schema`
package. The CLI bin path and `dist/cli.js` remain unchanged.

Only the nine modules above are copied. The registry and CLI have distinct
`packages`, `schemas`, and other contracts; do not copy the entire schema
package to remove those differences.

`packageShared` contains only declarations whose implementations and local
dependencies are identical in both package contracts. Both `packages` modules re-export its public
names and retain their different validators, including private publish metadata fields.
The shared leaf must not import either `packages` or `schemas`, which would create a
cycle or couple the distinct wire contracts.

`schemaShared` applies the same closed-declaration rule to the core API contracts.
Its only dependency is ArkType. Each `schemas` parent retains its different lockfile,
license, scan-batch response, and skill metadata validators. Do not replace either
parent with the other or widen a distinct contract merely to share its implementation.

The shared runtime closure uses only the CLI's declared external dependencies and `templatePackage`'s relative import
of `templates`. The `openclawContract` declaration's type-only `packages`
import must still resolve inside the CLI artifact.

Source maps retain their mappings, point to repository-relative canonical source
paths, and embed source text so debugging a published CLI does not require the
workspace checkout. Do not embed absolute build-machine paths.

Validate changes with registry and CLI conformance cases, schema/CLI typechecks,
and the packed-artifact test. The latter extracts a real local npm pack into a
temporary directory, supplies only declared runtime dependencies, and loads the
CLI plus all nine schema modules without a sibling schema package. Retain the
admin CLI's existing packed-artifact test too. This is
artifact validation, not an npm publication.
