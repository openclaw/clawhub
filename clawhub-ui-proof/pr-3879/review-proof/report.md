# Managed company MCP publication — local acceptance

Real ClawHub at http://127.0.0.1:57232, isolated anonymous Convex at 57230/57231. Baseline is upstream 72a32c2626; candidate is the proposed stack. No production changes.

## Observed behavior

- Before: Management → Plugins offered package moderation lookup. After: an active administrator with OpenClaw publishing access can add/edit/unpublish through the same backend as `clawhub-admin managed-mcp`.
- Real signed-in browser creation submitted a generated Excalidraw test package for security checks. Real browser editing submitted DeepWiki 1.2.0. Browser unpublishing removed the disposable test package.
- Normal publication gating: DeepWiki 1.2.0 returned HTTP404 while pending, then HTTP200 after scan completion. DeepWiki 1.0.0's SHA256 stayed `784e0e2fe375ce9b132fd517870a7209713ab26b160190e1b84959b3ae78a3d5` across that update.
- A deliberately blocked disposable release stayed HTTP404. A clean follow-up became HTTP200; normal unpublish returned it to HTTP404. No manual package visibility edits.
- Initial launch definitions have version1.0.0; local final proof uses immutable version1.3.0 after iterative authoring validation. The CLI imported all66 individually through the same admin HTTP operation.

## Security evidence limits

TruffleHog and ClawScan worker outcomes in the local publication proof are **SIMULATED**, including the synthetic blocked fixture. Normal package validation and Plugin Inspector actually ran; the real staged publication/download gates consumed those simulated worker results. The autoreview helper separately ran a real TruffleHog scan of the source diff. This is not production scanning or certification of the remote services. Account sign-in and authenticated provider calls are not claimed.

## Current upstream OpenClaw

Unchanged commit `0338bb3adbafa24f8887e169634169ae60d690af` installed generated DeepWiki and PostHog bundles using normal CLI installation, capability consent and isolated state. Its native session runtime discovered DeepWiki's three tools and completed `read_wiki_structure({repoName:"facebook/react"})` with `isError:false`.

**Separate consumer gap:** PostHog's published placeholder is accurate, but current upstream forwards literal `Bearer ${POSTHOG_MCP_TOKEN}` from an installed bundle into the HTTP transport, even when the variable is set. Verified with a fake sentinel and zero PostHog requests. A shared OpenClaw placeholder-expansion fix plus a real PostHog credential test is needed before declaring PostHog usable. No OpenClaw source or PR was changed in this task.

Current upstream `openclaw mcp list` lists configured servers only; the native session runtime is the installation/discovery proof surface. No personal Gateway/configuration was touched.

## Compatibility matrix

Historical evidence:54 OAuth authorization-ready configurations,11 successful public tool calls,PostHog token pending. Fresh checks below are unauthenticated endpoint/metadata observations, not fresh client registration or account consent. Indeed preserves `job_seeker.jobs.search offline_access`; paths/query restrictions and PayPal/Square SSE are unchanged.

| Package | Category | Auth | Transport | Fresh check |
|---|---|---|---|---|
| @openclaw/airtable | productivity | oauth | streamable-http | OAuth discovery ready |
| @openclaw/algolia | web | oauth | streamable-http | OAuth discovery ready |
| @openclaw/alltrails | research | none | streamable-http | available |
| @openclaw/amplitude | data-analytics | oauth | streamable-http | OAuth discovery ready |
| @openclaw/atlassian | productivity | oauth | streamable-http | OAuth discovery ready |
| @openclaw/attio | sales-marketing | oauth | streamable-http | OAuth discovery ready |
| @openclaw/aws-knowledge | research | none | streamable-http | available |
| @openclaw/betterstack | infrastructure | oauth | streamable-http | OAuth discovery ready |
| @openclaw/buildkite | developer-tools | oauth | streamable-http | OAuth discovery ready |
| @openclaw/calendly | scheduling | oauth | streamable-http | OAuth discovery ready |
| @openclaw/canva | media | oauth | streamable-http | OAuth discovery ready |
| @openclaw/circleci | developer-tools | oauth | streamable-http | OAuth discovery ready |
| @openclaw/clickup | productivity | oauth | streamable-http | OAuth discovery ready |
| @openclaw/close | sales-marketing | oauth | streamable-http | OAuth discovery ready |
| @openclaw/cloudflare | infrastructure | oauth | streamable-http | OAuth discovery ready |
| @openclaw/cloudinary | media | oauth | streamable-http | OAuth discovery ready |
| @openclaw/comfy-cloud | media | oauth | streamable-http | OAuth discovery ready |
| @openclaw/context7 | developer-tools | none | streamable-http | available |
| @openclaw/craft | documents-files | oauth | streamable-http | OAuth discovery ready |
| @openclaw/datadog | infrastructure | oauth | streamable-http | OAuth discovery ready |
| @openclaw/deepwiki | developer-tools | none | streamable-http | available |
| @openclaw/dropbox | documents-files | oauth | streamable-http | OAuth discovery ready |
| @openclaw/fireflies | inbox-collaboration | oauth | streamable-http | OAuth discovery ready |
| @openclaw/gitlab | developer-tools | oauth | streamable-http | OAuth discovery ready |
| @openclaw/globalping | infrastructure | oauth | streamable-http | OAuth discovery ready |
| @openclaw/grafana | infrastructure | oauth | streamable-http | OAuth discovery ready |
| @openclaw/hugging-face | models | oauth | streamable-http | OAuth discovery ready |
| @openclaw/indeed | productivity | oauth | streamable-http | OAuth discovery ready |
| @openclaw/intercom | inbox-collaboration | oauth | streamable-http | OAuth discovery ready |
| @openclaw/kiwi | research | none | streamable-http | available |
| @openclaw/klaviyo | sales-marketing | oauth | streamable-http | OAuth discovery ready |
| @openclaw/linear | productivity | oauth | streamable-http | OAuth discovery ready |
| @openclaw/microsoft-learn | research | none | streamable-http | available |
| @openclaw/miro | media | oauth | streamable-http | OAuth discovery ready |
| @openclaw/mixpanel | data-analytics | oauth | streamable-http | OAuth discovery ready |
| @openclaw/monday | productivity | oauth | streamable-http | OAuth discovery ready |
| @openclaw/motherduck | data-analytics | oauth | streamable-http | OAuth discovery ready |
| @openclaw/neon | infrastructure | oauth | streamable-http | OAuth discovery ready |
| @openclaw/netlify | infrastructure | oauth | streamable-http | OAuth discovery ready |
| @openclaw/notion | documents-files | oauth | streamable-http | OAuth discovery ready |
| @openclaw/paypal | finance-payments | oauth | sse | OAuth discovery ready |
| @openclaw/plaid | finance-payments | oauth | streamable-http | OAuth discovery ready |
| @openclaw/postman | developer-tools | oauth | streamable-http | OAuth discovery ready |
| @openclaw/prisma-postgres | infrastructure | oauth | streamable-http | OAuth discovery ready |
| @openclaw/railway | infrastructure | oauth | streamable-http | OAuth discovery ready |
| @openclaw/robinhood | finance-payments | oauth | streamable-http | OAuth discovery ready |
| @openclaw/semgrep | security | oauth | streamable-http | OAuth discovery ready |
| @openclaw/sentry | developer-tools | oauth | streamable-http | OAuth discovery ready |
| @openclaw/square | finance-payments | oauth | sse | OAuth discovery ready |
| @openclaw/stripe | finance-payments | oauth | streamable-http | OAuth discovery ready |
| @openclaw/supabase | infrastructure | oauth | streamable-http | OAuth discovery ready |
| @openclaw/todoist | productivity | oauth | streamable-http | OAuth discovery ready |
| @openclaw/trivago | research | none | streamable-http | available |
| @openclaw/twelve-data | finance-payments | oauth | streamable-http | OAuth discovery ready |
| @openclaw/twilio-docs | research | none | streamable-http | available |
| @openclaw/vercel | infrastructure | oauth | streamable-http | OAuth discovery ready |
| @openclaw/webflow | sales-marketing | oauth | streamable-http | OAuth discovery ready |
| @openclaw/wolfram | research | none | streamable-http | available |
| @openclaw/wordpress-com | sales-marketing | oauth | streamable-http | OAuth discovery ready |
| @openclaw/brex | finance-payments | oauth | streamable-http | OAuth discovery ready |
| @openclaw/clay | sales-marketing | oauth | streamable-http | OAuth discovery ready |
| @openclaw/excalidraw | media | none | streamable-http | available |
| @openclaw/godaddy | infrastructure | none | streamable-http | available |
| @openclaw/otter | inbox-collaboration | oauth | streamable-http | OAuth discovery ready |
| @openclaw/posthog | data-analytics | api-key | streamable-http | authentication-required |
| @openclaw/upwork | productivity | oauth | streamable-http | OAuth discovery ready |

## Final local gates

Passed `ci:static`, `ci:unit` (7,353 tests passed;3 skipped), `ci:types-build`, `ci:packages`, `ci:e2e-http`, and real signed-in Chromium create/edit/unpublish flows. Full collection import:66/66. Final version1.3.0 downloads:66 pending404 →66 published200. Real browser catalog loaded exactly66 package links.

One full unit invocation passed every test but exited on an unrelated Node/macOS `setTypeOfService EINVAL` exception in the existing local-Convex bootstrap helper. A normal full rerun passed. Existing dependency advisories were warning-only under repository policy.

## Source review disposition

Ran the repository autoreview helper with its default gpt-5.6-sol/high engine and real TruffleHog diff scan. Fixed URL credential-name/trailing-dot checks, canonical transport fields, shared host/global inspection budgets, OAuth metadata summaries, and dry-run messaging. The last helper still reported two broader hardening suggestions; this is **not an unqualified clean automated review**:

- A universal query/path allowlist was not adopted. Managed definitions deliberately support provider-specific endpoint paths and restriction parameters; all published definition text is public and passes normal secret scanning. The schema rejects known credential URL forms and credentials must use placeholders, but arbitrary secret text cannot be proven absent by a URL parser. Changing the authoring contract to a provider-specific allowlist requires a separate decision.
- Advertised OAuth endpoints receive syntax checks, while every URL ClawHub actually requests receives pinned all-addresses-public DNS enforcement. The suggested additional DNS check of endpoints ClawHub never contacts is a consumer-hardening follow-up; a publication-time DNS answer cannot replace runtime protection when the consumer later authenticates. No provider authorization/token/registration endpoint is called by this preview.

Other reviewed decisions: OpenClaw's verified `oauth.scope` singular stays intact; 403 policy/WAF denials stay unavailable instead of being advertised as sign-in compatibility; dry-run explicitly reports that icon decoding, network compatibility and scans remain unchecked.

## Final full-collection consumer proof

All **66 final immutable v1.3.0 packages installed, enabled and natively discovered** on unchanged upstream OpenClaw0338bb3adbafa, across four independent fresh profiles (21+15+15+15), with zero discovery diagnostics and no manual MCP entries. Every installed identity/version, exact URL/query, HTTP/SSE transport, and OAuth scope matched the collection. Indeed's exact corrected scope survived. Fresh DeepWiki3-tool discovery and public read_wiki_structure call passed on v1.3.0. PostHog's placeholder gap was reconfirmed with no provider requests.

Each installation used `pnpm openclaw --profile <isolated-profile> plugins install clawhub:@openclaw/<id>@1.3.0 --accept-capabilities --acknowledge-install-policy-warning` against the local ClawHub registry. These consent flags acknowledged the explicitly simulated local fixtures; no dangerous override was used. A single DeepWiki driver row records exitCode:null after safe batch repartition; successful CLI output, exact installed bytes and the live native call prove its completion. Other65 CLI exits were zero. This is native bundle/transport runtime proof, not a full Gateway/model conversation.

The real browser also confirmed an authenticated ordinary user sees `Management only.` and cannot access MCP authoring controls. API/UI write authorization is covered by backend integration tests.
