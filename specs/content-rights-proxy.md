# Hermit content-rights proxy

The admin HTTP action at `/api/v1/content-rights` reads one Hermit case or archives one correspondence write. It does not send email.

## Deadline

`HERMIT_CONTENT_RIGHTS_FETCH_TIMEOUT_MS` is 10 seconds. The case GET and the correspondence POST each pass `AbortSignal.timeout` with that value. `proxyResponse` awaits `response.text()` inside the same try, so the deadline covers the response body, not only the headers.

The proxy sends one Hermit request. It does not retry.

A timeout, or any other thrown read, returns HTTP 502 with the text `Hermit content rights service unavailable`. A missing `CLAWHUB_BAN_APPEALS_TOKEN` returns 503 and does not call Hermit.

## Archive recovery

A correspondence POST can return 502 after Hermit has already stored the message or the attachment. The 502 means ClawHub stopped waiting. It does not roll the archive back, and it does not mean a second POST is free of duplicates.

Staff recovery is to open the case, read what Hermit stored, and reconcile that record with the notice that was intended. Repair the archive only after that inspection.

Archiving correspondence and sending email are separate steps. This proxy only archives. A 502 is not a signal to send the email again.
