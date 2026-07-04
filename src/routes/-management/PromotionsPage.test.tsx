import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromotionsPage } from "./PromotionsPage";

function makePromotion(overrides: Record<string, unknown> = {}) {
  return {
    _id: "promotions:1",
    _creationTime: 1,
    slug: "example-models-launch",
    title: "Free Example models",
    blurb: "A limited-time free model offer from Example.",
    status: "draft",
    startsAt: new Date(2026, 6, 4, 12, 34, 56, 789).getTime(),
    endsAt: new Date(2026, 6, 5, 13, 45, 12, 345).getTime(),
    models: [{ modelRef: "example-provider/example/model-alpha" }],
    createdByUserId: "users:admin",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as never;
}

describe("PromotionsPage", () => {
  it("preserves timestamp precision when editing a promotion", () => {
    render(
      <PromotionsPage
        promotions={[makePromotion()]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onSetStatus={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const startsInput = screen.getByLabelText("Starts *") as HTMLInputElement;
    const endsInput = screen.getByLabelText("Ends *") as HTMLInputElement;
    expect(startsInput.value).toBe("2026-07-04T12:34:56.789");
    expect(endsInput.value).toBe("2026-07-05T13:45:12.345");
    expect(startsInput.step).toBe("0.001");
    expect(endsInput.step).toBe("0.001");
  });

  it("round-trips escaped model delimiters without corrupting aliases", async () => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(
      <PromotionsPage
        promotions={[
          makePromotion({
            models: [
              {
                modelRef: String.raw`example-provider/example\model|alpha`,
                alias: "Turbo | Pro",
              },
            ],
          }),
        ]}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onSetStatus={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect((screen.getByLabelText("Models *") as HTMLTextAreaElement).value).toBe(
      String.raw`example-provider/example\\model\|alpha | Turbo \| Pro`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        "example-models-launch",
        expect.objectContaining({
          models: [
            {
              modelRef: String.raw`example-provider/example\model|alpha`,
              alias: "Turbo | Pro",
            },
          ],
        }),
      ),
    );
  });

  it("loads additional permanent history pages", () => {
    const onLoadMore = vi.fn();
    render(
      <PromotionsPage
        promotions={[makePromotion()]}
        pageStatus="CanLoadMore"
        onCreate={vi.fn()}
        onLoadMore={onLoadMore}
        onUpdate={vi.fn()}
        onSetStatus={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
