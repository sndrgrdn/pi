import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function bashDescription(pi: ExtensionAPI) {
  const { prepareArguments: _, ...bash } = createBashToolDefinition(process.cwd());

  pi.registerTool({
    ...bash,
    parameters: Type.Object({
      description: Type.String({
        description:
          "What this command does, in 3 to 8 words, shown to the user. Example: 'List extension files'.",
      }),
      ...bash.parameters.properties,
    }),
    execute: (toolCallId, { command, timeout }, signal, onUpdate, ctx) =>
      bash.execute(toolCallId, { command, timeout }, signal, onUpdate, ctx),
  });
}
