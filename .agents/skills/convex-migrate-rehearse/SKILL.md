---
name: convex-migrate-rehearse
description: "Rehearse a live-app schema change + backfill on a snapshot-seeded preview deployment, verify, then promote the proven change to prod with the snapshot as rollback."
---

<!-- GENERATED from convex-agents content/capabilities/migrate-rehearse.json — do not edit by hand. -->

# Rehearse a schema change on a preview before prod

A schema push on Convex validates every existing document against the new schema and FAILS the push if any row doesn't conform — a real data-conformance gate. The safe way to use that gate is to let it fail on a rehearsal copy, not on prod. This capability turns a preview deployment into that copy: seed it with a prod snapshot, push the new schema + run the backfill there, watch the gate, and only promote once it's green. It composes deploy-guard (target classification), migrate (the optional-then-tighten pattern), and @convex-dev/migrations (the batched, resumable backfill).

## Workflow

0. PRECONDITION: preview deployments need a Preview Deploy Key (dashboard → Project Settings → Deploy Keys → Preview) exported as `CONVEX_DEPLOY_KEY` before any `--preview-create`/`--preview-name` deploy — a plain `npx convex login` session cannot create previews, and this is a paid-tier feature. If no preview key is available, fall back to rehearsing on the personal dev deployment seeded with the snapshot, and say so.
1. GUARD: deploy-guard — classify + announce the SOURCE (prod, being read) and the eventual TARGET (prod, being changed); get the fresh explicit yes for the prod promote up front and confirm the plan.
2. SNAPSHOT the source data read-only: `npx convex export --path snapshot.zip` (from the deployment holding the real data; add `--include-file-storage` only if the migration touches files). This is a read; it changes nothing.
3. CREATE the preview FROM THE PRE-CHANGE CODE — do this BEFORE editing schema.ts, so the preview starts on the schema the snapshot data already conforms to: `npx convex deploy --preview-create migrate-<slug>` (needs the preview key; auto-expires ~5 days). Seed it: `npx convex import snapshot.zip --deployment migrate-<slug>` (import targets a deployment by NAME with `--deployment`; there is no `--preview-name` flag on import). The import succeeds because the data still matches the old schema.
4. REHEARSE on the preview, in the migrate order — each push is `npx convex deploy --preview-name migrate-<slug>` (re-deploys to the SAME preview, keeping its data; NOT `convex dev`, which targets personal dev): (a) make the new/changed field OPTIONAL and deploy — if existing rows violate it the push FAILS HERE on the copy with the offending shape; fix and re-push until green. (b) write a @convex-dev/migrations backfill and run it against the preview; verify every row is now valid. (c) tighten the validator (required / narrowed union) and deploy again — the gate now passes because the backfill ran.
5. VERIFY on the preview: run the app's functions against the migrated data (MCP `run`/`runOneoffQuery` pointed at the preview, or a smoke query) to confirm behavior and shape.
6. PROMOTE only on the fresh explicit yes from step 1: apply the SAME sequence to prod (optional schema → backfill → tighten). Because it already succeeded on prod-shaped data, the prod push repeats a proven run. Keep the snapshot as the rollback artifact (`npx convex import snapshot.zip --replace --prod`); state plainly that data written after the snapshot is lost, so keep the promote window short.
7. CLEAN UP: the preview auto-expires; delete the local snapshot when done (it holds real data — treat it as sensitive, never commit it).

## Rules

- Create the preview from the PRE-CHANGE code and seed the snapshot BEFORE editing schema.ts — so the import conforms and the conformance gate then fails on the copy (not prod) when you push the change; each preview push is `deploy --preview-name`, import targets it with `--deployment`.
- Follow the migrate order every time: optional field → push → backfill → verify → tighten → push; skipping 'optional first' makes the very first push reject existing rows.
- The prod promote needs a fresh explicit yes (deploy-guard) and is a REPEAT of the proven preview run, not a new attempt.
- Keep the prod snapshot as the rollback artifact; state plainly that a snapshot-restore loses data written after the snapshot, so keep the promote window short.
- Treat the exported snapshot as sensitive real data: delete it locally when finished; never commit it.
- Backfills go through @convex-dev/migrations (batched, resumable, dry-runnable), not ad-hoc one-shot mutations over a whole table.
- This is the rehearsal-and-promote flow; for the plain 'explain optional-then-tighten' guidance with no live data, that's migrate.
