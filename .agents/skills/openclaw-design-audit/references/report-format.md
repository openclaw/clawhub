# Audit Report Format

Produce both `design-audit.json` and `design-audit.md`.

## JSON

```json
{
  "designSystemVersion": "v0.0.3",
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
      "reference": "openclaw-design-system/references/tokens.md"
    }
  ]
}
```

Sort findings by severity, rule ID, file, then line. Keep stable IDs so recurring
automation can compare runs.

## Markdown

Include:

1. audited design-system version and consumer SHA
2. validation commands and rendered routes
3. count by severity
4. every error
5. at most five warning or informational findings
6. count of additional non-error findings not expanded

Use repository-relative file links. State explicitly when no significant drift
was found.
