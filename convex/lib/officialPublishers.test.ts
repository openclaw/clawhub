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
