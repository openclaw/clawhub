import { describe, expect, it } from "vitest";
import {
  ALLOWED_LUCIDE_ICON_NAMES,
  ALLOWED_LUCIDE_ICONS,
  makeLucideIconValue,
  parseSkillIcon,
} from "./skillIcon";

describe("ALLOWED_LUCIDE_ICONS", () => {
  it("exposes a non-empty allow-list with React component values", () => {
    expect(ALLOWED_LUCIDE_ICON_NAMES.length).toBeGreaterThan(0);
    for (const name of ALLOWED_LUCIDE_ICON_NAMES) {
      const component = ALLOWED_LUCIDE_ICONS[name];
      expect(component).toBeTruthy();
      // lucide-react components are forwardRef objects in the bundled build,
      // so we accept either a function or an object reference here.
      expect(["function", "object"]).toContain(typeof component);
    }
  });

  it("includes the Plug icon used as the canonical example", () => {
    expect(ALLOWED_LUCIDE_ICONS.Plug).toBeTruthy();
    expect(ALLOWED_LUCIDE_ICON_NAMES).toContain("Plug");
  });
});

describe("parseSkillIcon", () => {
  it("returns null for null/undefined/empty input", () => {
    expect(parseSkillIcon(null)).toBeNull();
    expect(parseSkillIcon(undefined)).toBeNull();
    expect(parseSkillIcon("")).toBeNull();
  });

  it("returns null when the protocol is missing or malformed", () => {
    expect(parseSkillIcon("Plug")).toBeNull();
    expect(parseSkillIcon(":Plug")).toBeNull();
    expect(parseSkillIcon("lucide:")).toBeNull();
  });

  it("resolves lucide icons inside the allow-list", () => {
    const parsed = parseSkillIcon("lucide:Plug");
    expect(parsed?.kind).toBe("lucide");
    if (parsed?.kind === "lucide") {
      expect(parsed.name).toBe("Plug");
      expect(parsed.component).toBe(ALLOWED_LUCIDE_ICONS.Plug);
    }
  });

  it("returns null for lucide names not in the allow-list", () => {
    expect(parseSkillIcon("lucide:DefinitelyNotARealIcon")).toBeNull();
  });

  it("does not resolve prototype keys like `toString` or `constructor`", () => {
    // Bracket-access on a plain object would otherwise yield
    // `Object.prototype.toString`, which is truthy and would be handed to
    // the renderer as if it were a React component.
    expect(parseSkillIcon("lucide:toString")).toBeNull();
    expect(parseSkillIcon("lucide:constructor")).toBeNull();
    expect(parseSkillIcon("lucide:hasOwnProperty")).toBeNull();
  });

  it("normalizes the protocol to lower-case", () => {
    expect(parseSkillIcon("LUCIDE:Plug")?.kind).toBe("lucide");
  });

  it("recognizes the url protocol as a future-proofed kind", () => {
    const parsed = parseSkillIcon("url:https://example.com/icon.png");
    expect(parsed).toEqual({ kind: "url", url: "https://example.com/icon.png" });
  });

  it("recognizes the storage protocol as a future-proofed kind", () => {
    const parsed = parseSkillIcon("storage:abc123");
    expect(parsed).toEqual({ kind: "storage", storageId: "abc123" });
  });

  it("returns null for unknown protocols", () => {
    expect(parseSkillIcon("emoji:🦾")).toBeNull();
  });
});

describe("makeLucideIconValue", () => {
  it("packs an allow-listed name into a `lucide:<Name>` string", () => {
    expect(makeLucideIconValue("Plug")).toBe("lucide:Plug");
    expect(makeLucideIconValue("Code2")).toBe("lucide:Code2");
  });

  it("round-trips through parseSkillIcon for every allow-listed name", () => {
    for (const name of ALLOWED_LUCIDE_ICON_NAMES) {
      const value = makeLucideIconValue(name);
      const parsed = parseSkillIcon(value);
      expect(parsed?.kind).toBe("lucide");
      if (parsed?.kind === "lucide") {
        expect(parsed.name).toBe(name);
      }
    }
  });
});
