import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { getLatestPublication } from "./catalogFeed";
import { catalogClawsFeedV1Handler, catalogFeedV1Handler } from "./httpApiV1/catalogFeedV1";

type QueryCtx = {
  runQuery: ReturnType<typeof vi.fn>;
};

const publication = {
  feedId: "clawhub-official",
  sequence: 4,
  generatedAt: "2026-06-23T00:00:00.000Z",
  expiresAt: "2026-06-30T00:00:00.000Z",
  payload: '{"schemaVersion":1,"id":"clawhub-official","entries":[]}',
  payloadSha256: "abc123",
  publishedAt: Date.parse("2026-06-23T00:00:00.000Z"),
};

const getLatestPublicationHandler = (
  getLatestPublication as unknown as {
    _handler: (ctx: unknown, args: { feedId: string }) => Promise<unknown>;
  }
)._handler;

function makeStoredClawFeedCtx(
  storedPublication: Record<string, unknown>,
  publisher: Record<string, unknown> | null = {
    _id: "publishers:openclaw",
    kind: "org",
    handle: "openclaw",
  },
) {
  const db = {
    get: vi.fn(async (id: string) => (id === "publishers:openclaw" ? publisher : null)),
    query: vi.fn((table: string) => ({
      withIndex: vi.fn(() => ({
        unique: vi.fn(async () =>
          table === "catalogFeedPublications"
            ? storedPublication
            : table === "officialPublishers" && publisher
              ? { publisherId: "publishers:openclaw" }
              : null,
        ),
      })),
    })),
  };
  return {
    runQuery: vi.fn(
      async (_ref: unknown, args: { feedId: string }) =>
        await getLatestPublicationHandler({ db }, args),
    ),
  };
}

describe("catalogFeedV1Handler", () => {
  let ctx: QueryCtx;

  beforeEach(() => {
    ctx = { runQuery: vi.fn().mockResolvedValue(publication) };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("serves the exact published payload with edge cache validators", async () => {
    const response = await catalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/feed"),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(publication.payload);
    expect(response.headers.get("etag")).toBe('"sha256:abc123"');
    expect(response.headers.get("last-modified")).toBe("Tue, 23 Jun 2026 00:00:00 GMT");
    expect(response.headers.get("cache-control")).toContain("s-maxage=300");
    expect(response.headers.get("surrogate-control")).toContain("stale-while-revalidate=86400");
    expect(ctx.runQuery).toHaveBeenCalledWith(internal.catalogFeed.getLatestPublication, {
      feedId: "clawhub-official",
    });
  });

  it("returns 304 for a matching validator", async () => {
    const response = await catalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/feed", {
        headers: { "If-None-Match": '"sha256:abc123"' },
      }),
    );

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  it("accepts weak etags and last-modified validators", async () => {
    const weakEtagResponse = await catalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/feed", {
        headers: { "If-None-Match": 'W/"sha256:abc123"' },
      }),
    );
    expect(weakEtagResponse.status).toBe(304);

    const lastModifiedResponse = await catalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/feed", {
        headers: { "If-Modified-Since": "Tue, 23 Jun 2026 00:00:00 GMT" },
      }),
    );
    expect(lastModifiedResponse.status).toBe(304);
  });

  it("gives etag precedence over last-modified", async () => {
    const response = await catalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/feed", {
        headers: {
          "If-None-Match": '"sha256:different"',
          "If-Modified-Since": "Tue, 23 Jun 2026 00:00:00 GMT",
        },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("does not cache an unpublished feed", async () => {
    ctx.runQuery.mockResolvedValue(null);
    const response = await catalogFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/feed"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("hides the Claws feed while the experiment is disabled", async () => {
    const response = await catalogClawsFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/claws"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it("serves the Claws publication while the experiment is enabled", async () => {
    vi.stubEnv("CLAWHUB_EXPERIMENTAL_CLAWS", "1");
    const response = await catalogClawsFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/claws"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("surrogate-control")).toBeNull();
    expect(response.headers.get("etag")).toBe('"sha256:abc123"');
    expect(ctx.runQuery).toHaveBeenCalledWith(internal.catalogFeed.getLatestPublication, {
      feedId: "clawhub-official-claws",
    });
  });

  it("rejects a pre-policy stored Claw feed even with a matching cache validator", async () => {
    vi.stubEnv("CLAWHUB_EXPERIMENTAL_CLAWS", "1");
    const storedCtx = makeStoredClawFeedCtx({
      ...publication,
      feedId: "clawhub-official-claws",
      payload: '{"entries":[{"id":"@other/legacy"}]}',
    });

    const response = await catalogClawsFeedV1Handler(
      storedCtx as never,
      new Request("https://clawhub.ai/api/v1/feeds/claws", {
        headers: { "If-None-Match": '"sha256:abc123"' },
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("@other/legacy");
  });

  it("serves only a policy-stamped Claw feed from a currently active publisher", async () => {
    vi.stubEnv("CLAWHUB_EXPERIMENTAL_CLAWS", "1");
    const stored = {
      ...publication,
      feedId: "clawhub-official-claws",
      clawPolicyVersion: 1,
      clawEntryCount: 1,
      clawPublisherId: "publishers:openclaw",
    };
    const active = makeStoredClawFeedCtx(stored);
    const activeResponse = await catalogClawsFeedV1Handler(
      active as never,
      new Request("https://clawhub.ai/api/v1/feeds/claws"),
    );
    expect(activeResponse.status).toBe(200);

    const revoked = makeStoredClawFeedCtx(stored, {
      _id: "publishers:openclaw",
      kind: "org",
      handle: "openclaw",
      deactivatedAt: 123,
    });
    const revokedResponse = await catalogClawsFeedV1Handler(
      revoked as never,
      new Request("https://clawhub.ai/api/v1/feeds/claws"),
    );
    expect(revokedResponse.status).toBe(503);
    expect(revokedResponse.headers.get("cache-control")).toBe("no-store");
  });
});
