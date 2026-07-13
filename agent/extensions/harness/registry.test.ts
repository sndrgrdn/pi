import { describe, expect, it } from "vitest";
import { AGENT_TOOLBOX_MATRIX, resolveAgentDefinition } from "./registry.ts";

describe("subagent registry", () => {
	it("builds a flat definition from a pre-resolved route", () => {
		const entry = resolveAgentDefinition(
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
});

describe("agent toolbox matrix", () => {
	it("matches the admitted child surfaces", () => {
		expect(AGENT_TOOLBOX_MATRIX).toEqual({
			finder: {
				tools: ["read", "grep", "find", "ls"],
				allowMcp: false,
			},
			librarian: {
				tools: ["checkout", "grep", "find", "read", "shell_command", "shell_command_status", "shell_command_cancel", "web_search_exa", "web_fetch_exa"],
				allowMcp: false,
			},
			oracle: {
				tools: ["shell_command", "shell_command_status", "shell_command_cancel", "finder", "librarian"],
				allowMcp: false,
			},
			task: {
				tools: ["shell_command", "shell_command_status", "shell_command_cancel", "read", "apply_patch", "skill", "finder", "librarian"],
				allowMcp: true,
			},
		});
	});

	it("keeps the shell triplet indivisible and delegation depth bounded", () => {
		const shellTriplet = ["shell_command", "shell_command_status", "shell_command_cancel"];
		for (const definition of Object.values(AGENT_TOOLBOX_MATRIX)) {
			const tools: readonly string[] = definition.tools;
			const admitted = shellTriplet.filter((tool) => tools.includes(tool));
			expect(admitted).toHaveLength(admitted.length === 0 ? 0 : shellTriplet.length);
		}
		expect(AGENT_TOOLBOX_MATRIX.task.tools).not.toContain("task");
		expect(AGENT_TOOLBOX_MATRIX.task.tools).not.toContain("oracle");
	});
});
