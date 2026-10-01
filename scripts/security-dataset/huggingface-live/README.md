---
language:
  - en
license: mit
size_categories:
  - 10K<n<100K
task_categories:
  - text-classification
task_ids:
  - multi-class-classification
pretty_name: ClawHub Security Signals Live
tags:
  - security
  - llm-security
  - agentic-ai
  - agent-skills
  - openclaw
  - clawhub
  - malware-detection
  - static-analysis
  - software-supply-chain
  - live-dataset
  - weekly
configs:
  - config_name: default
    data_files:
      - split: latest
        path: data/latest.jsonl
---

# ClawHub Security Signals Live

This dataset is the refreshed ClawHub security-signals corpus for scanner testing, prompt regression checks, and operational research against recent public ClawHub skills.

It is a moving dataset, not the fixed paper benchmark. `main` is expected to change when the ClawHub security dataset snapshot workflow publishes a new sanitized export. Pin a Hugging Face revision or commit when you need reproducibility.

For the frozen research-paper snapshot, use [`OpenClaw/clawhub-security-signals`](https://huggingface.co/datasets/OpenClaw/clawhub-security-signals).

## Data Shape

The live dataset exposes one public split:

| Split    | Meaning                                                                                      |
| -------- | -------------------------------------------------------------------------------------------- |
| `latest` | Latest sanitized public ClawHub security-signal rows from the most recent successful export. |

The live split deliberately avoids `train`, `validation`, `test`, and `eval_holdout` names because this corpus is refreshed over time and should not be treated as a stable benchmark unless you pin a specific revision.

## Reproducibility

Each publish writes [`metadata/latest-manifest.json`](metadata/latest-manifest.json) with:

- source snapshot id
- exporter git SHA
- Convex deployment
- redaction policy version
- Hugging Face data commit
- row counts
- split/config names
- output sizes

For stable comparisons, record both the Hugging Face repository commit and the manifest's `huggingface_dataset.commit`.

## Safety

The export path publishes sanitized public data only. It excludes private/deleted artifacts, raw Convex storage identifiers, raw internal document ids, obvious secret-like values, and unsanitized package contents. The workflow validates sanitized output guardrails before upload.

Scanner labels are evidence signals, not human-adjudicated ground truth. A suspicious verdict means review before trusting; it does not by itself prove malicious intent.

## Intended Uses

- testing ClawScan and other agent-skill security scanners against current public registry data
- monitoring scanner drift over time
- building reproducible scanner regression suites by pinning specific dataset revisions
- studying recent public ClawHub security-signal distributions

## Out Of Scope

This live dataset is not intended to replace the frozen paper snapshot, and `main` should not be used as a stable leaderboard target without pinning a commit.

## License

This dataset is released under the MIT license.
