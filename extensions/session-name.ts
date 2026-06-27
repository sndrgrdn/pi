import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
	// Don't register for subagents — they use pre-set session names
	if (process.env.PI_SUBAGENT) return;

	pi.registerTool({
		name: "set_session_name",
		label: "Set Session Name",
		description:
			"Name the current session for later retrieval. Call proactively when: " +
			"(1) a PR is created or updated — use 'PR #<number> — <title>', " +
			"(2) work begins on a specific feature, bug, or ticket — include the identifier, " +
			"(3) the user asks to name or rename the session. " +
			"Update the name when scope changes (e.g. PR title changes, topic shifts). " +
			"Keep names under 60 characters.",
		parameters: Type.Object({
			name: Type.String({
				description:
					"Short label. Examples: 'PR #42 — Refactor checkout', " +
					"'BQ-1337 — Fix deposit calculation', 'Explore caching strategies'",
			}),
		}),
		async execute(_toolCallId, params) {
			const trimmed = params.name.trim();
			if (!trimmed) {
				return { content: [{ type: "text", text: "Name cannot be empty." }], details: {}, isError: true };
			}
			pi.setSessionName(trimmed);
			return { content: [{ type: "text", text: `Session named: ${trimmed}` }], details: {} };
		},
	});
}
