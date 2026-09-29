import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InlineMarkdownSummary } from "./InlineMarkdownSummary";

describe("header summary formatting", () => {
  it("renders Markdown links and emphasis alongside inline code", () => {
    const { container } = render(
      <p>
        <InlineMarkdownSummary>
          {
            "Connect to [X Money](https://x.com/i/money) with **bold**, *italic*, ~~old~~, and `mcp`."
          }
        </InlineMarkdownSummary>
      </p>,
    );
    expect(screen.getByRole("link", { name: "X Money" }).getAttribute("href")).toBe(
      "https://x.com/i/money",
    );
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("del")?.textContent).toBe("old");
    expect(container.querySelector("code")?.textContent).toBe("mcp");
    expect(container.querySelector("p p")).toBeNull();
  });
  it("autolinks URLs while treating code and unmatched syntax literally", () => {
    const { container } = render(
      <InlineMarkdownSummary>
        {"Visit https://example.com or use `[literal](https://example.org)`. Broken `quote"}
      </InlineMarkdownSummary>,
    );
    expect(screen.getByRole("link").getAttribute("href")).toBe("https://example.com");
    expect(container.querySelector("code")?.textContent).toBe("[literal](https://example.org)");
    expect(container.textContent).toContain("Broken `quote");
  });

  it("keeps unsafe URLs, HTML, images, and block layout out of summaries", () => {
    const { container } = render(
      <p>
        <InlineMarkdownSummary>
          {
            "# Heading\n\n[unsafe](javascript:alert) ![image](https://example.com/image.png) <img src=x onerror=alert(1)> <script>alert(1)</script> **Safe**"
          }
        </InlineMarkdownSummary>
      </p>,
    );
    expect(container.querySelector("a")?.getAttribute("href")).toBe("");
    expect(container.querySelector("img, script, h1, p p")).toBeNull();
    expect(container.querySelector("strong")?.textContent).toBe("Safe");
    expect(container.textContent).toContain("Heading");
  });
});
