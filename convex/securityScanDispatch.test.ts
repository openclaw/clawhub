import { afterEach, describe, expect, it, vi } from "vitest";
import { getTestHandler } from "../src/__tests__/helpers/convexHandler";
import {
  beginSecurityScanDispatchInternal,
  dispatchSecurityScanWorkflow,
  finishSecurityScanDispatchInternal,
  getGitHubRepositoryDispatchPermission,
  requestSecurityScanDispatchInternal,
} from "./securityScanDispatch";

const requestSecurityScanDispatchInternalHandler = getTestHandler<
  Record<string, never>,
  { scheduled: boolean; scheduledAt?: number }
>(requestSecurityScanDispatchInternal);

const beginSecurityScanDispatchInternalHandler = getTestHandler<
  { scheduleToken: string },
  { shouldDispatch: boolean; leaseToken?: string }
>(beginSecurityScanDispatchInternal);

const finishSecurityScanDispatchInternalHandler = getTestHandler<
  {
    leaseToken: string;
    outcome: "succeeded" | "failed" | "unknown";
    error?: string;
  },
  { ok: boolean; stale?: boolean }
>(finishSecurityScanDispatchInternal);

function makeDispatchQuery<TJob, TState>(getJob: () => TJob, getState: () => TState) {
  return vi.fn((table: string) => {
    if (table === "securityScanJobs") {
      return {
        withIndex: vi.fn(() => ({
          order: vi.fn(() => ({
            first: vi.fn(async () => getJob()),
          })),
        })),
      };
    }
    return {
      withIndex: vi.fn(() => ({
        unique: vi.fn(async () => getState()),
      })),
    };
  });
}

function makeDispatchDb({
  query,
  insert = vi.fn(),
  patch = vi.fn(),
}: {
  query: ReturnType<typeof vi.fn>;
  insert?: ReturnType<typeof vi.fn>;
  patch?: ReturnType<typeof vi.fn>;
}) {
  return {
    get: vi.fn(),
    insert,
    patch,
    query,
    replace: vi.fn(),
    delete: vi.fn(),
    normalizeId: vi.fn(),
    system: {},
  };
}

describe("securityScanDispatch", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each(["staging", "test"])("marks %s scan events for their deployment", async (environment) => {
    vi.stubEnv("CLAWHUB_ENV", environment);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await dispatchSecurityScanWorkflow(
      { token: "installation-token", permissions: { contents: "write" } },
      fetchImpl,
    );
    expect(JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      event_type: "clawhub-security-scan",
      client_payload: { environment },
    });
  });

  it("schedules an immediate worker dispatch for claimable queue work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");

    const insert = vi.fn(async () => "securityScanDispatchState:1");
    const runAt = vi.fn(async () => "_scheduled_functions:1");
    const query = makeDispatchQuery(
      () => ({
        _id: "securityScanJobs:1",
        status: "queued",
        nextRunAt: 900_000,
      }),
      () => null,
    );

    const result = await requestSecurityScanDispatchInternalHandler(
      {
        db: makeDispatchDb({ query, insert }),
        scheduler: { runAt },
      },
      {},
    );

    expect(result).toEqual({ scheduled: true, scheduledAt: 1_000_000 });
    expect(runAt).toHaveBeenCalledWith(1_000_000, expect.anything(), {
      scheduleToken: expect.any(String),
    });
    expect(insert).toHaveBeenCalledWith(
      "securityScanDispatchState",
      expect.objectContaining({
        key: "codex-worker",
        scheduledAt: 1_000_000,
        scheduledToken: expect.any(String),
      }),
    );
  });

  it.each([
    { scheduledAt: 1_000_000, leaseExpiresAt: undefined },
    { scheduledAt: 1_300_000, leaseExpiresAt: 1_300_000 },
  ])(
    "coalesces requests without reading the queue when dispatch is covered: %j",
    async ({ scheduledAt, leaseExpiresAt }) => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000_000);
      vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
      vi.stubEnv("GITHUB_APP_ID", "configured");
      vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
      vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");

      const runAt = vi.fn();
      const query = makeDispatchQuery(
        () => ({
          _id: "securityScanJobs:1",
          status: "queued",
          nextRunAt: 900_000,
        }),
        () => ({
          _id: "securityScanDispatchState:1",
          key: "codex-worker",
          scheduledToken: "existing-token",
          scheduledAt,
          leaseExpiresAt,
          updatedAt: 999_000,
        }),
      );

      const result = await requestSecurityScanDispatchInternalHandler(
        {
          db: makeDispatchDb({ query }),
          scheduler: { runAt },
        },
        {},
      );

      expect(result).toEqual({ scheduled: false, scheduledAt });
      expect(runAt).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalledWith("securityScanJobs");
    },
  );

  it("defers the next drain wave until the active dispatch lease expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");

    const patch = vi.fn();
    const runAt = vi.fn(async () => "_scheduled_functions:next");
    const query = makeDispatchQuery(
      () => ({
        _id: "securityScanJobs:2",
        status: "queued",
        nextRunAt: 900_000,
      }),
      () => ({
        _id: "securityScanDispatchState:1",
        key: "codex-worker",
        leaseToken: "active-lease",
        leaseExpiresAt: 1_300_000,
        updatedAt: 999_000,
      }),
    );

    const result = await requestSecurityScanDispatchInternalHandler(
      {
        db: makeDispatchDb({ query, patch }),
        scheduler: { runAt },
      },
      {},
    );

    expect(result).toEqual({ scheduled: true, scheduledAt: 1_300_000 });
    expect(runAt).toHaveBeenCalledWith(1_300_000, expect.anything(), {
      scheduleToken: expect.any(String),
    });
    expect(patch).toHaveBeenCalledWith(
      "securityScanDispatchState:1",
      expect.objectContaining({ scheduledAt: 1_300_000 }),
    );
  });

  it("brings a future dispatch forward for newly claimable work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");

    const patch = vi.fn();
    const runAt = vi.fn(async () => "_scheduled_functions:next");
    const query = makeDispatchQuery(
      () => ({
        _id: "securityScanJobs:2",
        status: "queued",
        nextRunAt: 900_000,
      }),
      () => ({
        _id: "securityScanDispatchState:1",
        key: "codex-worker",
        scheduledToken: "future-dispatch",
        scheduledAt: 1_300_000,
        updatedAt: 999_000,
      }),
    );

    const result = await requestSecurityScanDispatchInternalHandler(
      {
        db: makeDispatchDb({ query, patch }),
        scheduler: { runAt },
      },
      {},
    );

    expect(result).toEqual({ scheduled: true, scheduledAt: 1_000_000 });
    expect(runAt).toHaveBeenCalledWith(1_000_000, expect.anything(), {
      scheduleToken: expect.any(String),
    });
    expect(patch).toHaveBeenCalledWith(
      "securityScanDispatchState:1",
      expect.objectContaining({ scheduledAt: 1_000_000 }),
    );
  });

  it("replaces a stale scheduled token when the watchdog finds claimable work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");

    const patch = vi.fn();
    const runAt = vi.fn(async () => "_scheduled_functions:replacement");
    const query = makeDispatchQuery(
      () => ({
        _id: "securityScanJobs:stuck",
        status: "queued",
        nextRunAt: 800_000,
      }),
      () => ({
        _id: "securityScanDispatchState:1",
        key: "codex-worker",
        scheduledToken: "lost-token",
        scheduledAt: 900_000,
        updatedAt: 900_000,
      }),
    );

    const result = await requestSecurityScanDispatchInternalHandler(
      {
        db: makeDispatchDb({ query, patch }),
        scheduler: { runAt },
      },
      {},
    );

    expect(result).toEqual({ scheduled: true, scheduledAt: 1_000_000 });
    expect(runAt).toHaveBeenCalledWith(1_000_000, expect.anything(), {
      scheduleToken: expect.not.stringMatching(/^lost-token$/),
    });
  });

  it("atomically acquires a dispatch lease only for the current scheduled token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");

    const patch = vi.fn();
    const query = makeDispatchQuery(
      () => ({
        _id: "securityScanJobs:claimable",
        status: "queued",
        nextRunAt: 900_000,
      }),
      () => ({
        _id: "securityScanDispatchState:1",
        key: "codex-worker",
        scheduledToken: "current-token",
        scheduledAt: 1_000_000,
        updatedAt: 999_000,
      }),
    );

    const result = await beginSecurityScanDispatchInternalHandler(
      {
        db: makeDispatchDb({ query, patch }),
        scheduler: { runAt: vi.fn() },
      },
      { scheduleToken: "current-token" },
    );

    expect(result).toEqual({
      shouldDispatch: true,
      leaseToken: expect.any(String),
    });
    expect(patch).toHaveBeenCalledWith(
      "securityScanDispatchState:1",
      expect.objectContaining({
        scheduledToken: undefined,
        scheduledAt: undefined,
        leaseToken: result.leaseToken,
        leaseExpiresAt: 1_900_000,
      }),
    );
  });

  it("reports whether the GitHub App can create repository dispatches", () => {
    expect(getGitHubRepositoryDispatchPermission({ contents: "read" })).toEqual({
      contentsPermission: "read",
      canDispatch: false,
    });
    expect(getGitHubRepositoryDispatchPermission({ contents: "write" })).toEqual({
      contentsPermission: "write",
      canDispatch: true,
    });
  });

  it("refuses to dispatch when the GitHub App lacks Contents write permission", async () => {
    const fetchImpl = vi.fn();

    await expect(
      dispatchSecurityScanWorkflow(
        {
          token: "installation-token",
          permissions: { actions: "write", contents: "read" },
        },
        fetchImpl,
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "contents-write-required",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("dispatches the production workflow through a narrowly typed repository event", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));

    await expect(
      dispatchSecurityScanWorkflow(
        {
          token: "installation-token",
          permissions: { contents: "write" },
        },
        fetchImpl,
      ),
    ).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/openclaw/clawhub/dispatches",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer installation-token",
        }),
        body: JSON.stringify({
          event_type: "clawhub-security-scan",
          client_payload: {
            batch_limit: "4",
            max_runtime_minutes: "12",
          },
        }),
      }),
    );
  });

  it("releases a rejected dispatch lease and schedules a bounded retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");

    const state: Record<string, unknown> = {
      _id: "securityScanDispatchState:1",
      key: "codex-worker",
      leaseToken: "dispatch-lease",
      leaseExpiresAt: 1_300_000,
      updatedAt: 999_000,
    };
    const patch = vi.fn(async (_id: string, next: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined) delete state[key];
        else state[key] = value;
      }
    });
    const runAt = vi.fn(async () => "_scheduled_functions:retry");
    const query = makeDispatchQuery(
      () => ({
        _id: "securityScanJobs:retry",
        status: "queued",
        nextRunAt: 900_000,
      }),
      () => state,
    );

    const result = await finishSecurityScanDispatchInternalHandler(
      {
        db: makeDispatchDb({ query, patch }),
        scheduler: { runAt },
      },
      {
        leaseToken: "dispatch-lease",
        outcome: "failed",
        error: "GitHub rejected the dispatch",
      },
    );

    expect(result).toEqual({ ok: true });
    expect(runAt).toHaveBeenCalledWith(1_060_000, expect.anything(), {
      scheduleToken: expect.any(String),
    });
    expect(state).toMatchObject({
      lastDispatchStatus: "failed",
      lastError: "GitHub rejected the dispatch",
      scheduledAt: 1_060_000,
    });
    expect(state).not.toHaveProperty("leaseToken");
    expect(state).not.toHaveProperty("leaseExpiresAt");
  });
});
