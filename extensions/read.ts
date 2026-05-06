import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createReadToolDefinition, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const schema = Type.Object({
	path: Type.String({ description: "Path to a file or directory (relative or absolute). Directories list entries with trailing / for subdirectories." }),
	offset: Type.Optional(Type.Number({ description: "Start from this line/entry number (1-indexed). Use to continue after truncation." })),
	limit: Type.Optional(Type.Number({ description: "Maximum lines or entries to return. Prefer larger windows over tiny repeated chunks." })),
});

const description = [
	"Read a text file or list a directory.",
	"Supports text files and images (jpg, png, gif, webp). Images are sent as attachments.",
	"Relative paths resolve from cwd.",
	`Output truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.`,
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
