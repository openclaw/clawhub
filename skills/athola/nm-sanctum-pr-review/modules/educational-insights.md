---
name: educational-insights
description: >-
  Enrich PR review findings with educational context:
  why the fix matters, proof via best-practice links,
  and teachable moments that grow the implementer.
parent_skill: sanctum:pr-review
category: review-infrastructure
tags: [education, insights, best-practices, teaching]
estimated_tokens: 300
---

# Educational Insights for PR Review Findings

Every finding in a PR review is a learning opportunity.
Each reported issue, suggestion, or error MUST include
educational context so the review improves both the code
and the person who wrote it.

## The Three Pillars

Each finding includes three educational elements:

| Pillar | Purpose | Content |
|--------|---------|---------|
| **Why It Matters** | Explain the principle | 1-2 sentences on the underlying concept |
| **Proof** | Link to authoritative source | URL to docs, standard, or guide |
| **Teachable Moment** | Generalize the lesson | How this pattern applies beyond this PR |

## Enriched Finding Format

Every finding entry (BLOCKING, IN-SCOPE, SUGGESTION)
MUST use this extended format:

```markdown
1. [S1] Missing input validation on user-supplied path
   - **Location**: `api/handlers.py:45`
   - **Issue**: Path traversal possible via `../` in filename
   - **Why**: Unsanitized file paths allow directory traversal
     attacks (CWE-22). An attacker can read or overwrite
     files outside the intended directory.
   - **Proof**: [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
   - **Teachable Moment**: Always normalize paths with
     `os.path.realpath()` and verify they stay within the
     expected root. This applies to any function accepting
     file paths from external input.
   - **Fix**:
     ```python
     real = os.path.realpath(user_path)
     if not real.startswith(allowed_root):
         raise ValueError("Path outside allowed directory")
     ```
```

## How to Source Proof Links

Use authoritative references in this priority order:

1. **Language/framework docs** (python.org, docs.rs,
   developer.mozilla.org)
2. **Security standards** (OWASP, CWE, NIST)
3. **Style guides** (PEP 8, Google Style Guide, Effective Go)
4. **Well-known articles** (Martin Fowler, Dan Abramov,
   Kent Beck)
5. **RFCs and specifications** (IETF RFCs, W3C specs)

When no authoritative URL exists, cite the principle by
name (e.g., "Liskov Substitution Principle") and briefly
explain it inline.

## Insight Depth by Classification

| Classification | Insight Depth | Proof Required |
|---------------|--------------|----------------|
| **BLOCKING** | Full (why + impact + fix) | Yes, with link |
| **IN-SCOPE** | Standard (why + fix) | Yes, with link |
| **SUGGESTION** | Brief (why + alternative) | Optional |
| **BACKLOG** | One-liner rationale | No |

BLOCKING and IN-SCOPE findings always include proof links.
SUGGESTION findings include them when a well-known source
exists. BACKLOG items need only a brief rationale since
they become separate issues with their own context.

## Anti-Patterns

### Don't: Lecture Without Context
> "You should use `pathlib` instead of `os.path`."

**Do:** Explain why:
> "`pathlib` provides object-oriented path handling that
> prevents string concatenation bugs (PEP 428). It also
> makes path operations cross-platform by default."

### Don't: Link Without Explaining
> "See https://owasp.org/..."

**Do:** Summarize what the link teaches:
> "OWASP classifies this as CWE-22 (Path Traversal).
> The linked guide shows three defense layers:
> canonicalization, allowlisting, and sandboxing."

### Don't: Over-Teach on Trivial Findings
> [Three paragraphs explaining why a typo matters]

**Do:** Match depth to severity. A typo fix needs one line,
not a lecture.

## Integration with Phase 6 Report

The Phase 6 report template already groups findings by
classification. Educational insights are embedded inline
within each finding, not in a separate section. This
keeps the insight next to the code it explains, making
the review scannable and the lessons immediately visible.

## Exit Criteria

- [ ] Every BLOCKING finding has Why + Proof + Teachable Moment
- [ ] Every IN-SCOPE finding has Why + Proof
- [ ] SUGGESTION findings have Why (Proof if available)
- [ ] Proof links are to authoritative, stable URLs
- [ ] Insights explain the principle, not just the symptom
