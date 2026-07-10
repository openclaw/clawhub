# axiom-sre

Expert SRE investigator for incidents and debugging. Uses hypothesis-driven methodology and systematic triage. Can query Axiom observability when available.

## What It Does

- **Hypothesis-Driven Investigation** - State, test, disprove hypotheses with data queries
- **Systematic Triage** - Golden signals (traffic, errors, latency, saturation), USE/RED methods
- **Memory System** - Persistent knowledge base for patterns, queries, facts, and incidents
- **Axiom Integration** - Query logs, generate shareable links, discover schemas

## Installation

```bash
# Amp
amp skill add axiomhq/skills/sre

# npx (Claude Code, Cursor, Codex, and more)
npx skills add axiomhq/skills -s sre
```

## Prerequisites

- Access to Axiom deployment(s)
- Tools: `jq`, `curl`

## Setup

Run the interactive setup to configure Axiom access and initialize memory:

```bash
scripts/setup
```

This will:
1. Create the memory system for storing patterns and learnings
2. Guide you through creating `~/.axiom.toml` if it doesn't exist

**To configure manually**, create `~/.axiom.toml`:

```toml
[deployments.prod]
url = "https://api.axiom.co"
token = "xaat-your-api-token"
org_id = "your-org-id"
```

Get your org_id from Settings → Organization. For the token, create a scoped **API token** (Settings → API Tokens) with the permissions your workflow needs. Avoid Personal Access Tokens for automated tooling.

## Usage

The skill activates for incident response, root cause analysis, production debugging, or log investigation. Key scripts:

```bash
# Run APL queries
scripts/axiom-query <deployment> "<apl query>"

# Make API calls
scripts/axiom-api <deployment> GET "/v1/datasets"

# Generate shareable query links
scripts/axiom-link <deployment> "<apl query>" "<time range>"

# Setup personal memory tier
scripts/setup
```

## Scripts

| Script | Purpose |
|--------|---------|
| `axiom-query` | Run APL queries against Axiom |
| `axiom-api` | Make raw API calls |
| `axiom-link` | Generate shareable query URLs |
| `axiom-deployments` | List configured deployments |
| `setup` | Initialize memory system |
| `mem-write` | Write entries to memory KB |
| `mem-sync` | Sync org memory from git |
| `mem-digest` | Consolidate journal to KB |
| `mem-doctor` | Health check all memory tiers |
| `mem-share` | Push org memory changes |

## Key Principles

1. Never guess - query to verify
2. State facts, not assumptions
3. Disprove hypotheses, don't confirm
4. Time filter FIRST in all queries
5. Discover schema before querying unfamiliar datasets
