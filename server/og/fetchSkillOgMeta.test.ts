/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSkillOgMeta } from "./fetchSkillOgMeta";
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

describe("fetchSkillOgMeta", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reads downloads from the public skill API stats", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        skill: {
          displayName: "Gifgrep",
          summary: "Search GIFs fast",
          icon: `/api/v1/skill-icons/${"a".repeat(64)}`,
          stats: { downloads: 99, installsAllTime: 1200 },
          statsDownloads: 1200,
        },
        owner: { handle: "steipete", image: "https://avatars.githubusercontent.com/u/1?v=4" },
        latestVersion: { version: "1.0.1" },
        moderation: { verdict: "clean", isSuspicious: false, isMalwareBlocked: false },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const meta = await fetchSkillOgMeta("gifgrep", "https://clawhub.ai", "@steipete");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://clawhub.ai/api/v1/skills/gifgrep?ownerHandle=steipete",
      {
        headers: { Accept: "application/json" },
        signal: expect.any(AbortSignal),
      },
    );
    expect(meta?.stats.downloads).toBe(1200);
    expect(meta?.icon).toBe(`https://clawhub.ai/api/v1/skill-icons/${"a".repeat(64)}`);
  });

  it("aborts a hanging public skill API fetch after the OG timeout", async () => {
    vi.useFakeTimers();
    let usedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((input: unknown, init?: RequestInit) => {
      usedSignal = init?.signal ?? undefined;
      return hangUntilAborted(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchSkillOgMeta("gifgrep", "https://clawhub.ai");
    await Promise.resolve();
    expect(usedSignal).toBeInstanceOf(AbortSignal);
    expect(usedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(OG_FETCH_TIMEOUT_MS - 1);
    expect(usedSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBeNull();
    expect(usedSignal?.aborted).toBe(true);
  });

  it("aborts when the public skill API returns headers then stalls the JSON body", async () => {
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

    const pending = fetchSkillOgMeta("gifgrep", "https://clawhub.ai");
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
