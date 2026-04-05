# Discussion Promotion

Promote evergreen knowledge-corpus entries to GitHub Discussions for cross-session and cross-contributor discovery.

## When This Module Applies

During the knowledge-librarian's review of corpus entries, when an entry has reached **evergreen** maturity in the digital garden lifecycle.

## Eligibility Rules

| Maturity | Action Available |
|----------|-----------------|
| Seedling | No promotion option |
| Growing | No promotion option |
| Evergreen | "Promote to Discussion" |
| Evergreen + has `discussion_url` | "Update Discussion" |

## Promote to Discussion

### Step 1: Confirm Eligibility

Check the corpus entry's maturity field:
```yaml
maturity: evergreen  # Required for promotion
```

If maturity is not `evergreen`, do not present the promotion option.

### Step 2: Confirm Promotion (Default: Publish)

```
This entry has reached evergreen maturity. Publishing to GitHub Discussions. [Y/n]
```

Publishing is the default action. If the user explicitly
declines ("n"), skip all subsequent steps.

### Step 3: Resolve Repository and Category IDs

```bash
# Get repository node ID and "knowledge" category ID
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

Find the category nodeID where `slug` equals `"knowledge"`.

If the "Knowledge" category doesn't exist, warn and skip:
```
⚠ "Knowledge" discussion category not found. Skipping promotion.
```

### Step 4: Create the Discussion

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
   -f title="[Knowledge] $ENTRY_TITLE" \
   -f body="$BODY"
```

**Title format**: `[Knowledge] <entry title>`

**Body structure** (keep concise — link to local corpus for full details):
```markdown
## Topic

<Entry title / topic>

## Summary

<Key points from the corpus entry — max 500 words>

## Source

<Original source URL or session reference>

## Tags

<Comma-separated tags from the entry>

---
*Maturity: Evergreen | Local corpus: `<relative path to corpus entry>`*
*Promoted from knowledge-corpus on YYYY-MM-DD*
```

### Step 5: Apply Labels

Apply labels matching the entry's tags. Common labels:
- `knowledge` — always applied
- `evergreen` — always applied
- Entry-specific tags (e.g., `graphql`, `python`, `architecture`)

### Step 6: Update Local Corpus Entry

Add a `discussion_url` field to the corpus entry:

```yaml
discussion_url: https://github.com/OWNER/REPO/discussions/NUMBER
discussion_number: NUMBER
promoted_at: YYYY-MM-DDTHH:MM:SSZ
```

## Update Discussion

When a corpus entry already has a `discussion_url` field (previously promoted), offer "Update Discussion" instead of "Promote":

```
This entry was previously promoted to Discussion #42. Updating it. [Y/n]
```

### Update Flow

1. Extract the Discussion nodeID from `discussion_url` or `discussion_number`
2. Get the existing Discussion's nodeID:

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    discussion(number: $number) { id }
  }
}' -f owner="OWNER" -f repo="REPO" -F number=$DISCUSSION_NUMBER
```

3. Update the Discussion body:

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

4. Update the local corpus entry's `promoted_at` timestamp.

## Token Conservation

- Discussion body: max 500 words (link to local file for full content)
- Do NOT duplicate the entire corpus entry — the Discussion is a summary with a pointer
- Include the local file path so sessions can `Read` the full entry

## Error Handling

- **Network failure**: Warn and skip. Do not block the knowledge review workflow.
- **Missing category**: Warn and skip.
- **`gh` not authenticated**: Skip with message about running `gh auth login`.
- **Discussion already exists but can't be found**: Create a new one and update the local reference.
