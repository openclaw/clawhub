# Release Failure Triage

A practical triage playbook for CI/CD and release failures.  
Use this skill to quickly classify a failure (code vs infra vs test framework), extract the “signal” from noisy logs, and produce a short, Jira-ready summary with next actions.

## What it does

This skill helps you:
- **Classify failures** into common buckets (e.g., Infra/Env, Test/Framework, Code/Regression, Config/Permissions).
- **Identify the most actionable error lines** (root symptom vs cascading errors).
- **Recommend safe next steps** (retry, rerun specific stage, collect more logs, escalate to infra/tooling, bisect changes).
- **Generate a concise incident summary** suitable for a ticket/comment:
  - *What failed*  
  - *Where it failed (stage/component)*  
  - *Most likely category*  
  - *Evidence (top 3–7 log lines)*  
  - *Recommended action + owner hint*

## When to use

Use this skill when:
- A pipeline fails and you want to know **“is this my change or infra?”**
- A test “passed” but the job failed due to **cleanup/validation/post-steps**
- You need to write a clear update like **“not related to PR, safe to reopen/retry”**
- You want a repeatable triage structure across teams

## Inputs (what you provide)

Provide one or more of the following:
1. **Failure snippet** (preferred): the 30–200 lines around the first error
2. **Stage name** (if known): e.g., “unit tests”, “signing”, “artifact upload”, “cleanup”
3. **Environment hints**: OS/runner type, container vs bare metal, retry count, flaky history (if known)

If you only have one line (e.g., an exception message), provide that—this skill will tell you what additional context to capture.

## How to use (prompts you can copy)

### 1) Quick classification
“Classify this failure (code vs infra vs framework). Highlight the single most important error line and explain why.”
Paste logs:
<PASTE>

### 2) Find the root symptom vs cascade
“Which lines are root cause vs downstream noise? Give me the top 5 lines I should quote in a ticket.”
Paste logs:
<PASTE>

### 3) Safe retry vs needs escalation
“Is a retry reasonable? If yes, what to retry. If no, who should own it and what evidence to attach?”
Paste logs:
<PASTE>

### 4) Jira-ready summary
“Write a Jira comment: 3–6 sentences, clear and technical. Include failure category, evidence, and next step.”
Paste logs:
<PASTE>

### 5) Cleanup/teardown failures
“The test phase passed but cleanup failed. Explain the risk, and what action to take.”
Paste logs:
<PASTE>

## Output format (what you should expect)

When you ask for triage, this skill should respond with:

**A) Classification**
- Category: (Infra/Env | Framework/Test | Code/Regression | Config/Permissions | Unknown)

**B) Evidence**
- 3–7 log lines that support the classification

**C) Likely root cause**
- Plain explanation (1–3 short paragraphs)

**D) Next actions**
- Immediate next step(s) + what to collect if needed

**E) Jira-ready summary (optional)**
- A short comment you can paste into a ticket/thread

## Guardrails / safety

- This skill **does not** instruct you to exfiltrate secrets or paste credentials.
- If logs appear to contain tokens, passwords, or private keys, **redact them** before sharing.
- If the evidence is insufficient, the skill will ask for the minimum additional context (e.g., “first error occurrence” window, stage name).

## Tips for best results

- Include the **first error** (not only the final “job failed” line).
- If there’s a retry history, mention whether **retry changed the error**.
- If you suspect flakiness, include whether the same commit passed recently.

## Changelog

- v0.1.0 — Initial skill: failure categorization, evidence extraction, next-action recommendations, and Jira-ready summaries.
