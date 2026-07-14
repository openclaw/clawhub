import { Eval } from 'axiom/ai/evals';
import { Scorer } from 'axiom/ai/scorers';
// import { pickFlags } from '@/app-scope';

// TODO: import or define your agent result type
type AgentResult = {
  text: string;
  toolCalls?: Array<{ toolName: string; args: Record<string, any> }>;
};

const ToolUseMatch = Scorer(
  'tool-use-match',
  ({ output, expected }: { output: AgentResult; expected: string[] }) => {
    const actual = output.toolCalls?.map(tc => tc.toolName) || [];
    const actualSet = new Set(actual);

    // Expect NO tools — fail if any were called
    if (expected.length === 0 && actual.length > 0) return false;

    // Expect specific tools — fail if any are missing
    return expected.every(tool => actualSet.has(tool));
  },
);

Eval('{{capability}}-tool-use', {
  capability: '{{capability}}',
  // configFlags: pickFlags('{{capability}}'),
  data: [
    // Should use tools
    {
      input: 'TODO: input that requires tool usage',
      expected: ['toolName1'],
      metadata: { purpose: 'tool_required' },
    },
    {
      input: 'TODO: input requiring multiple tools',
      expected: ['toolName1', 'toolName2'],
      metadata: { purpose: 'multi_tool' },
    },

    // Should NOT use tools
    {
      input: 'TODO: simple input that needs no tools',
      expected: [],
      metadata: { purpose: 'no_tool_needed' },
    },
    {
      input: 'TODO: irrelevant input',
      expected: [],
      metadata: { purpose: 'irrelevant' },
    },
  ],
  task: async ({ input }) => {
    // return await {{functionName}}([{ role: 'user', content: input }]);
    return { text: '', toolCalls: [] };
  },
  scorers: [ToolUseMatch],
});
