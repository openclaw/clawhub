# Plugin API retirement notices

Plugin Inspector findings may identify a deprecated OpenClaw API, its replacement,
and a final compatibility date (`removeAfter`). ClawHub preserves these fields at
publish time and during nightly scans. This is advisory metadata, not a new
installability or security verdict.

Complete structured retirement guidance is sufficient even without a separate
`authorRemediation.summary`. Both publish and bulk-scan normalization preserve it.
Inspector 0.4.0 runs on Node.js 22.13+ (22.x) or 24+. Inspector 0.4.4 omits a
packed-target retirement notice when the selected OpenClaw package does not
publicly export every replacement name, so a host that still only exports
`getSessionEntry` does not tell the author to switch to `getSessionEntryAsync`.
Hosted Convex actions select Node.js 24 in `convex.json`, bulk scans explicitly
use Node.js, and the CLI loads Inspector only for local validation so ordinary Bun
commands do not import its Node-only module graph.

Convex defaults to Node.js 20 without an explicit runtime selection. Its runtime
upgrade can take a few minutes after a deployment; release operators should apply
the Node.js 24 configuration before shipping the Inspector upgrade when avoiding
a temporary publish-validation interruption is required. Local self-hosted Convex
uses its executor's Node.js version, so local browser proof alone cannot verify
the hosted runtime selection. Verify the exact merged revision with Deploy Test.

The public latest-release summary exposes only the API name, replacement guidance,
and valid calendar date. It must never expose source evidence, private findings,
or findings from an unreadable package or an older release. Full findings retain
their existing manager/staff authorization boundary. Existing records without
structured metadata continue through the existing validation path; no migration
or inferred dates are needed. The fields share the finding table's retention policy.

A complete deprecation warning gets a calm informational notice and a manager
dashboard nudge. Duplicate API/replacement/date entries collapse; distinct dates
remain distinct. These entries do not contribute to the dashboard warning count
or alarming validation presentation. Missing metadata and actual errors keep the
existing behavior. In particular, an error, breakage, or P0 finding cannot become
an informational retirement notice, and the public incompatibility alert is unchanged.

Before and on the final compatibility day (UTC), the notice says the API keeps
working until that date. Afterward it states the recorded retirement date without
claiming continued compatibility or inventing a new incompatibility verdict.
Long replacement guidance stays in expandable details; the compact notice points
to those replacement APIs. The notice uses informational semantic tokens, no
alarming icon, and no finding count.
