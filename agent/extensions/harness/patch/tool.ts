/**
 * `apply_patch` — the sole editor on the V2 surface (spec §4.4).
 *
 * Plain JSON tool, schema `{patch}`. The model sees a summary-only A/M/D
 * result; the TUI renders a collapsed header (`apply_patch · N files (+x -y)`)
 * plus one block per file with its diff via pi's diff renderer. Calls
 * serialize through a per-session mutex.
 */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { renderDiff } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { renderToolTitle } from "../shell/output.ts";
import { type AppliedFile, applyPatch, displayPath } from "./applier.ts";
import { parsePatch } from "./parser.ts";

const schema = Type.Object({
	patch: Type.String({
		description:
			"The full patch envelope: '*** Begin Patch' ... '*** End Patch' with '*** Add File:', '*** Update File:' (optionally '*** Move to:'), and '*** Delete File:' hunks. Update hunks use @@ context markers and ' '/'-'/'+' prefixed lines.",
	}),
});

interface ApplyPatchParams {
	patch: string;
}

/** TUI-facing per-file summary. Full file contents deliberately excluded
 * from details to keep session records lean. */
export type ApplyPatchFileDetail = Pick<AppliedFile, "kind" | "path" | "movePath" | "diff" | "added" | "removed">;

export interface ApplyPatchDetails {
	files: ApplyPatchFileDetail[];
}

const description = [
	"Edit files by applying a patch in the Codex envelope format.",
	"The patch must start with '*** Begin Patch' and end with '*** End Patch'.",
	"Hunks: '*** Add File: <path>' (every body line prefixed '+'), '*** Delete File: <path>' (no body),",
	"'*** Update File: <path>' (optional '*** Move to: <new path>' line, then @@ context chunks with ' ' context, '-' removed, '+' added lines).",
	"Use '@@' markers with surrounding context to disambiguate repeated code; '*** End of File' anchors a chunk at the end of the file.",
	"Paths are cwd-relative (absolute allowed). The patch applies atomically: it either fully applies or nothing changes.",
	"All preflight errors are reported together, so fix every reported problem in one retry.",
].join(" ");

/** Collapsed TUI header: `apply_patch · N files (+x -y)` (spec §4.4 UI). */
export function buildPatchHeader(patch: string): string {
	let fileCount: number;
	try {
		fileCount = parsePatch(patch).length;
	} catch {
		return "apply_patch";
	}
	let added = 0;
	let removed = 0;
	for (const line of patch.split("\n")) {
		if (line.startsWith("*** ")) continue;
		if (line.startsWith("+")) added += 1;
		else if (line.startsWith("-")) removed += 1;
	}
	return `apply_patch · ${fileCount} ${fileCount === 1 ? "file" : "files"} (+${added} -${removed})`;
}

export function createApplyPatchTool(): ToolDefinition<any, any, any> {
	// Per-session mutex: calls serialize (spec §4.4 Concurrency). The tool is
	// constructed per session, so this closure is the session scope.
	let mutex: Promise<unknown> = Promise.resolve();

	return {
		name: "apply_patch",
		label: "apply_patch",
		description,
		parameters: schema,
		async execute(_toolCallId, params: ApplyPatchParams, _signal, _onUpdate, ctx) {
			const run = async () => {
				const result = await applyPatch(params.patch, ctx.cwd);
				const files = result.files.map(
					({ kind, path, movePath, diff, added, removed }): ApplyPatchFileDetail => ({
						kind,
						path,
						movePath,
						diff,
						added,
						removed,
					}),
				);
				return {
					content: [{ type: "text", text: result.summary }],
					details: { files } satisfies ApplyPatchDetails,
				};
			};
			const turn = mutex.then(run, run);
			mutex = turn.catch(() => {});
			return turn;
		},
		renderCall(args: ApplyPatchParams | undefined, theme, context) {
			return renderToolTitle(buildPatchHeader(args?.patch ?? ""), theme, context);
		},
		renderResult(result, _options, theme, context) {
			const container = (context.lastComponent as Container | undefined) ?? new Container();
			container.clear();

			if (context.isError) {
				const text = (result?.content ?? [])
					.map((c: { type: string; text?: string }) => (c.type === "text" ? (c.text ?? "") : ""))
					.filter(Boolean)
					.join("\n");
				if (text) {
					container.addChild(new Spacer(1));
					container.addChild(new Text(theme.fg("error", text), 1, 0));
				}
				return container;
			}

			const files = (result?.details as ApplyPatchDetails | undefined)?.files ?? [];
			for (const file of files) {
				const label =
					file.movePath === undefined
						? displayPath(context.cwd, file.path)
						: `${displayPath(context.cwd, file.path)} -> ${displayPath(context.cwd, file.movePath)}`;
				const marker = file.kind === "add" ? "A" : file.kind === "delete" ? "D" : "M";
				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("toolTitle", theme.bold(`${marker} ${label}`)), 1, 0));
				if (file.diff) {
					container.addChild(new Text(renderDiff(file.diff, { filePath: label }), 1, 0));
				}
			}
			return container;
		},
	} as ToolDefinition<any, any, any>;
}

export function registerApplyPatch(pi: ExtensionAPI): void {
	pi.registerTool(createApplyPatchTool());
}
