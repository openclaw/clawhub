---
summary: "Install telemetry collected by the ClawHub CLI and how to opt out."
read_when:
  - Working on telemetry / privacy controls
  - Questions about what data is collected
---

# Telemetry

ClawHub uses minimal CLI telemetry to compute aggregate install counts.

## When telemetry is collected

Telemetry is only sent when:

- You are logged in in the CLI.
- You run `clawhub install <slug>`.
- Telemetry is **not disabled** (see “How to disable” below).

If you are not logged in, nothing is reported.

## What we collect

On each reported `clawhub install`, the CLI sends one best-effort install event.

The event includes:

- `rootId`: a **SHA-256 hash** of the canonical root path (server never sees the raw path).
- `rootLabel`: a short label derived from the last two path segments (home paths are shown with `~`).
- `slug`: the installed skill slug.
- `version`: the installed version, when known.

### What we do _not_ collect

- No raw absolute folder paths (only hashed `rootId` + a short display label).
- No file contents.
- No per-run logs, prompts, or other CLI output.

## Install counts

ClawHub maintains aggregate counters per skill:

- `installsAllTime`: unique users who have reported at least one CLI install for the skill.
- `installsCurrent`: unique users who have reported an install and have not deleted their
  telemetry.

## Transparency + user controls

ClawHub provides a private “Installed” tab on your own profile:

- Shows install telemetry associated with your account.
- Includes a **JSON export** view.
- Includes a **Delete telemetry** action to remove all stored telemetry for your account.

Everyone else only sees **aggregated install counters**.

Deleting your account also deletes your telemetry data.

## How to disable telemetry

Set the environment variable:

```bash
export CLAWHUB_DISABLE_TELEMETRY=1
```

With this set, the CLI will not send install telemetry.
