/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDashboardPackage } from "../../__tests__/helpers/dashboard";
import { CatalogRowMenu } from "./CatalogRowMenu";
import { mergeDashboardItems } from "./dashboardCatalog";

const mocks = vi.hoisted(() => ({ deletePackage: vi.fn(), success: vi.fn() }));
vi.mock("convex/react", () => ({ useMutation: () => mocks.deletePackage }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));

const item = mergeDashboardItems(
  [],
  [
    makeDashboardPackage({
      _id: "packages:hopper",
      name: "@owner/hopper",
      displayName: "Hopper",
      family: "template",
    }),
  ],
)[0]!;

async function openMenu(canManage = true) {
  render(<CatalogRowMenu item={item} ownerHandle="owner" canManage={canManage} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Open actions for Hopper" }), {
    key: "Enter",
  });
  return await screen.findByRole("menu");
}

async function openConfirmation() {
  await openMenu();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete template" }));
  await screen.findByRole("dialog", { name: "Delete Hopper?" });
}

describe("template catalog actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("links templates to their own page and supported publishing guide", async () => {
    await openMenu();
    expect(
      screen.getByRole("menuitem", { name: "View public page for Hopper" }).getAttribute("href"),
    ).toBe("/owner/templates/hopper");
    expect(
      screen
        .getByRole("menuitem", { name: "How to publish a new version of Hopper" })
        .getAttribute("href"),
    ).toBe("/docs/templates#validate-build-and-publish");
    expect(screen.getByRole("menuitem", { name: "Delete template" })).toBeTruthy();
  });

  it("does not offer deletion to publisher-only organization members", async () => {
    await openMenu(false);
    expect(screen.queryByRole("menuitem", { name: "Delete template" })).toBeNull();
  });

  it("confirms before deleting, focuses Cancel, and allows cancellation without a write", async () => {
    await openConfirmation();
    expect(mocks.deletePackage).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Open actions for Hopper" }),
      ),
    );
    expect(mocks.deletePackage).not.toHaveBeenCalled();
  });

  it("returns focus to the overflow trigger after Escape", async () => {
    await openConfirmation();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Open actions for Hopper" }),
      ),
    );
    expect(mocks.deletePackage).not.toHaveBeenCalled();
  });

  it("deletes the exact package once and disables controls while saving", async () => {
    let finish!: () => void;
    mocks.deletePackage.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    await openConfirmation();
    const button = screen.getByRole("button", { name: "Delete template" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.deletePackage).toHaveBeenCalledExactlyOnceWith({ packageId: "packages:hopper" });
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    finish();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.success).toHaveBeenCalledWith("Hopper deleted");
  });

  it("keeps the confirmation open and shows a server denial without reporting success", async () => {
    mocks.deletePackage.mockRejectedValueOnce(new Error("Forbidden"));
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Delete template" }));
    expect((await screen.findByRole("alert")).textContent).toContain("does not have permission");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.success).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
