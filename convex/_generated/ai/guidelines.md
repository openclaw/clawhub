# Convex guidelines

These guidelines target Convex `^1.44.0`.

## Function guidelines

### HTTP endpoints

- Define HTTP endpoints in `convex/http.ts` with `httpRouter` and an `httpAction` handler. Routes are registered at the exact `path` supplied.
- Treat `await req.json()` as `unknown`; narrow each field (e.g. `typeof` checks) before use, and return HTTP 400 for bodies that fail validation.

### Validators

- Use `v.array`, `v.union`, `v.object`, `v.record`, and the other validators from `convex/values` for function arguments and schemas. `v.object` supports `.pick("a", "b")`, `.omit("c")`, `.partial()`, and `.extend({ d: v.string() })`; use `.fields` when supplying a function's `args`.
- For a complete stored-document validator, default-import your authored schema using the correct relative path, e.g. `import schema from "./schema"; schema.doc("users")`. `schema.doc` includes `_id` and `_creationTime` and handles union tables. For a bare table definition, use `import { docValidator } from "convex/server"; docValidator("users", usersTable)`. `convex/server` exports `docValidator`, not `doc`; prefer `schema.doc` when the schema is available. Never import your schema from `_generated`.
- Convex values are: `v.id(tableName)` for `Id` strings, `v.null()` for `null`, `v.int64()` for `bigint`, `v.number()` for IEEE-754 numbers, `v.boolean()`, `v.string()`, `v.bytes()` for `ArrayBuffer`, `v.array(values)`, `v.object({...})`, and `v.record(keys, values)` for dynamic-key records. `undefined` is not a Convex value and is returned to clients as `null`; use `null`. Arrays have at most 8192 values, objects at most 1024 entries, and strings/bytes/documents have the platform size limits. Object and record keys must be valid nonempty names and cannot start with `$` or `_`.
- Use `v.literal` members in `v.union` validators for discriminated unions.

### Function registration

- Register private functions with `internalQuery`, `internalMutation`, or `internalAction` from `./_generated/server`; register public API functions with `query`, `mutation`, or `action` from the same module. A function used only by your own code, such as an HTTP action's commit mutation, is internal.
- Never register a function through `api` or `internal`, and always include argument validators for every function kind.

### Function calling

- Call queries, mutations, and actions with `ctx.runQuery`, `ctx.runMutation`, and `ctx.runAction` respectively. Pass a `FunctionReference`, never the function itself. Call actions from actions only when crossing runtimes; otherwise call shared code directly.
- Keep action-to-query/mutation calls few because transactions split across calls can race.
- Nested `ctx.runQuery` and `ctx.runMutation` calls from a mutation are subtransactions. If a nested call throws, its writes roll back independently and the caller may catch the error and continue its own writes.
- Convex 1.41+ accepts a third `transactionLimits` argument on nested queries and mutations. These limits can only tighten the caller's global limits. Supported fields are `bytesRead`, `bytesWritten`, `databaseQueries`, `documentsRead`, `documentsWritten`, `functionsScheduled`, and `scheduledFunctionArgsBytes`; a failed nested call rolls back its writes while preserving caller headroom.
- When using `ctx.runQuery`, `ctx.runMutation`, or `ctx.runAction` to call a function in the same file, specify a type annotation on the return value to work around TypeScript circularity limitations (see the example below). Annotate with what the callee returns; a handler with no return value returns `null`, not `void`.

### Function references

- Use `api` from `convex/_generated/api.ts` for functions registered with `query`, `mutation`, or `action`, and `internal` for those registered with `internalQuery`, `internalMutation`, or `internalAction`. File routing maps `convex/example.ts` function `f` to `api.example.f` and private `g` to `internal.example.g`; nested files include every directory segment, such as `api.messages.access.h`.

### Pagination

- Validate `paginationOpts` with `paginationOptsValidator` from `convex/server` and pass `args.paginationOpts` unchanged to `.paginate()`. Do not reconstruct it, because optional native behavior would be lost.
- The native options are `numItems`, required nullable `cursor`, optional `endCursor`, `maximumRowsRead`, `maximumBytesRead`, and client-managed `id`. Read budgets can produce a short page with `splitCursor` and `pageStatus`.
- A paginated query returns `page`, `isDone`, and `continueCursor`, with optional `splitCursor` and `pageStatus`. Use `paginationResultValidator(itemValidator)` for its return validator.

## Schema guidelines

- Define the schema in `convex/schema.ts` and import schema functions from `convex/server`.
- `_id` and `_creationTime` are automatically added system fields (`v.id(tableName)` and `v.number()`).
- Include every index field in its name, such as `by_field1_and_field2`; query indexed fields in their declared order, creating separate indexes for another order.
- Do not put an unbounded list in one document. Use a child table with a foreign key. Keep high-churn heartbeats, online status, and typing indicators in a dedicated table instead of a stable profile document.
- An index added to a large existing table can block deploy during backfill. Use `.index("by_field", { fields: ["field"], staged: true })`; remove `staged` in a later deploy before querying it.

## Authentication guidelines

- JWT authentication requires `convex/auth.config.ts`. Its provider `domain` is the JWT issuer, and `applicationID` is checked against the token audience; without the file, `ctx.auth.getUserIdentity()` is always `null`.
- Read identity with `ctx.auth.getUserIdentity()` in queries, mutations, and actions. It may be `null`; `tokenIdentifier` is the guaranteed canonical stable identity key, so use it for ownership and auth-linked lookups rather than `subject` alone.
- Never accept a user ID or other identity argument for authorization; derive it server-side.
- With an external auth provider, use `ConvexProviderWithAuth` from `convex/react`, whose `useAuth` returns `{ isLoading, isAuthenticated, fetchAccessToken }`. Do not use plain `ConvexProvider` for authenticated requests because it will not send tokens.

## TypeScript guidelines

- Import `Id` and `Doc<"tableName">` from `./_generated/dataModel`; use `Id<"users">` instead of `string` for a users-table ID.
- Type contexts with `QueryCtx`, `MutationCtx`, and `ActionCtx` from `./_generated/server`; never use `any` for a context parameter.
- Give `Record` both key and value types, such as `Record<Id<"users">, string>`.
- For typed app environment variables, declare them in `convex/convex.config.ts` with `defineApp({ env: { MY_KEY: v.optional(v.string()) } })` and read `env` from `./_generated/server`, not `process.env`. `CONVEX_SITE_URL` and `CONVEX_CLOUD_URL` are already on `env`; do not redeclare them.

## Full text search guidelines

- Use `.withSearchIndex("search_body", q => q.search("body", text).eq("channel", channel))` and then bound results with `.take(n)`.

## Vector search guidelines

- Store embeddings as `v.array(v.float64())` and declare a vector index with `vectorField`, exact `dimensions`, and any declared `filterFields`.
- `ctx.vectorSearch` is available only in actions. Its filter supports equality on declared filter fields and `q.or(...)`, not cross-field AND or inequality; apply remaining predicates after hydration.
- Results contain only `{ _id, _score }` in descending similarity order. Since actions have no `ctx.db`, hydrate all hits through one internal query, preserve search order, and pair each score with its document ID.

## Component guidelines

- Components are installable building blocks such as `@convex-dev/aggregate` and `@convex-dev/rate-limiter`, with isolated tables and functions. Install and mount them in `convex/convex.config.ts`, then `import { components } from "./_generated/api"` and pass e.g. `components.aggregate` to the component client (there is no `ctx.components`).
- Component functions are not client-facing. Wrap them in app queries/mutations and authorize in the app function first.
- Component reads and writes participate in the calling mutation's transaction. If a component mirrors an app table, update it in the same mutation as every insert, patch, replace, or delete.
- A local component has a directory under `convex/`, its own `convex.config.ts` using `defineComponent("myName")`, its own `schema.ts`, and functions from its own `_generated/server`. Mount with `app.use(myName)` and include the module segment in references: a function in `convex/myName/index.ts` is `components.myName.index.myFunction`, never `components.myName.myFunction`.
- For per-key quotas, cooldowns, or throttling, use `@convex-dev/rate-limiter`; hand-rolled counters and window scans race under concurrency and lose quota when a mutation fails.
- For chat or assistant features where an LLM replies inside a durable conversation - per-user resumable histories, recorded tool-call steps, several assistants sharing one conversation - use the `@convex-dev/agent` component: mount it, create one component thread per conversation, and generate/read through it (`createThread(ctx, components.agent, ...)`, `new Agent(components.agent, { name, languageModel, tools }).generateText(ctx, { threadId }, { prompt })`, `listMessages`). Do not hand-roll a messages table or call an LLM SDK directly from your functions for these.
- For async functions needing bounded parallelism, serialized mutation work, or completion callbacks, use `@convex-dev/workpool`; retry only idempotent actions.
- For ephemeral presence - who is online/viewing/typing in a room, tracked by client heartbeats with session tokens, multi-session aggregation (one entry per user across tabs), and timeout-to-offline - use `@convex-dev/presence`; hand-rolled lastSeen tables need wall-clock query filters that go stale, and per-session rows break the one-entry-per-user contract.
- A component mutation is a subtransaction. If it throws and the caller catches it, its writes roll back while the caller can continue and commit.
- To pass a function across a component boundary, mint a handle in the app with `const handle = await createFunctionHandle(internal.index.myCallback)` from `convex/server`; send it as a string, then invoke it with `await ctx.runMutation(args.handle as FunctionHandle<"mutation">, callbackArgs)`. `getFunctionHandle` and `getFunctionName` are not this API.

## Query guidelines

- Prefer `.withIndex()` and put every index-supported predicate in the index range. `.filter()` runs after the index scan and does not make an unbounded query scalable.
- Do not read the wall clock in a query. Pass current time as an argument or materialize time state with scheduled mutations; `Date.now()` is fine in mutations and actions.
- If the user does not explicitly tell you to return all results from a query you should ALWAYS return a bounded collection instead. So that is instead of using `.collect()` you should use `.take()` or paginate on database queries. This prevents future performance issues when tables grow in an unbounded way.
- Never use `.collect().length`; Convex has no built-in count operator. A counter document suffices only for a simple total. When queries need counts, sums, ranks/positions, or offsets over many rows, whole-table or within a key range, use `@convex-dev/aggregate` (O(log n) reads), updated in the same mutation as every source-table write.
- Queries do not support `.delete()`. Read matches in batches or with async iteration and call `ctx.db.delete` for each document.
- For large mutation work, process a batch and schedule a continuation with `ctx.scheduler.runAfter(0, internal.myModule.myMutation, args)`. For variable document sizes, use async iteration and after each write `await ctx.meta.getTransactionMetrics()`, returning when a needed `.remaining` metric such as `metrics.bytesRead.remaining` reaches a safety reserve.
- Use `.unique()` for one document; it throws when multiple documents match. With async iteration, use `for await (const row of query)` rather than `.collect()` or `.take(n)`.

### Ordering

- Queries default to ascending order over the selected index key; a plain scan uses `by_creation_time`. `.order("asc"|"desc")` selects direction. Index queries follow index columns and append `_creationTime` as a tie-breaker, so do not re-sort equal-key rows in JavaScript.

## Mutation guidelines

- Use `ctx.db.replace(table, id, document)` to replace a whole existing document and `ctx.db.patch(table, id, fields)` for a shallow merge. Both throw when the document does not exist.

## Action guidelines

- Put `"use node";` at the top of a file containing actions that use Node built-ins. Keep such actions separate from files exporting queries or mutations. `fetch()` works in the default runtime, so it does not require Node.
- Actions have no `ctx.db`; read and write data through function calls.

## Scheduling guidelines

### Cron guidelines

- Use only `crons.interval` or `crons.cron`, and pass a `FunctionReference`, never a function value. Define a top-level `cronJobs()` object and export it as default.
- Functions may be registered in `crons.ts`. For an internal target, import `internal` from `./_generated/api` even when the target is registered in the same file.

## Testing guidelines

- Test Convex functions with `convex-test`, Vitest, and `@edge-runtime/vm`; configure Vitest with `environment: "edge-runtime"` and always install the latest versions of these packages.
- Test files belong under `convex/`. Pass an `import.meta.glob("./**/*.ts")` module map to `convexTest(schema, modules)` and call functions through generated `api` references.
- Add `/// <reference types="vite/client" />` only in test files that use `import.meta.glob`.
- Do not add uninstalled packages to `compilerOptions.types`; leave `types` unset unless the package is installed.

## File storage guidelines

- `ctx.storage.getUrl(fileId)` returns a signed URL or `null` when absent. Do not use deprecated `ctx.storage.getMetadata`.
- Read metadata from the `_storage` system table with `ctx.db.system.get("_storage", fileId)` and an `Id<"_storage">`; storage values are `Blob` objects and must be converted to/from `Blob`.

## Selected reference patterns

HTTP endpoints are registered with this shape:

```typescript
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
const http = httpRouter();
http.route({
  path: "/echo",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const body = await req.bytes();
    return new Response(body, { status: 200 });
  }),
});
```

An array validator is:

```typescript
import { mutation } from "./_generated/server";
import { v } from "convex/values";
export const exampleMutation = mutation({
  args: { simpleArray: v.array(v.union(v.string(), v.number())) },
  handler: async (ctx, args) => {},
});
```

A discriminated union uses `v.union` with `v.literal` members, for example:

```typescript
export default defineSchema({
  results: defineTable(
    v.union(
      v.object({ kind: v.literal("error"), errorMessage: v.string() }),
      v.object({ kind: v.literal("success"), value: v.number() }),
    ),
  ),
});
```

Nested limits are the optional third argument:

```ts
try {
  await ctx.runMutation(internal.example.writeBatch, args, {
    transactionLimits: { documentsWritten: 100, bytesWritten: 1024 * 1024 },
  });
} catch (e) {
  // The nested mutation's writes rolled back; this mutation can still write.
}
```

Same-file calls can use an explicit result annotation:

```ts
const result: string = await ctx.runQuery(api.example.f, { name: "Bob" });
```

Pagination passes the validator and options through unchanged:

```ts
export const listWithExtraArg = query({
  args: { paginationOpts: paginationOptsValidator, author: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("messages")
      .withIndex("by_author", (q) => q.eq("author", args.author))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});
```

An auth provider config has this shape:

```typescript
export default {
  providers: [
    {
      domain: "https://your-auth-provider.com",
      applicationID: "convex",
    },
  ],
};
```

An external auth client uses `ConvexProviderWithAuth` with `useAuth`:

```tsx
<ConvexProviderWithAuth client={convex} useAuth={useYourAuthHook}>
  {children}
</ConvexProviderWithAuth>
```

A typed ID-keyed map is:

```ts
const idToUsername: Record<Id<"users">, string> = {};
```

Vector indexes declare the field, dimensions, and filters:

```ts
documents: defineTable({
  title: v.string(),
  category: v.string(),
  embedding: v.array(v.float64()),
}).vectorIndex("by_embedding", {
  vectorField: "embedding",
  dimensions: 1536,
  filterFields: ["category"],
}),
```

The vector call is action-only:

```ts
const results = await ctx.vectorSearch("documents", "by_embedding", {
  vector: args.embedding,
  limit: 10,
  filter: (q) => q.eq("category", args.category),
});
```

Mounting a component follows this pattern:

```ts
import { defineApp } from "convex/server";
import aggregate from "@convex-dev/aggregate/convex.config";
const app = defineApp();
app.use(aggregate);
export default app;
```

Cron wiring uses a top-level object and a reference:

```ts
const crons = cronJobs();
crons.interval("delete inactive users", { hours: 2 }, internal.crons.empty, {});
export default crons;
```

Convex tests require the module map:

```typescript
import { convexTest } from "convex-test";
const modules = import.meta.glob("./**/*.ts");
const t = convexTest(schema, modules);
await t.mutation(api.messages.send, { body: "Hi!", author: "Sarah" });
```

Storage metadata comes from the system table:

```ts
const metadata = await ctx.db.system.get("_storage", fileId);
```
