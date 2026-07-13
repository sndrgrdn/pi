/**
 * Bordered prompt-box editor.
 *
 * Renders a CustomEditor wrapped in Unicode box-drawing borders
 * with dynamic corner labels (top-left, top-right, bottom-left, bottom-right).
 */

import { readFileSync } from "node:fs";
import { CustomEditor, type Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── Box-drawing ──────────────────────────────

const B = { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│", tee: "├", rtee: "┤" };

// ── Helpers ──────────────────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function padLine(text: string, width: number): string {
	const t = truncateToWidth(text, width, "");
	return t + " ".repeat(Math.max(0, width - visibleWidth(t)));
}

export function getEditorPaddingX(): number {
	try {
		const agentDir = process.env.PI_CODING_AGENT_DIR ?? `${process.env.HOME}/.pi/agent`;
		const raw = readFileSync(`${agentDir}/settings.json`, "utf8");
		const settings = JSON.parse(raw) as { editorPaddingX?: unknown };
		if (typeof settings.editorPaddingX === "number" && Number.isFinite(settings.editorPaddingX)) {
			return Math.max(0, settings.editorPaddingX);
		}
	} catch {}
	return 1;
}

// ── Editor ───────────────────────────────────

export interface CornerLabels {
	tl: () => string;
	tr: () => string;
	bl: () => string;
	br: () => string;
}

export class PromptBoxEditor extends CustomEditor {
	private readonly piTheme: Theme;
	private readonly corners: CornerLabels;

	constructor(
		tui: any,
		editorTheme: any,
		keybindings: any,
		piTheme: Theme,
		corners: CornerLabels,
		opts: { paddingX: number },
	) {
		super(tui, editorTheme, keybindings, { paddingX: opts.paddingX });
		this.piTheme = piTheme;
		this.corners = corners;
	}

	refresh(): void {
		this.tui.requestRender();
	}

	private border(left: string, right: string, corner: [string, string], width: number): string {
		const bdr = (s: string) => this.piTheme.fg("dim", s);
		const lPad = left ? ` ${left} ` : "";
		const lw = visibleWidth(lPad);
		const maxRightVis = width - 7 - lw;
		let rPad = "";
		if (right && maxRightVis > 2) {
			const truncRight = truncateToWidth(right, maxRightVis, "…");
			rPad = ` ${truncRight} ${bdr(B.h)}`;
		}
		const rw = visibleWidth(rPad);
		const fill = Math.max(1, width - 3 - lw - rw);
		return bdr(corner[0] + B.h) + lPad + bdr(B.h.repeat(fill)) + rPad + bdr(corner[1]);
	}

	override render(width: number): string[] {
		if (width < 16) return super.render(width);

		const bdr = (s: string) => this.piTheme.fg("dim", s);
		const innerW = width - 4;
		const raw = super.render(innerW);
		if (raw.length < 2) return raw;

		let ruleIdx = raw.length - 1;
		for (let i = raw.length - 1; i > 0; i--) {
			if (raw[i]!.replace(ANSI_RE, "").trim().startsWith("─")) {
				ruleIdx = i;
				break;
			}
		}
		const body = raw.slice(1, ruleIdx);
		const acLines = raw.slice(ruleIdx + 1);

		const wrap = (line: string) => `${bdr(B.v)} ${padLine(line, innerW)} ${bdr(B.v)}`;

		const top = this.border(this.corners.tl(), this.corners.tr(), [B.tl, B.tr], width);
		const bot = this.border(this.corners.bl(), this.corners.br(), [B.bl, B.br], width);
		const bodyLines = body.length > 0 ? [...body] : [""];
		while (bodyLines.length < 2) bodyLines.push("");

		const lines = [top, ...bodyLines.map(wrap)];
		if (acLines.length > 0) {
			lines.push(bdr(`${B.tee}${B.h.repeat(width - 2)}${B.rtee}`));
			lines.push(...acLines.map(wrap));
		}
		lines.push(bot);
		lines.push("");
		return lines;
	}
}
