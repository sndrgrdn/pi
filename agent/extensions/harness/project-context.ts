import { getAgentDir, loadProjectContextFiles } from "@earendil-works/pi-coding-agent";

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function projectContextPrompt(cwd: string): string {
	const files = loadProjectContextFiles({ cwd, agentDir: getAgentDir() });
	if (files.length === 0) return "";
	return `<project_context>\n${files.map((file) => `<project_instructions path="${escapeAttribute(file.path)}">\n${file.content}\n</project_instructions>`).join("\n")}\n</project_context>`;
}
