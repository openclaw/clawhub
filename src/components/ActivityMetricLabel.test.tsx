/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityMetricLabel } from "./ActivityMetricLabel";

describe("ActivityMetricLabel", () => {
  it("renders activity labels without the downloads warning tooltip", () => {
    render(<ActivityMetricLabel label="Downloads" />);

    expect(screen.getByText("Downloads")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "About activity counts" })).toBeNull();
    expect(screen.queryByText(/Download counts can be inflated/i)).toBeNull();
  });
});
