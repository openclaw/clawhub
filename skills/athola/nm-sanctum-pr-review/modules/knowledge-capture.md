# Knowledge Capture Module

Capture significant PR review findings into the project's review chamber.

## Integration Point

This module executes **after Phase 6 (Generate Report)** and **before posting to GitHub**.

```
Phase 6: Generate Report
    ↓
[KNOWLEDGE CAPTURE MODULE]
    ↓
Phase 7: Post to GitHub
```

## Trigger Conditions

Evaluate knowledge capture when:

1. Review contains BLOCKING findings with architectural context
2. Review contains recurring patterns (seen in 2+ PRs)
3. Review establishes new conventions or standards
4. Review documents a significant decision with rationale

## Capture Workflow

### Step 1: Extract Capture Candidates

From the review findings, identify candidates for knowledge capture:

```python
def extract_candidates(findings, pr_info):
    """Identify findings worth capturing."""
    candidates = []

    for finding in findings:
        # Score using evaluation criteria
        score = evaluate_finding(finding, pr_info)

        if score >= 60:
            candidates.append({
                "finding": finding,
                "score": score,
                "room_type": classify_room_type(finding),
            })

    return candidates
```

### Step 2: Classify Room Type

Route each candidate to the appropriate review-chamber room:

| Finding Characteristics | Target Room |
|------------------------|-------------|
| Architectural decision with rationale | `decisions/` |
| Recurring pattern or solution | `patterns/` |
| Quality standard or convention | `standards/` |
| Post-mortem insight or learning | `lessons/` |

### Step 3: Create Review Entries

For each approved candidate:

```yaml
---
source_pr: "#42 - Add authentication"
date: 2025-01-15
participants: [author, reviewers...]
palace_location: review-chamber/decisions
tags: [authentication, jwt, security]
---

## Decision Title

### Decision
[What was decided]

### Context
[Discussion that led to decision]

### Captured Knowledge
- Pattern: [reusable pattern]
- Tradeoff: [key tradeoffs]
- Application: [where to apply]

### Connected
- [[related-room]] - connection type
```

### Step 4: User Confirmation

Before capturing, present candidates to user:

```markdown
## 📚 Knowledge Capture

Found **3** findings worth capturing to review-chamber:

| # | Title | Score | Room | Action |
|---|-------|-------|------|--------|
| 1 | JWT over sessions | 95 | decisions | Capture |
| 2 | API error format | 77 | standards | Capture |
| 3 | Missing null check | 25 | - | Skip |

**Options:**
- [Y] Capture all (2 findings)
- [S] Select which to capture
- [N] Skip knowledge capture
- [E] Edit before capture
```

### Step 5: Store in Project Palace

```python
from memory_palace.project_palace import (
    ProjectPalaceManager,
    ReviewEntry,
    capture_pr_review_knowledge,
)

def store_findings(findings, pr_info):
    """Store findings in project palace."""

    # Get or create project palace
    manager = ProjectPalaceManager()
    palace = manager.get_or_create_project_palace(
        repo_name=pr_info.repo,
        repo_url=pr_info.repo_url,
    )

    # Create entries for each finding
    created = []
    for finding in findings:
        entry = ReviewEntry(
            source_pr=f"#{pr_info.number} - {pr_info.title}",
            title=finding.title,
            room_type=finding.room_type,
            content={
                "decision": finding.description,
                "context": finding.context,
                "captured_knowledge": {
                    "severity": finding.severity,
                    "category": finding.category,
                    "file": finding.file,
                    "line": finding.line,
                },
                "connected_concepts": finding.related,
            },
            participants=pr_info.participants,
            tags=finding.tags,
        )

        if manager.add_review_entry(palace["id"], entry):
            created.append(entry.id)

    return created
```

## Output Integration

Add knowledge capture summary to the review report:

```markdown
## PR #42: Add Authentication

### Scope Compliance
...

### Blocking Issues
...

### In-Scope Issues
...

### Knowledge Captured 📚

The following findings were stored in the project's review chamber:

| Entry ID | Title | Room |
|----------|-------|------|
| abc123 | JWT over sessions | decisions/ |
| def456 | Token refresh pattern | patterns/ |

View in palace: `python scripts/palace_manager.py list-reviews --palace project-id`
```

## CLI Integration

### Automatic (Default)

When running `/pr-review`, knowledge capture triggers automatically for high-scoring findings:

```bash
/pr-review 42
# ... review output ...
# → Knowledge Capture: Captured 2 findings to review-chamber
```

### Manual Override

```bash
# Skip knowledge capture
/pr-review 42 --no-capture

# Force capture all findings
/pr-review 42 --capture-all

# Review and select interactively
/pr-review 42 --capture-interactive
```

### Retroactive Capture

Capture knowledge from a past review:

```bash
/review-room capture 42
# Fetches PR #42 review comments and extracts knowledge
```

## Configuration

In `memory-palace/config/settings.json`:

```json
{
  "review_chamber": {
    "auto_capture": true,
    "capture_threshold": 60,
    "require_confirmation": true,
    "default_rooms": ["decisions", "patterns", "standards", "lessons"],
    "excluded_categories": ["typo", "formatting", "style"]
  }
}
```

## Evaluation Criteria

Uses `memory-palace:review-chamber` evaluation framework:

| Criterion | Weight | Description |
|-----------|--------|-------------|
| Novelty | 25% | Is this new knowledge? |
| Applicability | 30% | Will this affect future PRs? |
| Durability | 20% | Architectural vs tactical? |
| Connectivity | 15% | Links to existing knowledge? |
| Authority | 10% | Expert reviewer involved? |

**Threshold:** Score ≥ 60 triggers capture consideration.

## Dependencies

- `memory-palace:project-palace` - Project palace management
- `memory-palace:review-chamber` - Room structure and evaluation
- `memory-palace:knowledge-intake` - Evaluation framework
