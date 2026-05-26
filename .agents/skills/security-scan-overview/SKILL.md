---
name: security-scan-overview
description: Use when ClawHub staff or agents need production security scan health, ClawScan verdict/category rollups, failed or queued/running scan triage, or per-skill/per-plugin scanner drilldown through clawhub-mod security-scans commands and Convex/API staff surfaces.
---

# Security Scan Overview

Use the repo-local `clawhub-mod` CLI from a checked-out ClawHub repo. Treat
ClawScan/Codex verdict and category fields as the source of truth. Treat
SkillSpector, static scan, VirusTotal, and worker details as supporting
evidence for drilldown and diagnosis.

## Quick Checks

Validate the token and target registry first:

```sh
bun run mod -- whoami
```

For production, the default registry is `https://clawhub.ai`. For local or
staging proof, pass the exact API base:

```sh
bun run mod -- --registry <convex-http-url> whoami
```

## Commands

Overview for skills and plugins:

```sh
bun run mod -- security-scans overview --window-hours 24
bun run mod -- security-scans overview --window-hours 24 --json
```

Current breakdowns by artifact kind or ClawScan verdict/category:

```sh
bun run mod -- security-scans overview --artifact-kind skill
bun run mod -- security-scans list --artifact-kind plugin --verdict malicious --json
bun run mod -- security-scans list --artifact-kind skill --category <clawscan-category-key>
```

Pipeline health:

```sh
bun run mod -- security-scans failed --artifact-kind all --limit 25 --json
bun run mod -- security-scans queued --artifact-kind all --limit 25
bun run mod -- security-scans running --artifact-kind all --limit 25
```

Artifact drilldown:

```sh
bun run mod -- security-scans inspect --skill <slug> --json
bun run mod -- security-scans inspect --plugin <package-name> --json
```

Use `--artifact-kind skill` or `--artifact-kind plugin` with `--cursor` when
paginating. The combined `all` view is a first-page operator summary and should
not be used as a cursor stream.

## Reporting

Report ClawScan first:

- Current verdict totals as `X/Y (Z%)` for pass, suspicious, malicious, pending,
  failed, and unknown.
- ClawScan category rows as category label/key, artifact kind, verdict, and
  count/percentage.
- Last-window health: scan events, queued, running, succeeded, and failed.
- Failed samples with artifact kind, slug/package, version, ClawScan verdict,
  job status, error, and updated time.

For one artifact, summarize:

1. ClawScan verdict/status/category/summary.
2. Worker status, attempts, queue/start/finish/failure times, and last error.
3. SkillSpector score/severity/category as evidence only.
4. Static scan and VirusTotal results as supporting signals.

## Scale And Safety

- Prefer `overview` before `list`; it reads digest rollups instead of paging
  artifact rows.
- Keep `list` limits bounded. Start with 25, increase only when needed, and use
  cursor pagination for skill/plugin-specific streams.
- Do not scrape the management UI for data; use `clawhub-mod` or the
  corresponding `/api/v1/security-scans/*` staff endpoints.
- These commands are read-only. Do not queue rescans or mutate moderation state
  unless the user explicitly asks for that separate action.
- If a result seems stale, say which registry was queried and check whether
  digest backfills or scan workers are currently queued/running before drawing a
  production conclusion.
