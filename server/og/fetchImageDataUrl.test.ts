/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchImageDataUrl,
  fetchPublisherProfileImageDataUrl,
  isSafePublicHttpsOgImageUrl,
  isTrustedOgImageUrl,
} from "./fetchImageDataUrl";
import { requestPublicImage } from "./requestPublicImage";
vi.mock("./requestPublicImage", () => ({ requestPublicImage: vi.fn() }));

describe("fetchImageDataUrl", () => {
  afterEach(() => {
    vi.mocked(requestPublicImage).mockReset();
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
    vi.mocked(requestPublicImage).mockImplementation(fetchMock);

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
    vi.mocked(requestPublicImage).mockImplementation(fetchMock);

    await expect(
      fetchImageDataUrl("https://cdn.example.com/org-logo.png", {
        allowPublicHttps: true,
      }),
    ).resolves.toBe("data:image/png;base64,AQI=");
  });

  it("validates redirects and rejects a private redirect without fetching it", async () => {
    vi.mocked(requestPublicImage).mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "https://127.0.0.1/internal" },
      }),
    );
    await expect(
      fetchPublisherProfileImageDataUrl("https://cdn.example.com/image.png"),
    ).resolves.toBeNull();
    expect(requestPublicImage).toHaveBeenCalledOnce();
  });

  it("runs every public redirect through the protected image transport", async () => {
    vi.mocked(requestPublicImage)
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: "https://other.example.com/image.png" },
        }),
      )
      .mockRejectedValueOnce(new Error("Image destination is not public"));
    await expect(
      fetchPublisherProfileImageDataUrl("https://cdn.example.com/image.png"),
    ).resolves.toBeNull();
    expect(requestPublicImage).toHaveBeenNthCalledWith(
      2,
      new URL("https://other.example.com/image.png"),
      expect.any(AbortSignal),
    );
  });

  it("converts trusted image responses to data URLs", async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    vi.mocked(requestPublicImage).mockImplementation(fetchMock);

    await expect(fetchImageDataUrl("https://avatars.githubusercontent.com/u/1?v=4")).resolves.toBe(
      "data:image/png;base64,AQI=",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://avatars.githubusercontent.com/u/1?v=4"),
      expect.any(AbortSignal),
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
    vi.mocked(requestPublicImage).mockImplementation(fetchMock);

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
    vi.mocked(requestPublicImage).mockImplementation(fetchMock);

    await expect(
      fetchImageDataUrl("https://avatars.githubusercontent.com/u/1?v=4"),
    ).resolves.toBeNull();
  });
});
