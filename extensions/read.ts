import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
	"Use offset/limit for large files; continue with offset until complete when needed.",
	"Does not support reading directories. Use bash to list directories instead.",
].join(" ");

export default function (pi: ExtensionAPI) {
	const base = createReadToolDefinition(process.cwd());
	pi.registerTool({
		...base,
		description,
		parameters: schema,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return createReadToolDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		},
	});
}
