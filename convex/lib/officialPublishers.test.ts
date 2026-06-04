import { describe, expect, it, vi } from "vitest";
import type { Doc } from "../_generated/dataModel";
import { isOfficialPublisher } from "./officialPublishers";

function makePublisher(
  overrides: Partial<Record<keyof Doc<"publishers">, unknown>>,
): Doc<"publishers"> {
  return {
    _id: "publishers:publisher",
    _creationTime: 1,
    kind: "org",
    handle: "publisher",
    displayName: "Publisher",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Doc<"publishers">;
}

describe("isOfficialPublisher", () => {
  it("treats the openclaw org publisher as official", async () => {
    const ctx = { db: { query: vi.fn() } };

    await expect(
      isOfficialPublisher(ctx as never, makePublisher({ handle: "openclaw" })),
    ).resolves.toBe(true);
  });

  it("does not treat an unreserved nvidia org publisher as official", async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table !== "reservedHandles") throw new Error(`Unexpected table ${table}`);
          return {
            withIndex: vi.fn(() => ({
              order: vi.fn(() => ({
                take: vi.fn(async () => []),
              })),
            })),
          };
        }),
      },
    };

    await expect(
      isOfficialPublisher(ctx as never, makePublisher({ handle: "nvidia" })),
    ).resolves.toBe(false);
  });

  it("treats the reserved-owner-controlled nvidia org publisher as official", async () => {
    const nvidia = makePublisher({ _id: "publishers:nvidia", handle: "nvidia" });
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "reservedHandles") {
            return {
              withIndex: vi.fn(() => ({
                order: vi.fn(() => ({
                  take: vi.fn(async () => [
                    {
                      _id: "reservedHandles:nvidia",
                      handle: "nvidia",
                      rightfulOwnerUserId: "users:nvidia",
                      createdAt: 1,
                      updatedAt: 1,
                    },
                  ]),
                })),
              })),
            };
          }
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => ({
                  _id: "publisherMembers:nvidia",
                  publisherId: nvidia._id,
                  userId: "users:nvidia",
                  role: "owner",
                  createdAt: 1,
                  updatedAt: 1,
                })),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      },
    };

    await expect(isOfficialPublisher(ctx as never, nvidia)).resolves.toBe(true);
  });

  it("does not treat nvidia as official when the reserved owner does not own the org", async () => {
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "reservedHandles") {
            return {
              withIndex: vi.fn(() => ({
                order: vi.fn(() => ({
                  take: vi.fn(async () => [
                    {
                      _id: "reservedHandles:nvidia",
                      handle: "nvidia",
                      rightfulOwnerUserId: "users:nvidia",
                      createdAt: 1,
                      updatedAt: 1,
                    },
                  ]),
                })),
              })),
            };
          }
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => null),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      },
    };

    await expect(
      isOfficialPublisher(ctx as never, makePublisher({ handle: "nvidia" })),
    ).resolves.toBe(false);
  });

  it("does not treat personal publisher of unreserved nvidia org member as official", async () => {
    const nvidia = makePublisher({ _id: "publishers:nvidia", handle: "nvidia" });
    const personal = makePublisher({
      _id: "publishers:alice",
      kind: "user",
      handle: "alice",
      linkedUserId: "users:alice",
    });
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: vi.fn((_index: string, fn: (q: any) => any) => {
                let capturedHandle: string | undefined;
                fn({ eq: (_: string, v: string) => { capturedHandle = v; return { eq: () => ({}) }; } });
                return { unique: vi.fn(async () => (capturedHandle === "nvidia" ? nvidia : null)) };
              }),
            };
          }
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => ({
                  _id: "publisherMembers:alice-nvidia",
                  publisherId: nvidia._id,
                  userId: "users:alice",
                  role: "publisher",
                  createdAt: 1,
                  updatedAt: 1,
                })),
              })),
            };
          }
          if (table === "reservedHandles") {
            return {
              withIndex: vi.fn(() => ({
                order: vi.fn(() => ({
                  take: vi.fn(async () => []),
                })),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      },
    };

    await expect(isOfficialPublisher(ctx as never, personal)).resolves.toBe(false);
  });

  it("treats personal publisher of reserved-owner-controlled nvidia org member as official", async () => {
    const nvidia = makePublisher({ _id: "publishers:nvidia", handle: "nvidia" });
    const personal = makePublisher({
      _id: "publishers:alice",
      kind: "user",
      handle: "alice",
      linkedUserId: "users:alice",
    });
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: vi.fn((_index: string, fn: (q: any) => any) => {
                let capturedHandle: string | undefined;
                fn({ eq: (_: string, v: string) => { capturedHandle = v; return { eq: () => ({}) }; } });
                return { unique: vi.fn(async () => (capturedHandle === "nvidia" ? nvidia : null)) };
              }),
            };
          }
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn((_index: string, fn: (q: any) => any) => {
                let capturedUserId: string | undefined;
                fn({ eq: (_: string, _v: any) => ({ eq: (_2: string, v2: string) => { capturedUserId = v2; return {}; } }) });
                const record =
                  capturedUserId === "users:nvidia-owner"
                    ? {
                        _id: "publisherMembers:nvidia-owner",
                        publisherId: nvidia._id,
                        userId: "users:nvidia-owner",
                        role: "owner",
                        createdAt: 1,
                        updatedAt: 1,
                      }
                    : {
                        _id: "publisherMembers:alice-nvidia",
                        publisherId: nvidia._id,
                        userId: "users:alice",
                        role: "publisher",
                        createdAt: 1,
                        updatedAt: 1,
                      };
                return { unique: vi.fn(async () => record) };
              }),
            };
          }
          if (table === "reservedHandles") {
            return {
              withIndex: vi.fn(() => ({
                order: vi.fn(() => ({
                  take: vi.fn(async () => [
                    {
                      _id: "reservedHandles:nvidia",
                      handle: "nvidia",
                      rightfulOwnerUserId: "users:nvidia-owner",
                      createdAt: 1,
                      updatedAt: 1,
                    },
                  ]),
                })),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      },
    };

    await expect(isOfficialPublisher(ctx as never, personal)).resolves.toBe(true);
  });

  it("treats personal publishers for openclaw org members as official", async () => {
    const openclaw = makePublisher({ _id: "publishers:openclaw", handle: "openclaw" });
    const personal = makePublisher({
      _id: "publishers:alice",
      kind: "user",
      handle: "alice",
      linkedUserId: "users:alice",
    });
    const ctx = {
      db: {
        query: vi.fn((table: string) => {
          if (table === "publishers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => openclaw),
              })),
            };
          }
          if (table === "publisherMembers") {
            return {
              withIndex: vi.fn(() => ({
                unique: vi.fn(async () => ({
                  _id: "publisherMembers:alice",
                  publisherId: "publishers:openclaw",
                  userId: "users:alice",
                  role: "publisher",
                  createdAt: 1,
                  updatedAt: 1,
                })),
              })),
            };
          }
          throw new Error(`Unexpected table ${table}`);
        }),
      },
    };

    await expect(isOfficialPublisher(ctx as never, personal)).resolves.toBe(true);
  });
});
