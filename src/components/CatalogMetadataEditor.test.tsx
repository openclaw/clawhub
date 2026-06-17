/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CatalogMetadataEditor } from "./CatalogMetadataEditor";

describe("CatalogMetadataEditor", () => {
  it("saves exact category slugs and parsed author topics", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <CatalogMetadataEditor
        kind="skill"
        categories={["development"]}
        topics={["GPU development"]}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Research" }));
    fireEvent.change(screen.getByLabelText("Topics"), {
      target: { value: "GPU development, CUDA" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: ["development", "research"],
        topics: ["GPU development", "CUDA"],
      }),
    );
  });

  it("preserves automatic categories when saving topics", async () => {
    const onSave = vi.fn(async () => {});
    render(<CatalogMetadataEditor kind="skill" topics={["Calendar"]} onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Topics"), {
      target: { value: "Calendar, Scheduling" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: undefined,
        topics: ["Calendar", "Scheduling"],
      }),
    );
  });

  it("drops retired initial categories when saving topic edits", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <CatalogMetadataEditor
        kind="skill"
        categories={["retired-category"]}
        topics={["Calendar"]}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Topics"), {
      target: { value: "Calendar, Scheduling" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: undefined,
        topics: ["Calendar", "Scheduling"],
      }),
    );
  });

  it("replaces Other when a specific category is selected", async () => {
    const onSave = vi.fn(async () => {});
    render(<CatalogMetadataEditor kind="skill" categories={["other"]} onSave={onSave} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Research" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: ["research"],
        topics: [],
      }),
    );
  });

  it("replaces specific categories when Other is selected", async () => {
    const onSave = vi.fn(async () => {});
    render(<CatalogMetadataEditor kind="skill" categories={["development"]} onSave={onSave} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Other" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: ["other"],
        topics: [],
      }),
    );
  });

  it("preserves unsaved edits when initial arrays are recreated with the same values", () => {
    const onSave = vi.fn(async () => {});
    const { rerender } = render(
      <CatalogMetadataEditor
        kind="skill"
        categories={["development"]}
        topics={["GPU development"]}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Research" }));
    fireEvent.change(screen.getByLabelText("Topics"), {
      target: { value: "GPU development, CUDA" },
    });

    rerender(
      <CatalogMetadataEditor
        kind="skill"
        categories={["development"]}
        topics={["GPU development"]}
        onSave={onSave}
      />,
    );

    expect((screen.getByRole("checkbox", { name: "Research" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByLabelText("Topics") as HTMLInputElement).value).toBe(
      "GPU development, CUDA",
    );
  });
});
