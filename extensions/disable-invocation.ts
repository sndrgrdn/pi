import { formatSkillsForPrompt, type ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function disableInvocation(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		const skills = event.systemPromptOptions.skills ?? [];
		if (skills.length === 0) return;

		const renderedSkillBlock = formatSkillsForPrompt(skills);
		if (!renderedSkillBlock) return;

		return {
			systemPrompt: event.systemPrompt.replace(renderedSkillBlock, ""),
		};
	});
}
