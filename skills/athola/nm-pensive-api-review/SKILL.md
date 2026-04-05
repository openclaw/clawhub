---
name: api-review
description: Evaluate API surface design, consistency, documentation, and exemplar alignment
version: 1.8.1
triggers:
  - api
  - design
  - consistency
  - documentation
  - versioning
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/pensive", "emoji": "\ud83d\udd0d", "requires": {"config": ["night-market.pensive:shared", "night-market.imbue:proof-of-work"]}}}
source: claude-night-market
source_plugin: pensive
---

> **Night Market Skill** — ported from [claude-night-market/pensive](https://github.com/athola/claude-night-market/tree/master/plugins/pensive). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# API Review Workflow

## Table of Contents

1. [Usage](#usage)
2. [Required Progress Tracking](#required-progress-tracking)
3. [Workflow](#workflow)

## Usage

Use this skill to review public API changes, design new surfaces, audit consistency, and validate documentation completeness. Run it before any API release to confirm alignment with project guidelines.

## Required Progress Tracking

1. `api-review:surface-inventory`
2. `api-review:exemplar-research`
3. `api-review:consistency-audit`
4. `api-review:docs-governance`
5. `api-review:evidence-log`

## Workflow

### Step 1: Surface Inventory

Catalog all public APIs by language. Record stability levels, feature flags, and versioning metadata. Use tools like `rg` to find public symbols (e.g., `pub` in Rust or non-underscored `def` in Python). Confirm the working tree state with `git status` before starting.

### Step 2: Exemplar Research

Identify at least two high-quality API references for the relevant language, such as pandas, requests, or tokio. Document their patterns for namespacing, pagination, error handling, and structure to serve as a baseline for the audit.

### Step 3: Consistency Audit

Compare the project's API against the identified exemplar patterns. Analyze naming conventions, parameter ordering, return types, and error semantics. Identify duplication, leaky abstractions, missing feature gates, and documentation gaps.

### Step 4: Documentation Governance

Validate that documentation includes entry points, quickstarts, and a complete API reference. Verify that changelogs and migration notes are maintained. Check for SemVer compliance, stability promises, and clear deprecation timelines. Confirm that documentation is generated automatically using tools like rustdoc, Sphinx, or OpenAPI.

### Step 5: Evidence Log

Record all executed commands and findings. Summarize the final recommendation as Approve, Approve with actions, or Block. Include specific action items with assigned owners and due dates.

## API Quality Checklist

### Naming
Confirm consistent conventions and descriptive names that follow language-specific idioms.

### Parameters
Verify consistent ordering and ensure optional parameters have explicit defaults. Check that type annotations are complete.

### Return Values
Analyze return patterns for consistency. Confirm that error cases are documented and that pagination follows a uniform structure.

### Documentation
Verify that all public APIs include usage examples and that the changelog reflects current changes.

## Output Format

The final report must include a summary of the API surface, a numerical inventory of endpoints and public types, and an alignment analysis against researched exemplars. Document consistency issues and documentation gaps with precise file and line references. Conclude with a clear decision and a timed action plan.

## Technical Integration

Use `imbue:proof-of-work` for reproducible command capture and `imbue:structured-output` for formatting findings. Reference `imbue:diff-analysis/modules/risk-assessment-framework` when assessing breaking changes.

## Module Reference

- See `modules/surface-inventory.md` for API cataloging patterns
- See `modules/exemplar-research.md` for researching API standards
- See `modules/consistency-audit.md` for cross-API consistency checks

## Troubleshooting

If the audit command is missing, verify that dependencies are installed and accessible in the system PATH. Check file permissions if access errors occur. Use the `--verbose` flag to inspect execution logs if the tool behaves unexpectedly.
