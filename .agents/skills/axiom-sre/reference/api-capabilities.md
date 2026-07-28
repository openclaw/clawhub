# Axiom API Capabilities

Summary of all operations available via Axiom API with a personal access token (PAT).

**Base URL:** `https://api.axiom.co` (for all endpoints except ingestion)  
**Ingest URL:** Use edge deployment domain (e.g., `https://us-east-1.aws.edge.axiom.co`)

**Authentication:**
- PAT: `Authorization: Bearer $PAT` + `x-axiom-org-id: $ORG_ID`
- API Token: `Authorization: Bearer $API_TOKEN`

---

## Querying

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| Run APL query | `POST /v1/datasets/_apl?format=tabular` | Execute APL query with tabular output |
| Run APL query (legacy) | `POST /v1/datasets/_apl?format=legacy` | Execute APL query with legacy output |
| Run query (legacy) | `POST /v1/datasets/{dataset_name}/query` | Legacy query endpoint with filter/aggregation model |

**Query parameters:** `apl`, `startTime`, `endTime`, `cursor`, `includeCursor`, `queryOptions`, `variables`

---

## Datasets

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List datasets | `GET /v1/datasets` | List all datasets in the organization |
| Get dataset | `GET /v1/datasets/{dataset_id}` | Retrieve dataset metadata by ID |
| Create dataset | `POST /v1/datasets` | Create a new dataset |
| Update dataset | `PUT /v1/datasets/{dataset_id}` | Update dataset description, retention |
| Delete dataset | `DELETE /v1/datasets/{dataset_id}` | Permanently delete a dataset |
| Trim dataset | `POST /v1/datasets/{dataset_name}/trim` | Delete data older than specified duration |
| Vacuum dataset | `POST /v1/datasets/{dataset_id}/vacuum` | Reclaim storage space (async operation) |

---

## Ingestion

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| Ingest data (edge) | `POST /v1/ingest/{dataset_id}` | Ingest JSON/NDJSON/CSV via edge endpoint |
| Ingest data (API) | `POST /v1/datasets/{dataset_name}/ingest` | Ingest JSON/NDJSON/CSV via API endpoint |

**Headers:** `X-Axiom-CSV-Fields`, `X-Axiom-Event-Labels`  
**Query params:** `timestamp-field`, `timestamp-format`, `csv-delimiter`  
**Formats:** JSON, NDJSON, CSV

---

## Fields

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List fields | `GET /v1/datasets/{dataset_id}/fields` | List all fields in a dataset |
| Get field | `GET /v1/datasets/{dataset_id}/fields/{field_id}` | Get field metadata |
| Update field | `PUT /v1/datasets/{dataset_id}/fields/{field_id}` | Update field description, unit, hidden status |

---

## Map Fields

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List map fields | `GET /v1/datasets/{dataset_id}/mapfields` | List fields marked as maps |
| Create map field | `POST /v1/datasets/{dataset_id}/mapfields` | Mark a field as a map type |
| Update map fields | `PUT /v1/datasets/{dataset_id}/mapfields` | Replace entire list of map fields |
| Delete map field | `DELETE /v1/datasets/{dataset_id}/mapfields/{map_field_name}` | Remove map field designation |

---

## Virtual Fields

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List virtual fields | `GET /v1/vfields?dataset={dataset}` | List virtual fields for a dataset |
| Get virtual field | `GET /v1/vfields/{id}` | Get virtual field by ID |
| Create virtual field | `POST /v1/vfields` | Create computed field with APL expression |
| Update virtual field | `PUT /v1/vfields/{id}` | Update virtual field expression |
| Delete virtual field | `DELETE /v1/vfields/{id}` | Delete virtual field |

---

## Annotations

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List annotations | `GET /v1/annotations` | List all annotations (filter by datasets, start, end) |
| Get annotation | `GET /v1/annotations/{id}` | Get annotation by ID |
| Create annotation | `POST /v1/annotations` | Create annotation marking an event on charts |
| Update annotation | `PUT /v1/annotations/{id}` | Update annotation properties |
| Delete annotation | `DELETE /v1/annotations/{id}` | Delete annotation |

**Fields:** `datasets[]`, `type`, `time`, `endTime`, `title`, `description`, `url`

---

## Monitors (Alerts)

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List monitors | `GET /v1/monitors` | List all configured monitors |
| Get monitor | `GET /v1/monitors/{id}` | Get monitor configuration |
| Get monitor history | `GET /v1/monitors/{id}/history` | Get alert history for a monitor |
| Create monitor | `POST /v1/monitors` | Create new monitor (Threshold/MatchEvent/AnomalyDetection) |
| Update monitor | `PUT /v1/monitors/{id}` | Update monitor configuration |
| Delete monitor | `DELETE /v1/monitors/{id}` | Delete monitor |

**Monitor types:** `Threshold`, `MatchEvent`, `AnomalyDetection`  
**Operators:** `Below`, `BelowOrEqual`, `Above`, `AboveOrEqual`, `AboveOrBelow`

---

## Notifiers

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List notifiers | `GET /v1/notifiers` | List all notification channels |
| Get notifier | `GET /v1/notifiers/{id}` | Get notifier configuration |
| Create notifier | `POST /v1/notifiers` | Create notification channel |
| Update notifier | `PUT /v1/notifiers/{id}` | Update notifier configuration |
| Delete notifier | `DELETE /v1/notifiers/{id}` | Delete notifier |

**Channel types:** Slack, Email, PagerDuty, OpsGenie, Discord, Microsoft Teams, Custom Webhooks

---

## Saved Queries

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List saved queries | `GET /v1/apl-starred-queries` | List saved/starred APL queries |
| Get saved query | `GET /v1/apl-starred-queries/{id}` | Get saved query by ID |
| Create saved query | `POST /v1/apl-starred-queries` | Save an APL query |
| Update saved query | `PUT /v1/apl-starred-queries/{id}` | Update saved query |
| Delete saved query | `DELETE /v1/apl-starred-queries/{id}` | Delete saved query |

**Query params:** `limit`, `offset`, `dataset`, `who` (`team`/`all`/user ID), `qs`

---

## Views

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List views | `GET /v1/views` | List all views |
| Get view | `GET /v1/views/{id}` | Get view by ID |
| Create view | `POST /v1/views` | Create a view (pre-filtered dataset) |
| Update view | `PUT /v1/views/{id}` | Update view configuration |
| Delete view | `DELETE /v1/views/{id}` | Delete view |

**Fields:** `name`, `aplQuery`, `datasets[]`, `description`

---

## API Tokens

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List tokens | `GET /v1/tokens` | List all API tokens |
| Get token | `GET /v1/tokens/{id}` | Get token metadata (not the token value) |
| Create token | `POST /v1/tokens` | Create new API token with capabilities |
| Regenerate token | `POST /v1/tokens/{id}/regenerate` | Regenerate token value |
| Delete token | `DELETE /v1/tokens/{id}` | Delete API token |

**Capabilities:** `datasetCapabilities`, `orgCapabilities`, `viewCapabilities`

---

## Users

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| Get current user | `GET /v1/user` | Get authenticated user info (PAT only) |
| Update current user | `PUT /v1/user` | Update own user profile (PAT only) |
| List users | `GET /v1/users` | List all users in organization |
| Get user | `GET /v1/users/{id}` | Get user by ID |
| Create user | `POST /v1/users` | Invite/create user in organization |
| Update user role | `PUT /v1/users/{id}/role` | Change user's role |
| Remove user | `DELETE /v1/users/{id}` | Remove user from organization |

---

## Organizations

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List orgs | `GET /v1/orgs` | List organizations user belongs to |
| Get org | `GET /v1/orgs/{id}` | Get organization details |
| Create org | `POST /v1/orgs` | Create new organization |
| Update org | `PUT /v1/orgs/{id}` | Update organization name/region |

---

## RBAC - Roles

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List roles | `GET /v1/rbac/roles` | List all roles with permissions |
| Get role | `GET /v1/rbac/roles/{id}` | Get role by ID |
| Create role | `POST /v1/rbac/roles` | Create custom role with capabilities |
| Update role | `PUT /v1/rbac/roles/{id}` | Update role permissions/members |
| Delete role | `DELETE /v1/rbac/roles/{id}` | Delete role |

**Capabilities:** `datasetCapabilities`, `orgCapabilities`, `viewCapabilities`

---

## RBAC - Groups

| Operation | Endpoint | Description |
|-----------|----------|-------------|
| List groups | `GET /v1/rbac/groups` | List all groups |
| Get group | `GET /v1/rbac/groups/{id}` | Get group by ID |
| Create group | `POST /v1/rbac/groups` | Create user group |
| Update group | `PUT /v1/rbac/groups/{id}` | Update group members/roles |
| Delete group | `DELETE /v1/rbac/groups/{id}` | Delete group |

**Fields:** `name`, `description`, `members[]`, `roles[]`

---

## Rate Limits

| Header | Description |
|--------|-------------|
| `X-RateLimit-Scope` | `user` or `organization` |
| `X-RateLimit-Limit` | Max requests per minute |
| `X-RateLimit-Remaining` | Remaining requests in window |
| `X-RateLimit-Reset` | UTC epoch seconds when window resets |
| `X-QueryLimit-Limit` | Query cost limit (GB*ms) |
| `X-QueryLimit-Remaining` | Remaining query capacity |
| `X-QueryLimit-Reset` | UTC epoch seconds when query limit resets |

**Error:** `429 Too Many Requests` when rate limit exceeded

---

## API Reference

Full documentation: https://axiom.co/docs/restapi/introduction

### Common Response Codes
- `200` - Success
- `201` - Created
- `204` - No Content (success, no body)
- `403` - Forbidden (auth failure or insufficient permissions)
- `404` - Not Found
- `429` - Rate Limit Exceeded
