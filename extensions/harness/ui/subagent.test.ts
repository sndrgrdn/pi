import { describe, expect, it } from "vitest";
import { Text } from "@earendil-works/pi-tui";
import { parseSubagentEnvelope, renderSubagentCall, renderSubagentResult, renderSubagentRow } from "./subagent.ts";

describe("shared subagent row", () => {
	it("renders spinner, running label, and detail on one row", () => {
		expect(renderSubagentRow({ state: "running", label: "Oracle exploring", detail: "check races" }))
			.toEqual(["◐ Oracle exploring — check races"]);
	});

	it("reveals the transcript only when expanded", () => {
		const completed = { state: "complete" as const, label: "Oracle has spoken", detail: "check races", transcript: "read a.ts\nfound mutex" };
		expect(renderSubagentRow(completed, false)).toEqual(["✓ Oracle has spoken — check races"]);
		expect(renderSubagentRow(completed, true)).toEqual([
			"✓ Oracle has spoken — check races",
			"  read a.ts",
			"  found mutex",
		]);
	});
});

describe("shared subagent tool renderer", () => {
	const theme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as any;

	it("parses harness XML attributes and content", () => {
		expect(parseSubagentEnvelope('<finder_result title="Auth &amp; sessions" sessionID="child-1">\n/abs/auth.ts:2\n</finder_result>'))
			.toEqual({ tag: "finder_result", title: "Auth & sessions", sessionID: "child-1", content: "/abs/auth.ts:2" });
	});

	it("updates one component from query and actions to the XML title", () => {
		const row = renderSubagentCall({ label: "Finder searching", detail: "find auth" }, theme, { lastComponent: undefined }) as Text;
		renderSubagentResult({
			result: { content: [{ type: "text", text: "searching" }], details: { state: "running", query: "find auth", actions: { grep: 2, read: 1 } } },
			options: { expanded: false }, theme, context: { lastComponent: row },
			labels: { running: "Finder searching", complete: "Finder finished" },
		});
		expect(row.render(100)[0]?.trimEnd()).toBe("◐ Finder searching — find auth — grep ×2, read ×1");

		const completed = renderSubagentResult({
			result: { content: [{ type: "text", text: '<finder_result title="Auth files" sessionID="one">\n/abs/auth.ts:2\n</finder_result>' }], details: {} },
			options: { expanded: false }, theme, context: { lastComponent: row },
			labels: { running: "Finder searching", complete: "Finder finished" },
		});
		expect(completed).toBe(row);
		expect(row.render(100)[0]?.trimEnd()).toBe("✓ Auth files");
	});
});
