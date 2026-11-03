/* @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

const { createCrabLoader, formatError } = await import("./ui");

describe("formatError", () => {
  it("keeps ordinary errors concise", () => {
    expect(formatError(new Error("HTTP 404: skill not found"))).toBe("HTTP 404: skill not found");
  });

  it("redacts sensitive non-Error values", () => {
    const formatted = formatError("Authorization: Token abc123");

    expect(formatted).toBe("Authorization: [redacted]");
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

  it("redacts token-only URL userinfo in transport details", () => {
    const error = new Error("proxy https://proxy-token@proxy.example failed");

    const formatted = formatError(error);

    expect(formatted).toContain("Network request failed");
    expect(formatted).not.toContain("proxy-token");
    expect(formatted).toContain("https://[redacted]@proxy.example");
  });

  it("redacts generic Authorization schemes with separated credentials", () => {
    const error = new Error("fetch failed: Authorization: Basic dXNlcjpwYXNz");

    const formatted = formatError(error);

    expect(formatted).toContain("Authorization: [redacted]");
    expect(formatted).not.toContain("Basic");
    expect(formatted).not.toContain("dXNlcjpwYXNz");
  });

  it("omits unsafe fields from structured transport causes", () => {
    const error = new TypeError("fetch failed", {
      cause: {
        code: "ENOTFOUND",
        message: "getaddrinfo ENOTFOUND clawhub.ai",
        headers: {
          Authorization: "Basic dXNlcjpwYXNz",
          Cookie: "session=secret-session",
        },
        url: "https://user:password@clawhub.ai/search?token=clh_secret",
      },
    });

    const formatted = formatError(error);

    expect(formatted).toContain("Network request failed: DNS lookup failed.");
    expect(formatted).toContain("message: getaddrinfo ENOTFOUND clawhub.ai");
    expect(formatted).toContain("code: ENOTFOUND");
    expect(formatted).not.toContain("headers");
    expect(formatted).not.toContain("Authorization");
    expect(formatted).not.toContain("Basic");
    expect(formatted).not.toContain("dXNlcjpwYXNz");
    expect(formatted).not.toContain("Cookie");
    expect(formatted).not.toContain("secret-session");
    expect(formatted).not.toContain("user:password");
    expect(formatted).not.toContain("clh_secret");
  });

  it("redacts cookie and JSON-shaped credentials in transport details", () => {
    const error = new Error(
      'fetch failed: {"headers":{"Authorization":"Basic dXNlcjpwYXNz","Cookie":"session=secret-session"},"token":"clh_secret"}',
    );

    const formatted = formatError(error);

    expect(formatted).toContain("Network request failed");
    expect(formatted).toContain('"Authorization":"[redacted]"');
    expect(formatted).toContain('"Cookie":"[redacted]"');
    expect(formatted).toContain('"token":"[redacted]"');
    expect(formatted).not.toContain("Basic");
    expect(formatted).not.toContain("dXNlcjpwYXNz");
    expect(formatted).not.toContain("secret-session");
    expect(formatted).not.toContain("clh_secret");
  });

  it("classifies TLS and timeout failures", () => {
    const tls = new Error("self signed certificate in certificate chain");
    const timeout = new Error("Request timed out after 30s");

    expect(formatError(tls)).toContain("TLS or certificate validation failed");
    expect(formatError(timeout)).toContain("the request timed out");
  });
});

describe("createCrabLoader", () => {
  it("keeps non-interactive spinner output stable", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const spinner = createCrabLoader("Searching");
    spinner.text = "Downloading";
    spinner.stop();
    expect(logSpy).not.toHaveBeenCalledWith("Searching");
    expect(logSpy).not.toHaveBeenCalledWith("Downloading");

    spinner.succeed("Done");
    spinner.fail("Failed");

    expect(logSpy).toHaveBeenCalledWith("Done");
    expect(errorSpy).toHaveBeenCalledWith("Failed");
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
