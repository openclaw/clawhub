---
name: proof-video
description: Capture, edit, inspect, and attach real ClawHub browser proof directly to a GitHub PR, with captions, focused zooms, and clearly separated before/after results.
---

# Proof video

Adapted from OpenClaw's [proof-video skill](https://github.com/openclaw/openclaw/blob/main/.agents/skills/proof-video/SKILL.md) and [PR evidence instructions](https://github.com/openclaw/openclaw/blob/main/AGENTS.md). This adaptation uses ClawHub's existing real-browser proof runner; OpenClaw's mocked Gateway template and repo-specific helper imports do not apply here.

## Establish the claim

Before recording, name the behavior, exact source refs, local URL, fixture and expected visible result. Keep the same viewport, theme, account, data and interaction sequence for before/after comparisons. Feature proof can omit an impossible baseline, with the reason stated.

Use a real ClawHub instance with the relevant local Convex code and fixture state. Use a real isolated browser on the current host; use Crabbox only when its environment is needed and available. Do not use HTML mockups, synthetic screenshots, intercepted success responses or hand-written product UI as proof. Seed through the supported local fixture workflow. Never use the operator's personal Gateway for cross-system proof.

For a ClawHub → OpenClaw flow, record the actual admin action, security pending state, catalog lookup, installation and meaningful live tool result. State separately which scan/provider checks are real, simulated or untested. A queued job is not a completed scan, and discovery is not account-level authorization.

## Capture

Keep captures, scripts, cue times and private browser state in separate ignored local directories. Select individual inspected media files for upload; never upload the entire artifact directory or browser state.

Use the existing runner with a task-specific scenario:

```sh
bun run proof:ui -- --runner local --mode feature \
  --scenario .artifacts/proof-scenarios/example.pw.ts \
  --candidate-url http://127.0.0.1:3000
```

Use `--mode before-after`, `--baseline-url` and `--candidate-url` for paired proof. See `scripts/ui-proof-runtime.mjs` for the scenario contract and `specs/ui-proof.md` for runtime isolation. For a multi-app flow that needs a dedicated driver, use the existing Playwright dependency and `recordVideo` against the real services.

Wait on asserted UI state, response or live runtime event, not arbitrary sleeps. Include loading, empty, typical, dense, error and permission states when relevant; explain omitted states. Capture desktop and mobile for responsive changes. Screenshot capture must not disturb an active recording; use a separate context when necessary.

For sharp zooms, verify the raw video resolution and actual content scale. OpenClaw observed Chromium padding with emulated `deviceScaleFactor: 2`; native `--force-device-scale-factor=2` with context emulation at 1 avoided it. Verify this on the installed browser before relying on it; do not blindly double dimensions. A normal-scale recording is preferable to a padded or clipped one.

## Edit: context → action/wait → result

Preserve the raw recording. Render to a new file using the system `ffmpeg`/`ffprobe` and keep a small cue sheet with timestamps on the raw timeline.

- Burn concise captions into the MP4. GitHub's player does not display separate subtitle tracks. Say what the viewer sees and what it proves; keep captions to one or two lines.
- Establish the page and initiating action at normal speed. Accelerate only idle waiting, visibly labeled with its multiplier. Return to 1× before meaningful transitions and the result. Keep latency measurements at real speed.
- Use a smooth, focused 1.5–2× zoom when a small control/result matters. Keep its label and surrounding context in frame. Measure the actual target; do not invent a highlight that hides the underlying UI.
- Hold the decisive result for several seconds. Captions must not cover it.
- Keep the failed baseline explicitly labeled **BEFORE — expected failure** and the passing candidate **AFTER — successful result**. Lead the PR with the successful candidate and disclose any required companion fix beside it. Never put a failure clip beneath an undifferentiated “passed” heading.
- Caption PNG overlays rendered with the existing browser or image tooling work when `ffmpeg` lacks `drawtext`/`libass`. Use text-safe DOM assignment when rendering captions. Do not redraw product pixels.
- Remap caption/zoom times after speed changes. Normalize variable-frame-rate native captures to a separate constant-frame-rate copy. Zoom rendering must preserve intended frame count and duration; dynamic crop-size expressions alone do not animate reliably.

For a browser WebM that needs only compatible encoding:

```sh
ffmpeg -n -i recording.webm -c:v libx264 -pix_fmt yuv420p \
  -movflags +faststart proof.mp4
```

This is transcoding, not captioning or verification. Keep authored editing scripts local unless a separate tooling change is requested.

## Inspect before publishing

Open every final screenshot and inspect every video across its full timeline. Check full-size frames at the initiating action, caption changes, zoom holds, speed boundaries and final result. Confirm the actual state, readable text, framing, timing, privacy and source identity. A contact sheet helps inspect the timeline but does not replace full-size decisive frames. Re-capture or re-edit anything misleading, blank, clipped or stale.

Record exact before/after refs, commands, real runtime configuration, assertions and limitations in the PR. Do not claim a capture passed merely because its file exists. Keep failing baseline evidence separate from the successful acceptance result.

## Attach directly to the PR

Use GitHub's native attachments. **Never commit screenshots, videos, generated proof reports, or `.artifacts/` output to any product repository branch**, including `qa-artifacts`. The old `proof:publish` branch-upload helper is retired.

Check `gh pr comment --help` for `--attach`. Write the exact comment to an ignored Markdown file and use:

```sh
gh pr comment 123 --repo openclaw/clawhub \
  --body-file .artifacts/proof/comment.md \
  --attach .artifacts/proof/after.mp4 \
  --attach '.artifacts/proof/before.png#Before' \
  --attach '.artifacts/proof/after.png#After'
```

An image reference already in the body is rewritten to its uploaded URL; otherwise attachments are appended. For video, use `.mp4`, `.mov` or `.webm`, never a `#alt` suffix. Put the returned video URL on its own bare line so GitHub renders a player, not inside image Markdown. The CLI accepts videos up to 100 MB; GitHub's account limit may be lower. Assets cannot be deleted after upload, so inspect/sanitize first.

Prefer updating the existing proof comment after reading it. `--edit-last` is safe only after verifying the last comment by the authenticated author is the intended target. Otherwise upload a new proof comment and update the specific old comment to point to it. Reuse existing uploaded asset URLs rather than uploading duplicates.

If `gh` lacks `--attach`, update the official CLI or use GitHub's user-attachments upload API as documented by OpenClaw. Resolve credentials through the approved process, keep tokens out of logs/argv, and verify the returned asset URL. Do not fall back to a Git branch or release asset. If direct attachment is blocked, retain the local media and report the precise failed operation; do not claim publication.

Put a concise validation report in the PR comment itself. Preserve raw logs/cue files locally; share non-media diagnostics only through an explicitly authorized artifact destination. Verify the posted comment contains the intended image/video URLs and, when browser control is available, inspect its rendered players. Return the direct proof-comment link.
