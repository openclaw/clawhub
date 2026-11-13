// Mocked-context unit tests call handlers directly; runtime tests use generated references.
// Callers intentionally supply simplified mock types instead of the registered function types.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
export function getTestHandler<TArgs, TResult = unknown>(registered: unknown) {
  return (registered as { _handler: (ctx: unknown, args: TArgs) => Promise<TResult> })._handler;
}
