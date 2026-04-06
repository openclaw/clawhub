# Discussion Publishing

Publish completed war room deliberations to GitHub Discussions for cross-session discovery.

## When This Module Applies

This module activates **after Phase 7 (Supreme Commander Synthesis)** completes. It is an additional publication channel — the local strategeion archive continues as the primary record.

## Prerequisites

- GitHub platform detected (check `git_platform` session context)
- `gh` CLI authenticated (`gh auth status` succeeds)
- Repository has Discussions enabled with a "Decisions" category
- Leyline command-mapping Discussion templates available

## Publishing Flow

### Step 1: Confirm Publication (Default: Publish)

After the Supreme Commander Decision document is finalized,
announce the publication and give the user a chance to opt out:

```
Publishing this decision to GitHub Discussions. [Y/n]
```

Publishing is the default action. If the user explicitly
declines ("n"), skip all subsequent steps. The local
strategeion workflow continues unchanged.

### Step 2: Resolve Repository and Category IDs

```bash
# Get repository node ID
REPO_INFO=$(gh api graphql -f query='
query($owner: String!, $repo: String!) {
  repository(owner: $owner, name: $repo) {
    id
    hasDiscussionsEnabled
    discussionCategories(first: 25) {
      nodes { id name slug }
    }
  }
}' -f owner="OWNER" -f repo="REPO")
```

Extract `repositoryId` and find the category nodeID where `slug` equals `"decisions"`.

If Discussions are not enabled or the "Decisions" category doesn't exist, warn the user and skip publishing:
```
⚠ Discussions not available (feature disabled or "Decisions" category missing). Skipping publication.
```

### Step 3: Create the Discussion

Create a Discussion in the "Decisions" category:

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
   -f title="[War Room] $TOPIC" \
   -f body="$BODY"
```

**Title format**: `[War Room] <topic from session invocation>`

**Body structure**:
```markdown
## Context

<Context from the Supreme Commander Decision document>

## Decision

**Selected Approach**: <selected approach name>

<Decision rationale>

## Consequences

<Positive, negative, and neutral consequences>

## Reversibility Assessment

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Reversal Cost | X/5 | ... |
| Time Lock-In | X/5 | ... |
| Blast Radius | X/5 | ... |
| Information Loss | X/5 | ... |
| Reputation Impact | X/5 | ... |

**RS: 0.XX | Type: [1A+/1A/1B/2] | Mode: [delphi/full_council/lightweight/express]**

## Alternatives Considered

<Brief summary of each COA that was not selected>

## Expert Panel

| Role | Model | Key Contribution |
|------|-------|-----------------|
| Supreme Commander | ... | ... |
| Chief Strategist | ... | ... |
| Red Team | ... | ... |

---
*Session: <session_id> | Strategeion: `<local_file_path>`*
```

### Step 4: Post Deliberation Phases as Comments

Post each major phase as a threaded comment on the Discussion. This preserves the deliberation trail without overwhelming the Discussion body.

**Comments to post** (in order):
1. **Intelligence Report** — key findings from Phase 1
2. **Situation Assessment** — Phase 2 analysis summary
3. **COA Summary** — brief of each Course of Action (Phase 3)
4. **Red Team Challenges** — key challenges and responses (Phase 4)
5. **Supreme Commander Synthesis** — the final decision rationale (Phase 7)

> Phases 5-6 (War Game execution and Decision Briefing) are internal deliberation artifacts that don't warrant separate comments. Their outputs are incorporated into the Red Team Challenges and Supreme Commander Synthesis.

For each comment:
```bash
gh api graphql -f query='
mutation($discussionId: ID!, $body: String!) {
  addDiscussionComment(input: {
    discussionId: $discussionId,
    body: $body
  }) {
    comment { id url }
  }
}' -f discussionId="$DISCUSSION_ID" -f body="### Phase N: <Phase Name>

<Phase summary — keep under 500 words per comment>

*Full details in strategeion: \`<local_file_path>\`*"
```

### Step 5: Mark Synthesis as Answer (Q&A Categories Only)

> **Skip this step for the "Decisions" category.** It uses Announcement format, which does not support answers. The synthesis is already the last comment — no further marking is needed.

For Q&A-format categories (e.g., "Knowledge"), mark the synthesis comment as the answer:

```bash
gh api graphql -f query='
mutation($commentId: ID!) {
  markDiscussionCommentAsAnswer(input: {
    id: $commentId
  }) {
    discussion { id answerChosenAt }
  }
}' -f commentId="$SYNTHESIS_COMMENT_ID"
```

If the mutation fails (wrong category format), log a warning and continue.

### Step 6: Apply Labels

Apply labels to the Discussion for discoverability. Labels must already exist on the repository.

Recommended labels:
- `war-room` — always applied
- `type-1a`, `type-1b`, or `type-2` — matching the decision type from RS assessment
- Topic-relevant labels (e.g., `architecture`, `performance`, `security`)

Label application requires a separate mutation:
```bash
gh api graphql -f query='
mutation($labelableId: ID!, $labelIds: [ID!]!) {
  addLabelsToLabelable(input: {
    labelableId: $labelableId,
    labelIds: $labelIds
  }) {
    labelable { ... on Discussion { id } }
  }
}'
```

If label application fails (labels don't exist), log a warning and continue.

### Step 7: Update Local Strategeion

Add the Discussion URL to the local strategeion session file:

```yaml
discussion_url: https://github.com/OWNER/REPO/discussions/NUMBER
discussion_number: NUMBER
published_at: YYYY-MM-DDTHH:MM:SSZ
```

This cross-reference allows future sessions to navigate from local artifact to the published Discussion and vice versa.

## Error Handling

- **Network failure during publishing**: Log warning, preserve local artifacts. Do not retry automatically — the user can re-publish manually.
- **Rate limiting**: If GitHub returns 429, warn the user and skip. Do not block the session.
- **Missing category**: Warn and skip. Do not auto-create categories.
- **`gh` not authenticated**: Skip with message: "GitHub CLI not authenticated. Run `gh auth login` to enable Discussion publishing."

## Token Conservation

- Discussion body: max 2000 words (NFR-005)
- Phase comments: max 500 words each
- Link to strategeion files for full details rather than duplicating content
- Total published content should be a readable summary, not a transcript

## Prior Decision Check

Before starting a new war room session, search for prior decisions on the same topic. See the "Prior Decision Check" section below.

---

## Prior Decision Check

When a war room session starts (before Phase 1), search existing Discussions for prior decisions in the same area.

### Search Flow

1. Extract topic keywords from the war room invocation argument
2. Search Discussions:

```bash
gh api graphql -f query='
query($searchQuery: String!) {
  search(query: $searchQuery, type: DISCUSSION, first: 5) {
    discussionCount
    nodes {
      ... on Discussion {
        number
        title
        url
        createdAt
        body
        answer { body }
      }
    }
  }
}' -f searchQuery="repo:OWNER/REPO category:Decisions TOPIC_KEYWORDS"
```

3. If matches found, present to user:

```
Found prior decisions on this topic:
  #42 [War Room] Database migration strategy (2026-02-15)
  #38 [War Room] API versioning approach (2026-02-10)

Review before proceeding? [Y/n/skip]
```

### User Responses

- **Y (review)**: Display the prior decision summary. Then ask:
  - "Does this prior decision still apply? [Y/n]"
    - **Y**: Skip war room. Record a note: "Reaffirmed Decision #42. No new deliberation needed."
    - **N**: Proceed with war room. New Discussion will reference the prior: `Supersedes: #42`
- **n (proceed)**: Start war room without reviewing prior decisions
- **skip**: Disable prior decision check for this session

### No Matches

If no matching Discussions are found, proceed directly to Phase 1 without delay.
