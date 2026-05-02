import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead, type ReadToolDetails } from "@mariozechner/pi-coding-agent";
import { constants } from "fs";
import { access, open, readFile, readdir, stat } from "fs/promises";
import { resolve } from "path";
import { Type } from "typebox";

const SAMPLE_BYTES = 4096;

const schema = Type.Object({
	path: Type.String({ description: "Path to the file or directory to read (relative or absolute)" }),
	offset: Type.Optional(Type.Number({ description: "Line number or directory entry number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Number({ description: "Maximum number of lines or directory entries to read" })),
});

const resolvePath = (cwd: string, path: string) => resolve(cwd, path.replace(/^@/, ""));

function isBinary(bytes: Buffer) {
	if (bytes.length === 0) return false;
	let nonPrintable = 0;
	for (const byte of bytes) {
		if (byte === 0) return true;
		if (byte < 9 || (byte > 13 && byte < 32)) nonPrintable++;
	}
	return nonPrintable / bytes.length > 0.3;
}

async function readSample(path: string) {
	const file = await open(path, "r");
	try {
		const buffer = Buffer.alloc(SAMPLE_BYTES);
		const { bytesRead } = await file.read(buffer, 0, SAMPLE_BYTES, 0);
		return buffer.subarray(0, bytesRead);
	} finally {
		await file.close();
	}
}

function continuation(output: string, startLine: number, totalLines: number, limit: number | undefined, truncation: ReturnType<typeof truncateHead>) {
	if (truncation.truncated) {
		const end = startLine + truncation.outputLines;
		return `${output}\n\n[Showing lines ${startLine + 1}-${end} of ${totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${end + 1} to continue.]`;
	}
	if (limit !== undefined && startLine + limit < totalLines) {
		return `${output}\n\n[${totalLines - (startLine + limit)} more lines in file. Use offset=${startLine + limit + 1} to continue.]`;
	}
	return output;
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "read",
		label: "read",
		description: `Read a text file or list a directory from the local filesystem. Relative paths resolve from the current working directory. Directory entries are returned one per line with a trailing / for subdirectories. Binary files are rejected. Text output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB. Use offset/limit to read later sections; avoid tiny repeated chunks when a larger window is useful. Use search tools to locate specific content before reading large files.`,
		promptSnippet: "Read file or directory contents",
		parameters: schema,
		async execute(_id, { path, offset, limit }, signal, _onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Operation aborted");
			const absolutePath = resolvePath(ctx.cwd, path);
			await access(absolutePath, constants.R_OK);
			const info = await stat(absolutePath);
			const startLine = offset ? Math.max(0, offset - 1) : 0;

			if (info.isDirectory()) {
				const entries = (await readdir(absolutePath, { withFileTypes: true }))
					.map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
					.sort((a, b) => a.localeCompare(b));
				if (startLine >= entries.length && entries.length > 0) throw new Error(`Offset ${offset} is beyond end of directory (${entries.length} entries total)`);
				const selected = limit === undefined ? entries.slice(startLine).join("\n") : entries.slice(startLine, startLine + limit).join("\n");
				const truncation = truncateHead(selected);
				const output = continuation(truncation.content, startLine, entries.length, limit, truncation);
				const details: ReadToolDetails | undefined = truncation.truncated ? { truncation } : undefined;
				return { content: [{ type: "text", text: output }], details };
			}

			if (!info.isFile()) throw new Error(`Path is not a regular file: ${path}`);
			if (isBinary(await readSample(absolutePath))) throw new Error(`Cannot read binary file: ${path}`);

			const text = (await readFile(absolutePath)).toString("utf-8");
			const allLines = text.split("\n");
			if (startLine >= allLines.length) throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
			const selected = limit === undefined ? allLines.slice(startLine).join("\n") : allLines.slice(startLine, startLine + limit).join("\n");
			const truncation = truncateHead(selected);
			const output = continuation(truncation.content, startLine, allLines.length, limit, truncation);
			const details: ReadToolDetails | undefined = truncation.truncated ? { truncation } : undefined;
			return { content: [{ type: "text", text: output }], details };
		},
	});
}
