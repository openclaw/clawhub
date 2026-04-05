/* @vitest-environment node */
import { describe, expect, it } from "vitest";
import { listBySkillHandler } from "./comments";

function makeCtx(args: {
  comments: Array<Record<string, unknown>>;
  usersById: Record<string, Record<string, unknown> | null>;
}) {
  const get = async (id: string) => args.usersById[id] ?? null;
  const take = async () => args.comments;
  const order = () => ({ take });
  const withIndex = () => ({ order });
  const query = () => ({ withIndex });
  return { db: { get, query } } as never;
}

describe("comments.listBySkill", () => {
  it("skips soft-deleted comments", async () => {
    const ctx = makeCtx({
      comments: [
        {
          _id: "comments:live",
          skillId: "skills:1",
          userId: "users:live",
          body: "hello",
        },
        {
          _id: "comments:deleted",
          skillId: "skills:1",
          userId: "users:live",
          body: "bye",
          softDeletedAt: 123,
        },
      ],
      usersById: {
        "users:live": {
          _id: "users:live",
          _creationTime: 1,
          handle: "live",
          name: "live",
          displayName: "Live",
          image: null,
          bio: null,
        },
      },
    });

    const result = await listBySkillHandler(ctx, {
      skillId: "skills:1",
      limit: 50,
    } as never);

    expect(result).toHaveLength(1);
    expect(result[0]?.comment._id).toBe("comments:live");
  });

  it("skips comments whose author is deleted/deactivated/missing", async () => {
    const ctx = makeCtx({
      comments: [
        {
          _id: "comments:ok",
          skillId: "skills:1",
          userId: "users:ok",
          body: "ok",
        },
        {
          _id: "comments:deleted-user",
          skillId: "skills:1",
          userId: "users:deleted",
          body: "hidden",
        },
        {
          _id: "comments:deactivated-user",
          skillId: "skills:1",
          userId: "users:deactivated",
          body: "hidden",
        },
        {
          _id: "comments:missing-user",
          skillId: "skills:1",
          userId: "users:missing",
          body: "hidden",
        },
      ],
      usersById: {
        "users:ok": {
          _id: "users:ok",
          _creationTime: 1,
          handle: "ok",
          name: "ok",
          displayName: "Ok",
          image: null,
          bio: null,
        },
        "users:deleted": {
          _id: "users:deleted",
          _creationTime: 1,
          handle: "deleted",
          name: "deleted",
          displayName: "Deleted",
          image: null,
          bio: null,
          deletedAt: 123,
        },
        "users:deactivated": {
          _id: "users:deactivated",
          _creationTime: 1,
          handle: "deactivated",
          name: "deactivated",
          displayName: "Deactivated",
          image: null,
          bio: null,
          deactivatedAt: 456,
        },
      },
    });

    const result = await listBySkillHandler(ctx, {
      skillId: "skills:1",
      limit: 50,
    } as never);

    expect(result).toHaveLength(1);
    expect(result[0]?.comment._id).toBe("comments:ok");
    expect(result[0]?.user._id).toBe("users:ok");
  });
});
