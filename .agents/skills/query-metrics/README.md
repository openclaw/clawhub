# query-metrics

Runs metrics queries against Axiom MetricsDB and discovers available metrics, tags, and tag values.

## What It Does

- **Dataset Discovery** - List datasets with edge deployment info, auto-resolve regional edge URLs
- **Metrics Queries** - Execute queries against OpenTelemetry metrics stored in Axiom MetricsDB
- **Discovery** - List metrics, tags, and tag values in a dataset before writing queries
- **Search** - Find metrics matching a known tag value (e.g., a service name)
- **Spec** - Fetch the self-describing query specification with syntax and examples

## Installation

```bash
# Amp
amp skill add axiomhq/skills/query-metrics

# npx (Claude Code, Cursor, Codex, and more)
npx skills add axiomhq/skills -s query-metrics
```

## Prerequisites

- Target dataset must be of kind `otel:metrics:v1`
- Tools: `jq`, `curl`

## Configuration

Create `~/.axiom.toml` with your Axiom deployment(s):

```toml
[deployments.prod]
url = "https://api.axiom.co"
token = "xaat-your-api-token"
org_id = "your-org-id"
```

Get your org_id from Settings → Organization. For the token, create a scoped **API token** (Settings → API Tokens) with the permissions your workflow needs. Avoid Personal Access Tokens for automated tooling.

**Tip:** Run `scripts/setup` from the `axiom-sre` skill for interactive configuration.

## Usage

```bash
# Setup and check requirements
scripts/setup

# List all datasets (with edge deployment info)
scripts/datasets prod

# List only metrics datasets
scripts/datasets prod --kind otel:metrics:v1

# Fetch the metrics query spec
scripts/metrics-spec prod

# List available metrics in a dataset
scripts/metrics-info prod my-dataset metrics

# List tags and tag values
scripts/metrics-info prod my-dataset tags
scripts/metrics-info prod my-dataset tags service.name values

# Find metrics matching a value
scripts/metrics-info prod my-dataset find-metrics "frontend"

# Run a metrics query
scripts/metrics-query prod \
  '`my-dataset`:`http.server.duration` | align to 5m using avg | group by `endpoint` using sum' \
  '2025-06-01T00:00:00Z' '2025-06-02T00:00:00Z'
```

## Scripts

| Script | Purpose |
|--------|---------|
| `setup` | Check requirements and config |
| `datasets` | List datasets with edge deployment info |
| `metrics-spec` | Fetch metrics query specification |
| `metrics-query` | Execute a metrics query (auto-resolves edge deployment) |
| `metrics-info` | Discover metrics, tags, and values (auto-resolves edge deployment) |
| `resolve-url` | Resolve dataset to edge deployment URL |
| `axiom-api` | Low-level authenticated API calls |

## Related Skills

- `axiom-sre` - For running APL log queries and schema discovery
- `building-dashboards` - For creating dashboards that include metrics panels
