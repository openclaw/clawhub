# Managed MCP: real local admin → OpenClaw proof

ClawHub stack: [#3878](https://github.com/openclaw/clawhub/pull/3878) → [#3879](https://github.com/openclaw/clawhub/pull/3879) → [#3881](https://github.com/openclaw/clawhub/pull/3881). [#3880](https://github.com/openclaw/clawhub/pull/3880) is closed and excluded.

## Environment and scope

- ClawHub commit `ad781daa521e42ba1cbb4b57a7eec09f4db33165`; frontend `http://127.0.0.1:57232`, isolated Convex on57230/57231.
- OpenClaw baseline `0338bb3adbafa24f8887e169634169ae60d690af`; isolated Gateway `http://127.0.0.1:57340`, configured to use the local ClawHub API.
- Fresh `@openclaw/deepwiki-e2e@1.0.0`, created through the actual signed-in ClawHub admin form. Cognition's public DeepWiki endpoint; no account needed. This is one disposable demonstration alongside the unchanged66-company collection.
- No production state, personal Gateway, or unrelated PR stack changed. Browser screenshots and recordings are real; no intercepted/mocked requests or synthetic product pages.

## Observed chain

1. Admin opens **Management → Plugins → Add MCP integration**, fills endpoint/auth/category/icon/licensing, and clicks **Publish version**.
2. Backend observes the actual endpoint (DeepWiki2.14.3; MCP2025-03-26), stores an immutable staged package, and creates a durable `publishAttempts` row. UI explicitly reports pending checks and unavailable installation.
3. Before scanner completion, actual OpenClaw catalog search returns zero items and public package download returns404.
4. The normal authenticated worker claims the same attempt and materializes its exact staged artifact. Native TruffleHog3.97.5 runs successfully with no verified secrets. **Only the ClawScan verdict is simulated**, explicitly labeled in persisted evidence.
5. Normal worker completion finalizes publication. Download returns200/3,730bytes and matches the staged SHA-256. OpenClaw's real catalog search now finds the package.
6. User-equivalent click on **Install** downloads, installs and enables version1.0.0 through the normal Gateway operation. Existing Control UI shows **MCP servers:1 → deepwiki-e2e**, **Disable**, and **Uninstall**.
7. A real ordinary agent chat exposes an upstream runtime defect: HTTP bundle definitions receive `cwd`, which Codex rejects before invocation. A separate shared bundle-loader fix resolves this; the same installed package then completes the same real agent prompt.

## Default-runtime before/after

Before: unchanged upstream0338 fails before any tool call because OpenClaw adds `cwd` to a remote HTTP definition. After: proof consumer `8416ff3fc8f6cc481bdd38b7c3227549e2d8f273` is exactly the same base plus shared fix `34e5840ccd8191902e9574e84a95af7f2fc5428b`. Same local Gateway port, state, installed package, model, prompt and backend; no manual MCP server override.

The normal default Codex runtime with `openai/gpt-6-astra` emits actual tool-start and tool-result events for `deepwiki-e2e.read_wiki_structure({repoName:"facebook/react"})`: exactly one call, completed, `isError:false`, and eight top-level sections returned. The UI finishes in15seconds and summarizes the first five. This is a real Gateway/model conversation, beyond earlier native-harness validation.

[After-fix recording](runtime-after/full-run.mp4) · [Actual chat result](runtime-after/14-openclaw-live-tool-after.png).

The fix changes the shared loader to supply a working directory only for command-based servers. Its two regression checks fail on the baseline;34 focused tests pass afterward. No provider account authorization is implied by this public call.

## Security boundary

**Real:** durable pending queue, attempt/release linkage, authenticated worker claim, immutable artifact validation, native TruffleHog, publication policy, download gating and hash match.

**Simulated:** ClawScan completion only. No ClawScan judge/provider-backed analysis was run. OpenClaw's install warning says no security analysis has been recorded; a UI “Clean” verdict in this fixture must not be interpreted as security certification.

Local scheduled/GitHub event dispatch is disabled and no GitHub App is configured. This proves a durable worker-eligible queue and actual processing, **not a remotely dispatched GitHub scan workflow**.

Attempt: `rn75vm48zb5cgmgxdwyg1y7xrh8fevt5`.
Artifact fingerprint: `2d44859ae9a84a8a24b2dc3bd67da5147d10e8ad6884826afc8bc58e94331049`.
Downloaded SHA-256: `a294a59ab2640aa4e353b489bc306cced4a20ddaf106c9b6cad52bb95a9982d8`.
Fresh downloaded-package Plugin Inspector validation also passed against OpenClaw2026.9.7: zero breakages, warnings, deprecations or issues.

Detailed non-secret queue/claim/completion and installation output: [summary.json](summary.json).

## Evidence

| State | Before | After | Assertion |
|---|---|---|---|
| Publication | [Form](admin/02-admin-definition.png) | [Pending checks](admin/04-admin-security-pending.png) | Real admin operation returns staged attempt |
| OpenClaw search | [Hidden while pending](catalog/06-openclaw-pending-hidden.png) | [Found after completion](catalog/07-openclaw-search-found.png) | Same exact query, same live registry |
| Installation | [Install available](install/08-openclaw-before-install.png) | [Installed and enabled](install/10-openclaw-installed.png) | Actual Gateway install and persisted bundle |
| Runtime | [Real error](runtime/12-openclaw-live-tool.png) | [Real tool result after fix](runtime-after/14-openclaw-live-tool-after.png) | Same package now executes via default runtime |

Recordings: [Admin publication](admin/full-run.mp4), [pending search](catalog/full-run.mp4), [search/install](install/full-run.mp4), [runtime before fix](runtime/full-run.mp4), [runtime after fix](runtime-after/full-run.mp4).

All recordings preserve the real action/result order at1×, with the final frame held3seconds. Admin pre-navigation startup is trimmed. Search evidence is identically cropped to the content area to exclude the unrelated community invitation. Captions are external annotations; product pixels are unmodified. Raw recordings and scripts remain in the local `.artifacts/managed-mcp-proof/full-ui-e2e` directory.

## Validation scope

Existing ClawHub required gates remain passing: `ci:static`, `ci:unit` (7,353passed/3skipped), `ci:types-build`, `ci:packages`, `ci:e2e-http`;46 targeted tests and `ci:static` after removing the closed UI layer. This follow-up adds real integration proof without changing ClawHub source.

Prior full collection proof installed/enabled and natively discovered all66 packages, preserving exact URLs/queries/transports/scopes. It is distinct from this new full Gateway/UI turn. Provider-specific account authorization is not claimed. PostHog's literal-header placeholder issue remains a separate consumer limitation.

Desktop flow:1440×900. Public detail also captured at390×844. Existing before/after admin mobile, update/unpublish, permission and dense collection evidence remains linked in [prior validation](https://github.com/openclaw/clawhub/pull/3879#issuecomment-5923106955). This is a cross-system functional follow-up, not a new responsive redesign. Loading, empty, submitting, pending, installed and real runtime-error states are included; no fake error fixtures are presented as live scanner results.

The final local frontend uses Vite `--mode proof` to exclude existing upstream development-only hard-coded validation findings. It retains real local authentication, backend data and all security gates; no product source was changed for this setting.


Fresh public catalog details: [desktop](catalog/13-clawhub-published-1440.png) · [mobile](catalog/13-clawhub-published-390.png). Runtime fix publication reference will be linked in the PR proof comment.
