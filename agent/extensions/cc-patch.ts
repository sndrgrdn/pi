/**
 * CC Prompt Patch — patches pi's built-in provider (no token swap)
 *
 * Uses pi's OWN OAuth token. Only patches the request payload:
 * 1. Adds billing header for subscription rate-limit bucket
 * 2. Strips the separate identity prefix block that triggers detection
 *
 * Preserves ALL of pi's built-in behaviors: prompt caching, session routing,
 * compaction, tool name mapping, thinking modes, token refresh, etc.
 *
 * REQUIRES: /login (pi's normal OAuth)
 *
 * https://github.com/picassio/pi-cc-patch
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHash } from "crypto";

const CLAUDE_CODE_VERSION = "2.1.160";
const FINGERPRINT_SALT = "59cf53e54c78";

function getFirstUserText(payload: Record<string, any>): string {
	const firstUserMessage = payload.messages.find((message: any) => message?.role === "user");
	const content = firstUserMessage?.content;

	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const textBlock = content.find((block: any) => block?.type === "text" && typeof block.text === "string");
		return textBlock?.text ?? "";
	}

	return "";
}

function computeFingerprint(messageText: string): string {
	const chars = [4, 7, 20].map((index) => messageText[index] || "0").join("");
	return createHash("sha256").update(`${FINGERPRINT_SALT}${chars}${CLAUDE_CODE_VERSION}`).digest("hex").slice(0, 3);
}

function getClaudeCodeBillingHeader(payload: Record<string, any>): string {
	const fingerprint = computeFingerprint(getFirstUserText(payload));
	return `x-anthropic-billing-header: cc_version=${CLAUDE_CODE_VERSION}.${fingerprint}; cc_entrypoint=cli;`;
}

function isAnthropicTarget(
	payload: Record<string, any>,
	model: { provider?: string; id?: string } | undefined,
): boolean {
	const provider = typeof model?.provider === "string" ? model.provider.toLowerCase() : "";
	const modelId = typeof model?.id === "string" ? model.id.toLowerCase() : "";
	const payloadModel = typeof payload.model === "string" ? payload.model.toLowerCase() : "";

	return (
		provider.includes("anthropic") ||
		modelId.includes("claude") ||
		payloadModel.includes("anthropic") ||
		payloadModel.includes("claude")
	);
}

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", async (event, ctx) => {
		const payload = event.payload as Record<string, any>;
		if (!payload || typeof payload !== "object") return;
		if (!Array.isArray(payload.messages)) return;
		if (!isAnthropicTarget(payload, ctx.model as { provider?: string; id?: string } | undefined)) return;

		const billingHeader = getClaudeCodeBillingHeader(payload);

		if (Array.isArray(payload.system)) {
			const newBlocks: unknown[] = [];

			newBlocks.push({
				type: "text",
				text: billingHeader,
			});

			for (const block of payload.system) {
				if (block.type !== "text" || !block.text) {
					newBlocks.push(block);
					continue;
				}
				if (block.text.startsWith("x-anthropic-billing-header")) continue;
				if (block.text.startsWith("You are") && block.text.includes("official CLI")) continue;

				newBlocks.push(block);
			}

			payload.system = newBlocks;
		} else if (typeof payload.system === "string") {
			payload.system = [
				{ type: "text", text: billingHeader },
				{ type: "text", text: payload.system },
			];
		}

		if (!payload.metadata) {
			payload.metadata = {
				user_id: JSON.stringify({ device_id: "0", account_uuid: "", session_id: "0" }),
			};
		}

		return payload;
	});
}
