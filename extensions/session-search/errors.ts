import { Schema } from "effect";

export class IndexError extends Schema.TaggedError<IndexError>()(
	"IndexError",
	{ message: Schema.String, cause: Schema.optional(Schema.Defect) },
) {}

export class WorkspaceNotFoundError extends Schema.TaggedError<WorkspaceNotFoundError>()(
	"WorkspaceNotFoundError",
	{ filter: Schema.String, available: Schema.Array(Schema.String) },
) {}

export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
	"SessionNotFoundError",
	{ sessionId: Schema.String },
) {}

export class InvalidDateError extends Schema.TaggedError<InvalidDateError>()(
	"InvalidDateError",
	{ input: Schema.String },
) {}
