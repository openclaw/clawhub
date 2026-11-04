import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import { getLatestPublication } from "./catalogFeed";
import { catalogTemplatesFeedV1Handler, catalogFeedV1Handler } from "./httpApiV1/catalogFeedV1";
import { sha256Hex } from "./lib/clawpack";

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

function makeStoredTemplateFeedCtx(
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

  it("serves the Templates publication by default", async () => {
    const response = await catalogTemplatesFeedV1Handler(
      ctx as never,
      new Request("https://clawhub.ai/api/v1/feeds/templates"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("surrogate-control")).toBeNull();
    expect(response.headers.get("etag")).toBe('"sha256:abc123"');
    expect(ctx.runQuery).toHaveBeenCalledWith(internal.catalogFeed.getLatestPublication, {
      feedId: "clawhub-official-templates",
    });
  });

  it("rejects a pre-policy stored Template feed even with a matching cache validator", async () => {
    const storedCtx = makeStoredTemplateFeedCtx({
      ...publication,
      feedId: "clawhub-official-templates",
      payload: '{"entries":[{"id":"@other/legacy"}]}',
    });

    const response = await catalogTemplatesFeedV1Handler(
      storedCtx as never,
      new Request("https://clawhub.ai/api/v1/feeds/templates", {
        headers: { "If-None-Match": '"sha256:abc123"' },
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("@other/legacy");
  });

  it("serves only a policy-stamped Template feed from a currently active publisher", async () => {
    const payload = JSON.stringify({
      schemaVersion: 1,
      id: "clawhub-official-templates",
      sequence: publication.sequence,
      generatedAt: publication.generatedAt,
      expiresAt: publication.expiresAt,
      entries: [
        {
          type: "template",
          id: "@openclaw/runtime-proof",
          title: "Runtime proof",
          version: "1.0.0",
          state: "available",
          publisher: { id: "openclaw", trust: "official" },
          templateManifestSummary: {
            schemaVersion: 1,
            agent: { id: "runtime-proof", name: "Runtime proof" },
            workspace: { bootstrapFiles: [], fileCount: 0 },
            packages: { skillCount: 0, pluginCount: 0 },
            mcpServerCount: 0,
            cronJobCount: 0,
          },
          install: {
            candidates: [
              {
                sourceRef: "public-clawhub",
                package: "@openclaw/runtime-proof",
                version: "1.0.0",
                integrity:
                  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              },
            ],
          },
        },
      ],
    });
    const stored = {
      ...publication,
      feedId: "clawhub-official-claws",
      payload,
      payloadSha256: await sha256Hex(new TextEncoder().encode(payload)),
      clawPolicyVersion: 1,
      clawEntryCount: 1,
      clawPublisherId: "publishers:openclaw",
    };
    const active = makeStoredTemplateFeedCtx(stored);
    const activeResponse = await catalogTemplatesFeedV1Handler(
      active as never,
      new Request("https://clawhub.ai/api/v1/feeds/templates"),
    );
    expect(activeResponse.status).toBe(200);

    const revoked = makeStoredTemplateFeedCtx(stored, {
      _id: "publishers:openclaw",
      kind: "org",
      handle: "openclaw",
      deactivatedAt: 123,
    });
    const revokedResponse = await catalogTemplatesFeedV1Handler(
      revoked as never,
      new Request("https://clawhub.ai/api/v1/feeds/templates"),
    );
    expect(revokedResponse.status).toBe(503);
    expect(revokedResponse.headers.get("cache-control")).toBe("no-store");
  });
});
