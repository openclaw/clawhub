---
module: style-application
category: writing-quality
dependencies: [Write, Edit]
estimated_tokens: 350
---

# Style Application Module

Apply learned style profiles to new content generation and editing.

## Generation Prompting

When generating new content with a style profile:

```markdown
## Style Guidelines

**Voice**: [profile.voice.tone] with [profile.voice.perspective] perspective

**Sentence targets**:
- Average length: [profile.sentences.average_length] words
- Vary between [min] and [max]
- [Fragment guidance from profile]

**Vocabulary**:
- Prefer: [profile.vocabulary.preferred_terms]
- Avoid: [profile.vocabulary.avoided_terms]
- Contractions: [profile.vocabulary.contractions]

**Structure**:
- Paragraphs: [profile.structure.paragraphs]
- Lists: [profile.structure.lists]

**Reference exemplar**:
> [Most relevant exemplar passage]

**Anti-patterns** (will be checked by slop-detector):
[profile.anti_patterns]
```

## Editing to Match Style

When editing existing content to match a profile:

### Step 1: Measure Current State

Extract metrics from current content and compare to profile.

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Avg sentence length | 24 | 18 | -6 |
| Contraction rate | 0.5 | 3.5 | +3.0 |
| List ratio | 0.45 | 0.15 | -0.30 |

### Step 2: Prioritize Changes

1. **High gap** metrics first
2. **Anti-pattern** violations
3. **Vocabulary** substitutions
4. **Structural** adjustments

### Step 3: Section-by-Section Editing

For each section:
1. Show current metrics
2. Propose specific changes
3. Present exemplar for reference
4. Wait for approval
5. Apply changes
6. Re-measure

## Validation Loop

After applying style:

```
1. Run slop-detector on output
2. Re-extract metrics
3. Compare to profile targets
4. Flag remaining gaps > 20%
5. Iterate if needed
```

## Style Drift Detection

For ongoing content:

```bash
# Compare new content metrics to profile
new_metrics=$(extract_metrics new-doc.md)
profile_metrics=$(cat .scribe/style-profile.yaml)

# Alert if drift > threshold
if [ $avg_sentence_diff -gt 5 ]; then
    echo "WARNING: Sentence length drifting from profile"
fi
```

## Integration Points

| Tool | Integration |
|------|-------------|
| slop-detector | Validate anti-patterns |
| doc-generator | Apply during generation |
| pre-commit | Check style conformance |
