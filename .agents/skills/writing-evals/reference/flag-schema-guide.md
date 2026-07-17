# Flag Schema Guide

How to create and use typed flag schemas with `createAppScope()` for Axiom AI evaluations.

---

## What Are Flags?

Flags are **typed configuration variables** that you can override at runtime without changing code. They let you:
- Compare models: `--flag.myCapability.model=gpt-4o-mini`
- Tune parameters: `--flag.myCapability.temperature=0.5`
- Toggle strategies: `--flag.myCapability.strategy=smart`

---

## Creating a Flag Schema

### Basic Pattern

```typescript
// src/app-scope.ts (or src/lib/app-scope.ts)
import { createAppScope } from 'axiom/ai';
import z from 'zod';

export const flagSchema = z.object({
  myCapability: z.object({
    model: z.enum(['gpt-4o-mini-2024-07-18', 'gpt-5-mini-2025-08-07']).default('gpt-5-mini-2025-08-07'),
    temperature: z.number().min(0).max(2).default(0.7),
  }),
});

export const { flag, pickFlags } = createAppScope({ flagSchema });
```

### Multi-Capability Pattern

```typescript
export const flagSchema = z.object({
  supportAgent: z.object({
    categorizeMessage: z.object({
      model: z.enum(['gpt-4o-mini-2024-07-18', 'gpt-5-mini-2025-08-07']).default('gpt-5-mini-2025-08-07'),
    }),
    retrieveFromKnowledgeBase: z.object({
      model: z.enum(['gpt-4o-mini-2024-07-18', 'gpt-5-mini-2025-08-07']).default('gpt-5-mini-2025-08-07'),
      maxDocuments: z.number().default(1),
    }),
    extractTicketInfo: z.object({
      model: z.enum(['gpt-4o-mini-2024-07-18', 'gpt-5-mini-2025-08-07']).default('gpt-5-mini-2025-08-07'),
    }),
  }),
});
```

---

## Validation Rules

### Rule 1: All leaf fields must have `.default()`

```typescript
// GOOD
z.object({
  model: z.string().default('gpt-4o-mini'),
  temperature: z.number().default(0.7),
})

// BAD — will throw at runtime
z.object({
  model: z.string(),             // missing .default()
  temperature: z.number(),       // missing .default()
})
```

Error: `[AxiomAI] All flag fields must have defaults. Missing defaults for: model, temperature`

### Rule 2: No union types

```typescript
// GOOD
z.enum(['gpt-4o-mini', 'gpt-5-mini']).default('gpt-5-mini')

// BAD — will throw at runtime
z.union([z.string(), z.number()]).default('test')
```

Error: `[AxiomAI] Union types are not supported in flag schemas`

### Rule 3: No z.record()

```typescript
// GOOD — all keys known
z.object({
  endpointA: z.string().default('/api/a'),
  endpointB: z.string().default('/api/b'),
})

// BAD — dynamic keys
z.record(z.string(), z.string())
```

Error: `[AxiomAI] ZodRecord is not supported in flag schemas`

---

## Using Flags in Eval Files

### Reading flags

```typescript
import { flag } from '@/app-scope';

// In your task function
const model = flag('supportAgent.categorizeMessage.model');
// Returns: 'gpt-5-mini-2025-08-07' (default) or CLI override
```

### Scoping flags with pickFlags

`pickFlags` declares which flags an eval is allowed to access. This enables:
- Detecting out-of-scope flag access (warnings in reporter)
- Tracking which flags affect which evals

```typescript
import { pickFlags } from '@/app-scope';

Eval('categorize-messages', {
  capability: 'support-agent',
  configFlags: pickFlags('supportAgent.categorizeMessage'),
  // ...
});
```

You can pick multiple paths:
```typescript
configFlags: pickFlags('supportAgent.categorizeMessage', 'supportAgent.main'),
```

### Overriding flags in code

```typescript
import { withFlags, overrideFlags } from '@/app-scope';

// Temporary override (scoped to callback)
withFlags({ 'supportAgent.categorizeMessage.model': 'gpt-4o-mini' }, () => {
  // model is gpt-4o-mini here
});
// model is back to default here

// Global override (for current eval run)
overrideFlags({ 'supportAgent.categorizeMessage.model': 'gpt-4o-mini' });
```

---

## CLI Flag Overrides

Override flags from the command line using dot notation:

```bash
# Override model
npx axiom eval --flag.supportAgent.categorizeMessage.model=gpt-4o-mini-2024-07-18

# Override numeric value
npx axiom eval --flag.myCapability.temperature=0.5

# Override boolean
npx axiom eval --flag.myCapability.beThorough=true

# Multiple overrides
npx axiom eval \
  --flag.supportAgent.categorizeMessage.model=gpt-4o-mini-2024-07-18 \
  --flag.supportAgent.retrieveFromKnowledgeBase.maxDocuments=3
```

### Flag Precedence (highest to lowest)

1. **CLI overrides** (`--flag.*=value`)
2. **Eval context overrides** (`overrideFlags()`)
3. **Schema defaults** (`.default()` values)

---

## Connecting Flags to axiom.config.ts

The flag schema must be passed to `defineConfig` for CLI validation:

```typescript
// axiom.config.ts
import { defineConfig } from 'axiom/ai/config';
import { flagSchema } from './src/app-scope';

export default defineConfig({
  eval: {
    flagSchema,
    // ... other config
  },
});
```

This enables the CLI to validate `--flag.*` arguments against your schema before running evals.

---

## Using Flags in Task Functions

```typescript
import { flag, pickFlags } from '@/app-scope';
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

async function categorizeMessage(messages: Array<{ role: string; content: string }>) {
  const model = flag('supportAgent.categorizeMessage.model');
  
  const result = await generateText({
    model: openai(model),
    messages,
    system: 'Categorize the message as: support, spam, complaint, wrong_company, unknown',
  });

  return result.text;
}

Eval('categorize-messages', {
  capability: 'support-agent',
  configFlags: pickFlags('supportAgent.categorizeMessage'),
  data: [
    { input: 'My app is broken', expected: 'support' },
  ],
  task: async ({ input }) => categorizeMessage([{ role: 'user', content: input }]),
  scorers: [ExactMatch],
});
```

---

## Facts (Optional)

Facts record non-flag metadata during eval runs:

```typescript
import { createAppScope } from 'axiom/ai';
import z from 'zod';

const { flag, fact, pickFlags } = createAppScope({
  flagSchema: z.object({ /* ... */ }),
  factSchema: z.object({
    userAction: z.string(),
    timing: z.number(),
  }),
});

// Record a fact during eval
fact('userAction', 'clicked_button');
fact('timing', 1250);
```

Facts are attached to spans for analysis but cannot be overridden via CLI.

---

## Common Flag Schema Patterns

### Model Selection
```typescript
model: z.enum(['gpt-4o-mini-2024-07-18', 'gpt-5-mini-2025-08-07', 'gpt-5-nano-2025-08-07']).default('gpt-5-nano-2025-08-07'),
```

### Temperature
```typescript
temperature: z.number().min(0).max(2).default(0.7),
```

### Max Tokens
```typescript
maxTokens: z.number().default(1000),
```

### Strategy Toggle
```typescript
strategy: z.enum(['simple', 'chain-of-thought', 'react']).default('simple'),
```

### Boolean Feature Toggle
```typescript
beThorough: z.boolean().default(false),
```

### Numeric Threshold
```typescript
maxDocuments: z.number().default(1),
confidenceThreshold: z.number().min(0).max(1).default(0.8),
```
