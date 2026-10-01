# Memory System

Three-tier memory with automatic merging. All tiers use identical structure.

## Tiers

| Tier | Location | Scope | Sync |
|------|----------|-------|------|
| Personal | `~/.config/axiom-sre/memory/` | Just me | None |
| Org | `~/.config/axiom-sre/memory/orgs/{org}/` | Team-wide | Git repo |

## Reading Memory

Before investigating, read all memory tiers. **ALWAYS read full files.** NEVER use `head -n N` or other partial read operators; a partial knowledge base is worse than none.

```bash
# Personal tier
cat ~/.config/axiom-sre/memory/kb/*.md

# All org tiers (read each org that exists)
for org in ~/.config/axiom-sre/memory/orgs/*/kb; do
  cat "$org"/*.md 2>/dev/null
done
```

When displaying entries, tag by source tier so user knows origin:
```
[org:axiom] Connection pool pattern: check for leaked connections...
[personal] I prefer 5m time bins for latency analysis
```

If same entry exists in multiple tiers: Personal overrides Org.

## Writing Memory

Use `scripts/mem-write` to save entries:

```bash
# Personal tier (default)
scripts/mem-write facts "dataset-location" "Primary logs in k8s-logs-dev dataset"

# With type and tags
scripts/mem-write --type pattern --tags "db,timeout" patterns "conn-pool" "Connection pool exhaustion signature"

# Org tier
scripts/mem-write --org axiom patterns "timeout-pattern" "How to detect timeouts"
```

| Trigger | Target | Example |
|---------|--------|---------|
| "remember this" | Personal | "Remember I prefer to DM @alice" |
| "save for the team" | Org | "Save this pattern for the team" |
| Auto-learning | Personal | Query worked → saved automatically |

Org writes are automatically committed and pushed — no extra step needed.

## First-Time Setup

```bash
scripts/init    # Personal tier + orgs config
```

## Org Setup

```bash
# Add an org (one-time)
scripts/org-add axiom git@github.com:axiomhq/sre-memory.git

# Sync org memory (pull latest)
scripts/mem-sync

# Check for uncommitted org changes
scripts/mem-doctor
```

## Directory Structure

```
~/.config/axiom-sre/memory/
    ├── kb/
    │   ├── facts.md
    │   ├── patterns.md
    │   └── queries.md
    ├── journal/
    └── orgs/
        └── axiom/            # Org tier (git-tracked)
            └── kb/
```

## Entry Format

```markdown
## M-2025-01-05T14:32:10Z connection-pool-exhaustion

- type: pattern
- tags: database, postgres
- used: 5
- last_used: 2025-01-12
- pinned: false
- schema_version: 1

**Summary**
Connection pool exhausted due to leaked connections.
```

## Learning

**You are always learning.** Every debugging session is an opportunity to get smarter.

**Automatic learning (no user prompt needed):**
- Query found root cause → record to `kb/queries.md`
- New failure pattern discovered → record to `kb/patterns.md`
- User corrects you → record what didn't work AND what did
- Debugging session succeeds → summarize learnings to `kb/incidents.md`

**User-triggered recording:**
- "Remember this", "save this" → record immediately to Personal
- "Save for the team" → record to Org + prompt to push

**Be proactive:** If something is worth remembering, record it.

## During Investigations

**Capture:** Append observations to `journal/journal-YYYY-MM.md`:

```markdown
## M-2025-01-05T14:32:10Z found-connection-leak

- type: note
- tags: orders, database
- schema_version: 1

Connection pool exhausted. Found leak in payment handler.
```

**End of session:** Create summary in `kb/incidents.md` with key learnings.

## Consolidation (Sleep)

Run after incidents or periodically:
```bash
scripts/sleep                           # default full preset: clean + share + prompt
scripts/sleep --org axiom               # same full preset, scoped to one org
scripts/sleep --org axiom --dry-run     # analyze + prompt only
```

Deep sleep phases:
- `N1 review` recent entries in the selected window.
- `N2 analysis` entry counts, duplicate keys, and type drift.
- `N3 apply` deterministic cleanup (keep newest duplicate, drop `Supersedes` targets, normalize `type` in incidents/patterns/queries).
- `REM share` commit/push org repo changes.

Safety defaults:
- no mode flags => full preset.
- `--dry-run` never modifies files and never pushes.

## Health Check

```bash
scripts/mem-doctor    # Check all tiers, report issues
```

See `README.memory.md` in any memory directory for full entry format and maintenance instructions.
