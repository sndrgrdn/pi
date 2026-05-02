import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { keyHint, renderDiff, withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, resolve } from "path";
import { Type } from "typebox";

type ChangeType = "add" | "update" | "delete" | "move";
type Change = { path: string; moveTo?: string; displayPath: string; oldText: string; newText: string; bom: boolean; type: ChangeType; diff: string; additions: number; deletions: number; firstChangedLine: number };
type Section = { action: "add" | "update" | "delete"; path: string; moveTo?: string; lines: string[] };
type ApplyPatchDetails = { diff: string; files: string[]; summary: string };
type PatchPreview = { diff: string; summary: string; files: string[] } | { error: string };
type ApplyPatchRenderState = { preview?: PatchPreview; previewArgsKey?: string; previewPending?: boolean };

const schema = Type.Object({
	patchText: Type.String({ description: "Patch text. Must start with *** Begin Patch and end with *** End Patch. File sections: *** Add File: <path>, *** Update File: <path>, *** Delete File: <path> (updates may include *** Move to: <path>). Add lines prefixed +. Update hunks use @@ markers, space context, - removals, + additions." }),
}, { additionalProperties: false });

const splitBom = (text: string) => text.charCodeAt(0) === 0xfeff ? { bom: true, text: text.slice(1) } : { bom: false, text };
const joinBom = (text: string, bom: boolean) => bom ? `\uFEFF${text}` : text;
const normalize = (text: string) => text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
const shortenPath = (path: string) => path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path;
const marker = (type: ChangeType) => type === "add" ? "A" : type === "delete" ? "D" : type === "move" ? "R" : "M";
const lineOf = (s: string, index: number) => s.slice(0, index).split("\n").length;

function countPatchLines(lines: string[]) {
	let additions = 0;
	let deletions = 0;
	for (const line of lines) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions++;
		else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
	}
	return { additions, deletions };
}

function parseSections(patchText: string) {
	const lines = normalize(patchText).split("\n");
	if (lines[0] !== "*** Begin Patch") throw new Error("patch must start with *** Begin Patch");
	if (lines[lines.length - 1] === "") lines.pop();
	if (lines.at(-1) !== "*** End Patch") throw new Error("patch must end with *** End Patch");

	const sections: Section[] = [];
	let current: Section | undefined;
	for (const line of lines.slice(1, -1)) {
		const add = line.match(/^\*\*\* Add File: (.+)$/);
		const update = line.match(/^\*\*\* Update File: (.+)$/);
		const del = line.match(/^\*\*\* Delete File: (.+)$/);
		const move = line.match(/^\*\*\* Move to: (.+)$/);
		if (add || update || del) {
			current = { action: add ? "add" : update ? "update" : "delete", path: (add ?? update ?? del)![1]!, lines: [] };
			sections.push(current);
			continue;
		}
		if (move) {
			if (!current || current.action !== "update") throw new Error("Move to is only valid after Update File");
			current.moveTo = move[1]!;
			continue;
		}
		if (!current) throw new Error(`patch line outside file section: ${line}`);
		current.lines.push(line);
	}
	return sections;
}

function addContent(lines: string[]) {
	return lines.map((line) => {
		if (!line.startsWith("+")) throw new Error("Add File lines must start with +");
		return line.slice(1);
	}).join("\n") + (lines.length > 0 ? "\n" : "");
}

function updateContent(path: string, original: string, lines: string[]) {
	let content = original;
	let cursor = 0;
	let oldChunk: string[] = [];
	let newChunk: string[] = [];
	let firstChangedLine: number | undefined;
	const flush = () => {
		if (oldChunk.length === 0 && newChunk.length === 0) return;
		const oldText = oldChunk.join("\n") + "\n";
		const newText = newChunk.join("\n") + "\n";
		const index = content.indexOf(oldText, cursor);
		if (index < 0) throw new Error(`apply_patch verification failed: hunk not found in ${path}`);
		firstChangedLine ??= lineOf(content, index);
		content = content.slice(0, index) + newText + content.slice(index + oldText.length);
		cursor = index + newText.length;
		oldChunk = [];
		newChunk = [];
	};

	for (const line of lines) {
		if (line.startsWith("@@")) {
			flush();
			continue;
		}
		const prefix = line[0];
		const text = line.slice(1);
		if (prefix === " ") {
			oldChunk.push(text);
			newChunk.push(text);
		} else if (prefix === "-") {
			oldChunk.push(text);
		} else if (prefix === "+") {
			newChunk.push(text);
		} else if (line === "") {
			oldChunk.push("");
			newChunk.push("");
		} else {
			throw new Error(`invalid patch line: ${line}`);
		}
	}
	flush();
	return { content, firstChangedLine: firstChangedLine ?? 1 };
}

function sectionDiff(section: Section, oldText: string, newText: string, type: ChangeType) {
	const from = type === "add" ? "/dev/null" : section.path;
	const to = type === "delete" ? "/dev/null" : (section.moveTo ?? section.path);
	if (section.action === "update") return `--- ${from}\n+++ ${to}\n${section.lines.join("\n")}\n`;
	const lines = (section.action === "add" ? newText.split("\n").map((line) => `+${line}`) : oldText.split("\n").map((line) => `-${line}`)).join("\n");
	return `--- ${from}\n+++ ${to}\n@@\n${lines}\n`;
}

function summarize(changes: Change[]) {
	return changes.map((change) => `${marker(change.type)} ${shortenPath(change.displayPath)}:${change.firstChangedLine} +${change.additions} -${change.deletions}`).join("\n");
}

async function deriveChanges(cwd: string, patchText: string): Promise<Change[]> {
	const changes: Change[] = [];
	const sections = parseSections(patchText);
	const actionsByPath = new Map<string, Set<Section["action"]>>();
	for (const section of sections) {
		const absolutePath = resolve(cwd, section.path.replace(/^@/, ""));
		const actions = actionsByPath.get(absolutePath) ?? new Set<Section["action"]>();
		actions.add(section.action);
		actionsByPath.set(absolutePath, actions);
	}
	for (const [path, actions] of actionsByPath) {
		if (actions.has("add") && actions.has("delete")) throw new Error(`patch rejected: cannot add and delete same file in one patch: ${path}`);
	}
	for (const section of sections) {
		const absolutePath = resolve(cwd, section.path.replace(/^@/, ""));
		if (section.action === "add") {
			const newText = addContent(section.lines);
			const { additions, deletions } = countPatchLines(section.lines);
			changes.push({ path: absolutePath, displayPath: section.path, oldText: "", newText, bom: false, type: "add", diff: sectionDiff(section, "", newText, "add"), additions, deletions, firstChangedLine: 1 });
			continue;
		}
		const source = splitBom(await readFile(absolutePath, "utf-8"));
		if (section.action === "delete") {
			const diff = sectionDiff(section, source.text, "", "delete");
			const deletions = source.text.split("\n").filter((line, index, lines) => line.length > 0 || index < lines.length - 1).length;
			changes.push({ path: absolutePath, displayPath: section.path, oldText: source.text, newText: "", bom: source.bom, type: "delete", diff, additions: 0, deletions, firstChangedLine: 1 });
			continue;
		}
		const { content: newText, firstChangedLine } = updateContent(section.path, source.text, section.lines);
		const type = section.moveTo ? "move" : "update";
		const { additions, deletions } = countPatchLines(section.lines);
		changes.push({ path: absolutePath, moveTo: section.moveTo ? resolve(cwd, section.moveTo.replace(/^@/, "")) : undefined, displayPath: section.moveTo ?? section.path, oldText: source.text, newText, bom: source.bom, type, diff: sectionDiff(section, source.text, newText, type), additions, deletions, firstChangedLine });
	}
	return changes;
}

function toPreview(changes: Change[]): PatchPreview {
	return {
		diff: changes.map((change) => change.diff).join("\n"),
		summary: summarize(changes),
		files: changes.map((change) => change.displayPath),
	};
}

async function computePreview(cwd: string, patchText: string): Promise<PatchPreview> {
	try {
		const changes = await deriveChanges(cwd, patchText);
		if (changes.length === 0) return { error: "patch rejected: no file sections found" };
		return toPreview(changes);
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

function formatPatchCall(patchText: string | undefined, theme: any) {
	let paths: string[] = [];
	try {
		paths = patchText ? parseSections(patchText).map((section) => section.moveTo ?? section.path) : [];
	} catch {}
	const target = paths.length === 0 ? theme.fg("toolOutput", "...") : theme.fg("accent", paths.map(shortenPath).join(", "));
	return `${theme.fg("toolTitle", theme.bold("apply_patch"))} ${target}`;
}

function limitRenderedLines(text: string, expanded: boolean, theme: any) {
	const lines = text.split("\n");
	const maxLines = expanded ? lines.length : 10;
	const remaining = lines.length - maxLines;
	let output = lines.slice(0, maxLines).join("\n");
	if (remaining > 0) output += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
	return output;
}

function renderPreview(preview: PatchPreview | undefined, expanded: boolean, theme: any) {
	if (!preview) return undefined;
	if ("error" in preview) return theme.fg("error", preview.error);
	const summary = theme.fg("toolOutput", preview.summary);
	const diff = limitRenderedLines(renderDiff(preview.diff), expanded, theme);
	return `${summary}\n\n${diff}`;
}

function renderPatchCall(args: { patchText?: string }, theme: any, context: any) {
	const state = context.state as ApplyPatchRenderState;
	const component = context.lastComponent instanceof Container ? context.lastComponent : new Container();
	const argsKey = args?.patchText ?? "";
	if (state.previewArgsKey !== argsKey) {
		state.preview = undefined;
		state.previewPending = false;
		state.previewArgsKey = argsKey;
	}
	if (context.argsComplete && args?.patchText && !state.preview && !state.previewPending) {
		state.previewPending = true;
		const requestKey = argsKey;
		void computePreview(context.cwd, args.patchText).then((preview) => {
			if (state.previewArgsKey === requestKey) {
				state.preview = preview;
				state.previewPending = false;
				context.invalidate();
			}
		});
	}
	component.clear();
	component.addChild(new Text(formatPatchCall(args?.patchText, theme), 0, 0));
	const previewText = renderPreview(state.preview, Boolean(context.expanded), theme);
	if (previewText) {
		component.addChild(new Spacer(1));
		component.addChild(new Text(previewText, 0, 0));
	}
	return component;
}

function renderPatchResult(result: { content: Array<{ type: string; text?: string }>; details?: ApplyPatchDetails }, options: { expanded?: boolean }, theme: any, context: any) {
	const component = context.lastComponent instanceof Container ? context.lastComponent : new Container();
	component.clear();
	let output: string | undefined;
	if (context.isError) {
		output = result.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
		if (output) output = theme.fg("error", output);
	} else if (result.details?.summary) {
		const state = context.state as ApplyPatchRenderState;
		output = theme.fg("toolOutput", result.details.summary);
		if (!state.preview || "error" in state.preview || state.preview.diff !== result.details.diff) {
			output += `\n\n${limitRenderedLines(renderDiff(result.details.diff), Boolean(options.expanded), theme)}`;
		}
	}
	if (!output) return component;
	component.addChild(new Spacer(1));
	component.addChild(new Text(output, 1, 0));
	return component;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool<typeof schema, ApplyPatchDetails | undefined, ApplyPatchRenderState>({
		name: "apply_patch",
		label: "apply_patch",
		description: [
			"Apply a structured patch to add, update, delete, or move files.",
			"Use for multi-location or multi-file edits instead of batching edit calls.",
		].join(" "),
		promptSnippet: "Apply a structured multi-file patch",
		parameters: schema,
		renderCall: renderPatchCall,
		renderResult: renderPatchResult,
		async execute(_id, { patchText }, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Operation aborted");
			const changes = await deriveChanges(ctx.cwd, patchText);
			if (changes.length === 0) throw new Error("patch rejected: no file sections found");
			for (const change of changes) {
				await withFileMutationQueue(change.path, async () => {
					if (signal?.aborted) throw new Error("Operation aborted");
					if (change.type === "delete") {
						await rm(change.path);
						return;
					}
					const target = change.moveTo ?? change.path;
					await mkdir(dirname(target), { recursive: true });
					await writeFile(target, joinBom(change.newText, change.bom), "utf-8");
					if (change.moveTo) await rm(change.path);
				});
			}
			const preview = toPreview(changes);
			if ("error" in preview) throw new Error(preview.error);
			return {
				content: [{ type: "text", text: `Applied patch to ${changes.length} file(s):\n${preview.summary}` }],
				details: preview,
			};
		},
	});
}
