---
module: session-extraction
category: data-gathering
dependencies: []
estimated_tokens: 400
---

# Session Extraction Checklist

Run these commands and capture the output. This is the raw
material the narrative is built from.

## Git History

```bash
# Commits this session (adjust date/hash as needed)
git log --oneline --stat HEAD~20..HEAD

# Files changed summary
git diff --stat <start_commit>..HEAD

# Diff size
git diff --shortstat <start_commit>..HEAD
```

Capture: commit messages, files touched, insertions/deletions.

## Codebase Metrics

```bash
# Lines of code (adjust extension for language)
find . -name "*.rs" -not -path "*/target/*" | xargs wc -l | tail -1
find . -name "*.py" -not -path "*venv*" | xargs wc -l | tail -1
find . -name "*.ts" -not -path "*node_modules*" | xargs wc -l | tail -1

# File count
find . -name "*.rs" -not -path "*/target/*" | wc -l

# Test count
cargo test 2>&1 | grep "test result"
# or: pytest --co -q 2>&1 | tail -1
# or: npm test 2>&1 | grep "Tests:"
```

Capture: total lines, file count, test count + pass/fail.

## Architecture

```bash
# Directory tree (depth 3)
find . -type d -not -path "*/target/*" -not -path "*node_modules*" \
  -maxdepth 3 | sort

# Key config files
cat Cargo.toml  # or package.json, pyproject.toml
```

Capture: project structure, dependency count, crate/package organization.

## Build and Runtime

```bash
# Build output (note timing)
time cargo build --release 2>&1 | tail -5

# Binary/artifact size
ls -lh target/release/*.wasm dist/*.html 2>/dev/null
```

Capture: build time, artifact sizes.

## Conversation Context

These come from the session itself, not from commands:

- **Initial goal** — what the user asked for
- **Constraints** — time, tech stack, compatibility requirements
- **Key decisions** — why X over Y at each fork
- **Pivots** — where the plan changed and why
- **Blockers hit** — what went wrong and how it was resolved
- **Tools used** — parallel agents, specific skills invoked

## Output Format

Compile extraction results into a structured brief:

```markdown
## Session Brief

**Goal**: [one sentence]
**Duration**: [approximate]
**Starting state**: [what existed before]

### Metrics
- Lines written: X
- Files created/modified: Y
- Tests: Z passing

### Key commits
1. [hash] [message] — [significance]
2. ...

### Decisions
1. [decision] because [reason]
2. ...

### Pivots
1. [what changed] because [what happened]
2. ...
```
