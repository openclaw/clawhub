/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OpenClawInstall } from "./OpenClawInstall";

afterEach(cleanup);

describe("OpenClawInstall", () => {
  it.each(["plugins", "skills", "templates"] as const)(
    "encodes only the exact %s identity",
    (family) => {
      const name = "@owner/scoped-name &action=install#review?x=1+2";
      render(<OpenClawInstall family={family} name={name} />);
      const link = screen.getByRole("link", { name: "Install in OpenClaw" });
      const url = new URL(link.getAttribute("href")!);
      expect(url.protocol).toBe("openclaw:");
      expect(url.host).toBe(family);
      expect(url.pathname).toBe("/install");
      expect([...url.searchParams]).toEqual([["name", name]]);
      expect(url.hash).toBe("");
      expect(link.textContent).toBe("Install in OpenClaw");
      expect(link.querySelector("svg")).toBeNull();
      expect(screen.queryByText(/Mac|Review|OpenClaw for/)).toBeNull();
    },
  );
});
