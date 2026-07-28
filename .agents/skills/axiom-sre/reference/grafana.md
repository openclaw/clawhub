# Grafana Reference

Query Grafana datasources via the HTTP API.

## Configuration

Configured via `~/.config/axiom-sre/config.toml`:

```toml
[grafana.deployments.prod]
url = "https://myorg.grafana.net"
token = "glsa_xxxx"  # API token for cloud

[grafana.deployments.internal]
url = "https://watchtower.internal.example.com"
access_command = "cloudflared access curl"  # Custom auth wrapper

[grafana.deployments.cloudflare]
url = "https://grafana.cloudflare-protected.example.com"
cf_access_client_id = "abcd1234"
cf_access_client_secret = "efgh5678"

[grafana.deployments.onprem]
url = "https://grafana.corp.example.com"
username = "admin"
password = "secret"
```

## Quick Start

```bash
# List available deployments
scripts/grafana-config

# List datasources
scripts/grafana-datasources prod

# Instant query
scripts/grafana-query prod prometheus 'up{job="axiom-db"}'

# Range query (last N hours) - shows min/max with timestamps
scripts/grafana-query prod prometheus 'rate(http_requests_total[5m])' --range 6h --step 5m

# Absolute time range (for incident investigation)
scripts/grafana-query prod prometheus 'sum(rate(errors_total[5m]))' \
  --start 2026-01-17T04:00:00Z --end 2026-01-17T06:00:00Z --step 5m

# Relative time range
scripts/grafana-query prod prometheus 'up' --start -2h --end -1h --step 1m

# Show all values with timestamps
scripts/grafana-query prod prometheus 'up' --range 1h --step 5m --values

# Raw JSON output
scripts/grafana-query prod prometheus 'up' --range 1h --json

# Check alerts
scripts/grafana-alerts prod firing

# Search dashboards
scripts/grafana-dashboards prod
```

### Query Output

Summary view shows: Samples, Range, **Min/Max with timestamps**, Avg

## Integration with Axiom

Grafana covers Prometheus-native metrics not shipped to Axiom and provides alerts/dashboards. For OTel metrics (application and infrastructure), Axiom MetricsDB (`[MPL]` datasets) is available.

### Available Data Sources

- **Axiom MetricsDB**: OTel metrics — application and infrastructure (MPL)
- **Axiom EventDB**: Logs, traces, error events (APL)
- **Grafana**: Prometheus-native metrics, alerts, dashboards
- **Pyroscope**: CPU and memory flame graphs

### Example: Investigating High Latency

```bash
# 1. Found high latency in axiom-db logs around 14:00 UTC via Axiom

# 2. Check Prometheus for CPU saturation at that time
scripts/grafana-query prod prometheus 'sum(rate(container_cpu_usage_seconds_total{namespace="cloud-prod",pod=~"axiom-db.*"}[5m])) by (pod)' --range 1h --step 1m

# 3. Check memory pressure
scripts/grafana-query prod prometheus 'sum(container_memory_working_set_bytes{namespace="cloud-prod",pod=~"axiom-db.*"}) by (pod)'

# 4. Check if any alerts fired
scripts/grafana-alerts prod firing

# 5. Check service availability
scripts/grafana-query prod prometheus 'up{job=~".*axiom-db.*"}'
```

### Example: Correlating Error Spikes

```bash
# 1. Found 500 errors in edge service via Axiom

# 2. Check error rate in Prometheus
scripts/grafana-query prod prometheus 'sum(rate(http_requests_total{namespace="cloud-prod",status=~"5.."}[5m])) by (job)'

# 3. Check upstream dependencies
scripts/grafana-query prod prometheus 'up{namespace="cloud-prod"} == 0'
```

## Scripts

| Script | Usage |
|--------|-------|
| `scripts/grafana-config` | Show available deployments |
| `scripts/grafana-datasources <env>` | List available datasources |
| `scripts/grafana-query <env> <datasource> <query> [options]` | Query a datasource |
| `scripts/grafana-alerts <env> [state]` | List alerts |
| `scripts/grafana-dashboards <env> [search]` | Search dashboards |
| `scripts/grafana-api <env> <endpoint>` | Raw API calls |

## SRE Methodologies

### RED Method (Services)

| Signal | PromQL Pattern |
|:-------|:---------------|
| **Rate** | `sum(rate(http_requests_total[5m])) by (service)` |
| **Errors** | `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))` |
| **Duration** | `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service))` |

### USE Method (Resources)

| Signal | PromQL Pattern |
|:-------|:---------------|
| **Utilization** | `1 - (rate(node_cpu_seconds_total{mode="idle"}[5m]))` |
| **Saturation** | `node_load1` or `node_memory_MemAvailable_bytes` |
| **Errors** | `rate(node_network_receive_errs_total[5m])` |

## Common PromQL Patterns

### Error Rate

```bash
# HTTP 5xx error rate per service
scripts/grafana-query prod prometheus 'sum(rate(http_requests_total{status=~"5.."}[5m])) by (job)'
```

### Latency

```bash
# P99 latency
scripts/grafana-query prod prometheus 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, job))'
```

### Resource Usage

```bash
# CPU usage by pod
scripts/grafana-query prod prometheus 'sum(rate(container_cpu_usage_seconds_total[5m])) by (pod)'

# Memory usage
scripts/grafana-query prod prometheus 'sum(container_memory_working_set_bytes) by (pod)'
```

## Common Workflows

### Incident Investigation

```bash
# 1. Check what datasources are available
scripts/grafana-datasources prod

# 2. Check if services are up
scripts/grafana-query prod prometheus 'up == 0'

# 3. Check error rates
scripts/grafana-query prod prometheus 'sum(rate(http_requests_total{status=~"5.."}[5m])) by (job) > 0'

# 4. Check active alerts
scripts/grafana-alerts prod firing
```

### Exploring Metrics

```bash
# List all metric names (Prometheus)
scripts/grafana-api prod 'api/datasources/proxy/uid/prometheus/api/v1/label/__name__/values' | jq '.data[]' | head -50

# Get label values
scripts/grafana-api prod 'api/datasources/proxy/uid/prometheus/api/v1/label/job/values'
```

## Grafana API Endpoints

Common endpoints via `scripts/grafana-api`:

| Endpoint | Description |
|----------|-------------|
| `api/datasources` | List all datasources |
| `api/alerts` | Get alert rules |
| `api/alertmanager/grafana/api/v2/alerts` | Get firing alerts |
| `api/search?type=dash-db` | Search dashboards |
| `api/datasources/proxy/uid/<uid>/*` | Proxy to datasource |

## Authentication

Auth is configured per-deployment in `~/.config/axiom-sre/config.toml`. Three methods supported:

1. **API Token** (Grafana Cloud): `token = "glsa_xxxx"`
2. **Basic Auth**: `username` + `password`
3. **Access Command**: `access_command = "cloudflared access curl"` (tunneled access)

If using `access_command`, ensure you're logged in:

```bash
cloudflared access login https://your-grafana-host.example.com
```
