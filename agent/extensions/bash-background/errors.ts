import * as Schema from "effect/Schema";

const BASH_ERROR_KINDS = ["spawn", "not_found", "not_running", "output", "aborted"] as const;

export type BashErrorKind = (typeof BASH_ERROR_KINDS)[number];

export const BashErrorKind = Schema.Union(BASH_ERROR_KINDS.map((kind) => Schema.Literal(kind)));

export class BashError extends Schema.TaggedError<BashError>()("Bash.Error", {
  kind: BashErrorKind,
  message: Schema.String,
  id: Schema.optionalKey(Schema.Number),
  command: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.String),
}) {}

export type BashErrorFields = Pick<BashError, "id" | "command" | "cause">;

const MESSAGES = {
  spawn: (fields: BashErrorFields) =>
    `Unable to execute command: ${fields.command ?? "(unknown command)"}`,
  not_found: (fields: BashErrorFields) => `No background process with id ${fields.id ?? ""}`,
  not_running: (fields: BashErrorFields) => `Background process ${fields.id ?? ""} is not running`,
  output: (fields: BashErrorFields) => `Unable to capture output for process ${fields.id ?? ""}`,
  aborted: () => "Status check aborted",
} satisfies Record<BashErrorKind, (fields: BashErrorFields) => string>;

export const bashError = (kind: BashErrorKind, fields: BashErrorFields = {}): BashError =>
  new BashError({ kind, message: MESSAGES[kind](fields), ...fields });

export const toErrorString = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
