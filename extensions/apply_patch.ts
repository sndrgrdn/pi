import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { keyHint, renderDiff, withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { Container, Spacer, Text } from "@mariozechner/pi-tui";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, resolve } from "path";
import { Type } from "typebox";

type Change = { path: string; moveTo?: string; oldText: string; newText: string; bom: boolean; type: "add" | "update" | "delete" | "move" };
type Section = { action: "add" | "update" | "delete"; path: string; moveTo?: string; lines: string[] };
type ApplyPatchDetails = { diff: string; files: string[] };

const schema = Type.Object({
	patchText: Type.String({ description: "Patch text using Begin Patch / Add File / Update File / Delete File sections" }),
}, { additionalProperties: false });

const splitBom = (text: string) => text.charCodeAt(0) === 0xfeff ? { bom: true, text: text.slice(1) } : { bom: false, text };
const joinBom = (text: string, bom: boolean) => bom ? `\uFEFF${text}` : text;
const normalize = (text: string) => text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
const shortenPath = (path: string) => path.startsWith(homedir()) ? `~${path.slice(homedir().length)}` : path;

function diff(path: string, oldText: string, newText: string) {
	return `--- ${path}\n+++ ${path}\n@@\n${oldText.split("\n").map((line) => `-${line}`).join("\n")}\n${newText.split("\n").map((line) => `+${line}`).join("\n")}\n`;
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
			current = { action: add ? "add" : update ? "update" : "delete", path: (add ?? update ?? del)![1], lines: [] };
			sections.push(current);
			continue;
		}
		if (move) {
			if (!current || current.action !== "update") throw new Error("Move to is only valid after Update File");
			current.moveTo = move[1];
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
	const flush = () => {
		if (oldChunk.length === 0 && newChunk.length === 0) return;
		const oldText = oldChunk.join("\n") + "\n";
		const newText = newChunk.join("\n") + "\n";
		const index = content.indexOf(oldText, cursor);
		if (index < 0) throw new Error(`apply_patch verification failed: hunk not found in ${path}`);
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
	return content;
}

async function deriveChanges(cwd: string, patchText: string): Promise<Change[]> {
	const changes: Change[] = [];
	for (const section of parseSections(patchText)) {
		const absolutePath = resolve(cwd, section.path.replace(/^@/, ""));
		if (section.action === "add") {
			changes.push({ path: absolutePath, oldText: "", newText: addContent(section.lines), bom: false, type: "add" });
			continue;
		}
		const source = splitBom(await readFile(absolutePath, "utf-8"));
		if (section.action === "delete") {
			changes.push({ path: absolutePath, oldText: source.text, newText: "", bom: source.bom, type: "delete" });
			continue;
		}
		const newText = updateContent(section.path, source.text, section.lines);
		changes.push({ path: absolutePath, moveTo: section.moveTo ? resolve(cwd, section.moveTo.replace(/^@/, "")) : undefined, oldText: source.text, newText, bom: source.bom, type: section.moveTo ? "move" : "update" });
	}
	return changes;
}

function formatPatchCall(patchText: string | undefined, theme: any) {
	let paths: string[] = [];
	try {
		paths = patchText ? parseSections(patchText).map((section) => section.moveTo ?? section.path) : [];
	} catch {}
	const target = paths.length === 0 ? theme.fg("toolOutput", "...") : theme.fg("accent", paths.map(shortenPath).join(", "));
	return `${theme.fg("toolTitle", theme.bold("apply_patch"))} ${target}`;
}

function renderPatchCall(args: { patchText?: string }, theme: any, context: any) {
	const text = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
	text.setText(formatPatchCall(args?.patchText, theme));
	return text;
}

function limitRenderedLines(text: string, expanded: boolean, theme: any) {
	const lines = text.split("\n");
	const maxLines = expanded ? lines.length : 10;
	const remaining = lines.length - maxLines;
	let output = lines.slice(0, maxLines).join("\n");
	if (remaining > 0) output += `${theme.fg("muted", `\n... (${remaining} more lines,`)} ${keyHint("app.tools.expand", "to expand")})`;
	return output;
}

function renderPatchResult(result: { content: Array<{ type: string; text?: string }>; details?: ApplyPatchDetails }, options: { expanded?: boolean }, theme: any, context: any) {
	const component = context.lastComponent instanceof Container ? context.lastComponent : new Container();
	component.clear();
	let output: string | undefined;
	if (context.isError) {
		output = result.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
		if (output) output = theme.fg("error", output);
	} else if (result.details?.diff) {
		output = renderDiff(result.details.diff);
	}
	if (!output) return component;
	output = limitRenderedLines(output, Boolean(options.expanded), theme);
	component.addChild(new Spacer(1));
	component.addChild(new Text(output, 1, 0));
	return component;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool<typeof schema, ApplyPatchDetails | undefined>({
		name: "apply_patch",
		label: "apply_patch",
		description: "Apply a structured patch to add, update, delete, or move files. Use this for multi-location or multi-file edits instead of batching edit calls. Patch text must start with *** Begin Patch and end with *** End Patch. Each file section must use *** Add File: <path>, *** Update File: <path>, or *** Delete File: <path>; updates may include *** Move to: <path>. Add File content lines must start with +. Update hunks use @@ markers with space context lines, - removals, and + additions.",
		promptSnippet: "Apply a structured multi-file patch",
		parameters: schema,
		renderCall: renderPatchCall,
		renderResult: renderPatchResult,
		async execute(_id, { patchText }, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Operation aborted");
			const changes = await deriveChanges(ctx.cwd, patchText);
			if (changes.length === 0) throw new Error("patch rejected: no file sections found");
			const touched = changes.map((change) => change.moveTo ?? change.path);
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
			const fullDiff = changes.map((change) => diff(change.moveTo ?? change.path, change.oldText, change.newText)).join("\n");
			return {
				content: [{ type: "text", text: `Applied patch to ${touched.length} file(s):\n${touched.join("\n")}` }],
				details: { diff: fullDiff, files: touched },
			};
		},
	});
}
