/**
 * Modes — session Mode state, `/mode` + alt+m entry points, editor-border
 * indicator (published for prompt-box to render), and persistence.
 *
 * Four fixed Modes (low/medium/high/ultra, default medium). Switching a Mode
 * re-routes Main's model/reasoning through the Profile layer. Manual model
 * or reasoning changes remain ordinary pi behavior and select `custom`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CustomEntry, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@earendil-works/pi-tui";
import {
	DEFAULT_MODE,
	loadProfiles,
	MODES,
	type Mode,
	type ProfileMode,
	type ResolvedProfiles,
	resolveAgentRoute,
	resolveMainRoute,
} from "./profiles.ts";

// ── Pure helpers (unit-tested) ────────────────────────────────────

export function modeSelectorIndex(active: Mode): number {
	return active === "custom" ? MODES.indexOf(DEFAULT_MODE) : MODES.indexOf(active);
}

/**
 * `/mode` agent route tables are documented here, not in the selector, and
 * derived from the loaded Profiles so overrides never go stale.
 */
export function describeModeCommand(profiles: ResolvedProfiles): string {
	const fmt = (r: { model: string; reasoning: string }) => `${r.model.split("/").pop()}/${r.reasoning}`;
	const perMode = (route: (m: ProfileMode) => { model: string; reasoning: string }) =>
		MODES.map((m) => fmt(route(m))).join(" · ");
	// Finder/Librarian are Mode-invariant by schema (flat overrides only), so
	// one Mode's route describes all Modes.
	const flat = (agent: "finder" | "librarian") => fmt(resolveAgentRoute(profiles, agent, DEFAULT_MODE));
	return (
		`Switch Mode (${MODES.join("/")}). Routes — ` +
		`Main: ${perMode((m) => resolveMainRoute(profiles, m))}; ` +
		`Oracle: ${perMode((m) => resolveAgentRoute(profiles, "oracle", m))}; ` +
		`Task (per-call mode): ${perMode((m) => resolveAgentRoute(profiles, "task", m))}; ` +
		`Finder: ${flat("finder")}; Librarian: ${flat("librarian")}`
	);
}

// ── Persistence ───────────────────────────────────────────────────

const MODE_ENTRY_TYPE = "harness-mode";

function globalModePath(): string {
	return join(getAgentDir(), "harness-mode.json");
}

export function parsePersistedMode(contents: string): Mode {
	return (JSON.parse(contents) as { mode: Mode }).mode;
}

function readGlobalMode(): Mode {
	const path = globalModePath();
	if (!existsSync(path)) return DEFAULT_MODE;
	try {
		return parsePersistedMode(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(
			`Invalid persisted Mode state (${path}): ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function writeGlobalMode(mode: Mode): void {
	writeFileSync(globalModePath(), `${JSON.stringify({ mode }, null, "\t")}\n`);
}

function recordedSessionMode(ctx: ExtensionContext, fallback: Mode): Mode {
	const last = ctx.sessionManager
		.getEntries()
		.filter((e): e is CustomEntry => e.type === "custom" && e.customType === MODE_ENTRY_TYPE)
		.pop();
	if (!last) return fallback;
	return (last.data as { mode: Mode }).mode;
}

// ── Cross-extension Mode indicator (events bus) ───────────────────

/** Emitted whenever Mode changes (payload: `Mode`). */
export const MODE_EVENT = "harness:mode";
/** Emit this to ask the harness to re-announce the current Mode. */
export const MODE_REQUEST_EVENT = "harness:mode:request";

// ── Wiring ────────────────────────────────────────────────────────

export interface RegisteredModes {
	profiles: ResolvedProfiles;
	activeMode(): Mode;
}

export function registerModes(pi: ExtensionAPI): RegisteredModes {
	// Load at startup so an invalid profiles.json fails loudly here — no
	// fallback or recovery.
	const profiles: ResolvedProfiles = loadProfiles(join(getAgentDir(), "profiles.json"));
	let mode: Mode = DEFAULT_MODE;
	let applyingMode = false;
	let sessionStarted = false;

	// Mode indicator state lives here; rendering lives in the
	// prompt-box extension, which subscribes to MODE_EVENT.
	const announceMode = () => pi.events.emit(MODE_EVENT, mode);
	pi.events.on(MODE_REQUEST_EVENT, announceMode);

	/**
	 * Point Main's model/reasoning at the route for `next`. Returns
	 * whether the route was applied; failures have already been notified.
	 */
	async function applyRoute(next: ProfileMode, ctx: ExtensionContext): Promise<boolean> {
		const route = resolveMainRoute(profiles, next);
		const [provider, ...rest] = route.model.split("/");
		const model = ctx.modelRegistry.find(provider ?? "", rest.join("/"));
		if (!model) {
			ctx.ui.notify(`Mode "${next}": model ${route.model} not found in the model registry`, "error");
			return false;
		}
		if (!(await pi.setModel(model))) {
			ctx.ui.notify(`Mode "${next}": no API key for ${route.model}`, "error");
			return false;
		}
		pi.setThinkingLevel(route.reasoning);
		return true;
	}

	async function switchMode(next: ProfileMode, ctx: ExtensionContext): Promise<void> {
		applyingMode = true;
		const applied = await applyRoute(next, ctx);
		applyingMode = false;
		mode = next;
		writeGlobalMode(next);
		pi.appendEntry(MODE_ENTRY_TYPE, { mode: next });
		announceMode();
		if (applied) {
			const route = resolveMainRoute(profiles, next);
			ctx.ui.notify(`Mode: ${next} (${route.model} · ${route.reasoning})`, "info");
		}
	}

	async function selectAndSwitch(ctx: ExtensionContext): Promise<void> {
		const items: SelectItem[] = MODES.map((candidate) => ({ value: candidate, label: candidate }));
		const choice = await ctx.ui.custom<ProfileMode | null>((tui, theme, _keybindings, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
			container.addChild(new Text(theme.fg("accent", theme.bold(`Mode (active: ${mode})`))));

			const selectList = new SelectList(items, items.length, {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});
			selectList.setSelectedIndex(modeSelectorIndex(mode));
			selectList.onSelect = (item) => done(item.value as ProfileMode);
			selectList.onCancel = () => done(null);
			container.addChild(selectList);

			container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
			container.addChild(new DynamicBorder((text) => theme.fg("accent", text)));

			return {
				render: (width) => container.render(width),
				invalidate: () => container.invalidate(),
				handleInput: (data) => {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});
		if (choice && choice !== mode) await switchMode(choice, ctx);
	}

	function selectCustomMode(): void {
		if (!sessionStarted || applyingMode || mode === "custom") return;
		mode = "custom";
		writeGlobalMode("custom");
		pi.appendEntry(MODE_ENTRY_TYPE, { mode: "custom" });
		announceMode();
	}

	pi.registerCommand("mode", {
		description: describeModeCommand(profiles),
		handler: async (args, ctx) => {
			const arg = args?.trim();
			if (arg) {
				if (!(MODES as readonly string[]).includes(arg)) {
					ctx.ui.notify(`Unknown Mode "${arg}" (expected ${MODES.join(", ")})`, "error");
					return;
				}
				if (arg !== mode) await switchMode(arg as ProfileMode, ctx);
				return;
			}
			await selectAndSwitch(ctx);
		},
	});

	pi.registerShortcut("alt+m", {
		description: "Switch Mode",
		handler: async (ctx) => {
			await selectAndSwitch(ctx);
		},
	});

	pi.on("model_select", async (event) => {
		if (event.source !== "restore") selectCustomMode();
	});

	pi.on("thinking_level_select", async () => {
		selectCustomMode();
	});

	pi.on("session_start", async (event, ctx) => {
		// Resume restores the session's recorded Mode, re-resolved against
		// current Profiles; new/reload reads global state. Neither applies a
		// route: pi owns model/provider/thinking restoration.
		const globalMode = readGlobalMode();
		mode = event.reason === "resume" ? recordedSessionMode(ctx, globalMode) : globalMode;
		announceMode();
		pi.appendEntry(MODE_ENTRY_TYPE, { mode });
		sessionStarted = true;
	});

	return { profiles, activeMode: () => mode };
}
