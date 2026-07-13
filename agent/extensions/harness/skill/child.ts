import { getAgentDir, loadSkills, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { availableSkillsBlock, renderSkillContent, type SkillEntry } from "./core.ts";

export function discoverChildSkills(cwd: string): SkillEntry[] {
	return loadSkills({ cwd, agentDir: getAgentDir(), skillPaths: [], includeDefaults: true }).skills.map(
		({ name, description, filePath, baseDir }) => ({
			name,
			description,
			filePath,
			baseDir,
		}),
	);
}

export function createChildSkillTool(skills: readonly SkillEntry[]): ToolDefinition<any, any, any> {
	const unavailable = (name: string) =>
		availableSkillsBlock(
			skills.map((entry) => entry.name),
			name,
		);
	return {
		name: "skill",
		label: "skill",
		description: "Load a skill by exact name.",
		parameters: Type.Object({ name: Type.String() }),
		async execute(_id: string, params: { name: string }) {
			const skill = skills.find((entry) => entry.name === params.name);
			if (!skill) throw new Error(`Unknown skill "${params.name}".\n${unavailable(params.name)}`);
			try {
				return { content: [{ type: "text", text: renderSkillContent(skill) }], details: { skill: skill.name } };
			} catch (error) {
				throw new Error(
					`Failed to load skill "${params.name}" from ${skill.filePath}: ${error instanceof Error ? error.message : String(error)}\n${unavailable(params.name)}`,
				);
			}
		},
	} as unknown as ToolDefinition<any, any, any>;
}
