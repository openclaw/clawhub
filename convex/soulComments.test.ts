/* @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/access", () => ({
  assertModerator: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("./lib/githubAccount", () => ({
  requireGitHubAccountAge: vi.fn(),
}));

const { requireUser } = await import("./lib/access");
const { requireGitHubAccountAge } = await import("./lib/githubAccount");
const { addHandler } = await import("./soulComments");

describe("soul comments mutations", () => {
  afterEach(() => {
    vi.mocked(requireUser).mockReset();
    vi.mocked(requireGitHubAccountAge).mockReset();
    vi.restoreAllMocks();
  });

  it("add enforces github account age and writes comment", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:1",
      user: { _id: "users:1", role: "user" },
    } as never);
    vi.mocked(requireGitHubAccountAge).mockResolvedValue(undefined as never);

    const get = vi.fn().mockResolvedValue({
      _id: "souls:1",
      stats: { comments: 3 },
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = { db: { get, insert, patch } } as never;

    await addHandler(ctx, { soulId: "souls:1", body: " hello soul " } as never);

    expect(requireGitHubAccountAge).toHaveBeenCalledWith(ctx, "users:1");
    expect(insert).toHaveBeenCalledWith("soulComments", {
      soulId: "souls:1",
      userId: "users:1",
      body: "hello soul",
      createdAt: 1_700_000_000_000,
      softDeletedAt: undefined,
      deletedBy: undefined,
    });
    expect(patch).toHaveBeenCalledWith("souls:1", {
      stats: { comments: 4 },
      updatedAt: 1_700_000_000_000,
    });
  });

  it("add rejects when github account age gate fails", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      userId: "users:new",
      user: { _id: "users:new", role: "user" },
    } as never);
    vi.mocked(requireGitHubAccountAge).mockRejectedValue(
      new Error(
        "GitHub account must be at least 14 days old to upload skills. Try again in 5 days.",
      ),
    );

    const get = vi.fn();
    const insert = vi.fn();
    const patch = vi.fn();
    const ctx = { db: { get, insert, patch } } as never;

    await expect(addHandler(ctx, { soulId: "souls:1", body: "hello" } as never)).rejects.toThrow(
      /at least 14 days old/i,
    );

    expect(get).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
