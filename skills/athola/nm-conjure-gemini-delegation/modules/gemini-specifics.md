# Gemini-Specific Configuration

## Model Reference

| Model | Use Case | Context |
|-------|----------|---------|
| `gemini-2.5-flash-exp` | Fast, simple tasks | Up to 1M tokens |
| `gemini-2.5-pro-exp` | Complex analysis | Up to 1M tokens |
| `gemini-exp-1206` | Experimental features | Varies |

## CLI Options

| Flag | Purpose |
|------|---------|
| `-p "prompt"` | Specify prompt |
| `--model <name>` | Select model |
| `--output-format json` | JSON output |
| `-s` | Sandbox mode |
| `@path` | Include file in context |

## Context Inclusion Patterns
- Use `@path` to include file contents
- Use `@directory/**/*` for recursive inclusion
- Gemini handles large contexts well (1M+ tokens)

## Cost Reference (per 1M tokens)
- Input: $0.50 (Pro), $0.075 (Flash)
- Output: $1.50 (Pro), $0.30 (Flash)

## Gemini-Specific Troubleshooting

### Rate Limit (HTTP 429)
- Free tier: ~60 RPM, ~1000 requests/day
- Consider `gemini-2.5-flash` to reduce RPM usage
- Use `~/conjure/hooks/gemini/status.sh` for quick check

### Context Too Large
- Use selective globbing: `src/**/*.py` instead of `src/**/*`
- Pre-process: `rg -v "^\s*#" file.py` to remove comments (or `grep -v`)

### Region Issues
- Some models available only in certain regions
- Check API documentation for availability
