/* @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from "vitest";

const readGlobalConfig = vi.fn(async () => null as { registry?: string; token?: string } | null);

vi.mock("../config.js", () => ({
  readGlobalConfig: () => readGlobalConfig(),
  writeGlobalConfig: vi.fn(),
}));

vi.mock("./ui.js", () => ({
  fail: (message: string) => {
    throw new Error(message);
  },
}));

const { getOptionalAuthToken, requireAuthToken } = await import("./authToken");

beforeEach(() => {
  readGlobalConfig.mockReset();
  readGlobalConfig.mockResolvedValue({ registry: "https://clawhub.ai", token: "saved" });
});

describe("saved auth token", () => {
  it("returns the token for the registry origin stored with it", async () => {
    await expect(getOptionalAuthToken("https://clawhub.ai")).resolves.toBe("saved");
    await expect(requireAuthToken("https://clawhub.ai/")).resolves.toBe("saved");
  });

  it("withholds the token from another registry origin", async () => {
    await expect(getOptionalAuthToken("http://127.0.0.1:3211")).resolves.toBeUndefined();
    await expect(requireAuthToken("http://127.0.0.1:3211")).rejects.toThrow(
      "Not logged in to this registry. Run: clawhub login",
    );
  });

  it("keeps a legacy saved registry signed in to the default registry only", async () => {
    readGlobalConfig.mockResolvedValue({ registry: "https://auth.clawhub.ai", token: "saved" });

    await expect(requireAuthToken("https://clawhub.ai")).resolves.toBe("saved");
    await expect(getOptionalAuthToken("https://other.example")).resolves.toBeUndefined();
  });

  it("reports a missing login", async () => {
    readGlobalConfig.mockResolvedValue({ registry: "https://clawhub.ai" });

    await expect(getOptionalAuthToken("https://clawhub.ai")).resolves.toBeUndefined();
    await expect(requireAuthToken("https://clawhub.ai")).rejects.toThrow(
      "Not logged in to this registry. Run: clawhub login",
    );
  });

  // The registry is required by the types. An untyped caller that still omits
  // it must not fall back to the unbound token.
  it("never returns the saved token when the caller supplies no registry", async () => {
    const optionalWithoutRegistry = getOptionalAuthToken as unknown as () => Promise<
      string | undefined
    >;
    const requireWithoutRegistry = requireAuthToken as unknown as () => Promise<string>;

    await expect(optionalWithoutRegistry()).resolves.toBeUndefined();
    await expect(requireWithoutRegistry()).rejects.toThrow(
      "Not logged in to this registry. Run: clawhub login",
    );
  });

  it("requires the registry argument at the type level", () => {
    // @ts-expect-error the registry the token will be sent to is required
    void getOptionalAuthToken().catch(() => undefined);
    // @ts-expect-error the registry the token will be sent to is required
    void requireAuthToken().catch(() => undefined);
  });
});
