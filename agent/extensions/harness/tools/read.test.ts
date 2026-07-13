import { copyFileSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHarnessReadTool } from "./read.ts";

const theme = {
	fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
	bold: (value: string) => `<b>${value}</b>`,
} as any;

function renderedLines(component: { render(width: number): string[] }): string[] {
	return component.render(200).map((line) => line.trimEnd());
}

describe("read Trace View renderer", () => {
	it("shows the path and requested range while keeping text behind expansion", () => {
		const tool = createHarnessReadTool();
		const result = { content: [{ type: "text", text: "second\nthird" }] } as any;
		const context = {
			args: { path: "src/file.ts", offset: 2, limit: 2 },
			cwd: "/work",
			isError: false,
		} as any;

		expect(renderedLines(tool.renderResult!(result, { expanded: false, isPartial: false }, theme, context))).toEqual([
			" <success>✓</success> <b>read</b> ./src/file.ts · <muted>lines 2-3</muted>",
		]);
		expect(renderedLines(tool.renderResult!(result, { expanded: true, isPartial: false }, theme, context))).toEqual([
			" <success>✓</success> <b>read</b> ./src/file.ts · <muted>lines 2-3</muted>",
			" <toolOutput>second</toolOutput>",
			" <toolOutput>third</toolOutput>",
		]);
	});

	it("shows image MIME type while leaving the attachment available for Pi's preview", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "read-trace-image-"));
		copyFileSync(
			join(
				process.cwd(),
				"node_modules/.pnpm/highlight.js@10.7.3/node_modules/highlight.js/styles/brown-papersq.png",
			),
			join(cwd, "pixel.png"),
		);
		const tool = createHarnessReadTool();
		const updates: any[] = [];
		const result = await tool.execute(
			"read-1",
			{ path: "pixel.png" },
			undefined,
			(update: any) => updates.push(update),
			{ cwd } as any,
		);

		expect(updates[0]?.details).toEqual({ trace: { state: "running" } });
		expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image" })]));
		expect(result.details).toEqual({ trace: { state: "success", qualifiers: ["image/png"] } });
		expect(
			renderedLines(
				tool.renderResult!(result, { expanded: false, isPartial: false }, theme, {
					args: { path: "pixel.png" },
					cwd,
					isError: false,
				} as any),
			),
		).toEqual([" <success>✓</success> <b>read</b> ./pixel.png · <muted>image/png</muted>"]);
	});

	it.each(["image/jpeg", "image/png", "image/gif", "image/webp"])(
		"renders the supported %s qualifier while collapsed",
		(mimeType) => {
			const tool = createHarnessReadTool();
			const component = tool.renderResult!(
				{
					content: [{ type: "image", data: "base64", mimeType }],
					details: { trace: { state: "success", qualifiers: [mimeType] } },
				} as any,
				{ expanded: false, isPartial: false },
				theme,
				{ args: { path: "image.bin" }, cwd: "/work", isError: false } as any,
			);
			expect(renderedLines(component)).toEqual([
				` <success>✓</success> <b>read</b> ./image.bin · <muted>${mimeType}</muted>`,
			]);
		},
	);

	it.each([
		["inside cwd", "/work/src/file.ts", "/work", "./src/file.ts"],
		["home outside cwd", join(homedir(), "notes/file.txt"), "/work", "~/notes/file.txt"],
		["outside cwd and home", "/opt/shared/file.txt", "/work", "/opt/shared/file.txt"],
	])("applies path policy for %s", (_case, path, cwd, expectedPath) => {
		const tool = createHarnessReadTool();
		const component = tool.renderResult!(
			{ content: [{ type: "text", text: "hidden" }] } as any,
			{ expanded: false, isPartial: false },
			theme,
			{ args: { path }, cwd, isError: false } as any,
		);
		expect(renderedLines(component)).toEqual([` <success>✓</success> <b>read</b> ${expectedPath}`]);
	});

	it.each([
		[{ offset: 5 }, "lines 5-"],
		[{ limit: 10 }, "lines 1-10"],
	])("renders deterministic open and bounded requested ranges", (range, expected) => {
		const tool = createHarnessReadTool();
		const component = tool.renderResult!(
			{ content: [{ type: "text", text: "hidden" }] } as any,
			{ expanded: false, isPartial: false },
			theme,
			{ args: { path: "file.ts", ...range }, cwd: "/work", isError: false } as any,
		);
		expect(renderedLines(component)).toEqual([
			` <success>✓</success> <b>read</b> ./file.ts · <muted>${expected}</muted>`,
		]);
	});

	it("renders a missing file as one failed row with expandable evidence", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "read-trace-missing-"));
		const tool = createHarnessReadTool();
		await expect(
			tool.execute("read-1", { path: "missing.txt" }, undefined, undefined, { cwd } as any),
		).rejects.toThrow(/ENOENT/);
		const result = { content: [{ type: "text", text: "ENOENT: no such file or directory" }] } as any;
		const context = { args: { path: "missing.txt" }, cwd, isError: true } as any;

		expect(renderedLines(tool.renderResult!(result, { expanded: false, isPartial: false }, theme, context))).toEqual([
			" <error>✗</error> <b>read</b> ./missing.txt",
		]);
		expect(renderedLines(tool.renderResult!(result, { expanded: true, isPartial: false }, theme, context))).toEqual([
			" <error>✗</error> <b>read</b> ./missing.txt",
			" <toolOutput>ENOENT: no such file or directory</toolOutput>",
		]);
	});

	it("propagates read cancellation to the shared Trace lifecycle", async () => {
		const tool = createHarnessReadTool();
		const controller = new AbortController();
		controller.abort();

		await expect(
			tool.execute("read-1", { path: "file.txt" }, controller.signal, undefined, { cwd: "/work" } as any),
		).rejects.toThrow(/aborted/);
	});
});
