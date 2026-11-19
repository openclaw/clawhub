/* @vitest-environment node */
import { H3 } from "h3";
import { serverFetch } from "nitro/app";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import templateImage from "../routes/og/template.png";
import { buildTemplateOgSvg } from "./templateOgSvg";

vi.mock("nitro/app", () => ({ serverFetch: vi.fn() }));
const app = new H3().get("/og/template.png", templateImage);
const icon = "/api/v1/skill-icons/" + "a".repeat(64);
const pkg = { name: "brief", family: "template", channel: "community", displayName: "Brief", icon };
const owner = { handle: "maker", displayName: "Not a handle" };
function request(query = "name=brief&owner=maker") {
  return app.fetch(
    new Request("https://clawhub.test/og/template.png?" + query, {
      headers: { Authorization: "Bearer viewer", Cookie: "viewer=1" },
    }),
  );
}

afterEach(() => vi.resetAllMocks());

it("returns a real 1200×630 PNG with the registry's artwork, not URL-supplied text or images", async () => {
  const red = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ff2244" } })
    .png()
    .toBuffer();
  vi.mocked(serverFetch)
    .mockResolvedValueOnce(Response.json({ package: pkg, owner }))
    .mockResolvedValueOnce(
      new Response(new Uint8Array(red), { headers: { "Content-Type": "image/png" } }),
    );
  const response = await request("name=brief&owner=maker&title=bogus&avatar=https://example.com");
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
  const image = sharp(Buffer.from(await response.arrayBuffer()));
  expect(await image.metadata()).toMatchObject({ format: "png", width: 1200, height: 630 });
  expect([
    ...(await image
      .extract({ left: 967, top: 301, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer()),
  ]).toEqual([255, 34, 68]);
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
