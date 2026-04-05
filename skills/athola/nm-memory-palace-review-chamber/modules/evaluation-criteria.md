# Evaluation Criteria Module

Detailed criteria for evaluating whether PR review findings are worth capturing.

## Evaluation Framework

Based on memory-palace:knowledge-intake, adapted for PR reviews.

### Scoring Summary

| Criterion | Weight | Max Points |
|-----------|--------|------------|
| Novelty | 25% | 25 |
| Applicability | 30% | 30 |
| Durability | 20% | 20 |
| Connectivity | 15% | 15 |
| Authority | 10% | 10 |
| **Total** | 100% | 100 |

### Capture Thresholds

| Score Range | Action |
|-------------|--------|
| 80-100 | **Evergreen**: Capture immediately, permanent retention |
| 60-79 | **Valuable**: Capture, standard retention |
| 40-59 | **Reference**: Consider manual capture |
| 0-39 | **Skip**: Not worth capturing |

## Detailed Criteria

### 1. Novelty (25 points)

**Question**: Is this knowledge new to the project?

| Score | Description |
|-------|-------------|
| 25 | Completely novel - first time this pattern/decision documented |
| 20 | Mostly novel - adds significant new context |
| 15 | Moderate novelty - extends existing knowledge |
| 10 | Low novelty - mostly overlaps with existing |
| 5 | Minimal novelty - slight variation |
| 0 | Duplicate - already captured |

**Examples**:

```markdown
## High Novelty (25 points)
- First authentication architecture decision
- New error handling pattern for async code
- Security vulnerability pattern not seen before

## Moderate Novelty (15 points)
- Alternative approach to existing pattern
- Additional context for documented decision
- Edge case for known pattern

## Low/No Novelty (0-5 points)
- Same bug found in different file
- Style preference already in standards
- Known limitation documented elsewhere
```

### 2. Applicability (30 points)

**Question**: Will this affect future development?

| Score | Description |
|-------|-------------|
| 30 | Core domain - affects all future work in area |
| 25 | High applicability - affects most related PRs |
| 20 | Moderate - affects some future work |
| 15 | Limited - specific to few use cases |
| 10 | Narrow - rarely applicable |
| 0 | One-off - unique circumstance |

**Indicators of High Applicability**:

```markdown
## High Applicability Signals
- Affects shared/core code paths
- Relates to API contracts
- Security or performance critical
- Multiple files/components affected
- Frequently modified code area

## Low Applicability Signals
- One-off migration code
- Deprecated feature
- External dependency quirk
- Test-only concern
- Configuration edge case
```

### 3. Durability (20 points)

**Question**: Is this architectural or tactical?

| Score | Description |
|-------|-------------|
| 20 | Architectural - fundamental design choice |
| 15 | Semi-permanent - likely to last years |
| 10 | Medium-term - relevant for months |
| 5 | Short-term - may change soon |
| 0 | Tactical - temporary workaround |

**Classification Guide**:

```markdown
## Architectural (20 points)
- Technology choices (JWT vs sessions)
- API design decisions
- Data model structures
- Security architecture
- Performance strategies

## Semi-permanent (15 points)
- Coding conventions
- Error handling patterns
- Testing strategies
- Documentation standards

## Tactical (0-5 points)
- Bug fixes without pattern
- Formatting changes
- Temporary workarounds
- Dependency updates
- Revert commits
```

### 4. Connectivity (15 points)

**Question**: Does this link to other knowledge?

| Score | Description |
|-------|-------------|
| 15 | Highly connected - links 3+ existing entries |
| 10 | Connected - links 1-2 entries |
| 5 | Potentially connected - could link to entries |
| 0 | Isolated - standalone knowledge |

**Connection Types**:

```markdown
## Strong Connections (15 points)
- References existing ADR
- Extends documented pattern
- Contradicts (needs resolution!) existing entry
- Builds on prior PR decision

## Moderate Connections (10 points)
- Related to existing topic
- Same code area as prior entries
- Similar category/tags

## Weak/No Connections (0-5 points)
- New domain area
- No related entries exist
- Standalone utility
```

### 5. Authority (10 points)

**Question**: Who provided this knowledge?

| Score | Description |
|-------|-------------|
| 10 | Domain expert + senior reviewer |
| 7 | Domain expert OR senior reviewer |
| 5 | Experienced team member |
| 3 | Regular contributor |
| 0 | Unknown/external |

**Authority Signals**:

```markdown
## High Authority (10 points)
- Code owner reviewed
- Domain expert participated
- Tech lead approved
- Security team involved (for security findings)

## Moderate Authority (5-7 points)
- Experienced team member
- Prior contributor to area
- Cross-team reviewer

## Lower Authority (0-3 points)
- New team member (may still be valid!)
- External contributor
- Bot/automated review
```

## Special Cases

### Always Capture

Some findings should always be captured regardless of score:

```markdown
## Mandatory Capture
- Security vulnerabilities with fix
- Breaking API changes
- Performance regression causes
- Data loss scenarios
- Production incident learnings
```

### Never Capture

Some findings should never be captured:

```markdown
## Skip Always
- Typo fixes
- Import ordering
- Whitespace changes
- Dependency version bumps (unless significant)
- Auto-formatter changes
```

### Human Override

Allow manual override of scoring:

```markdown
## Force Capture
/review-room capture 42 --force --room decisions
# Captures even if score < 60

## Force Skip
/review-room capture 42 --skip "duplicate of #38"
# Explicitly skip with reason
```

## Scoring Examples

### Example 1: JWT Authentication Decision

```yaml
Finding:
  title: "Chose JWT over server-side sessions"
  severity: BLOCKING
  category: security/architecture
  context: "Reviewer asked about sessions, author explained scaling needs"

Scoring:
  novelty: 25  # First auth architecture decision
  applicability: 30  # Affects all auth code
  durability: 20  # Architectural choice
  connectivity: 10  # Links to security ADR
  authority: 10  # Tech lead + security reviewer

Total: 95/100 → Capture to decisions/ (Evergreen)
```

### Example 2: Missing Null Check

```yaml
Finding:
  title: "Add null check before array access"
  severity: IN-SCOPE
  category: bug
  context: "Could cause NPE in edge case"

Scoring:
  novelty: 5   # Common pattern
  applicability: 10  # Specific function
  durability: 5   # Tactical fix
  connectivity: 0   # Isolated
  authority: 5   # Regular reviewer

Total: 25/100 → Skip (tactical fix)
```

### Example 3: Error Response Pattern

```yaml
Finding:
  title: "Standardize API error response format"
  severity: IN-SCOPE
  category: api/convention
  context: "Third time we've discussed this, let's document"

Scoring:
  novelty: 20  # Formalizing informal convention
  applicability: 25  # All API endpoints
  durability: 15  # Convention, may evolve
  connectivity: 10  # Links to API docs
  authority: 7   # Domain expert

Total: 77/100 → Capture to standards/ (Valuable)
```
