/**
 * Modes — session Mode state, `/mode` + alt+s entry points, editor-border
 * indicator (published for prompt-box to render), persistence, and posture
 * injection (spec §2.1, §2.4–§2.5).
 *
 * Three fixed Modes (low/medium/high, default medium). Switching a Mode
 * re-routes Main's model/reasoning through the Profile layer. Manual model
 * or reasoning changes remain ordinary pi behavior and select `null` — the
 * absence of a named Mode, never a fourth `custom` Mode.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CustomEntry, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MODE,
	MODES,
	type Mode,
	type ResolvedProfiles,
	isMode,
	loadProfiles,
	resolveAgentRoute,
	resolveMainRoute,
	selectPosture,
} from "./profiles.ts";

// ── Pure helpers (unit-tested) ────────────────────────────────────

/**
 * Initial Mode precedence (§2.5): the session's recorded Mode (resume) wins
 * over the globally persisted Mode; default `medium`. Unknown values are
 * ignored — Modes are exactly three.
 */
export function pickInitialMode(recorded: unknown, global: unknown): Mode | null {
	if (recorded === null) return null;
	if (isMode(recorded)) return recorded;
	if (global === null) return null;
	if (isMode(global)) return global;
	return DEFAULT_MODE;
}

/**
 * `/mode` docs (§2.5: agent route tables are documented here, not in the
 * selector), derived from the loaded Profiles so overrides never go stale.
 */
export function describeModeCommand(profiles: ResolvedProfiles): string {
	const fmt = (r: { model: string; reasoning: string }) =>
		`${r.model.split("/").pop()}/${r.reasoning}`;
	const perMode = (route: (m: Mode) => { model: string; reasoning: string }) =>
		MODES.map((m) => fmt(route(m))).join(" · ");
	// Finder/Librarian are Mode-invariant by schema (flat overrides only), so
	// one Mode's route describes all three.
	const flat = (agent: "finder" | "librarian") =>
		fmt(resolveAgentRoute(profiles, agent, DEFAULT_MODE));
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

function readGlobalMode(): unknown {
	try {
		const path = globalModePath();
		if (!existsSync(path)) return undefined;
		return (JSON.parse(readFileSync(path, "utf8")) as { mode?: unknown }).mode;
	} catch {
		return undefined;
	}
}

function writeGlobalMode(mode: Mode | null): void {
	writeFileSync(globalModePath(), `${JSON.stringify({ mode }, null, "\t")}\n`);
}

function recordedSessionMode(ctx: ExtensionContext): unknown {
	const last = ctx.sessionManager
		.getEntries()
		.filter((e): e is CustomEntry => e.type === "custom" && e.customType === MODE_ENTRY_TYPE)
		.pop();
	return (last?.data as { mode?: unknown } | undefined)?.mode;
}

// ── Cross-extension Mode indicator (events bus) ───────────────────

/** Emitted whenever Mode changes (payload: `Mode | null`). */
export const MODE_EVENT = "harness:mode";
/** Emit this to ask the harness to re-announce the current Mode. */
export const MODE_REQUEST_EVENT = "harness:mode:request";

// ── Wiring ────────────────────────────────────────────────────────

export function registerModes(pi: ExtensionAPI, onModeChange?: (mode: Mode | null) => void): ResolvedProfiles {
	// Load at startup so an invalid profiles.json fails loudly here — no
	// fallback, no recovery (§2.3).
	const profiles: ResolvedProfiles = loadProfiles(join(getAgentDir(), "profiles.json"));
	let mode: Mode | null = DEFAULT_MODE;
	let applyingMode = false;
	let sessionStarted = false;

	// Mode indicator (§2.5): state lives here; rendering lives in the
	// prompt-box extension, which subscribes to MODE_EVENT.
	const announceMode = () => pi.events.emit(MODE_EVENT, mode);
	const publishMode = () => {
		onModeChange?.(mode);
		announceMode();
	};
	pi.events.on(MODE_REQUEST_EVENT, announceMode);

	/**
	 * Point Main's model/reasoning at the route for `next` (§2.1). Returns
	 * whether the route was applied; failures have already been notified.
	 */
	async function applyRoute(next: Mode, ctx: ExtensionContext): Promise<boolean> {
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

	async function switchMode(next: Mode, ctx: ExtensionContext): Promise<void> {
		applyingMode = true;
		const applied = await applyRoute(next, ctx);
		applyingMode = false;
		mode = next;
		writeGlobalMode(next);
		pi.appendEntry(MODE_ENTRY_TYPE, { mode: next });
		publishMode();
		if (applied) {
			const route = resolveMainRoute(profiles, next);
			ctx.ui.notify(`Mode: ${next} (${route.model} · ${route.reasoning})`, "info");
		}
	}

	async function selectAndSwitch(ctx: ExtensionContext): Promise<void> {
		const choice = await ctx.ui.select(`Mode (active: ${mode ?? "custom"})`, [...MODES]);
		if (choice && choice !== mode) await switchMode(choice as Mode, ctx);
	}

	function selectCustomMode(): void {
		if (!sessionStarted || applyingMode || mode === null) return;
		mode = null;
		writeGlobalMode(null);
		pi.appendEntry(MODE_ENTRY_TYPE, { mode: null });
		publishMode();
	}

	pi.registerCommand("mode", {
		description: describeModeCommand(profiles),
		handler: async (args, ctx) => {
			const arg = args?.trim();
			if (arg) {
				if (!isMode(arg)) {
					ctx.ui.notify(`Unknown Mode "${arg}" (expected ${MODES.join(", ")})`, "error");
					return;
				}
				if (arg !== mode) await switchMode(arg, ctx);
				return;
			}
			await selectAndSwitch(ctx);
		},
	});

	pi.registerShortcut("alt+s", {
		description: "Switch Mode",
		handler: async (ctx) => {
			await selectAndSwitch(ctx);
		},
	});

	// Posture injection at session build (§2.4, §9.4): append the active
	// Mode's posture block to the system prompt.
	pi.on("before_agent_start", async (event) => {
		const posture = selectPosture(profiles, mode);
		if (posture) return { systemPrompt: `${event.systemPrompt}\n\n${posture}` };
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
		const recorded = event.reason === "resume" ? recordedSessionMode(ctx) : undefined;
		mode = pickInitialMode(recorded, readGlobalMode());
		publishMode();
		pi.appendEntry(MODE_ENTRY_TYPE, { mode });
		sessionStarted = true;
	});

	return profiles;
}
