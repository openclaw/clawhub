# Manually curated company integrations

This directory contains small OpenClaw-authored connection bundles for company-maintained MCP services. The bundle author and upstream service provider are different identities. Cursor's Marketplace is a research source and its bundle format is a compatibility format; neither establishes company authorship or endorsement.

There is no marketplace scraper, synchronization job, source ranking, or automatic publication. Each integration is reviewed individually. Provider code, skills, hooks, logos and documentation are not copied into these bundles.

## Included bundles

| Bundle                      | Official service                            | Authentication | Category       | Live protocol proof                                  |
| --------------------------- | ------------------------------------------- | -------------- | -------------- | ---------------------------------------------------- |
| [GoDaddy Domains](godaddy/) | GoDaddy domain suggestions and availability | None           | Infrastructure | OpenClaw discovery and a read-only availability call |
| [Excalidraw](excalidraw/)   | Excalidraw public diagram MCP               | None           | Media          | OpenClaw discovery and the read-only `read_me` tool  |

The `.cursor-plugin/plugin.json` marker selects the bundle loader. The accompanying `openclaw.plugin.json` supplies ClawHub identity and categories. There is no `package.json` native runtime entrypoint: on OpenClaw 2026.9.6 the Cursor bundle marker takes precedence over native-manifest fallback, so `.mcp.json` remains active. Installation alone is insufficient proof; verify the installed bundle tools without separately configured MCP server overrides.

These are service connection adapters maintained by OpenClaw, not packages authored by GoDaddy or Excalidraw. Their MIT licenses cover adapter files only. The hosted services and their data remain subject to provider terms.

## Review and release

Before adding a bundle, verify the company-maintained offering, direct official endpoint, rights for any copied material, credentials, current category and existing same-service/same-job functionality. Company branding alone is insufficient. Keep no-auth, user key/token and public OAuth DCR distinct. Do not add managed OAuth applications, client secrets, provider allowlisting, AI-product proxies or internal company workflow tools.

For a key-based bundle, use the provider's documented header and user-supplied secret mechanism, never a token copied from a Marketplace. For OAuth, use OpenClaw's native flow and prove registration with its callback. A metadata document, 401 or 405 does not prove authenticated tools work. Record registration, authentication, tool discovery and read-only calls separately.

Check existing ClawHub and OpenClaw offerings by endpoint, job and tools, then reuse a substantially equivalent official package. Preserve distinct jobs and unrelated community packages. Circleback already has `@circleback/openclaw-plugin`; GitHub's remote repository MCP is distinct from its Copilot model/agent provider. Do not select duplicates using registry precedence.

Publish an individually reviewed directory using the ordinary ClawHub CLI and security gates:

```sh
bun packages/clawhub/src/cli.ts package publish ./integrations/company/godaddy --family bundle-plugin --name godaddy-mcp --version 1.0.0 --dry-run --json
```

Actual publication needs the authorized publisher and the final committed source. Change bundle versions for changed bytes; never rewrite an existing release. Review diffs and rerun provider checks manually. No command in this directory fetches or synchronizes upstream packages.

## Local acceptance proof

The test publishes these actual bundle directories into isolated local Convex, checks that pending packages cannot be listed/downloaded, supplies **simulated ClawScan and TruffleHog** worker results, verifies exact archive contents, and captures real ClawHub pages. Plugin Inspector runs normally. VirusTotal/live ClawScan certification is not claimed.

```sh
bun run test:pw:local-auth -- --project=chromium e2e/local-auth/curated-company-bundles.pw.test.ts
```

To include installation proof, set `CURATED_COMPANY_PROOF_OCM_ENV` to an existing disposable OCM environment and `OCM_HOME` to its isolated store. The test uses `CLAWHUB_URL` for the local registry because OCM intentionally clears caller `OPENCLAW_*` variables. It never starts a shared gateway or authenticates against provider accounts.

The wider 33-candidate authentication audit and the unresolved historical inventory remain tracked in the issue. Only the directories in the table above are included here; untested or blocked candidates are not silently published.
