# GitHub PR Comment Patterns

Reusable patterns for posting comments to GitHub PRs via the `gh` CLI.

## Key API Differences

| Endpoint | Use Case | Notes |
|----------|----------|-------|
| `gh pr comment` | General PR comments | Simple, always works |
| `gh api .../reviews` | Inline comments on diff lines | Use `-F` for integers |
| `gh pr review` | Summary with approve/request changes | Final submission |

## Common Mistakes

### Wrong: Individual Comments Endpoint with `line` parameter
```bash
# This will FAIL with HTTP 422
gh api repos/{owner}/{repo}/pulls/{pr}/comments \
  -X POST \
  -f path='file.rs' \
  -f line=63 \  # ERROR: "line" is not a permitted key
  -f body='Comment'
```

### Right: Reviews Endpoint with Comments Array
```bash
# This works correctly
gh api repos/{owner}/{repo}/pulls/{pr}/reviews \
  --method POST \
  -f event="COMMENT" \
  -f body="Review summary" \
  -f 'comments[][path]=file.rs' \
  -F 'comments[][line]=63' \  # Use -F for integers!
  -f 'comments[][body]=Inline comment text'
```

## Pattern: Single Inline Comment

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews \
  --method POST \
  -f event="COMMENT" \
  -f body="See inline comment." \
  -f 'comments[][path]=src/auth/jwt.rs' \
  -F 'comments[][line]=63' \
  -f 'comments[][side]=RIGHT' \
  -f 'comments[][body]=**[IN-SCOPE]** JWT secondary secret

This fallback secret poses a security risk.

**Recommendation:** Fail-fast on missing JWT_SECRET.'
```

## Pattern: Multiple Inline Comments

For multiple comments, use JSON input via `--input -`:

```bash
gh api repos/{owner}/{repo}/pulls/{pr_number}/reviews \
  --method POST \
  --input - <<'EOF'
{
  "event": "COMMENT",
  "body": "Review with inline comments",
  "comments": [
    {
      "path": "src/auth.rs",
      "line": 26,
      "side": "RIGHT",
      "body": "**[IN-SCOPE]** Basic email validation"
    },
    {
      "path": "src/routes.rs",
      "line": 45,
      "side": "RIGHT",
      "body": "**[SUGGESTION]** Consider rate limiting"
    }
  ]
}
EOF
```

**Note:** The indexed array syntax (`comments[0][path]`) does NOT work with `gh api` - it creates an object instead of an array. Always use JSON input for multiple comments.

## Pattern: General PR Comment (Not Inline)

For findings not on diff lines or when inline fails:

```bash
gh pr comment $PR_NUMBER --body '## Detailed Findings

### IN-SCOPE (Should fix before merge)

#### 1. JWT Fallback Secret (`src/auth/jwt.rs:62-63`)
**Risk**: If deployed without `JWT_SECRET`, tokens use known secret.
**Fix**: Fail-fast on missing secret.

#### 2. Basic Email Validation (`src/routes/auth.rs:26`)
**Risk**: Accepts invalid emails like `@@` or `test@`.
**Fix**: Use proper email validation.'
```

## Pattern: Submit Review with Summary

```bash
# Determine event based on findings
EVENT="COMMENT"  # or "REQUEST_CHANGES" or "APPROVE"

gh pr review $PR_NUMBER \
  --event $EVENT \
  --body "$(cat <<'EOF'
## PR Review Summary

### Blocking Issues (2)
- [B1] Missing token validation (auth.py:45)
- [B2] SQL injection risk (models.py:123)

### Suggestions (3)
- See inline comments for details

**Action Required:** Address blocking issues before merge.
EOF
)"
```

## Secondary Strategy

When inline comments fail (line not in diff, API issues):

1. **Try inline first** via reviews API
2. **On failure, fall back to PR comment** with file:line reference in body
3. **Always post a summary comment** with all findings aggregated

```bash
# Secondary: Post as regular comment with location reference
gh pr comment $PR_NUMBER --body "**[B1] Issue at src/auth.rs:45**

This line was not in the PR diff, but the issue was identified during review.

Issue: Missing validation
Severity: BLOCKING
Fix: Add input sanitization"
```

## Extracting Owner/Repo

```bash
# From remote URL
REMOTE_URL=$(git remote get-url origin)
OWNER_REPO=$(echo "$REMOTE_URL" | sed -E 's/.*github\.com[:/]([^/]+\/[^/.]+).*/\1/')
OWNER=$(echo "$OWNER_REPO" | cut -d'/' -f1)
REPO=$(echo "$OWNER_REPO" | cut -d'/' -f2)

# Or from gh CLI
gh repo view --json owner,name --jq '"\(.owner.login)/\(.name)"'
```

## Getting Commit SHA for Comments

```bash
# Get HEAD commit of the PR
COMMIT_SHA=$(gh pr view $PR_NUMBER --json headRefOid --jq '.headRefOid')

# Or get the latest commit
COMMIT_SHA=$(gh pr view $PR_NUMBER --json commits --jq '.commits[-1].oid')
```
