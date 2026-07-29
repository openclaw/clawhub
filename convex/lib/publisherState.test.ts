import { describe, expect, it, vi } from "vitest";
import type { Doc, Id, TableNames } from "../_generated/dataModel";
import { getPublisherStateFacts } from "./publisherState";

function testId<TableName extends TableNames>(value: string): Id<TableName> {
  return value as Id<TableName>;
}

function makePublisher(overrides: Partial<Doc<"publishers">>): Doc<"publishers"> {
  return {
    _id: testId<"publishers">("publishers:publisher"),
    _creationTime: 1,
    kind: "org",
    handle: "publisher",
    displayName: "Publisher",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Doc<"publishers">;
}

function makeCtx(options?: {
  members?: Array<{ publisherId: string; userId: string; role?: "owner" | "admin" | "publisher" }>;
  officialPublisherIds?: string[];
  users?: Record<string, { deletedAt?: number; deactivatedAt?: number } | null>;
}) {
  const members = options?.members ?? [];
  const officialPublisherIds = new Set(options?.officialPublisherIds ?? []);
  const users = options?.users ?? {};

  return {
    db: {
      get: vi.fn(async (id: string) => {
        const user = users[id] ?? {};
        return user ? { _id: id, ...user } : null;
      }),
      query: vi.fn((table: string) => ({
        withIndex: vi.fn(
          (
            indexName: string,
            buildQuery: (q: { eq: (field: string, value: string) => unknown }) => unknown,
          ) => {
            let publisherId: string | undefined;
            let role: string | undefined;
            const queryBuilder = {
              eq: vi.fn((field: string, value: string) => {
                if (field === "publisherId") publisherId = value;
                if (field === "role") role = value;
                return queryBuilder;
              }),
            };
            buildQuery({
              eq: queryBuilder.eq,
            });

            if (table === "publisherMembers" && indexName === "by_publisher_and_role") {
              return {
                take: vi.fn(async (limit: number) =>
                  members
                    .filter(
                      (member) =>
                        member.publisherId === publisherId && (member.role ?? "publisher") === role,
                    )
                    .slice(0, limit)
                    .map((member, index) => ({
                      _id: `publisherMembers:${index + 1}`,
                      role: member.role ?? "publisher",
                      ...member,
                    })),
                ),
              };
            }

            if (table === "officialPublishers" && indexName === "by_publisher") {
              return {
                unique: vi.fn(async () =>
                  publisherId && officialPublisherIds.has(publisherId)
                    ? {
                        _id: testId<"officialPublishers">("officialPublishers:1"),
                        publisherId: testId<"publishers">(publisherId),
                      }
                    : null,
                ),
              };
            }

            throw new Error(`Unexpected query ${table}.${indexName}`);
          },
        ),
      })),
    },
  };
}

describe("getPublisherStateFacts", () => {
  it("derives claimed official org state from members and official rows", async () => {
    const ctx = makeCtx({
      members: [{ publisherId: "publishers:openclaw", userId: "users:owner" }],
      officialPublisherIds: ["publishers:openclaw"],
    });

    await expect(
      getPublisherStateFacts(
        ctx as never,
        makePublisher({ _id: testId<"publishers">("publishers:openclaw") }),
      ),
    ).resolves.toEqual({
      claimState: "claimed",
      officialState: "official",
      restrictionState: "active",
    });
  });

  it("keeps user claims separate from official state", async () => {
    const ctx = makeCtx();

    await expect(
      getPublisherStateFacts(
        ctx as never,
        makePublisher({
          _id: testId<"publishers">("publishers:alice"),
          kind: "user",
          linkedUserId: testId<"users">("users:alice"),
        }),
      ),
    ).resolves.toEqual({
      claimState: "claimed",
      officialState: "notOfficial",
      restrictionState: "active",
    });
  });

  it("preserves legacy personal publisher claims from owner membership", async () => {
    const ctx = makeCtx({
      members: [{ publisherId: "publishers:legacy", userId: "users:owner", role: "owner" }],
    });

    await expect(
      getPublisherStateFacts(
        ctx as never,
        makePublisher({
          _id: testId<"publishers">("publishers:legacy"),
          kind: "user",
          linkedUserId: undefined,
        }),
      ),
    ).resolves.toMatchObject({
      claimState: "claimed",
    });
  });

  it("does not claim personal publishers linked to inactive users", async () => {
    const ctx = makeCtx({ users: { "users:alice": { deactivatedAt: 10 } } });

    await expect(
      getPublisherStateFacts(
        ctx as never,
        makePublisher({
          _id: testId<"publishers">("publishers:alice"),
          kind: "user",
          linkedUserId: testId<"users">("users:alice"),
        }),
      ),
    ).resolves.toMatchObject({
      claimState: "unclaimed",
    });
  });

  it("only claims publishers with active membership users", async () => {
    const ctx = makeCtx({
      members: [
        { publisherId: "publishers:org", userId: "users:stale" },
        { publisherId: "publishers:org", userId: "users:active" },
      ],
      users: {
        "users:stale": { deletedAt: 10 },
        "users:active": {},
      },
    });

    await expect(
      getPublisherStateFacts(
        ctx as never,
        makePublisher({ _id: testId<"publishers">("publishers:org") }),
      ),
    ).resolves.toMatchObject({
      claimState: "claimed",
    });
  });

  it("keeps large bounded membership buckets claimed without unbounded scans", async () => {
    const members = Array.from({ length: 20 }, (_value, index) => ({
      publisherId: "publishers:org",
      userId: `users:stale${index}`,
      role: "publisher" as const,
    }));
    const ctx = makeCtx({
      members,
      users: Object.fromEntries(members.map((member) => [member.userId, { deletedAt: 10 }])),
    });

    await expect(
      getPublisherStateFacts(
        ctx as never,
        makePublisher({ _id: testId<"publishers">("publishers:org") }),
      ),
    ).resolves.toMatchObject({
      claimState: "claimed",
    });
  });

  it("reports missing or deleted publisher restrictions without inventing claims", async () => {
    const ctx = makeCtx();

    await expect(getPublisherStateFacts(ctx as never, null)).resolves.toEqual({
      claimState: "unclaimed",
      officialState: "notOfficial",
      restrictionState: "missing",
    });
    await expect(
      getPublisherStateFacts(ctx as never, makePublisher({ deletedAt: 10 })),
    ).resolves.toMatchObject({
      restrictionState: "deleted",
    });
  });
});
