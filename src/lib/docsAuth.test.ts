/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { buildDocsAuthCallbackUrl, normalizeDocsReturnTo } from "./docsAuth";

describe("docs auth helpers", () => {
  it("allows documentation return URLs and rejects unrelated origins", () => {
    expect(normalizeDocsReturnTo("https://clawhub.ai/docs/auth")).toBe(
      "https://clawhub.ai/docs/auth",
    );
    expect(normalizeDocsReturnTo("https://documentation.openclaw.ai/concepts/models")).toBe(
      "https://documentation.openclaw.ai/concepts/models",
    );
    expect(normalizeDocsReturnTo("https://docs.openclaw.ai/install")).toBe(
      "https://docs.openclaw.ai/install",
    );
    expect(normalizeDocsReturnTo("https://example.com/docs")).toBeNull();
    expect(normalizeDocsReturnTo("javascript:alert(1)")).toBeNull();
  });

  it("rejects local return URLs from production app origins", () => {
    expect(
      normalizeDocsReturnTo("http://127.0.0.1:16754/docs", {
        currentOrigin: "https://clawhub.ai",
      }),
    ).toBeNull();
    expect(
      buildDocsAuthCallbackUrl("http://localhost:3000/docs/start", {
        currentOrigin: "https://clawhub.ai",
      }),
    ).toBeNull();
  });

  it("rejects local return URLs when the app origin is unknown (server render)", () => {
    expect(
      normalizeDocsReturnTo("http://localhost:4173/start", { currentOrigin: null }),
    ).toBeNull();
    expect(
      normalizeDocsReturnTo("http://127.0.0.1:4173/start", { currentOrigin: null }),
    ).toBeNull();
  });

  it("keeps callbacks on the same docs host", () => {
    expect(buildDocsAuthCallbackUrl("https://clawhub.ai/docs/auth")).toBe(
      "https://clawhub.ai/ask-molty/auth/callback",
    );
    expect(buildDocsAuthCallbackUrl("https://documentation.openclaw.ai/concepts/models")).toBe(
      "https://documentation.openclaw.ai/ask-molty/auth/callback",
    );
    expect(buildDocsAuthCallbackUrl("https://docs.openclaw.ai/concepts/models")).toBe(
      "https://docs.openclaw.ai/ask-molty/auth/callback",
    );
  });

  it("keeps local callbacks local for dev", () => {
    const localApp = { currentOrigin: "http://127.0.0.1:16754" };

    expect(buildDocsAuthCallbackUrl("http://localhost:3000/docs/start", localApp)).toBe(
      "http://localhost:3000/ask-molty/auth/callback",
    );
    expect(buildDocsAuthCallbackUrl("http://127.0.0.1:3000/docs/start", localApp)).toBe(
      "http://127.0.0.1:3000/ask-molty/auth/callback",
    );
    expect(buildDocsAuthCallbackUrl("http://localhost:4173/start", localApp)).toBe(
      "http://localhost:4173/ask-molty/auth/callback",
    );
    expect(buildDocsAuthCallbackUrl("http://127.0.0.1:16754/docs", localApp)).toBe(
      "http://127.0.0.1:16754/ask-molty/auth/callback",
    );
  });
});
