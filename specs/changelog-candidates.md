# Changelog candidates

Scope: the last ~2 months of `openclaw/clawhub`, limited to user-visible and product-significant changes.

This file is intentionally opinionated. It keeps only items that would make sense in a real public changelog. I excluded internal-only work, seed/mock data, and temporary UI tuning that never became product behavior.

## Homepage / browse / listings

- `2026-06-19 ea0125d8` — Refresh homepage experience.
- `2026-06-22 2993f6cc` — Refine homepage hero.
- `2026-06-22 519f5630` — Cache homepage listing tabs.
- `2026-06-10 4496acf9` — Remove homepage suggestion chips.
- `2026-06-15 60c61d44` — Remove homepage proof stats strip.
- `2026-06-18 6bd73e33` — Unify header search results.
- `2026-06-22 9ea97b3c` — Polish browse listing pages.
- `2026-06-23 7cc6b221` — Rename publishers browse to Creators.
- `2026-06-23 b927db63` — Show only downloads in plugin browse listings.
- `2026-06-23 37eac63d` — Fix official-first category plugin pagination.
- `2026-06-24 cfb21978` — Align publisher grouped All tab with catalog total.
- `2026-06-24 173e28dd` — Refresh publisher profile detail and catalog UX.
- `2026-06-22 55fe4a85` — Add owner-qualified catalog routes.
- `2026-06-18 769c6208` — Move topic discovery into search and category browse.
- `2026-06-17 04ec2121` — Add controlled catalog taxonomy and topics.
- `2026-06-17 4bc58e49` — Add catalog classification backfill.
- `2026-06-17 5f0e1ee6` — Import owned public GitHub skills.
- `2026-06-23 32aa2348` — Add public GitHub skill feed candidates.
- `2026-06-23 35f6d348` — Include creators in global search.
- `2026-06-23 ae66202d` — Show official badges in search typeahead.
- `2026-06-25 843cf78c` — Include official owners in skill browse.
- `2026-06-25 d1716c6c` — Show official badge on skills.
- `2026-06-25 97978254` — Reserve OpenClaw publisher handles.
- `2026-06-23 6aab4f94` — Publish verified organization skills feed.
- `2026-06-23 ab862d49` — Include verified personal skill publishers.
- `2026-06-23 72c5cdd8` — Publish hosted OpenClaw plugin feed.
- `2026-06-23 94f2f532` — Version and harden hosted plugin feed.
- `2026-06-21 c70755d2` — Fix official plugin download listing.
- `2026-06-19 53d16a55` — Align official plugin browse with official publishers.
- `2026-06-25 5388ca7b` — Authenticate GitHub repo discovery.
- `2026-06-25 164959d7` — Streamline skill and plugin publishing.
- `2026-06-25 7fa17e15` — Keep the skills all tab on approved recommended ranking.
- `2026-06-25 64e5bcb6` — Resolve approved browse versions during pending review.
- `2026-06-25 f78d1b26` — Align pending browse rules with GitHub-backed spec.
- `2026-06-25 3568288c` — Align search creators list and hide org roles publicly.
- `2026-06-26 2310b91a` — Update publisher social images.
- `2026-06-13 6afb91b7` — Move docs to canonical subdomain.

## Dashboard / publisher workspace

- `2026-06-05 3fbe2756` — Add publisher abuse review dashboard.
- `2026-06-09 27faf509` — Surface author remediation for plugin validation.
- `2026-06-11 3e66b500` — Expose skill description setup metadata.
- `2026-06-14 61302e92` — Add plugin versions tab.
- `2026-06-15 91151519` — Allow official personal publishers.
- `2026-06-15 e49d680f` — Add profile link to account menu.
- `2026-06-15 bb35aca7` — Show publisher installs on profiles.
- `2026-06-15 44ce895b` — Use installs across public adoption surfaces.
- `2026-06-16 078425f0` — Add plugin install ranking.
- `2026-06-17 b1e077da` — Polish ClawHub header and search UX.
- `2026-06-17 1a3fdd8f` — Redirect sign-in to dashboard.
- `2026-06-22 379c1871` — Add skill and plugin download activity graphs.
- `2026-06-22 a86c48ce` — Tune publisher abuse pressure labels.
- `2026-06-24 40e345f4` — Move creator into skill and plugin detail hero.
- `2026-06-24 6f537bf7` — Update org profile images and Downloads metric in OG cards.
- `2026-06-24 82197de7` — Restore full-color round user avatars in Cmd+K typeahead.
- `2026-06-25 8e7c8d44` — Add durable organization logo uploads.
- `2026-06-25 11d70e3f` — Add freshness-aware discovery ranking.
- `2026-06-25 997203b1` — Mark plugin SkillSpector as not applicable.
- `2026-06-25 8e56a9f8` — Preserve publisher across add flow.
- `2026-06-17 815a053b` — Add post-publish share dialog.
- `2026-06-25 5b1be27f` — Prefill short summary from SKILL.md with discovery banner.
- `2026-06-25 a1fd095b` — Refine summary prefill note.
- `2026-06-25 9c423c70` — Rebuild publisher workspace with clearer hierarchy.
- `2026-06-26 d07e7560` — Refine publisher dashboard workspace.
- `2026-06-26 afcfddcc` — Polish stats, sidebar, and compact download charts.
- `2026-06-26 77e79d3a` — Warn before publisher abuse autobans.
- `2026-06-26 a954bef2` — Normalize abuse review summaries.
- `2026-06-27 9fb6ab40` — Avoid nested abuse review pagination.
- `2026-06-27 ec13cf54` — Refine publisher dashboard layout.

## CLI

- `2026-06-11 9a067103` — Expose package trusted publisher CLI commands.
- `2026-06-13 3711b45d` — Default CLI login to device flow.
- `2026-06-13 49b0c33f` — Require confirmation for CLI token handoff.
- `2026-06-13 84f2216d` — Harden clawhub CLI sync reporting.
- `2026-06-13 64e22ae0` — Harden clawhub CLI release and sync checks.
- `2026-06-15 e3e5705d` — Remove sync command.
- `2026-06-22 bbe887fa` — Restore skill sync command.
- `2026-06-23 a128c101` — Release clawhub CLI 0.23.0.
- `2026-06-23 f3ab8663` — Polish terminal branding.
- `2026-06-23 d4d69d42` — List manual skill directories.
- `2026-06-23 1461d0f1` — Show moderation in inspect.

## API / packages

- `2026-05-02 0fe234e6` — Add clawpack pack command.
- `2026-05-02 0774d0fe` — Publish uploaded clawpacks.
- `2026-05-02 f3cf886c` — Download and verify package artifacts.
- `2026-05-02 12610625` — Serve clawpack mirror artifacts.
- `2026-05-02 88d0cc78` — Accept clawpack uploads.
- `2026-05-02 86e58d60` — Add clawpack parser.
- `2026-05-02 238f3f6b` — Persist official migrations.
- `2026-05-02 402ddddb` — Manage official migrations in API.
- `2026-05-02 773df44f` — Manage official migrations in CLI.
- `2026-05-02 669e14b9` — Show package migration status.
- `2026-05-02 417537a1` — List moderation queue.
- `2026-05-02 276760d7` — Report packages for review.
- `2026-05-02 ff68eeb5` — Triage package reports.
- `2026-05-02 6e5578ee` — Submit package appeals.
- `2026-05-02 28da5105` — Resolve package appeals.
- `2026-05-02 68017740` — Show moderation status.
- `2026-05-02 1b33c949` — Filter by artifact availability.
- `2026-05-02 c9ad1305` — Require environment metadata.
- `2026-05-02 00970bbe` — Require code plugin host targets.
- `2026-05-02 87a286fe` — Backfill package artifact kinds.
- `2026-05-02 bc234c7d` — Report OpenClaw readiness.
- `2026-05-03 199e6a0c` — Expose legacy zip artifact aliases.
- `2026-05-03 343781a6` — Decode scoped package paths.
- `2026-05-03 f53b4904` — Avoid redundant latest tag version reads.
- `2026-05-03 887e81eb` — Return lean skill list payloads.
- `2026-05-03 cf5778d7` — Route package search through digest index.
- `2026-05-03 4c52dc23` — Allow legacy package downloads.
- `2026-06-10 18766980` — Simplify package listing cursors.
- `2026-06-17 0189ddd5` — Add install sort support to package catalog APIs.

## Security / ClawScan / SkillSpector / validation

- `2026-04-27 1c430cc1` — Add scanner-specific security pages.
- `2026-04-27 e6c3d6ff` — Add owner rescan requests.
- `2026-04-27 fb3bcbaf` — Show owner flagged inventory on dashboard.
- `2026-04-28 ef2846b2` — Add owner rescan security surfaces.
- `2026-04-28 a28d94c3` — Show in progress scans.
- `2026-04-29 a0713e18` — Add security dataset snapshots.
- `2026-04-29 59e28c78` — Add security dataset eval runner.
- `2026-04-29 e2d187b3` — ClawScan seed + frontend.
- `2026-04-29 3ab5762d` — UI updates for ClawScan.
- `2026-04-29 05c6409c` — Expose dataset lineage query.
- `2026-04-29 667c69a2` — Add snapshot time windows.
- `2026-04-29 79eddc02` — Merge ClawScan ASI analysis.
- `2026-04-30 42bc3121` — Export redacted skill content for security dataset.
- `2026-04-30 b96af739` — Move ClawScan eval runner into ClawHub.
- `2026-04-30 f7c5ae5a` — Label suspicious as review for scans.
- `2026-04-30 3f17fd55` — Fully strip hidden HTML comments.
- `2026-04-30 3f2153e6` — Neutralize LLM eval prompt injection.
- `2026-04-30 9ea3ed89` — Fail closed when VT is unavailable.
- `2026-04-30 cd37acad` — Add skill redaction hide mutation.
- `2026-04-30 6c93d209` — Flag disabled TLS verification.
- `2026-04-30 65d02e57` — Add frontend security headers.
- `2026-05-01 e7ad7c62` — Wrap ClawScan skill artifacts in prompt boundary.
- `2026-05-01 bff959c8` — Rely on JSON artifact neutralization.
- `2026-05-02 bed2d4b1` — Moderate package releases.
- `2026-05-02 f2a61c9d` — Scan clawpack artifacts with VirusTotal.
- `2026-05-02 3aff30b9` — Hide staged bundle publish UX.
- `2026-05-12 72d4e7a3` — Restore skills via moderator unhide.
- `2026-05-13 893f341b` — Add security audits page.
- `2026-05-13 a116d928` — Show ClawScan risk levels in UI.
- `2026-05-13 a1666bb1` — Export ClawScan findings sidecar.
- `2026-05-13 9fcf892e` — Add ClawScan finding permalinks.
- `2026-05-18 35aa372b` — Run ClawScan classification through Codex.
- `2026-05-19 9be35a3d` — Restore skill rescan moderation command.
- `2026-05-23 1db8a6ca` — Support package security rescans.
- `2026-05-23 c538848a` — Use SkillSpector for agentic risk findings.
- `2026-05-25 01946864` — Refine SkillSpector audit UI.
- `2026-05-27 57bc9f2a` — Add bulk skill rescan admin tool.
- `2026-05-27 b8eaada6` — Frame SkillSpector findings as advisory.
- `2026-05-28 05f27f64` — Export SkillSpector dataset signals.
- `2026-05-28 51967bca` — Export SkillSpector issue details.
- `2026-06-09 27faf509` — Surface author remediation for plugin validation.
- `2026-06-09 7b71c15e` — Delegate browser automation scanning to SkillSpector.
- `2026-06-11 6bc45b30` — Block malicious skill versions on download.
- `2026-06-15 76638de7` — Run full ClawScan for GitHub skills.
- `2026-06-17 d6e54bdb` — Scope plugin validation findings to latest release.
- `2026-06-22 775146ff` — Publish security dataset from live export.
- `2026-06-22 e82f0704` — Publish security dataset from live Convex export.
- `2026-06-24 a61f302a` — Refresh plugin validation panel.
- `2026-06-25 3f66813e` — Limit SkillSpector to bundled skills.
- `2026-06-25 7ee573b1` — Repair legacy plugin SkillSpector results.

## Public changelog shortlist

These are the strongest candidates for a compact public changelog. The wording below is intentionally more reader-facing than the raw commit list, but still grounded in shipped product changes.

### A cleaner ClawHub homepage

ClawHub's homepage was rebuilt around faster discovery, clearer browse paths, and a calmer first impression. The new hero, simplified listing tabs, cached homepage sections, and removed suggestion/proof clutter make the front door feel more like a product catalog and less like an internal dashboard.

### Better browsing for skills, plugins, and creators

The browse experience now has clearer surfaces for Skills, Plugins, and Creators. Listings were tightened, plugin cards now emphasize downloads instead of noisy secondary metrics, creator search became part of global discovery, and official/verified publishers are easier to recognize across search and browse.

### Owner-aware catalog routes and verified feeds

Catalog pages now understand owner-qualified routes, verified publisher feeds, and hosted OpenClaw plugin feeds. This gives ClawHub a stronger foundation for public package discovery, avoids slug collisions, and makes official organization and personal publishers easier to route, search, and display correctly.

### GitHub import and publishing flow improvements

Publishers can bring in public GitHub skills, authenticate repo discovery, prefill package summaries from `SKILL.md`, and keep publisher context through the add flow. The publishing path is less manual, with better defaults and fewer places where authors have to rebuild metadata by hand.

### Clawpack support across CLI and API

ClawHub's package pipeline gained real Clawpack support: packing, uploading, verifying, mirroring, downloading, and publishing artifacts through the CLI and API. This is the biggest platform-level package workflow candidate, because it changes how plugin/package artifacts move through ClawHub end to end.

### Package moderation, appeals, and migration tools

Package operations now include moderation queues, report triage, appeals, migration status, artifact filters, environment metadata, and host-target checks. This is less visually flashy, but important: it turns package publishing into something the platform can govern and recover, not just display.

### SkillSpector and ClawScan review surfaces

Security review became much more visible. ClawHub added scanner-specific pages, rescan requests, flagged owner inventory, SkillSpector issue exports, remediation guidance, package rescans, ClawScan datasets, and download blocking for malicious skill versions. This should probably be framed as a trust and review update, not just "security UI".

### A real publisher workspace

The dashboard evolved into a publisher workspace: packages, attention items, validation review, download stats, abuse review, publisher context, post-publish sharing, and sidebar updates now live closer together. This is the strongest dashboard changelog candidate because it explains the shift from a basic account page to daily publisher operations.

## Not changelog material

- Seed/mock data used only for local iteration.
- Hero tuning knobs, spacing knobs, and one-off visual probes unless they shipped as part of the product.
- Temporary state while we were testing expanded read-more/read-less layouts.
