import { readFile } from "node:fs/promises";
import { join } from "node:path";
import semver from "semver";

type PackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

async function readJson(path: string): Promise<PackageJson> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as PackageJson;
}

async function main() {
  const root = process.cwd();
  const rootPkgPath = join(root, "package.json");
  const authPkgPath = join(root, "node_modules", "@convex-dev", "auth", "package.json");
  const corePkgPath = join(root, "node_modules", "@auth", "core", "package.json");

  const rootPkg = await readJson(rootPkgPath);
  const authPkg = await readJson(authPkgPath);
  const corePkg = await readJson(corePkgPath);

  const peerRange = authPkg.peerDependencies?.["@auth/core"];
  const declaredRange = rootPkg.dependencies?.["@auth/core"];
  const installedVersion = corePkg.version;

  if (!peerRange) {
    throw new Error("Missing @auth/core peer range in @convex-dev/auth package.json");
  }
  if (!declaredRange) {
    throw new Error("Missing @auth/core dependency in root package.json");
  }
  if (!installedVersion) {
    throw new Error("Missing @auth/core version in node_modules");
  }

  if (!semver.intersects(declaredRange, peerRange, { includePrerelease: true })) {
    throw new Error(
      `@auth/core range mismatch: package.json declares "${declaredRange}" but @convex-dev/auth requires "${peerRange}"`,
    );
  }

  if (!semver.satisfies(installedVersion, peerRange, { includePrerelease: true })) {
    throw new Error(
      `@auth/core version mismatch: installed "${installedVersion}" does not satisfy @convex-dev/auth peer "${peerRange}"`,
    );
  }

  console.log(`peer ok: @auth/core ${installedVersion} satisfies @convex-dev/auth (${peerRange})`);
}

await main();
