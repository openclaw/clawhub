import { constants } from "node:fs";
import { mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

const modules = new Set([
  "skillspector_llm",
  "skillspector_llm_utils",
  "skillspector_usage",
  "skillspector_chat_models",
  "skillspector_structured_output",
  "langchain_openai_base",
  "langchain_chat_models",
  "langchain_runnables",
  "langchain_openai_tools",
  "langchain_json_parser",
  "langchain_pydantic_parser",
  "openai_client",
  "openai_response",
  "openai_responses",
  "openai_utils",
  "pydantic_main",
  "pydantic_adapter",
  "httpx_client",
  "httpx_models",
  "json_encoder",
  "typing",
]);
const classes = new Set([
  "TypeError",
  "ValueError",
  "RuntimeError",
  "ValidationError",
  "RateLimitError",
  "APIConnectionError",
  "APITimeoutError",
  "BadRequestError",
  "InternalServerError",
  "AuthenticationError",
  "PermissionDeniedError",
  "APIResponseValidationError",
  "other",
]);
const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
const integer = (v: unknown, maximum: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= maximum;
const errorTokens = [
  "mock_val_ser",
  "schema_serializer",
  "not_instance",
  "cannot_convert",
  "none_type",
  "unexpected_keyword",
  "required_argument",
  "not_callable",
  "not_iterable",
  "unhashable",
  "unknown_type",
  "not_json",
  "serialization_info",
  "polymorphic",
  "serialize_as_any",
  "include",
  "exclude",
  "dict_type",
  "list_type",
  "str_type",
  "int_type",
  "tuple_type",
  "bytes_type",
];

function projectSerializerFailure(raw: unknown, exceptionClass: string) {
  if (raw === undefined || raw === null) return null;
  const value = record(raw);
  if (
    !value ||
    exceptionClass !== "TypeError" ||
    typeof value.builtinTypeError !== "boolean" ||
    !Array.isArray(value.argumentKinds) ||
    value.argumentKinds.length > 3 ||
    !value.argumentKinds.every((kind) =>
      ["str", "int", "float", "bool", "none", "bytes", "other"].includes(kind),
    ) ||
    typeof value.argumentsTruncated !== "boolean" ||
    typeof value.qualifiedDump !== "boolean" ||
    typeof value.tokensInspected !== "boolean" ||
    !Array.isArray(value.tokens) ||
    value.tokens.length > errorTokens.length ||
    !value.tokens.every((token) => errorTokens.includes(token)) ||
    new Set(value.tokens).size !== value.tokens.length ||
    !["unavailable", "parsed_response", "response", "other"].includes(value.model as string) ||
    !(value.modelComplete === null || typeof value.modelComplete === "boolean") ||
    !["unavailable", "schema", "mock", "missing", "other"].includes(value.serializer as string) ||
    (!value.qualifiedDump &&
      (value.tokens.length > 0 ||
        value.tokensInspected ||
        value.model !== "unavailable" ||
        value.modelComplete !== null ||
        value.serializer !== "unavailable")) ||
    (value.tokens.length > 0 && !value.tokensInspected) ||
    (value.tokensInspected &&
      (!value.builtinTypeError ||
        value.argumentsTruncated ||
        JSON.stringify(value.argumentKinds) !== '["str"]')) ||
    (!value.builtinTypeError && (value.argumentKinds.length > 0 || value.argumentsTruncated)) ||
    (value.model === "other" && (value.modelComplete !== null || value.serializer !== "other"))
  )
    throw new Error("Invalid serializer failure projection");
  return {
    builtinTypeError: value.builtinTypeError,
    argumentKinds: value.argumentKinds as string[],
    argumentsTruncated: value.argumentsTruncated,
    qualifiedDump: value.qualifiedDump,
    tokensInspected: value.tokensInspected,
    tokens: errorTokens.filter((token) => (value.tokens as string[]).includes(token)),
    model: value.model as string,
    modelComplete: value.modelComplete as boolean | null,
    serializer: value.serializer as string,
  };
}

export async function installSkillSpectorExceptionObserver(workspace: string, runnerTemp: string) {
  const runnerRoot = await realpath(runnerTemp);
  const entry = await realpath(join(runnerRoot, "clawscan-scanner-bin/skillspector"));
  if (
    !/^skillspector-source\.[A-Za-z0-9]+\/\.venv\/bin\/skillspector$/.test(
      relative(runnerRoot, entry),
    )
  )
    throw new Error("Unqualified scanner entrypoint");
  const header = (await readFile(entry, "utf8")).split("\n", 1)[0];
  const python = header.slice(2);
  if (
    !header.startsWith("#!") ||
    !/^[A-Za-z0-9_./-]+$/.test(python) ||
    !["python", "python3", "python3.12"].includes(basename(python)) ||
    (await realpath(dirname(python))) !== dirname(entry)
  )
    throw new Error("Unqualified scanner interpreter");
  const output = join(workspace, "exception-locations.jsonl");
  await writeFile(output, "", { flag: "wx", mode: 0o600 });
  const observer = join(workspace, "exception-observer.py");
  await writeFile(
    observer,
    await readFile(new URL("./skillspector_exception_diagnostic.py", import.meta.url)),
    { flag: "wx", mode: 0o600 },
  );
  const bin = join(workspace, "diagnostic-bin");
  await mkdir(bin, { mode: 0o700 });
  await writeFile(
    join(bin, "skillspector"),
    `#!${python}\nimport runpy\nrunpy.run_path(${JSON.stringify(observer)},run_name="__main__",init_globals={"DIAGNOSTIC_OUTPUT":${JSON.stringify(output)}})\n`,
    { flag: "wx", mode: 0o700 },
  );
  return { output, path: `${bin}:${process.env.PATH ?? ""}` };
}

export function projectSkillSpectorExceptionEvents(text: string) {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length === 0 || lines.length > 1024) throw new Error("Observer event limit");
  return lines.map((line) => {
    const item = record(JSON.parse(line));
    if (!item || !integer(item.rootIndex, 61)) throw new Error("Invalid observer root");
    const rootIndex = item.rootIndex;
    if (item.kind === "installed") return { rootIndex, kind: "installed" as const };
    if (item.kind === "finished") {
      if (![item.calls, item.written, item.writeFailures].every((v) => integer(v, 1_000_000)))
        throw new Error("Invalid observer counts");
      return {
        rootIndex,
        kind: "finished" as const,
        calls: item.calls as number,
        written: item.written as number,
        writeFailures: item.writeFailures as number,
      };
    }
    if (
      item.kind !== "failure" ||
      !Array.isArray(item.chain) ||
      item.chain.length < 1 ||
      item.chain.length > 3
    )
      throw new Error("Invalid observer event");
    const chain = item.chain.map((raw) => {
      const value = record(raw);
      if (
        !value ||
        typeof value.class !== "string" ||
        !classes.has(value.class) ||
        (value.mockSchemaSerializer !== undefined &&
          typeof value.mockSchemaSerializer !== "boolean") ||
        (value.mockSchemaSerializer === true && value.class !== "TypeError") ||
        !(
          value.statusCode === null ||
          (integer(value.statusCode, 599) && value.statusCode >= 100)
        ) ||
        !integer(value.unknownFrames, 64) ||
        typeof value.framesTruncated !== "boolean" ||
        !Array.isArray(value.frames) ||
        value.frames.length > 8
      )
        throw new Error("Invalid exception projection");
      return {
        class: value.class,
        mockSchemaSerializer: value.mockSchemaSerializer === true,
        serializerFailure: projectSerializerFailure(value.serializerFailure, value.class),
        statusCode: value.statusCode as number | null,
        unknownFrames: value.unknownFrames,
        framesTruncated: value.framesTruncated,
        frames: value.frames.map((rawFrame) => {
          const frame = record(rawFrame);
          if (
            !frame ||
            typeof frame.module !== "string" ||
            !modules.has(frame.module) ||
            !integer(frame.line, 1_000_000) ||
            frame.line === 0
          )
            throw new Error("Invalid exception frame");
          return { module: frame.module, line: frame.line };
        }),
      };
    });
    return { rootIndex, kind: "failure" as const, chain };
  });
}

export async function readSkillSpectorExceptionEvents(path: string) {
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.mode & 0o077 || info.size > 2 * 1024 * 1024)
        throw new Error("Invalid observer file");
      const bytes = await file.readFile();
      if (bytes.length !== info.size) throw new Error("Observer file changed");
      return {
        presence: "present",
        events: projectSkillSpectorExceptionEvents(bytes.toString("utf8")),
      };
    } finally {
      await file.close();
    }
  } catch {
    return { presence: "invalid", events: [] };
  }
}
