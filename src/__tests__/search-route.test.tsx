/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigateMock = vi.fn();
let searchMock: { q?: string; type?: "all" | "skills" | "plugins" | "users" } = {};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute:
    () =>
    (config: { component?: unknown; validateSearch?: unknown }) => ({
      __config: config,
      useSearch: () => searchMock,
    }),
  useNavigate: () => navigateMock,
}));

vi.mock("../lib/useUnifiedSearch", () => ({
  useUnifiedSearch: () => ({
    results: [],
    skillCount: 0,
    pluginCount: 0,
    userCount: 0,
    isSearching: false,
  }),
}));

vi.mock("../components/PluginListItem", () => ({
  PluginListItem: ({ item }: { item: { name: string } }) => <div>{item.name}</div>,
}));

vi.mock("../components/SkillListItem", () => ({
  SkillListItem: ({ skill }: { skill: { slug: string } }) => <div>{skill.slug}</div>,
}));

vi.mock("../components/UserListItem", () => ({
  UserListItem: ({ user }: { user: { _id: string } }) => <div>{user._id}</div>,
}));

vi.mock("../components/ui/card", () => ({
  Card: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

async function loadRoute() {
  return (await import("../routes/search")).Route as unknown as {
    __config: {
      component?: ComponentType;
    };
  };
}

describe("search route", () => {
  beforeEach(() => {
    searchMock = { q: "first" };
    navigateMock.mockReset();
  });

  it("keeps the input synced with query param changes while mounted", async () => {
    const route = await loadRoute();
    const Component = route.__config.component as ComponentType;
    const rendered = render(<Component />);

    const input = screen.getByPlaceholderText("Search skills, plugins, users...") as HTMLInputElement;
    expect(input.value).toBe("first");

    fireEvent.change(input, { target: { value: "draft" } });
    expect(input.value).toBe("draft");

    searchMock = { q: "second" };
    rendered.rerender(<Component />);

    expect(
      (screen.getByPlaceholderText("Search skills, plugins, users...") as HTMLInputElement).value,
    ).toBe("second");
  });
});
