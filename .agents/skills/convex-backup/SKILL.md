---
name: convex-backup
description: "Set up Convex backups and run a restore DRILL that proves recovery — snapshot, restore into a throwaway preview, assert the data came back — plus a schedule matched to your RPO and a gated recovery runbook."
---

<!-- GENERATED from convex-agents content/capabilities/convex-backup.json — do not edit by hand. -->

# Back up — and prove the restore works

Every backup story has two halves and most people only do the first: taking the backup, and proving you can get it back. This capability does both — it sets up regular snapshot exports and then runs a RESTORE DRILL that actually recovers the data into a disposable preview and asserts it's intact. The drill reuses migrate-rehearse's exact primitives (snapshot export → preview deploy → snapshot import) pointed at recovery instead of a forward change, so the safety net is tested, not assumed.

## Workflow

1. GUARD: deploy-guard — classify + announce the deployment being backed up (reading/exporting is safe; the drill's restore target is a throwaway preview, never prod).
2. TAKE the snapshot: `npx convex export --path backup-<date>.zip` (add `--include-file-storage` if the app stores files). This is the backup artifact; treat it as sensitive real data.
3. SCHEDULE it (the ongoing half): recommend a cadence matched to how fast the data changes and how much loss is tolerable (RPO) — e.g. a daily `npx convex export` via CI/cron to durable storage the user controls, with a retention window. Convex's own platform backups exist; this adds a user-owned, portable copy.
4. RESTORE DRILL (the half almost nobody does — this is the point):
   (a) PRECONDITION: a Preview Deploy Key as `CONVEX_DEPLOY_KEY` (same requirement as migrate-rehearse; a paid-tier feature). If unavailable, drill against a fresh personal dev deployment instead and say so.
   (b) create a throwaway preview from the CURRENT code: `npx convex deploy --preview-create restore-drill-<date>`.
   (c) restore the snapshot into it: `npx convex import backup-<date>.zip --deployment restore-drill-<date> --replace` (import targets a deployment by NAME with `--deployment`; there is no `--preview-name` on import).
   (d) ASSERT recovery: read the restored data back (MCP `tables` for row counts, `data`/`runOneoffQuery` for spot-checks) and confirm the critical tables came back with the expected row counts and a sample of real records — a restore that 'succeeds' but lands 0 rows is a FAILED drill. Compare against the source's counts where available.
5. REPORT the drill result plainly: what was backed up, that the restore was ACTUALLY performed and verified (or that it FAILED and why — a failed drill is the most valuable output, found before a real disaster), the recommended schedule + retention, and the recovery runbook (the exact commands to restore to prod: `npx convex import backup.zip --replace --prod`, gated by deploy-guard, with the post-snapshot-write-loss caveat stated).
6. HYGIENE: delete local snapshot copies when done (real data); the drill preview auto-expires. Never commit a backup file.

## Rules

- A backup you have never restored is a hope, not a backup — always run (or offer to run) the restore DRILL, don't just take the export.
- The drill restores into a THROWAWAY preview (or dev), never prod; the restore target and the backup source are different deployments.
- Assert recovery, don't assume it: a restore that lands 0 rows is a FAILED drill — check critical-table row counts + a real-record sample against the source.
- A FAILED drill is the most valuable output — surface it loudly; that's the whole reason to drill before a real disaster.
- Schedule matched to RPO (how much data loss is tolerable); keep a user-owned portable copy alongside Convex's platform backups, with a retention window.
- Snapshots are sensitive real data: delete local copies when done, never commit them; the restore-to-prod runbook is deploy-guard-gated with the post-snapshot-write-loss caveat stated.
- Shares migrate-rehearse's snapshot+preview mechanics but aims them at RECOVERY, not a forward change — a forward schema change is migrate-rehearse.
