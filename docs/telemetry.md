---
summary: "Install telemetry collected by the ClawHub CLI and how to opt out."
read_when:
  - Working on telemetry / privacy controls
  - Questions about what data is collected
---

# Telemetry

ClawHub uses minimal CLI telemetry to compute aggregate skill and plugin install counts.

## When telemetry is collected

Telemetry is only sent when:

- You are logged in in the CLI.
- You complete `clawhub install <skill>`, an update that replaces a skills.sh
  catalog skill through `clawhub update`, or an authenticated
  `openclaw plugins install clawhub:<package>` install.
- Telemetry is **not disabled** (see “How to disable” below).

If you are not logged in, nothing is reported.

## What we collect

After a skill or plugin has installed and its local install record has been persisted, the CLI
sends one best-effort install event.

The event includes:

- The installed skill slug or canonical plugin package name.
- `version`: the installed version, when known.
- Skill events may also include the publisher handle, source reference and kind,
  repository, repository-relative source path, source URL, canonical reference,
  scan status, and trust label, when available.

### What we do _not_ collect

- No local filesystem paths or identifiers derived from local folder paths.
  A repository-relative source path identifies the skill within its source repository.
- No file contents.
- No per-run logs, prompts, or other CLI output.

## Install counts

For skills, ClawHub maintains:

- `installsAllTime`: unique users who have reported at least one CLI install for the skill.
- `installsCurrent`: unique users who have reported an install and have not deleted their
  telemetry.

Install events record presence, not a snapshot of your installed skills.
Uninstalling does not send telemetry or decrement counts, and `clawhub sync`
does not reconcile removals. Legacy snapshot reports also only add reported
installs; omitted skills are not removed from the counts.

The server discards skills.sh install events; they do not increment native
ClawHub skill counters.

For plugins, ClawHub counts the first successful install reported by each user and package.
Repeated installs and updates refresh the recorded version without increasing the aggregate
install count.

## Transparency + user controls

Everyone only sees **aggregated install counters**.

Deleting your account also deletes your telemetry data and removes its contribution from install
counters.

## How to disable telemetry

Set the environment variable:

```bash
export CLAWHUB_DISABLE_TELEMETRY=1
```

With this set, the CLI will not send install telemetry.
