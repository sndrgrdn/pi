import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent"

const UPDATE_TIMEOUT_MS = 600_000
const WIDGET_ID = "pi-update-status"

export default function updateExtension(pi: ExtensionAPI) {
  pi.registerCommand("update", {
    description: "Update pi to the latest version (core + extensions/skills)",
    handler: async (_rawArgs, ctx) => {
      if (!ctx.isIdle() || ctx.hasPendingMessages()) {
        ctx.ui.notify("Waiting for pi to become idle before updating...", "info")
        await ctx.waitForIdle()
      }

      ctx.ui.notify("Updating pi (core + extensions/skills)...", "info")

      const result = await pi.exec("pi", ["update"], {
        timeout: UPDATE_TIMEOUT_MS,
        cwd: ctx.cwd,
      })

      if (result.code !== 0) {
        ctx.ui.notify(
          [
            "Update failed.",
            result.stderr || result.stdout || "No output.",
            "Run `pi update` manually after restart."
          ].join("\n"),
          "error",
        )
        return
      }

      ctx.ui.notify("pi updated successfully.", "info")
      ctx.shutdown()
    },
  })
}
