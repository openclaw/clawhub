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
const {
  create,
  update,
  setStatus,
  listActive,
  listActiveInternal,
  listForStaff,
  getBySlugPublicInternal,
  normalizePromotionInput,
} = await import("./promotions");

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
  slug: "example-models-launch",
  title: "Free Example models",
  blurb: "A limited-time free model offer from Example.",
  sponsor: "Example",
  startsAt: 1_000,
  endsAt: 2_000,
  provider: "example-provider",
  authChoiceId: "example-provider-api-key",
  models: [{ modelRef: "example-provider/example/model-alpha", alias: "Model Alpha" }],
  signupUrl: "https://signup.example.com",
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
      slug: "  Example-Models-Launch ",
      title: "  Free Example models  ",
    });
    expect(normalized.slug).toBe("example-models-launch");
    expect(normalized.title).toBe("Free Example models");
  });

  it("rejects invalid slugs", () => {
    expect(() => normalizePromotionInput({ ...validInput, slug: "Bad Slug!" })).toThrow(/Slug/);
    expect(() => normalizePromotionInput({ ...validInput, slug: "-leading" })).toThrow(/Slug/);
  });

  it("rejects non-https URLs", () => {
    expect(() =>
      normalizePromotionInput({ ...validInput, signupUrl: "http://insecure.example.com" }),
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

describe("promotions.update", () => {
  const updateHandler = (update as unknown as WrappedHandler<Record<string, unknown>>)._handler;

  function makeUpdateCtx(lookupResults: unknown[]) {
    const uniqueMock = vi.fn();
    for (const result of lookupResults) uniqueMock.mockResolvedValueOnce(result);
    const replace = vi.fn();
    const insert = vi.fn(async () => "auditLogs:1");
    const db = {
      normalizeId: vi.fn(),
      system: {},
      get: vi.fn(),
      query: vi.fn(() => ({
        withIndex: vi.fn(() => ({ unique: uniqueMock })),
      })),
      insert,
      patch: vi.fn(),
      replace,
      delete: vi.fn(),
    };
    return { ctx: { db } as never, replace, insert };
  }

  it("rejects slug changes once the promotion is no longer a draft", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, replace } = makeUpdateCtx([
      { _id: "promotions:1", slug: validInput.slug, status: "active", createdAt: 1 },
    ]);

    await expect(
      updateHandler(ctx, { targetSlug: validInput.slug, ...validInput, slug: "renamed-launch" }),
    ).rejects.toThrow(/draft/);
    expect(replace).not.toHaveBeenCalled();
  });

  it("allows slug changes while still a draft", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, replace } = makeUpdateCtx([
      { _id: "promotions:1", slug: validInput.slug, status: "draft", createdAt: 1 },
      null,
    ]);

    const result = (await updateHandler(ctx, {
      targetSlug: validInput.slug,
      ...validInput,
      slug: "renamed-launch",
    })) as { ok: boolean; slug: string };

    expect(result.slug).toBe("renamed-launch");
    expect(replace).toHaveBeenCalledTimes(1);
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

  it.each(["active", "ended"])("rejects returning a %s promotion to draft", async (status) => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, inserts, patches } = makeMutationCtx({
      existing: { ...storedPromotion, status },
    });

    await expect(setStatusHandler(ctx, { slug: validInput.slug, status: "draft" })).rejects.toThrow(
      /draft/,
    );
    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("rejects ending a promotion before it has been activated", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, inserts, patches } = makeMutationCtx({ existing: storedPromotion });

    await expect(setStatusHandler(ctx, { slug: validInput.slug, status: "ended" })).rejects.toThrow(
      /activated/,
    );
    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});

describe("promotions.listForStaff", () => {
  it("rejects moderators — drafts are admin-only", async () => {
    const listForStaffHandler = (listForStaff as unknown as WrappedHandler<Record<string, never>>)
      ._handler;
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);

    await expect(listForStaffHandler({ db: {} } as never, {})).rejects.toThrow("Forbidden");
  });
});

describe("promotions.listActiveInternal", () => {
  const base = {
    title: "Promo",
    blurb: "Blurb",
    models: [{ modelRef: "example-provider/example/model-alpha" }],
    createdByUserId: "users:admin",
    createdAt: 1,
    updatedAt: 1,
  };

  function makeListCtx(rows: Array<Record<string, unknown>>) {
    return {
      db: {
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            async *[Symbol.asyncIterator]() {
              yield* rows;
            },
          })),
        })),
      },
    } as never;
  }

  it("returns only in-window active promotions as public payloads", async () => {
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

    const result = (await listActiveHandler(makeListCtx(rows), { now: 200 })) as {
      promotions: Array<Record<string, unknown>>;
      nextStartsAt: number | null;
    };

    expect(result.promotions.map((promotion) => promotion.slug)).toEqual(["live"]);
    expect(result.promotions[0]?.active).toBe(true);
    expect(result.promotions[0]).not.toHaveProperty("createdByUserId");
    expect(result.promotions[0]).not.toHaveProperty("_id");
    expect(result.nextStartsAt).toBe(250);
  });

  it("serves the public listActive query without authentication", async () => {
    const listActivePublicHandler = (listActive as unknown as WrappedHandler<Record<string, never>>)
      ._handler;
    const now = Date.now();
    const rows = [
      {
        ...base,
        _id: "promotions:1",
        slug: "live",
        status: "active",
        startsAt: now - 1_000,
        endsAt: now + 1_000,
      },
    ];

    const result = (await listActivePublicHandler(makeListCtx(rows), {})) as Array<
      Record<string, unknown>
    >;

    expect(vi.mocked(requireUser)).not.toHaveBeenCalled();
    expect(result.map((promotion) => promotion.slug)).toEqual(["live"]);
  });

  it("does not let many scheduled future promotions crowd out a live one", async () => {
    const futureRows = Array.from({ length: 60 }, (_, index) => ({
      ...base,
      _id: `promotions:future-${index}`,
      slug: `future-${index}`,
      status: "active",
      startsAt: 500 + index,
      endsAt: 1_000 + index,
    }));
    const liveRow = {
      ...base,
      _id: "promotions:live",
      slug: "live",
      status: "active",
      startsAt: 100,
      endsAt: 2_000,
    };

    const result = (await listActiveHandler(makeListCtx([...futureRows, liveRow]), {
      now: 200,
    })) as {
      promotions: Array<Record<string, unknown>>;
      nextStartsAt: number | null;
    };

    expect(result.promotions.map((promotion) => promotion.slug)).toEqual(["live"]);
    expect(result.nextStartsAt).toBe(500);
  });

  it("reports the next start after the active result limit is full", async () => {
    const liveRows = Array.from({ length: 50 }, (_, index) => ({
      ...base,
      _id: `promotions:live-${index}`,
      slug: `live-${index}`,
      status: "active",
      startsAt: 100,
      endsAt: 1_000 + index,
    }));
    const scheduledRow = {
      ...base,
      _id: "promotions:scheduled",
      slug: "scheduled",
      status: "active",
      startsAt: 500,
      endsAt: 2_000,
    };

    const result = (await listActiveHandler(makeListCtx([...liveRows, scheduledRow]), {
      now: 200,
    })) as {
      promotions: Array<Record<string, unknown>>;
      nextStartsAt: number | null;
    };

    expect(result.promotions).toHaveLength(50);
    expect(result.nextStartsAt).toBe(500);
  });
});

describe("promotions.getBySlugPublicInternal", () => {
  const base = {
    _id: "promotions:1",
    slug: "example-models-launch",
    title: "Promo",
    blurb: "Blurb",
    startsAt: 100,
    endsAt: 200,
    models: [{ modelRef: "example-provider/example/model-alpha" }],
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

  it("hides active promotions before their launch window", async () => {
    const ctx = makeQueryCtx({ ...base, status: "active" });
    expect(await getBySlugHandler(ctx, { slug: base.slug, now: 50 })).toBeNull();
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

  it("hides ended promotions before their launch window", async () => {
    const ctx = makeQueryCtx({ ...base, status: "ended" });
    expect(await getBySlugHandler(ctx, { slug: base.slug, now: 50 })).toBeNull();
  });
});
