import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const schema = Type.Object({
	path: Type.String({ description: "Path to a file (relative or absolute)." }),
	offset: Type.Optional(Type.Number({ description: "Start from this line/entry number (1-indexed). Use to continue after truncation." })),
	limit: Type.Optional(Type.Number({ description: "Maximum lines or entries to return. Prefer larger windows over tiny repeated chunks." })),
});

const description = [
	"Read the contents of a file.",
	"Supports text files and images (jpg, png, gif, webp). Images are sent as attachments.",
	`Output truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.`,
	"Use offset/limit for large files; continue with offset until complete when needed."
].join(" ");

export function createHarnessReadTool(): ToolDefinition<any, any, any> {
	const base = createReadToolDefinition(process.cwd());
	return {
		...base,
		description,
		parameters: schema,
		async execute(toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
			return createReadToolDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		},
	} as ToolDefinition<any, any, any>;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool(createHarnessReadTool());
}
