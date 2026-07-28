# API Reference

Exact type signatures for the Axiom AI SDK evaluation APIs.

---

## Import Paths

| Import | Exports |
|--------|---------|
| `axiom/ai` | `createAppScope`, `initAxiomAI`, `withSpan`, `wrapAISDKModel`, `wrapTool`, `axiomAIMiddleware`, `RedactionPolicy` |
| `axiom/ai/evals` | `Eval`, `EvalTask`, `EvalParams` |
| `axiom/ai/scorers` | `Scorer` |
| `axiom/ai/evals/online` | `onlineEval` |
| `axiom/ai/scorers/aggregations` | `Mean`, `Median`, `PassAtK`, `PassHatK`, `AtLeastOneTrialPasses`, `AllTrialsPass` |
| `axiom/ai/config` | `defineConfig` |
| `axiom/ai/feedback` | `createFeedbackClient` |

---

## Eval()

```typescript
function Eval<TInput, TExpected, TOutput>(
  name: string,
  params: EvalParams<TInput, TExpected, TOutput> & {
    capability: string;
    step?: string;
  },
): void;
```

### EvalParams

```typescript
type EvalParams<TInput, TExpected, TOutput> = {
  data:
    | readonly CollectionRecord<TInput, TExpected>[]
    | Promise<readonly CollectionRecord<TInput, TExpected>[]>
    | (() => readonly CollectionRecord<TInput, TExpected>[] | Promise<readonly CollectionRecord<TInput, TExpected>[]>);
  capability: string;
  step?: string;
  task: EvalTask<TInput, TExpected, TOutput>;
  scorers: ReadonlyArray<ScorerLike<TInput, TExpected, TOutput>>;
  metadata?: Record<string, unknown>;
  timeout?: number;
  configFlags?: string[];
  trials?: number;  // default: 1
};
```

### CollectionRecord

```typescript
type CollectionRecord<TInput, TExpected> = {
  input: TInput;
  expected: TExpected;
  metadata?: Record<string, unknown>;
};
```

### EvalTask

```typescript
type EvalTask<TInput, TExpected, TOutput> = (args: {
  input: TInput;
  expected: TExpected;
}) => TOutput | Promise<TOutput> | AsyncIterable<TOutput>;
```

### Name Validation

Eval names and capability/step names are validated:
- Must be non-empty strings
- Used for telemetry span naming and Axiom console display

---

## Scorer

```typescript
function Scorer<TArgs extends Record<string, any>>(
  name: string,
  fn: (args: TArgs) => number | boolean | Score | Promise<number | boolean | Score>,
  options?: ScorerOptions,
): Scorer;
```

### Score

```typescript
type Score = {
  score: number | boolean | null;
  metadata?: Record<string, any>;
};
```

### ScorerOptions

```typescript
type ScorerOptions = {
  aggregation?: Aggregation;
};
```

### ScorerLike (what Eval accepts)

```typescript
type ScorerLike<TInput, TExpected, TOutput> = (
  args: {
    input?: TInput;
    expected?: TExpected;
    output: TOutput;
    trialIndex?: number;
  },
) => Score | Promise<Score>;
```

### ScoreWithName (result after execution)

```typescript
type ScoreWithName = Score & {
  name: string;
  trials?: number[];
  aggregation?: string;
  threshold?: number;
};
```

---

## Aggregations

```typescript
type Aggregation<T extends string = string> = {
  type: T;
  threshold?: number;
  aggregate: (scores: number[]) => number;
};
```

### Mean

```typescript
const Mean = (): Aggregation<'mean'>
// Average of all trial scores. Returns 0 for empty arrays.
```

### Median

```typescript
const Median = (): Aggregation<'median'>
// Median of sorted trial scores. Returns 0 for empty arrays.
```

### PassAtK

```typescript
const PassAtK = (opts?: { threshold?: number }): Aggregation<'pass@k'>
// Returns 1 if ANY trial score >= threshold (default: 1). Otherwise 0.
// Alias: AtLeastOneTrialPasses
```

### PassHatK

```typescript
const PassHatK = (opts?: { threshold?: number }): Aggregation<'pass^k'>
// Returns 1 if ALL trial scores >= threshold (default: 1). Otherwise 0.
// Alias: AllTrialsPass
```

---

## createAppScope

```typescript
function createAppScope<FlagSchema extends ZodObject<any>, FactSchema extends ZodObject<any> | undefined>(
  config: { flagSchema: FlagSchema; factSchema?: FactSchema },
): AppScope<FlagSchema, FactSchema>;
```

### AppScope

```typescript
interface AppScope<FS, SC> {
  flag: (path: string) => any;          // dot-notation access, e.g. flag('myCapability.model')
  fact: (name: string, value: any) => void;
  overrideFlags: (partial: Record<string, any>) => void;
  withFlags: <T>(overrides: Record<string, any>, fn: () => T) => T;
  pickFlags: (...paths: string[]) => string[];
  getAllDefaultFlags: () => Record<string, any>;
}
```

### Flag Precedence

1. CLI overrides (`--flag.path=value`) — highest
2. Eval context overrides (`overrideFlags()`)
3. Schema defaults (`.default()` values)

### Validation Rules

- All leaf fields **must** have `.default()`
- No `z.union()` or `z.discriminatedUnion()`
- No `z.record()` — all keys must be statically known

---

## defineConfig

```typescript
function defineConfig(config: AxiomConfig): AxiomConfig;
```

### AxiomConfig

```typescript
interface AxiomConfig {
  eval?: {
    url?: string;
    edgeUrl?: string;
    token?: string;
    dataset?: string;
    orgId?: string;
    flagSchema?: ZodObject<any> | null;
    instrumentation?: (options: {
      url: string;
      edgeUrl: string;
      token: string;
      dataset: string;
      orgId?: string;
    }) => { provider?: TracerProvider } | Promise<{ provider?: TracerProvider }>;
    timeoutMs?: number;           // default: 60000
    include?: string[];           // default: ['**/*.eval.{ts,js,mts,mjs,cts,cjs}']
    exclude?: string[];           // default: ['**/node_modules/**', '**/dist/**', '**/build/**']
  };
  [key: `$${string}`]: Partial<AxiomConfig['eval']>;  // environment overrides
}
```

---

## onlineEval

```typescript
function onlineEval<TInput, TOutput>(
  meta: {
    capability: string;
    step?: string;
    link?: SpanContext;
  },
  options: {
    input?: TInput;
    output: TOutput;
    scorers: readonly OnlineEvalScorerEntry[];
  },
): Promise<Partial<Record<string, ScorerResult>>>;

type OnlineEvalScorerEntry =
  | Scorer                                          // bare scorer, always runs
  | { scorer: Scorer; sampling?: ScorerSampling }   // scorer with per-scorer sampling
  | { name: string; score: Score; metadata?: Record<string, unknown>; error?: string };  // precomputed result

type ScorerSampling =
  | number                                          // 0.0–1.0 rate
  | ((args: { input?: TInput; output: TOutput }) => boolean | Promise<boolean>);
```

### ScorerResult

```typescript
type ScorerResult = {
  name: string;
  score: Score;
  error?: string;
};
```

---

## Streaming Tasks

Tasks can return an `AsyncIterable` for evaluating streaming AI functions (e.g., `streamText()`):

```typescript
import { streamText } from 'ai';

Eval('stream-eval', {
  capability: 'qa',
  data: [{ input: 'What is 2+2?', expected: '4' }],
  task: async function* ({ input }) {
    const result = streamText({ model: openai('gpt-4o-mini'), prompt: input });
    for await (const chunk of result.textStream) {
      yield chunk;
    }
  },
  scorers: [ExactMatch],
});
```

**Concatenation rules:**
- **String chunks** → joined together (`chunks.join('')`)
- **Object chunks** → last chunk returned (streaming typically overwrites)
- **Empty stream** → returns empty string

---

## Dynamic Data Loading

Data can be a static array, a function, or a Promise:

```typescript
// Static array
data: [{ input: 'hello', expected: 'hello' }],

// Function (called once at eval startup)
data: () => [{ input: 'hello', expected: 'hello' }],

// Async function (fetch from API, database, CSV, etc.)
data: async () => {
  const response = await fetch('https://api.example.com/test-cases');
  return response.json();
},

// Direct Promise
data: Promise.resolve([{ input: 'hello', expected: 'hello' }]),
```

Functions are called **once** during eval setup — data is loaded fresh each run but not re-fetched between cases.

---

## Manual Token Tracking (Non-Vercel AI SDK)

Automatic token capture works with Vercel AI SDK (`ai` package). For other SDKs (`@google/generative-ai`, `openai`, `@anthropic-ai/sdk`, etc.), manually set token attributes in your task function:

```typescript
import { trace } from '@opentelemetry/api';

task: async ({ input }) => {
  const span = trace.getActiveSpan();

  // Example: Google Generative AI
  const result = await model.generateContent(input);
  if (span && result.response.usageMetadata) {
    span.setAttribute('gen_ai.usage.input_tokens', result.response.usageMetadata.promptTokenCount);
    span.setAttribute('gen_ai.usage.output_tokens', result.response.usageMetadata.candidatesTokenCount);
    span.setAttribute('gen_ai.request.model', 'gemini-2.0-flash');
    span.setAttribute('gen_ai.response.model', result.response.modelVersion);
  }
  return result.response.text();

  // Example: OpenAI SDK
  // const result = await openai.chat.completions.create({ ... });
  // if (span && result.usage) {
  //   span.setAttribute('gen_ai.usage.input_tokens', result.usage.prompt_tokens);
  //   span.setAttribute('gen_ai.usage.output_tokens', result.usage.completion_tokens);
  //   span.setAttribute('gen_ai.request.model', 'gpt-4o-mini');
  //   span.setAttribute('gen_ai.response.model', result.model);
  // }
  // return result.choices[0].message.content;
},
```

---

## CLI Options

```
axiom eval [target] [options]

Arguments:
  target              file, directory, glob, or eval name (default: ".")

Options:
  -w, --watch         watch for changes
  -t, --token TOKEN   Axiom API token
  -d, --dataset NAME  Axiom dataset
  -u, --url URL       Axiom API URL
  -o, --org-id ID     Axiom org ID
  -b, --baseline ID   compare against baseline
  --debug             local mode, no network
  --list              list cases without running
  --flag.*=value      override flag values
```
