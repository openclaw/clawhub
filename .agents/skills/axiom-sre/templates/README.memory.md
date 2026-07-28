# Gilfoyle Memory

This is your working memory for investigations. Append freely, consolidate periodically.

## 2-Tier Memory System

Memory is organized in two tiers, merged when reading:

| Tier | Location | Scope | Sync |
|------|----------|-------|------|
| Personal | `~/.config/axiom-sre/memory/` | Just me | None |
| Org | `~/.config/axiom-sre/memory/orgs/{org}/` | Team-wide | Git repo |

**Read order:** Both tiers merged, tagged by source. Conflicts: Personal > Org.

**Write defaults:**
- "remember this" → Personal
- "save for the team" → Org (+ git commit)

## Directory Structure

```
axiom-sre/memory/
├── README.memory.md     # This file
├── journal/             # Append-only logs during investigations
│   └── journal-YYYY-MM.md
├── kb/                  # Curated knowledge base
│   ├── facts.md
│   ├── integrations.md
│   ├── patterns.md
│   ├── queries.md
│   └── incidents.md
└── archive/             # Old entries
```

---

## Entry Format

Every memory entry has a header and metadata:

```markdown
## M-2025-01-05T14:32:10Z orders-api-500s

- type: pattern
- tags: orders, http-500, ingress
- used: 3
- last_used: 2025-01-12
- pinned: false
- schema_version: 1

**Summary**

Brief description of what this memory captures.

**Details**

Extended information, queries, evidence, etc.
```

### Metadata Fields

| Field | Required | Description |
|-------|----------|-------------|
| type | Yes | fact, query, incident, pattern, integration, note |
| tags | Yes | Comma-separated, for retrieval |
| status | No | active, stale, deprecated (optional lifecycle state) |
| used | No | Count of times retrieved and helpful (default: 0) |
| last_used | No | Date of last helpful retrieval |
| pinned | No | If true, never auto-archive (default: false) |
| schema_version | Yes | Currently: 1 |

---

## During Investigations

### Capture (Low Friction)

**Append to journal only.** Don't organize during incidents.

```markdown
## M-2025-01-05T14:32:10Z noticed-connection-pool-errors

- type: note
- tags: orders, database, connection-pool
- schema_version: 1

Seeing "connection pool exhausted" in orders-api logs.
Started after deploy at 14:15.
```

### Retrieval

Before investigating, read all memory tiers in full. Never use partial reads.

```bash
# Personal tier
cat ~/.config/axiom-sre/memory/kb/*.md

# Org tiers
for org in ~/.config/axiom-sre/memory/orgs/*/kb; do
  cat "$org"/*.md 2>/dev/null
done
```

### End of Incident

Create summary in `kb/incidents.md` with key learnings.

---

## Consolidation (Sleep)

Run periodically or after incidents:

```bash
scripts/sleep
```

This will:
1. **Review** recent entries for promotion to KB
2. **Dump** content for synthesis

### Manual Actions

**Promote:** Move valuable journal entries to appropriate `kb/*.md` file.

**Share:** Org writes are automatically committed and pushed by `mem-write --org`.

---

## Tracking Effectiveness

When a memory entry helps during an investigation:
- Increment `used`
- Update `last_used` to today

When an entry is critical and should never be archived:
- Set `pinned: true`

---

## Commands

| Command | Purpose |
|---------|---------|
| `scripts/init` | Initialize memory + config |
| `scripts/org-add` | Add an org for shared memory |
| `scripts/mem-sync` | Pull org memory updates |
| `scripts/mem-share` | Batch commit and push org changes (rarely needed — `mem-write --org` auto-shares) |
| `scripts/sleep` | Consolidation pass |
| `scripts/mem-doctor` | Health check |

---

## Anti-Patterns to Avoid

- **Partial reading**: NEVER use `head` or `tail` to read memory. You need full context.
- **Query spam**: Don't log every query, only significant ones
- **Over-structuring during incidents**: Just append to journal
- **Forgetting to update used/last_used**: Track what actually helped
- **Keeping stale entries**: Archive aggressively (but pin critical ones)
- **Secrets in org memory**: Never commit credentials or sensitive data
