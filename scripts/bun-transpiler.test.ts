/* @vitest-environment node */
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("keeps labelled conditionals parseable when transpiling server code", () => {
  // React's Bun server renderer uses this shape. Eliding the outer braces binds
  // the else to the inner if and leaves two active labels with the same name.
  const probe = `
    const source = "function f(x,y,z){if(x){a:if(y){break a}}else a:if(z){break a}}";
    const output = new Bun.Transpiler({ loader: "js", target: "bun" }).transformSync(source);
    new Function(output);
  `;
  const result = spawnSync("bun", ["-e", probe], { encoding: "utf8" });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
