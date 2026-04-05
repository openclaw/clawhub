# Dependency Detection

How to resolve affected and related plugins for scoped
review.

## Affected Plugins

Detect from git diff against the base branch:

```bash
git diff main --name-only | \
  grep '^plugins/' | \
  sed 's|^plugins/\([^/]*\)/.*|\1|' | \
  sort -u
```

If no diff available (detached HEAD, no main branch),
fall back to all plugins.

## Related Plugins

Load `docs/plugin-dependencies.json` and for each affected
plugin, look up who depends on it:

1. Read the `dependencies` section to find the affected
   plugin
2. If `dependents` is `["*"]`, ALL other plugins are related
3. Otherwise, `dependents` lists the specific related plugins

Example: if `abstract` is affected and has
`dependents: ["*"]`, then all 16 other plugins are related.

If `leyline` is affected and has `dependents: ["conjure"]`,
then only conjure is related.

## Deduplication

A plugin that is both affected (has direct changes) AND
related (depends on another changed plugin) is treated as
affected. The "affected" role always wins.

## Special Cases

- **Root-level changes** (pyproject.toml, Makefile, scripts/):
  These affect the workspace, not individual plugins.
  At branch tier, skip. At pr/release tier, flag for
  manual review.

- **No plugins changed**: If the diff has no plugin changes,
  report "No plugin changes detected" and exit with PASS.

- **New plugin**: If a plugin directory exists on disk but
  is not in `plugin-dependencies.json`, flag it and suggest
  running `scripts/generate_dependency_map.py` to update.
