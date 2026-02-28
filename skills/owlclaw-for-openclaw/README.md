# owlclaw-for-openclaw

`owlclaw-for-openclaw` is a Skill package that connects OpenClaw to OwlClaw MCP tools.

## Quick start

1. Install `owlclaw-for-openclaw` from ClawHub.
2. Configure endpoint:
   - `OWLCLAW_MCP_ENDPOINT=http://127.0.0.1:8080/mcp`
3. Ask your OpenClaw agent:
   - "Check my AI budget."
   - "Create a background task for nightly sync."

## Package layout

- `SKILL.md`: top-level package skill.
- `skills/`: capability guides.
- `examples/`: concrete prompt examples.
- `config/owlclaw.example.json`: OpenClaw MCP config sample.

## Troubleshooting

- If no tools appear, verify endpoint is reachable and returns `tools/list`.
- If calls fail, check OwlClaw MCP server logs and tool argument schema.

