import type { AgentKey } from "./registry.ts";

export type EnvelopeKind = AgentKey | "task_error";

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildEnvelope(
	kind: EnvelopeKind,
	sessionID: string,
	content: string,
	options: { title?: string } = {},
): string {
	const tag = kind === "task_error" ? kind : `${kind}_result`;
	const title = kind === "finder" && options.title !== undefined
		? ` title="${escapeAttribute(options.title)}"`
		: "";
	return `<${tag}${title} sessionID="${escapeAttribute(sessionID)}">\n${content}\n</${tag}>`;
}
