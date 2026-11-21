import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeE2ECodePluginFixture(
  packageDir: string,
  packageName: string,
  options: { description: string; readme: string; configSchema?: Record<string, unknown> },
) {
  await mkdir(join(packageDir, "dist"), { recursive: true });
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name: packageName,
        displayName: `E2E ${packageName}`,
        version: "1.0.0",
        description: options.description,
        type: "module",
        main: "./dist/index.js",
        openclaw: {
          extensions: ["./dist/index.js"],
          compat: { pluginApi: ">=2026.3.24-beta.2" },
          build: { openclawVersion: "2026.3.24-beta.2" },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(packageDir, "openclaw.plugin.json"),
    `${JSON.stringify(
      {
        id: `${packageName}.plugin`,
        name: `E2E ${packageName}`,
        ...(options.configSchema ? { configSchema: options.configSchema } : {}),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(
    join(packageDir, "dist", "index.js"),
    "export default function activate() { return { ok: true }; }\n",
    "utf8",
  );
  await writeFile(join(packageDir, "README.md"), options.readme, "utf8");
}
