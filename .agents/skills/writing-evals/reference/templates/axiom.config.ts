import { defineConfig } from 'axiom/ai/config';
// import { setupInstrumentation } from './src/instrumentation';
// import { flagSchema } from './src/app-scope';

export default defineConfig({
  eval: {
    url: process.env.AXIOM_URL,
    token: process.env.AXIOM_TOKEN,
    dataset: process.env.AXIOM_DATASET,
    // flagSchema,
    include: ['**/*.eval.{ts,js}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/build/**'],
    // Uncomment to track token usage per eval run:
    // instrumentation: (env) => setupInstrumentation(env),
    timeoutMs: 60_000,
  },
});
