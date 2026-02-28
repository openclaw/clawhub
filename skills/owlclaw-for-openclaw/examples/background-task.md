# Background Task Example

Prompt:

Create a background task for nightly reconciliation and report status.

Expected outcome:

OpenClaw calls `task_create` first, then `task_status` until task becomes `completed`.

