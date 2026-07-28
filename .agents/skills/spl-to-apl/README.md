# spl-to-apl

Translates Splunk SPL queries to Axiom APL. Provides command mappings, function equivalents, and syntax transformations.

## What It Does

- **Command Mapping** - SPL commands to APL operators (stats→summarize, eval→extend, etc.)
- **Function Translation** - Aggregation and string functions with syntax differences
- **Time Handling** - SPL time pickers to explicit APL time filters
- **Pattern Examples** - Common query patterns side-by-side

## Installation

```bash
# Amp
amp skill add axiomhq/skills/spl-to-apl

# npx (Claude Code, Cursor, Codex, and more)
npx skills add axiomhq/skills -s spl-to-apl
```

## Quick Reference

| SPL | APL |
|-----|-----|
| `index=logs` | `['logs']` |
| `stats count by host` | `summarize count() by host` |
| `eval x = y * 2` | `extend x = y * 2` |
| `table field1, field2` | `project field1, field2` |
| `timechart span=5m count` | `summarize count() by bin(_time, 5m)` |
| `top 10 uri` | `summarize count() by uri \| top 10 by count_` |
| `dedup user` | `summarize arg_max(_time, *) by user` |
| `rex "user=(?<u>\\w+)"` | `extend u = extract("user=(\\w+)", 1, field)` |

## Key Differences

1. **Time is explicit in APL** - Add `where _time between (ago(1h) .. now())`
2. **Parentheses required** - `count()` not `count`
3. **Field escaping** - Use `['field.with.dots']` for dotted fields
4. **Case sensitivity** - Use `_cs` variants for faster queries (`has_cs`, `contains_cs`)

## Configuration

This skill translates queries but doesn't execute them directly. To run translated queries, configure `~/.axiom.toml`:

```toml
[deployments.prod]
url = "https://api.axiom.co"
token = "xaat-your-api-token"
org_id = "your-org-id"
```

Get your org_id from Settings → Organization. For the token, create a scoped **API token** (Settings → API Tokens) with the permissions your workflow needs. Avoid Personal Access Tokens for automated tooling.

## Related Skills

- `axiom-sre` - For running translated queries (includes interactive setup)
- `building-dashboards` - For creating dashboards from translated queries
