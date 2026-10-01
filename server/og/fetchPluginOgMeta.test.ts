/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPluginOgMeta } from "./fetchPluginOgMeta";
import { OG_FETCH_TIMEOUT_MS } from "./ogFetchTimeout";

function hangUntilAborted(_input: unknown, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    signal.addEventListener(
      "abort",
      () => {
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException("The operation was aborted.", "AbortError"),
        );
      },
      { once: true },
    );
  });
}

function stallingBody(signal: AbortSignal | null | undefined) {
  return new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    signal.addEventListener(
      "abort",
      () => {
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException("The operation was aborted.", "AbortError"),
        );
      },
      { once: true },
    );
  });
}

describe("fetchPluginOgMeta", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads downloads from package API stats", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        package: {
          name: "@openclaw/codex",
          displayName: "Codex",
          summary: "OpenClaw Codex harness.",
          latestVersion: "1.0.0",
          stats: { downloads: 99, installs: 1200 },
          verification: { scanStatus: "clean" },
        },
        owner: { handle: "openclaw", image: null },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const meta = await fetchPluginOgMeta("@openclaw/codex", "https://clawhub.ai");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://clawhub.ai/api/v1/packages/%40openclaw%2Fcodex",
      {
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      },
    );
    expect(meta?.stats.downloads).toBe(99);
  });

  it("aborts a hanging public package API fetch after the OG timeout", async () => {
    vi.useFakeTimers();
    let usedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      usedSignal = init?.signal ?? undefined;
      return hangUntilAborted(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchPluginOgMeta("@openclaw/codex", "https://clawhub.ai");
    await Promise.resolve();
    expect(usedSignal).toBeInstanceOf(AbortSignal);
    expect(usedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(OG_FETCH_TIMEOUT_MS - 1);
    expect(usedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
    expect(usedSignal?.aborted).toBe(true);
  });

  it("aborts when the public package API returns headers then stalls the JSON body", async () => {
    vi.useFakeTimers();
    let usedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
      usedSignal = init?.signal ?? undefined;
      return Promise.resolve({
        ok: true,
        json: () => stallingBody(init?.signal),
      } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchPluginOgMeta("@openclaw/codex", "https://clawhub.ai");
    await Promise.resolve();
    expect(usedSignal).toBeInstanceOf(AbortSignal);
    expect(usedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(OG_FETCH_TIMEOUT_MS - 1);
    expect(usedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
    expect(usedSignal?.aborted).toBe(true);
  });
});
