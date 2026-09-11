/** Typed failures for the bash backgrounding extension. The `message` field is what the model sees. */

import * as Schema from "effect/Schema";

/** Single definition site: the type and the schema both derive from this array. */
const BASH_ERROR_KINDS = ["spawn", "not_found", "not_running", "output", "aborted"] as const;

/** Tagged union of every failure mode the extension reports to the model. */
export type BashErrorKind = (typeof BASH_ERROR_KINDS)[number];

/** Schema for BashErrorKind; used as the `kind` field schema. */
export const BashErrorKind = Schema.Union(BASH_ERROR_KINDS.map((kind) => Schema.Literal(kind)));

/** Tagged error for a bash backgrounding failure; the `message` field is what the model sees. */
export class BashError extends Schema.TaggedError<BashError>()("Bash.Error", {
  kind: BashErrorKind,
  message: Schema.String,
  id: Schema.optionalKey(Schema.Number),
  command: Schema.optionalKey(Schema.String),
  // Schema-serializable errors require a string cause; the original Error
  // object is intentionally not retained.
  cause: Schema.optionalKey(Schema.String),
}) {}

/** Optional context fields carried on a BashError, derived from its schema. */
export type BashErrorFields = Pick<BashError, "id" | "command" | "cause">;

const MESSAGES = {
  spawn: (fields: BashErrorFields) =>
    `Unable to execute command: ${fields.command ?? "(unknown command)"}`,
  not_found: (fields: BashErrorFields) => `No background process with id ${fields.id ?? ""}`,
  not_running: (fields: BashErrorFields) => `Background process ${fields.id ?? ""} is not running`,
  output: (fields: BashErrorFields) => `Unable to capture output for process ${fields.id ?? ""}`,
  aborted: () => "Status check aborted",
} satisfies Record<BashErrorKind, (fields: BashErrorFields) => string>;

/**
 * Build a BashError with the kind's stable, model-facing message.
 *
 * @param kind - Failure mode; selects the message template.
 * @param fields - Optional context carried on the error.
 */
export const bashError = (kind: BashErrorKind, fields: BashErrorFields = {}): BashError =>
  new BashError({ kind, message: MESSAGES[kind](fields), ...fields });

/** Stringify an unknown cause for the schema's string-only `cause` field. */
export const toErrorString = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
