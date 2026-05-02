import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, resolve } from "path";
import { Type } from "typebox";

const schema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Complete file content to write. Overwrites any existing content." }),
});

const resolvePath = (cwd: string, path: string) => resolve(cwd, path.replace(/^@/, ""));
const splitBom = (text: string) => text.charCodeAt(0) === 0xfeff ? { bom: true, text: text.slice(1) } : { bom: false, text };
const joinBom = (text: string, bom: boolean) => bom ? `\uFEFF${text}` : text;

async function existingBom(path: string) {
	try {
		return splitBom(await readFile(path, "utf-8")).bom;
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
		throw error;
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "write",
		label: "write",
		description: [
			"Write a complete file. Creates parent directories automatically. Preserves UTF-8 BOM when present.",
			"Do not proactively create documentation/README files unless explicitly requested.",
		].join(" "),
		promptSnippet: "Create or overwrite a complete file",
		parameters: schema,
		async execute(_id, { path, content }, signal, _onUpdate, ctx) {
			const absolutePath = resolvePath(ctx.cwd, path);
			return withFileMutationQueue(absolutePath, async () => {
				if (signal?.aborted) throw new Error("Operation aborted");
				const next = splitBom(content);
				const bom = (await existingBom(absolutePath)) || next.bom;
				await mkdir(dirname(absolutePath), { recursive: true });
				await writeFile(absolutePath, joinBom(next.text, bom), "utf-8");
				return { content: [{ type: "text", text: `Wrote ${next.text.length} characters to ${path}` }], details: undefined };
			});
		},
	});
}
