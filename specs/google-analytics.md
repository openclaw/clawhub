# ClawHub Google Analytics

The integration uses the native Google tag `G-3SK7X2YLSJ` in shared property
`557069374`, stream `15954198155`. It covers traffic, useful native Enhanced
Measurement, and observable site actions. It excludes heatmaps, replay, raw pointer
or keystroke recording, advertising, User-ID, BigQuery, and other tracking vendors.
Vercel Web Analytics and Speed Insights client emitters and SDK dependencies are
removed. Vercel hosting, OIDC, deployment configuration, CLI telemetry, and provider
server-side records are outside that client-tracking removal.

## Eligibility and ownership

Only the production frontend at exact origin `https://clawhub.ai` is eligible.
`www.clawhub.ai`, `clawhub.com`, and `clawdhub.com` redirect there. Separately serving
`hub.openclaw.ai`, `docs.clawhub.ai`, mirrors, previews, local/test/staging, and unknown
hosts are excluded. Vercel project membership does not establish analytics scope.

TanStack owns one `page_view` per committed eligible pathname. Configuration uses
`send_page_view:false` in one config; persistent native `gtag(set)` updates only safe
page location/title/referrer before each public navigation. Initial page fields are
not pinned at config scope. Shared automatic history pageviews must be disabled, while
other useful Enhanced Measurement remains on. Query/hash changes and re-renders do
not create pageviews. Auth/loading pauses preserve the counted navigation; a committed
departure resets it. An abandoned pending navigation does not create a return view.
Trusted BFCache restores use this same owner. A restored counted public document
gets one new view; an unmeasured document first granted while cached gets one view
total. Actual `pagehide` defers first activation until restore, without disabling
ordinary background tabs. Refresh browser privacy signals before native restore callbacks;
ordinary `pageshow` must not force another view.

Successful route matches and resolved authentication are required. Signed-in visitors
may view verified public resources. Public catalog loaders establish visibility;
missing results, holds, private package channels, account/profile, administration,
auth/CLI, publishing, and unknown routes fail closed. GitHub-backed public skills may
have no archive version. Public resource URLs/IDs including publisher handles are
content metadata, not visitor identity. Never pass visitor account/profile IDs,
email/phone, private messages, typed form values, credentials, or raw errors.

Safe public UTMs and filtered public search queries survive in the configured URL.
Referrers retain origin only. The native linker owns cross-domain continuity; no
forced cookie domain or visitor identity extension is used. Account search and
credential-looking query contexts are excluded. Fixed page titles avoid incorporating
unverified visitor/UI text. Native search coverage must be established from actual
SDK behavior, rather than inferred from URL presence or stream settings.

The shared native search keys are `q`, `s`, `search`, `query`, and `keyword`.
Only `q` is functional here: public `/search`, `/skills`, and `/plugins`, plus
excluded publisher/account routes. Before SDK activation or committed public
navigation, remove nonfunctional search keys while preserving remaining raw query
bytes, UTM/linker parameters, fragments, and history state. Unsafe functional terms
stay in the product URL but make the context ineligible. Non-search detail/index
routes must not generate native searches from a stray `q` parameter.

The SDK disable flag pauses collection before navigation and while classification is
unknown/private. A credential-bearing outbound destination pauses the current view
until navigation without changing its destination; ordinary public outbound remains
native. Sanitized config and application fields are necessary but do not prove that
native or previously queued requests are safe. Browser tests inspect delayed flushes.

## Automatic public Google Analytics

The approved 2026-10-03 collection rule starts analytics automatically when the
existing production, canonical-origin and authoritative public-route checks pass.
The nonvisual browser gate uses only the source rollout switch and browser GPC/DNT
signals. No saved analytics-choice record is read, written, renewed, migrated or
removed. Missing, old grant/denial, malformed, expired and inaccessible storage all
have the same public eligibility. No regional response is requested during startup
or needed to enable collection.

GPC and DNT `1` block collection. Refresh browser signals on focus, visibility,
resume and capture-phase pageshow before restored SDK callbacks; the existing
periodic signal check also remains. Each transition back to allowed uses a new
in-memory operation epoch, so asynchronous work captured before a blocked interval
cannot replay afterward. The pageview and safe workflow owners remain separate
from this browser gate and keep their existing public/private rules.

The retained `GET /api/analytics-consent` endpoint exposes historical regional
metadata with version `2026-10-02.v2`; it is not the current collection rule and is
not consumed by analytics startup. Its class-only/no-store/trusted-header contract
remains covered independently. Do not infer visitor eligibility from that response.

No analytics controls, prompts or replacement popup are rendered. The approved
minimal Privacy policy link at `https://openclaw.ai/privacy`, other footer links,
and pre-rollout CLI telemetry documentation remain unchanged.

The SDK is held until both browser and public-context gates allow it. Queue denied
analytics/advertising defaults before config/events; grant only analytics. Google
signals and advertising personalization remain disabled. A browser privacy signal
revokes application emission and sets the disable flag; deferred events and only
the known installation cookies `_ga` and `_ga_3SK7X2YLSJ` are cleared, preserving
unrelated cookies and unsaved work. Already-allowed queued public events may finish
delivery; no new blocked events may be captured or replayed later.

Web Vitals observers register only after an eligible gate. Automatic eligibility
with no browser privacy signal at the initial document observation permits buffered
initial entries (`eligibleSince=0`); an initially blocked document that later becomes
eligible uses registration time. Reject metrics with earlier entries. A browser
privacy signal or private/unknown route after registration permanently invalidates
that document's metric sink, so a later allow cannot report an aggregate spanning
blocked activity. A fresh document establishes its own eligibility. No observer or
network monkeypatch, synthetic metric, or automatic reload is used.

## Shared events and semantics

External selection placement is carried by `select_content`, separately from
Google's native Enhanced Measurement `click`. Never join or sum the two families
as a click total. Native click ownership, parameters and global gtag settings remain
unchanged; in particular there is no global placement set/reset.

Actual external-origin HTTP(S) anchors add paired `link_url` and `link_domain`
parameters to their selection event. Query and fragment are removed only from
telemetry; the DOM destination is unchanged. Credentialed, non-HTTP(S), and existing
sensitive/private targets are rejected. A URL over 1,000 characters or hostname
over 253 characters omits both fields, without truncation or changing an existing
selection. Other string fields retain their 100-character bound. Same-origin and
non-anchor selections, including copy actions, do not gain destination fields.

Existing promotion selections keep `promotion:<slug>` / `ui_location=promotion`.
Existing post-publish share anchors keep `share:discord` or `share:x` and
`ui_location=publish`; this dialog can appear on an authoritative public detail
route. The same callbacks remain unmeasured on private routes, with no new share
deferral or navigation/success claim.

The existing public-route owner adds exactly one generic selection for previously
untracked footer and explicitly marked public README, summary, repository,
contributor and security-reference anchors. They use `content_type=resource`,
bounded IDs `footer_link` / `detail_link`, and fixed `footer` / `detail` placement.
Markers are opt-in on known read-only resource containers, not on the generic
Markdown renderer or arbitrary previews. They sit outside sanitized user Markdown; labels
never come from text, visitor data or arbitrary classes. Explicitly owned gestures,
modal/menu/listbox contexts, unmarked areas, unresolved models and private routes
are excluded. Standalone security-audit and private Dashboard routes remain outside
the existing analytics route allowlist. Header/internal selections and all other
existing event identities retain their prior semantics.

Placement coverage begins with the served producer version that adds these fields.
Historical missing destination/placement stays missing; native link URLs or popup
views/dismissals cannot reconstruct an unrecorded selection placement. Grouped
event counts may be reconciled only against compatible same-event/filter/window
totals; grouped users are not additive unique users.

| Event                                                                                                 | Fields and invariant                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Native session/first visit/engagement, scroll, outbound click, video, download, search, form activity | Google owns supported behavior. A click/submission/download event does not prove downstream success.                                                                     |
| `select_content`                                                                                      | Public `content_id`, `content_type`, `ui_location`, native `method`; verified version selections may carry `artifact_version`.                                           |
| `copy_action`                                                                                         | Clipboard success/error only after the promise resolves; no copied text.                                                                                                 |
| `resource_action`                                                                                     | Acknowledged star/unstar/report/publish outcomes. Pending submission is `accepted`, not public-release success.                                                          |
| `search`                                                                                              | Explicit submitted public query with filtered `search_term` and bounded `search_context`; no keystroke events.                                                           |
| `resource_action`, action `search_results`                                                            | Rendered `result_count`, `search_status`, bounded context/filter. Error has no count; complete+0 alone means zero-results. Separate from submitted/native search totals. |
| `form_start`, `form_attempt`, `form_validation_error`                                                 | Private publishing lifecycle with fixed form/field/code names. Attempts are normal events, never conversions.                                                            |
| `login`                                                                                               | OAuth action acknowledgment plus resolved authentication; method `github`. No inferred signup.                                                                           |
| `popup_view`, `popup_dismiss`                                                                         | Fixed popup identity/placement and dismissal method; social selection is not completed sharing.                                                                          |
| `scroll_depth`, `section_view`                                                                        | 25/50/75% once per view; native90 remains separate. Sections need 50% visibility for one second.                                                                         |
| `content_engagement`                                                                                  | Visible-active30/60 second thresholds after25% scroll. `engagement_seconds` is an EVENT dimension, not elapsed duration or completion.                                   |
| `web_vital`                                                                                           | `metric_name`, `metric_rating`, `navigation_type`, `release`, and exactly one `lcp_ms`/`inp_ms`/`cls_score`. Never label document metrics as a later SPA route.          |
| `client_error`                                                                                        | Bounded type/code/release, at most three per view; no stack/message/input.                                                                                               |

`install_platform` and `release_channel` require genuine choices/verified metadata.
The platform-neutral CLI/prompt UI does not establish OS or completed installation.
Existing CLI install telemetry is not joined to GA visitor identity. No frontend
signup distinction, payment, or lead creation signal exists; do not invent conversions.

Source `search_submissions` is only `search`; `search_results` is only native
`view_search_results`; `search_outcomes` is only `resource_action` AND
`action=search_results`. Outcome counts are rendered snapshots, not searches or
total matched items. Never union or sum these three families as search totals.

Asynchronous producers capture a consent generation, policy epoch, and safe context
before work starts. Public copies/search/report/star completions require the same
public context generation, so even A-to-B-to-A cannot misattribute a stale outcome.
Denied starts and any intervening denial invalidate completion, including when the
same route becomes eligible again. Publishing outcomes retain only their fixed
workflow context across navigation. Login captures the authoritative ACK, then uses
the same generation guard while awaiting resolved authentication. These measurement
guards never change clipboard/mutation/auth UI success or failure.

Value-free private workflow events may wait in memory: at most eight newest events,
30-second TTL, consent checked at capture and flush, same consent epoch throughout.
Denial, expiry, or epoch change clears the queue. Only fixed publishing form
start/attempt/validation, acknowledged publish outcomes, publishing popup lifecycle,
and authoritative login success qualify. No IDs, inputs, search, copy, star, or report
events are queued. Denied login acknowledgments are dropped even if consent arrives
before authentication resolves.

Deferred events carry `event_deferred=1`, fixed registered `ui_location` of
`skill_publish`, `plugin_publish`, or `authentication`, an empty referrer, and a
reserved event-only `/_analytics/workflows/{skill-publish|plugin-publish|authentication}`
location with a fixed workflow title. This is a workflow context, not a visited URL:
never emit a synthetic pageview, backdate, or attribute it to an unrelated public
page. Closing/full-page redirects before return lose these memory-only events.
These lower-bound observations must stay out of precise chronological funnels.

## Rollout and validation

The source-owned `GOOGLE_ANALYTICS_ENABLED` switch is armed. The automatic-public
correction is authorized by the 2026-10-03 rollout brief and receives independent
review of its exact head before the normal production merge.
Vercel Git can serve the new main commit before exact-main Deploy Test and manual
frontend Deploy finish. The merge is therefore the activation operation; those
later gates validate the release and must not be described as pre-emission gates.
`VITE_GA4_ENABLED=1` remains available for isolated local acceptance fixtures, but
no production provider override is required. The retained regional metadata handler
requires Vercel execution before trusting its country header; that endpoint is not
a collection gate. Actual hosting proof, repository checks and exact-SHA release
gates remain mandatory. The
existing Deploy Test includes the class-only/no-store/spoofed-header endpoint check.
Protected Preview Proof accepts either source-switch state bound to the reviewed
checkout SHA, and always requires zero Google SDK/requests/cookies on preview.
A source-on preview may have an allowed browser gate; the independent exact
canonical origin and production deployment checks still block collection. Route failure evidence contains only fixed path/phase categories,
numeric status/timing, and at most 32 diagnostic entries; raw errors and credential
values must never enter its stdout or receipt.
The browser proof proxy uses the same native fetch transport as the protected
HTTP checks. Authenticated redirects are never followed; decoded response bytes
retain security/cache headers and separate cookies when fulfilled into the browser.
Normal production UI smoke uses a separate Playwright fixture that applies GPC
before application scripts, preserving all supplied auth cookies and storage. It
also aborts and fails on any Google request, including in explicitly created auth
contexts. This applies only to automated smoke at the exact production origin;
the separately authorized GA acceptance harness and real visitor policy are unchanged.
The analytics `release` field is the bounded filename of the executing content-hashed
client module (`import.meta.url`), or `unknown` outside a built browser module. It
does not include the host, query or fragment. Deployment-only metadata must not change
client asset hashes: the retired `VITE_GA4_RELEASE` is removed from the build process
environment and defined as `undefined` for direct and dynamic Vite env reads, including
values from dotenv files. The staging `VITE_APP_BUILD_SHA` and existing application
drift banner remain unchanged.

The completed frontend build writes an unreferenced `/.well-known/clawhub-deployment.json`
with exactly `schema_version`, `git_commit_sha` and `runtime_asset` (path and SHA256).
It hashes the actual built runtime asset, rejecting missing, ambiguous or disagreeing
outputs. The Git SHA is null when not supplied as a valid full commit. Vercel serves
this file with browser/CDN no-store. Preview proof requires the expected Git SHA,
the runtime asset path referenced by the served page, and its actual byte hash to
match this metadata; reading an unrelated commit label alone is insufficient. This
JSON is not imported by the app and carries no timestamp or environment dump.
Vercel [caches static files for the deployment lifetime](https://vercel.com/docs/caching/cdn-cache#static-files-caching),
so repeated metadata reads can report `HIT` and a positive `Age` despite the
browser/CDN no-store headers. Proof records those fields and binds the expected
commit to the actual served runtime path and bytes; it does not infer deployment
freshness from a cache miss. `STALE`, malformed cache evidence, mismatched commits
and mismatched assets still fail. The per-request regional endpoint separately
requires fresh, uncached responses; its stricter checks are unchanged.

User-provided-data activation
must be off; an unrelated internal SDK capability flag is not proof of activation.

Use the real local application, isolated headless browsers, and intercepted Google
collection/control requests. Cover ignored legacy records and unavailable storage,
no regional dependency, GPC/DNT transitions, public/private overlays and transitions, delayed
flushes, native events, one pageview, attribution, and linker continuity. Inspect all
URL/body fields. Mock conversion responses locally, never create production QA actions.
Browser transport is not provider ingestion; control pings are reported separately.

Before release run focused tests, static/unit/types-build and applicable UI checks,
independent review, successful exact-SHA Deploy Test, and the normal frontend production
workflow. Independently verify served commit/assets and bounded live requests after
GO. Gogcrawl owns ingestion/lag/report compatibility. Do not sum unique users across
hosts/providers, infer p75 from averages, or claim all GA UI explorations exist in the
Data API.
