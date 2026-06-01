import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";

const description = [
	"Edit an existing file by replacing exact text snippets.",
	"Use for surgical changes in existing files; use `write` for new files or full rewrites.",
	"Each entry in `edits[]` is matched against the original file, not incrementally — do not include overlapping or nested edits.",
	"If two changes touch the same block or nearby lines, merge them into one edit.",
	"Returns a unified diff in `details.diff` and the first changed line in `details.firstChangedLine`.",
].join(" ");

export default function (pi: ExtensionAPI) {
	const base = createEditToolDefinition(process.cwd());
	pi.registerTool({
		...base,
		description,
	} as ToolDefinition<any, any, any>);
}
