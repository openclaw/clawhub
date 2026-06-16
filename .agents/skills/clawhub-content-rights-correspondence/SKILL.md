---
name: clawhub-content-rights-correspondence
description: Use when drafting, sending, or preserving email correspondence for an existing ClawHub content rights case.
---

# ClawHub Content Rights Correspondence

Use ClawHub's authenticated admin CLI commands directly. Do not use helper
scripts, direct Hermit calls, or direct R2 access for correspondence.

## Safety Rules

- Require an existing `CHR-...` case. Never create cases with this skill.
- Dry-run first and show the final recipient, subject, and body.
- Send only after explicit user signoff on that final draft.
- Use `bun run admin -- email send` for outbound email.
- Use `bun run admin -- content-rights record-correspondence` to preserve the
  exact correspondence in Hermit.
- Do not retry after an email was sent if evidence recording fails; report the
  failure so staff can repair the audit record without sending a duplicate.
- `--attachment` files are archived with the correspondence. The generic email
  template does not send file attachments.
- The generic email template already adds the greeting. Do not add `Hello ...`
  or `Hi ...` to the body file.
- The generic email template may render the subject as a visible heading. Do
  not pass `--title`, and do not duplicate the title in the body file.
- Do not use the generic email action button for ClawHub content-rights
  responses. Put the response form URL as plaintext in the body.

## Publisher Removal Notice

Use this subject:

```text
ClawHub skill removal notice
```

Use this body, replacing only the skill URL:

```text
We removed the following ClawHub skill after receiving a content rights request involving Rednote/Xiaohongshu platform rights:

https://clawhub.ai/<owner>/<slug>

If you believe this removal was made in error, please submit a response using this form:
https://forms.openclaw.ai/clawhub-content-rights
```

Preview the email:

```bash
bun run admin -- email send \
  --user <publisher-handle> \
  --subject "ClawHub skill removal notice" \
  --body-file /tmp/body.txt
```

Send only after explicit signoff:

```bash
bun run admin -- email send \
  --user <publisher-handle> \
  --subject "ClawHub skill removal notice" \
  --body-file /tmp/body.txt \
  --send \
  --confirm-user-request \
  --confirm-user-signoff \
  --json
```

Record the exact sent correspondence:

```bash
bun run admin -- content-rights record-correspondence CHR-000007 \
  --direction outbound \
  --to "<publisher-handle-or-email>" \
  --from "ClawHub <noreply@notifications.openclaw.ai>" \
  --subject "ClawHub skill removal notice" \
  --body-file /tmp/body.txt \
  --provider-message-id "<providerId-from-send-response>" \
  --json
```

## Requester Status Updates

For requester updates or closure notes, use direct email and avoid exposing the
internal case id in the subject unless the user explicitly asks.

```bash
bun run admin -- email send \
  --to requester@example.com \
  --username Requester \
  --subject "Update on ClawHub content rights request" \
  --body-file /tmp/body.txt
```

Then, after signoff and successful send, record the exact body with the
provider id:

```bash
bun run admin -- content-rights record-correspondence CHR-000007 \
  --direction outbound \
  --to "Requester Name <requester@example.com>" \
  --from "ClawHub <noreply@notifications.openclaw.ai>" \
  --subject "Update on ClawHub content rights request" \
  --body-file /tmp/body.txt \
  --provider-message-id "<providerId-from-send-response>"
```

Verify the case now includes the correspondence:

```bash
bun run admin -- content-rights get CHR-000007 --json
```

Run from the ClawHub repository root with the normal authenticated admin CLI.
