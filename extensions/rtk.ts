/**
 * RTK (Rust Token Killer) integration for Pi
 *
 * Automatically rewrites bash commands through RTK for token-optimized output.
 * Intercepts both LLM tool calls and user `!` commands.
 *
 * Requires: rtk in PATH
 * Install: https://github.com/rtk-ai/rtk
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  isToolCallEventType,
  createLocalBashOperations,
} from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  let rtkBin: string | null = null;
  let rewriteCount = 0;

  /**
   * Ask rtk to rewrite a command. Returns the rewritten command or null if
   * rtk has no opinion (empty stdout).
   */
  async function rtkRewrite(
    command: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (!rtkBin) return null;
    // Already rewritten or explicitly calling rtk
    if (command.trimStart().startsWith("rtk ")) return null;

    try {
      const result = await pi.exec(rtkBin, ["rewrite", command], {
        signal,
        timeout: 3_000,
      });
      const rewritten = result.stdout.trim();
      if (rewritten.length > 0 && rewritten !== command) {
        return rewritten;
      }
    } catch {
      // rtk not available or timed out — pass through silently
    }
    return null;
  }

  // ── LLM bash tool calls ────────────────────────────────────────────
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;

    const original = event.input.command;
    if (!original) return;

    const rewritten = await rtkRewrite(original, ctx.signal);
    if (rewritten) {
      event.input.command = rewritten;
      rewriteCount++;
    }
  });

  // ── User ! / !! commands ───────────────────────────────────────────
  pi.on("user_bash", async (event, _ctx) => {
    const original = event.command;
    if (!original) return;

    const rewritten = await rtkRewrite(original);
    if (!rewritten) return;

    rewriteCount++;
    const local = createLocalBashOperations();
    return {
      operations: {
        exec(_command: string, cwd: string, options: any) {
          return local.exec(rewritten, cwd, options);
        },
      },
    };
  });

  // ── Session start: resolve rtk binary ──────────────────────────────
  pi.on("session_start", async (_event, _ctx) => {
    rewriteCount = 0;

    try {
      const which = await pi.exec("which", ["rtk"], { timeout: 2_000 });
      rtkBin = which.stdout.trim() || null;
    } catch {
      rtkBin = null;
    }
  });
}
