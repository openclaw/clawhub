import { describe, expect, it, vi } from "vitest";
import {
  fetchActiveGitHubOrgMemberships,
  readGitHubOrgMembershipSync,
} from "./githubOrgMemberships";

describe("GitHub organization memberships", () => {
  it("loads active memberships from the authenticated GitHub API", async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify([
          {
            state: "active",
            role: "member",
            organization: {
              id: 2,
              login: "trycua",
              avatar_url: "https://avatars.githubusercontent.com/u/2",
            },
          },
          {
            state: "active",
            role: "admin",
            organization: {
              id: 1,
              login: "openclaw",
              avatar_url: "https://avatars.githubusercontent.com/u/1",
            },
          },
          {
            state: "pending",
            role: "member",
            organization: { id: 3, login: "pending-org" },
          },
        ]),
        { status: 200 },
      );
    });

    const result = await fetchActiveGitHubOrgMemberships("github-token", {
      fetchImpl: fetchImpl as typeof fetch,
      now: 123,
    });

    expect(result).toEqual({
      syncedAt: 123,
      truncated: false,
      memberships: [
        {
          githubOrgId: "1",
          login: "openclaw",
          avatarUrl: "https://avatars.githubusercontent.com/u/1",
          role: "admin",
        },
        {
          githubOrgId: "2",
          login: "trycua",
          avatarUrl: "https://avatars.githubusercontent.com/u/2",
          role: "member",
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("/user/memberships/orgs?state=active"),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer github-token",
        }),
      }),
    );
  });

  it("rejects GitHub API failures without accepting partial membership data", async () => {
    const fetchImpl = vi.fn(async () => new Response("Forbidden", { status: 403 }));

    await expect(
      fetchActiveGitHubOrgMemberships("github-token", {
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toThrow("GitHub organization membership lookup failed (403)");
  });

  it("loads every GitHub organization membership page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      state: "active",
      role: "member",
      organization: { id: index + 1, login: `org-${index + 1}` },
    }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(firstPage), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              state: "active",
              role: "admin",
              organization: { id: 101, login: "org-101" },
            },
          ]),
          { status: 200 },
        ),
      );

    const result = await fetchActiveGitHubOrgMemberships("github-token", {
      fetchImpl: fetchImpl as typeof fetch,
      now: 123,
    });

    expect(result.memberships).toHaveLength(101);
    expect(result.truncated).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      expect.stringContaining("page=2"),
      expect.any(Object),
    );
  });

  it("validates membership snapshots before they reach the database", () => {
    expect(
      readGitHubOrgMembershipSync({
        githubOrgMembershipSync: {
          syncedAt: 123,
          truncated: false,
          memberships: [
            { githubOrgId: "1", login: "openclaw", role: "admin" },
            { githubOrgId: "invalid", login: "spoofed", role: "member" },
          ],
        },
      }),
    ).toEqual({
      syncedAt: 123,
      truncated: false,
      memberships: [{ githubOrgId: "1", login: "openclaw", role: "admin" }],
    });
  });
});
