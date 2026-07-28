# Audit Report Format

Produce both `design-audit.json` and `design-audit.md`.

## JSON

```json
{
  "schemaVersion": 2,
  "carapaceVersion": "v0.1.0",
  "designSystemVersion": "v0.1.0",
  "consumerSha": "<sha>",
  "summary": {
    "errors": 0,
    "warnings": 0,
    "info": 0
  },
  "findings": [
    {
      "id": "token/raw-color",
      "severity": "warning",
      "kind": "mechanical",
      "file": "src/example.css",
      "line": 12,
      "message": "Use the semantic accent token.",
      "remediation": "Replace the raw coral value with var(--oc-accent-primary).",
      "reference": "openclaw-carapace/references/tokens.md"
    }
  ]
}
```

During the `v0.1.x` migration, emit both version fields with the same value.
`designSystemVersion` is retained for existing parsers; new consumers should
read `carapaceVersion`.

Sort findings by severity, rule ID, file, then line. Keep stable IDs so recurring
automation can compare runs.

## Markdown

Include:

1. audited Carapace version and consumer SHA
2. validation commands and rendered routes
3. count by severity
4. every error
5. at most five warning or informational findings
6. count of additional non-error findings not expanded

Use repository-relative file links. State explicitly when no significant drift
was found.
