# Clawhub single-category production-sample proof

The reviewed local category path passes. **97 assignments are applied; two proposals are deliberately held and one package is skipped.** Production is unchanged.

## Scope and evidence

This rehearsal uses **100 public production plugins, 190 releases, and 365 SHA-256-verified static manifest/documentation files (8.69 MB)**, captured between 2026-09-09 02:48:41 and 02:51:29 UTC. It is a per-record logical snapshot, not a globally atomic database export. Original package, release, publisher, and storage identities were preserved; user profiles are synthetic, creation timestamps reconstructed where necessary, and unselected tag/upload-attempt references omitted. Production remained read-only. No plugin code or package archive was executed.

**59 real `gpt-5.6-luna` classifications succeeded.** Review accepted 57 and held two category-boundary cases; 40 source-pinned bundled assignments complete the **97 applied latest-release assignments**, including **75 changed category values** relative to the original production metadata. `gog-extended` lacks readable bounded manifest evidence and is skipped. `imclaw` (agent social networking versus human Channels) and `@vauxr/openclaw` (voice-device interaction versus Channels) remain unapplied. These are semantic review holds, not model request failures.

The real local Convex migrations component processes batches of 10. Full dry run, application, all 21 public category filters, all 100 package/search projections, and all 190 exact-version API responses pass. All 90 historical releases and the three unselected latest releases remain unchanged. Source files, integrity hashes, storage references, scan state, and unrelated metadata remain unchanged. Rollback restores all 100 package documents and 190 release documents exactly. Replaying the reviewed assignments validates identical evidence hashes/current classifier and inventory, makes **zero new model calls**, applies the same 97 assignments, and permits a completed repeat with no changes. This is replay proof, not a second independent model run.

All **152 bundled manifests** were reassessed against the 21 explicit category definitions. Before this revision: 92 single-category, 47 two-category, 13 three-category. After: 152 single-category. 62 manifests changed relative to the earlier pass; 88 differ from the final bundled PR base. The pinned inventory matches all 149 named source packages at `d2462a55439c098650e4ce8aa322ffe103414ae5`; all 150 packaged manifests match. `qa-channel` and `qa-lab` are private QA exclusions from packaging; `active-memory`, `device-pair`, and `talk-voice` lack source package names and are excluded from registry matching.

## Contract and limits

New publications declare exactly one category or get one generated category. The prompt selects the main install purpose using the canonical definitions; incidental capabilities do not earn additional categories. The strict output schema permits exactly one allowed slug. The dedicated `OPENAI_PLUGIN_CATEGORY_MODEL` override is supported; the skill-summary model setting does not influence classification. Explicit legacy author declarations in already-published artifacts remain authoritative and readable. Superseded generated previews cannot be accepted or applied. Failed generation falls back to Other for publication but cannot be accepted for backfill.

The sampled production records contain no actual explicit category declarations in their root manifests; author precedence and new-publication behavior are covered by the publication and refresh tests, including both code-plugin and bundle-plugin publication. This sample does not prove every production record or arbitrary plugin execution.

## Validation

ClawHub: 6,516 unit tests pass (3 skipped), type/build and package gates pass, focused classifier/refresh/exact-version suite passes 16 cases, and structured autoreview is clean. The final full static command stops on seven unchanged dependency audit advisories reproduced on the baseline; other static checks pass. OpenClaw: 50 category/discovery tests, 253 routing/discovery tests, source/documentation reviews, and the final runtime/UI builds pass. The broader changed gate encounters an unchanged expired plugin-SDK compatibility guard reproduced on the baseline.

## Reproduce the local operations

Seed a disposable local Convex deployment with the bounded public metadata/files; rebuild category/search projections. Run `pluginCategoryRefresh:preview` with a new run ID and batch size 10, continuing returned cursors. Review `pluginCategoryRefresh:list`, accept only reviewed IDs through `pluginCategoryRefresh:accept`, dry-run `migrations:applyAcceptedPluginCategoryRefreshes`, and apply through `migrations:run`. Compare `POST /api/v1/packages/categories:batch` and every `GET /api/v1/plugins?category=...` result against stored metadata; verify older releases and unselected packages remain unchanged. Exercise guarded `pluginCategoryRefresh:rollback`. A new reviewed-assignment replay is valid only after checking unchanged evidence and classifier/inventory identity; it must not be represented as fresh model inference. Reset the completed migration cursor for the new accepted wave and verify a subsequent completed repeat is a no-op.

## Real browser comparison

The UI baseline is the earlier stack (`c95ea77450` ClawHub / `c8960487ad31` OpenClaw) with its prior 40 bundled updates applied to the same production sample. The final lane uses ClawHub `c84bf8ed75`, OpenClaw `43d9cdff8f4`, and the 97 reviewed single-category assignments. The backend rollback comparison independently starts from the **original production metadata**, so its 75 changed values are not the UI baseline-diff count.

Desktop viewport: 1440×1080. Mobile: 390×844. ClawHub screenshots capture the settled full page; OpenClaw desktop images are identical-coordinate crops (x=258,y=0,w=1182,h=1080) to omit the account sidebar, preserving real product pixels. Installed Codex images capture the actual installed section. No UI mockups or composed states are used.

| Filter | Before | After |
| --- | ---: | ---: |
| Developer tools | 6 | 8 |
| Documents & files | 2 | 2 (different membership) |
| Inbox & collaboration | 11 | 2 |

Local ClawHub routes: `http://127.0.0.1:4320/plugins?category=developer-tools`, `?category=documents-files`, and `?category=inbox-collaboration`. OpenClaw is a real locally running Gateway on port 21231, inspected through its authenticated Tailnet preview. Both category catalogs and all 100 remote plugin assignments agree. All 152 runtime bundled entries agree with their reviewed source manifests; all 150 packaged manifests match source.

Codex's manifest and `plugins.list` result change from `["developer-tools","agent-orchestration","web"]` to `["developer-tools"]`. Its installed card already grouped by the first category, so that card's appearance remains stable. The API/source comparison proves the array change; the paired installed screenshots prove that discovery still works.

## Applied latest-release assignments

All 99 original proposals and explanations, including both unaccepted proposals, are retained in `summary.json`.

| Package | Version | Before | After | Source |
| --- | --- | --- | --- | --- |
| @agentmessier/openclaw-agent-messier | 0.16.3 | other | other | generated |
| @alexbessarabenko/openclaw-max | 0.4.0 | channels, voice, models | channels | generated |
| @apify/apify-openclaw-plugin | 0.5.3 | tools, web | research | generated |
| @axonflow/openclaw | 2.9.0 | tools, security | security | generated |
| @byterover/byterover | 4.0.0 | context, tools | memory | generated |
| @conan-scott/openclaw-fish-audio | 1.1.6 | voice, channels | voice | generated |
| @cyb3rb1ade/plur1bus-memory | 7.12.8 | other | memory | generated |
| @expediagroup/expedia-openclaw | 1.0.4 | tools, web, channels | other | generated |
| @gendigital/sage-openclaw | 0.12.0 | other | security | generated |
| @honcho-ai/openclaw-honcho | 1.5.5 | memory, tools, channels | memory | generated |
| @jason-vaughan/openclaw-google-oauth | 0.4.0 | tools | integrations | generated |
| @jeehou/openclaw-cursor-cli | 0.0.6 | models, runtime, security | models | generated |
| @manuelfedele/openclaw-gmail-plugin | 0.4.0 | tools, web | inbox-collaboration | generated |
| @mem0/openclaw-mem0 | 1.0.14 | memory, tools, models | memory | generated |
| @natebjones/ob1-agent-memory | 0.1.6 | memory, tools | memory | generated |
| @nowledge/openclaw-nowledge-mem | 0.8.31 | memory, context | memory | generated |
| @openclaw/acpx | 2026.9.3 | runtime, models | developer-tools | bundled |
| @openclaw/buzz | 2026.9.3 | other | channels | bundled |
| @openclaw/clickclack | 2026.9.3 | other | channels | bundled |
| @openclaw/codex | 2026.9.3 | models, media, gateway | developer-tools | bundled |
| @openclaw/copilot | 2026.9.3 | runtime | developer-tools | bundled |
| @openclaw/diagnostics-otel | 2026.9.3 | runtime | infrastructure | bundled |
| @openclaw/diagnostics-prometheus | 2026.9.3 | runtime | infrastructure | bundled |
| @openclaw/diffs | 2026.9.3 | channels, gateway, context | developer-tools | bundled |
| @openclaw/diffs-language-pack | 2026.9.3 | media, gateway | developer-tools | bundled |
| @openclaw/discord | 2026.9.3 | channels, media | channels | bundled |
| @openclaw/feishu | 2026.9.3 | channels | channels | bundled |
| @openclaw/google-meet | 2026.9.3 | tools, web, gateway | voice | bundled |
| @openclaw/googlechat | 2026.9.3 | channels | channels | bundled |
| @openclaw/imessage | 2026.9.3 | other | channels | bundled |
| @openclaw/kitchen-sink | 0.2.14 | context, memory, channels | developer-tools | generated |
| @openclaw/line | 2026.9.3 | channels | channels | bundled |
| @openclaw/lobster | 2026.9.3 | tools, security | agent-orchestration | bundled |
| @openclaw/matrix | 2026.9.3 | channels | channels | bundled |
| @openclaw/mattermost | 2026.9.3 | other | channels | bundled |
| @openclaw/memory-lancedb | 2026.9.3 | memory, tools | memory | bundled |
| @openclaw/msteams | 2026.9.3 | channels | channels | bundled |
| @openclaw/mxc-sandbox | 2026.9.3 | other | security | bundled |
| @openclaw/nextcloud-talk | 2026.9.3 | channels | channels | bundled |
| @openclaw/nostr | 2026.9.3 | channels | channels | bundled |
| @openclaw/openshell-sandbox | 2026.9.3 | security, runtime, gateway | security | bundled |
| @openclaw/sherpa-onnx-tts | 2026.6.8 | other | voice | generated |
| @openclaw/signal | 2026.9.3 | other | channels | bundled |
| @openclaw/slack | 2026.9.3 | channels | channels | bundled |
| @openclaw/sms | 2026.9.3 | other | channels | bundled |
| @openclaw/synology-chat | 2026.9.3 | channels | channels | bundled |
| @openclaw/team-reports | 2026.9.3 | other | data-analytics | bundled |
| @openclaw/teams-meetings | 2026.9.3 | other | voice | bundled |
| @openclaw/tlon | 2026.9.3 | channels | channels | bundled |
| @openclaw/tokenjuice | 2026.9.3 | runtime, context, gateway | context | bundled |
| @openclaw/venice-provider | 2026.9.3 | other | models | bundled |
| @openclaw/voice-call | 2026.9.3 | tools, voice | voice | bundled |
| @openclaw/volcengine-provider | 2026.9.3 | other | models | bundled |
| @openclaw/whatsapp | 2026.9.3 | channels | channels | bundled |
| @openclaw/zai-provider | 2026.9.3 | other | models | bundled |
| @openclaw/zalo | 2026.9.3 | channels | channels | bundled |
| @openclaw/zalouser | 2026.9.3 | channels, tools | channels | bundled |
| @openclaw/zoom-meetings | 2026.9.3 | other | voice | bundled |
| @openguardrails/moltguard | 6.9.4 | security | security | generated |
| @openviking/openclaw-plugin | 2026.9.8-2 | memory | memory | generated |
| @qverisai/qveris | 2026.9.9 | models, context, web | integrations | generated |
| @robot-inventor/discord-ignore | 1.1.10 | other | channels | generated |
| @shellbot/openclaw-pixcli | 3.4.2 | tools, media, voice | media | generated |
| @soimy/dingtalk | 3.6.11 | channels | channels | generated |
| @tencentdb-agent-memory/memory-tencentdb | 0.2.2 | memory | memory | generated |
| @tensorfold/openclaw-google-workspace | 0.2.1 | tools | integrations | generated |
| @xmoxmo/bncr | 0.6.7 | other | channels | generated |
| 100-percent-skill-vetter | 2.0.1 | runtime, security, gateway | security | generated |
| apple-pim-cli | 3.18.0 | tools, security, web | productivity | generated |
| browser-use-plugin | 1.0.0 | web | web | generated |
| chrome-openclaw-sider | 1.0.26 | channels, runtime | channels | generated |
| claude-code-sync | 0.3.0 | other | developer-tools | generated |
| clawlink-plugin | 0.3.6 | tools, channels, web | integrations | generated |
| database | 0.1.0 | (absent) | data-analytics | generated |
| douyin-insights-openclaw-plugin | 0.2.9 | other | research | generated |
| email | 0.1.0 | web | inbox-collaboration | generated |
| excel | 0.1.0 | tools | documents-files | generated |
| gc-provider | 0.1.33 | models, media | models | generated |
| google-ads-assistant | 1.0.0 | other | sales-marketing | generated |
| hirey | 1.0.74 | other | other | generated |
| hivemind | 0.7.150 | other | memory | generated |
| holo-wechat-mp | 0.2.0 | media, channels | sales-marketing | generated |
| lobu | 14.0.0 | other | memory | generated |
| memsearch | 0.3.18 | memory, models | memory | generated |
| message-linter | 2026.7.1-beta.5 | other | documents-files | generated |
| octo | 1.4.1 | channels, tools | channels | generated |
| ocuclaw | 1.3.7 | other | channels | generated |
| openclaw-ai-video-editor | 1.1.2 | tools, media | media | generated |
| openclaw-browser-automation | 1.5.0 | web | web | generated |
| openclaw-code-agent | 4.7.15 | other | developer-tools | generated |
| openclaw-memory-graph | 0.19.6 | tools, models, memory | memory | generated |
| openclaw-plugin-heygen | 0.1.0 | media | media | generated |
| openclaw-seatalk | 1.1.1 | channels, tools, security | channels | generated |
| openclaw-weixin | 0.3.0 | other | channels | generated |
| sequential-thinking | 2026.7.1-2 | other | other | generated |
| web-search-plus-plugin-v2 | 4.0.3 | tools, web | web | generated |
| xhs-insights-openclaw-plugin | 0.1.23 | other | research | generated |
