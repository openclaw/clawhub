# Dependency upgrade qualification

`bun run test:dependency-compat` installs the small, frozen baseline fixture in
`scripts/fixtures/dependency-baseline`, then runs offline package compatibility
checks. It does not change the application's selected dependency versions.

The baseline pins Convex 1.49.0, Workpool 0.4.15, and Vercel OIDC 4.0.8. Its
private install pins xdg-app-paths 5.5.1; the candidate OIDC 4.0.9 must still
resolve cli-config 0.4.0 and xdg-app-paths 5.1.0. The tests verify actual resolved
package versions before exercising behavior.

Every child receives a temporary HOME and working directory, synthetic tokens,
and an allowlisted environment. A private marker and nonce bind each child to
its canonical HOME and working directory; direct invocation fails before package
loading or credential writes. The ordinary Linux unit job runs this same command. Unexpected HTTP, socket, and subprocess calls
fail. OIDC refresh uses an in-memory response; no request reaches Vercel.

The Convex probe binds exact published CLI bundle hashes and exposes unchanged
account helper bodies in memory by replacing only the known final CLI entry
invocation. This checks legacy-file readability, preserved settings, account
selection, and permission changes. It does not test authenticated account
access, login, or the full CLI command dispatcher.

The OIDC probe runs both real package implementations against XDG, legacy, and
precedence fixtures. It checks request, environment, and file tokens plus cached
refresh and configuration lookup. This qualifies the executing platform's path
semantics; it is not proof of an untested operating system.

These offline checks do not establish Workpool persisted-state compatibility.
That requires a separate real-backend upgrade preserving one database across
the baseline and candidate component deployments. Once a candidate stores
`errorData` in a failed completion, do not assume Workpool 0.4.15 can read it.
