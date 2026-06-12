/* @vitest-environment node */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDocsAuthCallbackUrl, normalizeDocsReturnTo } from "./docsAuth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("docs auth helpers", () => {
  it("allows documentation return URLs and rejects unrelated origins", () => {
    expect(normalizeDocsReturnTo("https://documentation.openclaw.ai/concepts/models")).toBe(
      "https://documentation.openclaw.ai/concepts/models",
    );
    expect(normalizeDocsReturnTo("https://docs.openclaw.ai/install")).toBe(
      "https://docs.openclaw.ai/install",
    );
    expect(normalizeDocsReturnTo("https://example.com/docs")).toBeNull();
    expect(normalizeDocsReturnTo("javascript:alert(1)")).toBeNull();
  });

  it("keeps callbacks on the same docs host", () => {
    expect(buildDocsAuthCallbackUrl("https://documentation.openclaw.ai/concepts/models")).toBe(
      "https://documentation.openclaw.ai/ask-molty/auth/callback",
    );
    expect(buildDocsAuthCallbackUrl("https://docs.openclaw.ai/concepts/models")).toBe(
      "https://docs.openclaw.ai/ask-molty/auth/callback",
    );
  });

  it("keeps local callbacks local for dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(buildDocsAuthCallbackUrl("http://localhost:4173/start")).toBe(
      "http://localhost:4173/ask-molty/auth/callback",
    );
    expect(normalizeDocsReturnTo("http://127.0.0.1:4173/start")).toBe(
      "http://127.0.0.1:4173/start",
    );
  });

  it("rejects localhost docs origins in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(normalizeDocsReturnTo("http://localhost:4173/start")).toBeNull();
    expect(normalizeDocsReturnTo("http://127.0.0.1:4173/start")).toBeNull();
    expect(buildDocsAuthCallbackUrl("http://localhost:4173/start")).toBeNull();
  });

  it("still allows production docs origins in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(normalizeDocsReturnTo("https://docs.openclaw.ai/install")).toBe(
      "https://docs.openclaw.ai/install",
    );
  });
});
