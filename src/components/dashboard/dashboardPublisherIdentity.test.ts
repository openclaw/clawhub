import { describe, expect, it } from "vitest";
import {
  formatDashboardPublisherIdentity,
  formatDashboardPublisherRole,
  shouldShowDashboardPublisherRole,
} from "./dashboardPublisherIdentity";
import type { DashboardPublisherEntry } from "./types";

function entry(
  overrides: Partial<DashboardPublisherEntry> & {
    publisher: DashboardPublisherEntry["publisher"];
  },
): DashboardPublisherEntry {
  return {
    role: "owner",
    ...overrides,
  };
}

describe("formatDashboardPublisherIdentity", () => {
  it("shows only the handle when displayName matches handle", () => {
    expect(
      formatDashboardPublisherIdentity({
        _id: "publishers:a",
        handle: "local",
        displayName: "local",
        kind: "user",
      }),
    ).toEqual({ name: null, handle: "local" });
  });

  it("shows only the handle when displayName is an @handle alias", () => {
    expect(
      formatDashboardPublisherIdentity({
        _id: "publishers:a",
        handle: "local",
        displayName: "@local",
        kind: "user",
      }),
    ).toEqual({ name: null, handle: "local" });
  });

  it("keeps distinct display names and handles", () => {
    expect(
      formatDashboardPublisherIdentity({
        _id: "publishers:a",
        handle: "local",
        displayName: "Local Owner",
        kind: "user",
      }),
    ).toEqual({ name: "Local Owner", handle: "local" });
  });
});

describe("shouldShowDashboardPublisherRole", () => {
  it("hides owner role for personal publishers", () => {
    expect(
      shouldShowDashboardPublisherRole(
        entry({
          publisher: {
            _id: "publishers:a",
            handle: "local",
            displayName: "Local Owner",
            kind: "user",
          },
          role: "owner",
        }),
      ),
    ).toBe(false);
  });

  it("shows non-owner org roles", () => {
    expect(
      shouldShowDashboardPublisherRole(
        entry({
          publisher: {
            _id: "publishers:org",
            handle: "acme",
            displayName: "Acme",
            kind: "org",
          },
          role: "admin",
        }),
      ),
    ).toBe(true);
  });

  it("hides owner role for org owners", () => {
    expect(
      shouldShowDashboardPublisherRole(
        entry({
          publisher: {
            _id: "publishers:org",
            handle: "acme",
            displayName: "Acme",
            kind: "org",
          },
          role: "owner",
        }),
      ),
    ).toBe(false);
  });
});

describe("formatDashboardPublisherRole", () => {
  it("formats org membership labels", () => {
    expect(formatDashboardPublisherRole("admin")).toBe("Admin");
    expect(formatDashboardPublisherRole("publisher")).toBe("Publisher");
  });
});
