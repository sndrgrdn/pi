/**
 * `apply_patch` — the sole editor on the model-visible surface.
 *
 * Plain JSON tool, schema `{patch}`. The model sees a summary-only A/M/D
 * result; Trace View renders one collapsed lifecycle row while expansion
 * preserves one block per file with pi's diff renderer. Calls serialize
 * through a per-session mutex.
 */
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { renderDiff } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	createTraceRenderer,
	emitTraceRunning,
	formatTracePath,
	type TraceInvocation,
	type TraceToolRegistrar,
	withTraceDetails,
} from "../ui/trace.ts";
import { type AppliedFile, applyPatch } from "./applier.ts";
import { parsePatch } from "./parser.ts";

const schema = Type.Object({
	patch: Type.String({
		description:
			"Full Codex patch envelope, from '*** Begin Patch' through '*** End Patch'. Use '*** Add File:', '*** Update File:' (optionally followed by '*** Move to:'), or '*** Delete File:' hunks. Prefix added-file lines with '+'; in update chunks prefix context, removed, and added lines with ' ', '-', and '+'. Use '@@' with surrounding context to disambiguate repeated code and '*** End of File' to anchor the final chunk.",
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
	"Edit files atomically with a Codex patch envelope; every hunk applies or none do.",
	"Paths are relative to the working directory unless absolute.",
	"Preflight reports all errors together so they can be fixed in one retry.",
].join(" ");

function patchTraceInvocation(args: ApplyPatchParams, cwd: string): TraceInvocation {
	let paths: string[] = [];
	try {
		paths = [...new Set(parsePatch(args.patch).map((hunk) => formatTracePath(hunk.path, cwd)))];
	} catch {
		// Incomplete and malformed invocations still receive a lifecycle row.
	}
	let added = 0;
	let removed = 0;
	for (const line of args.patch.split("\n")) {
		if (line.startsWith("*** ")) continue;
		if (line.startsWith("+")) added += 1;
		else if (line.startsWith("-")) removed += 1;
	}
	return {
		action: "apply_patch",
		target: paths.length === 1 ? paths[0] : paths.length > 1 ? `${paths.length} files` : undefined,
		qualifiers: [`+${added} -${removed}`],
	};
}

const traceRenderer = createTraceRenderer<ApplyPatchParams>({
	invocation: patchTraceInvocation,
	evidence(result, theme, context) {
		if (context.isError) return undefined;
		const files = (result.details as ApplyPatchDetails | undefined)?.files ?? [];
		if (files.length === 0) return undefined;
		return files
			.map((file) => {
				const source = formatTracePath(file.path, context.cwd);
				const label =
					file.movePath === undefined ? source : `${source} -> ${formatTracePath(file.movePath, context.cwd)}`;
				const marker = file.kind === "add" ? "A" : file.kind === "delete" ? "D" : "M";
				const title = theme.fg("toolTitle", theme.bold(`${marker} ${label}`));
				return file.diff ? `${title}\n${renderDiff(file.diff, { filePath: label })}` : title;
			})
			.join("\n");
	},
});

export function createApplyPatchTool(): ToolDefinition<any, any, any> {
	// Per-session mutex: calls serialize. The tool is
	// constructed per session, so this closure is the session scope.
	let mutex: Promise<unknown> = Promise.resolve();

	return {
		name: "apply_patch",
		label: "apply_patch",
		description,
		parameters: schema,
		renderShell: "self",
		async execute(_toolCallId, params: ApplyPatchParams, signal, onUpdate, ctx) {
			emitTraceRunning(onUpdate);
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
					details: withTraceDetails(
						{ files } satisfies ApplyPatchDetails,
						signal?.aborted ? "cancelled" : "success",
					),
				};
			};
			const turn = mutex.then(run, run);
			mutex = turn.catch(() => {});
			return turn;
		},
		renderCall: traceRenderer.renderCall,
		renderResult: traceRenderer.renderResult,
	} as ToolDefinition<any, any, any>;
}

export function registerApplyPatch(
	pi: ExtensionAPI,
	register: TraceToolRegistrar["register"] = (tool) => pi.registerTool(tool),
): void {
	register(createApplyPatchTool());
}
