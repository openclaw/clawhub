import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import ignore from "ignore";

export async function forEachPublishFile(
  root: string,
  options: { includeDotfiles: boolean; respectGitignore: boolean },
  onFile: (absPath: string, relPath: string) => Promise<void>,
) {
  const absRoot = resolve(root);
  const ig = ignore();
  ig.add([".git/", "node_modules/", ".clawhub/", ".clawdhub/"]);
  const ignoreFiles = [".clawhubignore", ".clawdhubignore"];
  if (options.respectGitignore) ignoreFiles.unshift(".gitignore");
  for (const name of ignoreFiles) {
    try {
      ig.add((await readFile(join(absRoot, name), "utf8")).split(/\r?\n/));
    } catch {
      // Ignore files are optional.
    }
  }

  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (
        entry.name === ".git" ||
        entry.name === "node_modules" ||
        (!options.includeDotfiles && entry.name.startsWith("."))
      ) {
        continue;
      }
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
      } else if (entry.isFile()) {
        const relPath = relative(absRoot, absPath)
          .split(sep)
          .join("/")
          .replace(/^\.\/+/, "");
        if (relPath && !ig.ignores(relPath)) await onFile(absPath, relPath);
      }
    }
  }

  await walk(absRoot);
}
