# Discovery Icon Hierarchy

Date: 2026-08-06

ClawHub discovery listings use icons selectively to preserve useful recognition without adding repetitive visual noise.

The protected matrix is:

| Content | Desktop  | Mobile   |
| ------- | -------- | -------- |
| Skills  | No icons | No icons |
| Plugins | Icons    | No icons |

This applies to homepage discovery, dedicated Skills and Plugins browse routes, list and grid layouts, and their loading skeletons. Skeletons must reserve an icon column only where loaded content will render one.

Plugin icons remain useful on desktop because they help users recognize services and integrations. Skill icons are omitted because the catalog does not use them as a meaningful recognition signal. Mobile omits both icon types to prioritize package identity and metadata in the available width.

Intentional changes to this matrix must update the focused discovery tests and this note in the same PR.
