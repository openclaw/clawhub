<!--
Optional linked context:
Add a visible `Closes #<issue-number>` or `Related: #<issue-number>` line
below this comment.

Write for someone who uses ClawHub but has not read the code. The title and
opening problem statement should make sense without the diff or linked issue.

Required PR title:
type: <what changes for the person affected>
Types: feat, fix, improve, refactor, docs, chore.
Use a parenthesized scope only when it helps that reader.

Name the affected task and the symptom or outcome, not the implementation.
Illustrative examples, not reports of current bugs:
Good: fix: explain why a skill upload was rejected
Bad: fix(upload): map validation exceptions to response codes
Good: docs: help publishers preview a plugin before uploading it
Bad: docs: add package publish flag documentation

For internal-only work, name the actual developer or operator workflow affected.

**MUST:** Keep **Allow edits from maintainers** enabled for this PR so maintainers
can help update the branch when needed.
-->

## What Problem This Solves

<!--
Describe the concrete user, product, or operational problem.
In 1–3 short, plain-language sentences, explain what someone is trying to do,
what goes wrong or is missing, and why it matters. For a fix, include the trigger
when known. For other changes, describe the need without inventing a bug.

Illustrative example, not a report of a current bug:
Good: "When a skill upload is rejected, the publisher sees a generic error and
cannot tell what to change before trying again."
Bad: "Fixes incorrect exception mapping in the upload validator."

Describe the experienced problem, not just the code change. Save function names,
missing checks, and the root-cause walkthrough for the explanation below.
-->

## User Impact

<!--
"User impact: <what users, operators, or developers can now do or expect>."
Lead with the concrete outcome in plain language, usually one sentence.
For internal-only changes, say there is no user-visible change; do not invent a benefit.
Keep important risks, breaking changes, migrations, and required user actions visible here.
-->

## Why This Change Was Made

<!--
Briefly explain how the change addresses the problem without repeating the impact.
Keep the body short. Leave file lists, internal acronyms, and root-cause walkthroughs
in the diff or optional <details>; include technical detail only when it explains
behavior or a material tradeoff. Do not hide risks or required actions in <details>.
-->

## Evidence

<!--
Show the most useful proof that this change works. Screenshots, screencasts,
terminal output, focused tests, CI results, live observations, redacted logs,
and artifact links are all useful. Include before/after evidence for visual
changes when it clarifies the result.

Start with the behavior checked and the result in plain language. Reviewers will
inspect the code, tests, and CI; do not make them decode command lists to learn
what was verified. Put exact commands, commit hashes, and long output in links
or optional <details>. Keep the useful evidence summary and meaningful gaps visible.
-->
