import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SkillOwnershipPanel } from "./SkillOwnershipPanel";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("./PublisherNoteSettingsEditor", () => ({
  PublisherNoteSettingsEditor: () => null,
}));

vi.mock("./settings/SettingsActionRow", () => ({
  SettingsActionRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe("SkillOwnershipPanel", () => {
  it("includes the owner handle in the New Version link", () => {
    render(
      <SkillOwnershipPanel
        skillId={"skills:demo" as never}
        slug="my-skill"
        ownerHandle="clawkit"
        ownerId={"publishers:clawkit" as never}
        ownedSkills={[]}
        canDeleteSkill={false}
      />,
    );

    expect(screen.getByRole("link", { name: /new version/i }).getAttribute("href")).toBe(
      "/publish-skill?updateSlug=my-skill&ownerHandle=clawkit",
    );
  });
});
