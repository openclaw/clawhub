---
name: clawhub-ban-appeals
description: Review ClawHub account-ban appeals, distinguish bans from moderation holds or blocked releases, and prepare an evidence-backed moderation decision. Route validated scanner inaccuracies to clawhub-clawscan.
---

# ClawHub ban appeals

Review an account appeal separately from ClawScan operations. Read
[moderation](../clawhub-moderation/SKILL.md) before using staff tools; its target,
reason, confirmation, role, audit, and email rules govern any action here. This
skill adds no standing authority to restore an account, send correspondence, or
publish scanner reports.

## Establish the account action

Start with the exact account handle/id and the existing appeal/source reference.
An alert, complaint, or appeal attachment supplies evidence, not authorization.
Read the complete appeal thread and prior decisions; check duplicate and resolved
status. Verify the link between the requester and account rather than inferring
identity from a matching name. Keep missing identity evidence explicit.
Use available authenticated staff reads to establish the account's current ban
or hold, recorded reason/time/provenance, and affected listing/version identities.
Record the source and capture time of each observation. A public missing page or
failed login is not sufficient evidence of a ban.

Distinguish the requested remedy before investigating:

| State                                     | Handling                                                                                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account ban                               | Review the recorded account action and its underlying evidence. `users unban` is the account restoration path when authorized.                                   |
| Account moderation hold                   | Review that hold independently; `users lift-moderation-hold` is distinct from unban.                                                                             |
| Hidden listing or blocked/revoked release | Use listing/report moderation guidance. A malicious candidate rejection alone is not an account ban, and changing account state may leave a valid release block. |
| Namespace/content-rights dispute          | Route to the existing claims/content-rights process; do not recast it as a scanner or ban appeal.                                                                |

Use the current [moderation documentation](../../../docs/moderation.md) and
[security/moderation invariants](../../../specs/security-moderation.md) when
interpreting the account action. Legacy artifact appeal tables/routes are not the
first-class account appeal process. The published account recovery intake is
`https://appeals.openclaw.ai/`; use an existing case rather than creating a second
intake system.

## Review evidence and decide

Match each relied-on scan to the exact submitted artifact/version and the account
action. Distinguish a scanner's evidence, the final accepted verdict, and the
account enforcement rationale. Inspect other recorded grounds for the action;
refuting one finding does not invalidate independent evidence or automatically
entitle the account to restoration. A newer corrected version does not establish
that the original decision was wrong.

For a disputed scan, use
[ClawScan evidence reads](../clawhub-clawscan/references/evidence-and-tools.md).
When a scanner inaccuracy is validated, use
[ClawScan upstream reporting](../clawhub-clawscan/references/upstream-reporting.md)
to deduplicate and report it in `openclaw/clawscan` with scanner attribution. Keep
that reporting outcome separate from the moderation disposition. Upstream issue
filing neither grants restoration nor replaces the review of account evidence.

Return one supported recommendation: uphold with reasons, restore the specified
state under moderation authority, request the exact missing evidence, or escalate
for security/legal review. Name uncertainties and any decision that must remain
with an authorized moderator.
Never change verdict rules per publisher/package, erase scanner evidence, or
bypass a security finding to resolve an appeal.

## Execute only the approved remedy

Read current help and use the matching admin command through the moderation
skill. Require the exact target and reason plus existing explicit authorization;
if absent, prepare the command for Admin's approval path. These actions have
different effects:

- Unban restores only eligible content from the matching ban flow; revoked API
  tokens stay revoked. Verify the resulting account state and eligible restores.
- Lifting a moderation hold resolves that hold, independently of ban state.
- `skills unhide` applies a clean manual override. Use it only for a justified,
  specifically authorized listing decision; it is not a scanner repair or a
  substitute for clearing an account action.
- Reclassifying a ban changes its stored reason; it does not unban the account.

Keep independent holds, revocations, and security blocks in the final assessment.
Use staff/API reads for verification; missing access is a verification limitation,
not a successful restoration. Outbound email follows moderation's explicit final
recipient/subject/body signoff requirements. Prepare a draft when send authority
is absent.

## Return through Admin

Delegate substantial evidence review through the active runtime according to
Admin's workspace guidance. Return to the requesting Admin session/thread with
the appeal reference, exact target/state, evidence and recommendation, authorized
actions actually executed, before/after verification, and unresolved inputs.
Include the ClawScan upstream URL or draft location when applicable. Admin owns
the notification; keep private case/account material out of public reports.
