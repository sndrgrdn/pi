import { Cause, Exit, Result } from "effect";

/** Returns the first typed failure from an Effect Exit. */
export function findExitError<E>(exit: Exit.Exit<unknown, E>): E | undefined {
  if (Exit.isSuccess(exit)) return undefined;
  const found = Cause.findFail(exit.cause);

  if (Result.isFailure(found)) return undefined;

  return found.success.error;
}
