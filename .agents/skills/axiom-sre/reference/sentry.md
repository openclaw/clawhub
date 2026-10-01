# Sentry API Quick Reference

Use `scripts/sentry-api` for authenticated requests:

```bash
scripts/sentry-api <env> <method> <path> [body]
```

Notes:
- If `<path>` does not start with `/api/0/`, the script adds it automatically.
- Example host is read from config (`[sentry.deployments.<env>].url`).

## Common Endpoints

### List unresolved issues in an org
```bash
scripts/sentry-api prod GET "/organizations/example-org/issues/?query=is:unresolved&sort=freq"
```

### Get issue details
```bash
scripts/sentry-api prod GET "/issues/1234567890/"
```

### List events for an issue
```bash
scripts/sentry-api prod GET "/issues/1234567890/events/"
```

### Get latest event for an issue
```bash
scripts/sentry-api prod GET "/issues/1234567890/events/latest/"
```

### List project events
```bash
scripts/sentry-api prod GET "/projects/example-org/example-project/events/"
```

### List releases
```bash
scripts/sentry-api prod GET "/organizations/example-org/releases/"
```

### List projects in org
```bash
scripts/sentry-api prod GET "/organizations/example-org/projects/"
```

## Useful Query Parameters

- `query=is:unresolved`
- `query=level:error`
- `query=environment:production`
- `query=release:1.2.3`
- `sort=freq` or `sort=date`
- `statsPeriod=24h`
- `cursor=<opaque-pagination-cursor>`
