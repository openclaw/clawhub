---
name: session-state-schema
description: |
  Versioned schema definition for session state files.
  Enables backward compatibility as the format evolves.
category: conservation
---

# Session State Schema

## Current Version: 1

All session state files MUST include a `state_version` field on the first content line after the heading. This enables continuation agents to detect the format and apply migration logic when needed.

## Version 1 Schema

### Required Header

```markdown
# Session State Checkpoint
state_version: 1
Generated: YYYY-MM-DD HH:MM:SS
Reason: [Context threshold | Manual checkpoint | Task boundary]
```

### Required Sections

| Section | Purpose |
|---------|---------|
| `## Execution Mode` | Mode, auto-continue flag, source command |
| `## Current Task` | What we are trying to accomplish |
| `## Progress Summary` | What has been done so far |
| `## Continuation Instructions` | Next steps for the continuation agent |

### Optional Sections

| Section | Purpose |
|---------|---------|
| `## Key Decisions` | Decisions and rationale |
| `## Active Files` | Files being modified or referenced |
| `## Pending TodoWrite Items` | Outstanding todo items |
| `## Existing Task IDs` | Task IDs for deduplication |
| `## Metadata` | JSON block with handoff count, priority, etc. |

## Version 0 (Unversioned Legacy)

Any session state file that lacks the `state_version` field is v0. These files were written before versioning was introduced.

### Identifying v0 Files

A v0 file typically starts with:

```markdown
# Session State Checkpoint
Generated: YYYY-MM-DD HH:MM:SS
```

No `state_version` line is present.

### V0 Field Mapping

V0 files use the same section names as v1. The only difference is the missing version header. All sections are compatible.

## Migration: V0 to V1

When a continuation agent encounters a v0 file, apply this migration:

1. **Treat it as v1.** The content is structurally identical.
2. **Do not rewrite the file** just to add the version header. Only add `state_version: 1` if you are already updating the file for other reasons (e.g., progress checkpoint).
3. **Log the migration.** Note in your handoff summary: "Migrated session state from v0 (unversioned) to v1."

No field renaming or restructuring is needed. V0 and v1 are content-compatible.

## Version Check Logic

Continuation agents MUST follow this sequence when reading a session state file:

```
1. Read the file
2. Look for "state_version: N" in the first 5 lines
3. If found:
   a. version == 1  -> proceed normally
   b. version > 1   -> warn "Unknown state version N, attempting to read"
                        then proceed (best-effort forward compatibility)
4. If not found:
   -> treat as v0, proceed normally (v0 is compatible with v1)
```

### Forward Compatibility

Future versions should maintain backward-compatible section names where possible. If a breaking change is needed, the version number increments and this document gets a new migration section.

A continuation agent encountering an unknown future version should:
- Log a warning: "Session state version N is newer than expected (v1). Reading with best effort."
- Attempt to read all recognized sections
- Skip unrecognized sections without error
- Continue the work rather than failing

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 0 | Pre-1.5.2 | Original unversioned format |
| 1 | 1.5.2 | Added `state_version` header field |
