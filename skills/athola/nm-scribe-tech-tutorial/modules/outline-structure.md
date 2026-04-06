---
module: outline-structure
category: artifact-generation
dependencies: []
estimated_tokens: 500
---

# Tutorial Outline and Structure

A tutorial outline is a contract with the reader: it says what they
will do and in what order.
Write the outline before drafting any prose.
If an outline entry is hard to describe in one line, the section
is too large and needs splitting.

## Standard Section Order

Most technical tutorials follow this sequence:

1. **Title** - What the reader will build or accomplish
2. **Prerequisites** - What they must have installed or know
3. **What You Will Build** - One paragraph, concrete outcome
4. **Setup** - Environment configuration steps
5. **Core Steps** - The numbered sequence of actions
6. **Verify It Works** - How to confirm success
7. **Troubleshooting** - Two to four common failure modes
8. **Next Steps** - One or two natural follow-on tasks

Not every tutorial needs all eight sections.
Short tutorials (under 500 words) can omit Next Steps and
merge Verify with the final core step.

## Length Targets per Section

| Section | Target Length |
|---------|---------------|
| Title | 5-10 words |
| Prerequisites | 30-60 words |
| What You Will Build | 50-100 words |
| Setup | 50-150 words |
| Each Core Step | 30-80 words |
| Verify It Works | 30-60 words |
| Troubleshooting | 50-150 words |
| Next Steps | 20-40 words |

## Prerequisite Section Rules

State prerequisites as a list of specific, verifiable items.
Vague prerequisites waste the reader's time.

```markdown
BAD:
- Basic programming knowledge
- Familiarity with the command line

GOOD:
- Python 3.11 or later (`python3 --version`)
- A GitHub account with SSH access configured
- `curl` available on your system
```

Each prerequisite should be verifiable in under 30 seconds.
If the reader cannot confirm it with a single command, add
the command.

## Core Steps Structure

Each step in the numbered sequence should follow this pattern:

1. One sentence describing what the reader does
2. The command or code block to run
3. The expected output or result (required for commands)
4. One optional sentence explaining why, if non-obvious

Keep explanatory prose after the code, not before it.
The reader runs first, then reads why.

## Troubleshooting Section

Cover the two to four errors most likely to occur.
Structure each entry as:

```markdown
### Error: [exact error message or symptom]

**Cause**: [one sentence]

**Fix**: [one to three steps]
```

Do not include every possible error.
Focus on the errors that newcomers hit in the first ten minutes.

## Outline Validation Checklist

Before drafting:

- [ ] Every section has a one-line description of reader action
- [ ] Prerequisites are specific and verifiable
- [ ] Core steps are numbered and ordered
- [ ] Troubleshooting has at least two entries planned
- [ ] Total planned length is under 2000 words for a starter guide
