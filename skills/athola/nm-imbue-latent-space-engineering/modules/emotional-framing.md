---
name: emotional-framing
description: Guidelines for instruction tone in skills and agent prompts.
  Replace threat language with confident framing for better agent
  performance.
parent_skill: imbue:latent-space-engineering
category: methodology
estimated_tokens: 250
---

# Emotional Framing

## Principle

Calm, confident instructions produce better results than threats or
fear-based prompting. Agents under stress (threat-heavy prompts) rush,
cut corners, and produce lower-quality output.

## Anti-Patterns (Replace These)

| Threat Pattern | Problem |
|----------------|---------|
| "You MUST do X or the system will fail" | Creates urgency that bypasses careful reasoning |
| "CRITICAL: failure to comply will..." | Frames task as punishment avoidance |
| "WARNING: do NOT deviate from..." | Implies deviation is the default |
| "NEVER do X under ANY circumstances" | Absolute prohibitions invite edge-case failures |
| "This is your LAST CHANCE to..." | Artificial scarcity degrades quality |

## Preferred Patterns (Use These)

| Confident Pattern | Why It Works |
|-------------------|-------------|
| "You've got this. Take your time with X." | Encourages careful reasoning |
| "Focus on getting X right. The details matter here." | Directs attention without threat |
| "This is important work. Here's what good looks like..." | Sets positive exemplar |
| "Take a careful look at X before proceeding." | Promotes deliberation |
| "Your goal is to produce Y. Here's the approach..." | Outcome-focused, not fear-focused |

## Checklist for Skill Authors

1. Read your prompt aloud. Does it sound threatening?
2. Count urgency markers (MUST, NEVER, CRITICAL, WARNING). Are they
   justified by genuine safety constraints?
3. Replace threat language with confidence language.
4. Keep urgency markers for genuine safety constraints only
   (e.g., "NEVER commit secrets to git" is valid).

## When Urgency IS Appropriate

Some constraints are genuinely critical:

- Security boundaries (secret handling, auth)
- Data loss prevention (destructive operations)
- Constitutional rules (human approval requirements)

For these, urgency markers are appropriate. The test: would violating
this instruction cause real harm? If yes, keep the strong language.
If no, soften it.
