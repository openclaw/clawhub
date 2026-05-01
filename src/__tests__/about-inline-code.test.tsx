/* @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithInlineCode } from "../routes/about";

function renderToContainer(text: string) {
  const { container } = render(<p>{renderWithInlineCode(text)}</p>);
  return container.querySelector("p")!;
}

describe("renderWithInlineCode", () => {
  it("returns plain text unchanged when no backticks present", () => {
    const el = renderToContainer("No code here.");
    expect(el.textContent).toBe("No code here.");
    expect(el.querySelectorAll("code")).toHaveLength(0);
  });

  it("wraps backtick-delimited text in <code> elements", () => {
    const el = renderToContainer("Run `curl | sh` to install.");
    const codes = el.querySelectorAll("code");
    expect(codes).toHaveLength(1);
    expect(codes[0].textContent).toBe("curl | sh");
    expect(codes[0].className).toBe("about-inline-code");
    expect(el.textContent).toBe("Run curl | sh to install.");
  });

  it("handles multiple code spans in a single string", () => {
    const el = renderToContainer("Use `curl | sh` or `npx @latest` for setup.");
    const codes = el.querySelectorAll("code");
    expect(codes).toHaveLength(2);
    expect(codes[0].textContent).toBe("curl | sh");
    expect(codes[1].textContent).toBe("npx @latest");
  });

  it("handles empty input string", () => {
    const el = renderToContainer("");
    expect(el.textContent).toBe("");
    expect(el.querySelectorAll("code")).toHaveLength(0);
  });

  it("handles string that is only a code span", () => {
    const el = renderToContainer("`only-code`");
    const codes = el.querySelectorAll("code");
    expect(codes).toHaveLength(1);
    expect(codes[0].textContent).toBe("only-code");
    expect(el.textContent).toBe("only-code");
  });
});
