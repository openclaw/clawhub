# Skill Authoring Checklist

Quick-reference validation checklist for skill authors.

## Pre-Development

- [ ] Identified repeated task (done 5+ times, will do 10+ more)
- [ ] Confirmed no existing skill covers this
- [ ] Defined skill type (Technique, Pattern, or Reference)
- [ ] Chosen descriptive gerund-form name

## Frontmatter Validation

- [ ] `name`: ≤64 characters
- [ ] `name`: lowercase letters, numbers, hyphens only
- [ ] `name`: no reserved words (anthropic, claude)
- [ ] `description`: non-empty
- [ ] `description`: ≤1024 characters
- [ ] `description`: third person voice
- [ ] `description`: includes WHAT and WHEN

## Content Quality

- [ ] SKILL.md body under 500 lines
- [ ] Only context Claude doesn't already have
- [ ] Consistent terminology throughout
- [ ] No time-sensitive information
- [ ] Concrete examples, not abstract
- [ ] Clear distinction between skill types

## Structure

- [ ] File references one level deep
- [ ] Long files (>100 lines) have TOC
- [ ] Progressive disclosure pattern used
- [ ] Appropriate freedom level for task type

## TDD Compliance

- [ ] Created 3+ pressure scenarios
- [ ] Ran baseline without skill
- [ ] Documented baseline failures verbatim
- [ ] Tested with skill present
- [ ] Identified rationalizations
- [ ] Added explicit counters

## Anti-Rationalization

- [ ] Listed specific exceptions
- [ ] Created rationalization table
- [ ] Added red flags list
- [ ] Addressed "spirit vs letter" arguments

## Scripts (if applicable)

- [ ] Scripts solve problems, don't punt to Claude
- [ ] Error handling is explicit
- [ ] No "voodoo constants"
- [ ] Required packages listed
- [ ] Clear execute vs read distinction
- [ ] MCP tools use fully qualified names

## Testing

- [ ] Tested with Haiku
- [ ] Tested with Sonnet
- [ ] Tested with Opus
- [ ] Tested real usage scenarios
- [ ] Team feedback incorporated

## Deployment

- [ ] Committed to git
- [ ] Pushed to fork
- [ ] Validated structure passes
- [ ] No narrative storytelling
- [ ] Supporting files justified
