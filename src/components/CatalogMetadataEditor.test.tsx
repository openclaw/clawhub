/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CatalogMetadataEditor } from "./CatalogMetadataEditor";
import { formatCatalogTopicsInput, parseCatalogTopicsInput } from "./CatalogMetadataFields";

function selectCategory(name: string) {
  const trigger = screen.getByRole("button", { name: "Categories" });
  if (trigger.getAttribute("aria-expanded") !== "true") {
    fireEvent.pointerDown(trigger, { button: 0 });
  }
  fireEvent.click(screen.getByRole("menuitemcheckbox", { name }));
}

function closeCategoryMenu() {
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
}

describe("CatalogMetadataEditor", () => {
  it("round-trips topic labels containing commas and quotes", () => {
    const topics = ["CI, CD", 'He said "ship"', "Calendar"];

    expect(parseCatalogTopicsInput(formatCatalogTopicsInput(topics))).toEqual(topics);
  });

  it("shows live category and topic counts in the save summary", () => {
    const onSave = vi.fn(async () => {});
    render(
      <CatalogMetadataEditor
        kind="skill"
        categories={["development"]}
        topics={["email", "expedia"]}
        onSave={onSave}
      />,
    );

    expect(screen.getByText("1 category")).toBeTruthy();
    expect(screen.getByText("2 topics")).toBeTruthy();

    selectCategory("Research");
    closeCategoryMenu();
    const topicsInput = screen.getByLabelText("Topics");
    fireEvent.change(topicsInput, { target: { value: "travel" } });
    fireEvent.keyDown(topicsInput, { key: "Enter" });

    expect(screen.getByText("2 categories")).toBeTruthy();
    expect(screen.getByText("3 topics")).toBeTruthy();
  });

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

    selectCategory("Research");
    closeCategoryMenu();
    const topicsInput = screen.getByLabelText("Topics");
    fireEvent.change(topicsInput, { target: { value: "CUDA" } });
    fireEvent.keyDown(topicsInput, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: ["development", "research"],
        topics: ["GPU development", "cuda"],
      }),
    );
  });

  it("applies generated categories only after an explicit button click", async () => {
    const onSave = vi.fn(async () => {});
    render(
      <CatalogMetadataEditor kind="skill" suggestedCategories={["lifestyle"]} onSave={onSave} />,
    );

    expect(screen.getByRole("button", { name: "Categories" }).textContent).toContain(
      "Choose categories",
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate categories" }));
    expect(screen.getByRole("button", { name: "Categories" }).textContent).toContain("Lifestyle");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: ["lifestyle"],
        topics: [],
      }),
    );
  });

  it("uses Other when saving topics without selected categories", async () => {
    const onSave = vi.fn(async () => {});
    render(<CatalogMetadataEditor kind="skill" topics={["Calendar"]} onSave={onSave} />);

    const topicsInput = screen.getByLabelText("Topics");
    fireEvent.change(topicsInput, { target: { value: "Scheduling" } });
    fireEvent.keyDown(topicsInput, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: ["other"],
        topics: ["Calendar", "scheduling"],
      }),
    );
  });

  it("auto-hyphenates a new multi-word topic before saving", async () => {
    const onSave = vi.fn(async () => {});
    render(<CatalogMetadataEditor kind="skill" onSave={onSave} />);

    const topicsInput = screen.getByLabelText("Topics");
    fireEvent.change(topicsInput, { target: { value: "session management" } });
    fireEvent.keyDown(topicsInput, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: ["other"],
        topics: ["session-management"],
      }),
    );
  });

  it("commits a topic draft before saving", async () => {
    const onSave = vi.fn(async () => {});
    render(<CatalogMetadataEditor kind="skill" topics={["Calendar"]} onSave={onSave} />);

    const topicsInput = screen.getByLabelText("Topics");
    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.change(topicsInput, {
      target: { value: "Scheduling" },
    });
    fireEvent.blur(topicsInput, { relatedTarget: saveButton });
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: ["other"],
        topics: ["Calendar", "scheduling"],
      }),
    );
  });

  it("preserves a single topic label containing a comma when saving categories", async () => {
    const onSave = vi.fn(async () => {});
    render(<CatalogMetadataEditor kind="skill" topics={["CI, CD"]} onSave={onSave} />);

    selectCategory("Research");
    closeCategoryMenu();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: ["research"],
        topics: ["CI, CD"],
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

    const topicsInput = screen.getByLabelText("Topics");
    fireEvent.change(topicsInput, { target: { value: "Scheduling" } });
    fireEvent.keyDown(topicsInput, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        categories: ["other"],
        topics: ["Calendar", "scheduling"],
      }),
    );
  });

  it("replaces Other when a specific category is selected", async () => {
    const onSave = vi.fn(async () => {});
    render(<CatalogMetadataEditor kind="skill" categories={["other"]} onSave={onSave} />);

    selectCategory("Research");
    closeCategoryMenu();
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

    selectCategory("Other");
    closeCategoryMenu();
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

    selectCategory("Research");
    closeCategoryMenu();
    const topicsInput = screen.getByLabelText("Topics");
    fireEvent.change(topicsInput, { target: { value: "CUDA" } });
    fireEvent.keyDown(topicsInput, { key: "Enter" });

    rerender(
      <CatalogMetadataEditor
        kind="skill"
        categories={["development"]}
        topics={["GPU development"]}
        onSave={onSave}
      />,
    );

    expect(screen.getByRole("button", { name: "Categories" }).textContent).toContain(
      "Research, Development",
    );
    expect(screen.getByText("#gpu development")).toBeTruthy();
    expect(screen.getByText("#cuda")).toBeTruthy();
  });

  it("preserves edits when saving fails", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("Save failed");
    });
    render(
      <CatalogMetadataEditor
        kind="skill"
        categories={["development"]}
        topics={["GPU development"]}
        onSave={onSave}
      />,
    );

    selectCategory("Research");
    closeCategoryMenu();
    const topicsInput = screen.getByLabelText("Topics");
    fireEvent.change(topicsInput, { target: { value: "CUDA" } });
    fireEvent.keyDown(topicsInput, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Save failed");
    expect(screen.getByRole("button", { name: "Categories" }).textContent).toContain(
      "Research, Development",
    );
    expect(screen.getByText("#gpu development")).toBeTruthy();
    expect(screen.getByText("#cuda")).toBeTruthy();
  });
});
