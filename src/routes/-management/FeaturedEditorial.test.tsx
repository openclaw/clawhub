import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FeaturedEditorial } from "./FeaturedEditorial";
const { save, current } = vi.hoisted(() => ({ save: vi.fn(), current: { revision: 3 } }));
const editorial = [
  {
    id: "plugin:pending",
    name: "pending",
    displayName: "Pending workflow",
    reason: "Useful discovery",
  },
];
vi.mock("convex/react", () => ({
  useMutation: () => save,
  useQuery: () => ({
    artifactKind: "plugin",
    revision: current.revision,
    editorial,
    published: null,
    reservations: editorial.map((item) => ({
      ...item,
      currentArtifact: null,
      pendingReasons: ["not-in-public-catalog"],
    })),
  }),
}));
beforeEach(() => {
  save.mockReset();
  current.revision = 3;
});
it("shows pending reservations without links and saves editorial data without publishing", async () => {
  save.mockResolvedValue({ revision: 4 });
  render(<FeaturedEditorial artifactKind="plugin" reportRevision={3} />);
  expect(screen.queryByRole("link", { name: "Pending workflow" })).toBeNull();
  expect(screen.getByText(/not-in-public-catalog/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Edit editorial choices" }));
  fireEvent.change(screen.getByLabelText("Editorial reason"), {
    target: { value: "Revised editorial rationale" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save editorial choices" }));
  await screen.findByText(/Public Featured has not changed/);
  expect(save).toHaveBeenCalledExactlyOnceWith({
    expectedRevision: 3,
    items: [{ ...editorial[0], reason: "Revised editorial rationale" }],
  });
});
it("preserves the editor and visibly refuses a concurrent revision overwrite", async () => {
  const page = render(<FeaturedEditorial artifactKind="plugin" reportRevision={3} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit editorial choices" }));
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "My unsaved choice" },
  });
  current.revision = 4;
  page.rerender(<FeaturedEditorial artifactKind="plugin" reportRevision={3} />);
  expect((screen.getByLabelText("Display name") as HTMLInputElement).value).toBe(
    "My unsaved choice",
  );
  expect(
    (screen.getByRole("button", { name: "Save editorial choices" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    screen
      .getAllByRole("alert")
      .map((item) => item.textContent)
      .join(" "),
  ).toMatch(/saved choices are revision 4/);
  expect(save).not.toHaveBeenCalled();
});
it("retains a failed save for correction and makes the outcome visible", async () => {
  save.mockRejectedValue(new Error("Duplicate plugin identity"));
  render(<FeaturedEditorial artifactKind="plugin" />);
  fireEvent.click(screen.getByRole("button", { name: "Edit editorial choices" }));
  fireEvent.click(screen.getByRole("button", { name: "Save editorial choices" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Duplicate plugin identity"),
  );
  expect((screen.getByLabelText("Plugin name") as HTMLInputElement).value).toBe("pending");
});
