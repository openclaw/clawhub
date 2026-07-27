---
name: html
description: Use when the user invokes /html, wants to choose an HTML artifact pattern, or wants a visual or interactive single-file HTML format for planning, review, explanation, reporting, or lightweight editing.
---

# HTML Artifact Chooser

Use this as a menu for picking an HTML artifact shape. It is based on Thariq Shihipar's "The unreasonable effectiveness of HTML" examples.

Source index: https://thariqs.github.io/html-effectiveness/

## How to Use

When the user asks for `/html`, show the options below and ask which one they want to explore or create.

After the user chooses an option, open the linked example and read it before designing the artifact. Treat the example as pattern inspiration, not a template to copy blindly.

Keep outputs as a single self-contained `.html` file unless the user asks for something else. For interactive tools, include a copy/export affordance when useful.

## Default Location

When working inside a repo or workspace, write generated HTML artifacts under
gitignored `.artifacts/` by default so they are easy to open locally without
polluting source docs or PR diffs. For planning or review artifacts, prefer
`.artifacts/<short-slug>/index.html` or `.artifacts/<short-slug>.html` unless
the user asks for a different path.

If the user is using the Codex app, open the generated HTML artifact in the
in-app browser when practical and report the local file path. Keep committed
`docs/` or `specs/` for durable repo documentation, not temporary HTML review
artifacts.

## Options

| Option | Use When | Full Example |
| --- | --- | --- |
| Three code approaches | Comparing multiple implementation strategies side by side with tradeoffs | https://thariqs.github.io/html-effectiveness/01-exploration-code-approaches.html |
| Visual design directions | Reviewing layout, palette, or visual direction options as rendered screens | https://thariqs.github.io/html-effectiveness/02-exploration-visual-designs.html |
| Annotated pull request | Turning a diff or PR review into a scannable annotated artifact | https://thariqs.github.io/html-effectiveness/03-code-review-pr.html |
| Module map | Explaining an unfamiliar package, dependency graph, hot path, or entry points | https://thariqs.github.io/html-effectiveness/04-code-understanding.html |
| Living design system | Showing tokens, colors, type, spacing, and components from a repo | https://thariqs.github.io/html-effectiveness/05-design-system.html |
| Component variants | Reviewing one component across sizes, states, intents, and edge cases | https://thariqs.github.io/html-effectiveness/06-component-variants.html |
| Animation sandbox | Tuning motion with sliders for duration, easing, delay, or intensity | https://thariqs.github.io/html-effectiveness/07-prototype-animation.html |
| Clickable flow | Trying a lightweight multi-screen interaction before implementation | https://thariqs.github.io/html-effectiveness/08-prototype-interaction.html |
| Arrow-key slide deck | Turning a short narrative, update, or meeting brief into browser slides | https://thariqs.github.io/html-effectiveness/09-slide-deck.html |
| SVG figure sheet | Creating editable inline vector figures for docs, posts, or explainers | https://thariqs.github.io/html-effectiveness/10-svg-illustrations.html |
| Weekly status | Making a recurring status update skimmable with sections and small charts | https://thariqs.github.io/html-effectiveness/11-status-report.html |
| Incident timeline | Reconstructing an incident or debugging story with logs and follow-ups | https://thariqs.github.io/html-effectiveness/12-incident-report.html |
| Annotated flowchart | Explaining a process, workflow, pipeline, or failure path interactively | https://thariqs.github.io/html-effectiveness/13-flowchart-diagram.html |
| Feature explainer | Teaching how a repo feature works with paths, snippets, FAQ, and glossary | https://thariqs.github.io/html-effectiveness/14-research-feature-explainer.html |
| Concept explainer | Teaching a general concept with an interactive model and glossary | https://thariqs.github.io/html-effectiveness/15-research-concept-explainer.html |
| Implementation plan | Turning a selected approach into milestones, risks, flows, and handoff notes | https://thariqs.github.io/html-effectiveness/16-implementation-plan.html |
| PR writeup for reviewers | Preparing reviewer context with motivation, before/after, and file tour | https://thariqs.github.io/html-effectiveness/17-pr-writeup.html |
| Ticket triage board | Sorting issues or tasks visually, then exporting the final order | https://thariqs.github.io/html-effectiveness/18-editor-triage-board.html |
| Feature flag editor | Editing flags with dependency warnings and a copyable diff | https://thariqs.github.io/html-effectiveness/19-editor-feature-flags.html |
| Prompt tuner | Editing a prompt template while live-rendering sample inputs | https://thariqs.github.io/html-effectiveness/20-editor-prompt-tuner.html |

## Default Response Shape

If the user invokes `/html` without a choice, reply with:

```text
Pick one HTML artifact pattern:

1. Three code approaches
2. Visual design directions
3. Annotated pull request
4. Module map
5. Living design system
6. Component variants
7. Animation sandbox
8. Clickable flow
9. Arrow-key slide deck
10. SVG figure sheet
11. Weekly status
12. Incident timeline
13. Annotated flowchart
14. Feature explainer
15. Concept explainer
16. Implementation plan
17. PR writeup for reviewers
18. Ticket triage board
19. Feature flag editor
20. Prompt tuner
```

If the user names a choice, say which source example you are reading, then inspect that URL before producing the artifact.
