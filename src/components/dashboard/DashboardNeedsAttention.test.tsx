/* @vitest-environment jsdom */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { makeDashboardPackage } from "../../__tests__/helpers/dashboard";
import { collectAttentionItems } from "./dashboardAttention";
import { DashboardNeedsAttention } from "./DashboardNeedsAttention";

vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

describe("template attention presentation", () => {
  it.each(["malicious", "suspicious", "pending"] as const)(
    "identifies %s templates in the strip and review sheet",
    (scanStatus) => {
      const items = collectAttentionItems(
        [],
        [
          makeDashboardPackage({
            family: "template",
            name: "@owner/hopper",
            displayName: "Hopper",
            scanStatus,
            latestRelease: { version: "0.1.0", createdAt: 1, llmStatus: scanStatus },
          }),
        ],
        "owner",
      );
      render(<DashboardNeedsAttention items={items} />);
      const strip = screen.getByRole("region", { name: "Needs attention" });
      expect(within(strip).getByText("Template")).toBeTruthy();
      expect(within(strip).queryByText("Plugin")).toBeNull();
      fireEvent.click(within(strip).getByRole("button"));
      const review = screen.getByRole("dialog", { name: "Hopper review" });
      expect(within(review).getByText("Template")).toBeTruthy();
      expect(within(review).queryByText("Plugin")).toBeNull();
    },
  );
});
