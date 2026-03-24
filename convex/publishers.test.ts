import { getAuthUserId } from "@convex-dev/auth/server";
import { describe, expect, it, vi } from "vitest";
import {
  addMember,
  listMine,
  migrateLegacyPublisherHandleToOrgInternal,
  removeMember,
} from "./publishers";

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: vi.fn(),
}));

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const addMemberHandler = (
  addMember as unknown as WrappedHandler<
    { publisherId: string; userHandle: string; role: "owner" | "admin" | "publisher" }
  >
)._handler;

const removeMemberHandler = (
  removeMember as unknown as WrappedHandler<{ publisherId: string; userId: string }>
)._handler;

const migrateLegacyPublisherHandleToOrgInternalHandler = (
  migrateLegacyPublisherHandleToOrgInternal as unknown as WrappedHandler<
    {
      actorUserId: string;
      handle: string;
      fallbackUserHandle?: string;
      displayName?: string;
    },
    {
      ok: true;
      handle: string;
      orgPublisherId: string;
      legacyUserId: string;
      fallbackUserHandle: string;
      personalPublisherId: string | null;
      convertedExistingPublisher: boolean;
      packagesMigrated: number;
    }
  >
)._handler;

const listMineHandler = (
  listMine as unknown as WrappedHandler<Record<string, never>, Array<unknown>>
)._handler;

describe("publishers membership controls", () => {
  it("prevents admins from promoting members to owner", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:admin" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:admin") return { _id: id };
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "acme",
              displayName: "Acme",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn().mockResolvedValue({
                  _id: "publisherMembers:admin",
                  publisherId: "publishers:org",
                  userId: "users:admin",
                  role: "admin",
                }),
              })),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        insert: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      addMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userHandle: "peter", role: "owner" } as never,
      ),
    ).rejects.toThrow("Only org owners can promote members to owner");
  });

  it("prevents removing the last remaining owner", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:owner" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:owner") return { _id: id };
          if (id === "publishers:org") {
            return {
              _id: id,
              kind: "org",
              handle: "acme",
              displayName: "Acme",
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName === "by_publisher_user") {
                  return {
                    unique: vi
                      .fn()
                      .mockResolvedValueOnce({
                        _id: "publisherMembers:owner-actor",
                        publisherId: "publishers:org",
                        userId: "users:owner",
                        role: "owner",
                      })
                      .mockResolvedValueOnce({
                        _id: "publisherMembers:owner-target",
                        publisherId: "publishers:org",
                        userId: "users:owner",
                        role: "owner",
                      }),
                  };
                }
                if (indexName === "by_publisher") {
                  return {
                    collect: vi.fn().mockResolvedValue([
                      {
                        _id: "publisherMembers:owner-target",
                        publisherId: "publishers:org",
                        userId: "users:owner",
                        role: "owner",
                      },
                    ]),
                  };
                }
                throw new Error(`unexpected index ${indexName}`);
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
        delete: vi.fn(),
        insert: vi.fn(),
        patch: vi.fn(),
        replace: vi.fn(),
        normalizeId: vi.fn(),
      },
    };

    await expect(
      removeMemberHandler(
        ctx as never,
        { publisherId: "publishers:org", userId: "users:owner" } as never,
      ),
    ).rejects.toThrow("Publisher must have at least one owner");
  });
});

describe("publisher bootstrap", () => {
  it("lists a synthesized personal publisher when membership rows are missing", async () => {
    vi.mocked(getAuthUserId).mockResolvedValue("users:alice" as never);
    const ctx = {
      db: {
        get: vi.fn(async (id: string) => {
          if (id === "users:alice") {
            return {
              _id: id,
              _creationTime: 1,
              handle: "alice",
              displayName: "Alice",
              trustedPublisher: false,
              createdAt: 1,
              updatedAt: 1,
            };
          }
          return null;
        }),
        query: vi.fn((table: string) => {
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_user") throw new Error(`unexpected index ${indexName}`);
                return { collect: vi.fn().mockResolvedValue([]) };
              }),
            };
          }
          if (table === "publishers") {
            return {
              withIndex: vi.fn((indexName: string) => {
                if (indexName !== "by_linked_user") {
                  throw new Error(`unexpected index ${indexName}`);
                }
                return { unique: vi.fn().mockResolvedValue(null) };
              }),
            };
          }
          throw new Error(`unexpected table ${table}`);
        }),
      },
    };

    await expect(listMineHandler(ctx as never, {} as never)).resolves.toEqual([
      expect.objectContaining({
        role: "owner",
        publisher: expect.objectContaining({
          handle: "alice",
          kind: "user",
          linkedUserId: "users:alice",
        }),
      }),
    ]);
  });
});

describe("legacy publisher migration", () => {
  it("converts a legacy personal publisher into an org and rehomes package ownership", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const users = new Map<string, Record<string, unknown>>([
      ["users:admin", { _id: "users:admin", role: "admin" }],
      [
        "users:openclaw",
        {
          _id: "users:openclaw",
          _creationTime: 1,
          handle: "openclaw",
          displayName: "OpenClaw",
          trustedPublisher: true,
          personalPublisherId: "publishers:openclaw",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ]);
    const publishers = new Map<string, Record<string, unknown>>([
      [
        "publishers:openclaw",
        {
          _id: "publishers:openclaw",
          _creationTime: 1,
          kind: "user",
          handle: "openclaw",
          displayName: "OpenClaw",
          linkedUserId: "users:openclaw",
          trustedPublisher: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      [
        "publishers:openclaw-user",
        {
          _id: "publishers:openclaw-user",
          _creationTime: 1,
          kind: "user",
          handle: "openclaw-user",
          displayName: "OpenClaw User",
          linkedUserId: "users:openclaw",
          trustedPublisher: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    ]);
    const packages = [
      {
        _id: "packages:demo",
        ownerUserId: "users:openclaw",
        ownerPublisherId: undefined,
        updatedAt: 1,
      },
    ];
    const publisherMembers = [
      {
        _id: "publisherMembers:openclaw-owner",
        publisherId: "publishers:openclaw",
        userId: "users:openclaw",
        role: "owner",
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const patch = vi.fn(async (id: string, value: Record<string, unknown>) => {
      if (users.has(id)) {
        users.set(id, { ...users.get(id), ...value });
        return;
      }
      if (publishers.has(id)) {
        publishers.set(id, { ...publishers.get(id), ...value });
        return;
      }
      const pkg = packages.find((entry) => entry._id === id);
      if (pkg) {
        Object.assign(pkg, value);
        return;
      }
      const member = publisherMembers.find((entry) => entry._id === id);
      if (member) {
        Object.assign(member, value);
        return;
      }
      throw new Error(`unexpected patch ${id}`);
    });

    const insert = vi.fn(async (table: string, value: Record<string, unknown>) => {
      if (table === "publishers") {
        const id = "publishers:openclaw-user";
        publishers.set(id, { _id: id, _creationTime: 1, ...value });
        return id;
      }
      if (table === "publisherMembers") {
        const id = `publisherMembers:${publisherMembers.length + 1}`;
        publisherMembers.push({
          _id: id,
          publisherId: String(value.publisherId),
          userId: String(value.userId),
          role: String(value.role),
          createdAt: Number(value.createdAt),
          updatedAt: Number(value.updatedAt),
        });
        return id;
      }
      if (table === "auditLogs") return "auditLogs:1";
      throw new Error(`unexpected insert ${table}`);
    });

    const query = vi.fn((table: string) => {
      if (table === "users") {
        return {
          withIndex: vi.fn((_indexName: string, builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
            let handle = "";
            const q = {
              eq: (field: string, value: string) => {
                if (field === "handle") handle = value;
                return q;
              },
            };
            builder?.(q);
            return {
              unique: vi.fn(async () =>
                [...users.values()].find((user) => user.handle === handle) ?? null,
              ),
            };
          }),
        };
      }
      if (table === "publishers") {
        return {
          withIndex: vi.fn((_indexName: string, builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
            let handle = "";
            let linkedUserId = "";
            const q = {
              eq: (field: string, value: string) => {
                if (field === "handle") handle = value;
                if (field === "linkedUserId") linkedUserId = value;
                return q;
              },
            };
            builder?.(q);
            return {
              unique: vi.fn(async () => {
                if (handle) {
                  return [...publishers.values()].find((publisher) => publisher.handle === handle) ?? null;
                }
                if (linkedUserId) {
                  return (
                    [...publishers.values()].find((publisher) => publisher.linkedUserId === linkedUserId) ??
                    null
                  );
                }
                return null;
              }),
            };
          }),
        };
      }
      if (table === "publisherMembers") {
        return {
          withIndex: vi.fn((_indexName: string, builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
            let publisherId = "";
            let userId = "";
            const q = {
              eq: (field: string, value: string) => {
                if (field === "publisherId") publisherId = value;
                if (field === "userId") userId = value;
                return q;
              },
            };
            builder?.(q);
            return {
              unique: vi.fn(async () =>
                publisherMembers.find(
                  (member) => member.publisherId === publisherId && member.userId === userId,
                ) ?? null,
              ),
            };
          }),
        };
      }
      if (table === "packages") {
        return {
          withIndex: vi.fn((_indexName: string, builder?: (q: { eq: (field: string, value: string) => unknown }) => unknown) => {
            let ownerUserId = "";
            let ownerPublisherId = "";
            const q = {
              eq: (field: string, value: string) => {
                if (field === "ownerUserId") ownerUserId = value;
                if (field === "ownerPublisherId") ownerPublisherId = value;
                return q;
              },
            };
            builder?.(q);
            return {
              collect: vi.fn(async () => {
                if (ownerUserId) {
                  return packages.filter((pkg) => pkg.ownerUserId === ownerUserId);
                }
                if (ownerPublisherId) {
                  return packages.filter((pkg) => pkg.ownerPublisherId === ownerPublisherId);
                }
                return [];
              }),
            };
          }),
        };
      }
      if (table === "skills") {
        return {
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => []),
          })),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    const result = await migrateLegacyPublisherHandleToOrgInternalHandler(
      {
        db: {
          get: vi.fn(async (id: string) =>
            users.get(id) ?? publishers.get(id) ?? null,
          ),
          query,
          patch,
          insert,
          delete: vi.fn(),
          replace: vi.fn(),
          normalizeId: vi.fn(),
        },
      } as never,
      {
        actorUserId: "users:admin",
        handle: "openclaw",
        fallbackUserHandle: "openclaw-user",
        displayName: "OpenClaw",
      } as never,
    );

    expect(result).toMatchObject({
      ok: true,
      handle: "openclaw",
      orgPublisherId: "publishers:openclaw",
      legacyUserId: "users:openclaw",
      fallbackUserHandle: "openclaw-user",
      personalPublisherId: "publishers:openclaw-user",
      convertedExistingPublisher: true,
      packagesMigrated: 1,
    });
    expect(users.get("users:openclaw")).toEqual(
      expect.objectContaining({
        handle: "openclaw-user",
        personalPublisherId: "publishers:openclaw-user",
      }),
    );
    expect(publishers.get("publishers:openclaw")).toEqual(
      expect.objectContaining({
        kind: "org",
        handle: "openclaw",
        linkedUserId: undefined,
      }),
    );
    expect(publishers.get("publishers:openclaw-user")).toEqual(
      expect.objectContaining({
        kind: "user",
        handle: "openclaw-user",
        linkedUserId: "users:openclaw",
      }),
    );
    expect(packages[0]).toEqual(
      expect.objectContaining({
        ownerPublisherId: "publishers:openclaw",
      }),
    );
  });
});
