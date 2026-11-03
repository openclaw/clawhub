# Plugin detail capability rows

The public ClawHub plugin detail presents declared capabilities as readable rows
above the README, without content tabs. Keep install controls, scan warnings,
manager validation, signed-file skill previews, and malicious-download blocking
independent of this presentation. Package details and lazy version-history
management remain accessible as disclosures below the README; old hash links
continue to open the corresponding disclosure.

Extensions come only from top-level manifest `uiCapabilities`, in canonical order:
page, navigation, panel, action, accessory, widget, inline, replacement,
link-reader. An omitted declaration is unspecified; an empty array explicitly
declares none. Neither browser-entry presence nor `hasNativeUi` implies an extension
kind. Custom UI is listed separately only when a declared `controlUi.entry`
names a built browser file in the signed release inventory; the page never loads
or executes that entry. The release summary and shared public schema preserve these declarations.
Old releases lacking the summary field need re-ingestion/republication to expose
new metadata; do not synthesize declarations for them at render time.

Tools and other contract families use the stored declared names, not guessed
runtime registrations or fabricated descriptions. MCP endpoint redaction is
performed upstream and must be respected in rows. This is catalog metadata, not
proof of runtime availability, install authorization, or scanner success.

Reusable local proof fixtures: `devSeedExtra:seedPluginDetailFixtures` creates dense,
explicit-none, and legacy plugin releases with real stored README/skill files.
These fixtures deliberately do not run scanners or external providers.

## Visual anatomy

Match the real Control UI plugin detail's capability anatomy: ruled 16px section
headings with 24px count badges; 36px bordered icon tiles with 18px artwork;
12px title/description hierarchy, 14px icon/copy gaps, 12px row insets, and 28px
section spacing. Contribution kinds use the canonical per-kind artwork. Known
contract families use their user-facing capability name and description, while
the actual declared identifiers remain visible. Runtime-only tool descriptions
are not fabricated when the catalog contains names alone.

Keep the ClawHub site shell, compatible install command, security controls, and
mobile About/Stats interaction owned by their existing surfaces. Align the
content/sidebar ratio without transplanting the OpenClaw Settings navigation.
Validate visual corrections against actual isolated OpenClaw and ClawHub
captures before publication; source inspection or green tests alone do not prove
visual alignment.
