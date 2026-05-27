import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiKeyRequiredBadge } from "./ApiKeyRequiredBadge";

describe("ApiKeyRequiredBadge", () => {
  it("renders the badge when apiKeyRequired is true", () => {
    render(<ApiKeyRequiredBadge apiKeyRequired={true} />);
    const badge = screen.getByTestId("api-key-required-badge");
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain("API key required");
    expect(badge.getAttribute("title")).toBe(
      "This skill needs you to provide an API key (or equivalent secret) to run.",
    );
    expect(badge.getAttribute("aria-label")).toBe("API key required");
  });

  it("renders nothing when apiKeyRequired is false", () => {
    const { container } = render(<ApiKeyRequiredBadge apiKeyRequired={false} />);
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByTestId("api-key-required-badge")).toBeNull();
  });

  it("renders nothing when apiKeyRequired is undefined (not analyzed)", () => {
    const { container } = render(<ApiKeyRequiredBadge apiKeyRequired={undefined} />);
    expect(container.childElementCount).toBe(0);
    expect(screen.queryByTestId("api-key-required-badge")).toBeNull();
  });
});
