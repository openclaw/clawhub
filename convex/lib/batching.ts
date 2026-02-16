import type { Scheduler } from 'convex/server'

export function scheduleNextBatchIfNeeded<TArgs extends { cursor?: string }>(
  scheduler: Scheduler,
  fn: unknown,
  args: TArgs,
  isDone: boolean,
  continueCursor: string | null,
) {
  if (isDone) return
  void scheduler.runAfter(0, fn as never, {
    ...args,
    cursor: continueCursor ?? undefined,
  } as never)
}
