import { createReadToolDefinition } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createMoriReadTool } from "../tools/read.ts";
import { summarizeToolCall } from "./tool-call.ts";

describe("tool call summaries", () => {
	it("uses the registered Trace invocation formatter", () => {
		expect(summarizeToolCall(createMoriReadTool(), "read", { path: "/repo/src/app.ts" }, "call-1", "/repo")).toBe(
			"read ./src/app.ts",
		);
	});

	it("reuses an SDK tool's existing call renderer", () => {
		expect(
			summarizeToolCall(createReadToolDefinition("/repo"), "read", { path: "src/app.ts" }, "call-1", "/repo"),
		).toBe("read src/app.ts");
	});
});
