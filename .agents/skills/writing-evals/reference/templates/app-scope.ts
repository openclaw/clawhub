import { createAppScope } from 'axiom/ai';
import z from 'zod';

export const flagSchema = z.object({
  // TODO: add one object per capability
  myCapability: z.object({
    model: z
      .enum(['gpt-4o-mini-2024-07-18', 'gpt-5-mini-2025-08-07', 'gpt-5-nano-2025-08-07'])
      .default('gpt-5-nano-2025-08-07'),
    temperature: z.number().min(0).max(2).default(0.7),
    // TODO: add more tunable parameters
  }),
});

export const { flag, pickFlags } = createAppScope({ flagSchema });
