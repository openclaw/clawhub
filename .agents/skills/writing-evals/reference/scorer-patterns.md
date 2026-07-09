# Scorer Patterns Cookbook

Common scoring patterns for Axiom AI evaluations.

---

## Pattern 1: Exact Match (Boolean)

**When:** Output must equal expected exactly.

```typescript
import { Scorer } from 'axiom/ai/scorers';

const ExactMatch = Scorer(
  'exact-match',
  ({ output, expected }: { output: string; expected: string }) => {
    return output === expected;
  },
);
```

**Returns:** `true` (1.0) or `false` (0.0)

**Use for:** Classification, category labels, yes/no answers.

**Pitfall:** Case-sensitive. Normalize both sides if needed:
```typescript
return output.toLowerCase().trim() === expected.toLowerCase().trim();
```

---

## Pattern 2: Exact Match with Aggregation (Numeric)

**When:** Running multiple trials and need aggregated scores.

```typescript
import { Scorer } from 'axiom/ai/scorers';
import { Mean } from 'axiom/ai/scorers/aggregations';

const ExactMatchMean = Scorer(
  'exact-match-mean',
  ({ output, expected }: { output: string; expected: string }) => {
    return output === expected ? 1 : 0;
  },
  { aggregation: Mean() },
);
```

**Returns:** `1` or `0`, aggregated via Mean across trials.

**Variants:**
```typescript
import { PassHatK, PassAtK } from 'axiom/ai/scorers/aggregations';

// Pass if ALL trials match
const ExactMatchAllPass = Scorer('exact-match-all', scorerFn, { aggregation: PassHatK() });

// Pass if ANY trial matches
const ExactMatchAnyPass = Scorer('exact-match-any', scorerFn, { aggregation: PassAtK() });
```

---

## Pattern 3: Contains / Substring Match

**When:** Output must contain specific keywords or phrases.

```typescript
const ContainsKeyword = Scorer(
  'contains-keyword',
  ({ output, expected }: { output: string; expected: string }) => {
    return output.toLowerCase().includes(expected.toLowerCase());
  },
);
```

**Variant — multiple keywords:**
```typescript
const ContainsAll = Scorer(
  'contains-all',
  ({ output, expected }: { output: string; expected: string[] }) => {
    const lower = output.toLowerCase();
    return expected.every(kw => lower.includes(kw.toLowerCase()));
  },
);
```

---

## Pattern 4: Set Match (Retrieval / RAG)

**When:** Output is a list of items that must match expected set exactly.

```typescript
const StrictSetMatch = Scorer(
  'strict-set-match',
  ({ output, expected }: { output: string[]; expected: string[] }) => {
    if (expected.length !== output.length) return false;
    const outputSet = new Set(output);
    return expected.every(item => outputSet.has(item));
  },
);
```

**Variant — subset match (at least these items):**
```typescript
const SubsetMatch = Scorer(
  'subset-match',
  ({ output, expected }: { output: string[]; expected: string[] }) => {
    const outputSet = new Set(output);
    return expected.every(item => outputSet.has(item));
  },
);
```

**Variant — with recall score:**
```typescript
const RecallScore = Scorer(
  'recall',
  ({ output, expected }: { output: string[]; expected: string[] }) => {
    if (expected.length === 0) return output.length === 0 ? 1 : 0;
    const outputSet = new Set(output);
    const hits = expected.filter(item => outputSet.has(item)).length;
    return hits / expected.length;
  },
);
```

---

## Pattern 5: Structured Output Validation

**When:** Output is a complex object and you need to check specific fields.

```typescript
type TicketInfo = {
  intent: string;
  product: string;
  isComplete: boolean;
  missingFields: string[];
};

const StructuredMatch = Scorer(
  'structured-match',
  ({ output, expected }: { output: TicketInfo; expected: TicketInfo }) => {
    // Check each field, return metadata on failure
    if (expected.intent !== output.intent) {
      return { score: false, metadata: { field: 'intent', expected: expected.intent, actual: output.intent } };
    }
    if (expected.product !== output.product) {
      return { score: false, metadata: { field: 'product', expected: expected.product, actual: output.product } };
    }
    if (expected.isComplete !== output.isComplete) {
      return { score: false, metadata: { field: 'isComplete', expected: expected.isComplete, actual: output.isComplete } };
    }

    const expectedMissing = new Set(expected.missingFields);
    const actualMissing = new Set(output.missingFields);
    const missing = expected.missingFields.filter(f => !actualMissing.has(f));
    const extra = output.missingFields.filter(f => !expectedMissing.has(f));

    if (missing.length || extra.length) {
      return { score: false, metadata: { field: 'missingFields', missing, extra } };
    }

    return true;
  },
);
```

**Key:** Return `{ score: false, metadata: { ... } }` to make failures debuggable.

---

## Pattern 6: Tool Use Validation

**When:** Evaluating an AI agent that should (or should not) call specific tools.

```typescript
type AgentResult = {
  text: string;
  toolCalls?: Array<{ toolName: string; args: Record<string, any> }>;
};

const ToolUseMatch = Scorer(
  'tool-use-match',
  ({ output, expected }: { output: AgentResult; expected: string[] }) => {
    const actual = output.toolCalls?.map(tc => tc.toolName) || [];
    const actualSet = new Set(actual);

    // Expect NO tools
    if (expected.length === 0 && actual.length > 0) return false;

    // Expect specific tools
    return expected.every(tool => actualSet.has(tool));
  },
);
```

**Variant — exact tool order:**
```typescript
const ToolOrderMatch = Scorer(
  'tool-order-match',
  ({ output, expected }: { output: AgentResult; expected: string[] }) => {
    const actual = output.toolCalls?.map(tc => tc.toolName) || [];
    if (actual.length !== expected.length) return false;
    return actual.every((tool, i) => tool === expected[i]);
  },
);
```

---

## Pattern 7: Format / Schema Validation

**When:** Checking output format (JSON, length, regex pattern).

```typescript
const IsValidJSON = Scorer(
  'is-valid-json',
  ({ output }: { output: string }) => {
    try {
      JSON.parse(output);
      return true;
    } catch {
      return false;
    }
  },
);

const MaxLength = Scorer(
  'max-length',
  ({ output }: { output: string }) => {
    return output.length <= 500;
  },
);

const MatchesPattern = Scorer(
  'matches-pattern',
  ({ output, expected }: { output: string; expected: string }) => {
    return new RegExp(expected).test(output);
  },
);
```

---

## Pattern 8: Multi-Scorer Composition

**When:** You want to check multiple properties independently.

```typescript
Eval('my-eval', {
  capability: 'qa',
  data: [
    { input: 'What is 2+2?', expected: '4' },
  ],
  task: async ({ input }) => generateAnswer(input),
  scorers: [
    ExactMatch,      // Is the answer correct?
    MaxLength,       // Is it concise?
    IsValidJSON,     // Is it valid format?
  ],
});
```

Each scorer runs independently. Results are reported per-scorer in the Axiom console.

---

## Pattern 9: Async Scorer (LLM-as-Judge)

**When:** Using another LLM to evaluate output quality.

```typescript
const LLMJudge = Scorer(
  'llm-judge',
  async ({ output, expected }: { output: string; expected: string }) => {
    const result = await generateText({
      model: openai('gpt-4o-mini'),
      prompt: `Rate how well this output matches the expected answer.
Expected: ${expected}
Actual: ${output}
Return a number 0-1 where 1 is perfect match.`,
    });
    const score = parseFloat(result.text);
    return isNaN(score) ? 0 : Math.max(0, Math.min(1, score));
  },
);
```

**Pitfall:** Async scorers add latency and cost. Use sparingly, consider `sampling` in online evals.

---

## Pattern 10: Using the `autoevals` Library

**When:** You need prebuilt scorers for common NLP metrics (text similarity, factuality, semantic similarity).

```bash
npm install autoevals
```

```typescript
import { Scorer } from 'axiom/ai/scorers';
import { Levenshtein, Factuality } from 'autoevals';

const LevenshteinScorer = Scorer(
  'levenshtein',
  ({ output, expected }: { output: string; expected: string }) => {
    return Levenshtein({ output, expected });
  },
);

const FactualityScorer = Scorer(
  'factuality',
  async ({ output, expected }: { output: string; expected: string }) => {
    return await Factuality({ output, expected });
  },
);
```

Combine autoevals with custom scorers for thorough coverage:
```typescript
scorers: [ExactMatch, LevenshteinScorer, FactualityScorer],
```

---

## Score Return Types

- `boolean` — `true` = pass (1.0), `false` = fail (0.0)
- `number` — raw score (0.0–1.0 typical, but any number works)
- `{ score: number | boolean | null, metadata?: Record<string, any> }` — score with debug info

---

## Reference-Free vs Reference-Based

- **Reference-based:** Compares `output` to `expected`. Used in offline evals with ground truth.
- **Reference-free:** Evaluates `output` quality without `expected` (e.g., coherence, toxicity). Used for online evals where no ground truth exists. Also works alongside reference-based scorers in offline evals.

---

## Scorer Typing Tips

Always explicitly type the scorer args object:

```typescript
// GOOD: explicit types
Scorer('my-scorer', ({ output, expected }: { output: MyType; expected: MyExpected }) => { ... });

// BAD: relies on inference (can cause type errors)
Scorer('my-scorer', ({ output, expected }) => { ... });
```

The `output` field is always required. `input`, `expected`, and `trialIndex` are optional.
