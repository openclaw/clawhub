# Search Patterns Module

Patterns for searching and retrieving knowledge from the review chamber.

## Search Modalities

The review chamber supports multiple search approaches, building on knowledge-locator patterns.

### 1. Semantic Search

Find entries by meaning, not just keywords.

```bash
# Find decisions about authentication
/review-room search "how do we handle user authentication" --type semantic

# Returns entries about JWT, sessions, OAuth even if those exact words not used
```

**Implementation**:
```python
def semantic_search(query, entries):
    """Search by meaning using embeddings or keyword expansion."""

    # Expand query with related terms
    expanded = expand_query(query)
    # "authentication" → ["auth", "login", "session", "jwt", "oauth"]

    results = []
    for entry in entries:
        score = compute_semantic_similarity(expanded, entry.content)
        if score > 0.3:  # Threshold
            results.append((entry, score))

    return sorted(results, key=lambda x: x[1], reverse=True)
```

### 2. Spatial Search

Navigate by room and location in the palace.

```bash
# Browse decisions room
/review-room list --room decisions

# Find entries in patterns room with specific tags
/review-room list --room patterns --tags api,error-handling
```

**Room Navigation**:
```
review-chamber/
├── decisions/     → Architectural choices
│   └── jwt-auth.md
│   └── api-versioning.md
├── patterns/      → Recurring solutions
│   └── retry-logic.md
│   └── error-responses.md
├── standards/     → Quality examples
│   └── code-review-checklist.md
└── lessons/       → Learnings
    └── outage-2025-01.md
```

### 3. Temporal Search

Find entries by time or PR timeline.

```bash
# Recent entries
/review-room search --since "2025-01-01"

# Entries from specific PR range
/review-room search --pr-range 40-50

# Most accessed entries
/review-room search --sort-by access_count
```

### 4. Associative Search

Follow connections between entries.

```bash
# Find entries related to specific entry
/review-room related <entry_id>

# Explore connection graph
/review-room graph --start jwt-auth --depth 2
```

**Connection Types**:
- `related_rooms` - Links to other palace rooms
- `connected_concepts` - Bidirectional concept links
- `source_pr` - Link back to GitHub PR
- `tags` - Shared tag connections

### 5. Contextual Search

Surface relevant entries based on current work context.

```bash
# When in auth/ directory
/review-room context auth/

# Returns:
# - Past decisions about authentication
# - Known patterns in this code area
# - Relevant standards to follow
```

## Search Filters

### By Room Type

```bash
/review-room search "query" --room decisions
/review-room search "query" --room patterns
/review-room search "query" --room standards
/review-room search "query" --room lessons
```

### By Tags

```bash
# Single tag
/review-room search "query" --tags security

# Multiple tags (AND)
/review-room search "query" --tags security,api

# Multiple tags (OR)
/review-room search "query" --tags-any security,performance
```

### By Participants

```bash
# Entries from reviews by specific person
/review-room search "query" --participant @username

# Entries where specific reviewer participated
/review-room search "query" --reviewer @techleader
```

### By Source PR

```bash
# From specific PR
/review-room search --pr 42

# From PR range
/review-room search --pr-range 40-50
```

### By Time

```bash
# Since date
/review-room search "query" --since 2025-01-01

# Before date
/review-room search "query" --before 2025-06-01

# Date range
/review-room search "query" --since 2025-01-01 --before 2025-06-01
```

## Proactive Surfacing

Automatically surface relevant knowledge at key moments.

### On PR Creation

When creating a PR in a code area with relevant history:

```markdown
## 📚 Relevant Review Knowledge

Your PR touches files in `auth/`. Here's relevant knowledge:

### Past Decisions
| PR | Decision | Room |
|----|----------|------|
| #42 | JWT over sessions | decisions/jwt-auth |
| #67 | Token refresh pattern | patterns/token-refresh |

### Quality Standards
- API error format: See standards/api-errors
- Auth test coverage: See standards/auth-testing

### Known Patterns
- Token refresh race condition: patterns/token-refresh-race
```

### On Code Review

When reviewing code in area with history:

```markdown
## 💡 Review Context

This PR modifies authentication code. Consider:

### Prior Decisions
- JWT tokens chosen for stateless scaling (#42)
- Refresh tokens must be rotated (#67)

### Common Issues
- Token validation bypass (seen in #38)
- Missing rate limiting (pattern #12)
```

### On Bug Investigation

When investigating bugs in documented areas:

```markdown
## 🔍 Related Knowledge

Debugging issue in auth flow. Review chamber has:

### Lessons Learned
- Outage from token expiry misconfiguration (lessons/auth-outage-2025)
- Race condition in refresh (patterns/token-refresh-race)

### Related Decisions
- Why we use JWT: decisions/jwt-auth
```

## Search Result Format

### Summary View (Default)

```markdown
## Search Results: "authentication"

Found 5 entries in review-chamber:

| Room | Title | PR | Date |
|------|-------|-----|------|
| decisions | JWT over sessions | #42 | 2025-01-15 |
| patterns | Token refresh pattern | #67 | 2025-02-20 |
| patterns | Rate limiting | #55 | 2025-01-28 |
| standards | Auth testing | #48 | 2025-01-20 |
| lessons | Token expiry outage | #89 | 2025-03-01 |
```

### Detail View

```markdown
## Entry: decisions/jwt-auth

**Source PR:** #42 - Add user authentication
**Date:** 2025-01-15
**Participants:** @alice, @bob, @securityteam
**Tags:** authentication, jwt, security, architecture

### Decision
Chose JWT tokens over server-side sessions for stateless scaling.

### Context
- Reviewer asked about session persistence
- Author explained horizontal scaling requirements
- Security team approved with refresh token requirement

### Captured Knowledge
- **Pattern:** JWT + refresh tokens for stateless auth
- **Tradeoff:** Complexity vs. horizontal scaling
- **Application:** All API authentication

### Connected
- [[auth-patterns]] - Workshop patterns
- [[security-adr-003]] - Library ADR
- patterns/token-refresh - Related pattern
```

## CLI Integration

### palace_manager.py Extension

```bash
# Search review chamber
python scripts/palace_manager.py search "authentication" \
  --palace <project_id> \
  --room review-chamber \
  --subroom decisions \
  --type semantic

# List with filters
python scripts/palace_manager.py list-reviews \
  --palace <project_id> \
  --room patterns \
  --tags api \
  --since 2025-01-01

# Export for documentation
python scripts/palace_manager.py export-reviews \
  --palace <project_id> \
  --format markdown \
  --output docs/review-decisions.md
```

## Performance Considerations

### Indexing

```python
# Maintain search indexes
- Tag index: tag → [entry_ids]
- Room index: room → [entry_ids]
- Temporal index: date → [entry_ids]
- Participant index: user → [entry_ids]
- Embedding index: entry_id → vector (optional)
```

### Caching

```python
# Cache frequently accessed entries
- LRU cache for recent searches
- Pre-compute hot entry summaries
- Background index updates
```

### Limits

```python
# Search result limits
MAX_RESULTS = 50  # Per search
MAX_DEPTH = 3     # For graph traversal
TIMEOUT = 5000    # ms for search operations
```
