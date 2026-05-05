---
summary: "Local Ollama embeddings for search, seed data, and publish flows."
read_when:
  - Local dev search returns no results
  - Developing without an OpenAI API key
  - Seeding or publishing skills locally
---

# Local Embeddings

ClawHub uses vector embeddings for skill and soul search. Production uses OpenAI by default. Local development can use Ollama so contributors do not need an OpenAI API key just to run search.

## Default Local Behavior

Embedding provider selection is:

1. `EMBEDDING_PROVIDER=openai`, `ollama`, or `none` wins if explicitly set.
2. `OPENAI_API_KEY` uses OpenAI.
3. Any Ollama env (`OLLAMA_EMBEDDING_MODEL`, `OLLAMA_EMBEDDING_BASE_URL`, or `OLLAMA_HOST`) uses Ollama.
4. Local anonymous Convex deployments (`CONVEX_DEPLOYMENT=anonymous:...`) use Ollama.
5. Otherwise ClawHub falls back to zero vectors.

Hosted Convex dev deployments are intentionally not auto-wired to `localhost:11434`, because `localhost` would be the Convex runtime, not your laptop.

## Setup

Install Ollama, start it, then run:

```bash
bun run setup:local-embeddings
```

The setup command:

- verifies the `ollama` CLI is installed
- checks the local Ollama server
- pulls `qwen3-embedding:4b`
- sets `EMBEDDING_PROVIDER=ollama`, `OLLAMA_EMBEDDING_MODEL`, and `OLLAMA_EMBEDDING_BASE_URL` in Convex env

The default model is `qwen3-embedding:4b` because the Convex vector index is fixed at 1536 dimensions and this model can return 1536-dimensional vectors.

## Seed Data

Run local embedding setup before seeding. Seed actions generate real embeddings when a provider is available.

```bash
bun run setup:local-embeddings
bunx convex run --no-push devSeed:seedNixSkills '{"reset": true}'
```

If you seeded before enabling Ollama, reset and seed again. Existing zero-vector embeddings will not become searchable by changing env vars alone.

## Hosted Dev

For hosted Convex dev deployments, use one of these:

- set `OPENAI_API_KEY` in Convex env
- expose Ollama through a tunnel or network host, then set `EMBEDDING_PROVIDER=ollama` and `OLLAMA_EMBEDDING_BASE_URL`

Do not use `http://localhost:11434` for hosted Convex unless Ollama is running inside that same runtime.

## Troubleshooting

If search is empty after setup, reset and reseed sample data.

If publish fails with an Ollama connection error, start the Ollama app or run `ollama serve`.

If publish fails with a dimension error, use a model that can return 1536 dimensions. `nomic-embed-text` is a good local model in general, but it only supports up to 768 dimensions and does not match this repo's current vector index.
