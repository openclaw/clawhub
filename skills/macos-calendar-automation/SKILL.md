---
name: macos-calendar-automation
description: Automate macOS Calendar via AppleScript or SQLite — create/delete recurring events, exams with alarms, TCC workarounds, iCloud sync pitfalls.
version: 1.1.0
platforms: [macos]
metadata:
  hermes:
    tags: [calendar, macos, applescript, automation, tcc, icloud]
    category: productivity
    related_skills: [apple-calendar-macos, apple-reminders]
---

# macOS Calendar Automation

Automate Calendar.app event creation and deletion when the official
`apple-calendar-macos` skill's tools (icalBuddy, apple-calendar-cli) are
unavailable and `osascript` is the only working path.

## Quick Reference

| Topic | File |
|-------|------|
| SKILL.md (this file) | Full reference |
| Script generator template | `scripts/gen_cal.py` |
| iCloud calendar creator | `scripts/create_icloud_cal.swift` |

## When to Use

- Adding recurring class schedules or exam dates to Calendar
- Batch-creating events that should sync to iPhone via iCloud
- Creating new iCloud calendars programmatically (Swift .app)
- TCC is blocking Python/Swift EventKit but `osascript` works
- Need to clean up duplicate/mistaken events

## When NOT to Use

- Simple single-event creation → use the ICS import approach (`open file.ics`)
- Google Calendar → use `google-workspace` skill (API-based, no TCC issues)
- Read-only queries → use `icalBuddy` if available

## Critical Rules

### 1. Creating iCloud calendars: Swift, NOT AppleScript

AppleScript's `make new calendar` ALWAYS creates on the local store ("En mi Mac").
Changing `store_id` to iCloud via SQLite causes the sync engine to DELETE the
calendar and all events because it lacks proper sync metadata.

**Correct:** Use the bundled Swift script (see [Creating iCloud Calendars](#creating-icloud-calendars)):
```bash
# Compile, sign, run:
mkdir -p /tmp/CalCreator.app/Contents/MacOS
swiftc ~/.hermes/skills/productivity/macos-calendar-automation/scripts/create_icloud_cal.swift \
  -o /tmp/CalCreator.app/Contents/MacOS/CalCreator
codesign --force --sign - /tmp/CalCreator.app
/tmp/CalCreator.app/Contents/MacOS/CalCreator "NombreCalendario"
```

**Wrong:** `make new calendar` in AppleScript, then `UPDATE Calendar SET store_id=3`

### 2. One event per line in AppleScript

Multi-line record literals (`{ ... }` spanning lines) cause syntax errors:

```applescript
-- CORRECT (one line):
make new event at end of events of targetCal with properties {summary:"Title", start date:date "8/9/2026 11:00:00", end date:date "8/9/2026 13:00:00", recurrence:"FREQ=WEEKLY;UNTIL=20261218T225900Z;BYDAY=TU,WE"}

-- WRONG (multi-line):
make new event at end of events of targetCal with properties {
  summary:"Title",
  ...
}
```

### 3. String concatenation: `&` not `and`

`and` is a boolean operator. For string joining:
```applescript
return "OK: " & evCount & " events"  -- CORRECT
return "OK: " and evCount            -- WRONG (boolean error)
```

### 4. Duplicate prevention

Always check before creating:
```applescript
set existing to every event of targetCal whose summary starts with "[PREFIX]"
if (count of existing) > 0 then error "Events already exist"
```

### 5. TCC workaround

If `osascript` times out talking to Calendar:
1. Compile script to `.app`: `osacompile -o Setup.app script.scpt`
2. Run with `open Setup.app`
3. User approves TCC dialog
4. Now `osascript` works directly

## AppleScript Templates

### Recurring weekly class
```applescript
make new event at end of events of targetCal with properties {summary:"ClassName", start date:date "8/9/2026 11:00:00", end date:date "8/9/2026 13:00:00", recurrence:"FREQ=WEEKLY;UNTIL=20261218T225900Z;BYDAY=TU,WE"}
```

### Exam with 1-day alarm
```applescript
set ev to make new event at end of events of targetCal with properties {summary:"EXAMEN: Subject", start date:date "8/1/2027 16:00:00", end date:date "8/1/2027 18:00:00", location:"Aula F-4"}
tell ev to make new display alarm with properties {trigger interval:-1440}
```

### Delete events by prefix
```applescript
repeat with c in calendars
  set evList to every event of c whose summary starts with "[PREFIX]"
  repeat with ev in evList
    delete ev
  end repeat
end repeat
```

### Delete events by content (broader match)
```applescript
repeat with c in calendars
  set evList to every event of c
  repeat with ev in evList
    if (summary of ev) contains "Keyword" then delete ev
  end repeat
end repeat
```

## Creating iCloud Calendars (Swift)

The ONLY reliable way to create an iCloud calendar programmatically. Must be
compiled as a `.app` bundle so macOS presents the TCC dialog properly.

### One-liner usage

```bash
# Compile + sign + create (idempotent: "YA_EXISTE" if already there)
mkdir -p /tmp/CalCreator.app/Contents/MacOS && \
swiftc ~/.hermes/skills/productivity/macos-calendar-automation/scripts/create_icloud_cal.swift \
  -o /tmp/CalCreator.app/Contents/MacOS/CalCreator && \
codesign --force --sign - /tmp/CalCreator.app && \
/tmp/CalCreator.app/Contents/MacOS/CalCreator "NombreDelCalendario"
```

### What it does

1. Requests full access to events → TCC dialog (once per .app)
2. Finds the iCloud source via `sourceType == .calDAV && title contains "iCloud"`
3. Checks if a calendar with that name already exists (idempotent)
4. Creates the calendar under the iCloud source
5. Returns `CREADO: Nombre en iCloud` or `YA_EXISTE: Nombre`

### Verify it's on iCloud

```bash
sqlite3 ~/Library/Group\ Containers/group.com.apple.calendar/Calendar.sqlitedb \
  "SELECT c.title, s.name FROM Calendar c JOIN Store s ON c.store_id = s.ROWID WHERE c.title = 'NombreDelCalendario';"
# Should output: NombreDelCalendario|iCloud
```

### Delete (syncs to all devices)

```bash
osascript -e 'tell application "Calendar" to delete calendar "NombreDelCalendario"'
```

## SQLite Emergency Deletion

When events can't be deleted via AppleScript (e.g., in Google calendars
or after calendar corruption), use SQLite directly. Custom triggers call
functions only available in CalendarAgent — drop them first:

```sql
-- Calendar database
-- ~/Library/Group Containers/group.com.apple.calendar/Calendar.sqlitedb

-- Kill Calendar first
-- killall Calendar

-- Drop triggers that call unavailable custom functions
DROP TRIGGER IF EXISTS delete_event_alarms_recurs;
DROP TRIGGER IF EXISTS clean_attachments_store_deleted;
DROP TRIGGER IF EXISTS delete_calendar_members;

-- Delete from dependent tables first
DELETE FROM Alarm WHERE calendaritem_owner_id IN (SELECT ROWID FROM CalendarItem WHERE summary LIKE '[PREFIX]%');
DELETE FROM Recurrence WHERE owner_id IN (SELECT ROWID FROM CalendarItem WHERE summary LIKE '[PREFIX]%');
DELETE FROM Location WHERE item_owner_id IN (SELECT ROWID FROM CalendarItem WHERE summary LIKE '[PREFIX]%');

-- Then delete events
DELETE FROM CalendarItem WHERE summary LIKE '[PREFIX]%';

-- Calendar recreates triggers on next launch
```

## Python Script Generation

Best practice: use Python to generate single-line AppleScript:

```python
# Class template:
f'make new event at end of events of targetCal with properties {{summary:"{title}", start date:date "{start}", end date:date "{end}", recurrence:"FREQ=WEEKLY;UNTIL={until};BYDAY={byday}"}}'

# Exam template:
f'set ev to make new event at end of events of targetCal with properties {{summary:"{title}", start date:date "{start}", end date:date "{end}", location:"{loc}"}}'
'tell ev to make new display alarm with properties {trigger interval:-1440}'
```

## Store ID Reference

From `Calendar.sqlitedb` Store table:
```
1 = Default (local "En mi Mac")
3 = iCloud
4 = Google
```
Verify with: `SELECT ROWID, name FROM Store;`

## Date Formats

- AppleScript dates: `"D/M/YYYY HH:MM:SS"` (Spanish locale)
- UNTIL in recurrence: `YYYYMMDDTHHMMSSZ` (UTC)
- SQLite dates: seconds since 2001-01-01 00:00:00 UTC (macOS epoch)
  - Convert: `datetime(ref_seconds + 978307200, 'unixepoch')`

## Common Pitfalls

1. **Created calendar on wrong store**: AppleScript creates locally. Use the Swift `.app` approach (see [Creating iCloud Calendars](#creating-icloud-calendars-swift)) to create directly on iCloud. Never `UPDATE Calendar SET store_id=3`.
2. **iCloud deletes SQLite-moved calendars**: Never `UPDATE Calendar SET store_id=3`.
3. **Multi-line properties**: Always one-liners in AppleScript.
4. **`and` vs `&`**: `and` is boolean, `&` is concatenation.
5. **Google calendars invisible to AppleScript**: `every event of c` may not iterate Google calendar events. Use SQLite deletion instead.
6. **Recurring event count**: `count of events` returns expanded instances, not master events (e.g., a weekly event shows as ~14 instances per semester).
7. **Triggers block SQLite DELETE**: CalendarItem has triggers calling `CalNoteAttachmentDeleted` — drop them first.
8. **Running script twice = duplicates**: Always check or delete before recreating.
9. **Modifying event times forward requires `end date` first**: When moving an event later, set `end date` BEFORE `start date`. Setting `start date` first triggers Calendar's "start must be before end" validation against the still-old end date. Safe pattern: `set end date of ev to newEnd` → `set start date of ev to newStart`. Moving backward doesn't have this issue, but end-first is always safe.
10. **Modifying summary + dates**: Change the summary first (standalone), then dates (end first, then start). Mixing summary and date changes in the same operation can cause save errors.
