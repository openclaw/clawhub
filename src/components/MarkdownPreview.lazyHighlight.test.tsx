/* @vitest-environment jsdom */

import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview";

const { loadLanguages } = vi.hoisted(() => ({ loadLanguages: vi.fn() }));
vi.mock("shiki/dist/langs.mjs", async (original) => {
  loadLanguages();
  return original();
});

it("defers syntax grammars for prose and inline code until a block actually appears", async () => {
  const { container, rerender } = render(
    <MarkdownPreview>{"# Template\nUse `openclaw` to add it."}</MarkdownPreview>,
  );
  await vi.dynamicImportSettled();
  expect(loadLanguages).not.toHaveBeenCalled();

  rerender(<MarkdownPreview>{"~~~ts\nconst result: number = 1;\n~~~"}</MarkdownPreview>);
  await waitFor(() => expect(container.querySelector("pre.shiki")).not.toBeNull(), {
    timeout: 8000,
  });
  expect(loadLanguages).toHaveBeenCalledOnce();
});
