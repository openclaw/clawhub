import { describe, expect, it, vi } from "vitest";
import type { Doc } from "../_generated/dataModel";
import { hasOfficialPublisherRow, isOfficialPublisher } from "./officialPublishers";

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

function makeOfficialRow(publisherId: string) {
  return {
    _id: `officialPublishers:${publisherId}`,
    _creationTime: 1,
    publisherId,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeCtx({ officialPublisherIds = [] }: { officialPublisherIds?: string[] } = {}) {
  return {
    db: {
      query: vi.fn((table: string) => {
        if (table !== "officialPublishers") {
          throw new Error(`Unexpected table ${table}`);
        }
        return {
          withIndex: vi.fn((_indexName: string, buildQuery: (q: unknown) => unknown) => {
            let requestedPublisherId: string | undefined;
            buildQuery({
              eq: vi.fn((field: string, value: string) => {
                if (field === "publisherId") requestedPublisherId = value;
                return {};
              }),
            });
            return {
              unique: vi.fn(async () =>
                requestedPublisherId && officialPublisherIds.includes(requestedPublisherId)
                  ? makeOfficialRow(requestedPublisherId)
                  : null,
              ),
            };
          }),
        };
      }),
    },
  };
}

describe("isOfficialPublisher", () => {
  it("treats a publisher with an official row as official", async () => {
    const ctx = makeCtx({ officialPublisherIds: ["publishers:acme"] });

    await expect(
      isOfficialPublisher(ctx as never, makePublisher({ _id: "publishers:acme", handle: "acme" })),
    ).resolves.toBe(true);
  });

  it("treats a personal publisher with an official row as official", async () => {
    const ctx = makeCtx({ officialPublisherIds: ["publishers:alice"] });

    await expect(
      isOfficialPublisher(
        ctx as never,
        makePublisher({
          _id: "publishers:alice",
          kind: "user",
          handle: "alice",
          linkedUserId: "users:alice",
        }),
      ),
    ).resolves.toBe(true);
  });

  it("does not treat legacy official handles as official without a row", async () => {
    const ctx = makeCtx();

    await expect(
      isOfficialPublisher(
        ctx as never,
        makePublisher({ _id: "publishers:openclaw", handle: "openclaw" }),
      ),
    ).resolves.toBe(false);
  });

  it("does not inherit official status from org membership", async () => {
    const personal = makePublisher({
      _id: "publishers:alice",
      kind: "user",
      handle: "alice",
      linkedUserId: "users:alice",
    });
    const ctx = makeCtx({ officialPublisherIds: ["publishers:openclaw"] });

    await expect(isOfficialPublisher(ctx as never, personal)).resolves.toBe(false);
  });

  it("can check raw official rows independently from active publisher state", async () => {
    const ctx = makeCtx({ officialPublisherIds: ["publishers:acme"] });

    await expect(
      isOfficialPublisher(
        ctx as never,
        makePublisher({ _id: "publishers:acme", handle: "acme", deactivatedAt: 123 }),
      ),
    ).resolves.toBe(false);
    await expect(hasOfficialPublisherRow(ctx as never, "publishers:acme" as never)).resolves.toBe(
      true,
    );
  });
});
