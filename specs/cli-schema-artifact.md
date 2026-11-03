---
summary: "Keep canonical schema implementations shared while publishing a standalone CLI."
read_when:
  - Changing CLI schema modules or package build output
  - Adding a shared schema module to the CLI
---

# CLI schema artifact boundary

The registry owns the canonical implementations in `packages/schema/src`.
The CLI reuses seven canonical modules: `ark`, `openclawContract`, `packageShared`,
`pluginInput`, `templatePackage`, `templates`, and `textFiles`. Their CLI source modules
forward to the canonical committed `dist` modules so source tests and typechecks do not
require a second implementation or a wider TypeScript source root.

Both CLI builds first rebuild the canonical schema package, then compile their sources.
The shared build helper replaces emitted forwarders with canonical JavaScript and
declarations at the public CLI's existing `dist/schema/*` paths and the admin CLI's
existing `dist/clawhub/src/schema/*` paths. The published artifact must contain no
workspace-relative forwarders or dependency on the private `clawhub-schema`
package. The CLI bin path and `dist/cli.js` remain unchanged.

Only the seven modules above are copied. The registry and CLI have distinct
`packages`, `schemas`, and other contracts; do not copy the entire schema
package to remove those differences.

`packageShared` contains only declarations whose implementations and local
dependencies are identical in both package contracts. Both `packages` modules re-export its public
names and retain their different validators, including private publish metadata fields.
The shared leaf must not import either `packages` or `schemas`, which would create a
cycle or couple the distinct wire contracts.

The shared runtime closure uses only the CLI's declared external dependencies and `templatePackage`'s relative import
of `templates`. The `openclawContract` declaration's type-only `packages`
import must still resolve inside the CLI artifact.

Source maps retain their mappings, point to repository-relative canonical source
paths, and embed source text so debugging a published CLI does not require the
workspace checkout. Do not embed absolute build-machine paths.

Validate changes with registry and CLI conformance cases, schema/CLI typechecks,
and the packed-artifact test. The latter extracts a real local npm pack into a
temporary directory, supplies only declared runtime dependencies, and loads the
CLI plus all seven schema modules without a sibling schema package. Retain the
admin CLI's existing packed-artifact test too. This is
artifact validation, not an npm publication.
