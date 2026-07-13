import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTraceRenderer, formatTracePath, shellTraceInvocation } from "./trace.ts";

const theme = {
	fg: (color: string, value: string) => `<${color}>${value}</${color}>`,
	bold: (value: string) => `<b>${value}</b>`,
} as any;

function lines(component: { render(width: number): string[] }): string[] {
	return component.render(200).map((line) => line.trimEnd());
}

describe("Trace renderer", () => {
	const renderer = createTraceRenderer<{ command: string; workdir?: string }>({
		invocation: shellTraceInvocation,
	});

	it.each([
		[{ isPartial: true, isError: false, details: undefined }, "<accent>◐</accent> <b>$</b> echo ok"],
		[{ isPartial: false, isError: false, details: undefined }, "<success>✓</success> <b>$</b> echo ok"],
		[{ isPartial: false, isError: true, details: undefined }, "<error>✗</error> <b>$</b> echo ok"],
		[
			{ isPartial: false, isError: false, details: { trace: { state: "cancelled" } } },
			"<warning>■</warning> <b>$</b> echo ok",
		],
	])("renders mechanical state without coloring the row", (state, expected) => {
		const component = renderer.renderResult(
			{ content: [{ type: "text", text: "ignored output" }], details: state.details },
			{ expanded: false, isPartial: state.isPartial },
			theme,
			{ args: { command: "echo ok" }, cwd: "/work", isError: state.isError },
		);
		expect(lines(component)).toEqual([expected]);
	});

	it("keeps output hidden until expanded", () => {
		const collapsed = renderer.renderResult(
			{ content: [{ type: "text", text: "first\nsecond" }] },
			{ expanded: false, isPartial: false },
			theme,
			{ args: { command: "printf output" }, cwd: "/work", isError: false },
		);
		expect(lines(collapsed)).toEqual(["<success>✓</success> <b>$</b> printf output"]);

		const expanded = renderer.renderResult(
			{ content: [{ type: "text", text: "first\nsecond" }] },
			{ expanded: true, isPartial: false },
			theme,
			{ args: { command: "printf output" }, cwd: "/work", isError: false },
		);
		expect(lines(expanded)).toEqual([
			"<success>✓</success> <b>$</b> printf output",
			"<toolOutput>first</toolOutput>",
			"<toolOutput>second</toolOutput>",
		]);
	});

	it("uses the first non-empty command line and shows a material workdir", () => {
		const invocation = shellTraceInvocation(
			{ command: "\n  echo first\necho second", workdir: "/work/app" },
			"/work",
		);
		expect(invocation).toEqual({ action: "$", target: "echo first …", qualifiers: ["in ./app"] });
	});
});

describe("formatTracePath", () => {
	it("uses cwd-relative, home-relative, and external absolute paths", () => {
		expect(formatTracePath("/work/app/file.ts", "/work/app", "/Users/test")).toBe("./file.ts");
		expect(formatTracePath(join(homedir(), "notes/file.txt"), "/work/app", homedir())).toBe("~/notes/file.txt");
		expect(formatTracePath("/opt/shared/file.txt", "/work/app", "/Users/test")).toBe("/opt/shared/file.txt");
	});
});
