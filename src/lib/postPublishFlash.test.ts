/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumePostPublishFlash, setPostPublishFlash } from "./postPublishFlash";

describe("postPublishFlash", () => {
  const originalSessionStorage = window.sessionStorage;

  beforeEach(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: originalSessionStorage,
    });
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists and consumes a scoped publish flash", () => {
    expect(setPostPublishFlash("steipete", "weather")).toBe(true);

    expect(consumePostPublishFlash("steipete", "weather")).toBe(true);
    expect(consumePostPublishFlash("steipete", "weather")).toBe(false);
  });

  it("survives a canonical owner redirect by keeping a slug fallback", () => {
    expect(setPostPublishFlash("users:123", "weather")).toBe(true);

    expect(consumePostPublishFlash("steipete", "weather")).toBe(true);
    expect(consumePostPublishFlash("users:123", "weather")).toBe(false);
  });

  it("reports when storage is unavailable", () => {
    const unavailableSessionStorage: Pick<Storage, "setItem"> = {
      setItem: () => {
        throw new Error("storage disabled");
      },
    };

    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: unavailableSessionStorage,
    });

    expect(setPostPublishFlash("steipete", "weather")).toBe(false);
  });
});
