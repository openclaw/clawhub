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
    runCheck(options: {
      allowExecution?: boolean;
      capture?: boolean;
      configPath?: string;
      mockSdk?: boolean;
      openclawPath?: string | false;
      outDir?: string;
      pluginRoot?: string;
    }): Promise<{
      report: PluginInspectorReport;
      paths: PluginInspectorPaths;
    }>;
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
