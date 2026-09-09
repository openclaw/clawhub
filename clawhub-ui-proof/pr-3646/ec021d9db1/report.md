# Plugin catalog visibility browser proof

Captured from real ClawHub at http://127.0.0.1:3197/plugins using disposable Playwright Chromium (1440×1000), with local Convex anonymous-agent at http://127.0.0.1:3297 (HTTP port 3298).

Baseline: 39ff7db30c2e86beb75ae180f4fdcc85e5b27a6e.
Candidate: ec021d9db1b0087ccab14f94bfd31d726848022a.

The same local database was used for both revisions. Fixture owner was connected to the existing dev-persona admin login as @local-admin before both captures. No production records were changed. The baseline and candidate used their own existing stats recount to show matching totals.

Fixtures: private whatsapp reservation; public whatsapp-reserved; pending first release whatsapp-pending; whatsapp-empty-version; published private whatsapp-private; soft-deleted whatsapp-hidden; malicious whatsapp-blocked; published @openclaw/whatsapp and whatsapp-bundle. Created timestamps are intentionally synthetic fixture timestamps.

- Anonymous and signed-in catalog before: 5 entries, including empty-version, pending, and reserved placeholders.
- Anonymous and signed-in catalog after: 2 entries, only @openclaw/whatsapp and whatsapp-bundle. Public total also 2.
- Signed-in owner dashboard at http://127.0.0.1:3197/dashboard retains all 8 non-deleted owned records, including the private whatsapp reservation and published whatsapp-private. The blocked release remains listed for owner attention. This is the separate management surface, not normal discovery.
- Paired HTTP responses also reproduce and resolve the authenticated /api/v1/plugins/search?q=whatsapp leak. Existing automated regression coverage verifies authorized explicit channel=private requests and the staff-only moderation queue.

All images are unmodified screenshots from the running browser. They contain only synthetic fixture data. The temporary local fixture helper was removed and the worktree restored exactly to the candidate commit before candidate captures.
