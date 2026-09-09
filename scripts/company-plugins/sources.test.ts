// @vitest-environment node
import { zipSync } from "fflate";
import { expect, it } from "vitest";
import { fetchSnapshot } from "./sources";
it("preserves prototype-named upstream files in the inspected content and hashes", async () => {
  const sha = "a".repeat(40);
  const archive = zipSync({
    "repo-sha/__proto__": new TextEncoder().encode("SPDX-License-Identifier: GPL-3.0-only"),
  });
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("codeload.github.com")) return new Response(archive);
    if (url.includes("/commits/"))
      return Response.json({ sha, commit: { committer: { date: "2026-09-01T00:00:00Z" } } });
    return Response.json({
      id: 1,
      owner: { id: 2 },
      full_name: "company/plugins",
      private: false,
      disabled: false,
    });
  }) as typeof fetch;
  const snapshot = await fetchSnapshot("company/plugins", "main", fetcher);
  expect(Object.hasOwn(snapshot.files, "__proto__")).toBe(true);
  expect(snapshot.files.__proto__).toContain("GPL-3.0-only");
  expect(snapshot.fileHashes?.__proto__).toMatch(/^[a-f0-9]{64}$/);
  expect(snapshot.fileSizes?.__proto__).toBe(37);
});
