# Automatic Issue Creation for Deferred Items

Reusable patterns for automatically creating GitHub issues when items are classified as deferred, backlog, out-of-scope, or suggestions during workflow execution.

## Philosophy

**Automatic by Default**: When items are explicitly classified as deferred/backlog during any workflow, they should be automatically logged to GitHub issues without requiring a separate flag or manual step. The user is notified of what was created.

## When to Use This Module

Include this module in any workflow that:
- Classifies items as "deferred", "backlog", "out-of-scope", or "suggestion"
- Identifies work that should be tracked but not addressed immediately
- Produces improvement recommendations with priority levels

## Integration Pattern

### Step 1: Collect Deferred Items

During workflow execution, collect deferred items in a structured format:

```bash
# Data structure for deferred items
DEFERRED_ITEMS=()

# Add items as they're identified
DEFERRED_ITEMS+=("type:suggestion|title:Improve error messages|source:PR #123|file:auth.py:45|description:Error messages could be more descriptive|labels:enhancement,plugin:sanctum")
DEFERRED_ITEMS+=("type:backlog|title:Add rate limiting|source:PR #123|file:routes.py|description:Consider adding rate limiting to API|labels:enhancement,low-priority")
```

### Step 2: Invoke Auto-Creation

At the end of the workflow (after all analysis is complete), invoke the auto-creation routine:

```markdown
## Auto-Create GitHub Issues

For each deferred item collected during this workflow:

1. **Check for duplicates** before creating
2. **Create the issue** with proper labels and context
3. **Report what was created** to the user
```

### Step 3: Duplicate Detection

Before creating any issue, check if a similar issue already exists:

```bash
# Search for existing issues with similar title
SEARCH_QUERY="$ITEM_TITLE in:title is:issue is:open"
EXISTING=$(gh issue list --search "$SEARCH_QUERY" --json number,title --jq '.[0].number // empty')

if [[ -n "$EXISTING" ]]; then
  echo "Skipping duplicate: Issue #$EXISTING already tracks '$ITEM_TITLE'"
  SKIPPED_ITEMS+=("$ITEM_TITLE (duplicate of #$EXISTING)")
else
  # Proceed with creation
fi
```

### Step 4: Issue Creation Template

```bash
create_deferred_issue() {
  local TYPE="$1"      # suggestion, backlog, deferred
  local TITLE="$2"     # Issue title
  local SOURCE="$3"    # Where it came from (PR #X, /update-plugins, etc.)
  local FILE="$4"      # file:line reference (optional)
  local DESC="$5"      # Description
  local LABELS="$6"    # Comma-separated labels

  # Determine prefix based on type
  case "$TYPE" in
    suggestion) PREFIX="[Suggestion]" ;;
    backlog) PREFIX="[Backlog]" ;;
    deferred|out-of-scope) PREFIX="[Deferred]" ;;
    improvement) PREFIX="[Improvement]" ;;
    *) PREFIX="" ;;
  esac

  # Create issue body
  BODY="## Context

Identified during $SOURCE as $TYPE item.

$(if [[ -n "$FILE" ]]; then echo "**Location:** \`$FILE\`"; fi)

## Description

$DESC

## Value

This improvement would enhance the codebase by addressing an identified opportunity.

## Acceptance Criteria

- [ ] Implementation complete
- [ ] Tests added/updated (if applicable)
- [ ] Documentation updated (if applicable)

---
*Auto-created by workflow execution*"

  # Create the issue
  ISSUE_URL=$(gh issue create \
    --title "$PREFIX $TITLE" \
    --body "$BODY" \
    --label "$LABELS" 2>&1)

  if [[ $? -eq 0 ]]; then
    echo "$ISSUE_URL"
  else
    echo "ERROR: $ISSUE_URL"
    return 1
  fi
}
```

### Step 5: Report Created Issues

After all issues are created, report to the user:

```markdown
### Issues Created (Automatic)

| Type | Title | Issue | Labels |
|------|-------|-------|--------|
| Suggestion | Improve error messages | [#115](url) | enhancement, plugin:sanctum |
| Backlog | Add rate limiting | [#116](url) | enhancement, low-priority |

**Skipped (duplicates):**
- "Fix validation" (duplicate of #42)
```

## Workflow-Specific Integration

### For `/pr-review`

Add to Phase 3 (after triage):

```markdown
### Auto-Create Issues for Out-of-Scope Items

Items classified as "Suggestion" or "Out-of-Scope" during triage are automatically logged:

1. For each suggestion/out-of-scope item:
   - Check for duplicate issues
   - Create issue with `[Suggestion]` or `[Deferred]` prefix
   - Add labels: `enhancement`, plugin label, priority label
   - Reference the source PR

2. Report created issues in the review summary
```

### For `/fix-pr`

Add to Step 6.1/6.2 (issue creation is already defined - make it automatic):

```markdown
### Automatic Issue Creation

**CHANGE: Issue creation for suggestions and deferred items is now AUTOMATIC.**

When items are classified as "Suggestion" or "Deferred" during triage (Step 2):
- Issues are created automatically at the end of Step 6
- No `--create-backlog-issues` flag required
- User is notified of all created issues in the summary

**Skip automatic creation with:** `--no-auto-issues` flag
```

### For `/update-plugins`

Add to Step 5 (after recommendations):

```markdown
### Auto-Create Issues for Improvement Recommendations

Items in "Critical" and "Moderate" categories are automatically logged:

1. For each improvement recommendation:
   - Check for duplicate issues
   - Create issue with `[Improvement]` prefix
   - Add labels based on component type and priority
   - Reference the plugin being analyzed

2. "Low Priority" items are reported but not auto-created (stay in backlog docs)
```

### For `/fix-workflow`

Add to Phase 2 (outcome feedback):

```markdown
### Auto-Create Issues for Identified Improvements

When retrospective analysis identifies workflow improvements:
- Improvements that can't be implemented immediately → auto-create issue
- Pattern: "[Workflow] <improvement description>"
- Labels: `refactor`, `workflow`, priority based on complexity score
```

## Label Strategy

| Item Type | Default Labels |
|-----------|---------------|
| Suggestion | `enhancement`, `low-priority`, `small-effort` |
| Backlog | `enhancement`, `low-priority` |
| Deferred | `enhancement`, `medium-priority` |
| Improvement (Critical) | `enhancement`, `high-priority` |
| Improvement (Moderate) | `enhancement`, `medium-priority` |
| Workflow | `refactor`, `workflow` |

Always add plugin-specific labels when applicable: `plugin:sanctum`, `plugin:imbue`, etc.

## Error Handling

```bash
# If issue creation fails
if ! ISSUE_URL=$(create_deferred_issue ...); then
  echo "Warning: Failed to create issue for '$TITLE'"
  echo "Error: $ISSUE_URL"
  FAILED_ITEMS+=("$TITLE")
fi
```

At end of workflow:

```markdown
### Issue Creation Summary

**Created:** 3 issues
**Skipped (duplicates):** 1
**Failed:** 0

If any failed, manually create using:
\`\`\`bash
gh issue create --title "[Type] Title" --body "..." --label "labels"
\`\`\`
```

## Opting Out

To disable automatic issue creation for a specific workflow run:

```bash
# Flag to disable
--no-auto-issues

# Or environment variable
SKIP_AUTO_ISSUES=true /pr-review 123
```

When disabled, deferred items are still reported but not created as issues:

```markdown
### Deferred Items (not auto-created)

The following items were identified but not logged to GitHub:
- Suggestion: Improve error messages (auth.py:45)
- Backlog: Add rate limiting (routes.py)

To create issues manually: `/create-issue "Title" --labels "enhancement"`
```
