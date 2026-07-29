/**
 * Custom startup header: niwamori lockup — the 守 "shelter" icon (roof
 * guarding a sprout) with a text block beside it, vertically centered.
 *
 * Replaces pi's built-in header (logo + keybinding hints) via
 * ctx.ui.setHeader(). Icon uses semantic garden colors (wood roof, green
 * sprout, earth soil); the text block carries the name and session facts.
 */

import { homedir } from "node:os";
import { relative } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** 守 as a garden: roof sheltering a sprout. Plain lines; colored below. */
const ICON = [
	"      ▄██▄     ",
	" ▄███████████▄ ",
	"██▀         ▀██",
	"▓▓  ▄█▄ ▄█▄  ▓▓",
	"     ▀███▀     ",
	"       █       ",
	" ░▒▄▄▄▄███▄▄▄▒░",
	" ░░▒▒▓▓▓▓▓▒▒░░ ",
];
const ICON_WIDTH = Math.max(...ICON.map(visibleWidth));

const GAP = 4;

type Rgb = [number, number, number];

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

/** Garden palette for the icon: wood roof, green sprout, earth soil. */
const WOOD: Rgb = [176, 105, 68];
const WOOD_DARK: Rgb = [128, 74, 50];
const LEAF: Rgb = [95, 200, 120];
const LEAF_LIGHT: Rgb = [150, 230, 170];
const STEM: Rgb = [80, 160, 100];
const EARTH: Rgb = [130, 95, 60];
const SHADOW: Rgb = [90, 90, 100];

function paint([r, g, b]: Rgb, character: string): string {
	return `${BOLD}\x1b[38;2;${r};${g};${b}m${character}${RESET}`;
}

/** Icon line with semantic colors: roof rows wood, sprout green, soil earth. */
function iconLine(line: string, row: number): string {
	const colorFor = (character: string): Rgb => {
		if (row <= 2) return WOOD;
		if (row === 3) return character === "▓" ? WOOD_DARK : LEAF_LIGHT;
		if (row === 4) return LEAF;
		if (row === 5) return STEM;
		return "░▒".includes(character) ? SHADOW : EARTH;
	};
	return [...line]
		.map((character) => (character === " " ? character : paint(colorFor(character), character)))
		.join("");
}

const COLORED_ICON = ICON.map((line, row) => iconLine(line, row));

function formatDirectory(cwd: string): string {
	const home = homedir();
	const label = cwd === home ? "~" : cwd.startsWith(`${home}/`) ? `~/${relative(home, cwd)}` : cwd;
	// Strip control characters so a hostile path cannot inject escapes.
	return label.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function center(line: string, width: number): string {
	const padding = Math.max(0, Math.floor((width - visibleWidth(line)) / 2));
	return truncateToWidth(`${" ".repeat(padding)}${line}`, width, "");
}

export function registerHeader(pi: ExtensionAPI): void {
	let requestRender: (() => void) | undefined;

	// Header renders lazily; nudge the TUI when displayed facts change.
	pi.on("model_select", () => requestRender?.());

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setHeader((tui, theme) => {
			requestRender = () => tui.requestRender();

			return {
				render(width: number): string[] {
					const text = [
						`${paint(LEAF, "mori")} ${theme.fg("muted", "守")}`,
						theme.fg("dim", `pi v${VERSION}`),
						theme.fg("muted", `${ctx.model?.name ?? "no model"} · ${ctx.thinkingLevel ?? "off"}`),
						theme.fg("dim", formatDirectory(ctx.cwd)),
					];
					const textWidth = Math.max(...text.map(visibleWidth));
					const blockWidth = ICON_WIDTH + GAP + textWidth;

					// Narrow terminal: stack icon and text, both centered.
					if (width < blockWidth) {
						return [
							"",
							...COLORED_ICON.map((line) => center(line, width)),
							"",
							...text.map((line) => center(line, width)),
							"",
						];
					}

					// Text block vertically centered on the icon; the whole lockup
					// padded uniformly (per-line centering would drift icon-only rows).
					const offset = Math.floor((ICON.length - text.length) / 2);
					const pad = " ".repeat(Math.max(0, Math.floor((width - blockWidth) / 2)));
					const art = COLORED_ICON.map((line, row) => {
						const textRow = row - offset;
						const right = textRow >= 0 && textRow < text.length ? (text[textRow] as string) : "";
						return truncateToWidth(`${pad}${line}${" ".repeat(GAP)}${right}`, width, "");
					});
					return ["", ...art, ""];
				},
				invalidate() {},
			};
		});
	});
}
