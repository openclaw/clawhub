import { parse as parseYaml } from "yaml";

// A small evaluator for the GitHub Actions expression subset ClawHub workflows
// use (`&&`, `||`, `!`, `==`, `!=`, parentheses, literals, context paths, and
// `format`). Tests evaluate the real workflow expressions against an event
// context instead of pinning their source text.
// Semantics follow https://docs.github.com/actions/reference/evaluate-expressions-in-workflows-and-actions

type Value = string | number | boolean | null | Record<string, unknown> | unknown[];
export type WorkflowContext = Record<string, unknown>;

type Token =
  | { kind: "op"; value: string }
  | { kind: "string"; value: string }
  | { kind: "number"; value: number }
  | { kind: "ident"; value: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index]!;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const two = source.slice(index, index + 2);
    if (["&&", "||", "==", "!=", "<=", ">="].includes(two)) {
      tokens.push({ kind: "op", value: two });
      index += 2;
      continue;
    }
    if ("()[],.!<>".includes(char)) {
      tokens.push({ kind: "op", value: char });
      index += 1;
      continue;
    }
    if (char === "'") {
      let value = "";
      index += 1;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          value += "'";
          index += 2;
        } else if (source[index] === "'") {
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (source[index] !== "'") throw new Error(`Unterminated string in ${source}`);
      tokens.push({ kind: "string", value });
      index += 1;
      continue;
    }
    const number = /^-?\d+(\.\d+)?/.exec(source.slice(index));
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(index));
    if (ident) {
      tokens.push({ kind: "ident", value: ident[0] });
      index += ident[0].length;
      continue;
    }
    throw new Error(`Unsupported expression syntax at "${source.slice(index)}"`);
  }
  return tokens;
}

export function isTruthy(value: Value | undefined) {
  return !(value === null || value === undefined || value === false || value === 0 || value === "");
}

function coerceNumber(value: Value | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value.trim() === "" ? 0 : Number(value);
  return Number.NaN;
}

function looseEquals(left: Value | undefined, right: Value | undefined) {
  const l = left ?? null;
  const r = right ?? null;
  if (typeof l === typeof r && (typeof l !== "object" || l === null || r === null)) {
    if (typeof l === "string") return l.toLowerCase() === (r as string).toLowerCase();
    return l === r;
  }
  if (typeof l === "object" && l !== null) return l === r;
  return coerceNumber(l) === coerceNumber(r);
}

function toDisplayString(value: Value | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

class Parser {
  private position = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly context: WorkflowContext,
  ) {}

  parse(): Value | undefined {
    const value = this.or();
    if (this.position !== this.tokens.length) throw new Error("Unexpected trailing tokens");
    return value;
  }

  private peek(value?: string) {
    const token = this.tokens[this.position];
    if (!token) return undefined;
    if (value !== undefined && !(token.kind === "op" && token.value === value)) return undefined;
    return token;
  }

  private expect(value: string) {
    if (!this.peek(value)) throw new Error(`Expected "${value}"`);
    this.position += 1;
  }

  private or(): Value | undefined {
    let left = this.and();
    while (this.peek("||")) {
      this.position += 1;
      const right = this.and();
      left = isTruthy(left) ? left : right;
    }
    return left;
  }

  private and(): Value | undefined {
    let left = this.equality();
    while (this.peek("&&")) {
      this.position += 1;
      const right = this.equality();
      left = isTruthy(left) ? right : left;
    }
    return left;
  }

  private equality(): Value | undefined {
    const left = this.unary();
    if (this.peek("==") || this.peek("!=")) {
      const op = (this.tokens[this.position] as { value: string }).value;
      this.position += 1;
      const equal = looseEquals(left, this.unary());
      return op === "==" ? equal : !equal;
    }
    return left;
  }

  private unary(): Value | undefined {
    if (this.peek("!")) {
      this.position += 1;
      return !isTruthy(this.unary());
    }
    return this.primary();
  }

  private primary(): Value | undefined {
    const token = this.tokens[this.position];
    if (!token) throw new Error("Unexpected end of expression");
    this.position += 1;
    if (token.kind === "op" && token.value === "(") {
      const value = this.or();
      this.expect(")");
      return value;
    }
    if (token.kind === "string" || token.kind === "number") return token.value;
    if (token.kind !== "ident") throw new Error(`Unexpected "${token.value}"`);
    if (token.value === "true") return true;
    if (token.value === "false") return false;
    if (token.value === "null") return null;
    if (this.peek("(")) return this.call(token.value);
    let value: unknown = this.context[token.value] ?? null;
    while (this.peek(".") || this.peek("[")) {
      if (this.peek(".")) {
        this.position += 1;
        const property = this.tokens[this.position];
        if (property?.kind !== "ident") throw new Error("Expected property name");
        this.position += 1;
        value = readProperty(value, property.value);
      } else {
        this.position += 1;
        const key = this.or();
        this.expect("]");
        value = readProperty(value, toDisplayString(key));
      }
    }
    return value as Value;
  }

  private call(name: string): Value {
    this.expect("(");
    const args: Array<Value | undefined> = [];
    if (!this.peek(")")) {
      args.push(this.or());
      while (this.peek(",")) {
        this.position += 1;
        args.push(this.or());
      }
    }
    this.expect(")");
    if (name === "format") {
      const template = toDisplayString(args[0]);
      return template.replace(/\{(\d+)\}/g, (_match, index: string) =>
        toDisplayString(args[Number(index) + 1]),
      );
    }
    throw new Error(`Unsupported function ${name}()`);
  }
}

function readProperty(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const match = Object.keys(record).find(
    (candidate) => candidate.toLowerCase() === key.toLowerCase(),
  );
  return match === undefined ? null : (record[match] ?? null);
}

export function evaluateExpression(expression: string, context: WorkflowContext) {
  return new Parser(tokenize(expression), context).parse();
}

// Evaluates a workflow value the way the runner does: a whole-value `${{ }}`
// keeps its type for `if:`, and interpolated values become strings.
export function evaluateWorkflowValue(raw: unknown, context: WorkflowContext): Value | undefined {
  if (typeof raw !== "string") return raw as Value;
  const whole = /^\s*\$\{\{([\s\S]*)\}\}\s*$/.exec(raw);
  if (whole && !whole[1]!.includes("}}")) return evaluateExpression(whole[1]!, context);
  return raw.replace(/\$\{\{([\s\S]*?)\}\}/g, (_match, expression: string) =>
    toDisplayString(evaluateExpression(expression, context)),
  );
}

type WorkflowStep = { name?: string; if?: unknown; env?: Record<string, unknown>; run?: string };
type Workflow = {
  concurrency?: { group?: unknown };
  jobs?: Record<string, { "timeout-minutes"?: unknown; steps?: WorkflowStep[] }>;
};

export function loadWorkflow(yamlText: string) {
  const workflow = parseYaml(yamlText) as Workflow;
  const step = (jobId: string, stepName: string) => {
    const found = workflow.jobs?.[jobId]?.steps?.find((candidate) => candidate.name === stepName);
    if (!found) throw new Error(`Workflow step ${jobId}/${stepName} not found`);
    return found;
  };
  return {
    workflow,
    concurrencyGroup: (context: WorkflowContext) =>
      toDisplayString(evaluateWorkflowValue(workflow.concurrency?.group, context)),
    jobTimeoutMinutes: (jobId: string, context: WorkflowContext) =>
      evaluateWorkflowValue(workflow.jobs?.[jobId]?.["timeout-minutes"], context),
    stepRuns: (jobId: string, stepName: string, context: WorkflowContext) => {
      const condition = step(jobId, stepName).if;
      return condition === undefined || isTruthy(evaluateWorkflowValue(condition, context));
    },
    stepEnv: (jobId: string, stepName: string, context: WorkflowContext) =>
      Object.fromEntries(
        Object.entries(step(jobId, stepName).env ?? {}).map(([key, value]) => [
          key,
          toDisplayString(evaluateWorkflowValue(value, context)),
        ]),
      ),
    stepScript: (jobId: string, stepName: string) => step(jobId, stepName).run ?? "",
  };
}

// GitHub's `inputs` context for workflow_dispatch carries declared defaults;
// other events have no inputs.
export function workflowDispatchInputs(
  yamlText: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const parsed = parseYaml(yamlText) as {
    on?: { workflow_dispatch?: { inputs?: Record<string, { default?: unknown; type?: string }> } };
  };
  const inputs: Record<string, unknown> = {};
  for (const [name, input] of Object.entries(parsed.on?.workflow_dispatch?.inputs ?? {})) {
    const fallback = input.default ?? (input.type === "boolean" ? false : "");
    inputs[name] =
      input.type === "boolean"
        ? fallback === true || fallback === "true"
        : toDisplayString(fallback as Value);
  }
  return { ...inputs, ...overrides };
}
