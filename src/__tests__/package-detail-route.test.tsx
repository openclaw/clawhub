/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let paramsMock = { name: "demo-plugin" };
let loaderDataMock = {
  detail: {
    package: {
      name: "demo-plugin",
      displayName: "Demo Plugin",
      family: "code-plugin" as const,
      channel: "community" as const,
      isOfficial: false,
      summary: "Demo summary",
      latestVersion: null,
      createdAt: 1,
      updatedAt: 1,
      tags: {},
      compatibility: null,
      capabilities: { executesCode: true, capabilityTags: ["tools"] },
      verification: null,
    },
    owner: null,
  },
  version: null,
  readme: null as string | null,
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { loader?: unknown; head?: unknown; component?: unknown }) => ({
    __config: config,
    useParams: () => paramsMock,
    useLoaderData: () => loaderDataMock,
  }),
}));

vi.mock("../lib/packageApi", () => ({
  fetchPackageDetail: vi.fn(),
  fetchPackageReadme: vi.fn(),
  fetchPackageVersion: vi.fn(),
  getPackageDownloadPath: vi.fn((name: string, version?: string | null) =>
    version
      ? `/api/v1/packages/${name}/download?version=${version}`
      : `/api/v1/packages/${name}/download`,
  ),
}));

async function loadRoute() {
  return (await import("../routes/packages/$name")).Route as unknown as {
    __config: {
      component?: ComponentType;
    };
  };
}

describe("package detail route", () => {
  beforeEach(() => {
    paramsMock = { name: "demo-plugin" };
    loaderDataMock = {
      detail: {
        package: {
          name: "demo-plugin",
          displayName: "Demo Plugin",
          family: "code-plugin",
          channel: "community",
          isOfficial: false,
          summary: "Demo summary",
          latestVersion: null,
          createdAt: 1,
          updatedAt: 1,
          tags: {},
          compatibility: null,
          capabilities: { executesCode: true, capabilityTags: ["tools"] },
          verification: null,
        },
        owner: null,
      },
      version: null,
      readme: null,
    };
  });

  it("hides download actions when the package has no latest release", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;

    render(<Component />);

    expect(screen.getByText("No latest tag")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Download zip" })).toBeNull();
  });
});
