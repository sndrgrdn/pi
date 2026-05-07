import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const schema = Type.Object({
	path: Type.String({
		description: [
			"Path to the file to edit (relative or absolute).",
			"The file MUST already exist — use `write` for new files, `bash` with `rm` for deletion.",
		].join(" "),
	}),
	edits: Type.Array(
		Type.Object(
			{
				oldText: Type.String({
					description: [
						"Exact substring to replace, matched against the ORIGINAL file content (pre-edit).",
						"Constraints:",
						"(1) Must occur EXACTLY ONCE in the file. If not unique, expand with surrounding lines. Verify against the full file, not just the region you are editing.",
						"(2) Must NOT overlap or nest with any other edits[].oldText in the same call. Merge near/overlapping changes into one edit instead.",
						"(3) Whitespace, indentation and trailing newlines must match the file byte-for-byte.",
						"Auto-normalized before matching: smart quotes (\u201c\u201d\u2018\u2019), unicode dashes/hyphens, non-breaking and other unicode spaces, and trailing whitespace on each line. Case is NOT normalized.",
						"Keep oldText as small as possible while still being unique — do not pad with large unchanged regions to bridge distant changes.",
					].join(" "),
				}),
				newText: Type.String({
					description: [
						"Replacement text. Use an empty string to delete the matched region.",
						"Must differ from oldText (no-op edits are rejected).",
						"Indentation must match the surrounding code; line endings are auto-converted to the file's existing convention (LF/CRLF).",
					].join(" "),
				}),
			},
			{ additionalProperties: false },
		),
		{
			minItems: 1,
			description: [
				"One or more disjoint replacements applied to the file in a single atomic write.",
				"All oldText values are matched against the ORIGINAL file content — NOT against the result of earlier edits in this same array.",
				"If two changes touch the same block or adjacent lines, merge them into ONE entry whose oldText/newText cover both.",
				"Strongly prefer one `edit` call with multiple entries over multiple sequential `edit` calls on the same file: it is one atomic write, one diff, and one round-trip.",
			].join(" "),
		},
	),
});

const description = [
	"Edit an existing file by replacing one or more exact text snippets in a single atomic write.",
	"Use for surgical changes in existing files; use `write` for new files or full rewrites.",
	"Returns a unified diff in `details.diff` and the first changed line in `details.firstChangedLine`.",
].join(" ");

export default function (pi: ExtensionAPI) {
	const base = createEditToolDefinition(process.cwd());
	pi.registerTool({
		...base,
		description,
		parameters: schema,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return createEditToolDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		},
	});
}
