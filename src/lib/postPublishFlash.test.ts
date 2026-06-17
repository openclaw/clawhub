/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumePostPublishFlash, setPostPublishFlash } from "./postPublishFlash";

describe("postPublishFlash", () => {
  beforeEach(() => {
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
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(setPostPublishFlash("steipete", "weather")).toBe(false);
  });
});
