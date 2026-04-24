## Summary

- show only tags that point at the latest skill version in the public detail-page tag surfaces
- move older tag mappings into a separate manager-only "Historical tags" section so they are no longer mixed with current metadata
- add focused detail-page tests covering both the public filtering behavior and the manager-only historical tag view

## Root Cause

The skill detail page rendered every entry from `skill.tags`, even though that map can intentionally retain tag pointers for older versions. After metadata refreshes, the page mixed current tags with historical tags because it did not filter by `latestVersionId`.

## User Impact

Publishers and visitors now see the current/latest tag set on the detail page instead of a noisy blend of old and new metadata. Managers still keep visibility into historical tag mappings and can delete them from the same page.

## Validation

- Unable to run `vitest` locally in this checkout because `bun` is not installed and `node_modules` is missing.
