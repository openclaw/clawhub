---
name: convex-bundle-size
description: 'Debug and shrink a Convex deployment''s bundle with @convex-dev/bundle-analyzer: find duplicate packages, "use node" code leaking into the Convex runtime, dev dependencies and test files in deployed code, then fix and measure before/after. TRIGGER on ''Total module size exceeded the unzipped maximum'' (ModulesTooLarge), out-of-memory during push, slow "use node" cold starts, or ''why is my Convex bundle/push so big''. SKIP slow-query and spend questions.'
---

<!-- GENERATED from convex-agents content/capabilities/bundle-size.json — do not edit by hand. -->

# Debug Convex bundle size

Convex bundles each runtime's functions with esbuild. A deployment's code, including external packages, has to fit within Convex's code size limits; a push over them fails with `ModulesTooLarge` ("Total module size exceeded the unzipped maximum"). A large bundle can also fail a push or analysis with "ran out of memory". Large `"use node"` bundles slow cold starts. `@convex-dev/bundle-analyzer` reproduces the bundle locally and says what to cut. The limits are changing, so read the current ones from https://docs.convex.dev/functions/bundling#code-size-limits rather than assuming a number. Analyzer docs: https://docs.convex.dev/functions/bundling#debugging-bundle-size

## Workflow

1. Check prerequisites: dependencies installed and `convex/_generated/` present. If it is missing, run `npx convex codegen`. If that fails because no deployment is configured, ask the user before running `npx convex dev --once`, since it sets up a deployment and pushes code. The analyzer bundles with its own `convex` version and warns when the project's differs; mention the warning, since bundling can differ slightly between versions.
2. Get the baseline: `npx -y @convex-dev/bundle-analyzer summary` for total size, top insights, and the largest components, packages and modules. Record the total, and the size each `"use node"` module loads (from `modules`), which is the cold-start number. Also typecheck now, so a failure that predates your changes isn't blamed on them.
3. Get the findings: `npx -y @convex-dev/bundle-analyzer insights --json` prints `{ "insights": [...] }`, sorted by `savedBytes`. Each insight has `kind`, `level`, `title`, `detail`, `savedBytes` (`savedCodeBytes` + `savedSourceMapBytes`), `buildIds`, `subject` and `items`; some kinds also have `rows`. `savedBytes` is an estimate.
4. Look past the insights. They only fire above size thresholds and don't detect unused imports, so the largest win can have no insight. Read the largest-packages table in `summary`, and for each large package check that a deployed function actually calls it. Drill in with:
   - `packages <name>`: which entry points import a package, with import chains.
   - `files <path-fragment>` (e.g. `zod@3.25.76/` or `convex/lib/`): which modules a file is bundled into and what imports it.
   - `modules [module]`: how much code loads to run one function module, which drives cold start and memory.
   - `components`: size per component per runtime, to pick which component to look at first.
     These take `--json` and `--limit <n>`. `explore` is an interactive terminal treemap; don't run it as an agent.
5. Fix by insight `kind`:
   - `duplicate-package`: align the versions in package.json, or dedupe with the project's package manager.
   - `alternate-package-implementations`: the ESM and CJS builds of one package are both bundled; standardize imports on one entry point.
   - `use-node-file-in-convex-runtime`: a non-node file imports a `"use node"` file. Each item's `fixes` says whether to add `"use node"` to the importer (`add-use-node`, which only works if the importer defines no queries or mutations, since `"use node"` files can only define actions) or move the shared code into a file without `"use node"` (`move`).
   - `package-in-both-runtimes`: remove its use from the runtime that doesn't need it.
   - `external-package-candidate`: only `"use node"` code uses it (the analyzer names the dependency from package.json that brings it in), so adding it to `node.externalPackages` in convex.json shrinks the upload. The whole installed package then counts toward the code size limit, so it can increase the total; `savedBytes` is 0 for this kind on purpose. Use it when upload size or bundling is the problem, not the total.
   - `dev-dependency-bundled`: either a runtime dependency is listed under devDependencies (move it), or test or script code reaches a deployed module (cut that import; `items[].importedBy` names the importing files).
   - `test-file-bundled`: a test file is bundled; stop importing it or move or rename it so it isn't a function module.
   - `package-in-many-components`: each component bundles its own copy; expected for components, so only act if one copy is large.
6. Present a plan ranked by expected savings before editing anything, and get the user's go-ahead.
7. Apply one fix at a time. After each, re-run `summary` and report the total (and the cold-start size, if that was the complaint) before and after. When done, typecheck and run `npx convex dev --once` to confirm the push succeeds.

## Rules

- Measure with the analyzer before changing anything, and report before and after sizes for every fix.
- Present the plan before editing; package.json, convex.json and `"use node"` changes affect every function in the bundle.
- Don't count `external-package-candidate` as a saving: externals shrink the upload but the whole installed package counts toward the code size limit.
- For Node cold starts, the code a module loads (the `modules` size) matters more than gzipped size. Move code out of `"use node"` when it can run in the Convex runtime.
- The usual culprits are WASM or native binary dependencies and SDKs that don't tree-shake (e.g. aws-sdk, snowflake-sdk). If one dependency can't be shrunk, move it behind a sandbox component or an external service.
- Keep `convex` up to date: newer versions can bundle more efficiently. Projects on a version before 1.31.5 get a large saving from upgrading alone, since bundled source maps no longer include source code. The analyzer always bundles with its own `convex`, so it can't show what an upgrade saves; compare pushes instead.
- Slow queries and spend are not bundle size problems; this skill does not cover them.
