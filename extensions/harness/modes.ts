/**
 * Modes — session Mode state, `/mode` + ctrl+s entry points, editor-border
 * indicator, persistence, and posture injection (spec §2.1, §2.4–§2.5).
 *
 * Three fixed Modes (low/medium/high, default medium). Switching a Mode
 * re-routes Main's model/reasoning through the Profile layer. Manual model
 * changes remain ordinary pi behavior — no `custom` state exists; the border
 * keeps the last explicitly selected Mode.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MODE,
	MODES,
	type Mode,
	type ResolvedProfiles,
	loadProfiles,
	resolveMainRoute,
	selectPosture,
} from "./profiles.ts";

// ── Pure helpers (unit-tested) ────────────────────────────────────

/**
 * Right-align a Mode label into a rendered top-border line (§2.5:
 * `╭──── medium ─╮`), keeping the visible width constant by shrinking the
 * longest `─` fill run. Lines without a corner or without room pass through
 * unchanged. ANSI styling in the line is preserved.
 */
export function decorateTopBorder(
	line: string,
	label: string,
	style: (s: string) => string = (s) => s,
): string {
	const cornerIdx = line.lastIndexOf("╮");
	if (cornerIdx === -1) return line;

	const insertWidth = label.length + 3; // " label ─"
	let bestStart = -1;
	let bestLen = 0;
	const runs = /─+/g;
	for (let m = runs.exec(line); m !== null; m = runs.exec(line)) {
		if (m[0].length > bestLen) {
			bestStart = m.index;
			bestLen = m[0].length;
		}
	}
	// Keep at least one fill dash so the border stays a border.
	if (bestStart === -1 || bestLen < insertWidth + 1) return line;

	const shrunk =
		line.slice(0, bestStart) + "─".repeat(bestLen - insertWidth) + line.slice(bestStart + bestLen);
	const corner = shrunk.lastIndexOf("╮");
	return `${shrunk.slice(0, corner)} ${style(label)} ─${shrunk.slice(corner)}`;
}

/**
 * Initial Mode precedence (§2.5): the session's recorded Mode (resume) wins
 * over the globally persisted Mode; default `medium`. Unknown values are
 * ignored — Modes are exactly three.
 */
export function pickInitialMode(recorded: unknown, global: unknown): Mode {
	const asMode = (v: unknown): Mode | undefined =>
		typeof v === "string" && (MODES as readonly string[]).includes(v) ? (v as Mode) : undefined;
	return asMode(recorded) ?? asMode(global) ?? DEFAULT_MODE;
}

// ── Persistence ───────────────────────────────────────────────────

const MODE_ENTRY_TYPE = "harness-mode";

function globalModePath(): string {
	return join(getAgentDir(), "harness-mode.json");
}

function readGlobalMode(): unknown {
	try {
		const path = globalModePath();
		if (!existsSync(path)) return undefined;
		return (JSON.parse(readFileSync(path, "utf8")) as { mode?: unknown }).mode;
	} catch {
		return undefined;
	}
}

function writeGlobalMode(mode: Mode): void {
	writeFileSync(globalModePath(), `${JSON.stringify({ mode }, null, "\t")}\n`);
}

function recordedSessionMode(ctx: ExtensionContext): unknown {
	const entries = ctx.sessionManager.getEntries() as Array<{
		type: string;
		customType?: string;
		data?: { mode?: unknown };
	}>;
	const last = entries.filter((e) => e.type === "custom" && e.customType === MODE_ENTRY_TYPE).pop();
	return last?.data?.mode;
}

// ── Wiring ────────────────────────────────────────────────────────

/** Instance marker preventing double decoration of a wrapped editor. */
const WRAPPED = Symbol.for("pi-harness.mode-border");

export function registerModes(pi: ExtensionAPI): void {
	// Load at startup so an invalid profiles.json fails loudly here — no
	// fallback, no recovery (§2.3).
	const profiles: ResolvedProfiles = loadProfiles(join(getAgentDir(), "profiles.json"));
	let mode: Mode = DEFAULT_MODE;

	/** Point Main's model/reasoning at the route for `next` (§2.1). */
	async function applyRoute(next: Mode, ctx: ExtensionContext): Promise<void> {
		const route = resolveMainRoute(profiles, next);
		const [provider, ...rest] = route.model.split("/");
		const model = ctx.modelRegistry.find(provider ?? "", rest.join("/"));
		if (!model) {
			ctx.ui.notify(`Mode "${next}": model ${route.model} not found in the model registry`, "error");
			return;
		}
		if (!(await pi.setModel(model))) {
			ctx.ui.notify(`Mode "${next}": no API key for ${route.model}`, "error");
			return;
		}
		pi.setThinkingLevel(route.reasoning);
	}

	async function switchMode(next: Mode, ctx: ExtensionContext): Promise<void> {
		mode = next;
		await applyRoute(next, ctx);
		writeGlobalMode(next);
		pi.appendEntry(MODE_ENTRY_TYPE, { mode: next });
		const route = resolveMainRoute(profiles, next);
		ctx.ui.notify(`Mode: ${next} (${route.model} · ${route.reasoning})`, "info");
	}

	async function selectAndSwitch(ctx: ExtensionContext): Promise<void> {
		const choice = await ctx.ui.select(`Mode (active: ${mode})`, [...MODES]);
		if (choice && choice !== mode) await switchMode(choice as Mode, ctx);
	}

	// Mode indicator, right-aligned in the editor top border (§2.5). Runs on
	// resources_discover — after every session_start, so it wraps whatever
	// editor component other extensions (e.g. prompt-box) installed.
	function wrapEditor(ctx: ExtensionContext): void {
		const previous = ctx.ui.getEditorComponent();
		if (!previous) return; // default editor: no border line to decorate
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const base = previous(tui, theme, keybindings);
			const marked = base as unknown as Record<symbol, boolean>;
			if (marked[WRAPPED]) return base;
			marked[WRAPPED] = true;
			const render = base.render.bind(base);
			base.render = (width: number) => {
				const lines = render(width);
				const top = lines.findIndex((l) => l.includes("╭"));
				if (top !== -1) {
					lines[top] = decorateTopBorder(lines[top] as string, mode, (s) =>
						ctx.ui.theme.fg("accent", s),
					);
				}
				return lines;
			};
			return base;
		});
	}

	pi.registerCommand("mode", {
		description: "Switch Mode — low: Terra/low · medium: Sol/medium · high: Sol/xhigh",
		handler: async (args, ctx) => {
			const arg = args?.trim();
			if (arg) {
				if (!(MODES as readonly string[]).includes(arg)) {
					ctx.ui.notify(`Unknown Mode "${arg}" (expected ${MODES.join(", ")})`, "error");
					return;
				}
				if (arg !== mode) await switchMode(arg as Mode, ctx);
				return;
			}
			await selectAndSwitch(ctx);
		},
	});

	pi.registerShortcut("ctrl+s", {
		description: "Switch Mode",
		handler: async (ctx) => {
			await selectAndSwitch(ctx);
		},
	});

	// Posture injection at session build (§2.4, §9.4): append the active
	// Mode's posture block to the system prompt.
	pi.on("before_agent_start", async (event) => {
		return { systemPrompt: `${event.systemPrompt}\n\n${selectPosture(profiles, mode)}` };
	});

	pi.on("session_start", async (_event, ctx) => {
		// Resume restores the session's recorded Mode, re-resolved against
		// current Profiles; otherwise the globally persisted Mode (§2.5).
		mode = pickInitialMode(recordedSessionMode(ctx), readGlobalMode());
		await applyRoute(mode, ctx);
		pi.appendEntry(MODE_ENTRY_TYPE, { mode });
	});

	pi.on("resources_discover", async (_event, ctx) => {
		wrapEditor(ctx);
	});
}
