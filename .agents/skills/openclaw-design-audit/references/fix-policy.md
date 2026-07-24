# Audit Fix Policy

An audit may automatically fix a finding only when the change is narrow,
deterministic, and covered by an existing rule.

## Allowed

- replace a raw value with an equivalent canonical semantic token
- replace a new legacy alias with its canonical token
- use an established local primitive instead of a duplicate raw control
- add a missing accessible label when intent is unambiguous
- repair clipping or overflow without changing information architecture
- update the pinned Carapace tag in a dedicated dependency change

## Requires Human Review

- copy, hierarchy, navigation, or information-architecture changes
- new components or abstractions
- broad visual redesign
- deletion of compatibility aliases
- asset or license interpretation
- changes that intentionally alter current rendered behavior

Do not combine unrelated dependency, redesign, and audit fixes in one pull
request. Preserve tests and include real browser evidence for rendered changes.
