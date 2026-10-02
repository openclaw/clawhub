---
summary: "Google Analytics choices and install telemetry collected by the ClawHub CLI."
read_when:
  - Working on telemetry / privacy controls
  - Questions about what data is collected
---

# Telemetry

ClawHub keeps website Google Analytics choices separate from CLI install telemetry.

## Website Google Analytics

Google Analytics stays off unless a still-valid allow choice was previously saved on
this site. Saved denials and GPC/DNT browser privacy signals are honored. A missing,
expired, invalid, or unreadable choice leaves analytics off, regardless of region.
Existing choices keep their original expiry, up to 180 days.

When allowed, Google Analytics measures page visits, public content and link metadata,
selected interactions, filtered public searches, and performance. It does not send
visitor account identity, private messages, other typed form contents, copied text,
or raw error messages. It is not used for advertising. Existing Vercel analytics and
basic server traffic counts continue separately.

Events already collected while allowed may finish sending; sent information is not
recalled. Saved denials apply to other open tabs on the same site without reloading
the page or discarding unsaved work.

The shared property is configured for 14-month event-level exploration retention and
14-month user-associated retention, with the latter timer reset by new activity.
Most standard aggregate reports follow separate retention rules. Google applies a
retention-setting change after its stated 24-hour window; it does not restore deleted
data. Retention settings do not change the 180-day site-choice lifetime.

A search submission, file-download click, copy success, or pending publish submission
is not a completed installation or public release. These outcomes are distinguished
in the site's measurement rather than inferred from clicks.

## CLI install telemetry

ClawHub uses minimal CLI telemetry to compute aggregate skill and plugin install counts.

### When telemetry is collected

Telemetry is only sent when:

- You are logged in in the CLI.
- You complete `clawhub install <skill>`, an update that replaces a skills.sh
  catalog skill through `clawhub update`, or an authenticated
  `openclaw plugins install clawhub:<package>` install.
- Telemetry is **not disabled** (see “How to disable” below).

If you are not logged in, nothing is reported.

### What we collect

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

### Install counts

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

### Transparency + user controls

Everyone only sees **aggregated install counters**.

Deleting your account also deletes your telemetry data and removes its contribution from install
counters.

### How to disable telemetry

Set the environment variable:

```bash
export CLAWHUB_DISABLE_TELEMETRY=1
```

With this set, the CLI will not send install telemetry.
