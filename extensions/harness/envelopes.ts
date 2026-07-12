import type { AgentKey } from "./registry.ts";

export type EnvelopeKind = AgentKey | "task_error";

export type EnvelopeInput =
	| { kind: "finder"; sessionID: string; content: string; title: string }
	| { kind: Exclude<EnvelopeKind, "finder">; sessionID: string; content: string };

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function buildEnvelope(input: EnvelopeInput): string {
	const tag = input.kind === "task_error" ? input.kind : `${input.kind}_result`;
	const title = input.kind === "finder"
		? ` title="${escapeAttribute(input.title)}"`
		: "";
	return `<${tag}${title} sessionID="${escapeAttribute(input.sessionID)}">\n${input.content}\n</${tag}>`;
}
