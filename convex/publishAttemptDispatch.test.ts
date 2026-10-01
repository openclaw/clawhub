import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/githubAuth", () => ({
  createGitHubAppInstallationToken: vi.fn(),
}));

const { createGitHubAppInstallationToken } = await import("./lib/githubAuth");
const {
  dispatchPublishAttemptInternal,
  dispatchPublishAttemptWorkflow,
  isPublishAttemptEventDispatchEnabled,
  requestPublishAttemptDispatch,
} = await import("./publishAttemptDispatch");
const { getPendingPublishAttemptDispatchTargetInternal } = await import("./publishAttempts");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const dispatchPublishAttemptHandler = (
  dispatchPublishAttemptInternal as unknown as WrappedHandler<
    { attemptId: string; retryCount: number },
    { dispatched: boolean; reason?: string }
  >
)._handler;
const getPendingDispatchTargetHandler = (
  getPendingPublishAttemptDispatchTargetInternal as unknown as WrappedHandler<{
    attemptId: string;
  }>
)._handler;

function enableDispatch() {
  vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
  vi.stubEnv("GITHUB_APP_ID", "configured");
  vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
  vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");
}

describe("publishAttemptDispatch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("schedules an immediate exact attempt dispatch", async () => {
    enableDispatch();
    const runAfter = vi.fn(async () => "_scheduled_functions:1");

    await expect(
      requestPublishAttemptDispatch(
        { scheduler: { runAfter } } as never,
        "publishAttempts:demo" as never,
      ),
    ).resolves.toEqual({ scheduled: true });
    expect(runAfter).toHaveBeenCalledWith(0, expect.anything(), {
      attemptId: "publishAttempts:demo",
      retryCount: 0,
    });
  });

  it("requires the Test-only publish dispatch flag in Test", () => {
    vi.stubEnv("CLAWHUB_ENV", "test");
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");
    expect(isPublishAttemptEventDispatchEnabled()).toBe(false);

    vi.stubEnv("PREPUBLICATION_PUBLISH_EVENT_DISPATCH_ENABLED", "1");
    expect(isPublishAttemptEventDispatchEnabled()).toBe(true);
  });

  it("rechecks that the exact attempt is still pending", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        _id: "publishAttempts:pending",
        kind: "package",
        status: "pending_checks",
        slug: "@openclaw/demo",
        version: "1.0.0",
      })
      .mockResolvedValueOnce({
        _id: "publishAttempts:finalized",
        kind: "package",
        status: "finalized",
        slug: "@openclaw/demo",
        version: "1.0.0",
      });
    const ctx = { db: { get } };

    await expect(
      getPendingDispatchTargetHandler(ctx, { attemptId: "publishAttempts:pending" }),
    ).resolves.toEqual({
      attemptId: "publishAttempts:pending",
      kind: "package",
      slug: "@openclaw/demo",
      version: "1.0.0",
    });
    await expect(
      getPendingDispatchTargetHandler(ctx, { attemptId: "publishAttempts:finalized" }),
    ).resolves.toBeNull();
  });

  it("dispatches the exact prepublication worker payload", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));

    await expect(
      dispatchPublishAttemptWorkflow(
        {
          token: "installation-token",
          permissions: { contents: "write" },
        },
        {
          attemptId: "publishAttempts:demo" as never,
          kind: "package",
          slug: "@openclaw/demo",
          version: "1.0.0",
        },
        fetchImpl,
      ),
    ).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/openclaw/clawhub/dispatches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          event_type: "clawhub-prepublication-publish",
          client_payload: {
            attempt_id: "publishAttempts:demo",
            kind: "package",
            slug: "@openclaw/demo",
            version: "1.0.0",
            batch_limit: "1",
            max_jobs: "1",
            max_runtime_minutes: "20",
          },
        }),
      }),
    );
  });

  it("schedules bounded retries when GitHub rejects the dispatch", async () => {
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
    const ctx = {
      runQuery: vi.fn(async () => ({
        attemptId: "publishAttempts:demo",
        kind: "package",
        slug: "@openclaw/demo",
        version: "1.0.0",
      })),
      scheduler: { runAfter },
    };

    await expect(
      dispatchPublishAttemptHandler(ctx, {
        attemptId: "publishAttempts:demo",
        retryCount: 0,
      }),
    ).resolves.toEqual({ dispatched: false, reason: "github-rejected" });
    expect(runAfter).toHaveBeenCalledWith(60_000, expect.anything(), {
      attemptId: "publishAttempts:demo",
      retryCount: 1,
    });

    runAfter.mockClear();
    await dispatchPublishAttemptHandler(ctx, {
      attemptId: "publishAttempts:demo",
      retryCount: 3,
    });
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("marks staging publish events for the branch relay", async () => {
    vi.stubEnv("CLAWHUB_ENV", "staging");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await dispatchPublishAttemptWorkflow(
      { token: "installation-token", permissions: { contents: "write" } },
      {
        attemptId: "publishAttempts:staging" as never,
        kind: "skill",
        slug: "staging-proof",
        version: "1.0.0",
      },
      fetchImpl,
    );
    expect(JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      event_type: "clawhub-prepublication-publish",
      client_payload: { environment: "staging", attempt_id: "publishAttempts:staging" },
    });
  });

  it("marks Test publish events for the Test worker relay", async () => {
    vi.stubEnv("CLAWHUB_ENV", "test");
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await dispatchPublishAttemptWorkflow(
      { token: "installation-token", permissions: { contents: "write" } },
      {
        attemptId: "publishAttempts:test" as never,
        kind: "package",
        slug: "@openclaw/test-proof",
        version: "1.0.0",
      },
      fetchImpl,
    );
    expect(JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      event_type: "clawhub-prepublication-publish",
      client_payload: { environment: "test", attempt_id: "publishAttempts:test" },
    });
  });

  it("does not dispatch after the attempt leaves pending checks", async () => {
    enableDispatch();
    const runAfter = vi.fn();

    await expect(
      dispatchPublishAttemptHandler(
        {
          runQuery: vi.fn(async () => null),
          scheduler: { runAfter },
        },
        {
          attemptId: "publishAttempts:demo",
          retryCount: 0,
        },
      ),
    ).resolves.toEqual({ dispatched: false, reason: "not-pending" });
    expect(createGitHubAppInstallationToken).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });
});
