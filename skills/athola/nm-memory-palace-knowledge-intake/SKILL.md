---
name: knowledge-intake
description: |
  Process external resources into stored knowledge with quality evaluation, curation routing, and application decisions
version: 1.8.1
triggers:
  - knowledge-management
  - intake
  - evaluation
  - curation
  - external-resources
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/memory-palace", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.memory-palace-architect", "night-market.digital-garden-cultivator", "night-market.leyline:evaluation-framework", "night-market.leyline:storage-templates", "night-market.leyline:document-conversion", "night-market.scribe:slop-detector"]}}}
source: claude-night-market
source_plugin: memory-palace
---

> **Night Market Skill** — ported from [claude-night-market/memory-palace](https://github.com/athola/claude-night-market/tree/master/plugins/memory-palace). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [What It Is](#what-it-is)
- [The Intake Signal](#the-intake-signal)
- [Quick Start](#quick-start)
- [Evaluation Framework](#evaluation-framework)
- [Importance Criteria](#importance-criteria)
- [Scoring Guide](#scoring-guide)
- [Application Routing](#application-routing)
- [Local Codebase Application](#local-codebase-application)
- [Meta-Infrastructure Application](#meta-infrastructure-application)
- [Routing Decision Tree](#routing-decision-tree)
- [Storage Locations](#storage-locations)
- [The Tidying Imperative (KonMari-Inspired)](#the-tidying-imperative-konmari-inspired)
- [The Master Curator](#the-master-curator)
- [The Two Questions](#the-two-questions)
- [Tidying Actions](#tidying-actions)
- [Marginal Value Filtering (Anti-Pollution)](#marginal-value-filtering-anti-pollution)
- [The Three-Step Filter](#the-three-step-filter)
- [Using the Filter](#using-the-filter)
- [Filter Output Example](#filter-output-example)
- [Progressive Autonomy Integration](#progressive-autonomy-integration)
- [RL-Based Quality Scoring](#rl-based-quality-scoring)
- [Usage Signals](#usage-signals)
- [Quality Decay Model](#quality-decay-model)
- [Source Lineage Tracking](#source-lineage-tracking)
- [Knowledge Orchestrator](#knowledge-orchestrator)
- [RL Integration with Marginal Value Filter](#rl-integration-with-marginal-value-filter)
- [Workflow Example](#workflow-example)
- [Queue Processing](#queue-processing)
- [Processing Queue Entries](#processing-queue-entries)
- [Queue Integration](#queue-integration)
- [Queue Status Workflow](#queue-status-workflow)
- [Automation](#automation)
- [Detailed Resources](#detailed-resources)
- [Hook Integration](#hook-integration)
- [Automatic Triggers](#automatic-triggers)
- [Hook Signals](#hook-signals)
- [Deduplication](#deduplication)
- [Safety Checks](#safety-checks)
- [Index Schema Alignment](#index-schema-alignment)
- [Integration](#integration)


# Knowledge Intake

Systematically process external resources into actionable knowledge. When a user links an article, blog post, or paper, this skill guides evaluation, storage decisions, and application routing.


## When To Use

- Capturing and organizing knowledge from sessions
- Ingesting information into structured memory palaces

## When NOT To Use

- Temporary notes that do not need long-term storage
- Code-only changes without knowledge capture needs

## What It Is

A knowledge governance framework that answers three questions for every external resource:
1. **Is it worth storing?** - Evaluate signal-to-noise and relevance
2. **Where does it apply?** - Route to local codebase or meta-infrastructure
3. **What does it displace?** - Identify outdated knowledge to prune

## The Intake Signal

> When a user links an external resource, it is a signal of importance.

The act of sharing indicates the resource passed the user's own filter. Our job is to:
- Extract the essential patterns and insights
- Determine appropriate storage location and format
- Connect to existing knowledge structures
- Identify application opportunities

## Quick Start

When a user shares a link:

```
1. FETCH    → Detect format, retrieve and convert content
2. EVALUATE → Apply importance criteria
3. DECIDE   → Storage location and application type
4. STORE    → Create structured knowledge entry
5. VALIDATE → Scribe verification (slop scan + doc verify)
6. CONNECT  → Link to existing palace structures
7. PROMOTE  → Offer Discussion promotion (score 80+)
8. APPLY    → Route to codebase or infrastructure updates
9. PRUNE    → Identify displaced/outdated knowledge
```

### Step 1: FETCH with Format Detection

Before retrieving content, detect the source format from
the URL or file path to choose the right retrieval method.

**Web articles and blog posts** (default path):
Use WebFetch to retrieve HTML content directly.
No conversion needed.

**Document URLs** (PDF, DOCX, PPTX, XLSX):
Apply the `leyline:document-conversion` protocol.
This tries the markitdown MCP tool first for high-quality
markdown, then falls back to native Claude Code tools
(Read for PDFs, etc.), then informs the user if the
format is unsupported without markitdown.

**Local files** (user shares a file path):
Construct a `file://` URI from the absolute path and
apply the `leyline:document-conversion` protocol.

**Format detection heuristics:**

| URL Pattern | Format | Retrieval |
|-------------|--------|-----------|
| `*.pdf`, `arxiv.org/pdf/*` | PDF | document-conversion |
| `*.docx`, `*.doc` | Word | document-conversion |
| `*.pptx`, `*.ppt` | PowerPoint | document-conversion |
| `*.xlsx`, `*.xls` | Excel | document-conversion |
| `*.epub` | E-book | document-conversion |
| `drive.google.com/*` | Various | document-conversion |
| Everything else | HTML/web | WebFetch (existing) |

After retrieval (regardless of method), wrap the content
in external content boundary markers per
`leyline:content-sanitization` before proceeding to
Step 2 (EVALUATE).

### Step 5: Scribe Validation (Required)

**All knowledge corpus entries MUST pass scribe validation before finalizing.**

Run `Skill(scribe:slop-detector)` on the new entry:
- Score must be < 2.5 (Clean to Light)
- No Tier 1 markers (delve, tapestry, comprehensive, leveraging, etc.)
- Hedge word density < 15 per 1000 words

Use `Agent(scribe:doc-verifier)` to validate:
- All file paths and URLs exist
- All cross-references valid
- Source attributions accurate

```bash
# Quick validation for knowledge corpus entry
/slop-scan docs/knowledge-corpus/[entry-name].md
# Doc verification is now agent-only:
Agent(scribe:doc-verifier) "Verify docs/knowledge-corpus/[entry-name].md"
```

**DO NOT finalize entries with slop score > 2.5** - rewrite with concrete specifics.
**Verification:** Run the command with `--help` flag to verify availability.

### Step 7: Discussion Promotion (Score 80+ Only)

When the evaluation score is 80-100 (evergreen), you
MUST execute the Discussion promotion workflow. If the
score is below 80, skip this step entirely.

**Execute these steps in order:**

1. Read `modules/discussion-promotion.md` for the
   full GraphQL workflow
2. Tell the user: "This entry has reached evergreen
   maturity. Publishing to GitHub Discussions. [Y/n]"
3. If the user says "n", skip to Step 8 (APPLY)
4. Run the `gh api graphql` commands from the module
   to create or update a Discussion in the "Knowledge"
   category
5. Update the local corpus entry with `discussion_url`

- If the entry already has a `discussion_url` field,
  update the existing Discussion instead of creating
  a new one
- If `gh` is unavailable or promotion fails, warn
  the user and continue to Step 8 (APPLY)

Publishing is the default for qualifying entries. It
never blocks the intake workflow.

## Evaluation Framework

### Importance Criteria

| Criterion | Weight | Questions |
|-----------|--------|-----------|
| **Novelty** | 25% | Does this introduce new patterns or concepts? |
| **Applicability** | 30% | Can we apply this to current work? |
| **Durability** | 20% | Will this remain relevant in 6+ months? |
| **Connectivity** | 15% | Does it connect to multiple existing concepts? |
| **Authority** | 10% | Is the source credible and well-reasoned? |

### Scoring Guide

- **80-100**: Evergreen knowledge, store prominently, apply immediately
- **60-79**: Valuable insight, store in corpus, schedule application
- **40-59**: Useful reference, store as seedling, revisit later
- **Below 40**: Low priority, capture key quote only or skip

## Application Routing

### Local Codebase Application
Apply when knowledge directly improves current project:
- Bug fix patterns
- Performance optimizations
- Architecture decisions for this codebase
- Tool/library recommendations

**Action**: Update code, add comments, create ADR

### Meta-Infrastructure Application
Apply when knowledge improves our plugin ecosystem:
- Skill design patterns
- Agent behavior improvements
- Workflow optimizations
- Learning/evaluation methods (like Franklin Protocol)

**Action**: Update skills, create modules, enhance agents

### Routing Decision Tree

```
**Verification:** Run the command with `--help` flag to verify availability.
Is the knowledge...
├── About HOW we build things? → Meta-infrastructure
│   ├── Skill patterns → Update abstract/memory-palace skills
│   ├── Learning methods → Add to knowledge-corpus
│   └── Tool techniques → Create new skill module
│
└── About WHAT we're building? → Local codebase
    ├── Domain knowledge → Store in project docs
    ├── Implementation patterns → Update code/architecture
    └── Bug/issue solutions → Apply fix, document
```
**Verification:** Run the command with `--help` flag to verify availability.

## Storage Locations

| Knowledge Type | Location | Format |
|----------------|----------|--------|
| Meta-learning patterns | `docs/knowledge-corpus/` | Full memory palace entry |
| Skill design insights | `skills/*/modules/` | Technique module |
| Tool/library knowledge | `docs/references/` | Quick reference |
| Temporary insights | Digital garden seedling | Lightweight note |

## The Tidying Imperative (KonMari-Inspired)

> "A cluttered palace is a cluttered mind."

New knowledge often displaces old—but **time is not the criterion**. Relevance and aspirational alignment are.

### The Master Curator
The human in the loop defines what stays. Before major tidying:
1. **Who are you becoming?** - Your aspirations as a developer
2. **What excites you now?** - Genuine enthusiasm, not "should"
3. **What have you outgrown?** - Past interests consciously left behind

### The Two Questions
For each piece of knowledge, both must be yes:
- **Does it spark joy?** - Genuine enthusiasm, not obligation
- **Does it serve your aspirations?** - Aligned with who you're becoming

### Tidying Actions

| Finding | Action |
|---------|--------|
| Supersedes | Archive old with gratitude, link as context |
| Contradicts | Evaluate both, keep what sparks joy |
| No longer aligned | Release with gratitude |
| Complements | Create bidirectional links |

**"I might need this someday"** is fear, not joy. Release it.

## Marginal Value Filtering (Anti-Pollution)

> "If it can't teach something the existing corpus can't already teach → skip it."

Before storing ANY knowledge, run the **marginal value filter** to prevent corpus pollution.

### The Three-Step Filter

**1. Redundancy Check**
- Exact match → REJECT immediately
- 80%+ overlap → REJECT as redundant
- 40-80% overlap → Evaluate delta (Step 2)
- <40% overlap → Likely novel, proceed to store

**2. Delta Analysis** (for partial overlap only)
- **Novel insight/pattern** → High value (0.7-0.9)
- **Different framing only** → Low value (0.2-0.4)
- **More examples** → Marginal value (0.4-0.6)
- **Contradicts existing** → Investigate (0.6-0.8)

**3. Integration Decision**
- **Standalone**: Novel content, no significant overlap
- **Merge**: Enhances existing entry with examples/details
- **Replace**: Supersedes outdated knowledge
- **Skip**: Insufficient marginal value

### Using the Filter

```python
from memory_palace.corpus import MarginalValueFilter

# Initialize filter with corpus and index directories
filter = MarginalValueFilter(
    corpus_dir="docs/knowledge-corpus",
    index_dir="docs/knowledge-corpus/indexes"
)

# Evaluate new content
redundancy, delta, integration = filter.evaluate_content(
    content=article_text,
    title="Structured Concurrency in Python",
    tags=["async", "concurrency", "python"]
)

# Get human-readable explanation
explanation = filter.explain_decision(redundancy, delta, integration)
print(explanation)

# Act on decision
if integration.decision == IntegrationDecision.SKIP:
    print(f"Skipping: {integration.rationale}")
elif integration.decision == IntegrationDecision.STANDALONE:
    # Store as new entry
    store_knowledge(content, title)
elif integration.decision == IntegrationDecision.MERGE:
    # Enhance existing entry
    enhance_entry(integration.target_entries[0], content)
elif integration.decision == IntegrationDecision.REPLACE:
    # Replace outdated entry
    replace_entry(integration.target_entries[0], content)
```
**Verification:** Run the command with `--help` flag to verify availability.

### Filter Output Example

```
**Verification:** Run the command with `--help` flag to verify availability.
=== Marginal Value Assessment ===

Redundancy: partial
Overlap: 65%
Matches: async-patterns, python-concurrency
  - Partial overlap (65%) with 2 entries

Delta Type: novel_insight
Value Score: 75%
Teaching Delta: Introduces 8 new concepts
Novel aspects:
  + New concepts: structured, taskgroup, context-manager
  + New topics: Error Propagation, Resource Cleanup

Decision: STANDALONE
Confidence: 80%
Rationale: Novel insights justify standalone: Introduces 8 new concepts
```
**Verification:** Run the command with `--help` flag to verify availability.

### Progressive Autonomy Integration

The marginal value filter respects autonomy levels (see plan Phase 4):
- **Level 0**: ALL decisions require human approval
- **Level 1**: Auto-approve 85+ scores in known domains
- **Level 2**: Auto-approve 70+ scores in known domains
- **Level 3**: Auto-approve 60+, auto-reject obvious noise

Current implementation: Level 0 (all human-in-the-loop).

## RL-Based Quality Scoring

The knowledge corpus uses reinforcement learning signals to dynamically score entry quality based on actual usage patterns.

### Usage Signals

| Signal | Weight | Description |
|--------|--------|-------------|
| `ACCESS` | +0.1 | Entry was accessed/read |
| `CITATION` | +0.3 | Entry was cited in another context |
| `POSITIVE_FEEDBACK` | +0.5 | User marked as helpful |
| `NEGATIVE_FEEDBACK` | -0.3 | User marked as unhelpful |
| `CORRECTION` | +0.2 | Entry was corrected/updated |
| `STALE_FLAG` | -0.4 | Entry marked as potentially outdated |

### Quality Decay Model

Knowledge entries decay over time unless validated:

| Maturity | Half-Life | Decay Curve |
|----------|-----------|-------------|
| Seedling | 14 days | Exponential |
| Growing | 30 days | Exponential |
| Evergreen | 90 days | Logarithmic |

Entries are classified by decay status:
- **Fresh**: >70% quality retained
- **Stale**: 40-70% quality retained
- **Critical**: 20-40% quality retained
- **Archived**: <20% quality retained

### Source Lineage Tracking

Hybrid lineage tracking based on source importance:

**Full Lineage** (for important sources):
- Primary source with complete metadata
- Derivation chain (what entries it was derived from)
- Transformation history (summarization, extraction, etc.)
- Validation chain (who validated and when)

**Simple Lineage** (for standard sources):
- Source type and URL
- Retrieval timestamp

Full lineage is used for:
- Research papers
- Documentation
- Entries with importance score >= 0.7

### Knowledge Orchestrator

The `KnowledgeOrchestrator` coordinates all quality systems:

```python
from memory_palace.corpus import KnowledgeOrchestrator, UsageSignal

# Initialize orchestrator
orchestrator = KnowledgeOrchestrator(
    corpus_dir="docs/knowledge-corpus",
    index_dir="docs/knowledge-corpus/indexes"
)

# Record usage events
orchestrator.record_usage("entry-1", UsageSignal.ACCESS)
orchestrator.record_usage("entry-1", UsageSignal.POSITIVE_FEEDBACK)

# Assess entry quality
entry = {"id": "entry-1", "maturity": "growing"}
assessment = orchestrator.assess_entry(entry)
print(f"Quality: {assessment.overall_score:.0%}")
print(f"Status: {assessment.status}")
print(f"Recommendations: {assessment.recommendations}")

# Get maintenance queue
entries = [...]  # Your entry list
queue = orchestrator.get_maintenance_queue(entries)
for item in queue:
    print(f"{item.entry_id}: {item.status} - {item.recommendations}")

# Ingest new content with lineage
from memory_palace.corpus import SourceReference, SourceType

source = SourceReference(
    source_id="src-1",
    source_type=SourceType.DOCUMENTATION,
    url="https://docs.example.com/api",
    title="API Documentation"
)
entry_id, decision = orchestrator.ingest_with_lineage(
    content="# API Reference\n...",
    title="API Documentation",
    source=source
)
```
**Verification:** Run the command with `--help` flag to verify availability.

### RL Integration with Marginal Value Filter

The marginal value filter emits RL signals on integration decisions:

```python
from memory_palace.corpus import MarginalValueFilter

filter = MarginalValueFilter(corpus_dir, index_dir)

# Evaluate with RL signal emission
redundancy, delta, integration, rl_signal = filter.evaluate_with_rl(
    content=article_text,
    title="New Article",
    tags=["python", "async"]
)

# RL signal contains:
# - signal_type: UsageSignal to emit
# - weight: Signal weight for scoring
# - action: What happened (new_entry_created, entry_enhanced, etc.)
# - decision: Integration decision made
# - confidence: Decision confidence
print(f"RL Signal: {rl_signal['action']} (weight: {rl_signal['weight']})")
```
**Verification:** Run the command with `--help` flag to verify availability.

## Workflow Example

**User shares**: "Check out this article on structured concurrency"

```yaml
intake:
  source: "https://example.com/structured-concurrency"

# PHASE 3: Marginal Value Filter
marginal_value:
  redundancy:
    level: partial_overlap
    overlap_score: 0.65
    matching_entries: [async-patterns, python-concurrency]
  delta:
    type: novel_insight
    value_score: 0.75
    novel_aspects: [structured, taskgroup, context-manager]
    teaching_delta: "Introduces structured concurrency pattern"
  integration:
    decision: standalone
    confidence: 0.80
    rationale: "Novel insights justify standalone entry"

# Continue with evaluation if filter passes
evaluation:
  novelty: 75        # New pattern for error handling
  applicability: 90  # Directly relevant to async code
  durability: 85     # Core concept, won't age quickly
  connectivity: 70   # Links to error handling, async patterns
  authority: 80      # Well-known author, cited sources
  total: 82          # Evergreen, store and apply

routing:
  type: both
  local_application:
    - Refactor async error handling in current project
    - Add structured concurrency pattern to codebase
  meta_application:
    - Create module in relevant skill
    - Add to knowledge-corpus as reference

storage:
  location: docs/knowledge-corpus/structured-concurrency.md
  format: memory_palace_entry
  maturity: growing

pruning:
  displaces:
    - Old async error patterns (mark deprecated)
  complements:
    - Existing error handling module
    - Async patterns documentation
```
**Verification:** Run the command with `--help` flag to verify availability.

## Queue Processing

Research sessions and external content are automatically queued for review in `docs/knowledge-corpus/queue/`.

### Processing Queue Entries

```bash
# List pending queue entries
ls -1t docs/knowledge-corpus/queue/*.yaml

# Review specific entry
cat docs/knowledge-corpus/queue/2025-12-31_topic.yaml

# Process approved entry
# 1. Create memory palace entry in docs/knowledge-corpus/
# 2. Update queue entry status to 'processed'
# 3. Archive or delete queue entry
```
**Verification:** Run the command with `--help` flag to verify availability.

### Queue Integration

The `research-queue-integration` hook automatically queues:
- Brainstorming sessions with 3+ WebSearch calls
- Research-focused sessions with substantial findings
- Manual additions via queue entry creation

**Queue entry format**: See `docs/knowledge-corpus/queue/README.md`

### Queue Status Workflow

```
**Verification:** Run the command with `--help` flag to verify availability.
pending_review → [Review] → approved/rejected
approved → [Create Entry] → processed
processed → [Archive] → queue/archive/
```
**Verification:** Run the command with `--help` flag to verify availability.

## Automation

- Run `uv run python scripts/intake_cli.py --candidate path/to/intake_candidate.json --auto-accept`
- The CLI runs marginal value filter, creates palace entries (`docs/knowledge-corpus/*.md`),
  developer drafts (`docs/developer-drafts/`), and appends audit rows to `docs/curation-log.md`.
- Use `--output-root` in tests or sandboxes to avoid mutating the main corpus.
- **Queue Processing**: Use `--process-queue` flag to review and process queued entries interactively.

## Detailed Resources

- **Evaluation Rubric**: See `modules/evaluation-rubric.md`
- **Storage Patterns**: See `modules/storage-patterns.md`
- **KonMari Tidying Philosophy**: See `modules/konmari-tidying.md`
- **Tidying Workflows**: See `modules/pruning-workflows.md`
- **Discussion Promotion**: Invoked in Step 7 (PROMOTE)
  for evergreen entries (score 80+). Publishing is the
  default action.
  See `modules/discussion-promotion.md` for full workflow.

## Hook Integration

Memory-palace hooks automatically detect content that may need knowledge intake processing:

### Automatic Triggers

| Hook | Event | When Triggered |
|------|-------|----------------|
| `url_detector` | UserPromptSubmit | User message contains URLs |
| `web_content_processor` | PostToolUse (WebFetch/WebSearch) | After fetching web content |
| `local_doc_processor` | PostToolUse (Read) | Reading files in knowledge paths |
| `research_queue_integration` | SessionEnd | Research sessions with 3+ WebSearch calls |

### Hook Signals

When hooks detect potential knowledge content, they add context messages:

```
**Verification:** Run `pytest -v` to verify tests pass.
Memory Palace: New web content fetched from {url}.
Consider running knowledge-intake to evaluate and store if valuable.
```
**Verification:** Run the command with `--help` flag to verify availability.

```
**Verification:** Run the command with `--help` flag to verify availability.
Memory Palace: Reading local knowledge doc '{path}'.
This path is configured for knowledge tracking.
Consider running knowledge-intake if this contains valuable reference material.
```
**Verification:** Run the command with `--help` flag to verify availability.

### Deduplication

Hooks check the `memory-palace-index.yaml` to avoid redundant processing:
- **Known URLs**: "Content already indexed" - skip re-evaluation
- **Changed content**: "Content has changed" - suggest update
- **New content**: Full evaluation recommended

### Safety Checks

Before signaling intake, hooks validate content:
- Size limits (default 500KB)
- Secret detection (API keys, credentials)
- Data bomb prevention (repetition, unicode bombs)
- Prompt injection sanitization

### Index Schema Alignment

The deduplication index stores fields aligned with this skill's evaluation:

```yaml
entries:
  "https://example.com/article":
    content_hash: "xxh:abc123..."
    stored_at: "docs/knowledge-corpus/article.md"
    importance_score: 82           # From evaluation framework
    maturity: "growing"            # seedling, growing, evergreen
    routing_type: "both"           # local, meta, both
    last_updated: "2025-12-06T..."
```
**Verification:** Run the command with `--help` flag to verify availability.

## Integration

- `memory-palace-architect` - Structures stored knowledge spatially
- `digital-garden-cultivator` - Manages knowledge lifecycle
- `knowledge-locator` - Finds and retrieves stored knowledge
- `skills-eval` (abstract) - Evaluates meta-infrastructure updates
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
