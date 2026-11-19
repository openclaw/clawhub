/* @vitest-environment node */
import { H3, mockEvent } from "h3";
import { serverFetch } from "nitro/app";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { proxyConvexRequest } from "../convexProxy";
import templateImage from "../routes/og/template.png";
import { buildTemplateOgSvg } from "./templateOgSvg";

vi.mock("nitro/app", () => ({ serverFetch: vi.fn() }));
const app = new H3().get("/og/template.png", templateImage);
const icon = "/api/v1/skill-icons/" + "a".repeat(64);
const pkg = { name: "brief", family: "template", channel: "community", displayName: "Brief", icon };
const owner = { handle: "maker", displayName: "Not a handle" };
function request(query = "name=brief&owner=maker", headers: Record<string, string> = {}) {
  return app.fetch(
    new Request("https://clawhub.test/og/template.png?" + query, {
      headers: { Authorization: "Bearer viewer", Cookie: "viewer=1", ...headers },
    }),
  );
}

async function expectArtworkPixel(response: Response) {
  const image = sharp(Buffer.from(await response.arrayBuffer()));
  expect(await image.metadata()).toMatchObject({ format: "png", width: 1200, height: 630 });
  const pixel = await image
    .extract({ left: 967, top: 301, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer();
  expect([...pixel]).toEqual([255, 34, 68]);
}

function artworkPng(size: number) {
  return sharp({ create: { width: size, height: size, channels: 3, background: "#ff2244" } })
    .png()
    .toBuffer();
}

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  [
    "production",
    { "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "198.51.100.8" },
    "203.0.113.7",
  ],
  ["preview", { "x-forwarded-for": "203.0.113.8" }, "203.0.113.8"],
] as const)(
  "reads both anonymous assets through the %s proxy using its ingress IP",
  async (env, ingress, ip) => {
    vi.stubEnv("VERCEL_ENV", env);
    const png = await artworkPng(2);
    // Exercise the actual proxy offline; only the provider token and upstream registry are fixtures.
    vi.mocked(serverFetch).mockImplementation(async (path, init) =>
      proxyConvexRequest(
        mockEvent("https://clawhub.test" + path, init),
        { VERCEL_ENV: env, VITE_CONVEX_SITE_URL: "https://fixture.convex.site" },
        {
          getArchiveRequestToken: async () => "edge-fixture",
          verifyArchiveManifest: async () => null,
        },
      ),
    );
    const registry = vi.fn(async (url: string, init: RequestInit) => {
      const headers = new Headers(init.headers);
      if (
        headers.get("x-clawhub-client-ip") !== ip ||
        headers.get("x-clawhub-vercel-oidc-token") !== "edge-fixture"
      )
        return new Response(null, { status: 403 });
      if (new URL(url).pathname === icon)
        return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
      return Response.json({ package: pkg, owner });
    });
    vi.stubGlobal("fetch", registry);
    const response = await request(undefined, {
      ...ingress,
      "x-clawhub-client-ip": "192.0.2.3",
      "x-clawhub-vercel-oidc-token": "caller-fixture",
      "x-real-ip": "192.0.2.4",
    });
    expect(response.status).toBe(200);
    await expectArtworkPixel(response);
    expect(registry.mock.calls.map(([url, init]) => [new URL(url).pathname, init.method])).toEqual([
      ["/api/v1/packages/brief", "GET"],
      [icon, "GET"],
    ]);
    expect(
      vi
        .mocked(serverFetch)
        .mock.calls.map(([, init]) => [
          init?.credentials,
          Object.fromEntries(new Headers(init?.headers)),
        ]),
    ).toEqual([
      ["omit", { accept: "application/json", "x-vercel-forwarded-for": ip }],
      ["omit", { "x-vercel-forwarded-for": ip }],
    ]);
    for (const [, init] of registry.mock.calls) {
      const headers = new Headers(init.headers);
      expect(headers.has("authorization")).toBe(false);
      expect(headers.has("cookie")).toBe(false);
    }
  },
);

it("renders visible 2048×2048 catalog artwork, not URL-supplied text or images", async () => {
  vi.stubEnv("VERCEL_ENV", "development");
  const red = await artworkPng(2048);
  vi.mocked(serverFetch)
    .mockResolvedValueOnce(Response.json({ package: pkg, owner }))
    .mockResolvedValueOnce(
      new Response(new Uint8Array(red), { headers: { "Content-Type": "image/png" } }),
    );
  const response = await request("name=brief&owner=maker&title=bogus&avatar=https://example.com", {
    "x-vercel-forwarded-for": "203.0.113.7",
    "x-forwarded-for": "198.51.100.8",
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
  expect(
    vi
      .mocked(serverFetch)
      .mock.calls.map(([path, options]) => [path, options?.headers, options?.credentials]),
  ).toEqual([
    ["/api/v1/packages/brief", { Accept: "application/json" }, "omit"],
    [icon, undefined, "omit"],
  ]);
  await expectArtworkPixel(response);
});

it.each([
  { package: { ...pkg, family: "code-plugin" }, owner },
  { package: { ...pkg, channel: "private" }, owner },
  { package: { ...pkg, name: "other" }, owner },
  { package: pkg, owner: { handle: "another-maker" } },
  { package: null, owner: null },
])("does not render unavailable or mismatched Templates", async (payload) => {
  vi.mocked(serverFetch).mockResolvedValueOnce(Response.json(payload));
  const response = await request();
  expect(response.status).toBe(404);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(serverFetch).toHaveBeenCalledTimes(1);
});

it("does not fetch an external artwork URL; still returns the fallback card", async () => {
  vi.mocked(serverFetch).mockResolvedValueOnce(
    Response.json({ package: { ...pkg, icon: "https://example.com/not-hosted.png" }, owner }),
  );
  expect((await request()).headers.get("content-type")).toBe("image/png");
  expect(serverFetch).toHaveBeenCalledTimes(1);
});

it("refuses invalid identifiers before fetching and leaves service failures retryable", async () => {
  expect((await request("name=..&owner=maker")).status).toBe(400);
  expect(serverFetch).not.toHaveBeenCalled();
  vi.mocked(serverFetch).mockResolvedValueOnce(new Response(null, { status: 429 }));
  const response = await request();
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each([
  { owner: "maker", artwork: "data:image/png;base64,AA==" },
  { owner: "maker", artwork: null },
  { owner: null, artwork: "data:image/png;base64,AA==" },
])("draws the artwork directly on the full-bleed background", (source) => {
  const svg = buildTemplateOgSvg({ ...source, title: "Brief", description: "Summary", mark: "" });
  const rectangles = svg.match(/<rect\b[^>]*>/g) ?? [];
  expect(rectangles.length).toBeGreaterThan(0);
  for (const rect of rectangles) {
    expect(rect).toMatch(/width="1200" height="630"/);
  }
  expect(svg).not.toMatch(/clipPath|clip-path/);
});

it("bounds long copy, escapes user text, and keeps the exact handle below the title", () => {
  const handle = "maker-" + "a".repeat(34);
  const svg = buildTemplateOgSvg({
    title: "<& Brief " + "long word ".repeat(70),
    description: "Something ".repeat(200),
    owner: handle,
    artwork: null,
    mark: "data:image/png;base64,AA==",
  });
  expect(svg).toContain("&lt;&amp; Brief");
  expect(svg).toContain("…");
  expect(svg.indexOf("@" + handle)).toBeGreaterThan(svg.indexOf("&lt;&amp; Brief"));
  expect(svg.indexOf("Something")).toBeGreaterThan(svg.indexOf("@" + handle));
  expect(svg).not.toContain("long word ".repeat(10));
  expect(svg).toContain('viewBox="0 0 24 24"');
});
