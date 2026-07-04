import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
  authTables: {},
}));

vi.mock("./lib/access", async () => {
  const actual = await vi.importActual<typeof import("./lib/access")>("./lib/access");
  return {
    ...actual,
    requireUser: vi.fn(),
  };
});

const { requireUser } = await import("./lib/access");
const { create, setStatus, listActiveInternal, getBySlugPublicInternal, normalizePromotionInput } =
  await import("./promotions");

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const createHandler = (create as unknown as WrappedHandler<Record<string, unknown>>)._handler;
const setStatusHandler = (setStatus as unknown as WrappedHandler<{ slug: string; status: string }>)
  ._handler;
const listActiveHandler = (listActiveInternal as unknown as WrappedHandler<{ now: number }>)
  ._handler;
const getBySlugHandler = (
  getBySlugPublicInternal as unknown as WrappedHandler<{ slug: string; now: number }>
)._handler;

const adminUser = { _id: "users:admin", role: "admin" };
const regularUser = { _id: "users:regular", role: "user" };

const validInput = {
  slug: "tencent-openrouter-launch",
  title: "Free Tencent models via OpenRouter",
  blurb: "Two weeks of free Hunyuan inference served through OpenRouter.",
  sponsor: "Tencent",
  startsAt: 1_000,
  endsAt: 2_000,
  provider: "openrouter",
  authChoiceId: "openrouter-api-key",
  models: [{ modelRef: "openrouter/tencent/hunyuan-a13b", alias: "Hunyuan A13B" }],
  signupUrl: "https://openrouter.ai/signup",
};

function makeMutationCtx({ existing = null }: { existing?: unknown } = {}) {
  const inserts: Array<{ table: string; doc: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const db = {
    normalizeId: vi.fn(),
    system: {},
    get: vi.fn(),
    query: vi.fn(() => ({
      withIndex: vi.fn(() => ({
        unique: vi.fn(async () => existing),
      })),
    })),
    insert: vi.fn(async (table: string, doc: Record<string, unknown>) => {
      inserts.push({ table, doc });
      return `${table}:${inserts.length}`;
    }),
    patch: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      patches.push({ id, patch });
    }),
    replace: vi.fn(),
    delete: vi.fn(),
  };
  return { ctx: { db } as never, db, inserts, patches };
}

afterEach(() => {
  vi.mocked(requireUser).mockReset();
});

describe("normalizePromotionInput", () => {
  it("normalizes slug case and trims fields", () => {
    const normalized = normalizePromotionInput({
      ...validInput,
      slug: "  Tencent-OpenRouter-Launch ",
      title: "  Free Tencent models  ",
    });
    expect(normalized.slug).toBe("tencent-openrouter-launch");
    expect(normalized.title).toBe("Free Tencent models");
  });

  it("rejects invalid slugs", () => {
    expect(() => normalizePromotionInput({ ...validInput, slug: "Bad Slug!" })).toThrow(/Slug/);
    expect(() => normalizePromotionInput({ ...validInput, slug: "-leading" })).toThrow(/Slug/);
  });

  it("rejects non-https URLs", () => {
    expect(() =>
      normalizePromotionInput({ ...validInput, signupUrl: "http://openrouter.ai" }),
    ).toThrow(/https/);
    expect(() => normalizePromotionInput({ ...validInput, docsUrl: "not a url" })).toThrow(
      /valid URL/,
    );
  });

  it("rejects inverted windows and empty model lists", () => {
    expect(() =>
      normalizePromotionInput({ ...validInput, startsAt: 2_000, endsAt: 1_000 }),
    ).toThrow(/endsAt/);
    expect(() => normalizePromotionInput({ ...validInput, models: [] })).toThrow(/model/);
  });
});

describe("promotions.create", () => {
  it("creates a draft promotion and writes an audit log for admins", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, inserts } = makeMutationCtx();

    const result = (await createHandler(ctx, validInput)) as {
      ok: boolean;
      slug: string;
      status: string;
    };

    expect(result).toEqual({ ok: true, slug: validInput.slug, status: "draft" });
    const promotionInsert = inserts.find((entry) => entry.table === "promotions");
    expect(promotionInsert?.doc.status).toBe("draft");
    expect(promotionInsert?.doc.createdByUserId).toBe(adminUser._id);
    const auditInsert = inserts.find((entry) => entry.table === "auditLogs");
    expect(auditInsert?.doc.action).toBe("promotion.create");
    expect(auditInsert?.doc.targetType).toBe("promotion");
    expect(auditInsert?.doc.targetId).toBe(validInput.slug);
    expect(auditInsert?.doc.actorUserId).toBe(adminUser._id);
  });

  it("rejects non-admin users", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: regularUser._id,
      user: regularUser,
    } as never);
    const { ctx, inserts } = makeMutationCtx();

    await expect(createHandler(ctx, validInput)).rejects.toThrow("Forbidden");
    expect(inserts).toHaveLength(0);
  });

  it("rejects duplicate slugs", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, inserts } = makeMutationCtx({
      existing: { _id: "promotions:1", slug: validInput.slug },
    });

    await expect(createHandler(ctx, validInput)).rejects.toThrow(/already exists/);
    expect(inserts).toHaveLength(0);
  });
});

describe("promotions.setStatus", () => {
  const storedPromotion = {
    _id: "promotions:1",
    slug: validInput.slug,
    status: "draft",
  };

  it("updates status and writes an audit log", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, inserts, patches } = makeMutationCtx({ existing: storedPromotion });

    const result = (await setStatusHandler(ctx, {
      slug: validInput.slug,
      status: "active",
    })) as { ok: boolean; status: string };

    expect(result.status).toBe("active");
    expect(patches).toHaveLength(1);
    expect(patches[0]?.patch.status).toBe("active");
    const auditInsert = inserts.find((entry) => entry.table === "auditLogs");
    expect(auditInsert?.doc.action).toBe("promotion.set_status");
    expect(auditInsert?.doc.metadata).toMatchObject({ from: "draft", to: "active" });
  });

  it("is a no-op when the status is unchanged", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, inserts, patches } = makeMutationCtx({ existing: storedPromotion });

    const result = (await setStatusHandler(ctx, {
      slug: validInput.slug,
      status: "draft",
    })) as { ok: boolean; status: string };

    expect(result.status).toBe("draft");
    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});

describe("promotions.listActiveInternal", () => {
  it("returns only in-window active promotions as public payloads", async () => {
    const base = {
      title: "Promo",
      blurb: "Blurb",
      models: [{ modelRef: "openrouter/tencent/hunyuan-a13b" }],
      createdByUserId: "users:admin",
      createdAt: 1,
      updatedAt: 1,
    };
    const rows = [
      { ...base, _id: "promotions:1", slug: "live", status: "active", startsAt: 100, endsAt: 300 },
      {
        ...base,
        _id: "promotions:2",
        slug: "not-started",
        status: "active",
        startsAt: 250,
        endsAt: 400,
      },
      {
        ...base,
        _id: "promotions:3",
        slug: "expired",
        status: "active",
        startsAt: 10,
        endsAt: 100,
      },
    ];
    const ctx = {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            take: vi.fn(async () => rows),
          })),
        })),
      },
    } as never;

    const result = (await listActiveHandler(ctx, { now: 200 })) as Array<Record<string, unknown>>;

    expect(result.map((promotion) => promotion.slug)).toEqual(["live"]);
    expect(result[0]?.active).toBe(true);
    expect(result[0]).not.toHaveProperty("createdByUserId");
    expect(result[0]).not.toHaveProperty("_id");
  });
});

describe("promotions.getBySlugPublicInternal", () => {
  const base = {
    _id: "promotions:1",
    slug: "tencent-openrouter-launch",
    title: "Promo",
    blurb: "Blurb",
    startsAt: 100,
    endsAt: 200,
    models: [{ modelRef: "openrouter/tencent/hunyuan-a13b" }],
    createdByUserId: "users:admin",
    createdAt: 1,
    updatedAt: 1,
  };

  function makeQueryCtx(row: unknown) {
    return {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            unique: vi.fn(async () => row),
          })),
        })),
      },
    } as never;
  }

  it("hides drafts", async () => {
    const ctx = makeQueryCtx({ ...base, status: "draft" });
    expect(await getBySlugHandler(ctx, { slug: base.slug, now: 150 })).toBeNull();
  });

  it("returns ended promotions with active=false", async () => {
    const ctx = makeQueryCtx({ ...base, status: "ended" });
    const result = (await getBySlugHandler(ctx, { slug: base.slug, now: 150 })) as {
      active: boolean;
      status: string;
    };
    expect(result.status).toBe("ended");
    expect(result.active).toBe(false);
  });
});
