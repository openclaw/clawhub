/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

const mockSpawn = vi.fn();
const originalPlatform = process.platform;

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

const { formatError, openInBrowser } = await import("./ui");

type ErrorHandler = (error: NodeJS.ErrnoException) => void;

function createMockChild() {
  let onError: ErrorHandler | null = null;
  const child = {
    on: vi.fn((event: string, handler: ErrorHandler) => {
      if (event === "error") onError = handler;
      return child;
    }),
    unref: vi.fn(),
    emitError: (error: NodeJS.ErrnoException) => onError?.(error),
  };
  return child;
}

describe("openInBrowser", () => {
  it("uses explorer on Windows and preserves query params in the URL argument", () => {
    const child = createMockChild();
    mockSpawn.mockReturnValueOnce(child);
    const url =
      "https://clawhub.ai/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback&state=abc123";

    try {
      Object.defineProperty(process, "platform", { value: "win32" });
      openInBrowser(url);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }

    expect(mockSpawn).toHaveBeenCalledWith("explorer", [url], {
      stdio: "ignore",
      detached: true,
    });
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("prints manual URL instructions when browser opener is missing", () => {
    const child = createMockChild();
    mockSpawn.mockReturnValueOnce(child);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    openInBrowser("https://clawhub.ai");
    child.emitError(Object.assign(new Error("not found"), { code: "ENOENT" }));

    expect(logSpy).toHaveBeenCalledWith("Could not open browser automatically.");
    expect(logSpy).toHaveBeenCalledWith("Please open this URL manually:");
    expect(logSpy).toHaveBeenCalledWith("  https://clawhub.ai");
    expect(child.unref).toHaveBeenCalledOnce();
    logSpy.mockRestore();
  });

  it("does not print manual instructions for non-ENOENT errors", () => {
    const child = createMockChild();
    mockSpawn.mockReturnValueOnce(child);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    openInBrowser("https://clawhub.ai");
    child.emitError(Object.assign(new Error("permission denied"), { code: "EACCES" }));

    expect(logSpy).not.toHaveBeenCalledWith("Could not open browser automatically.");
    expect(child.unref).toHaveBeenCalledOnce();
    logSpy.mockRestore();
  });
});

describe("formatError", () => {
  it("keeps ordinary errors concise", () => {
    expect(formatError(new Error("HTTP 404: skill not found"))).toBe("HTTP 404: skill not found");
  });

  it("adds DNS guidance for nested fetch failures", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND clawhub.ai"), {
      code: "ENOTFOUND",
    });
    const error = new TypeError("fetch failed", { cause });

    const formatted = formatError(error);

    expect(formatted).toContain("Network request failed: DNS lookup failed.");
    expect(formatted).toContain("fetch failed: getaddrinfo ENOTFOUND clawhub.ai");
    expect(formatted).toContain("HTTPS_PROXY");
  });

  it("redacts tokens, callback URLs, and proxy credentials in transport details", () => {
    const error = new Error(
      "curl failed for https://clawhub.ai/login?token=clh_secret&redirect_uri=http://127.0.0.1:54321/callback Authorization: Bearer clh_other",
      {
        cause: new Error("proxy http://user:password@proxy.example:8080 failed"),
      },
    );

    const formatted = formatError(error);

    expect(formatted).toContain("Network request failed");
    expect(formatted).not.toContain("clh_secret");
    expect(formatted).not.toContain("clh_other");
    expect(formatted).not.toContain("127.0.0.1:54321");
    expect(formatted).not.toContain("user:password");
    expect(formatted).toContain("token=[redacted]");
    expect(formatted).toContain("redirect_uri=[redacted]");
    expect(formatted).toContain("Authorization: Bearer [redacted]");
    expect(formatted).toContain("http://[redacted]@proxy.example:8080");
  });

  it("redacts generic Authorization schemes with separated credentials", () => {
    const error = new Error("fetch failed: Authorization: Basic dXNlcjpwYXNz");

    const formatted = formatError(error);

    expect(formatted).toContain("Authorization: [redacted]");
    expect(formatted).not.toContain("Basic");
    expect(formatted).not.toContain("dXNlcjpwYXNz");
  });

  it("classifies TLS and timeout failures", () => {
    const tls = new Error("self signed certificate in certificate chain");
    const timeout = new Error("Request timed out after 30s");

    expect(formatError(tls)).toContain("TLS or certificate validation failed");
    expect(formatError(timeout)).toContain("the request timed out");
  });
});
