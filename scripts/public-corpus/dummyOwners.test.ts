import { describe, expect, it } from "vitest";
import { buildDummyOwnerPool, ownerForCorpusKey } from "./dummyOwners";

describe("public corpus dummy owners", () => {
  it("generates deterministic dummy local accounts", () => {
    expect(buildDummyOwnerPool(3)).toEqual([
      {
        handle: "local-corpus-elody-pfeffer",
        displayName: "Elody Pfeffer",
        image: expect.stringContaining("api.dicebear.com"),
      },
      {
        handle: "local-corpus-arch-marvin",
        displayName: "Arch Marvin",
        image: expect.stringContaining("api.dicebear.com"),
      },
      {
        handle: "local-corpus-clinton-rowe",
        displayName: "Clinton Rowe",
        image: expect.stringContaining("api.dicebear.com"),
      },
    ]);
  });

  it("maps the same corpus key to the same dummy account", () => {
    const pool = buildDummyOwnerPool(8);

    expect(ownerForCorpusKey("skill:demo-skill", pool)).toEqual(
      ownerForCorpusKey("skill:demo-skill", pool),
    );
    expect(ownerForCorpusKey("plugin:@demo/plugin", pool).handle).toMatch(/^local-corpus-/);
  });
});
