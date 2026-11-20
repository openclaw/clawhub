import { vi } from "vitest";

export function setViewportWidth(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const minWidth = /\(min-width:\s*(\d+)px\)/.exec(query)?.[1];
    const maxWidth = /\(max-width:\s*(\d+)px\)/.exec(query)?.[1];
    const matches = minWidth
      ? width >= Number(minWidth)
      : maxWidth
        ? width <= Number(maxWidth)
        : false;

    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
}
