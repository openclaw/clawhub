# Publisher package counts

Public publisher totals count a package only when it has a published release. A staged parent, with no latest release, no latest version summary, and a version count of zero, is not a published package.

## Stored counters

`publishedPackages` and the download, install, and star totals are denormalized. Complete stored counters normally move by the difference between the previous package and the next package.

Before this rule, every package that was not soft-deleted incremented `publishedPackages`. A deployment can therefore already store `publishedPackages: 1` for a parent that has no public release.

## First publication

When a package gains its published-package count, the package trigger does not add that difference to the stored counter. It recomputes the publisher from the current skill and package rows. Publishing the first release of a parent that was already counted replaces the stored total with one published package. It does not store two.

Download, install, and star changes on a package that stays published still use the difference. Removing a published package also uses the difference, which was already correct under the old rule and avoids a full catalog read on deletion. Those updates do not recompute the publisher.

## Rollout

Deploy this code before running the publisher stat backfill. The backfill uses the same contribution rule. Running it on the previous deployment would write the staged parent back into the total.

After deploy, either step corrects an idle publisher:

1. `maintenance.backfillPublisherStatsInternal` recomputes every publisher. Run it so a publisher that does not publish or delete a package still loses the extra staged count.
2. The next first publication that increases a publisher's published-package count recomputes that publisher immediately, including when the backfill has not reached it yet.

The first-publication path is safe before the backfill finishes. The backfill is still required for publishers that do not cross that boundary.

## Profile tabs

Templates are stored as packages, so `publishedPackages` counts plugins and templates together. That stored counter keeps its meaning for publisher lists, settings, and abuse scoring.

The publisher profile lists the two kinds on separate tabs. `publishers.getProfileByHandle` reads the publisher's template search digests and adds two derived counts to the stored ones:

- `templates` is the number of templates the Templates tab can list. Private templates are left out.
- `plugins` is `packages` minus every published template, private ones included, because `publishedPackages` counted those too.

`publishers.listPublishedPage` applies the same split. `kind: "plugin"` returns every package family except templates, and `kind: "template"` returns only templates, linked at `/<publisher>/templates/<slug>`.

The website shows the Templates tab only when the profile response carries `templates`. A website build that is newer than the deployed backend therefore keeps the previous two tabs and never sends the `template` kind to a backend that would reject it.
