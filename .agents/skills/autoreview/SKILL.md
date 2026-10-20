---
name: autoreview
description: Structured code review through the shared OpenClaw agent-skills installation.
---

# Auto Review

Use the canonical [autoreview skill](https://github.com/openclaw/agent-skills/tree/main/skills/autoreview).
Read the complete installed `~/.agents/skills/autoreview/SKILL.md` and the references
it requires before reviewing. If installed at another operator-selected location,
use that installation. This repository entrypoint contains no review implementation.

If the skill is missing, reuse or clone `https://github.com/openclaw/agent-skills`
and run `python3 scripts/install-skills autoreview` from that checkout. On Windows,
use `python`; `--mode copy` is available when symlinks are unavailable.

Run the shared `scripts/autoreview` helper with Python from the repository being
reviewed, preserving its working directory. Follow this repository's review
requirements in addition to the canonical skill.

For this repository, default to GPT-6.1 Sol with high reasoning and Standard
service. Preserve an explicit user-selected engine, model, effort, or service tier.
For the default Codex route, run:

```bash
python3 "$HOME/.agents/skills/autoreview/scripts/autoreview" \
  --engine codex --model gpt-6.1-sol --thinking high --codex-speed default \
  --max-priority P3 --mode local
```

Use `--mode branch --base origin/main` for the committed branch review.

Keep shared fixes and instructions upstream in `openclaw/agent-skills`. Update
the shared checkout once for all symlinked consumers; reinstall copy-mode skills
after updating their source. Do not add repository-local helpers or test copies.
