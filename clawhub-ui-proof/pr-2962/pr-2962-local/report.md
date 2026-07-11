# ClawHub UI Proof

Status: pass
Mode: `feature`
Scenario: long catalog names on `/`, `/skills`, and `/plugins`
Candidate: `worktree`
Provider: local ClawHub + local Convex

The automated scenario seeded 120-character skill and plugin display names and
verified that each public catalog route rendered the item while keeping the
owner, category, and popularity columns stable. The full stored names remain
available to the page; only the catalog preview is shortened.

The requested before/after runner could not start because the local Crabbox
binary failed its capability check, so this evidence is candidate-only rather
than presenting an unverified baseline.
