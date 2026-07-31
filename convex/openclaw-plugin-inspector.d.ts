declare module "@openclaw/plugin-inspector" {
  export type PluginInspectorReport = {
    status?: string;
    summary?: {
      breakageCount?: number;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };

  export type PluginInspectorPaths = {
    jsonPath: string;
    markdownPath?: string;
    issuesPath?: string;
    [key: string]: unknown;
  };

  export const pluginRoot: {
    runCheck(options?: {
      pluginRoot?: string;
      openclawPath?: string | false;
      openclawVersion?: string;
      outDir?: string;
      capture?: boolean;
      mockSdk?: boolean;
      allowExecution?: boolean;
      configPath?: string;
      generatedAt?: string;
      targetOpenClaw?: unknown;
    }): Promise<{ report: PluginInspectorReport; paths: PluginInspectorPaths }>;
  };

  export const openClawTargets: {
    resolveVersion(requestedVersion: string): Promise<unknown>;
    prepare(resolvedTarget: unknown, options?: { cacheDir?: string }): Promise<unknown>;
  };

  export const reports: {
    renderTextSummary(report: PluginInspectorReport, options?: Record<string, unknown>): string;
    sanitizeArtifact(report: PluginInspectorReport): unknown;
  };

  export const ci: {
    writeOutputs(
      report: PluginInspectorReport,
      options?: Record<string, unknown>,
    ): Promise<unknown>;
  };
}
