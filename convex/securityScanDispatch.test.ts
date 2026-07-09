import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginSecurityScanDispatchInternal,
  dispatchSecurityScanWorkflow,
  finishSecurityScanDispatchInternal,
  requestSecurityScanDispatchInternal,
} from "./securityScanDispatch";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const requestSecurityScanDispatchInternalHandler = (
  requestSecurityScanDispatchInternal as unknown as WrappedHandler<
    Record<string, never>,
    { scheduled: boolean; scheduledAt?: number }
  >
)._handler;

const beginSecurityScanDispatchInternalHandler = (
  beginSecurityScanDispatchInternal as unknown as WrappedHandler<
    { scheduleToken: string },
    { shouldDispatch: boolean; leaseToken?: string }
  >
)._handler;

const finishSecurityScanDispatchInternalHandler = (
  finishSecurityScanDispatchInternal as unknown as WrappedHandler<
    {
      leaseToken: string;
      outcome: "succeeded" | "failed" | "unknown";
      error?: string;
    },
    { ok: boolean; stale?: boolean }
  >
)._handler;

describe("securityScanDispatch", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
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
    const query = vi.fn((table: string) => {
      if (table === "securityScanJobs") {
        return {
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              first: vi.fn(async () => ({
                _id: "securityScanJobs:1",
                status: "queued",
                nextRunAt: 900_000,
              })),
            })),
          })),
        };
      }
      return {
        withIndex: vi.fn(() => ({
          unique: vi.fn(async () => null),
        })),
      };
    });

    const result = await requestSecurityScanDispatchInternalHandler(
      {
        db: {
          get: vi.fn(),
          insert,
          patch: vi.fn(),
          query,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
          system: {},
        },
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

  it("coalesces simultaneous queue requests behind the existing scheduled dispatch", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");

    const runAt = vi.fn();
    const query = vi.fn((table: string) => {
      if (table === "securityScanJobs") {
        return {
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              first: vi.fn(async () => ({
                _id: "securityScanJobs:1",
                status: "queued",
                nextRunAt: 900_000,
              })),
            })),
          })),
        };
      }
      return {
        withIndex: vi.fn(() => ({
          unique: vi.fn(async () => ({
            _id: "securityScanDispatchState:1",
            key: "codex-worker",
            scheduledToken: "existing-token",
            scheduledAt: 1_000_000,
            updatedAt: 999_000,
          })),
        })),
      };
    });

    const result = await requestSecurityScanDispatchInternalHandler(
      {
        db: {
          get: vi.fn(),
          insert: vi.fn(),
          patch: vi.fn(),
          query,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
          system: {},
        },
        scheduler: { runAt },
      },
      {},
    );

    expect(result).toEqual({ scheduled: false, scheduledAt: 1_000_000 });
    expect(runAt).not.toHaveBeenCalled();
  });

  it("defers the next drain wave until the active dispatch lease expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");

    const patch = vi.fn();
    const runAt = vi.fn(async () => "_scheduled_functions:next");
    const query = vi.fn((table: string) => {
      if (table === "securityScanJobs") {
        return {
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              first: vi.fn(async () => ({
                _id: "securityScanJobs:2",
                status: "queued",
                nextRunAt: 900_000,
              })),
            })),
          })),
        };
      }
      return {
        withIndex: vi.fn(() => ({
          unique: vi.fn(async () => ({
            _id: "securityScanDispatchState:1",
            key: "codex-worker",
            leaseToken: "active-lease",
            leaseExpiresAt: 1_300_000,
            updatedAt: 999_000,
          })),
        })),
      };
    });

    const result = await requestSecurityScanDispatchInternalHandler(
      {
        db: {
          get: vi.fn(),
          insert: vi.fn(),
          patch,
          query,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
          system: {},
        },
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

  it("replaces a stale scheduled token when the watchdog finds claimable work", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    vi.stubEnv("SECURITY_SCAN_EVENT_DISPATCH_ENABLED", "1");
    vi.stubEnv("GITHUB_APP_ID", "configured");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "configured");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "configured");

    const patch = vi.fn();
    const runAt = vi.fn(async () => "_scheduled_functions:replacement");
    const query = vi.fn((table: string) => {
      if (table === "securityScanJobs") {
        return {
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              first: vi.fn(async () => ({
                _id: "securityScanJobs:stuck",
                status: "queued",
                nextRunAt: 800_000,
              })),
            })),
          })),
        };
      }
      return {
        withIndex: vi.fn(() => ({
          unique: vi.fn(async () => ({
            _id: "securityScanDispatchState:1",
            key: "codex-worker",
            scheduledToken: "lost-token",
            scheduledAt: 900_000,
            updatedAt: 900_000,
          })),
        })),
      };
    });

    const result = await requestSecurityScanDispatchInternalHandler(
      {
        db: {
          get: vi.fn(),
          insert: vi.fn(),
          patch,
          query,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
          system: {},
        },
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
    const query = vi.fn((table: string) => {
      if (table === "securityScanJobs") {
        return {
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              first: vi.fn(async () => ({
                _id: "securityScanJobs:claimable",
                status: "queued",
                nextRunAt: 900_000,
              })),
            })),
          })),
        };
      }
      return {
        withIndex: vi.fn(() => ({
          unique: vi.fn(async () => ({
            _id: "securityScanDispatchState:1",
            key: "codex-worker",
            scheduledToken: "current-token",
            scheduledAt: 1_000_000,
            updatedAt: 999_000,
          })),
        })),
      };
    });

    const result = await beginSecurityScanDispatchInternalHandler(
      {
        db: {
          get: vi.fn(),
          insert: vi.fn(),
          patch,
          query,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
          system: {},
        },
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
        leaseExpiresAt: 1_300_000,
      }),
    );
  });

  it("refuses to dispatch when the GitHub App lacks Actions write permission", async () => {
    const fetchImpl = vi.fn();

    await expect(
      dispatchSecurityScanWorkflow(
        {
          token: "installation-token",
          permissions: { actions: "read", contents: "read" },
        },
        fetchImpl,
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "actions-write-required",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("dispatches the production workflow on main with bounded worker inputs", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));

    await expect(
      dispatchSecurityScanWorkflow(
        {
          token: "installation-token",
          permissions: { actions: "write", contents: "read" },
        },
        fetchImpl,
      ),
    ).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/openclaw/clawhub/actions/workflows/security-scan-codex.yml/dispatches",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer installation-token",
        }),
        body: JSON.stringify({
          ref: "main",
          inputs: {
            "batch-limit": "4",
            "max-runtime-minutes": "8",
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
    const query = vi.fn((table: string) => {
      if (table === "securityScanJobs") {
        return {
          withIndex: vi.fn(() => ({
            order: vi.fn(() => ({
              first: vi.fn(async () => ({
                _id: "securityScanJobs:retry",
                status: "queued",
                nextRunAt: 900_000,
              })),
            })),
          })),
        };
      }
      return {
        withIndex: vi.fn(() => ({
          unique: vi.fn(async () => state),
        })),
      };
    });

    const result = await finishSecurityScanDispatchInternalHandler(
      {
        db: {
          get: vi.fn(),
          insert: vi.fn(),
          patch,
          query,
          replace: vi.fn(),
          delete: vi.fn(),
          normalizeId: vi.fn(),
          system: {},
        },
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
