import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromotionsPage } from "./PromotionsPage";

describe("PromotionsPage", () => {
  it("preserves timestamp precision when editing a promotion", () => {
    const startsAt = new Date(2026, 6, 4, 12, 34, 56, 789).getTime();
    const endsAt = new Date(2026, 6, 5, 13, 45, 12, 345).getTime();

    render(
      <PromotionsPage
        promotions={[
          {
            _id: "promotions:1",
            _creationTime: 1,
            slug: "example-models-launch",
            title: "Free Example models",
            blurb: "A limited-time free model offer from Example.",
            status: "draft",
            startsAt,
            endsAt,
            models: [{ modelRef: "example-provider/example/model-alpha" }],
            createdByUserId: "users:admin",
            createdAt: 1,
            updatedAt: 1,
          } as never,
        ]}
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
});
