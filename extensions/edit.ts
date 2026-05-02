import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue, type EditToolDetails } from "@mariozechner/pi-coding-agent";
import { constants } from "fs";
import { access, readFile, writeFile } from "fs/promises";
import { resolve } from "path";
import { Type } from "typebox";

const schema = Type.Object({
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	oldString: Type.String({ description: "Exact text to replace. Must match exactly once in the file unless replaceAll=true." }),
	newString: Type.String({ description: "Replacement text. Must be different from oldString." }),
	replaceAll: Type.Optional(Type.Boolean({ description: "Replace every occurrence of oldString. Only use when every occurrence should change." })),
}, { additionalProperties: false });

const resolvePath = (cwd: string, path: string) => resolve(cwd, path.replace(/^@/, ""));
const splitBom = (text: string) => text.charCodeAt(0) === 0xfeff ? { bom: true, text: text.slice(1) } : { bom: false, text };
const joinBom = (text: string, bom: boolean) => bom ? `\uFEFF${text}` : text;
const lineOf = (s: string, index: number) => s.slice(0, index).split("\n").length;

function lineEnding(text: string) {
	return text.includes("\r\n") ? "\r\n" : "\n";
}

function convertLineEndings(text: string, ending: string) {
	const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
	return ending === "\r\n" ? normalized.replaceAll("\n", "\r\n") : normalized;
}

function simpleDiff(path: string, oldText: string, newText: string) {
	return `--- ${path}\n+++ ${path}\n@@\n${oldText.split("\n").map((line) => `-  ${line}`).join("\n")}\n${newText.split("\n").map((line) => `+  ${line}`).join("\n")}\n`;
}

function apply(content: string, oldString: string, newString: string, replaceAll = false) {
	if (oldString === newString) throw new Error("No changes to apply: oldString and newString are identical");
	const start = content.indexOf(oldString);
	if (start < 0) throw new Error("oldString not found in file");
	if (replaceAll) return { out: content.replaceAll(oldString, newString), firstChangedLine: lineOf(content, start) };
	if (content.indexOf(oldString, start + oldString.length) >= 0) throw new Error("oldString must match exactly once. Add more context or set replaceAll=true.");
	return { out: content.slice(0, start) + newString + content.slice(start + oldString.length), firstChangedLine: lineOf(content, start) };
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "edit",
		label: "edit",
		description: [
			"Perform one exact string replacement in a file.",
			"Preserves UTF-8 BOM and existing line endings.",
		].join(" "),
		promptSnippet: "Replace one exact string in a file",
		parameters: schema,
		async execute(_id, { path, oldString, newString, replaceAll }, signal, _onUpdate, ctx) {
			const absolutePath = resolvePath(ctx.cwd, path);
			return withFileMutationQueue(absolutePath, async () => {
				if (signal?.aborted) throw new Error("Operation aborted");
				await access(absolutePath, constants.R_OK | constants.W_OK);
				const source = splitBom(await readFile(absolutePath, "utf-8"));
				const ending = lineEnding(source.text);
				const oldText = convertLineEndings(oldString, ending);
				const newText = convertLineEndings(newString, ending);
				const { out, firstChangedLine } = apply(source.text, oldText, newText, replaceAll);
				await writeFile(absolutePath, joinBom(out, source.bom), "utf-8");
				const details: EditToolDetails = { diff: simpleDiff(path, oldText, newText), firstChangedLine };
				return { content: [{ type: "text", text: `Applied edit to ${path}:${firstChangedLine}` }], details };
			});
		},
	});
}
