import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          // cwd (shortened)
          const cwd = process.cwd().replace(process.env.HOME || "", "~");

          // branch
          const branch = footerData.getGitBranch() || "";

          // token count (cumulative from all entries)
          let totalTokens = 0;
          for (const e of ctx.sessionManager.getEntries()) {
            if (e.type === "message" && e.message.role === "assistant") {
              const m = e.message as AssistantMessage;
              totalTokens += m.usage.input + m.usage.output;
            }
          }

          // context % (null after compaction until next response)
          const pct = Math.round(ctx.getContextUsage()?.percent ?? 0);

          const left = theme.fg("dim", branch ? `${cwd} (${branch})` : cwd);
          const tokensK = (totalTokens / 1000).toFixed(1) + "K";
          const right = theme.fg("dim", `${tokensK} (${pct}%)`);
          const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

          return [truncateToWidth(left + pad + right, width)];
        },
      };
    });
  });
}
