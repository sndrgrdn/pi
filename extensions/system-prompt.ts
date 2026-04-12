import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function usage(): string {
	return "Usage: /system-prompt [show|edit|save <path>]";
}

async function handleShow(pi: ExtensionAPI, ctx: ExtensionCommandContext, prompt: string): Promise<void> {
	if (!ctx.hasUI) {
		pi.sendMessage({ customType: "system-prompt", content: prompt, display: true }, { triggerTurn: false });
		return;
	}

	ctx.ui.setEditorText(prompt);
	ctx.ui.notify("System prompt loaded into editor", "info");
}

async function handleEdit(pi: ExtensionAPI, ctx: ExtensionCommandContext, prompt: string): Promise<void> {
	if (!ctx.hasUI) {
		pi.sendMessage({ customType: "system-prompt", content: prompt, display: true }, { triggerTurn: false });
		return;
	}

	const edited = await ctx.ui.editor("System Prompt", prompt);
	if (edited !== undefined) {
		ctx.ui.setEditorText(edited);
		ctx.ui.notify("Edited prompt loaded into editor", "info");
	}
}

async function handleSave(ctx: ExtensionCommandContext, prompt: string, targetArg: string): Promise<void> {
	const targetPath = resolve(ctx.cwd, targetArg);
	await writeFile(targetPath, prompt, "utf8");
	if (ctx.hasUI) {
		ctx.ui.notify(`System prompt saved to ${targetPath}`, "info");
	}
}

export default function systemPromptExtension(pi: ExtensionAPI) {
	pi.registerCommand("system-prompt", {
		description: "Show effective system prompt (/system-prompt [show|edit|save <path>])",
		handler: async (args, ctx) => {
			const prompt = ctx.getSystemPrompt();
			const rawArgs = args.trim();

			if (!prompt || prompt.length === 0) {
				if (ctx.hasUI) {
					ctx.ui.notify("No system prompt available", "warning");
				}
				return;
			}

			if (rawArgs === "" || rawArgs === "show") {
				await handleShow(pi, ctx, prompt);
				return;
			}

			if (rawArgs === "edit") {
				await handleEdit(pi, ctx, prompt);
				return;
			}

			if (rawArgs.startsWith("save ")) {
				const targetArg = rawArgs.slice(5).trim();
				if (!targetArg) {
					if (ctx.hasUI) ctx.ui.notify(usage(), "warning");
					return;
				}
				await handleSave(ctx, prompt, targetArg);
				return;
			}

			if (ctx.hasUI) {
				ctx.ui.notify(usage(), "warning");
			}
		},
	});
}
