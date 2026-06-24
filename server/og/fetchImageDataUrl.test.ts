/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchImageDataUrl,
  isSafePublicHttpsOgImageUrl,
  isTrustedOgImageUrl,
} from "./fetchImageDataUrl";

describe("fetchImageDataUrl", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("only trusts known public avatar image hosts over https", () => {
    expect(isTrustedOgImageUrl("https://avatars.githubusercontent.com/u/1?v=4")).toBe(true);
    expect(isTrustedOgImageUrl("https://www.gravatar.com/avatar/hash?s=160")).toBe(true);
    expect(isTrustedOgImageUrl("http://avatars.githubusercontent.com/u/1")).toBe(false);
    expect(isTrustedOgImageUrl("https://127.0.0.1/avatar.png")).toBe(false);
    expect(isTrustedOgImageUrl("https://example.com/avatar.png")).toBe(false);
  });

  it("allows public https org profile images on domain names", () => {
    expect(
      isSafePublicHttpsOgImageUrl("https://iprsoftwaremedia.com/219/files/202512/nvidia-logo.png"),
    ).toBe(true);
    expect(isSafePublicHttpsOgImageUrl("https://avatars.githubusercontent.com/u/1?v=4")).toBe(true);
    expect(isSafePublicHttpsOgImageUrl("http://example.com/logo.png")).toBe(false);
    expect(isSafePublicHttpsOgImageUrl("https://127.0.0.1/logo.png")).toBe(false);
    expect(isSafePublicHttpsOgImageUrl("https://localhost/logo.png")).toBe(false);
    expect(isSafePublicHttpsOgImageUrl("https://metadata.google.internal/logo.png")).toBe(false);
    expect(isSafePublicHttpsOgImageUrl("https://192.168.0.10/logo.png")).toBe(false);
  });

  it("does not fetch untrusted image URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchImageDataUrl("https://127.0.0.1/avatar.png")).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches public https org profile images", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchImageDataUrl("https://cdn.example.com/org-logo.png", {
        allowPublicHttps: true,
      }),
    ).resolves.toBe("data:image/png;base64,AQI=");
  });

  it("converts trusted image responses to data URLs", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchImageDataUrl("https://avatars.githubusercontent.com/u/1?v=4")).resolves.toBe(
      "data:image/png;base64,AQI=",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://avatars.githubusercontent.com/u/1?v=4"),
      {
        headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/*" },
        redirect: "manual",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("rejects trusted image responses that declare oversized bodies", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": "1500001",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchImageDataUrl("https://avatars.githubusercontent.com/u/1?v=4"),
    ).resolves.toBeNull();
  });

  it("rejects trusted image responses that stream past the byte cap", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(new Uint8Array(1_500_001), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchImageDataUrl("https://avatars.githubusercontent.com/u/1?v=4"),
    ).resolves.toBeNull();
  });
});
