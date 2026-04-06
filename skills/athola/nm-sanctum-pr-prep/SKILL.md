---
name: pr-prep
description: |
  Prepare pull requests by running quality gates, drafting descriptions, and validating tests before submission
version: 1.8.1
triggers:
  - git
  - pr
  - pull-request
  - quality-gates
  - testing
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/sanctum", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.sanctum:shared", "night-market.sanctum:git-workspace-review", "night-market.imbue:proof-of-work", "night-market.imbue:structured-output", "night-market.scribe:slop-detector", "night-market.scribe:doc-generator"]}}}
source: claude-night-market
source_plugin: sanctum
---

> **Night Market Skill** — ported from [claude-night-market/sanctum](https://github.com/athola/claude-night-market/tree/master/plugins/sanctum). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


# Pull Request Preparation Workflow

## Usage

Use this skill to stage changes and generate a PR summary. Run `Skill(sanctum:git-workspace-review)` first to capture the repository state and diffs.

## Required Progress Tracking

Create `TodoWrite` items for these steps before starting:
1. `pr-prep:workspace-reviewed`
2. `pr-prep:quality-gates`
3. `pr-prep:self-reviewed`
4. `pr-prep:changes-summarized`
5. `pr-prep:testing-documented`
6. `pr-prep:pr-drafted`
7. `pr-prep:content-verified`

Mark each item as complete as the section is finished.

## Step 1: Review Workspace (`workspace-reviewed`)

Confirm that `Skill(sanctum:git-workspace-review)` is complete. If changes were staged after the initial review, re-execute the skill to refresh the context.

## Step 2: Run Quality Gates (`quality-gates`)

Execute formatting, linting, and tests using project-specific commands (e.g., `make fmt`, `make lint`, `make test`). Resolve all failures before proceeding. If a task cannot be executed locally, document the reason and the alternative validation performed. Language-specific commands and failure handling are detailed in `modules/quality-gates.md`.

### Capabilities Reference Sync

If any plugin files changed (plugin.json, skills, commands,
agents, or hooks), run `make docs-sync-check` to verify
`book/src/reference/capabilities-reference.md` is current.
If it reports discrepancies, run `/sync-capabilities --fix`
or update the reference manually before proceeding.

## Step 2.5: Self-Review Pass (`self-reviewed`)

Read the diff as if you are a reviewer seeing it for the
first time. This catches scope creep, stale debug code,
and unclear changes before anyone else spends time on
them.

**Automated checks:**

```bash
# Check for debug statements left in
git diff --cached --name-only | xargs grep -nE \
  '(console\.log|print\(|debugger|TODO|FIXME|HACK|XXX)' \
  2>/dev/null || true

# Check for commented-out code blocks (3+ consecutive lines)
git diff --cached | grep -c '^+.*//.*[a-zA-Z]' || true

# Check for formatting-only commits mixed with feature work
git log --oneline $(git merge-base HEAD origin/master)..HEAD | \
  grep -iE '(fmt|format|lint|style|whitespace)' || true
```

**Manual verification:**

- [ ] Read the full diff -- does every change serve the
      stated goal?
- [ ] No debug statements or `TODO` markers left in
- [ ] No commented-out code blocks
- [ ] No formatting changes mixed with logic changes
- [ ] No fixup commits that should be squashed

If issues are found, fix them before proceeding.

## Step 3: Summarize Changes (`changes-summarized`)

Use the notes from the workspace review and the output of `git diff --stat origin/main...HEAD` to understand the scope. Identify key points in the diffs and group them into 2-4 paragraphs highlighting the technical changes and their rationale. Note breaking changes, migrations, or documentation updates.

## Step 4: Document Testing (`testing-documented`)

List each test command executed and its result. Include manual verification steps where relevant. If tests were skipped, document the reason and the mitigation plan.

## Step 5: Draft the PR (`pr-drafted`)

Populate the standard template with Summary, Changes, Testing, and Checklist sections. Include issue references, screenshots, or follow-up TODO items. Template structure and examples are available in `modules/pr-template.md`.

## Step 6: Verify Content Quality (`content-verified`)

Apply `Skill(scribe:slop-detector)` principles to the draft. Verify that the PR description avoids tier-1 slop words (delve, comprehensive, leverage, utilize, robust, seamless) and formulaic phrases like "I'd be happy to" or "It should be noted." Ensure there is no AI attribution in the text and that all claims are grounded with evidence such as commands, numbers, or filenames. Use active voice and maintain a balanced structure with prose for context.

### Vocabulary Substitutions

- Replace **leverage** or **utilize** with **use**.
- Replace **comprehensive** with **thorough** or **complete**.
- Replace **robust** with **solid** or **reliable**.
- Replace **facilitate** with **help** or **enable**.
- Replace **streamline** with **simplify**.

### Remediation

If the description contains slop, apply `Skill(scribe:doc-generator)` principles to ground claims with specifics, remove marketing language, and use direct statements.

## Output Instructions

Write the final PR description to the specified path, then display the file path and its contents for confirmation.

## Notes

Do not include tool or AI attribution in the PR text. If changes are required mid-process, re-run quality gates. This skill covers preparation; pushing changes and opening the PR occurs outside this workflow.

## Supporting Modules

- [TodoWrite patterns](modules/todowrite-patterns.md) - naming conventions for sanctum TodoWrite items

## Troubleshooting

If project-specific commands like `make` or `npm` are unavailable, verify the environment setup against the `README`. For permission errors, check write access to build directories. If a step fails without clear output, retry the command with verbose flags to inspect the logs.
