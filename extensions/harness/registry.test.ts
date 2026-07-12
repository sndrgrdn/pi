import { describe, expect, it } from "vitest";
import { AgentRegistry, defineAgent } from "./registry.ts";

describe("subagent registry", () => {
	it("builds a flat definition from a pre-resolved route", () => {
		const entry = defineAgent(
			{
				key: "oracle",
				systemPrompt: "Review carefully.",
				tools: ["finder"],
				allowMcp: false,
			},
			{ model: "openai-codex/gpt-5.6-sol", reasoning: "high" },
		);

		expect(entry).toEqual({
			key: "oracle",
			model: "openai-codex/gpt-5.6-sol",
			reasoningEffort: "high",
			systemPrompt: "Review carefully.",
			tools: ["finder"],
			allowMcp: false,
		});
		expect(entry).not.toHaveProperty("routes");
		expect(entry).not.toHaveProperty("maxTurns");
	});

	it("looks up definitions by their flat key", () => {
		const oracle = defineAgent(
			{ key: "oracle", systemPrompt: "Review.", tools: [], allowMcp: false },
			{ model: "openai-codex/gpt-5.6-sol", reasoning: "high" },
		);
		const registry = new AgentRegistry([oracle]);

		expect(registry.get("oracle")).toBe(oracle);
		expect(() => registry.get("finder")).toThrow('unknown agent "finder"');
	});
});
