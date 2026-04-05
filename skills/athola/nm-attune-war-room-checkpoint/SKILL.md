---
name: war-room-checkpoint
description: |
  Assess decision reversibility and risk at critical checkpoints to determine whether full War Room escalation is warranted
version: 1.8.1
triggers:
  - checkpoint
  - embedded
  - escalation
  - reversibility
  - inline
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/attune", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.attune:war-room"]}}}
source: claude-night-market
source_plugin: attune
---

> **Night Market Skill** — ported from [claude-night-market/attune](https://github.com/athola/claude-night-market/tree/master/plugins/attune). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# War Room Checkpoint Skill

Lightweight inline assessment for determining whether a decision point within a command warrants War Room escalation.

## Table of Contents

1. [Purpose](#purpose)
2. [When Commands Should Invoke This](#when-commands-should-invoke-this)
3. [Invocation Pattern](#invocation-pattern)
4. [Checkpoint Flow](#checkpoint-flow)
5. [Confidence Calculation](#confidence-calculation)
6. [Profile Thresholds](#profile-thresholds)
7. [Output Format](#output-format)
8. [Examples](#examples)

## Verification

Run `make test-checkpoint` to verify checkpoint logic works correctly after changes.

## Purpose

This skill is **not invoked directly by users**. It is called by other commands (e.g., `/do-issue`, `/pr-review`) at critical decision points to:

1. Calculate Reversibility Score (RS) for the current context
2. Determine if full War Room deliberation is needed
3. Return either a quick recommendation (express) or escalate to full War Room

## When Commands Should Invoke This

| Command | Trigger Conditions |
|---------|-------------------|
| `/do-issue` | 3+ issues, dependency conflicts, overlapping files |
| `/pr-review` | >3 blocking issues, architecture changes, ADR violations |
| `/architecture-review` | ADR violations, high coupling, boundary violations |
| `/fix-pr` | Major scope, conflicting reviewer feedback |

## Invocation Pattern

```markdown
Skill(attune:war-room-checkpoint) with context:
  - source_command: "{calling_command}"
  - decision_needed: "{human_readable_question}"
  - files_affected: [{list_of_files}]
  - issues_involved: [{issue_numbers}] (if applicable)
  - blocking_items: [{type, description}] (if applicable)
  - conflict_description: "{summary}" (if applicable)
  - profile: "default" | "startup" | "regulated" | "fast" | "cautious"
```

## Checkpoint Flow

### Step 1: Context Analysis

Analyze the provided context to extract:
- Scope of change (files, modules, services affected)
- Stakeholders impacted
- Conflict indicators
- Time pressure signals

### Step 2: Reversibility Assessment

Calculate RS using the 5-dimension framework:

| Dimension | Assessment Question |
|-----------|-------------------|
| Reversal Cost | How hard to undo this decision? |
| Time Lock-In | Does this crystallize immediately? |
| Blast Radius | How many components/people affected? |
| Information Loss | Does this close off future options? |
| Reputation Impact | Is this visible externally? |

Score each 1-5, calculate RS = Sum / 25.

### Step 3: Mode Selection

Apply profile thresholds to determine mode:

```
if RS <= profile.express_ceiling:
    mode = "express"
elif RS <= profile.lightweight_ceiling:
    mode = "lightweight"
elif RS <= profile.full_council_ceiling:
    mode = "full_council"
else:
    mode = "delphi"
```

### Step 4: Response Generation

#### Express Mode (RS <= threshold)

Return immediately with recommendation:

```yaml
response:
  should_escalate: false
  selected_mode: "express"
  reversibility_score: {rs}
  decision_type: "Type 2"
  recommendation: "{quick_recommendation}"
  rationale: "{brief_explanation}"
  confidence: 0.9
  requires_user_confirmation: false
```

#### Escalate Mode (RS > threshold)

Invoke full War Room and return results:

```yaml
response:
  should_escalate: true
  selected_mode: "{lightweight|full_council|delphi}"
  reversibility_score: {rs}
  decision_type: "{Type 1B|1A|1A+}"
  war_room_session_id: "{session_id}"
  orders: ["{order_1}", "{order_2}"]
  rationale: "{war_room_rationale}"
  confidence: {calculated_confidence}
  requires_user_confirmation: {true_if_confidence_low}
```

## Confidence Calculation

For escalated decisions, calculate confidence for auto-continue:

```
confidence = 1.0
- 0.10 * dissenting_view_count
- 0.20 if voting_margin < 0.3
- 0.15 if RS > 0.80
- 0.10 if novel_domain
- 0.10 if compound_decision
+ 0.20 if unanimous (cap at 1.0)

requires_user_confirmation = (confidence <= 0.8)
```

## Profile Thresholds

| Profile | Express | Lightweight | Full Council | Use Case |
|---------|---------|-------------|--------------|----------|
| default | 0.40 | 0.60 | 0.80 | Balanced |
| startup | 0.55 | 0.75 | 0.90 | Move fast |
| regulated | 0.25 | 0.45 | 0.65 | Compliance |
| fast | 0.50 | 0.70 | 0.90 | Speed priority |
| cautious | 0.30 | 0.50 | 0.70 | Higher stakes |

### Command-Specific Adjustments

| Command | Adjustment | Rationale |
|---------|-----------|-----------|
| do-issue (3+ issues) | -0.10 | Higher risk with multiple issues |
| pr-review (strict mode) | -0.15 | Strict mode = higher scrutiny |
| architecture-review | -0.05 | Architecture inherently consequential |

## Output Format

### For Calling Command

Return a structured response that the calling command can act on:

```markdown
## Checkpoint Response

**Source**: {source_command}
**Decision**: {decision_needed}

### Assessment
- **RS**: {reversibility_score} ({decision_type})
- **Mode**: {selected_mode}
- **Escalated**: {yes|no}

### Recommendation
{recommendation_or_orders}

### Control Flow
- **Confidence**: {confidence}
- **Auto-continue**: {yes|no}
{user_prompt_if_needed}
```

## Integration Notes

### Calling Commands Should

1. Check checkpoint response's `requires_user_confirmation`
2. If true: present confirmation prompt and wait
3. If false: continue with `orders` or `recommendation`
4. Log checkpoint to audit trail

### Failure Handling

If checkpoint invocation fails:
- Log warning with context
- Continue command execution without checkpoint
- Do NOT block the user's workflow

## Audit Trail

Checkpoints are logged to:
```
~/.claude/memory-palace/strategeion/checkpoints/{date}/{checkpoint-id}.json
```

Each file contains a `CheckpointEntry` with: `checkpoint_id`, `session_id`, `phase`,
`action`, `reversibility_score`, `dimensions`, `confidence`, `files_affected`, and
`requires_user_confirmation`.

After a war room session completes and `persist_session()` is called, an audit report
is written automatically to:
```
~/.claude/memory-palace/strategeion/war-table/{session-id}/audit-report.json
```

The report consolidates: all checkpoints for the session, the expert panel, voting
summary with unanimity score, escalation history, final decision and rationale, and
a Merkle-DAG integrity verification block. The verification recomputes every node
hash against the stored values so any tampering with deliberation content is
detectable.

Use `AuditTrailManager` from `scripts.war_room.audit_trail` to query checkpoints or
generate reports programmatically:

```python
from scripts.war_room.audit_trail import AuditTrailManager
manager = AuditTrailManager()
checkpoints = manager.get_checkpoints("war-room-20260303-100000")
audited = manager.list_audited_sessions()
```

## Examples

### Example 1: Low RS (Express)

**Input**:
```yaml
source_command: "do-issue"
decision_needed: "Execution order for issues #101, #102"
issues_involved: [101, 102]
files_affected: ["src/utils/helper.py", "tests/test_helper.py"]
```

**Assessment**:
- Reversal Cost: 1 (can revert commits)
- Time Lock-In: 1 (no deadline)
- Blast Radius: 1 (single utility module)
- Information Loss: 1 (all options preserved)
- Reputation Impact: 1 (internal)

**RS**: 0.20 (Type 2)

**Response**:
```yaml
should_escalate: false
selected_mode: "express"
recommendation: "Execute in parallel - no dependencies detected"
confidence: 0.95
requires_user_confirmation: false
```

### Example 2: High RS (Escalate)

**Input**:
```yaml
source_command: "pr-review"
decision_needed: "Review verdict for PR #456"
blocking_items:
  - {type: "architecture", description: "New service without ADR"}
  - {type: "breaking", description: "API contract change"}
  - {type: "security", description: "Auth flow modification"}
  - {type: "scope", description: "Unrelated payment refactor"}
files_affected: ["src/auth/", "src/api/", "src/payment/", "src/services/new/"]
```

**Assessment**:
- Reversal Cost: 4 (multi-service impact)
- Time Lock-In: 3 (PR deadline pressure)
- Blast Radius: 4 (cross-team impact)
- Information Loss: 3 (some paths closing)
- Reputation Impact: 2 (internal review)

**RS**: 0.64 (Type 1A)

**Response**:
```yaml
should_escalate: true
selected_mode: "full_council"
war_room_session_id: "war-room-20260125-143025"
orders:
  - "Split PR: auth changes separate from payment refactor"
  - "Require ADR for new service before merge"
  - "API change: add migration path, not blocking"
confidence: 0.75
requires_user_confirmation: true
```

## Related Skills

- `Skill(attune:war-room)` - Full War Room deliberation
- `Skill(attune:war-room)/modules/reversibility-assessment.md` - RS framework

## Related Commands

- `/attune:war-room` - Standalone War Room invocation
- `/do-issue` - Issue implementation (uses this checkpoint)
- `/pr-review` - PR review (uses this checkpoint)
- `/architecture-review` - Architecture review (uses this checkpoint)
- `/fix-pr` - PR fix (uses this checkpoint)
