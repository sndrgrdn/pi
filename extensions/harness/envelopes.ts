import type { AgentKey } from "./registry.ts";

export type EnvelopeKind = AgentKey | "task_error";

export type EnvelopeInput =
	| { kind: "finder"; sessionID: string; content: string; title: string }
	| { kind: Exclude<EnvelopeKind, "finder">; sessionID: string; content: string };

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function decodeAttribute(value: string): string {
	return value.replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

export interface ParsedEnvelope {
	tag: string;
	title?: string;
	sessionID: string;
	content: string;
}

export function parseEnvelope(value: string): ParsedEnvelope | undefined {
	const match = value.match(/^<([a-z_]+)([^>]*)>\n?([\s\S]*?)\n?<\/\1>$/);
	if (!match?.[1] || match[2] === undefined || match[3] === undefined) return undefined;
	const attribute = (name: string) => match[2]?.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
	const sessionID = attribute("sessionID");
	if (sessionID === undefined) return undefined;
	const title = attribute("title");
	return {
		tag: match[1],
		title: title === undefined ? undefined : decodeAttribute(title),
		sessionID: decodeAttribute(sessionID),
		content: match[3].trim(),
	};
}

export function buildEnvelope(input: EnvelopeInput): string {
	const tag = input.kind === "task_error" ? input.kind : `${input.kind}_result`;
	const title = input.kind === "finder"
		? ` title="${escapeAttribute(input.title)}"`
		: "";
	return `<${tag}${title} sessionID="${escapeAttribute(input.sessionID)}">\n${input.content}\n</${tag}>`;
}
