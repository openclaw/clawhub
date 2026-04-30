import type { Scheduler } from "convex/server";

export function scheduleNextBatchIfNeeded(
  scheduler: Scheduler,
  fn: unknown,
  args: { cursor?: string } & Record<string, unknown>,
  isDone: boolean,
  continueCursor: string | null,
) {
  if (isDone) return;
  void scheduler.runAfter(
    0,
    fn as never,
    {
      ...args,
      cursor: continueCursor ?? undefined,
    } as never,
  );
}
