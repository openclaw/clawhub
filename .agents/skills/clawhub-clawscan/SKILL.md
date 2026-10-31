---
name: clawhub-clawscan
description: Investigate ClawScan health alerts, diagnose scanner or ClawHub integration failures, prepare operational repairs, and route validated verdict inaccuracies upstream. Account ban appeals use clawhub-ban-appeals.
---

# ClawScan response

Turn an alert or scan complaint into an evidence-backed disposition, an authorized
repair, or a report to the component owner. Run from a ClawHub checkout. This
skill grants no deployment, moderation, publication, or communication authority;
use the authority supplied with the task and the applicable repository skills.

## Intake and delegation

Admin owns intake and the final notification. Delegate substantial investigation
through the **existing runtime** so its main session stays available. Read the
active workspace's delegation guidance and discover its actual session tools
before choosing parameters. Delegating substantial work is instruction/prompt
guidance, shaped by workspace policy and runtime defaults; it is not enforced by
the spawn engine. Session creation, tool access, and delivery are runtime behavior.

Pass the alert permalink, firing time/window, environment, query/run links,
known job or artifact identity, this skill's path, allowed actions, and required
return destination to the worker. Include already-active investigation context
to avoid duplicate repairs. Use native child status and completion handling;
follow the accepted spawn receipt for result delivery. Do not invent a delegation
API, impose a worker cap, add a progress database, or schedule another health job.

Workers return evidence and decisions to the requesting Admin session. Admin
reviews the result and posts the notification in its established thread. A worker
completion establishes neither deployment nor production acceptance.

If the request is an account-ban appeal, route it to
[clawhub-ban-appeals](../clawhub-ban-appeals/SKILL.md). That skill may supply a
scanner inaccuracy for the upstream-reporting branch below; it retains ownership
of the appeal decision.

## Establish what happened

Read [evidence and tools](references/evidence-and-tools.md) for the applicable
read surface. Correlate the alert window with the exact run/job/attempt and a
fresh observation of the same environment. Record observation times, observed
impact, completed versus failed attempts, and current queue/run state when
relevant. Report unavailable coverage explicitly; missing data is not health.

Choose the supported disposition before changing anything:

Record alert validity at firing time separately from actionability now. A real
failure that later recovered remains a true historical failure; describe it as
currently recovered/non-actionable only to the extent fresh evidence supports.

| Disposition                    | Evidence and next action                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Confirmed active incident      | Current evidence corroborates availability, queue, integrity, or security impact. Locate the failing boundary and repair within authority or hand off to its owner.                                    |
| Operational failure            | An attempt timed out, failed a scanner/judge stage, rejected a receipt/schema, or failed claim/upload/completion. Establish current impact and ownership; a failed attempt is not a malicious verdict. |
| Completed-verdict disagreement | The exact artifact has a completed verdict whose accuracy is disputed. Inspect the cited behavior and validate the complaint before reporting an inaccuracy.                                           |
| False or non-actionable alert  | Evidence demonstrates a duplicate, historical/recovered condition, expected behavior, or an incorrect query interpretation. Give the counter-evidence; propose alert correction only if warranted.     |
| Insufficient evidence          | Identify the precise missing run, artifact, current read, or access. Return what is established and the next useful read; leave the unresolved conclusion open.                                        |

A completed malicious or suspicious verdict can be operationally healthy. An
orchestrator that exited successfully can still contain a failed scanner or
unusable judge result. Check the relevant stage and consumer validation, not just
the workflow conclusion. Preserve concurrent valid security findings when one
finding is wrong.

## Attribute the defect

Trace the first failing boundary, using exact input/output evidence and deployed
versions. Separate a confirmed cause from an unverified candidate.

| Owner                          | Boundary to verify                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ClawHub (`openclaw/clawhub`)   | Dispatch, queue/lease handling, artifact construction, worker environment, report mapping/storage, moderation or public trust presentation. A correct raw result mapped incorrectly belongs here. |
| ClawScan (`openclaw/clawscan`) | Native orchestration, built-in static rules, artifact/receipt contract, adapters, or judge synthesis. Attribute downstream evidence separately from the final judge decision.                     |
| NVIDIA SkillSpector            | The `skillspector` report, scanner execution, or native detection. Record whether the fault occurs in upstream code or a ClawScan-maintained adapter/patch.                                       |
| Tencent AIG / AI-Infra-Guard   | The `aig` report or `aig-skill-scan` execution/detection. Distinguish upstream scanner behavior from the local adapter and judge interpretation.                                                  |

An external provider or host dependency can be the operational cause; keep its
attribution explicit rather than forcing it into a scanner verdict defect. If
evidence spans components, name the primary failing boundary and contributing
components. Do not guess an upstream repository from a report's display label.

## Repair or route

For a confirmed repairable defect, use an isolated checkout and the existing
code/test seams. Demonstrate the failure and changed behavior with the same input
or a faithful sanitized regression. Run the touched repository's relevant checks.
For Convex changes, first read
[clawhub-convex](../clawhub-convex/SKILL.md); production deployment follows
[clawhub-production-release](../clawhub-production-release/SKILL.md).

Operational actions such as dispatching workers, rescanning, changing config,
deploying, or restoring content require the task's corresponding authority. A
repair task does not permit new release gates, model/provider changes, broader
security exceptions, or retries until a preferred verdict appears. If another
owner is already repairing the incident, return relevant new evidence to that
owner instead of starting a competing recovery.

### Validated scanner inaccuracies

Read [upstream reporting](references/upstream-reporting.md). Every validated
accuracy complaint is deduplicated and tracked in `openclaw/clawscan`, including
SkillSpector/AIG findings and ClawHub-only verdict mapping defects. For the latter,
tag the report as ClawHub integration and link the primary ClawHub repair; do not
misattribute it to a scanner. Pure operational failures do not require an accuracy
report. Link an existing issue or prepare a new report with
component attribution, exact versions, reproduction, and analysis. Further
reporting to NVIDIA/Tencent follows the component's contribution/security policy
and task authority; preserve the ClawScan tracking link.

Accuracy repair should generalize to the observed failure mechanism. Do not add
per-package verdict exceptions, suppress valid findings, or bypass scanning to
settle a complaint. Account or listing restoration remains a separate moderation
decision.

## Return to Admin

Return a concise result through the runtime's existing parent/session path:

- Disposition, environment, alert/source link, and observation time.
- Confirmed impact and component owner, with evidence links and any uncertainty.
- Repair or report outcome: exact changes/commits, regression before/after,
  checks, existing upstream link or a ready-to-publish draft.
- Actions actually executed versus prepared, current verification limits, and
  any exact missing input or decision needed.

Admin verifies the evidence and uses its normal notification path. Keep private
authority, account identifiers, and deployment configuration in the active
workspace; public skill content is reusable procedure.
