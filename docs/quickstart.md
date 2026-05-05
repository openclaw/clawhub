---
summary: "Local setup + CLI smoke: login, search, install, publish, sync."
read_when:
  - First run / local dev setup
  - Verifying end-to-end flows
---

# Quickstart

## 0) Prereqs

- Bun
- Convex CLI (`bunx convex ...`)
- GitHub OAuth App (for login)
- Ollama for local embeddings, or an OpenAI key for hosted/prod embeddings

## 1) Local dev (web + Convex)

```bash
bun install
cp .env.local.example .env.local

# terminal A
bun run dev

# terminal B
bunx convex dev
```

For local search without an OpenAI key, start Ollama and run:

```bash
bun run setup:local-embeddings
```

## 2) Auth setup (GitHub OAuth + Convex Auth keys)

Fill in `.env.local`:

- `AUTH_GITHUB_ID`
- `AUTH_GITHUB_SECRET`
- `VITE_CONVEX_URL`
- `VITE_CONVEX_SITE_URL`
- `CONVEX_SITE_URL` (same as `VITE_CONVEX_SITE_URL`)
- `OPENAI_API_KEY` for hosted/prod embeddings, or the local Ollama fallback below

Generate Convex Auth keys for your deployment:

```bash
bunx auth --deployment-name <deployment> --web-server-url http://localhost:3000
```

Then paste the printed `JWT_PRIVATE_KEY` + `JWKS` into `.env.local` (and ensure the deployment got them too).

Local anonymous Convex deployments automatically use Ollama when OpenAI is absent. The setup command pulls `qwen3-embedding:4b` and sets the backend env explicitly. If Convex functions are running in a hosted dev deployment, `localhost` is the Convex runtime, not your laptop. Use `OPENAI_API_KEY` or a network-reachable `OLLAMA_EMBEDDING_BASE_URL` for that setup.

## 3) CLI: login + basic commands

From this repo:

```bash
bun clawhub --help
bun clawhub login
bun clawhub whoami
bun clawhub search gif --limit 5
```

Install a skill into `./skills/<slug>` (if Clawdbot is configured, installs into that workspace instead):

```bash
bun clawhub install <slug>
bun clawhub list
bun clawhub uninstall <slug> --yes
```

You can also install into any folder:

```bash
bun clawhub install <slug> --workdir /tmp/clawhub-demo --dir skills
```

Update:

```bash
bun clawhub update --all
```

## 4) Publish a skill

Create a folder containing `SKILL.md` (required) plus any supporting text files:

```bash
mkdir -p /tmp/clawhub-skill-demo && cd /tmp/clawhub-skill-demo
cat > SKILL.md <<'EOF'
---
name: Demo Skill
description: Demo skill for local testing
---

# Demo Skill

Hello.
EOF
```

Publish:

```bash
bun clawhub skill publish . \
  --slug clawhub-demo-$(date +%s) \
  --name "Demo $(date +%s)" \
  --version 1.0.0 \
  --tags latest \
  --changelog "Initial release"
```

## 5) Publish a code plugin

Create a plugin folder with a `package.json` that includes the required OpenClaw
publish metadata:

```bash
mkdir -p /tmp/clawhub-plugin-demo && cd /tmp/clawhub-plugin-demo
cat > package.json <<'EOF'
{
  "name": "@demo/openclaw-plugin-demo",
  "version": "0.1.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"],
    "hostTargets": ["darwin-arm64"],
    "environment": {},
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2"
    },
    "build": {
      "openclawVersion": "2026.3.24-beta.2"
    }
  }
}
EOF
```

Preview the resolved publish payload first:

```bash
bun clawhub package publish . --family code-plugin --dry-run
```

Then publish:

```bash
bun clawhub package publish . --family code-plugin
```

Notes:

- `openclaw.compat.pluginApi` and `openclaw.build.openclawVersion` are required
  for `code-plugin` publishes.
- `package.json.version` does not replace either required OpenClaw field.
- `openclaw.hostTargets` and `openclaw.environment` are optional compatibility
  metadata. Include them only when they add useful install context.
- Add `openclaw.compat.minGatewayVersion` and
  `openclaw.build.pluginSdkVersion` when you want to expose fuller
  compatibility/build metadata, but they are not required for a successful
  publish.

## 6) Sync local skills (auto-publish new/changed)

`sync` scans for local skill folders and publishes the ones that aren’t “synced” yet.

```bash
bun clawhub sync
```

Dry run + non-interactive:

```bash
bun clawhub sync --all --dry-run --no-input
```
