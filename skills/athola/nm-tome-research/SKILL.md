---
name: research
description: Multi-source research across code, discourse, and academic channels
version: 1.8.1
triggers:
  - research
  - synthesis
  - multi-source
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/tome", "emoji": "\ud83e\udd9e"}}
source: claude-night-market
source_plugin: tome
---

> **Night Market Skill** — ported from [claude-night-market/tome](https://github.com/athola/claude-night-market/tree/master/plugins/tome). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Research Session Orchestrator

Run a full multi-source research session: classify the
domain, dispatch parallel agents, synthesize findings,
and output a formatted report.

## Workflow

### Step 1: Classify Domain

Run the domain classifier on the topic:

```python
from tome.scripts.domain_classifier import classify
result = classify(topic)
# result.domain, result.triz_depth, result.channel_weights
```

If confidence < 0.6, ask the user to confirm or override
the domain classification before proceeding.

### Step 2: Plan Research

```python
from tome.scripts.research_planner import plan
research_plan = plan(result)
# research_plan.channels, research_plan.weights, research_plan.triz_depth
```

### Step 3: Create Session

```python
from tome.session import SessionManager
mgr = SessionManager(Path.cwd())
session = mgr.create(topic, result.domain, result.triz_depth, research_plan.channels)
```

### Step 4: Dispatch Agents

Launch research agents in parallel using the Agent tool.
Use this mapping:

| Channel | Agent Type | Prompt Includes |
|---------|-----------|-----------------|
| code | `tome:code-searcher` | topic |
| discourse | `tome:discourse-scanner` | topic, domain, subreddits |
| academic | `tome:literature-reviewer` | topic, domain |
| triz | `tome:triz-analyst` | topic, domain, triz_depth |

**Rules:**
- Always dispatch code and discourse agents
- Dispatch academic agent only if "academic" is in
  research_plan.channels
- Dispatch triz agent only if "triz" is in
  research_plan.channels AND triz_depth != "light"
- Dispatch all eligible agents in a SINGLE message
  (parallel, not sequential)

Each agent prompt must include:
1. The topic string
2. The domain classification
3. Any channel-specific context (subreddits for discourse,
   triz_depth for triz)
4. Instruction to return findings as JSON

### Step 5: Collect and Synthesize

After all agents return:

1. Parse each agent's findings into Finding objects
2. Merge using `tome.synthesis.merger.merge_findings()`
3. Rank using `tome.synthesis.ranker.rank_findings()`

### Step 6: Generate Output

```python
from tome.output.report import format_report, format_brief, format_transcript

# Default to report format
output = format_report(session)

# Save to docs/research/
output_path = f"docs/research/{session.id}-{slug}.md"
```

Save the session state:
```python
mgr.save(session)
```

### Step 7: Present Results

Display a brief summary to the user:
- Number of findings per channel
- Top 3 findings by relevance
- Path to saved report

Then offer interactive refinement:
"Use `/tome:dig \"subtopic\"` to explore specific areas."

## Error Handling

- If an agent fails, continue with remaining agents
- If all agents fail, report the error and suggest
  manual research approaches
- If synthesis produces 0 findings, state this clearly
  rather than generating an empty report
- Save session state even on partial failure

## Output Format Selection

| Flag | Format | Function |
|------|--------|----------|
| (default) | report | `format_report()` |
| `--format brief` | brief | `format_brief()` |
| `--format transcript` | transcript | `format_transcript()` |
