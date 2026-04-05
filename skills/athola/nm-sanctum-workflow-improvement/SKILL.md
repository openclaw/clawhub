---
name: workflow-improvement
description: Retrospective evaluation and improvement of skills, agents, commands, and hooks
version: 1.8.1
triggers:
  - workflow
  - retrospective
  - efficiency
  - commands
  - agents
  - skills
  - hooks
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.sanctum:shared"]}}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Workflow Improvement

## When To Use
Use this skill after running a command or completing a short session slice where execution felt slow, confusing, repetitive, or fragile.

This skill focuses on improving the *workflow assets* (skills, agents, commands, hooks) that were involved, not on feature work itself.

## When NOT To Use

- Implementing features - focus on feature work first

## Required TodoWrite Items
1. `fix-workflow:context-gathered`
2. `fix-workflow:slice-captured`
3. `fix-workflow:workflow-recreated`
4. `fix-workflow:improvements-generated`
5. `fix-workflow:plan-agreed`
6. `fix-workflow:changes-implemented`
7. `fix-workflow:validated`
8. `fix-workflow:lesson-stored`

## Step 0: Gather Improvement Context (`context-gathered`)

Before analyzing the current session, gather existing improvement data:

### 0.1: Check Skill Execution History

Query memory-palace logs for recent performance issues:

```bash
# Recent failures (last 7 days)
/skill-logs --failures-only --last 7d

# Performance metrics for involved plugins
pensive:skill-review --plugin sanctum --recommendations
```

**Capture:**
- Skills with stability_gap > 0.3
- Recent failure patterns and error messages
- Performance degradation trends

### 0.2: Query Knowledge Base

Search for previously captured workflow lessons:

```bash
# If memory-palace review-chamber is available
/review-room search "workflow improvement" --room lessons
/review-room search "efficiency" --room patterns
```

**Look for:**
- Similar workflow issues from past PRs
- Recurring patterns in workflow failures
- Architectural decisions affecting workflows

### 0.3: Check Git History

Identify recurring issues through commit patterns:

```bash
git log --oneline --grep="improve\|fix\|optimize" --since="30 days ago" \
  -- plugins/sanctum/skills/ plugins/sanctum/commands/

# Look for unstable components (frequent fixes)
git log --oneline --since="30 days ago" --follow \
  -- plugins/sanctum/skills/workflow-improvement/
```

**Extract:**
- Components with frequent bug fixes (instability signals)
- Patterns in improvement commit messages
- Recurring issue themes

**Output Format:**
```markdown
## Improvement Context

### Skill Performance Issues
- sanctum:workflow-improvement: stability_gap 0.35 (5 failures in 7 days)
- Error pattern: "Missing validation in Step 2"

### Knowledge Base Lessons
- PR #42 lesson: "Workflow validation should happen at start, not end"
- Pattern: Early validation reduces iteration time by 30%

### Git History Insights
- workflow-improvement skill: 8 commits in 30 days (instability signal)
- Recurring theme: "Add missing prerequisite checks"
```

## Step 1: Capture the Session Slice (`slice-captured`)

Identify the **most recent command or session slice** in the current context window and capture:
- **Trigger**: What command / request started it (include the literal `/command` if present)
- **Goal**: What "done" meant for the user
- **Artifacts touched**: Skills, agents, commands, hooks (names + file paths)
- **Evidence**: Key tool calls / errors / retries that indicate inefficiency
- **Context from Step 0**: Reference any relevant patterns from improvement context

If the slice is ambiguous, pick the most recent *complete* attempt and state the exact boundary you chose.

## Step 2: Recreate the Workflow (`workflow-recreated`)

Reconstruct the workflow as a numbered list of 5 to 20 steps, identifying inputs, branch points for decisions, and outputs such as file changes or state modifications. During this reconstruction, identify specific friction points that reduce efficiency. These often include repeated steps or redundant tool calls, as well as missing guardrails where validation occurs too late or prerequisites are unclear. Other common issues are a lack of automation for tasks that should be scripted, and discoverability gaps caused by confusing naming conventions.

**Cross-reference with Step 0 context:**
- Are friction points matching known failure patterns?
- Do repeated steps align with git history themes?
- Are missing guardrails mentioned in review-chamber lessons?

## Step 3: Generate Improvements (`improvements-generated`)

Generate 3 to 5 distinct improvement approaches and score each on impact, complexity, reversibility, and consistency with existing sanctum patterns. The scoring should specifically address whether the change prevents the recurrence of patterns identified in Step 0. Prioritize improvements that address components with a high stability gap (greater than 0.3) or recurring issues found in the git history. You should also incorporate lessons from the review-chamber and aim to reduce failure modes identified in the skill logs. Prefer small, high-use changes such as tightening a skill's exit criteria, adding missing command options, improving hook guardrails for better observability, or splitting overloaded commands into clearer phases.

## Step 4: Agree on a Plan (`plan-agreed`)

Choose 1 approach and define:
- Acceptance criteria (“substantive difference”)
- Files to change
- Validation commands to run
- Out-of-scope items to defer

Keep the plan bounded: aim for ≤ 5 files changed unless the workflow truly spans more.

## Step 5: Implement (`changes-implemented`)

Apply changes following sanctum conventions:
- Keep naming consistent across `commands/`, `agents/`, `skills/`, `hooks/`
- Prefer documentation-first improvements if ambiguity was the primary issue
- If behavior changes, add/adjust tests in `plugins/sanctum/tests/`

## Step 6: Validate Substantive Improvement (`validated`)

Validation should include at least 2 of:
- Plugin validators / unit tests passing (targeted)
- Re-running the minimal workflow reproduction with fewer steps or less manual work
- A clear reduction in failure modes (e.g., earlier validation, clearer options)

Record the before/after comparison as *metrics*, not prose:
- Step count reduction
- Tool call reduction
- Errors avoided (what would have failed before)
- Duration improvement (if measurable)

### Metrics Comparison Template

```markdown
## Validation Results

### Before Improvement
- Step count: 15
- Tool calls: 23
- Failure points: 3
- Duration: ~8 minutes
- Manual interventions: 5

### After Improvement
- Step count: 11 (-4, -27%)
- Tool calls: 17 (-6, -26%)
- Failure points: 0 (-3, -100%)
- Duration: ~5 minutes (-37%)
- Manual interventions: 2 (-3, -60%)

### Verification
[E1] Command: `python3 plugins/sanctum/scripts/test_workflow.py`
Output: All tests passed (0.5s)

[E2] Command: `/validate-plugin sanctum`
Output: No issues found
```

## Step 7: Close the Loop (Store Lessons)

After validation, capture the improvement for future reference:

### 7.1: Update Git History

Commit with descriptive message that future searches will find:

```bash
git add <changed-files>
git commit -m "improve(sanctum): <component> - <specific fix>

Addresses recurring issue: <pattern from Step 0>
Reduces <metric> by <percentage>

Evidence: stability_gap reduced from 0.35 to 0.12

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

### 7.2: Post Tooling Learnings to Discussions (Preferred)

Observations about night-market tooling (skill behavior, agent
coordination, hook timing, command UX) belong in
https://github.com/athola/claude-night-market/discussions,
not local memory. Always target the night-market repo
regardless of which repo you are currently working in.

```bash
# Post to night-market Learnings category
# See fix-pr Step 6.7 for the full GraphQL pattern
# targeting athola/claude-night-market explicitly
```

> Repo-specific learnings stay in the current repo. Tooling
> learnings always go to
> https://github.com/athola/claude-night-market/discussions
> so the framework can improve.

### 7.3: Capture Lesson in Memory Palace (Optional, Local Only)

If the improvement addresses a repo-specific pattern (not
tooling), store it locally:

```bash
# Store in review-chamber lessons
/review-room capture --room lessons --title "Workflow: <pattern name>"
```

### 7.4: Update Improvement Metrics

Track the improvement's impact:

```bash
# Check post-improvement stability
pensive:skill-review --skill sanctum:<component> --recommendations
```

This creates a feedback loop where future `/fix-workflow` and `/update-plugins` runs will reference this lesson.

## Supporting Modules

- [Auto issue creation](modules/auto-issue-creation.md) - patterns for automatically creating GitHub issues from deferred items

## Troubleshooting

### Common Issues

If a command is not found, confirm that all dependencies are installed and accessible in your PATH. For permission errors, check file system permissions and run the command with appropriate privileges. If you encounter unexpected behavior, enable verbose logging using the `--verbose` flag to capture more detailed execution data.
