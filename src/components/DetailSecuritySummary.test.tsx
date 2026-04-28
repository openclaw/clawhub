/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DetailSecuritySummary } from "./DetailSecuritySummary";

describe("DetailSecuritySummary", () => {
  it("shows a disabled spinner button while a rescan is in progress", () => {
    render(
      <DetailSecuritySummary
        scannerBasePath="/steipete/weather/security"
        rescanState={{
          maxRequests: 3,
          requestCount: 1,
          remainingRequests: 2,
          canRequest: false,
          inProgressRequest: {
            _id: "rescanRequests:1",
            targetKind: "skill",
            targetVersion: "1.0.0",
            status: "in_progress",
            createdAt: 1,
            updatedAt: 1,
          },
          latestRequest: null,
        }}
        onRequestRescan={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Scanning" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("A rescan is already in progress.");
    expect(button.querySelector(".animate-spin")?.className).toContain(
      "[animation-duration:2.4s]",
    );
  });
});
