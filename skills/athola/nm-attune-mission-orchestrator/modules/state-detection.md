---
name: state-detection
description: Artifact existence checks, quality validation, and staleness detection for mission type selection
parent_skill: attune:mission-orchestrator
category: workflow-orchestration
estimated_tokens: 200
---

# State Detection

## Artifact Existence Checks

The orchestrator scans for these artifacts to determine project state:

| Artifact | Path | Indicates |
|----------|------|-----------|
| Project brief | `docs/project-brief.md` | Brainstorm phase completed |
| Specification | `docs/specification.md` | Specify phase completed |
| Implementation plan | `docs/implementation-plan.md` | Plan phase completed |
| Execution state | `.attune/execution-state.json` | Execute phase in progress |

### Alternative Paths

Some projects may use non-standard paths. The orchestrator also checks:

- `project-brief.md` (root level)
- `specification.md` (root level)
- `implementation-plan.md` (root level)
- `.specify/` directory (spec-kit convention)

## Quality Validation

An artifact file must pass quality checks to be considered "complete":

### Non-Empty Check

File must contain more than just whitespace or a single heading. Minimum: 100 characters of content.

### Required Sections

| Artifact | Required Sections |
|----------|------------------|
| project-brief.md | "Problem Statement" or "Goals" |
| specification.md | "User Stories" or "Requirements" or "Functional" |
| implementation-plan.md | "Tasks" or "Phase" or "Steps" |

### Frontmatter Status

If the artifact has YAML frontmatter with a `status` field, it must be:
- `complete` or `approved` — artifact is ready
- `draft` or `in-progress` — artifact exists but is not ready (treated as non-existent for type detection)
- `rejected` — artifact should be regenerated

## Staleness Detection

Artifacts may become stale when the codebase evolves after they were written:

### Staleness Signals

| Signal | Detection | Action |
|--------|-----------|--------|
| Artifact older than 7 days | `mtime` check | Warn user, suggest refresh |
| Referenced files don't exist | Parse file paths in artifact | Warn about missing references |
| Git changes since artifact | `git log --since` | Warn about codebase drift |

### Staleness Response

Stale artifacts trigger a warning but do not block mission execution:

```
Warning: docs/specification.md was last modified 14 days ago.
The codebase has 23 commits since then.
Consider refreshing with /attune:specify before proceeding.

Continue anyway? [Y/n]
```

With `--auto` flag, stale artifacts are accepted with a logged warning.

## State Detection Result

The detection phase produces a structured result:

```json
{
  "artifacts": {
    "project_brief": {
      "exists": true,
      "path": "docs/project-brief.md",
      "quality": "valid",
      "last_modified": "2026-02-01T10:00:00Z",
      "stale": false
    },
    "specification": {
      "exists": true,
      "path": "docs/specification.md",
      "quality": "valid",
      "last_modified": "2026-02-05T14:30:00Z",
      "stale": false
    },
    "implementation_plan": {
      "exists": false
    },
    "execution_state": {
      "exists": false
    }
  },
  "detected_type": "tactical",
  "confidence": "high"
}
```
