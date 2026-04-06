# Evidence Logging

Foundation for all evidence-based review workflows. Provides structured evidence capture, audit trails, and reproducibility for analyses.

## When To Use
- During any review or analysis workflow to capture reproducible evidence.
- When findings must be traceable to specific commands, outputs, or sources.
- Before finalizing recommendations that stakeholders will act upon.

## Activation Patterns
**Trigger Keywords**: evidence, proof, trace, audit, reproducible, citation, source, verify
**Contextual Cues**:
- "show your work" or "provide evidence"
- "how can I verify this" or "reproduce these findings"
- "cite your sources" or "where did this come from"
- "create an audit trail"
- "document the steps taken"

## Step 1: Initialize Log
- Create evidence structure with timestamp and context:
  - Session ID or review identifier.
  - Repository, branch, and commit hash.
  - Analyst identity and review scope.
- Establish naming convention for evidence references (e.g., `[E1]`, `[E2]`).

## Step 2: Capture Commands
- Log every command that produces evidence:
  ```
  [E1] Command: git diff --stat HEAD~5..HEAD
       Output: 15 files changed, 234 insertions(+), 89 deletions(-)
       Timestamp: 2024-01-15T10:30:00Z
  ```
- Include full command with arguments (no aliases).
- Capture relevant output snippets, not entire dumps.
- Note working directory and environment if relevant.

## Step 3: Record Citations
- Log external sources consulted:
  ```
  [C1] Source: https://doc.rust-lang.org/nomicon/
       Section: "Working with Unsafe"
       Relevance: Validates unsafe block justification
  ```
- Include web searches performed and key results.
- Reference documentation versions (API docs, RFCs, specs).
- Note any AI-assisted analysis with model/prompt context.

## Step 4: Index Artifacts
- Catalog generated artifacts:
  - Screenshots, diagrams, or visualizations.
  - Exported reports or coverage summaries.
  - Saved query results or API responses.
- Provide file paths or inline content for small artifacts.
- Note artifact retention policy (ephemeral vs. archived).

## Evidence Reference Format
Use consistent format in findings:
```
Finding: Memory leak in connection pool [E3, C2]
- Evidence [E3]: valgrind output showing 4KB unreleased
- Citation [C2]: PostgreSQL docs on connection lifecycle
```

## Exit Criteria
- All findings traceable to specific evidence references.
- Downstream reports can cite evidence without re-running commands.
