/** Model-facing failures for background bash operations. */

import * as Schema from "effect/Schema";

const BASH_ERROR_KINDS = ["spawn", "not_found", "not_running", "output", "aborted"] as const;

/** Failure kinds reported by background bash operations. */
export type BashErrorKind = (typeof BASH_ERROR_KINDS)[number];

/** Runtime schema for background bash failure kinds. */
export const BashErrorKind = Schema.Union(BASH_ERROR_KINDS.map((kind) => Schema.Literal(kind)));

/** Background bash failure with a stable model-facing message. */
export class BashError extends Schema.TaggedError<BashError>()("Bash.Error", {
  kind: BashErrorKind,
  message: Schema.String,
  id: Schema.optionalKey(Schema.Number),
  command: Schema.optionalKey(Schema.String),
  // Schema-serializable errors require a string cause; the original Error
  // object is intentionally not retained.
  cause: Schema.optionalKey(Schema.String),
}) {}

/** Optional process context for a background bash failure. */
export type BashErrorFields = Pick<BashError, "id" | "command" | "cause">;

const MESSAGES = {
  spawn: (fields: BashErrorFields) =>
    `Unable to execute command: ${fields.command ?? "(unknown command)"}`,
  not_found: (fields: BashErrorFields) => `No background process with id ${fields.id ?? ""}`,
  not_running: (fields: BashErrorFields) => `Background process ${fields.id ?? ""} is not running`,
  output: (fields: BashErrorFields) => `Unable to capture output for process ${fields.id ?? ""}`,
  aborted: () => "Status check aborted",
} satisfies Record<BashErrorKind, (fields: BashErrorFields) => string>;

/** Creates a background bash failure with its stable message. */
export const bashError = (kind: BashErrorKind, fields: BashErrorFields = {}): BashError =>
  new BashError({ kind, message: MESSAGES[kind](fields), ...fields });

/** Converts an unknown cause to its serializable message. */
export const toErrorString = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
