# writing-evals

Scaffolds evaluation suites for the Axiom AI SDK. Generates eval files, scorers, flag schemas, and config from natural-language descriptions.

## What It Does

### Offline Evals

- **Eval Generation** - Creates `*.eval.ts` files with typed scorers, test data, and task functions
- **Scorer Patterns** - Exact match, set match, structured output, tool-use validation
- **Flag Schemas** - Generates `createAppScope()` with typed Zod schemas for model/parameter tuning
- **Config Setup** - Creates `axiom.config.ts` with instrumentation hooks and glob patterns
- **Data Design** - Happy path, adversarial, boundary, and negative test cases

### Online Evals

- **Production Scoring** - Reference-free scoring on live traffic with `onlineEval`
- **Sampling** - Per-scorer sampling rates and conditional sampling functions
- **Trace Linking** - Auto-linking inside `withSpan` or deferred via `links`

## Installation

```bash
npx skills add axiomhq/skills
```

## Prerequisites

- Complete the [Axiom AI SDK Quickstart](https://axiom.co/docs/ai-engineering/quickstart) (instrumentation + authentication)
- Node.js 18+
- `vitest` installed as dev dependency
- Axiom AI SDK (`axiom`) installed

## Authentication

Set environment variables — this works for both offline and online evals:

```bash
export AXIOM_URL="https://api.axiom.co"
export AXIOM_TOKEN="xaat-your-token"
export AXIOM_DATASET="your-dataset"
```

```typescript
import { defineConfig } from 'axiom/ai/config';

export default defineConfig({
  eval: {
    url: process.env.AXIOM_URL,
    token: process.env.AXIOM_TOKEN,
    dataset: process.env.AXIOM_DATASET,
    include: ['**/*.eval.{ts,js}'],
    timeoutMs: 60_000,
  },
});
```

## Usage

```bash
# Run all evals
npx axiom eval

# Run specific file
npx axiom eval src/my-feature.eval.ts

# Watch mode
npx axiom eval -w

# Local/debug mode (no network)
npx axiom eval --debug

# List cases without running
npx axiom eval --list

# Override flags from CLI
npx axiom eval --flag.myCapability.model=gpt-4o-mini

# Compare against baseline
npx axiom eval -b BASELINE_ID
```

## Scripts

| Script | Purpose |
|--------|---------|
| `eval-init` | Initialize project (creates app-scope.ts + axiom.config.ts) |
| `eval-scaffold` | Generate eval file from template |
| `eval-validate` | Check eval file structure |
| `eval-add-cases` | Analyze test case coverage gaps |
| `eval-run` | Run evals (wraps `npx axiom eval`) |
| `eval-list` | List cases without running |
| `eval-results` | Query eval results from Axiom (requires sre skill) |

## Templates

Pre-built templates in `reference/templates/`:
- Minimal — simplest eval with exact match scorer
- Classification — category classification with adversarial cases
- Retrieval — RAG/retrieval with set matching
- Structured Output — complex object validation
- Tool Use — agent tool usage validation
- App Scope — flag schema boilerplate
- Axiom Config — config file boilerplate

## Related Skills

- `axiom-sre` - Query Axiom to inspect eval traces and results
- `building-dashboards` - Build dashboards to visualize eval metrics over time
