/* @vitest-environment node */
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";
import { parse } from "yaml";
import { selectSolarisExceptionCase } from "./run-solaris-exception-diagnostic";
import {
  installSkillSpectorExceptionObserver,
  projectSkillSpectorExceptionEvents,
  readSkillSpectorExceptionEvents,
} from "./skillspector-exception-diagnostic";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

it("projects actual Python exceptions without their messages and preserves classifier behavior", async () => {
  const code = `
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location("diagnostic",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
try: json.dumps(object())
except TypeError as exc:
 projected=m.project_exception(exc)
 assert any(f["module"]=="json_encoder" for f in projected[0]["frames"])
 assert m.observe_classifier(lambda e:"TypeError",lambda e: (_ for _ in ()).throw(RuntimeError("PRIVATE")))(exc)=="TypeError"
 sentinel=ValueError("PRIVATE")
 def fail(e):raise sentinel
 try:m.observe_classifier(fail,lambda e:None)(exc)
 except ValueError as result:assert result is sentinel
 else:raise AssertionError("changed original exception")
 print(json.dumps(projected))
fake={"__name__":"json.encoder"}
exec(compile("def fake():raise TypeError('PRIVATE')",json.encoder.__file__,"exec"),fake)
try:fake["fake"]()
except TypeError as exc:
 assert all(not entry["frames"] for entry in m.project_exception(exc))
`;
  const result = await promisify(execFile)(
    "python3",
    ["-B", "-c", code, new URL("./skillspector_exception_diagnostic.py", import.meta.url).pathname],
    { env: { PATH: process.env.PATH } },
  );
  expect(result.stdout).not.toContain("PRIVATE");
  const chain = JSON.parse(result.stdout);
  expect(chain[0]).toMatchObject({ class: "TypeError", statusCode: null });
  expect(
    chain[0].frames.every(
      (f: { module: string; line: number }) => f.module === "json_encoder" && f.line > 0,
    ),
  ).toBe(true);
});

it("rejects unknown modules and labels and drops unrelated raw fields", () => {
  const valid = {
    rootIndex: 0,
    kind: "failure",
    PRIVATE: "PRIVATE",
    chain: [
      {
        class: "TypeError",
        statusCode: 429,
        frames: [{ module: "openai_client", line: 4, path: "PRIVATE" }],
        unknownFrames: 0,
        framesTruncated: false,
        message: "PRIVATE",
      },
    ],
  };
  expect(JSON.stringify(projectSkillSpectorExceptionEvents(JSON.stringify(valid)))).not.toContain(
    "PRIVATE",
  );
  expect(() =>
    projectSkillSpectorExceptionEvents(JSON.stringify({ ...valid, rootIndex: 62 })),
  ).toThrow();
  expect(() => projectSkillSpectorExceptionEvents("")).toThrow();
  expect(() =>
    projectSkillSpectorExceptionEvents(
      JSON.stringify({ ...valid, chain: [{ ...valid.chain[0], class: "PRIVATE" }] }),
    ),
  ).toThrow();
  expect(() =>
    projectSkillSpectorExceptionEvents(
      JSON.stringify({
        ...valid,
        chain: [{ ...valid.chain[0], frames: [{ module: "PRIVATE", line: 1 }] }],
      }),
    ),
  ).toThrow();
});

it("identifies only the exact known mock serializer error without exporting its message", async () => {
  const code = `
import importlib.util,json,sys
spec=importlib.util.spec_from_file_location("diagnostic",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
known="'MockValSer' object cannot be converted to 'SchemaSerializer'"
cases=[TypeError(known),TypeError(known+" PRIVATE"),ValueError(known),TypeError("PRIVATE"),TypeError(known,"PRIVATE")]
print(json.dumps([m.project_exception(exc) for exc in cases]))
`;
  const result = await promisify(execFile)(
    "python3",
    ["-B", "-c", code, new URL("./skillspector_exception_diagnostic.py", import.meta.url).pathname],
    { env: { PATH: process.env.PATH } },
  );
  expect(result.stdout).not.toContain("PRIVATE");
  expect(result.stdout).not.toContain("MockValSer");
  const chains = JSON.parse(result.stdout);
  expect(
    chains.map((chain: Array<{ mockSchemaSerializer: boolean }>) => chain[0].mockSchemaSerializer),
  ).toEqual([true, false, false, false, false]);
  const event = { rootIndex: 4, kind: "failure", chain: chains[0] };
  expect(projectSkillSpectorExceptionEvents(JSON.stringify(event))[0]).toMatchObject({
    chain: [{ class: "TypeError", mockSchemaSerializer: true }],
  });
  expect(() =>
    projectSkillSpectorExceptionEvents(
      JSON.stringify({
        ...event,
        chain: [{ ...chains[0][0], mockSchemaSerializer: "PRIVATE" }],
      }),
    ),
  ).toThrow();
  expect(() =>
    projectSkillSpectorExceptionEvents(
      JSON.stringify({
        ...event,
        chain: [{ ...chains[0][0], class: "ValueError", mockSchemaSerializer: true }],
      }),
    ),
  ).toThrow();
});

it("projects qualified serializer state and fixed tokens without private text or type names", async () => {
  const code = `
import importlib.util,json,sys,types
spec=importlib.util.spec_from_file_location("diagnostic",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
sdk=types.ModuleType("openai.types.responses.response")
class Response:pass
sdk.Response=Response;sys.modules[sdk.__name__]=sdk
parsed=types.ModuleType("openai.types.responses.parsed_response")
Mock=type("MockValSer",(),{"__module__":"pydantic._internal._mock_val_ser"})
class Parsed(Response):
 __pydantic_complete__=False
 __pydantic_serializer__=Mock()
parsed.ParsedResponse=Parsed;sys.modules[parsed.__name__]=parsed
trusted=types.ModuleType("pydantic.main");trusted.__file__="/qualified-pydantic-main.py";sys.modules[trusted.__name__]=trusted
exec(compile("def model_dump(self):raise TypeError(\\"PRIVATE 'MockValSer' object is not an instance of 'SchemaSerializer' PRIVATE\\")",trusted.__file__,"exec"),trusted.__dict__)
try:trusted.model_dump(Parsed())
except TypeError as exc:projected=m.project_exception(exc)
fake={"__name__":"pydantic.main"}
exec(compile("def model_dump(self):raise TypeError(\\"PRIVATE MockValSer SchemaSerializer\\")",trusted.__file__,"exec"),fake)
try:fake["model_dump"](Parsed())
except TypeError as exc:forged=m.project_exception(exc)
exec(compile("def model_dump(self,error):raise error",trusted.__file__,"exec"),trusted.__dict__)
def project(error):
 try:trusted.model_dump(Parsed(),error)
 except TypeError as exc:return m.project_exception(exc)
class Sneaky:
 def __str__(self):raise AssertionError("PRIVATE stringification")
other=project(TypeError(Sneaky()))
oversize=project(TypeError("PRIVATE MockValSer "+"x"*2048))
Parsed.__pydantic_complete__=property(lambda self:(_ for _ in ()).throw(AssertionError("PRIVATE getter")))
Parsed.__pydantic_serializer__=property(lambda self:(_ for _ in ()).throw(AssertionError("PRIVATE getter")))
descriptor=project(TypeError("PRIVATE"))
print(json.dumps({"trusted":projected,"forged":forged,"other":other,"oversize":oversize,"descriptor":descriptor}))
`;
  const result = await promisify(execFile)(
    "python3",
    ["-B", "-c", code, new URL("./skillspector_exception_diagnostic.py", import.meta.url).pathname],
    { env: { PATH: process.env.PATH } },
  );
  expect(result.stdout).not.toContain("PRIVATE");
  expect(result.stdout).not.toContain("/qualified-");
  const data = JSON.parse(result.stdout);
  expect(data.trusted[0].serializerFailure).toEqual({
    builtinTypeError: true,
    argumentKinds: ["str"],
    argumentsTruncated: false,
    qualifiedDump: true,
    tokensInspected: true,
    tokens: ["mock_val_ser", "schema_serializer", "not_instance"],
    model: "parsed_response",
    modelComplete: false,
    serializer: "mock",
  });
  expect(data.forged[0].serializerFailure).toMatchObject({ qualifiedDump: false, tokens: [] });
  expect(data.other[0].serializerFailure).toMatchObject({
    argumentKinds: ["other"],
    tokensInspected: false,
    tokens: [],
  });
  expect(data.oversize[0].serializerFailure).toMatchObject({
    argumentKinds: ["str"],
    tokensInspected: false,
    tokens: [],
  });
  expect(data.descriptor[0].serializerFailure).toMatchObject({
    modelComplete: null,
    serializer: "other",
  });
  const event = { rootIndex: 19, kind: "failure", chain: data.trusted };
  expect(projectSkillSpectorExceptionEvents(JSON.stringify(event))[0]).toMatchObject({
    chain: [{ serializerFailure: data.trusted[0].serializerFailure }],
  });
  expect(() =>
    projectSkillSpectorExceptionEvents(
      JSON.stringify({
        ...event,
        chain: [
          {
            ...data.trusted[0],
            serializerFailure: {
              ...data.trusted[0].serializerFailure,
              tokens: ["PRIVATE"],
            },
          },
        ],
      }),
    ),
  ).toThrow();
  for (const serializerFailure of [
    { ...data.trusted[0].serializerFailure, tokensInspected: false },
    { ...data.trusted[0].serializerFailure, argumentKinds: ["str", "str", "str", "str"] },
    { ...data.trusted[0].serializerFailure, model: "PRIVATE" },
    { ...data.trusted[0].serializerFailure, serializer: "PRIVATE" },
  ]) {
    expect(() =>
      projectSkillSpectorExceptionEvents(
        JSON.stringify({
          ...event,
          chain: [{ ...data.trusted[0], serializerFailure }],
        }),
      ),
    ).toThrow();
  }
});

it("installs only over the qualified venv entrypoint and reads private regular files only", async () => {
  const root = await mkdtemp(join(tmpdir(), "exception-observer-"));
  roots.push(root);
  const venv = join(root, "skillspector-source.control/.venv/bin");
  await mkdir(venv, { recursive: true });
  await writeFile(join(venv, "skillspector"), `#!${venv}/python3\n`);
  await mkdir(join(root, "clawscan-scanner-bin"));
  await symlink(join(venv, "skillspector"), join(root, "clawscan-scanner-bin/skillspector"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const observer = await installSkillSpectorExceptionObserver(workspace, root);
  expect(await readFile(join(workspace, "diagnostic-bin/skillspector"), "utf8")).toContain(
    `#!${venv}/python3\n`,
  );
  await writeFile(observer.output, '{"kind":"installed","rootIndex":0}\n');
  expect(await readSkillSpectorExceptionEvents(observer.output)).toMatchObject({
    presence: "present",
    events: [{ kind: "installed", rootIndex: 0 }],
  });
  await chmod(observer.output, 0o644);
  expect(await readSkillSpectorExceptionEvents(observer.output)).toEqual({
    presence: "invalid",
    events: [],
  });
  const link = join(root, "link");
  await symlink(observer.output, link);
  expect(await readSkillSpectorExceptionEvents(link)).toEqual({ presence: "invalid", events: [] });
});

it("admits only two fixed jobs from the reviewed main workflow and no CLI selectors", () => {
  const env = {
    GITHUB_WORKFLOW_REF:
      "openclaw/clawhub/.github/workflows/solaris-exception-diagnostic.yml@refs/heads/main",
    GITHUB_JOB: "fleet-root",
  };
  expect(selectSolarisExceptionCase(env, [])).toBe("fleet-error");
  expect(selectSolarisExceptionCase({ ...env, GITHUB_JOB: "all-roots" }, [])).toBe("all-error");
  expect(() => selectSolarisExceptionCase({ ...env, GITHUB_JOB: "root29" }, [])).toThrow();
  expect(() =>
    selectSolarisExceptionCase({ ...env, GITHUB_WORKFLOW_REF: "PRIVATE" }, []),
  ).toThrow();
  expect(() => selectSolarisExceptionCase(env, ["--root", "29"])).toThrow();
});

it("runs a fixed single-root job before an all-root confirmation without widening admission or uploads", async () => {
  const raw = await readFile(
    new URL("../../.github/workflows/solaris-exception-diagnostic.yml", import.meta.url),
    "utf8",
  );
  const workflow = parse(raw);
  expect(workflow.on.workflow_dispatch).toBeNull();
  expect(workflow.permissions).toEqual({ contents: "read" });
  expect(workflow.concurrency).toEqual({
    group: "nonpublishing-solaris-bundled-diagnostic",
    "cancel-in-progress": false,
  });
  expect(Object.keys(workflow.jobs)).toEqual(["fleet-root", "all-roots"]);
  expect(workflow.jobs["all-roots"].needs).toBe("fleet-root");
  expect(workflow.jobs["all-roots"].if).toContain("needs.fleet-root.result == 'success'");
  for (const job of Object.values(workflow.jobs) as Array<Record<string, any>>) {
    expect(job["runs-on"]).toBe("ubuntu-22.04");
    expect(job.environment).toBe("Production");
    expect(job.if).toContain("github.ref == 'refs/heads/main'");
    const index = (command: string) =>
      job.steps.findIndex((step: { run?: string }) => step.run?.includes(command));
    expect(index("sh scripts/security/install-clawscan-scanners.sh skillspector")).toBeGreaterThan(
      index("sh scripts/security/install-clawscan.sh"),
    );
    const upload = job.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    );
    expect(upload.with.path).toBe("${{ steps.probe.outputs.safe-output }}/summary.json");
  }
  expect(raw).not.toMatch(
    /WORKER_TOKEN|CONVEX|assigned-jobs|workflow_call|pull_request|repository_dispatch/,
  );
});
