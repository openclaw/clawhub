---
name: convex-advisor
description: "Read the Convex deployment's 72h insights (read limits, OCC contention), root-cause each event in code, report evidence-backed perf/cost findings with fixes."
---

<!-- GENERATED from convex-agents content/capabilities/convex-advisor.json — do not edit by hand. -->

# Live-deployment advisor

Static review guesses; the deployment KNOWS. The official Convex MCP ships an `insights` tool with typed 72h health events per function — documentsReadLimit / bytesReadLimit (hard limit hits), documentsReadThreshold / bytesReadThreshold (approaching), occFailedPermanently / occRetried (write contention) — each carrying evidence (table_name, bytes_read, documents_read, occ document id + retry count). The advisor turns each event into a root-caused finding by reading the flagged function's actual code, and emits findings on the findings bus (specs/finding.schema.json) so fixers can be dispatched and launch-readiness can score.

## Workflow

1. GUARD: run deploy-guard step 0-1 — identify + announce the deployment being read. Reading insights/logs on prod is allowed read-only; never enable mutating prod access for an advisory pass.
2. GATHER (deterministic, via the official Convex MCP): `status` → deployment selector; `insights` → the typed 72h events; `tables` → schema + row counts; `functionSpec` → the public/internal surface. The `insights` tool is only available on cloud dev/prod deployments when logged in as a user (not on previews or deploy-key-scoped contexts) and needs ~72h of traffic; if it returns nothing or is unavailable, say so and fall back to offering convex-reviewer — do NOT invent findings.
3. ROOT-CAUSE each insight event by reading the flagged function's code:
   - bytesReadThreshold/Limit or documentsReadThreshold/Limit → look for `.collect()` / unindexed `.filter()` / missing pagination on the named table; the fix is an index + `.withIndex`, `.take(n)`, or `.paginate` (convex-expert patterns), or an aggregate component for counting shapes.
   - occRetried / occFailedPermanently → look for read-modify-write hotspots on the named document (shared counters, status toggles); the fix is @convex-dev/sharded-counter, narrowing the read set, or moving contention to a workpool.
   - repeated failures in `logs` (status: failure) → classify: crash loop in a cron, validator rejections, unhandled error shapes.
4. EMIT findings per specs/finding.schema.json: class perf/correctness/cost, severity from the insight kind (limit hits = high, thresholds = med, retried = med, permanent OCC failure = high), locus {kind: deployment, functionId, tableName}, evidence {kind: insight-event, detail: the raw event}, confidence: confirmed (the event happened — it is not a hypothesis), fixCapability + autofixable where the repair is mechanical.
5. REPORT: findings ranked by severity, each with (a) the runtime evidence in one line ('messages:list read 4.2MB from messages 31× yesterday'), (b) the code-level root cause with file:line, (c) the concrete fix and which capability applies it. Offer to apply fixes; apply only on confirmation, then re-run `insights` after traffic to verify the trend, or re-run the static check immediately.
6. Scope discipline: this is a health/perf/cost pass. Route authz findings to convex-authz, code-idiom findings to convex-reviewer, error triage to sentinel — emit a pointer finding rather than duplicating their work.

## Rules

- Evidence-not-vibes: every finding cites a real insight event, log line, or table stat — if the deployment has no evidence, the advisor has no findings (offer convex-reviewer instead).
- Read-only by construction: an advisory pass never mutates any deployment and never enables prod mutation flags (deploy-guard discipline applies).
- Root-cause in the code before reporting: an insight event names the symptom; the finding must name the line and the mechanism.
- Emit on the findings bus (specs/finding.schema.json), confidence: confirmed — runtime events are facts, not hypotheses.
- Severity from the event kind: limit-hit / permanent-OCC-failure = high; threshold / retried = med.
- Stay in lane: perf/cost/health only — hand authz to convex-authz, style to convex-reviewer, error triage to sentinel.
- Prefer component fixes over hand-rolls when they match (sharded-counter for OCC on counters, aggregate for count scans) — same bias as suggest.
