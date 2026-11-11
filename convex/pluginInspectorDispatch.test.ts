import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/githubAuth", () => ({
  createGitHubAppInstallationToken: vi.fn(),
}));

const { createGitHubAppInstallationToken } = await import("./lib/githubAuth");
const { dispatchPluginInspectorReleaseScanInternal, dispatchPluginInspectorReleaseScanWorkflow } =
  await import("./pluginInspectorDispatch");
const { isPluginInspectorReleaseScanDispatchEnabled } =
  await import("./lib/pluginInspectorReleaseScan");
const { getPluginInspectorReleaseScanTargetInternal } = await import("./packages");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const dispatchHandler = (
  dispatchPluginInspectorReleaseScanInternal as unknown as WrappedHandler<
    { releaseId: string; retryCount: number },
    { dispatched: boolean; reason?: string }
  >
)._handler;
const targetHandler = (
  getPluginInspectorReleaseScanTargetInternal as unknown as WrappedHandler<{ releaseId: string }>
)._handler;

function enableDispatch() {
  vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
  vi.stubEnv("GITHUB_APP_ID", "configured");
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");
}

const target = {
  packageName: "@openclaw/demo",
  version: "1.2.3",
  releaseId: "packageReleases:demo",
};

describe("Plugin Inspector release scan dispatch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("dispatches only from the production deployment with GitHub App credentials", () => {
    expect(isPluginInspectorReleaseScanDispatchEnabled()).toBe(false);
    enableDispatch();
    expect(isPluginInspectorReleaseScanDispatchEnabled()).toBe(true);
    vi.stubEnv("CLAWHUB_ENV", "production");
    expect(isPluginInspectorReleaseScanDispatchEnabled()).toBe(true);
    for (const environment of ["staging", "test"]) {
      vi.stubEnv("CLAWHUB_ENV", environment);
      expect(isPluginInspectorReleaseScanDispatchEnabled()).toBe(false);
    }
    vi.stubEnv("CLAWHUB_ENV", "");
    vi.stubEnv("CLAWHUB_PREVIEW", "1");
    expect(isPluginInspectorReleaseScanDispatchEnabled()).toBe(false);
  });

  it("sends the targeted bulk scan event for the accepted release", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));

    await expect(
      dispatchPluginInspectorReleaseScanWorkflow(
        { token: "installation-token", permissions: { contents: "write" } },
        target as never,
        fetchImpl,
      ),
    ).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/openclaw/clawhub/dispatches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          event_type: "clawhub-plugin-inspector-release-scan",
          client_payload: {
            package_name: "@openclaw/demo",
            version: "1.2.3",
            release_id: "packageReleases:demo",
          },
        }),
      }),
    );
  });

  it("skips releases that are not the latest public plugin release", async () => {
    enableDispatch();
    const ctx = { runQuery: vi.fn(async () => null), scheduler: { runAfter: vi.fn() } };

    await expect(
      dispatchHandler(ctx, { releaseId: "packageReleases:demo", retryCount: 0 }),
    ).resolves.toEqual({ dispatched: false, reason: "not-eligible" });
    expect(createGitHubAppInstallationToken).not.toHaveBeenCalled();
  });

  it("retries a rejected dispatch a bounded number of times", async () => {
    enableDispatch();
    vi.mocked(createGitHubAppInstallationToken).mockResolvedValue({
      token: "installation-token",
      expiresAt: Date.now() + 60_000,
      permissions: { contents: "write" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const runAfter = vi.fn(async () => "_scheduled_functions:retry");
    const ctx = { runQuery: vi.fn(async () => target), scheduler: { runAfter } };

    await expect(
      dispatchHandler(ctx, { releaseId: "packageReleases:demo", retryCount: 0 }),
    ).resolves.toEqual({ dispatched: false, reason: "github-rejected" });
    expect(runAfter).toHaveBeenCalledWith(60_000, expect.anything(), {
      releaseId: "packageReleases:demo",
      retryCount: 1,
    });

    runAfter.mockClear();
    await dispatchHandler(ctx, { releaseId: "packageReleases:demo", retryCount: 3 });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("targets only the latest public plugin release", async () => {
    const pkg = {
      _id: "packages:demo",
      name: "@openclaw/demo",
      family: "code-plugin",
      channel: "community",
      scanStatus: "clean",
      latestReleaseId: "packageReleases:latest",
    };
    const release = (id: string) => ({
      _id: id,
      packageId: "packages:demo",
      version: "1.2.3",
      publicationStatus: "published",
      verification: { scanStatus: "clean" },
    });
    const docs = new Map<string, unknown>([
      ["packages:demo", pkg],
      ["packageReleases:latest", release("packageReleases:latest")],
      ["packageReleases:older", release("packageReleases:older")],
    ]);
    const ctx = { db: { get: vi.fn(async (id: string) => docs.get(id) ?? null) } };

    await expect(targetHandler(ctx, { releaseId: "packageReleases:latest" })).resolves.toEqual({
      packageName: "@openclaw/demo",
      version: "1.2.3",
      releaseId: "packageReleases:latest",
    });
    await expect(targetHandler(ctx, { releaseId: "packageReleases:older" })).resolves.toBeNull();
    docs.set("packages:demo", { ...pkg, channel: "private" });
    await expect(targetHandler(ctx, { releaseId: "packageReleases:latest" })).resolves.toBeNull();
  });
});
