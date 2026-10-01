# Dataset Schemas

Output from `['dataset'] | getschema` for Axiom Playground datasets.

## sample-http-logs

```json
[
  {"name": "_time", "type": "datetime"},
  {"name": "_sysTime", "type": "datetime"},
  {"name": "id", "type": "string"},
  {"name": "status", "type": "string"},
  {"name": "method", "type": "string"},
  {"name": "uri", "type": "string"},
  {"name": "req_duration_ms", "type": "real"},
  {"name": "geo.city", "type": "string"},
  {"name": "geo.country", "type": "string"},
  {"name": "is_tls", "type": "bool"},
  {"name": "content_type", "type": "string"},
  {"name": "user_agent", "type": "string"},
  {"name": "server_datacenter", "type": "string"},
  {"name": "resp_body_size_bytes", "type": "int"},
  {"name": "resp_header_size_bytes", "type": "int"}
]
```

## otel-demo-traces

```json
[
  {"name": "_time", "type": "datetime"},
  {"name": "_sysTime", "type": "datetime"},
  {"name": "trace_id", "type": "string"},
  {"name": "span_id", "type": "string"},
  {"name": "parent_span_id", "type": "string"},
  {"name": "service.name", "type": "string"},
  {"name": "span.name", "type": "string"},
  {"name": "span.kind", "type": "string"},
  {"name": "status_code", "type": "string"},
  {"name": "duration", "type": "real"},
  {"name": "attributes", "type": "dynamic"},
  {"name": "resource", "type": "dynamic"}
]
```
