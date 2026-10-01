import { Eval } from 'axiom/ai/evals';
import { Scorer } from 'axiom/ai/scorers';
// import { pickFlags } from '@/app-scope';

// TODO: import or define your result type
type ResultType = {
  field1: string;
  field2: string;
  isComplete: boolean;
  missingFields: string[];
};

const StructuredMatch = Scorer(
  'structured-match',
  ({ output, expected }: { output: ResultType; expected: ResultType }) => {
    // Check simple fields
    for (const key of ['field1', 'field2'] as const) {
      if (expected[key] !== output[key]) {
        return {
          score: false,
          metadata: { field: key, expected: expected[key], actual: output[key] },
        };
      }
    }

    // Check boolean field
    if (expected.isComplete !== output.isComplete) {
      return {
        score: false,
        metadata: { field: 'isComplete', expected: expected.isComplete, actual: output.isComplete },
      };
    }

    // Check array field (set comparison)
    const expectedSet = new Set(expected.missingFields);
    const actualSet = new Set(output.missingFields);
    const missing = expected.missingFields.filter(f => !actualSet.has(f));
    const extra = output.missingFields.filter(f => !expectedSet.has(f));

    if (missing.length || extra.length) {
      return {
        score: false,
        metadata: { field: 'missingFields', missing, extra },
      };
    }

    return true;
  },
);

Eval('{{capability}}-{{step}}', {
  capability: '{{capability}}',
  step: '{{step}}',
  // configFlags: pickFlags('{{capability}}.{{step}}'),
  trials: 3,
  data: [
    // Complete information
    {
      input: 'TODO: input with all required info',
      expected: {
        field1: 'value1',
        field2: 'value2',
        isComplete: true,
        missingFields: [],
      },
      metadata: { purpose: 'happy_path_complete' },
    },

    // Partial information
    {
      input: 'TODO: input missing some info',
      expected: {
        field1: 'value1',
        field2: 'unknown',
        isComplete: false,
        missingFields: ['field2'],
      },
      metadata: { purpose: 'partial_info' },
    },

    // Ambiguous
    {
      input: 'TODO: vague input',
      expected: {
        field1: 'unknown',
        field2: 'unknown',
        isComplete: false,
        missingFields: ['field1', 'field2'],
      },
      metadata: { purpose: 'ambiguous' },
    },
  ],
  task: async ({ input }) => {
    // return await extractInfo([{ role: 'user', content: input }]);
    return { field1: '', field2: '', isComplete: false, missingFields: [] };
  },
  scorers: [StructuredMatch],
});
