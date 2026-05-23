import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createSessionManager } from "./session";

const execFileAsync = promisify(execFile);
const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(EXTENSION_DIR, "dist");
const session = createSessionManager(DIST_DIR);

export default function (pi: ExtensionAPI) {
  pi.registerCommand("diffs", {
    description: "Open a browser review for the current working tree diff; reload the page for updates",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!existsSync(join(DIST_DIR, "index.html"))) {
        ctx.ui.notify("Diff review app is not built. Run: pnpm --dir ~/.pi/agent/extensions/diff-review build", "error");
        return;
      }

      const handle = await session.ensureSession(ctx.cwd, pi);
      if (!handle) {
        ctx.ui.notify("Could not start diff review server", "error");
        return;
      }

      await execFileAsync("open", [handle.url]);
      ctx.ui.notify("Opened diff review — reload page for latest diff", "info");
    },
  });
}
