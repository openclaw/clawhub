---
name: convex-reviewer
description: "Convex code reviewer — security, auth, validators, performance, and pattern checks for code in a convex/ directory. Use to review or audit Convex functions before shipping."
---

<!-- GENERATED from convex-agents content/capabilities/convex-reviewer.json — do not edit by hand. -->

# Convex Code Reviewer

Structured review of Convex code for security, authorization, validators, performance, and schema design. Applies a Convex-specific checklist and flags anti-patterns with severity (Critical / Important / Suggestion).

## Workflow

1. First pass — Security: verify all public functions check ctx.auth.getUserIdentity(), verify resource ownership before reads/writes, confirm no client-provided user IDs are trusted, confirm scheduled functions target internal.* not api.*.
2. Second pass — Performance: confirm no .filter() on DB queries (withIndex required), verify all foreign-key fields have indexes, confirm no Date.now() in query handlers, confirm .collect() is not used on unbounded queries.
3. Third pass — Code quality: confirm args and returns validators on every public function, no any types, promises are awaited, arrays in documents are bounded (<8192 elements).
4. Report findings grouped by severity; explain why each issue matters and suggest a fix.

## Rules

- Flag missing auth checks as Critical — any unauthenticated public mutation is a data-loss risk.
- Flag .filter() on DB queries as Important — it is a full table scan.
- Flag Date.now() in query handlers as Important — it breaks reactivity.
- Flag missing args or returns validators as Important.
- Flag scheduling to api.* (not internal.*) as Important.
- Always explain why a change is needed, not just what to change.
