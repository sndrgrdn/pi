import { Cause, Exit, Result } from "effect";

/**
 * The first typed failure error of an Exit, or undefined when the Exit
 * succeeded or failed without a typed error. Shared by the web-tools test
 * suites so the error kind stays typed (e.g. `WebFetchError.kind`) at
 * every call site instead of a cast to `{ kind?: string }`.
 */
export function findExitError<E>(exit: Exit.Exit<unknown, E>): E | undefined {
  if (Exit.isSuccess(exit)) return undefined;
  const found = Cause.findFail(exit.cause);

  if (Result.isFailure(found)) return undefined;

  return found.success.error;
}
