# controlling-costs

Analyzes Axiom query patterns to find unused data, then builds dashboards and monitors for cost optimization.

## What It Does

- **Query Coverage Analysis** - Parses APL query ASTs to find columns and field values that are ingested but never queried
- **Volume Estimation** - Uses strided sampling to estimate event volume by field value
- **Dashboard** - Deploys cost control dashboard with ingest tracking, waste candidates, and query cost breakdowns
- **Monitors** - Creates 3 cost control monitors (ingest guard + per-dataset spike detection)

## Installation

```bash
npx skills add axiomhq/skills
```

## Prerequisites

- `axiom-sre` skill (for API access)
- `building-dashboards` skill (for dashboard deployment)
- Access to `axiom-audit` and `axiom-history` datasets
- Tools: `jq`, `bc`

The install command above includes all skill dependencies.

## Configuration

Create `~/.axiom.toml` with your Axiom deployment(s):

```toml
[deployments.prod]
url = "https://api.axiom.co"
token = "xaat-your-api-token"
org_id = "your-org-id"
```

- **`org_id`** - The organization ID. Get it from Settings → Organization.
- **`token`** - Use an advanced API token with minimal privileges.

**Tip:** Run `scripts/setup` from the `axiom-sre` skill for interactive configuration.

## Usage

```bash
# Analyze query coverage for a dataset
scripts/analyze-query-coverage <deployment> <dataset>

# Find unqueried values for a specific field
scripts/analyze-query-coverage <deployment> <dataset> <field>

# Deploy cost control dashboard
scripts/deploy-dashboard <deployment>

# List available notifiers
scripts/list-notifiers -d <deployment>

# Create monitors (with optional notifier)
scripts/create-monitors -d <deployment> -a <audit-dataset> -c <contract> [-n <notifier_id>]
```

## Scripts

| Script | Purpose |
|--------|---------|
| `analyze-query-coverage` | Find unused columns and field values |
| `deploy-dashboard` | Deploy cost control dashboard |
| `list-notifiers` | List available notifiers for alerts |
| `create-monitors` | Create 3 cost control monitors |
| `baseline-stats` | Get 30-day usage statistics |
