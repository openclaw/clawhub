# GitHub Issue Integration

When deferring features due to scope-guard (Worthiness < 1.0
or branch budget exceeded), create a GitHub issue to preserve
context. This step matters because deferred ideas lose context
quickly without a persistent record.

## Why This Is Required

1. **Context Preservation** - Deferred items lose context over time
2. **Accountability** - Issues create audit trail of decisions
3. **Discoverability** - Future work can find and prioritize deferred items
4. **No Lost Work** - Every idea is captured, nothing falls through cracks

## Deferral Process

### Step 1: Create Deferred Item

When deferring an item, run this command:

```bash
python3 scripts/deferred_capture.py \
  --title "<feature name>" \
  --source scope-guard \
  --context "Worthiness: <score>. <breakdown>. <reason>" \
  --labels "deferred,scope-guard,<priority>"
```

The `<breakdown>` field should summarise the scoring factors
inline (e.g. "Business Value: 2, Complexity: 4, Scope Drift: 3").
The `<priority>` label should be `priority/low`,
`priority/medium`, or omitted based on the worthiness score.

**Migration note:** repositories that previously used the
`scope-guard-deferred` label can migrate existing issues
with:

```bash
gh label create deferred --color "#e4e669" --description \
  "Deferred work items" || true
gh issue list --label scope-guard-deferred --json number \
  --jq '.[].number' \
  | xargs -I{} gh issue edit {} --add-label deferred \
      --add-label scope-guard
```

### Step 2: Record Issue Number

After creating the issue, note the issue number (e.g., #123) for cross-referencing.

### Step 3: Update queue.md (Optional - Issue is primary record)

If maintaining `docs/backlog/queue.md`, add with issue reference:

```markdown
| Rank | Item | Worthiness | Added | Branch | Category | Issue |
|------|------|------------|-------|--------|----------|-------|
| X | Feature name | 0.85 | 2026-01-03 | branch-name | idea | #123 |
```

## Non-GitHub Repositories

If `gh` CLI is unavailable or repository is not on GitHub:

1. **Check availability:**
   ```bash
   command -v gh && gh auth status
   ```

2. **If unavailable, document in queue.md with prominent notice:**
   ```markdown
   ## DEFERRED ITEMS (No GitHub - Manual Tracking Required)

   | Item | Worthiness | Added | Context |
   |------|------------|-------|---------|
   | Feature X | 0.85 | 2026-01-03 | Full context here since no issue... |
   ```

3. **Create issue when GitHub becomes available** - This is technical debt.

## TodoWrite Integration

The deferral workflow requires this todo item:

- `scope-guard:github-issue-created` - Mark complete ONLY after issue URL is confirmed

This todo blocks marking `scope-guard:decision-documented`
as complete.

## Labels

Use consistent labels for filtering:

| Label | Purpose |
|-------|---------|
| `deferred` | All deferred work items (required) |
| `scope-guard` | All scope-guard deferrals (required) |
| `priority/low` | Low worthiness score (< 0.8) |
| `priority/medium` | Medium worthiness (0.8 - 1.0) |
| `enhancement` | New features |
| `refactor` | Code improvements |
| `architecture` | Structural changes |

### Step 4: Create Linked Discussion (Default: Publish)

After the GitHub issue is created (Step 1), publish a
companion Discussion with full reasoning context:

```
Creating a Discussion with full reasoning context. [Y/n]
```

Publishing is the default action. If the user explicitly
declines ("n"), skip to Step 5 (Validation).

Proceed with Discussion creation:

**4a. Resolve category ID:**
```bash
# Get repository ID and "deliberations" category ID
gh api graphql -f query='
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
    discussionCategories(first: 25) {
      nodes { id slug }
    }
  }
}' -f owner="OWNER" -f repo="REPO"
```

Find the category nodeID where `slug` equals `"deliberations"`. If not found, warn and skip Discussion creation.

**4b. Create the Discussion:**
```bash
gh api graphql -f query='
mutation($repoId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
  createDiscussion(input: {
    repositoryId: $repoId,
    categoryId: $categoryId,
    title: $title,
    body: $body
  }) {
    discussion { number id url }
  }
}' -f repoId="$REPO_ID" -f categoryId="$CATEGORY_ID" \
   -f title="[Scope Guard] <feature name>" \
   -f body="$BODY"
```

**Discussion body structure:**
```markdown
## Deferred Feature: <feature name>

**Worthiness Score:** X.XX (threshold: 1.0)
**Branch:** <current-branch-name>
**Date:** <YYYY-MM-DD>
**Linked Issue:** #<issue-number>

### Scoring Breakdown

| Factor | Score | Rationale |
|--------|-------|-----------|
| Business Value | X | <reason> |
| Time Criticality | X | <reason> |
| Risk Reduction | X | <reason> |
| Complexity | X | <reason> |
| Token Cost | X | <reason> |
| Scope Drift | X | <reason> |

**Formula:** (X + X + X) / (X + X + X) = X.XX

### Alternatives Considered

<Full alternatives analysis that doesn't fit in an issue body>

### Context

<Extended reasoning, trade-offs, and background>

### When to Revisit

- When branch budget frees up
- When related work is scheduled
- During next planning cycle
```

**4c. Apply labels:**
- `scope-guard` — always
- `deferred` — always
- Branch name label (if exists)

**4d. Update the issue with Discussion link:**
```bash
gh issue comment <issue-number> --body "Full reasoning context: <discussion_url>"
```

**4e. Error handling:**
- If Discussion creation fails, warn but do NOT block the deferral workflow
- The issue (Step 1) is the primary record; the Discussion is supplementary

## Validation

After creating the issue, verify:

```bash
# Confirm issue exists
gh issue view <issue-number>

# List all deferred items
gh issue list --label deferred --label scope-guard
```

## Failure Handling

If issue creation fails:

1. **Retry once** with simplified body
2. **If still fails**, document in queue.md with full context
3. **Create issue manually** as soon as possible
4. **Never proceed** without documenting the deferral somewhere persistent
