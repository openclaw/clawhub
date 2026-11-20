/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPluginOgMeta } from "./fetchPluginOgMeta";
import { fetchSkillOgMeta } from "./fetchSkillOgMeta";
import { OG_FETCH_TIMEOUT_MS } from "./ogFetchTimeout";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each([
  {
    name: "fetchPluginOgMeta",
    fetchMeta: () => fetchPluginOgMeta("@openclaw/codex", "https://clawhub.ai"),
  },
  {
    name: "fetchSkillOgMeta",
    fetchMeta: () => fetchSkillOgMeta("gifgrep", "https://clawhub.ai"),
  },
])("$name", ({ fetchMeta }) => {
  it.each(["request", "JSON body"])("aborts a stalled %s at the OG timeout", async (stage) => {
    vi.useFakeTimers();
    let usedSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
      usedSignal = init?.signal ?? undefined;
      return stage === "request"
        ? stallUntilAborted(init?.signal)
        : Promise.resolve({
            ok: true,
            json: () => stallUntilAborted(init?.signal),
          } as unknown as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchMeta();
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

function stallUntilAborted(signal: AbortSignal | null | undefined) {
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
