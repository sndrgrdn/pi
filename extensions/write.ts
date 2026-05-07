import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createWriteToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const schema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Complete file content to write. Overwrites any existing content." }),
});

const description = "Write a complete file. Creates parent directories automatically. Preserves UTF-8 BOM when present.";

export default function (pi: ExtensionAPI) {
	const base = createWriteToolDefinition(process.cwd());
	pi.registerTool({
		...base,
		description,
		parameters: schema,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return createWriteToolDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		},
	});
}
