import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("undo", {
		description: "Rewind to the last user message",
		handler: async (_args, ctx) => {
			await ctx.waitForIdle();

			// getBranch() walks root -> leaf in chronological order.
			const lastUser = ctx.sessionManager
				.getBranch()
				.findLast((entry) => entry.type === "message" && entry.message.role === "user");

			if (!lastUser) {
				ctx.ui.notify("Nothing to undo: no user message found.", "warning");
				return;
			}

			// navigateTree rewinds in place and restores the message text into the editor.
			const result = await ctx.navigateTree(lastUser.id);
			if (result.cancelled) {
				ctx.ui.notify("Undo cancelled.", "info");
			}
		},
	});
}
