import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export default function (pi: ExtensionAPI) {
  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setFooter(undefined);
  });

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      // Match editor's default horizontal padding for visual alignment
      const paddingX = 1;

      return {
        dispose: unsub,
        invalidate() {},
        render(width: number): string[] {
          // cwd (shortened)
          const cwd = process.cwd().replace(process.env.HOME || "", "~");

          // branch
          const branch = footerData.getGitBranch() || "";

          // context usage (null after compaction until next response)
          // ctx goes stale on session replacement/shutdown; guard render
          let tokens: number | undefined;
          let pct: number | undefined;
          try {
            const usage = ctx.getContextUsage();
            tokens = usage?.tokens ?? undefined;
            pct = usage?.percent != null ? Math.round(usage.percent) : undefined;
          } catch {
            // stale ctx after session replacement/shutdown; render blanks
          }

          const tokensK = tokens ? (tokens / 1000).toFixed(1) + "K" : "?";
          const left = theme.fg("dim", `${tokensK} (${pct ?? "?"}%)`);
          const right = theme.fg("dim", branch ? `${cwd} (${branch})` : cwd);

          const side = " ".repeat(paddingX);
          const inner = Math.max(0, width - paddingX * 2);
          const pad = " ".repeat(Math.max(1, inner - visibleWidth(left) - visibleWidth(right)));

          return [truncateToWidth(side + left + pad + right + side, width)];
        },
      };
    });
  });
}
