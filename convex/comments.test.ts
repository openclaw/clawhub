/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/access", () => ({
  assertModerator: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("./skillStatEvents", () => ({
  insertStatEvent: vi.fn(),
}));

vi.mock("./lib/githubAccount", () => ({
  requireGitHubAccountAge: vi.fn(),
}));

const { requireUser, assertModerator } = await import("./lib/access");
const { insertStatEvent } = await import("./skillStatEvents");
const { requireGitHubAccountAge } = await import("./lib/githubAccount");
const { addHandler, removeHandler, reportHandler } = await import("./comments.handlers");

describe("comments mutations", () => {
  afterEach(() => {
    vi.mocked(assertModerator).mockReset();
    vi.mocked(requireUser).mockReset();
    vi.mocked(insertStatEvent).mockReset();
    vi.mocked(requireGitHubAccountAge).mockReset();
    vi.restoreAllMocks();
  });

  it("add avoids direct skill patch and records stat event", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", role: "user" },
    } as never);
    vi.mocked(requireGitHubAccountAge).mockResolvedValue(undefined as never);

    const get = vi.fn().mockResolvedValue({
      _id: "skills:1",
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = { db: { get, insert, patch } } as never;

    await addHandler(ctx, { skillId: "skills:1", body: " hello " } as never);

    expect(requireGitHubAccountAge).toHaveBeenCalledWith(ctx, "users:1");
    expect(patch).not.toHaveBeenCalled();
    expect(insertStatEvent).toHaveBeenCalledWith(ctx, {
      skillId: "skills:1",
      kind: "comment",
    });
  });

  it("add blocks new comments when github account age gate fails", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:new",
      user: { _id: "users:new", role: "user" },
    } as never);
    vi.mocked(requireGitHubAccountAge).mockRejectedValue(
      new Error(
        "GitHub account must be at least 14 days old to upload skills. Try again in 3 days.",
      ),
    );

    const get = vi.fn();
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = { db: { get, insert, patch } } as never;

    await expect(addHandler(ctx, { skillId: "skills:1", body: "hello" } as never)).rejects.toThrow(
      /at least 14 days old/i,
    );

    expect(get).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(insertStatEvent).not.toHaveBeenCalled();
  });

  it("remove keeps comment soft-delete patch free of updatedAt", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:2",
      user: { _id: "users:2", role: "moderator" },
    } as never);

    const comment = {
      _id: "comments:1",
      skillId: "skills:1",
      userId: "users:2",
      softDeletedAt: undefined,
    };
    const get = vi.fn(async (id: string) => {
      if (id === "comments:1") return comment;
      if (id === "skills:1") {
        return { _id: "skills:1", softDeletedAt: undefined, moderationStatus: "active" };
      }
      return null;
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = { db: { get, insert, patch } } as never;

    await removeHandler(ctx, { commentId: "comments:1" } as never);

    expect(patch).toHaveBeenCalledTimes(1);
    const deletePatch = vi.mocked(patch).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(deletePatch.updatedAt).toBeUndefined();
    expect(insertStatEvent).toHaveBeenCalledWith(ctx, {
      skillId: "skills:1",
      kind: "uncomment",
    });
  });

  it("remove rejects non-owner without moderator permission", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:3",
      user: { _id: "users:3", role: "user" },
    } as never);
    vi.mocked(assertModerator).mockImplementation(() => {
      throw new Error("Moderator role required");
    });

    const comment = {
      _id: "comments:2",
      skillId: "skills:2",
      userId: "users:9",
      softDeletedAt: undefined,
    };
    const get = vi.fn().mockResolvedValue(comment);
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = { db: { get, insert, patch } } as never;

    await expect(removeHandler(ctx, { commentId: "comments:2" } as never)).rejects.toThrow(
      "Moderator role required",
    );
    expect(patch).not.toHaveBeenCalled();
    expect(insertStatEvent).not.toHaveBeenCalled();
  });

  it("remove no-ops for soft-deleted comment", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:4",
      user: { _id: "users:4", role: "moderator" },
    } as never);

    const comment = {
      _id: "comments:3",
      skillId: "skills:3",
      userId: "users:4",
      softDeletedAt: 123,
    };
    const get = vi.fn().mockResolvedValue(comment);
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = { db: { get, insert, patch } } as never;

    await removeHandler(ctx, { commentId: "comments:3" } as never);

    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(insertStatEvent).not.toHaveBeenCalled();
  });

  it("report increments count and stores reason", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", role: "user" },
    } as never);

    const comment = {
      _id: "comments:1",
      skillId: "skills:1",
      userId: "users:2",
      softDeletedAt: undefined,
      reportCount: 1,
    };
    const get = vi.fn(async (id: string) => {
      if (id === "comments:1") return comment;
      if (id === "skills:1") {
        return { _id: "skills:1", softDeletedAt: undefined, moderationStatus: "active" };
      }
      return null;
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const query = vi.fn((table: string) => {
      if (table === "commentReports") {
        return {
          withIndex: (index: string) => {
            if (index === "by_comment_user") {
              return { unique: vi.fn().mockResolvedValue(null) };
            }
            if (index === "by_user") {
              return { collect: vi.fn().mockResolvedValue([]) };
            }
            throw new Error(`Unexpected index ${index}`);
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const ctx = { db: { get, insert, patch, query } } as never;

    const result = await reportHandler(ctx, {
      commentId: "comments:1",
      reason: "  spam  ",
    } as never);

    expect(result).toEqual({ ok: true, reported: true, alreadyReported: false });
    expect(insert).toHaveBeenCalledWith("commentReports", {
      commentId: "comments:1",
      skillId: "skills:1",
      userId: "users:1",
      reason: "spam",
      createdAt: 1_700_000_000_000,
    });
    expect(patch).toHaveBeenCalledWith("comments:1", {
      reportCount: 2,
      lastReportedAt: 1_700_000_000_000,
    });
    expect(insertStatEvent).not.toHaveBeenCalled();
  });

  it("report returns alreadyReported for duplicate reporter/comment pair", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", role: "user" },
    } as never);

    const comment = {
      _id: "comments:dup",
      skillId: "skills:1",
      userId: "users:2",
      softDeletedAt: undefined,
      reportCount: 0,
    };
    const get = vi.fn(async (id: string) => {
      if (id === "comments:dup") return comment;
      if (id === "skills:1") {
        return { _id: "skills:1", softDeletedAt: undefined, moderationStatus: "active" };
      }
      return null;
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const query = vi.fn((table: string) => {
      if (table !== "commentReports") throw new Error(`Unexpected table ${table}`);
      return {
        withIndex: (index: string) => {
          if (index === "by_comment_user") {
            return { unique: vi.fn().mockResolvedValue({ _id: "commentReports:existing" }) };
          }
          throw new Error(`Unexpected index ${index}`);
        },
      };
    });
    const ctx = { db: { get, insert, patch, query } } as never;

    const result = await reportHandler(ctx, { commentId: "comments:dup", reason: "spam" } as never);

    expect(result).toEqual({ ok: true, reported: false, alreadyReported: true });
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("report rejects empty reason", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", role: "user" },
    } as never);

    const comment = {
      _id: "comments:empty",
      skillId: "skills:1",
      userId: "users:2",
      softDeletedAt: undefined,
      reportCount: 0,
    };
    const get = vi.fn(async (id: string) => {
      if (id === "comments:empty") return comment;
      if (id === "skills:1") {
        return { _id: "skills:1", softDeletedAt: undefined, moderationStatus: "active" };
      }
      return null;
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const query = vi.fn();
    const ctx = { db: { get, insert, patch, query } } as never;

    await expect(
      reportHandler(ctx, { commentId: "comments:empty", reason: "   " } as never),
    ).rejects.toThrow("Report reason required.");

    expect(query).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("report rejects comment when parent skill is hidden/removed", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", role: "user" },
    } as never);

    const comment = {
      _id: "comments:hidden-parent",
      skillId: "skills:hidden",
      userId: "users:2",
      softDeletedAt: undefined,
      reportCount: 0,
    };
    const get = vi.fn(async (id: string) => {
      if (id === "comments:hidden-parent") return comment;
      if (id === "skills:hidden") {
        return { _id: "skills:hidden", softDeletedAt: 123, moderationStatus: "removed" };
      }
      return null;
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const query = vi.fn();
    const ctx = { db: { get, insert, patch, query } } as never;

    await expect(
      reportHandler(ctx, { commentId: "comments:hidden-parent", reason: "abuse" } as never),
    ).rejects.toThrow("Comment not found");

    expect(query).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("report truncates long reason to 500 chars", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_050);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", role: "user" },
    } as never);

    const comment = {
      _id: "comments:long",
      skillId: "skills:1",
      userId: "users:2",
      softDeletedAt: undefined,
      reportCount: 0,
    };
    const get = vi.fn(async (id: string) => {
      if (id === "comments:long") return comment;
      if (id === "skills:1") {
        return { _id: "skills:1", softDeletedAt: undefined, moderationStatus: "active" };
      }
      return null;
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const query = vi.fn((table: string) => {
      if (table !== "commentReports") throw new Error(`Unexpected table ${table}`);
      return {
        withIndex: (index: string) => {
          if (index === "by_comment_user") return { unique: vi.fn().mockResolvedValue(null) };
          if (index === "by_user") return { collect: vi.fn().mockResolvedValue([]) };
          throw new Error(`Unexpected index ${index}`);
        },
      };
    });
    const ctx = { db: { get, insert, patch, query } } as never;

    await reportHandler(ctx, { commentId: "comments:long", reason: "x".repeat(700) } as never);

    const reportInsert = vi.mocked(insert).mock.calls.find((call) => call[0] === "commentReports");
    expect(reportInsert?.[1]).toMatchObject({
      commentId: "comments:long",
      reason: "x".repeat(500),
    });
  });

  it("report active-count filter ignores stale/non-active report targets", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", role: "user" },
    } as never);

    const comment = {
      _id: "comments:target2",
      skillId: "skills:1",
      userId: "users:2",
      softDeletedAt: undefined,
      reportCount: 0,
    };
    const reports = [
      {
        _id: "commentReports:1",
        commentId: "comments:deleted",
        userId: "users:1",
        skillId: "skills:1",
      },
      {
        _id: "commentReports:2",
        commentId: "comments:removed-skill",
        userId: "users:1",
        skillId: "skills:removed",
      },
      {
        _id: "commentReports:3",
        commentId: "comments:deleted-owner",
        userId: "users:1",
        skillId: "skills:active",
      },
    ];
    const get = vi.fn(async (id: string) => {
      if (id === "comments:target2") return comment;
      if (id === "skills:1") {
        return { _id: "skills:1", softDeletedAt: undefined, moderationStatus: "active" };
      }
      if (id === "comments:deleted") {
        return {
          _id: "comments:deleted",
          softDeletedAt: 123,
          skillId: "skills:1",
          userId: "users:2",
        };
      }
      if (id === "comments:removed-skill") {
        return {
          _id: "comments:removed-skill",
          softDeletedAt: undefined,
          skillId: "skills:removed",
          userId: "users:2",
        };
      }
      if (id === "skills:removed") {
        return { _id: "skills:removed", softDeletedAt: undefined, moderationStatus: "removed" };
      }
      if (id === "comments:deleted-owner") {
        return {
          _id: "comments:deleted-owner",
          softDeletedAt: undefined,
          skillId: "skills:active",
          userId: "users:deleted-owner",
        };
      }
      if (id === "skills:active") {
        return { _id: "skills:active", softDeletedAt: undefined, moderationStatus: "active" };
      }
      if (id === "users:deleted-owner") {
        return { _id: "users:deleted-owner", deletedAt: 1, deactivatedAt: undefined };
      }
      return null;
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const query = vi.fn((table: string) => {
      if (table !== "commentReports") throw new Error(`Unexpected table ${table}`);
      return {
        withIndex: (index: string) => {
          if (index === "by_comment_user") return { unique: vi.fn().mockResolvedValue(null) };
          if (index === "by_user") return { collect: vi.fn().mockResolvedValue(reports) };
          throw new Error(`Unexpected index ${index}`);
        },
      };
    });
    const ctx = { db: { get, insert, patch, query } } as never;

    const result = await reportHandler(ctx, {
      commentId: "comments:target2",
      reason: "still allowed",
    } as never);

    expect(result).toEqual({ ok: true, reported: true, alreadyReported: false });
    expect(insert).toHaveBeenCalledWith(
      "commentReports",
      expect.objectContaining({ commentId: "comments:target2", userId: "users:1" }),
    );
  });

  it("report rejects when active report limit is reached", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", role: "user" },
    } as never);

    const comment = {
      _id: "comments:target",
      skillId: "skills:1",
      userId: "users:2",
      softDeletedAt: undefined,
      reportCount: 0,
    };
    const reportedComment = {
      _id: "comments:reported",
      skillId: "skills:active",
      userId: "users:owner",
      softDeletedAt: undefined,
    };
    const reports = Array.from({ length: 20 }, (_, i) => ({
      _id: `commentReports:${i + 1}`,
      commentId: `comments:reported-${i + 1}`,
      userId: "users:1",
      skillId: "skills:active",
      createdAt: i + 1,
    }));

    const get = vi.fn(async (id: string) => {
      if (id === "comments:target") return comment;
      if (id === "skills:1") {
        return { _id: "skills:1", softDeletedAt: undefined, moderationStatus: "active" };
      }
      if (String(id).startsWith("comments:reported-")) return reportedComment;
      if (id === "skills:active") {
        return { _id: "skills:active", softDeletedAt: undefined, moderationStatus: "active" };
      }
      if (id === "users:owner") {
        return { _id: "users:owner", deletedAt: undefined, deactivatedAt: undefined };
      }
      return null;
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const query = vi.fn((table: string) => {
      if (table === "commentReports") {
        return {
          withIndex: (index: string) => {
            if (index === "by_comment_user") {
              return { unique: vi.fn().mockResolvedValue(null) };
            }
            if (index === "by_user") {
              return { collect: vi.fn().mockResolvedValue(reports) };
            }
            throw new Error(`Unexpected index ${index}`);
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const ctx = { db: { get, insert, patch, query } } as never;

    await expect(
      reportHandler(ctx, { commentId: "comments:target", reason: "abuse" } as never),
    ).rejects.toThrow("Report limit reached. Please wait for moderation before reporting more.");

    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("report auto-hides comment after fourth unique report", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_100);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:3",
      user: { _id: "users:3", role: "user" },
    } as never);

    const comment = {
      _id: "comments:4",
      skillId: "skills:9",
      userId: "users:2",
      softDeletedAt: undefined,
      reportCount: 3,
    };
    const get = vi.fn(async (id: string) => {
      if (id === "comments:4") return comment;
      if (id === "skills:9") {
        return { _id: "skills:9", softDeletedAt: undefined, moderationStatus: "active" };
      }
      return null;
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const query = vi.fn((table: string) => {
      if (table === "commentReports") {
        return {
          withIndex: (index: string) => {
            if (index === "by_comment_user") {
              return { unique: vi.fn().mockResolvedValue(null) };
            }
            if (index === "by_user") {
              return { collect: vi.fn().mockResolvedValue([]) };
            }
            throw new Error(`Unexpected index ${index}`);
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });
    const ctx = { db: { get, insert, patch, query } } as never;

    const result = await reportHandler(ctx, {
      commentId: "comments:4",
      reason: "  hate  ",
    } as never);

    expect(result).toEqual({ ok: true, reported: true, alreadyReported: false });
    expect(patch).toHaveBeenCalledWith("comments:4", {
      reportCount: 4,
      lastReportedAt: 1_700_000_000_100,
      softDeletedAt: 1_700_000_000_100,
    });
    expect(insertStatEvent).toHaveBeenCalledWith(ctx, {
      skillId: "skills:9",
      kind: "uncomment",
    });
    expect(insert).toHaveBeenCalledWith("auditLogs", {
      actorUserId: "users:3",
      action: "comment.auto_hide",
      targetType: "comment",
      targetId: "comments:4",
      metadata: { skillId: "skills:9", reportCount: 4 },
      createdAt: 1_700_000_000_100,
    });
  });
});
