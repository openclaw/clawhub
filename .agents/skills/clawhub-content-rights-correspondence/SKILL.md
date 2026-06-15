---
name: clawhub-content-rights-correspondence
description: Use when drafting, sending, or preserving email correspondence for an existing ClawHub content rights case.
---

# ClawHub Content Rights Correspondence

Use the bundled script for every existing-case email. It fetches the requester
from Hermit, uses ClawHub's guarded generic email command, and records the exact
sent correspondence back through Hermit.

## Safety Rules

- Require an existing `CHR-...` case. Never create cases with this skill.
- Dry-run first and show the final recipient, subject, and body.
- Send only after explicit user signoff on that final draft.
- Never call Hermit or access R2 directly. Use authenticated `clawhub-admin`;
  ClawHub proxies approved case operations to Hermit.
- Do not retry after an email was sent if evidence recording fails; report the
  failure so staff can repair the audit record without sending a duplicate.
- `--attachment` files are archived with the correspondence. The generic email
  template does not send file attachments.

## Workflow

1. Write the exact email body to a local text file.
2. Preview:

```bash
bun .agents/skills/clawhub-content-rights-correspondence/scripts/send-correspondence.ts \
  CHR-000007 --subject "Re: CHR-000007" --body-file /tmp/body.txt
```

3. Show the preview and obtain explicit user signoff.
4. Send and preserve:

```bash
bun .agents/skills/clawhub-content-rights-correspondence/scripts/send-correspondence.ts \
  CHR-000007 --subject "Re: CHR-000007" --body-file /tmp/body.txt \
  --attachment /tmp/evidence.pdf --send --confirm-user-signoff
```

For inbound correspondence that has already been received, append it without
sending:

```bash
bun run admin -- content-rights record-correspondence CHR-000007 \
  --direction inbound --to "ClawHub <noreply@notifications.openclaw.ai>" \
  --from "Requester <legal@example.com>" --subject "Re: CHR-000007" \
  --body-file /tmp/inbound.txt --attachment /tmp/evidence.pdf
```

Run from the ClawHub repository root with the normal authenticated admin CLI.
