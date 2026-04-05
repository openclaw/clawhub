# Qwen-Specific Configuration

## Model Reference

| Model | Use Case | Context |
|-------|----------|---------|
| `qwen-turbo` | Fast, simple tasks | Standard context |
| `qwen-max` | Complex analysis | Extended context |
| `qwen-coder` | Code-specialized | If available |

## CLI Options

| Flag | Purpose |
|------|---------|
| `-p "prompt"` | Specify prompt |
| `--model <name>` | Select model |
| `--format <type>` | Output format (json, markdown) |
| `--temperature <0-1>` | Control randomness |
| `@path` | Include file in context |

## Context Inclusion Patterns
- Use `@path` to include file contents
- Use `@directory/**/*` for recursive inclusion
- Qwen handles large contexts well (100K+ tokens)

## Cost Reference
- Competitive with Gemini pricing
- Varies by model tier and provider

## Qwen-Specific Troubleshooting

### Rate Limits
- Check with: `python ~/conjure/tools/delegation_executor.py verify qwen`
- Consider `qwen-turbo` for faster responses with lower limits

### Installation Issues
- Install: `pip install qwen-cli`
- PATH issues: validate `~/.local/bin` is in PATH
- Verify: `which qwen` and `qwen --version`

### Model Access
- Check available models: `qwen --help | grep -A 10 "model"`
- Version updates may add new models
