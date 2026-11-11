import { skillSpectorTerminalMetadata } from "./clawscan-diagnostic-skillspector";

export async function bundledSkillSpectorTerminalContext(path: string) {
  const terminal = await skillSpectorTerminalMetadata(path);
  // Keep the restricted reader's validation, but emit no artifact/label hashes,
  // source paths, finding text or provider errors into hosted worker diagnostics.
  return {
    presence: terminal.presence,
    executionSuccessful: terminal.executionSuccessful,
    completenessStatus: terminal.completeness.status,
    reasonCounts: terminal.reasonCounts,
    unknownReasons: terminal.unknownReasons,
    unknownAnalyzers: terminal.unknownAnalyzers,
    incompleteAnalyzers: terminal.analyzers.filter((analyzer) =>
      ["failed", "degraded", "skipped", "unavailable"].includes(analyzer.status),
    ),
  };
}

export type BundledSkillSpectorFailureContext = {
  /** Index in the worker's sorted, deduplicated declared-root list. */
  rootIndex: number;
  rootCount: number;
  /** Accepted terminal reports; concurrent roots need not finish in index order. */
  completedRoots: number;
  childBudgetMs: number;
  remainingStageBudgetMs: number;
  terminal?: Awaited<ReturnType<typeof bundledSkillSpectorTerminalContext>>;
};
