import { describe, expect, it, vi } from "vitest";
import type { Doc } from "./_generated/dataModel";
import { seedDefaultOfficialPublishersHandler } from "./officialPublishers";

function makePublisher(handle: string): Doc<"publishers"> {
  return {
    _id: `publishers:${handle}`,
    _creationTime: 1,
    kind: "org",
    handle,
    displayName: handle,
    createdAt: 1,
    updatedAt: 1,
  } as Doc<"publishers">;
}

function makeCtx({
  publishers,
  officialPublisherIds = [],
}: {
  publishers: Array<Doc<"publishers">>;
  officialPublisherIds?: string[];
}) {
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  return {
    inserted,
    ctx: {
      db: {
        query: vi.fn((table: string) => ({
          withIndex: vi.fn((_indexName: string, buildQuery: (q: unknown) => unknown) => {
            let fieldName: string | undefined;
            let requestedValue: string | undefined;
            buildQuery({
              eq: vi.fn((field: string, value: string) => {
                fieldName = field;
                requestedValue = value;
                return {};
              }),
            });
            return {
              unique: vi.fn(async () => {
                if (table === "publishers" && fieldName === "handle") {
                  return (
                    publishers.find((publisher) => publisher.handle === requestedValue) ?? null
                  );
                }
                if (table === "officialPublishers" && fieldName === "publisherId") {
                  return officialPublisherIds.includes(requestedValue ?? "")
                    ? {
                        _id: `officialPublishers:${requestedValue}`,
                        _creationTime: 1,
                        publisherId: requestedValue,
                        createdAt: 1,
                        updatedAt: 1,
                      }
                    : null;
                }
                throw new Error(`Unexpected lookup ${table}.${fieldName}`);
              }),
            };
          }),
        })),
        insert: vi.fn(async (table: string, value: Record<string, unknown>) => {
          inserted.push({ table, value });
          return `${table}:${inserted.length}`;
        }),
      },
    },
  };
}

describe("seedDefaultOfficialPublishersHandler", () => {
  it("inserts official publisher rows for openclaw and nvidia", async () => {
    const { ctx, inserted } = makeCtx({
      publishers: [makePublisher("openclaw"), makePublisher("nvidia")],
    });

    const result = await seedDefaultOfficialPublishersHandler(ctx as never, {
      actorUserId: "users:admin" as never,
      now: 123,
    });

    expect(result).toEqual({
      ok: true,
      seeded: 2,
      alreadyOfficial: 0,
      missing: [],
    });
    expect(inserted).toEqual([
      {
        table: "officialPublishers",
        value: {
          publisherId: "publishers:openclaw",
          reason: "default-official-publisher-migration",
          createdByUserId: "users:admin",
          createdAt: 123,
          updatedAt: 123,
        },
      },
      {
        table: "officialPublishers",
        value: {
          publisherId: "publishers:nvidia",
          reason: "default-official-publisher-migration",
          createdByUserId: "users:admin",
          createdAt: 123,
          updatedAt: 123,
        },
      },
    ]);
  });

  it("does not duplicate existing rows and reports missing publishers", async () => {
    const { ctx, inserted } = makeCtx({
      publishers: [makePublisher("openclaw")],
      officialPublisherIds: ["publishers:openclaw"],
    });

    const result = await seedDefaultOfficialPublishersHandler(ctx as never, {
      actorUserId: "users:admin" as never,
      now: 123,
    });

    expect(result).toEqual({
      ok: true,
      seeded: 0,
      alreadyOfficial: 1,
      missing: ["nvidia"],
    });
    expect(inserted).toEqual([]);
  });
});
