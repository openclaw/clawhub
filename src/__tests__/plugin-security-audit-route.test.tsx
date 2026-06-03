/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginSecurityAuditPage } from "../routes/plugins/$name/security-audit";

const useQueryMock = vi.fn();
const useMutationMock = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (config: { component?: unknown; beforeLoad?: unknown; loader?: unknown; head?: unknown }) => ({
      __config: config,
      useParams: () => ({ name: "demo-plugin" }),
      useLoaderData: () => ({}),
    }),
  redirect: (options: unknown) => ({ redirect: options }),
}));

vi.mock("convex/react", () => ({
  useMutation: (...args: unknown[]) => useMutationMock(...args),
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));

function makeLoaderData() {
  return {
    detail: {
      package: {
        _id: "packages:1",
        name: "demo-plugin",
        displayName: "Demo Plugin",
      },
      owner: null,
    },
    version: {
      version: {
        _id: "packageReleases:1",
        version: "1.0.0",
      },
    },
    resolvedName: "demo-plugin",
    rateLimited: false,
  };
}

describe("plugin security audit route", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useQueryMock.mockReturnValue({
      package: { _id: "packages:1" },
      latestRelease: { _id: "packageReleases:1" },
    });
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue(vi.fn().mockResolvedValue({ ok: true }));
  });

  it("wires authorized plugin rescans to the package rescan mutation", async () => {
    const requestRescan = vi.fn().mockResolvedValue({ ok: true });
    useMutationMock.mockReturnValue(requestRescan);

    render(<PluginSecurityAuditPage name="demo-plugin" loaderData={makeLoaderData() as never} />);

    expect(screen.getByRole("button", { name: "Download security audit" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rescan" }));

    await waitFor(() =>
      expect(requestRescan).toHaveBeenCalledWith({
        packageId: "packages:1",
        version: "1.0.0",
      }),
    );
  });

  it("hides plugin rescans when manage settings are unavailable", () => {
    useQueryMock.mockReturnValue(null);

    render(<PluginSecurityAuditPage name="demo-plugin" loaderData={makeLoaderData() as never} />);

    expect(screen.queryByRole("button", { name: "Rescan" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download security audit" })).toBeNull();
  });
});
