---
name: mecw-principles
description: |
  Maximum Effective Context Window (MECW) theory, the 50% context rule,
  and hallucination prevention fundamentals.
category: conservation
---

# MECW Principles Module

## Overview

This module covers the theoretical foundations of Maximum Effective Context Window (MECW) principles, including the critical 50% rule that prevents hallucinations.

## The 50% Context Rule

**Core Principle**: Never use more than 50% of the *effective* context window for input content.

> **Important (Claude Code 2.1.7+)**: The effective context window is smaller than the total context window because it reserves space for max output tokens. When monitoring context usage, the 50% rule applies to the effective context, not the total. The status line's `used_percentage` field reports usage against the effective context.

### Why 50%?

| Context Usage | Effect on Model |
|---------------|-----------------|
| < 30% | Optimal performance, high accuracy |
| 30-50% | Good performance, slight accuracy degradation |
| 50-70% | Degraded performance, increased hallucination risk |
| > 70% | Severe degradation, high hallucination probability |

### The Physics of Context Pressure

```python
def calculate_context_pressure(current_tokens, max_tokens):
    """
    Context pressure increases non-linearly as usage approaches limits.
    """
    usage_ratio = current_tokens / max_tokens

    if usage_ratio < 0.3:
        return "LOW"      # Plenty of headroom
    elif usage_ratio < 0.5:
        return "MODERATE" # Within MECW limits
    elif usage_ratio < 0.7:
        return "HIGH"     # Exceeding MECW, risk zone
    else:
        return "CRITICAL" # Severe hallucination risk
```

## Hallucination Prevention

### Root Cause
When context exceeds MECW limits:
1. Model attention becomes diffuse across too many tokens
2. Earlier context gets "forgotten" or compressed
3. Model compensates by generating plausible-sounding but incorrect content

### Prevention Strategies

1. **Early Detection**: Monitor context usage continuously
2. **Proactive Compression**: Summarize before hitting limits
3. **Strategic Delegation**: Use subagents for complex workflows
4. **Progressive Disclosure**: Load only needed information

## Practical Application

### Monitoring Context Usage

**Native Visibility (Claude Code 2.0.65+)**: The status line displays context window utilization in real-time, providing immediate visibility into your current usage.

**Improved Accuracy (2.0.70+)**: The `current_usage` field in the status line input enables precise context percentage calculations, eliminating estimation variance.

**Improved Visualization (2.0.74+)**: The `/context` command now groups skills and agents by source plugin, showing:
- Plugin organization and context contribution
- Slash commands in use
- Sorted token counts for optimization
- Better visibility into which plugins consume context

This complements our MECW thresholds:
- **Status line** shows accurate current usage %
- **/context command** shows detailed breakdown by plugin (2.0.74+)

### 1M Context Window (GA, March 2025)

1M tokens is generally available for Opus 4.6 and
Sonnet 4.6 at standard pricing (no long-context premium).

**Default on Max/Team/Enterprise (2.1.75+)**: Opus 4.6
now defaults to 1M context on Max, Team, and Enterprise
plans with no extra usage required. Previously, the 1M
window required extra usage credits. Opt out with
`CLAUDE_CODE_DISABLE_1M_CONTEXT=1`. Media capacity
expands to 600 images or PDF pages (was 100).

MECW thresholds scale proportionally:

| Context Window | 30% (Optimal) | 50% (MECW Limit) | 80% (Emergency) |
|---------------|---------------|-------------------|------------------|
| **200K** | 60K tokens | 100K tokens | 160K tokens |
| **1M** | 300K tokens | 500K tokens | 800K tokens |

> **Note**: The statusline reads `context_window_size`
> dynamically from the Claude Code JSON input, so it
> adapts automatically to whatever window the model
> reports (200K for Sonnet/Haiku, 1M for Opus).

#### Why Conservation Still Matters at 1M

A 1M window full of repeated tool outputs and stale file
reads performs worse than 200K of relevant, structured
state. The performance dropoff at 800-900K tokens still
exists even if less dramatic. Additionally:

- **Quota burn**: Larger context = more input tokens per
  turn = faster quota consumption. Surgical reads and
  selective loading protect your budget.
- **Attention dilution**: Model attention spreads across
  more tokens. Earlier context gets progressively less
  weight. Conservation keeps signal-to-noise high.
- **Agentic compounding**: Parallel agents each accumulate
  tool outputs independently. 5 agents at 200K each can
  collectively burn 1M in tokens while the parent context
  stays lean. Use git worktrees to isolate agent state.

#### The Plan-Clear-Implement Pattern

The 1M window's greatest benefit is enabling large
implementation plans without compaction interruptions:

1. **Plan**: Construct the full implementation plan
   (built-in planning, spec-kit, or similar)
2. **Clear**: `/compact` or `/clear` to start with a
   clean context (built-in planning does this
   automatically before implementation)
3. **Implement**: Execute the plan without compaction,
   maintaining full context of what was done and why
4. **Iterate**: Make follow-up changes while still on
   the same topic with the same context
5. **Repeat**: New plan, new clear, new implementation

This pattern avoids the old cycle of compact, lose
context, re-explore code, repeat instructions. With
discipline, automatic compaction becomes rare.

Server-side compaction (Opus 4.6) provides an additional
safety net: the API automatically summarizes earlier
conversation parts when approaching limits. This does not
replace MECW discipline but reduces catastrophic failure
risk.

### Tool Result Disk Persistence (2.1.51+)

Tool results larger than **50K characters** are now
persisted to disk instead of kept inline in the
conversation context. Previously the threshold was 100K.
This means large tool outputs (file reads, grep results,
web fetches) consume less context window space. Factor
this into MECW calculations: tool-heavy workflows now
have better context longevity than before.

### Compaction Image Preservation (2.1.70+)

Compaction now preserves images in the summarizer
request, allowing prompt cache reuse across compaction
boundaries. This makes compaction faster and cheaper,
especially for image-heavy sessions (screenshots,
diagrams). Previously, images were dropped during
compaction, busting the prompt cache.

### Read Tool Image Safety (2.1.71+)

The Read tool previously put oversized images into
context when image processing failed, breaking
subsequent turns in long image-heavy sessions. Fixed
in 2.1.71: failed image processing no longer injects
oversized data into context. This protects MECW
compliance in sessions that read many images.

### Prompt Cache Fix (2.1.72+)

Fixed prompt cache invalidation in SDK `query()` calls,
reducing input token costs up to 12x for workflows
using the Agent SDK or programmatic Claude Code
invocations. Sessions with heavy SDK usage benefit
most from this fix.

### Resume Token Savings (2.1.70+)

Skill listings are no longer re-injected on every
`--resume` invocation, saving ~600 tokens per resume.
This improves context efficiency for workflows that
frequently resume sessions.

### `/context` Actionable Suggestions (2.1.74+)

The `/context` command now identifies context-heavy
tools, memory bloat, and capacity warnings with specific
optimization tips. Instead of just showing a breakdown,
it recommends actions such as compacting to reclaim
tokens, disabling unused MCP servers, or clearing stale
context. This makes `/context` a diagnostic tool that
directly supports MECW optimization workflows.

Use `/context` at natural breakpoints to get targeted
recommendations rather than manually analyzing the
breakdown.

### Output Style Prompt Cache Improvement (2.1.73+)

`/output-style` is deprecated; use `/config` instead.
Output style is now fixed at session start, preventing
mid-session style changes from invalidating the prompt
cache. This improves cache hit rates for sessions that
previously changed output style between turns. Set your
preferred output style via `/config` before starting
work to maximize cache reuse throughout the session.

### `/compact` Context Exceeded Fix (2.1.85+)

Fixed `/compact` failing when the conversation is too
large for the compact request itself to fit within the
remaining context. Previously a deadlock: compaction
needed most when it could not run. Now handles the edge
case, preventing forced `/clear` with total context loss.

### MCP Tool Description Cap (2.1.84+)

MCP tool descriptions and server instructions capped at
2KB to prevent OpenAPI-generated servers from bloating
context. Duplicate servers (local + claude.ai connectors)
are deduplicated: local config wins. This protects MECW
compliance for sessions using many MCP servers.

### Idle-Return Prompt (2.1.84+)

When returning after 75+ minutes of inactivity, Claude
Code nudges the user to `/clear`. Sessions idle that
long have expired prompt caches, so continued use wastes
tokens re-caching stale context. The nudge supports the
Plan-Clear-Implement pattern.

### System-Prompt Caching Fix (2.1.84+)

Global system-prompt caching now works when ToolSearch
is enabled, including for users with MCP tools. This
improves cache hit rates and reduces input token costs
for sessions loading deferred tools.

### MEMORY.md 25KB Truncation (2.1.83+)

MEMORY.md auto-memory loads the first 200 lines or 25KB
(whichever first) per session. Content beyond the limit
is not injected. Move detailed notes to separate topic
files that are read on demand. CLAUDE.md files are still
loaded in full.

### Progress Message Memory Fix (2.1.77+)

Intermediate progress messages (status updates during
tool execution) were not removed during compaction,
causing unbounded memory growth in long sessions. Now
properly excluded from compacted conversation history.
Critical for egregore orchestration and agent team
workflows that run for extended periods with many tool
invocations.

### Output Token Limit Impact on MECW (2.1.77+)

Opus 4.6 default max output raised to 64k tokens (was
32k). Upper bound raised to 128k for Opus 4.6 and
Sonnet 4.6. Larger output limits reduce the effective
context window available before auto-compaction triggers.
Factor this into MECW calculations: a 128k max output
on a 1M context window means auto-compaction may trigger
at ~870k tokens instead of ~935k.

### Deferred Tools Schema Fix (2.1.76+)

Deferred tools (loaded via `ToolSearch`) previously lost
their input schemas after compaction. The schemas existed
only in conversation context, not in the persistent tool
registry. After compaction, the summarized context no
longer contained raw schemas, causing array and number
parameters to be rejected with type errors. Affected
tools: `CronCreate`, `TaskCreate`, `WebFetch`,
`WebSearch`, `NotebookEdit`, `ExitWorktree`, and MCP
tools. Pre-loaded tools (Bash, Read, Edit, etc.) were
not affected. Schemas are now persisted in the registry
and survive compaction.

### Auto-Compaction Circuit Breaker (2.1.76+)

Auto-compaction previously retried indefinitely after
consecutive failures (API error, timeout, malformed
summary), locking up the session in a compaction loop.
A circuit breaker now stops after 3 consecutive failures.
The session continues without compaction, allowing manual
intervention (`/clear`, `/compact`, or continue working).
The failure counter resets on a successful compaction.

### Context Limit Fix with `model:` Frontmatter (2.1.76+)

Skills with `model:` frontmatter (e.g., `model: sonnet`)
no longer trigger spurious "Context limit reached" on 1M
sessions. The context limit check was using the
frontmatter model's default window (200K for Sonnet)
instead of the session's actual window (1M). Sessions
with >200K tokens loaded would falsely trigger the
check. Now uses the session's actual context window size.

This is particularly relevant for plugin skills using
`model_hint` routing, where skills may temporarily
switch to a different model for execution.

### Token Estimation Fix (2.1.75+)

Fixed token estimation over-counting for `thinking` and
`tool_use` blocks, which triggered premature context
compaction. The estimator inflated the apparent size of
these block types, causing the system to compact earlier
than necessary. Sessions now use more of their available
context window before compaction kicks in.

This is particularly significant for Opus 4.6 with
extended thinking enabled, where thinking blocks can be
substantial. Previous thinking blocks are automatically
stripped from the context window by the API and should
not count toward the active window, but the estimation
bug was including them. Combined with the 1M default
(2.1.75+), this fix means Max/Team/Enterprise users
experience far fewer compaction interruptions.

### JSON-Output Hook Token Savings (2.1.73+)

JSON-output hooks previously injected no-op
system-reminder messages into the model's context on
every turn, wasting tokens. Fixed in 2.1.73: hooks
using JSON output format no longer produce spurious
context injections. Sessions using multiple JSON-output
hooks benefit most from this fix.

**"Summarize from here" (2.1.32+)**: Partial conversation summarization via the message selector provides a manual middle ground between `/compact` (full) and `/new` (clean slate). Use when only older context is stale.
- **Conservation plugin** provides proactive optimization recommendations when approaching thresholds

**Context Optimization with /context (2.0.74+)**:
```bash
# View detailed context breakdown
/context

# Identify high-consuming plugins:
# - Look for plugins with unexpectedly high token counts
# - Check if all loaded skills are actively needed
# - Consider unloading unused plugins to free context

# Example optimization strategy:
# 1. Run /context to see breakdown
# 2. Identify plugins using >10% context
# 3. Evaluate if each plugin's value justifies its context cost
# 4. Unload or defer plugins not needed for current task
```

```python
class MECWMonitor:
    """max_context defaults to 1M (Opus 4.6 GA default)."""
    def __init__(self, max_context=1_000_000):
        self.max_context = max_context
        self.mecw_threshold = max_context * 0.5

    def check_compliance(self, current_tokens):
        if current_tokens > self.mecw_threshold:
            return {
                'compliant': False,
                'overage': current_tokens - self.mecw_threshold,
                'action': 'immediate_optimization_required'
            }
        return {'compliant': True}
```

### Compression Techniques

1. **Code Summarization**: Replace full code with signatures + descriptions
2. **Content Chunking**: Process in MECW-compliant segments
3. **Result Synthesis**: Combine partial results efficiently
4. **Context Rotation**: Swap out completed context for new tasks
5. **LSP Optimization (2.0.74+)**: **Default approach** for token-efficient code navigation
   - **Old grep approach**: Load many files, search text (10,000+ tokens)
   - **LSP approach (PREFERRED)**: Query semantic index, read only target (500 tokens)
   - **Savings**: ~90% token reduction for reference finding
   - **Default strategy**: Always use LSP when available
   - **Enable permanently**: Add `export ENABLE_LSP_TOOL=1` to shell rc
   - **Fallback**: Only use grep when LSP unavailable for language

## Best Practices

1. **Plan for 40%**: Design workflows to use ~40% of context
2. **Buffer for Response**: Leave 50% for model reasoning + response
3. **Monitor Continuously**: Check context at each major step
4. **Fail Fast**: Abort and restructure when approaching limits
5. **Document Aggressively**: Keep summaries for context recovery

## Integration

- **Assessment**: Use with `mecw-assessment` module for analysis
- **Coordination**: Use with `subagent-coordination` for delegation
- **Conservation**: Aligns with `token-conservation` strategies
