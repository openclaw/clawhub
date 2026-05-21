---
name: clawhub-ui-proof
description: Use when ClawHub UI changes need visual proof, before/after comparison, new-feature screenshots, temporary Playwright scenarios, or Crabbox desktop recordings.
---

# ClawHub UI Proof

Use `proof:ui` for human-readable UI evidence. The agent should write a
temporary scenario for the feature instead of manually clicking through the UI.

## Pick A Mode

- Use `--mode before-after` for bug fixes, regressions, changed copy, changed
  layout, or anything where main-vs-candidate comparison helps. This is the
  default and runs baseline `origin/main` plus the candidate worktree.
- Use `--mode feature` for new pages, new workflows, or new UI states that do
  not exist on main. This runs only the candidate lane.
- Do not use `proof:ui` to inspect contributor-provided screenshots, videos, or
  logs. Review those artifacts directly and cite what they prove or fail to
  prove.

## Scenario Shape

Create a temporary scenario under `.artifacts/proof-scenarios/`:

```js
export default async function scenario({ baseURL, expect, page, proof }) {
  await proof.step("01 skills list", async () => {
    await page.goto(`${baseURL}/skills`);
    await expect(page.getByText("Skills")).toBeVisible();
  });
}
```

Each `proof.step()` captures a screenshot after the step. The runner compares
`origin/main` to the current worktree by default in `before-after` mode.

## Commands

Dry-run the plan first. Before/after mode is the default:

```sh
bun run proof:ui -- --mode before-after --scenario .artifacts/proof-scenarios/my-fix.pw.ts --dry-run
```

For new feature proof, run candidate-only:

```sh
bun run proof:ui -- --mode feature --scenario .artifacts/proof-scenarios/my-feature.pw.ts --dry-run
```

Run real desktop proof on a Crabbox-owned provider:

```sh
bun run proof:ui -- --mode before-after --scenario .artifacts/proof-scenarios/my-fix.pw.ts --provider hetzner
```

Artifacts are written under `.artifacts/clawhub-ui-proof/<timestamp>/` with
screenshots, videos when available, `summary.json`, and `report.md`. Feature
mode has only candidate artifacts. Promote only broadly useful scenarios into
committed `e2e/proofs/`.

## Publish To A PR

When UI proof should appear on a GitHub PR, publish the completed proof run
instead of posting local paths:

```sh
bun run proof:publish -- --proof-dir .artifacts/clawhub-ui-proof/<timestamp> --target-pr <number>
```

`proof:publish` copies the selected screenshots, video preview GIFs when
present, MP4s, `summary.json`, and `report.md` to the `qa-artifacts` branch,
then upserts a marker-backed PR comment with inline screenshots/previews and
linked MP4s. Use `--dry-run` first when drafting or checking the comment body.
