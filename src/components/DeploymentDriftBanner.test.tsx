/* @vitest-environment jsdom */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeploymentDriftBanner } from "./DeploymentDriftBanner";

const useQueriesMock = vi.fn();

vi.mock("convex/react", () => ({
  useQueries: (...args: unknown[]) => useQueriesMock(...args),
}));

function withMetaEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const env = import.meta.env as unknown as Record<string, unknown>;
  const previous = new Map<string, unknown>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, env[key]);
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  try {
    return run();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
}

afterEach(() => {
  useQueriesMock.mockReset();
  vi.restoreAllMocks();
});

describe("DeploymentDriftBanner", () => {
  it("swallows unexpected banner crashes instead of taking down the app shell", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    useQueriesMock.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(() => render(<DeploymentDriftBanner />)).not.toThrow();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(consoleError).toHaveBeenCalled();
  });

  it("does not throw when the backend query is unavailable", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    useQueriesMock.mockReturnValue({
      deploymentInfo: new Error("Could not find function for 'appMeta:getDeploymentInfo'"),
    });

    expect(() => render(<DeploymentDriftBanner />)).not.toThrow();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith("Deployment drift check unavailable", expect.any(Error));
  });

  it("renders drift warning when backend and frontend SHAs differ", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    useQueriesMock.mockReturnValue({
      deploymentInfo: {
        appBuildSha: "backend-sha",
        deployedAt: "2026-03-09T00:00:00Z",
      },
    });

    withMetaEnv({ VITE_APP_BUILD_SHA: "frontend-sha" }, () => {
      render(<DeploymentDriftBanner />);
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("frontend-sha");
    expect(alert.textContent).toContain("backend-sha");
  });
});
