# Graphviz Conventions for Skill Diagrams

Process diagrams help visualize skill workflows, decision trees, and error handling.

## When to Include Diagrams

**Use diagrams for:**
- Complex decision trees (3+ decision points)
- Multi-step workflows with branches
- Error handling flows
- State transitions

**Skip diagrams for:**
- Simple linear workflows (use numbered lists)
- Single decision points
- Purely conceptual relationships (use tables)

## Node Type Conventions

| Shape | Purpose | Naming |
|-------|---------|--------|
| Diamond | Questions/Decisions | End with "?" |
| Box | Actions/Processes | Start with verb |
| Plaintext | Commands/Code | Actual syntax |
| Ellipse | States/Results | Noun phrases |
| Octagon | Warnings/Stops | Imperative warnings |
| Double circle | Start/End | "Start"/"Complete" |

## Quick Reference

### Decision Node
```dot
node [shape=diamond]
decision [label="Tests\nexist?"]
```

### Action Node
```dot
node [shape=box]
action [label="Run tests"]
```

### Command Node
```dot
node [shape=plaintext, fontname="Courier"]
cmd [label="pytest tests/"]
```

## Edge Labels

| Context | Label Style |
|---------|-------------|
| Binary decisions | "yes" / "no" |
| Multiple choice | Descriptive labels |
| Sequential flow | No labels needed |
| Conditional | Condition expressions |

## Layout Settings

```dot
// Top to bottom (default)
rankdir=TB

// Left to right (sequential)
rankdir=LR
```

## Semantic Colors

| Color | Meaning |
|-------|---------|
| `lightgreen` | Success/Complete |
| `yellow` | Warning/Caution |
| `lightcoral` | Error/Failure |
| `lightblue` | Process/Neutral |
| `lightyellow` | Decision/Info |

## Validation Checklist

- [ ] Decision nodes are diamonds with questions
- [ ] Action nodes are boxes with verbs
- [ ] Binary decisions use "yes"/"no"
- [ ] Colors are semantic and accessible
- [ ] Text wraps at 10-15 characters
- [ ] Diagram adds value beyond text

## Rendering

```bash
dot -Tsvg workflow.dot -o workflow.svg  # Recommended
dot -Tpng workflow.dot -o workflow.png
```

## Detailed Examples

For complete examples including:
- Full TDD workflow diagram
- Subgraph grouping patterns
- State machine examples
- Error handling flows
- Anti-patterns to avoid

Use `dot -Tsvg workflow.dot -o workflow.svg` to render diagrams locally.
