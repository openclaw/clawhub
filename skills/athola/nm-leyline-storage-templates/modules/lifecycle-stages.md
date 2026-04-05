---
name: lifecycle-stages
description: Maturity progression patterns, promotion criteria, and lifecycle management workflows
category: lifecycle
tags: [maturity, lifecycle, progression, workflow]
dependencies: [storage-templates]
complexity: beginner
estimated_tokens: 600
---

# Lifecycle Stages

Maturity progression patterns, promotion criteria, and lifecycle management for structured content.

## Maturity Model

```
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌─────────┐
│ Seedling │───▶│ Growing  │───▶│ Evergreen │───▶│ Archive │
└──────────┘    └──────────┘    └───────────┘    └─────────┘
     ↓               ↓                ↓                ↓
  1-2 weeks      1-3 months       Permanent       Deprecated
```

## Stage Definitions

### Seedling

**Purpose**: Capture early ideas without commitment

**Characteristics**:
- Minimal structure
- Date-prefixed filename
- Short review cycle (1-2 weeks)
- Low investment

**Typical Content**:
- Quick observations
- Links to research
- Rough ideas
- Experimental notes

**File Pattern**: `YYYY-MM-DD-topic.md`

**Frontmatter**:
```yaml
maturity: seedling
review_after: [2 weeks from created]
```

**Exit Paths**:
- → Growing (validated, expanded)
- → Archive (not valuable)
- → Stay Seedling (needs more time)

### Growing

**Purpose**: Active development and validation

**Characteristics**:
- Structured content
- Regular updates
- Connected to other content
- Medium investment

**Typical Content**:
- Draft specifications
- Evolving patterns
- Active research
- Under-review documentation

**File Pattern**: `topic-name.md`

**Frontmatter**:
```yaml
maturity: growing
review_date: [quarterly]
updated: [YYYY-MM-DD]
```

**Exit Paths**:
- → Evergreen (stable, proven)
- → Seedling (needs rework)
- → Archive (invalidated)

### Evergreen

**Purpose**: Stable, long-term reference material

**Characteristics**:
- Proven value over time
- Rarely modified
- Well-connected
- High investment

**Typical Content**:
- Core patterns
- Established processes
- Reference documentation
- Canonical guides

**File Pattern**: `topic-name.md`

**Frontmatter**:
```yaml
maturity: evergreen
updated: [YYYY-MM-DD]
```

**Exit Paths**:
- → Archive (superseded, deprecated)
- → Growing (significant changes needed)

### Reference

**Purpose**: Version-specific or tool documentation

**Characteristics**:
- External source
- Version-bound
- Time-limited value
- Attribution required

**Typical Content**:
- Tool documentation
- API references
- Version-specific features
- Third-party guides

**File Pattern**: `tool-version.md`

**Frontmatter**:
```yaml
maturity: reference
version: [version number]
expires: [YYYY-MM-DD]
source: [URL]
```

**Exit Paths**:
- → Archive (version deprecated)
- → Reference (update to new version)

### Archive

**Purpose**: Preserve deprecated or superseded content

**Characteristics**:
- Read-only
- Clearly marked as deprecated
- Redirect to replacement
- Historical value

**Typical Content**:
- Deprecated patterns
- Superseded documentation
- Outdated tools
- Failed experiments

**File Pattern**: Move to `archive/YYYY-MM-DD-topic.md`

**Frontmatter**:
```yaml
maturity: archive
deprecated: [YYYY-MM-DD]
reason: [why archived]
superseded_by: [replacement path]
```

## Promotion Criteria

### Seedling → Growing

**Quantitative**:
- Accessed 2+ times
- Connected to 1+ other entries
- Expanded beyond initial capture

**Qualitative**:
- Insight validated through use
- Pattern emerging
- Worth structured development

**Actions Required**:
1. Remove date prefix from filename
2. Update maturity to growing
3. Add structured sections
4. Set quarterly review date
5. Connect to related content

### Growing → Evergreen

**Quantitative**:
- Stable for 3+ months
- Minimal edits in last month
- Connected to 3+ other entries
- Used in 5+ instances

**Qualitative**:
- Proven valuable over time
- Pattern well-understood
- Not likely to change
- Widely applicable

**Actions Required**:
1. Final content review
2. Update maturity to evergreen
3. Remove review_date (stable)
4. Strengthen connections
5. Add detailed examples

### Evergreen → Archive

**Triggers**:
- Superseded by better approach
- Technology deprecated
- No longer applicable
- Better alternative exists

**Actions Required**:
1. Create replacement content (if applicable)
2. Move to archive/ directory
3. Add archive prefix: `archive/YYYY-MM-DD-topic.md`
4. Update maturity to archive
5. Add deprecation metadata
6. Update links to point to replacement

### Growing → Seedling (Demotion)

**Triggers**:
- Assumptions invalidated
- Needs significant rework
- Complexity too high
- Direction unclear

**Actions Required**:
1. Add date prefix to filename
2. Update maturity to seedling
3. Document what needs rework
4. Set short review cycle
5. Consider archiving instead

## Review Workflows

### Seedling Review (Bi-weekly)

```bash
# Find seedlings due for review
find . -name "*.md" -type f \
  -not -path "*/.venv/*" -not -path "*/__pycache__/*" \
  -not -path "*/node_modules/*" -not -path "*/.git/*" | while read file; do
  if grep -q "maturity: seedling" "$file"; then
    review_date=$(grep "review_after:" "$file" | cut -d: -f2)
    if [[ $(date +%s) -gt $(date -d "$review_date" +%s) ]]; then
      echo "Review: $file"
    fi
  fi
done
```

**Review Questions**:
- Still relevant?
- Ready to promote?
- Needs more time?
- Should archive?

### Growing Review (Quarterly)

**Review Checklist**:
- [ ] Content still accurate?
- [ ] Usage increasing or stable?
- [ ] Ready for evergreen?
- [ ] Connections still valid?
- [ ] Structure appropriate?

### Evergreen Review (Yearly)

**Review Checklist**:
- [ ] Still best practice?
- [ ] Any superseding approaches?
- [ ] Links still valid?
- [ ] Examples up to date?
- [ ] Should archive?

## Lifecycle Metrics

### Health Indicators

**Good Signs**:
- Steady promotion rate (seedling → growing)
- Low archive rate for evergreen
- Regular reviews completed
- Clear progression patterns

**Warning Signs**:
- Seedlings aging without promotion
- Growing content stuck for 6+ months
- Evergreen content frequently edited
- Missing review dates

### Tracking Template

```yaml
---
lifecycle_metrics:
  seedlings: 12
  growing: 8
  evergreen: 25
  references: 15
  archived: 30

  promotion_rate: 0.6  # seedlings promoted in last month
  stability_index: 0.9  # evergreen unchanged in 6 months
  review_compliance: 0.8  # reviews completed on time
---
```

## Domain-Specific Patterns

### Knowledge Management (memory-palace)

```yaml
# Progression influenced by palace placement
seedling → growing → evergreen
   ↓          ↓          ↓
 garden    district    palace
```

### Specifications (spec-kit)

```yaml
# Maturity tied to implementation phase
seedling (idea) → growing (draft) → evergreen (approved)
   ↓                  ↓                   ↓
planning        implementation        production
```

### Configuration (sanctum)

```yaml
# Versioned templates
reference (v1.0) → reference (v1.1) → archive (v1.0)
   ↓                   ↓                    ↓
 active             active             deprecated
```

## Automation Examples

### Auto-Promote Script

```python
from datetime import datetime, timedelta
from pathlib import Path
import yaml

def check_promotion_criteria(filepath: Path) -> str | None:
    """Check if content meets promotion criteria."""
    with open(filepath) as f:
        content = f.read()
        frontmatter = yaml.safe_load(content.split('---')[1])

    maturity = frontmatter.get('maturity')
    created = datetime.fromisoformat(frontmatter.get('created'))
    updated = datetime.fromisoformat(frontmatter.get('updated', created))
    age_days = (datetime.now() - created).days

    # Seedling → Growing criteria
    if maturity == 'seedling' and age_days > 14:
        # Check access count, connections, etc.
        return 'growing'

    # Growing → Evergreen criteria
    if maturity == 'growing' and age_days > 90:
        days_since_update = (datetime.now() - updated).days
        if days_since_update > 30:
            return 'evergreen'

    return None
```

### Review Reminder

```python
def generate_review_list() -> list[Path]:
    """Generate list of content due for review."""
    due_for_review = []

    for filepath in Path('.').rglob('*.md'):
        with open(filepath) as f:
            frontmatter = extract_frontmatter(f.read())

        review_date = frontmatter.get('review_after') or frontmatter.get('review_date')
        if review_date and datetime.fromisoformat(review_date) <= datetime.now():
            due_for_review.append(filepath)

    return sorted(due_for_review, key=lambda p: frontmatter_date(p))
```

## Best Practices

1. **Regular Reviews**: Don't let content stagnate
2. **Clear Criteria**: Document promotion decisions
3. **Archive Boldly**: Remove outdated content decisively
4. **Track Metrics**: Monitor lifecycle health
5. **Automate Reminders**: Don't rely on memory
6. **Explicit Transitions**: Log why content was promoted/demoted
7. **Preserve History**: Archive rather than delete
8. **Clean References**: Update links when archiving

## Integration

Use lifecycle management in your domain:

```python
from leyline.storage_templates import (
    check_promotion_eligibility,
    promote_content,
    archive_content,
    generate_review_schedule
)

# Check if content ready for promotion
if check_promotion_eligibility('async-patterns.md'):
    promote_content('async-patterns.md', to='evergreen')

# Schedule reviews
schedule = generate_review_schedule(maturity='growing', interval='quarterly')
```
