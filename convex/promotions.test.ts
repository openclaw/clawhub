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
  models: [{ modelRef: "example-provider/example/model-alpha", alias: "model-alpha" }],
  signupUrl: "https://signup.example.com",
};

function makeScheduler() {
  return {
    runAfter: vi.fn(async (..._args: unknown[]) => "job:1"),
    runAt: vi.fn(async (..._args: unknown[]) => "job:2"),
  };
}

function makeMutationCtx({
  existing = null,
  activePromotions = [],
}: {
  existing?: unknown;
  activePromotions?: unknown[];
} = {}) {
  const inserts: Array<{ table: string; doc: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const db = {
    normalizeId: vi.fn(),
    system: {},
    get: vi.fn(),
    query: vi.fn(() => ({
      withIndex: vi.fn(() => ({
        unique: vi.fn(async () => existing),
        take: vi.fn(async (limit: number) => activePromotions.slice(0, limit)),
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
  const scheduler = makeScheduler();
  return { ctx: { db, scheduler } as never, db, scheduler, inserts, patches };
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

  it("rejects timestamps outside the JavaScript Date range", () => {
    expect(() => normalizePromotionInput({ ...validInput, startsAt: -Number.MAX_VALUE })).toThrow(
      /valid timestamp/,
    );
    expect(() => normalizePromotionInput({ ...validInput, endsAt: Number.MAX_VALUE })).toThrow(
      /valid timestamp/,
    );
  });

  it.each([
    ["modelRef", { modelRef: "provider/model\ninjected" }],
    ["Model alias", { modelRef: "provider/model", alias: "Alias\r\ninjected" }],
  ])("rejects line breaks in %s", (label, model) => {
    expect(() => normalizePromotionInput({ ...validInput, models: [model] })).toThrow(label);
  });

  // CLI authoring contracts: the OpenClaw consumer rejects promotions whose
  // identifiers violate these grammars and skips aliases it cannot register.
  it("rejects aliases that are not typed identifiers", () => {
    expect(() =>
      normalizePromotionInput({
        ...validInput,
        models: [{ modelRef: "example-provider/example/model-alpha", alias: "Model Alpha" }],
      }),
    ).toThrow(/alias/);
    expect(() =>
      normalizePromotionInput({
        ...validInput,
        models: [{ modelRef: "example-provider/example/model-alpha", alias: "alias$(rm)" }],
      }),
    ).toThrow(/alias/);
  });

  it("accepts typed-identifier aliases", () => {
    const normalized = normalizePromotionInput({
      ...validInput,
      models: [{ modelRef: "example-provider/example/model-alpha", alias: "model-alpha_v1.2:x" }],
    });
    expect(normalized.models[0]?.alias).toBe("model-alpha_v1.2:x");
  });

  it("rejects modelRefs with shell-unsafe characters", () => {
    for (const modelRef of [
      "example-provider/model alpha",
      "example-provider/model;rm",
      "example-provider/`model`",
      "-leading-dash/model",
    ]) {
      expect(() => normalizePromotionInput({ ...validInput, models: [{ modelRef }] })).toThrow(
        /modelRef/,
      );
    }
  });

  it("rejects modelRefs outside the declared provider prefix", () => {
    expect(() =>
      normalizePromotionInput({
        ...validInput,
        models: [{ modelRef: "other-provider/example/model-alpha" }],
      }),
    ).toThrow(/provider prefix/);
    expect(() =>
      normalizePromotionInput({
        ...validInput,
        models: [{ modelRef: "example-provider/" }],
      }),
    ).toThrow(/provider prefix/);
  });

  it("skips the provider-prefix requirement when no provider is declared", () => {
    const { provider: _provider, authChoiceId: _authChoiceId, ...rest } = validInput;
    const normalized = normalizePromotionInput({
      ...rest,
      models: [{ modelRef: "any-provider/example/model-alpha" }],
    });
    expect(normalized.models[0]?.modelRef).toBe("any-provider/example/model-alpha");
  });

  it("rejects provider, authChoiceId, and plugin names outside the identifier grammar", () => {
    expect(() => normalizePromotionInput({ ...validInput, provider: "bad provider" })).toThrow(
      /Provider/,
    );
    expect(() => normalizePromotionInput({ ...validInput, authChoiceId: "choice id!" })).toThrow(
      /authChoiceId/,
    );
    expect(() =>
      normalizePromotionInput({ ...validInput, pluginNames: ["good-plugin", "bad name"] }),
    ).toThrow(/Plugin name/);
  });

  it("accepts scoped npm plugin names and lowercases them", () => {
    const normalized = normalizePromotionInput({
      ...validInput,
      pluginNames: ["@openclaw/Example-Plugin", "plain-plugin"],
    });
    expect(normalized.pluginNames).toEqual(["@openclaw/example-plugin", "plain-plugin"]);
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
    const scheduler = makeScheduler();
    return { ctx: { db, scheduler } as never, replace, insert, scheduler };
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

  it("preserves launch history when editing an ended promotion", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, replace } = makeUpdateCtx([
      {
        _id: "promotions:1",
        slug: validInput.slug,
        status: "ended",
        launchedAt: validInput.startsAt,
        createdByUserId: adminUser._id,
        createdAt: 1,
      },
    ]);

    await updateHandler(ctx, { targetSlug: validInput.slug, ...validInput });

    expect(replace).toHaveBeenCalledWith(
      "promotions:1",
      expect.objectContaining({ launchedAt: validInput.startsAt }),
    );
  });

  it("does not mark a canceled promotion as launched when editing it later", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, replace } = makeUpdateCtx([
      {
        _id: "promotions:1",
        slug: validInput.slug,
        status: "ended",
        createdByUserId: adminUser._id,
        createdAt: 1,
      },
    ]);

    await updateHandler(ctx, { targetSlug: validInput.slug, ...validInput });

    expect(replace.mock.calls[0]?.[1]).not.toHaveProperty("launchedAt");
  });

  it("rejects moving an unlaunched active promotion into an expired window", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, replace } = makeUpdateCtx([
      {
        _id: "promotions:1",
        slug: validInput.slug,
        status: "active",
        startsAt: Date.now() + 60_000,
        createdByUserId: adminUser._id,
        createdAt: 1,
      },
    ]);

    await expect(
      updateHandler(ctx, {
        targetSlug: validInput.slug,
        ...validInput,
        startsAt: 1,
        endsAt: 2,
      }),
    ).rejects.toThrow(/expired/);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("promotions.setStatus", () => {
  const futureStartsAt = Date.now() + 60_000;
  const futureEndsAt = Date.now() + 120_000;
  const storedPromotion = {
    _id: "promotions:1",
    slug: validInput.slug,
    status: "draft",
    startsAt: futureStartsAt,
    endsAt: futureEndsAt,
  };

  it("updates status, writes an audit log, and schedules feed republication", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, inserts, patches, scheduler } = makeMutationCtx({ existing: storedPromotion });

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
    // Immediate republish plus one scheduled republish per future window edge.
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
    expect(scheduler.runAt).toHaveBeenCalledTimes(2);
    expect(scheduler.runAt.mock.calls.map((call) => call[0])).toEqual([
      futureStartsAt,
      futureEndsAt + 1,
    ]);
  });

  it("records launch when activating a promotion after its window starts", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, patches } = makeMutationCtx({
      existing: { ...storedPromotion, startsAt: 1 },
    });

    await setStatusHandler(ctx, { slug: validInput.slug, status: "active" });

    expect(patches[0]?.patch.launchedAt).toEqual(expect.any(Number));
  });

  it("rejects activating a promotion after its window expired", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, patches } = makeMutationCtx({
      existing: { ...storedPromotion, startsAt: 1, endsAt: 2 },
    });

    await expect(
      setStatusHandler(ctx, { slug: validInput.slug, status: "active" }),
    ).rejects.toThrow(/expired/i);
    expect(patches).toHaveLength(0);
  });

  it("republishes the feed immediately when ending a promotion, without edge jobs", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, patches, scheduler } = makeMutationCtx({
      existing: { ...storedPromotion, status: "active" },
    });

    await setStatusHandler(ctx, { slug: validInput.slug, status: "ended" });

    expect(patches[0]?.patch).not.toHaveProperty("launchedAt");
    expect(scheduler.runAfter).toHaveBeenCalledTimes(1);
    expect(scheduler.runAt).not.toHaveBeenCalled();
  });

  it("records that a promotion launched when ending it after its start", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, patches } = makeMutationCtx({
      existing: { ...storedPromotion, status: "active", startsAt: 1 },
    });

    await setStatusHandler(ctx, { slug: validInput.slug, status: "ended" });

    expect(patches[0]?.patch.launchedAt).toBe(1);
  });

  it("is a no-op when the status is unchanged", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, inserts, patches, scheduler } = makeMutationCtx({ existing: storedPromotion });

    const result = (await setStatusHandler(ctx, {
      slug: validInput.slug,
      status: "draft",
    })) as { ok: boolean; status: string };

    expect(result.status).toBe("draft");
    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(scheduler.runAfter).not.toHaveBeenCalled();
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

  it("rejects reactivating an ended promotion", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const { ctx, inserts, patches } = makeMutationCtx({
      existing: { ...storedPromotion, status: "ended" },
    });

    await expect(
      setStatusHandler(ctx, { slug: validInput.slug, status: "active" }),
    ).rejects.toThrow(/reactivated/);
    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("rejects activation when the curated active set is full", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const activePromotions = Array.from({ length: 50 }, (_, index) => ({
      _id: `promotions:${index}`,
      status: "active",
    }));
    const { ctx, inserts, patches } = makeMutationCtx({
      existing: storedPromotion,
      activePromotions,
    });

    await expect(
      setStatusHandler(ctx, { slug: validInput.slug, status: "active" }),
    ).rejects.toThrow(/At most 50/);
    expect(patches).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});

describe("promotions.listForStaff", () => {
  it("rejects moderators — drafts are admin-only", async () => {
    const listForStaffHandler = (
      listForStaff as unknown as WrappedHandler<{
        paginationOpts: { cursor: string | null; numItems: number };
      }>
    )._handler;
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:moderator",
      user: { _id: "users:moderator", role: "moderator" },
    } as never);

    await expect(
      listForStaffHandler({ db: {} } as never, {
        paginationOpts: { cursor: null, numItems: 25 },
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("paginates the permanent promotion history for admins", async () => {
    const listForStaffHandler = (
      listForStaff as unknown as WrappedHandler<{
        paginationOpts: { cursor: string | null; numItems: number };
      }>
    )._handler;
    vi.mocked(requireUser).mockResolvedValue({
      userId: adminUser._id,
      user: adminUser,
    } as never);
    const paginate = vi.fn().mockResolvedValue({
      page: [{ _id: "promotions:1", slug: "newest" }],
      isDone: false,
      continueCursor: "next-page",
    });
    const order = vi.fn(() => ({ paginate }));
    const query = vi.fn(() => ({ order }));

    const result = await listForStaffHandler({ db: { query } } as never, {
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(query).toHaveBeenCalledWith("promotions");
    expect(order).toHaveBeenCalledWith("desc");
    expect(paginate).toHaveBeenCalledWith({ cursor: null, numItems: 25 });
    expect(result).toEqual({
      page: [{ _id: "promotions:1", slug: "newest" }],
      isDone: false,
      continueCursor: "next-page",
    });
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
    const take = vi.fn(async (limit: number) => rows.slice(0, limit));
    return {
      ctx: {
        db: {
          query: vi.fn(() => ({
            withIndex: vi.fn(() => ({ take })),
          })),
        },
      } as never,
      take,
    };
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

    const { ctx } = makeListCtx(rows);
    const result = (await listActiveHandler(ctx, { now: 200 })) as {
      promotions: Array<Record<string, unknown>>;
      nextStartsAt: number | null;
    };

    expect(result.promotions.map((promotion) => promotion.slug)).toEqual(["live"]);
    expect(result.promotions[0]?.active).toBe(true);
    expect(result.promotions[0]).not.toHaveProperty("createdByUserId");
    expect(result.promotions[0]).not.toHaveProperty("_id");
    expect(result.nextStartsAt).toBe(250);
  });

  it("does not let many scheduled future promotions crowd out a live one", async () => {
    const futureRows = Array.from({ length: 49 }, (_, index) => ({
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

    const { ctx } = makeListCtx([...futureRows, liveRow]);
    const result = (await listActiveHandler(ctx, {
      now: 200,
    })) as {
      promotions: Array<Record<string, unknown>>;
      nextStartsAt: number | null;
    };

    expect(result.promotions.map((promotion) => promotion.slug)).toEqual(["live"]);
    expect(result.nextStartsAt).toBe(500);
  });

  it("reports the next start after the active result limit is full", async () => {
    const liveRows = Array.from({ length: 49 }, (_, index) => ({
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

    const { ctx, take } = makeListCtx([...liveRows, scheduledRow]);
    const result = (await listActiveHandler(ctx, {
      now: 200,
    })) as {
      promotions: Array<Record<string, unknown>>;
      nextStartsAt: number | null;
    };

    expect(result.promotions).toHaveLength(49);
    expect(result.nextStartsAt).toBe(500);
    expect(take).toHaveBeenCalledWith(50);
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

  it("hides promotions killed before their launch window", async () => {
    const ctx = makeQueryCtx({ ...base, status: "ended" });
    expect(await getBySlugHandler(ctx, { slug: base.slug, now: 50 })).toBeNull();
  });

  it("returns ended promotions with active=false", async () => {
    const ctx = makeQueryCtx({ ...base, status: "ended", launchedAt: 100 });
    const result = (await getBySlugHandler(ctx, { slug: base.slug, now: 150 })) as {
      active: boolean;
      status: string;
    };
    expect(result.status).toBe("ended");
    expect(result.active).toBe(false);
  });

  it("hides promotions ended before launch after their scheduled start", async () => {
    const ctx = makeQueryCtx({ ...base, status: "ended" });
    expect(await getBySlugHandler(ctx, { slug: base.slug, now: 150 })).toBeNull();
  });

  it("hides ended promotions before their launch window", async () => {
    const ctx = makeQueryCtx({ ...base, status: "ended" });
    expect(await getBySlugHandler(ctx, { slug: base.slug, now: 50 })).toBeNull();
  });
});
