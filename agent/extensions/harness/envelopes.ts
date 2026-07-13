import { AGENT_KEYS, type AgentKey } from "./profiles.ts";

export type EnvelopeInput =
	| { kind: "finder"; sessionID: string; content: string; title: string }
	| { kind: Exclude<AgentKey, "finder">; sessionID: string; content: string }
	| { kind: "error"; agent: AgentKey; sessionID: string; content: string };

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function decodeAttribute(value: string): string {
	return value.replaceAll("&quot;", '"').replaceAll("&gt;", ">").replaceAll("&lt;", "<").replaceAll("&amp;", "&");
}

type EnvelopeTag = `${AgentKey}_result` | `${AgentKey}_error`;

/** The tag grammar mirrors what `buildEnvelope` can emit: one result and one error tag per agent. */
const ENVELOPE_TAGS: readonly EnvelopeTag[] = AGENT_KEYS.flatMap((key): EnvelopeTag[] => [
	`${key}_result`,
	`${key}_error`,
]);

export type ParsedEnvelope =
	| { tag: "finder_result"; title: string; sessionID: string; content: string }
	| { tag: Exclude<EnvelopeTag, "finder_result">; sessionID: string; content: string };

export function parseEnvelope(value: string): ParsedEnvelope | undefined {
	const match = value.match(/^<([a-z_]+)([^>]*)>\n?([\s\S]*?)\n?<\/\1>$/);
	if (!match?.[1] || match[2] === undefined || match[3] === undefined) return undefined;
	const attribute = (name: string) => match[2]?.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
	const sessionID = attribute("sessionID");
	if (sessionID === undefined) return undefined;
	const tag = match[1] as EnvelopeTag;
	if (!ENVELOPE_TAGS.includes(tag)) return undefined;
	const title = attribute("title");
	const common = { sessionID: decodeAttribute(sessionID), content: match[3] };
	if (tag === "finder_result") {
		if (title === undefined) return undefined;
		return { tag, title: decodeAttribute(title), ...common };
	}
	if (title !== undefined) return undefined;
	return { tag, ...common };
}

export function buildEnvelope(input: EnvelopeInput): string {
	const tag = input.kind === "error" ? `${input.agent}_error` : `${input.kind}_result`;
	const title = input.kind === "finder" ? ` title="${escapeAttribute(input.title)}"` : "";
	return `<${tag}${title} sessionID="${escapeAttribute(input.sessionID)}">\n${input.content}\n</${tag}>`;
}
