# Complete Command Mapping

Full cross-platform command equivalents for forge operations.

## Issue Operations

| Operation | GitHub (`gh`) | GitLab (`glab`) | Bitbucket (REST API) |
|-----------|---------------|-----------------|----------------------|
| View | `gh issue view N --json title,body,labels,assignees,comments` | `glab issue view N` | `curl -s "https://api.bitbucket.org/2.0/repositories/OWNER/REPO/issues/N"` |
| List | `gh issue list --json number,title` | `glab issue list` | `curl -s "https://api.bitbucket.org/2.0/repositories/OWNER/REPO/issues"` |
| Create | `gh issue create --title "T" --body "B"` | `glab issue create --title "T" --description "B"` | `curl -X POST -d '{"title":"T","content":{"raw":"B"}}' "https://api.bitbucket.org/2.0/repositories/OWNER/REPO/issues"` |
| Close | `gh issue close N --comment "reason"` | `glab issue close N` | `curl -X PUT -d '{"state":"resolved"}' ".../issues/N"` |
| Comment | `gh issue comment N --body "msg"` | `glab issue note N --message "msg"` | `curl -X POST -d '{"content":{"raw":"msg"}}' ".../issues/N/comments"` |
| Search | `gh issue list --search "query"` | `glab issue list --search "query"` | N/A (filter client-side) |

## PR/MR Operations

| Operation | GitHub (`gh`) | GitLab (`glab`) |
|-----------|---------------|-----------------|
| Create | `gh pr create --title "T" --body "B"` | `glab mr create --title "T" --description "B"` |
| View | `gh pr view N --json number,title,body,state` | `glab mr view N` |
| List | `gh pr list` | `glab mr list` |
| Diff | `gh pr diff N` | `glab mr diff N` |
| Merge | `gh pr merge N` | `glab mr merge N` |
| Close | `gh pr close N` | `glab mr close N` |
| Review | `gh pr review N --approve` | `glab mr approve N` |
| Comments | `gh api repos/O/R/pulls/N/comments` | `glab api projects/ID/merge_requests/N/notes` |
| Current | `gh pr view --json number,url -q '.number'` | `glab mr view --json iid -q '.iid'` |

## GraphQL Operations

### GitHub
```bash
gh api graphql -f query='
query {
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: N) {
      reviewThreads(first: 100) {
        nodes { id isResolved path }
      }
    }
  }
}'
```

### GitLab
```bash
glab api graphql -f query='
query {
  project(fullPath: "OWNER/REPO") {
    mergeRequest(iid: "N") {
      discussions { nodes { id resolved notes { nodes { body } } } }
    }
  }
}'
```

## CI/CD Configuration

| Feature | GitHub Actions | GitLab CI | Bitbucket Pipelines |
|---------|---------------|-----------|---------------------|
| Config file | `.github/workflows/*.yml` | `.gitlab-ci.yml` | `bitbucket-pipelines.yml` |
| Trigger syntax | `on: push` | `rules: - if:` | `pipelines: branches:` |
| Secret access | `${{ secrets.NAME }}` | `$NAME` (CI variable) | `$NAME` (repository variable) |
| Artifact upload | `actions/upload-artifact` | `artifacts: paths:` | `artifacts:` |

## Repo Metadata

| Operation | GitHub | GitLab |
|-----------|--------|--------|
| Owner/name | `gh repo view --json owner,name -q '"\(.owner.login)/\(.name)"'` | `glab repo view --json path_with_namespace -q '.path_with_namespace'` |
| Default branch | `gh repo view --json defaultBranchRef -q '.defaultBranchRef.name'` | `glab repo view --json default_branch -q '.default_branch'` |
| Labels | `gh label list` | `glab label list` |

## Discussion Operations

> **Platform support**: GitHub only (via GraphQL API). GitLab and Bitbucket do not have equivalent Discussion features. All operations below will be skipped with a warning on non-GitHub platforms.

### Prerequisites

Before running any Discussion operation, resolve the repository ID and verify Discussions are enabled:

```bash
# Get repository node ID (required for createDiscussion)
gh api graphql -f query='
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
    hasDiscussionsEnabled
  }
}' -f owner="OWNER" -f repo="REPO"
```

### Category Resolution

Discussion mutations require a category `nodeId`. Resolve from slug:

```bash
# List all discussion categories (slug → nodeId mapping)
gh api graphql -f query='
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    discussionCategories(first: 25) {
      nodes { id name slug description }
    }
  }
}' -f owner="OWNER" -f repo="REPO"
```

### CRUD Operations

| Operation | GitHub (`gh api graphql`) | GitLab / Bitbucket |
|-----------|--------------------------|---------------------|
| List categories | See "Category Resolution" above | N/A |
| Create | See "Create Discussion" below | N/A |
| Comment | See "Add Comment" below | N/A |
| Mark answer | See "Mark as Answer" below | N/A |
| Search | See "Search Discussions" below | N/A |
| Get by number | See "Get Discussion" below | N/A |
| Update | See "Update Discussion" below | N/A |

#### Create Discussion

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
}' -f repoId="$REPO_ID" -f categoryId="$CATEGORY_ID" -f title="$TITLE" -f body="$BODY"
```

#### Add Comment

```bash
gh api graphql -f query='
mutation($discussionId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId,
    body: $body
  }) {
    comment { id url }
  }
}' -f discussionId="$DISCUSSION_ID" -f body="$COMMENT_BODY"
```

To reply to a specific comment (threaded):

```bash
gh api graphql -f query='
mutation($discussionId: ID!, $replyToId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId,
    body: $body,
    replyToId: $replyToId
  }) {
    comment { id url }
  }
}' -f discussionId="$DISCUSSION_ID" -f replyToId="$PARENT_COMMENT_ID" -f body="$REPLY_BODY"
```

#### Mark as Answer

Only works on Q&A category discussions:

```bash
gh api graphql -f query='
mutation($commentId: ID!) {
  markDiscussionCommentAsAnswer(input: {
    id: $commentId
  }) {
    discussion { id answerChosenAt }
  }
}' -f commentId="$COMMENT_ID"
```

#### Search Discussions

Search by keyword, category, and/or label:

```bash
gh api graphql -f query='
query($searchQuery: String!) {
  search(query: $searchQuery, type: DISCUSSION, first: 10) {
    discussionCount
    nodes {
      ... on Discussion {
        number
        title
        url
        createdAt
        category { name slug }
        labels(first: 5) { nodes { name } }
        answer { id body }
      }
    }
  }
}' -f searchQuery="repo:OWNER/REPO category:decisions SEARCH_TERMS"
```

Search query syntax supports: `repo:`, `category:`, `label:`, `author:`, `is:answered`, `is:unanswered`, plus free-text keywords.

#### Get Discussion

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) {
      id
      title
      body
      createdAt
      category { name slug }
      labels(first: 10) { nodes { name } }
      answer { id body author { login } }
      comments(first: 20) {
        nodes {
          id
          body
          author { login }
          createdAt
          isAnswer
        }
      }
    }
  }
}' -f owner="OWNER" -f repo="REPO" -F number=NUMBER
```

Note: Use `-F` (not `-f`) for integer variables.

#### Update Discussion

```bash
gh api graphql -f query='
mutation($discussionId: ID!, $body: String!) {
  updateDiscussion(input: {
    discussionId: $discussionId,
    body: $body
  }) {
    discussion { id url updatedAt }
  }
}' -f discussionId="$DISCUSSION_ID" -f body="$UPDATED_BODY"
```

#### List Recent Discussions by Category

Bounded query for listing recent discussions. The `fetch-recent-discussions.sh` SessionStart hook uses `first: 5` for token budget compliance; adjust the limit as needed for other use cases:

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $categoryId: ID!) {
  repository(owner: $owner, name: $repo) {
    discussions(first: 5, categoryId: $categoryId, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number
        title
        url
        createdAt
        body
        labels(first: 5) { nodes { name } }
      }
    }
  }
}' -f owner="OWNER" -f repo="REPO" -f categoryId="$CATEGORY_ID"
```
