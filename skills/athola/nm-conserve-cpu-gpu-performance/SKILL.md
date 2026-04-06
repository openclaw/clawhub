---
name: cpu-gpu-performance
description: |
  Establish CPU/GPU baselines before resource-intensive operations. Use for regression detection
version: 1.8.1
metadata: {"openclaw": {"homepage": "https://github.com/athola/claude-night-market/tree/master/plugins/conserve", "emoji": "\ud83e\udd9e", "requires": {"config": ["night-market.token-conservation"]}}}
source: claude-night-market
source_plugin: conserve
---

> **Night Market Skill** — ported from [claude-night-market/conserve](https://github.com/athola/claude-night-market/tree/master/plugins/conserve). For the full experience with agents, hooks, and commands, install the Claude Code plugin.


## Table of Contents

- [When to Use](#when-to-use)
- [Required TodoWrite Items](#required-todowrite-items)
- [Step 1: Establish Current Baseline](#step-1-establish-current-baseline)
- [Step 2: Narrow the Scope](#step-2-narrow-the-scope)
- [Step 3: Instrument Before You Optimize](#step-3-instrument-before-you-optimize)
- [Step 4: Throttle and Sequence Work](#step-4-throttle-and-sequence-work)
- [Step 5: Log Decisions and Next Steps](#step-5-log-decisions-and-next-steps)
- [Output Expectations](#output-expectations)


# CPU/GPU Performance Discipline

## When To Use
- At the beginning of every session (auto-load alongside `token-conservation`).
- Whenever you plan to build, train, or test anything that could pin CPU cores
  or GPUs for more than a minute.
- Before retrying a failing command that previously consumed significant resources.

## When NOT To Use

- Simple operations with no resource impact
- Quick single-file operations

## Required TodoWrite Items
1. `cpu-gpu-performance:baseline`
2. `cpu-gpu-performance:scope`
3. `cpu-gpu-performance:instrument`
4. `cpu-gpu-performance:throttle`
5. `cpu-gpu-performance:log`

## Step 1: Establish Current Baseline
- Capture current utilization:
  - `uptime`
  - `ps -eo pcpu,cmd | head`
  - `nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv`

  Note which hosts/GPUs are already busy.
- Record any CI/cluster budgets (time quotas, GPU hours) before launching work.
- Set a per-task CPU minute / GPU minute budget that respects those limits.

## Step 2: Narrow the Scope
- Avoid running "whole world" jobs after a small fix. Prefer diff-based
  or tag-based selective testing:
  - `pytest -k`
  - Bazel target patterns
  - `cargo test <module>`
- Batch low-level fixes so you can validate multiple changes with a single targeted command.
- For GPU jobs, favor unit-scale smoke inputs or lower epoch counts before
  scheduling the full training/eval sweep.

## Step 3: Instrument Before You Optimize
- Pick the right profiler/monitor:
  - CPU work:
    - `perf`
    - `intel vtune`
    - `cargo flamegraph`
    - language-specific profilers
  - GPU work:
    - `nvidia-smi dmon`
    - `nsys`
    - `nvprof`
    - DLProf
    - framework timeline tracers
- Capture kernel/ops timelines, memory footprints, and data pipeline latency
  so you have evidence when throttling or parallelizing.
- Record hot paths + I/O bottlenecks in notes so future reruns can jump straight to the culprit.

## Step 4: Throttle and Sequence Work
- Use `nice`, `ionice`, or Kubernetes/Slurm quotas to prevent starvation of shared nodes.
- Chain heavy tasks with guardrails:
  - Rerun only the failed test/module
  - Then (optionally) escalate to the next-wider shard
  - Reserve the full suite for the final gate
- Stagger GPU kernels (smaller batch sizes or gradient accumulation) when memory
  pressure risks eviction; prefer checkpoint/restore over restarts.

## Step 5: Log Decisions and Next Steps

Conclude by documenting the commands that were run and their resource cost
(duration, CPU%, GPU%), confirming whether they remained within the per-task
budget. If a full suite or long training run was necessary, justify why selective
or staged approaches were not feasible. Capture any follow-up tasks, such as
adding a new test marker or profiling documentation, to simplify future sessions.

## Output Expectations
- Brief summary covering:
  - baseline metrics
  - scope chosen
  - instrumentation captured
  - throttling tactics
  - follow-up items
- Concrete example(s) of what ran (e.g.):
  - "reran `pytest tests/test_orders.py -k test_refund` instead of `pytest -m slow`"
  - "profiled `nvidia-smi dmon` output to prove GPU idle time before scaling"
## Troubleshooting

### Common Issues

**Command not found**
Ensure all dependencies are installed and in PATH

**Permission errors**
Check file permissions and run with appropriate privileges

**Unexpected behavior**
Enable verbose logging with `--verbose` flag
