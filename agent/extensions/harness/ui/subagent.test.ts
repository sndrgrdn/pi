import { Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { createSubagentRenderer } from "./subagent.ts";

describe("shared subagent tool renderer", () => {
	const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;
	const renderer = createSubagentRenderer({ running: "Finder searching", complete: "Finder finished" });

	it("updates one component from query and actions to the XML title", () => {
		const call = renderer.renderCall({ detail: "find auth" }, theme, { lastComponent: undefined });
		expect(call.render(100)).toEqual([]);
		const row = renderer.renderResult(
			{ content: [{ type: "text", text: "searching" }], details: { state: "running", query: "find auth", actions: { grep: 2, read: 1 } } },
			{ expanded: false }, theme, { lastComponent: undefined },
		);
		expect(row.render(100)[0]?.trimEnd()).toBe("◐ Finder searching — find auth — grep ×2, read ×1");

		const completed = renderer.renderResult(
			{ content: [{ type: "text", text: '<finder_result title="Auth files" sessionID="one">\n/abs/auth.ts:2\n</finder_result>' }], details: {} },
			{ expanded: false }, theme, { lastComponent: row },
		);
		expect(completed).toBe(row);
		expect(row.render(100)[0]?.trimEnd()).toBe("✓ Auth files");
	});

	it("shows envelope content when expanded", () => {
		const row = renderer.renderResult(
			{ content: [{ type: "text", text: '<finder_result title="Auth" sessionID="one">\n/abs/auth.ts:2\n</finder_result>' }] },
			{ expanded: true }, theme, { lastComponent: new Text("", 0, 0) },
		);
		expect(row.render(100).map((line) => line.trimEnd())).toEqual(["✓ Auth", "/abs/auth.ts:2"]);
	});
});
