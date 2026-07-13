# Plugin history loading proof

Fixture: `local-scanned-runtime-plugin` on a real local ClawHub runtime.

- Default detail: 0 release-history requests.
- Versions tab: 1 release-history request, 440 encoded bytes.
- Fresh `#versions` deep link: Versions selected and 1 release-history request, 441 encoded bytes.
- A blocked history request exposed the visible retry state; removing the block and selecting Try again issued 1 successful request, 440 encoded bytes.
- Stale-navigation and retry state transitions are covered by the focused route tests.
