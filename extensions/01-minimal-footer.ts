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

          // context usage (null after compaction until next response)
          const usage = ctx.getContextUsage();
          const tokens = usage?.tokens;
          const pct = usage?.percent != null ? Math.round(usage.percent) : null;

          const left = theme.fg("dim", branch ? `${cwd} (${branch})` : cwd);
          const tokensK = tokens ? (tokens / 1000).toFixed(1) + "K" : "?";
          const right = theme.fg("dim", `${tokensK} (${pct ?? "?"}%)`);
          const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));

          return [truncateToWidth(left + pad + right, width)];
        },
      };
    });
  });
}
