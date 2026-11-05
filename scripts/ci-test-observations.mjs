import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const MAX_BYTES = 8 * 1024 * 1024;

function repositoryPath(root, path) {
  const value = isAbsolute(path) ? relative(root, path) : path;
  return value &&
    !value.includes("\\") &&
    !/[\0\r\n]/u.test(value) &&
    value.split("/").every((part) => part && part !== "." && part !== "..")
    ? value
    : null;
}

function digest(root, paths) {
  const hash = createHash("sha256");
  for (const path of paths)
    hash
      .update(path)
      .update("\0")
      .update(readFileSync(resolve(root, path)));
  return hash.digest("hex");
}

function readDependencies(path) {
  if (statSync(path).size > MAX_BYTES) throw new Error("oversize-dependency-record");
  const value = JSON.parse(readFileSync(path, "utf8"));
  if (value.version !== 1 || !value.projects) throw new Error("unsupported-dependency-record");
  return value;
}

function dependenciesFor(record, nativeProject, file, root) {
  const project = record?.projects[nativeProject];
  const indexes = project?.files[file];
  if (!Array.isArray(indexes) || !Array.isArray(project.modules)) return null;
  const paths = [...indexes, ...(project.globalSetup ?? [])].map((index) => {
    if (!Number.isSafeInteger(index) || index < 0) return null;
    const path = project.modules[index];
    return typeof path === "string" ? repositoryPath(root, path) : null;
  });
  // An unrepresentable edge makes the record unknown, never an empty impact set.
  if (paths.some((path) => path === null)) return null;
  return [...new Set([file, ...paths])].sort();
}

/** Uses native reporter events; test output and assertion text never enter the artifact. */
export default class CiTestObservations {
  onInit(vitest) {
    this.root = vitest.config.root;
    this.cachePath = resolve(vitest.viteConfig.cacheDir, "dependencies.json");
    this.output = resolve(this.root, ".artifacts/ci-test-observations/observations.json");
  }

  onTestRunStart(specifications) {
    this.started = performance.now();
    this.pendingHooks = new Map();
    try {
      const git = (...args) =>
        execFileSync("git", args, {
          cwd: this.root,
          encoding: "utf8",
          timeout: 1000,
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
      this.specifications = specifications.map((specification) => {
        const file = repositoryPath(this.root, specification.moduleId);
        if (!file) throw new Error("unrepresentable-test-file");
        return { specification, file, nativeProject: specification.project.name };
      });
      this.context = {
        repository: process.env.GITHUB_REPOSITORY ?? "openclaw/clawhub",
        revision: git("rev-parse", "HEAD"),
        tree: git("rev-parse", "HEAD^{tree}"),
        configDigest: digest(this.root, [
          "package.json",
          "vitest.config.ts",
          "vitest.setup.ts",
          "scripts/ci-test-observations.mjs",
        ]),
        lockDigest: digest(this.root, ["bun.lock"]),
        environmentDigest: createHash("sha256")
          .update(
            JSON.stringify({
              node: process.versions.node,
              bun: process.versions.bun ?? null,
              platform: process.platform,
              arch: process.arch,
            }),
          )
          .digest("hex"),
      };
      this.clean = git("status", "--porcelain", "--untracked-files=normal") === "";
      this.initial = this.observations(false);
      this.recordedAt = new Date().toISOString();
      this.write(this.initial);
    } catch {
      this.context = null;
      console.warn("[adaptive-ci] observations unavailable; coverage continues unchanged");
    }
  }

  onHookStart({ name, entity }) {
    if (!this.context) return;
    const module = entity.type === "module" ? entity : entity.module;
    this.pendingHooks.set(
      `${entity.id}\0${name}`,
      `${module.project.name}\0${repositoryPath(this.root, module.moduleId)}`,
    );
  }

  onHookEnd({ name, entity }) {
    // Vitest emits the end event only after the hook completes successfully.
    this.pendingHooks?.delete(`${entity.id}\0${name}`);
  }

  observations(finished, modules = [], record = null, unhandled = false) {
    const byIdentity = new Map(
      modules.map((module) => [
        `${module.project.name}\0${repositoryPath(this.root, module.moduleId)}`,
        module,
      ]),
    );
    const files = this.specifications.map(({ specification, file, nativeProject }) => {
      const module = finished ? byIdentity.get(`${nativeProject}\0${file}`) : undefined;
      const cases = module ? { passed: 0, failed: 0, skipped: 0, pending: 0 } : null;
      let incompleteCases = false;
      for (const test of module?.children.allTests() ?? []) {
        const result = test.result();
        const diagnostic = test.diagnostic();
        cases[result.state]++;
        incompleteCases ||=
          !diagnostic ||
          diagnostic.retryCount > 0 ||
          (result.state === "passed" && Boolean(result.errors?.length));
      }
      const complete = Boolean(
        module &&
        !unhandled &&
        ["passed", "failed"].includes(module.state()) &&
        cases.passed + cases.failed > 0 &&
        !cases.skipped &&
        !cases.pending &&
        !incompleteCases &&
        ![...this.pendingHooks.values()].includes(`${nativeProject}\0${file}`) &&
        (module.state() === "passed" || cases.failed > 0),
      );
      return {
        file,
        project: nativeProject || "default",
        pool: specification.pool,
        complete,
        outcome: complete ? (cases.failed ? "failed" : "passed") : "unknown",
        cases,
        durationMs: module ? module.diagnostic().duration : null,
        dependencies: complete ? dependenciesFor(record, nativeProject, file, this.root) : null,
      };
    });
    return {
      version: 1,
      context: this.context,
      invocations: [
        {
          id: "root",
          dependencyRoot: "",
          runtime: process.versions.bun ? "bun" : "node",
          runtimeVersion: process.versions.bun ?? process.versions.node,
          platform: process.platform,
          arch: process.arch,
          complete: files.length > 0 && files.every((file) => file.complete),
          elapsedMs: finished ? performance.now() - this.started : null,
          files,
        },
      ],
    };
  }

  write(observations) {
    const data = {
      version: 1,
      source: {
        runId: process.env.GITHUB_RUN_ID ?? "local",
        runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
        event: process.env.GITHUB_EVENT_NAME ?? "local",
        job: "unit",
        shard: "root",
        workingTreeClean: this.clean,
      },
      preExecution: { recordedAt: this.recordedAt, observations: this.initial },
      observations,
    };
    let text = JSON.stringify(data);
    if (Buffer.byteLength(text) > MAX_BYTES) {
      for (const file of observations.invocations[0].files) file.dependencies = null;
      text = JSON.stringify(data);
    }
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("oversize-observations");
    mkdirSync(resolve(this.root, ".artifacts/ci-test-observations"), { recursive: true });
    writeFileSync(`${this.output}.tmp`, text, { mode: 0o600 });
    renameSync(`${this.output}.tmp`, this.output);
  }

  onTestRunEnd(modules, errors) {
    if (!this.context) return;
    try {
      let dependencies = null;
      try {
        dependencies = readDependencies(this.cachePath);
      } catch {
        /* Missing records stay unknown. */
      }
      this.write(this.observations(true, modules, dependencies, errors.length > 0));
    } catch {
      console.warn("[adaptive-ci] final observations unavailable; initial inventory retained");
    }
  }
}
