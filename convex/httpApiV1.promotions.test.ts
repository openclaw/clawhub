/* @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/apiTokenAuth", () => ({
  requireApiTokenUser: vi.fn(),
  getOptionalApiTokenUser: vi.fn(),
  getOptionalApiTokenUserId: vi.fn(),
  requirePackagePublishAuth: vi.fn(),
}));

vi.mock("./lib/httpRateLimit", () => ({
  applyRateLimit: vi.fn(async () => ({ ok: true, headers: {} })),
}));

const { requireApiTokenUser } = await import("./lib/apiTokenAuth");
const {
  createPromotionV1Handler,
  listPromotionsV1Handler,
  promotionsGetRouterV1Handler,
  promotionsPostRouterV1Handler,
} = await import("./httpApiV1/promotionsV1");

type ActionCtx = import("./_generated/server").ActionCtx;

const BASE_URL = "https://clawhub.test/api/v1/promotions";

const publicPromotion = {
  slug: "example-models-launch",
  title: "Free Example models",
  blurb: "A limited-time free model offer from Example.",
  status: "active",
  active: true,
  startsAt: 100,
  endsAt: 200,
  models: [{ modelRef: "example-provider/example/model-alpha" }],
};

const validCreatePayload = {
  slug: "example-models-launch",
  title: "Free Example models",
  blurb: "A limited-time free model offer from Example.",
  startsAt: 100,
  endsAt: 200,
  models: [{ modelRef: "example-provider/example/model-alpha", alias: "Model Alpha" }],
  signupUrl: "https://signup.example.com",
};

function makeCtx() {
  const runQuery = vi.fn();
  const runMutation = vi.fn();
  return { ctx: { runQuery, runMutation } as unknown as ActionCtx, runQuery, runMutation };
}

beforeEach(() => {
  vi.mocked(requireApiTokenUser).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("listPromotionsV1Handler", () => {
  it("returns active promotions publicly with cache headers", async () => {
    const { ctx, runQuery } = makeCtx();
    runQuery.mockResolvedValue([publicPromotion]);

    const response = await listPromotionsV1Handler(ctx, new Request(BASE_URL));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("public");
    const body = (await response.json()) as { promotions: Array<{ slug: string }> };
    expect(body.promotions[0]?.slug).toBe(publicPromotion.slug);
  });

  it("does not cache active promotions beyond the nearest expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const { ctx, runQuery } = makeCtx();
    runQuery.mockResolvedValue([
      { ...publicPromotion, endsAt: 190_500 },
      { ...publicPromotion, slug: "later-promotion", endsAt: 400_000 },
    ]);

    const response = await listPromotionsV1Handler(ctx, new Request(BASE_URL));

    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=90, s-maxage=90, must-revalidate",
    );
  });

  it("requires an admin token for status=all", async () => {
    const { ctx } = makeCtx();
    vi.mocked(requireApiTokenUser).mockRejectedValue(new Error("Unauthorized"));

    const response = await listPromotionsV1Handler(ctx, new Request(`${BASE_URL}?status=all`));
    expect(response.status).toBe(401);
  });

  it("rejects non-admin tokens for status=all", async () => {
    const { ctx } = makeCtx();
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:regular",
      user: { _id: "users:regular", role: "user" },
    } as never);

    const response = await listPromotionsV1Handler(ctx, new Request(`${BASE_URL}?status=all`));
    expect(response.status).toBe(403);
  });
});

describe("promotionsGetRouterV1Handler", () => {
  it("returns 404 for unknown promotions", async () => {
    const { ctx, runQuery } = makeCtx();
    runQuery.mockResolvedValue(null);

    const response = await promotionsGetRouterV1Handler(ctx, new Request(`${BASE_URL}/unknown`));
    expect(response.status).toBe(404);
  });

  it("returns a public promotion by slug", async () => {
    const { ctx, runQuery } = makeCtx();
    runQuery.mockResolvedValue(publicPromotion);

    const response = await promotionsGetRouterV1Handler(
      ctx,
      new Request(`${BASE_URL}/${publicPromotion.slug}`),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { slug: string };
    expect(body.slug).toBe(publicPromotion.slug);
  });
});

describe("createPromotionV1Handler", () => {
  function makeCreateRequest(payload: unknown) {
    return new Request(BASE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer token" },
      body: JSON.stringify(payload),
    });
  }

  it("creates a promotion for admins", async () => {
    const { ctx, runMutation } = makeCtx();
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    runMutation.mockResolvedValue({ ok: true, slug: validCreatePayload.slug, status: "draft" });

    const response = await createPromotionV1Handler(ctx, makeCreateRequest(validCreatePayload));

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      actorUserId: "users:admin",
      input: expect.objectContaining({
        slug: validCreatePayload.slug,
        models: [{ modelRef: "example-provider/example/model-alpha", alias: "Model Alpha" }],
      }),
    });
  });

  it("rejects non-admin tokens", async () => {
    const { ctx, runMutation } = makeCtx();
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:regular",
      user: { _id: "users:regular", role: "user" },
    } as never);

    const response = await createPromotionV1Handler(ctx, makeCreateRequest(validCreatePayload));
    expect(response.status).toBe(403);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("rejects payloads without models", async () => {
    const { ctx, runMutation } = makeCtx();
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);

    const response = await createPromotionV1Handler(
      ctx,
      makeCreateRequest({ ...validCreatePayload, models: [] }),
    );
    expect(response.status).toBe(400);
    expect(runMutation).not.toHaveBeenCalled();
  });
});

describe("promotionsPostRouterV1Handler", () => {
  function makeStatusRequest(slug: string, payload: unknown) {
    return new Request(`${BASE_URL}/${slug}/status`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer token" },
      body: JSON.stringify(payload),
    });
  }

  it("sets promotion status for admins", async () => {
    const { ctx, runMutation } = makeCtx();
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);
    runMutation.mockResolvedValue({ ok: true, slug: publicPromotion.slug, status: "active" });

    const response = await promotionsPostRouterV1Handler(
      ctx,
      makeStatusRequest(publicPromotion.slug, { status: "active" }),
    );

    expect(response.status).toBe(200);
    expect(runMutation).toHaveBeenCalledWith(expect.anything(), {
      actorUserId: "users:admin",
      slug: publicPromotion.slug,
      status: "active",
    });
  });

  it("rejects invalid statuses", async () => {
    const { ctx, runMutation } = makeCtx();
    vi.mocked(requireApiTokenUser).mockResolvedValue({
      userId: "users:admin",
      user: { _id: "users:admin", role: "admin" },
    } as never);

    const response = await promotionsPostRouterV1Handler(
      ctx,
      makeStatusRequest(publicPromotion.slug, { status: "paused" }),
    );
    expect(response.status).toBe(400);
    expect(runMutation).not.toHaveBeenCalled();
  });

  it("returns 404 for unknown actions", async () => {
    const { ctx } = makeCtx();
    const response = await promotionsPostRouterV1Handler(
      ctx,
      new Request(`${BASE_URL}/${publicPromotion.slug}/rename`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(404);
  });
});
