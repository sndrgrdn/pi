import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  // Subagents get their session names from pi-subagents.
  if (process.env.PI_SUBAGENT_CHILD === "1") return;

  pi.registerTool({
    name: "set_session_name",
    label: "Set Session Name",
    description:
      "Name the current session. The name labels it in the session list, and other sessions address it by that name over intercom. " +
      "Call it when work starts on a feature, bug, or ticket, when you open a pull request, and when the user asks. " +
      "Rename the session when its work changes.",
    parameters: Type.Object({
      name: Type.String({
        description:
          "Kebab-case, under 40 characters, naming the work and any ticket or pull request number. " +
          "Examples: 'pr-42-checkout-refactor', 'bq-1337-deposit-calculation', 'caching-research'.",
      }),
    }),
    async execute(_toolCallId, params) {
      const trimmed = params.name.trim();

      if (!trimmed) {
        return {
          content: [{ type: "text", text: "Name cannot be empty." }],
          details: {},
          isError: true,
        };
      }

      pi.setSessionName(trimmed);

      return { content: [{ type: "text", text: `Session named: ${trimmed}` }], details: {} };
    },
  });
}
