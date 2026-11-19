/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPackageDetail } from "./packageApi";

const { getRequestHeaders } = vi.hoisted(() => ({ getRequestHeaders: vi.fn<() => Headers>() }));
vi.mock("@tanstack/react-start/server", () => ({ getRequestHeaders }));
vi.mock("nitro/app", () => ({ serverFetch: (url: string, init: RequestInit) => fetch(url, init) }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Template website view transport", () => {
  it.each([
    { cookie: undefined, view: "template-inventory" },
    { cookie: "session=example", view: "template-detail" },
  ])("uses $view for SSR without a privilege-changing second read", async ({ cookie, view }) => {
    vi.stubEnv("VITE_CONVEX_SITE_URL", "https://registry.example");
    getRequestHeaders.mockReturnValue(new Headers(cookie ? { cookie } : {}));
    const transport = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 403 }));
    await expect(fetchPackageDetail("template", "template-inventory")).rejects.toMatchObject({
      status: 403,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(new URL(String(transport.mock.calls[0]?.[0])).searchParams.get("view")).toBe(view);
  });
});
