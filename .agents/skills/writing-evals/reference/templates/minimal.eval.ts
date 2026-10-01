import { Eval } from 'axiom/ai/evals';
import { Scorer } from 'axiom/ai/scorers';

const ExactMatch = Scorer(
  'exact-match',
  ({ output, expected }: { output: string; expected: string }) => {
    return output === expected;
  },
);

Eval('{{capability}}-basic', {
  capability: '{{capability}}',
  data: [
    { input: 'TODO: add input', expected: 'TODO: add expected' },
  ],
  task: async ({ input }) => {
    // TODO: call your function here
    // return await {{functionName}}(input);
    return input;
  },
  scorers: [ExactMatch],
});
