import { createHash } from "node:crypto";
import { posix } from "node:path";

// Accept the complete standard grant, conditions and disclaimer. A label or
// partial grant is not evidence of permission for the bytes being imported.
const MIT_BODY = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const isLicense = (path: string) =>
  /^(?:licen[cs]e|copying)(?:[._-].*)?$/i.test(posix.basename(path));
const inTree = (file: string, root: string) => !root || file.startsWith(`${root}/`);
function isMit(text: string) {
  const start = text.indexOf("Permission is hereby granted");
  if (start < 0 || normalize(text.slice(start)) !== normalize(MIT_BODY)) return false;
  const prefix = text
    .slice(0, start)
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim());
  return (
    prefix.some((line) => /^copyright\b/i.test(line)) &&
    prefix.every((line) =>
      /^(?:MIT License|The MIT License(?: \(MIT\))?|Copyright\b.*)$/i.test(line.trim()),
    )
  );
}
export function inspectLicense(files: Record<string, string>, root: string) {
  const closure = Object.keys(files).filter((path) => inTree(path, root));
  const relevant = Object.entries(files).filter(
    ([path]) =>
      isLicense(path) &&
      (inTree(path, root) ||
        inTree(`${root}/_`, posix.dirname(path) === "." ? "" : posix.dirname(path))),
  );
  const directory = (path: string) => (posix.dirname(path) === "." ? "" : posix.dirname(path));
  const applicable = (file: string) => {
    const ancestors = relevant.filter(([path]) => inTree(file, directory(path)));
    const depth = Math.max(-1, ...ancestors.map(([path]) => directory(path).length));
    return ancestors.filter(([path]) => directory(path).length === depth);
  };
  const used = new Set(closure.flatMap((file) => applicable(file).map(([path]) => path)));
  const evidence = relevant.filter(([path]) => used.has(path));
  const reasons: string[] = [];
  for (const [path, text] of evidence)
    if (!isMit(text)) reasons.push(`Non-standard or non-MIT license: ${path}`);
  for (const file of closure) {
    if (isLicense(file)) continue;
    const grants = applicable(file);
    const licensed = grants.length > 0 && grants.every(([, text]) => isMit(text));
    if (!licensed) reasons.push(`No applicable MIT license: ${file}`);
    const declarations = [...files[file].matchAll(/SPDX-License-Identifier:[ \t]*([^\r\n*]+)/gi)];
    if (declarations.some((match) => match[1].trim() !== "MIT"))
      reasons.push(`Conflicting SPDX license: ${file}`);
  }
  if (!closure.length) reasons.push("Source subtree is empty");
  const notices = Object.keys(files).filter(
    (path) =>
      /^(?:notice|copyright)(?:[._-].*)?$/i.test(posix.basename(path)) &&
      (inTree(path, root) ||
        inTree(`${root}/_`, posix.dirname(path) === "." ? "" : posix.dirname(path))),
  );
  return {
    status: reasons.length ? ("blocked" as const) : ("eligible" as const),
    reasons,
    files: evidence.map(([path, text]) => ({
      path,
      sha256: createHash("sha256").update(text).digest("hex"),
      text,
    })),
    notices,
  };
}
