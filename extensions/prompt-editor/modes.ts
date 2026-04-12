import type { ExtensionAPI, ExtensionContext, ThinkingLevel } from "@mariozechner/pi-coding-agent";
import { ModelSelectorComponent, SettingsManager } from "@mariozechner/pi-coding-agent";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

// =============================================================================
// Types
// =============================================================================

export type ModeName = string;

export type ModeSpec = {
	provider?: string;
	modelId?: string;
	thinkingLevel?: ThinkingLevel;
	/** Optional theme color token for the editor border. If unset, derived from thinking level. */
	color?: string;
};

export type ModesFile = {
	version: 1;
	currentMode: ModeName;
	modes: Record<ModeName, ModeSpec>;
};

type ModeSpecPatch = {
	provider?: string | null;
	modelId?: string | null;
	thinkingLevel?: ThinkingLevel | null;
	color?: string | null;
};

type ModesPatch = {
	currentMode?: ModeName;
	modes?: Record<ModeName, ModeSpecPatch | null>;
};

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MODE = "default";
export const CUSTOM_MODE_NAME = "custom" as const;

const MODE_UI_CONFIGURE = "Configure modes…";
const MODE_UI_ADD = "Add mode…";
const MODE_UI_BACK = "Back";
const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const THINKING_UNSET_LABEL = "(don't change)";

// =============================================================================
// File utilities
// =============================================================================

function expandUserPath(p: string): string {
	if (p === "~") return os.homedir();
	if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
	return p;
}

export function getGlobalAgentDir(): string {
	const env = process.env.PI_CODING_AGENT_DIR;
	if (env) return expandUserPath(env);
	return path.join(os.homedir(), ".pi", "agent");
}

function getGlobalModesPath(): string {
	return path.join(getGlobalAgentDir(), "modes.json");
}

function getProjectModesPath(cwd: string): string {
	return path.join(cwd, ".pi", "modes.json");
}

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

async function ensureDirForFile(filePath: string): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function getMtimeMs(p: string): Promise<number | null> {
	try {
		return (await fs.stat(p)).mtimeMs;
	} catch {
		return null;
	}
}

// =============================================================================
// File locking & atomic writes
// =============================================================================

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	const lockPath = `${filePath}.lock`;
	await ensureDirForFile(lockPath);

	const start = Date.now();
	while (true) {
		try {
			const handle = await fs.open(lockPath, "wx");
			try {
				await handle.writeFile(
					JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + "\n",
					"utf8",
				);
			} catch {
				// ignore
			}

			try {
				return await fn();
			} finally {
				await handle.close().catch(() => {});
				await fs.unlink(lockPath).catch(() => {});
			}
		} catch (err: any) {
			if (err?.code !== "EEXIST") throw err;

			// If the lock looks stale (crash), break it.
			try {
				const st = await fs.stat(lockPath);
				if (Date.now() - st.mtimeMs > 30_000) {
					await fs.unlink(lockPath);
					continue;
				}
			} catch {
				// ignore
			}

			if (Date.now() - start > 5_000) {
				throw new Error(`Timed out waiting for lock: ${lockPath}`);
			}
			await delay(40 + Math.random() * 80);
		}
	}
}

async function atomicWriteUtf8(filePath: string, content: string): Promise<void> {
	await ensureDirForFile(filePath);
	const dir = path.dirname(filePath);
	const base = path.basename(filePath);
	const tmpPath = path.join(dir, `.${base}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`);
	await fs.writeFile(tmpPath, content, "utf8");
	await fs.rename(tmpPath, filePath);
}

// =============================================================================
// Modes data helpers
// =============================================================================

function computeModesPatch(base: ModesFile, next: ModesFile, includeCurrentMode: boolean): ModesPatch | null {
	const patch: ModesPatch = {};

	if (includeCurrentMode && base.currentMode !== next.currentMode) {
		patch.currentMode = next.currentMode;
	}

	const keys = new Set([...Object.keys(base.modes), ...Object.keys(next.modes)]);
	const modesPatch: Record<ModeName, ModeSpecPatch | null> = {};

	for (const k of keys) {
		const a = base.modes[k];
		const b = next.modes[k];

		if (!b) {
			if (a) modesPatch[k] = null;
			continue;
		}
		if (!a) {
			modesPatch[k] = { ...b };
			continue;
		}

		const diff: ModeSpecPatch = {};
		for (const f of ["provider", "modelId", "thinkingLevel", "color"] as const) {
			if (a[f] !== b[f]) (diff as any)[f] = b[f] === undefined ? null : b[f];
		}
		if (Object.keys(diff).length > 0) modesPatch[k] = diff;
	}

	if (Object.keys(modesPatch).length > 0) patch.modes = modesPatch;
	if (!patch.modes && patch.currentMode === undefined) return null;
	return patch;
}

function applyModesPatch(target: ModesFile, patch: ModesPatch): void {
	if (patch.currentMode !== undefined) target.currentMode = patch.currentMode;
	if (!patch.modes) return;

	for (const [mode, specPatch] of Object.entries(patch.modes)) {
		if (specPatch === null) {
			delete target.modes[mode];
			continue;
		}
		const targetSpec: Record<string, unknown> = ((target.modes[mode] ??= {}) as any) ?? {};
		for (const [k, v] of Object.entries(specPatch)) {
			if (v === null || v === undefined) delete targetSpec[k];
			else targetSpec[k] = v;
		}
	}
}

function normalizeThinkingLevel(level: unknown): ThinkingLevel | undefined {
	if (typeof level !== "string") return undefined;
	const allowed: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
	return allowed.includes(level as ThinkingLevel) ? (level as ThinkingLevel) : undefined;
}

function sanitizeModeSpec(spec: unknown): ModeSpec {
	const obj = (spec && typeof spec === "object" ? spec : {}) as Record<string, unknown>;
	return {
		provider: typeof obj.provider === "string" ? obj.provider : undefined,
		modelId: typeof obj.modelId === "string" ? obj.modelId : undefined,
		thinkingLevel: normalizeThinkingLevel(obj.thinkingLevel),
		color: typeof obj.color === "string" ? obj.color : undefined,
	};
}

function createDefaultModes(ctx: ExtensionContext, pi: ExtensionAPI): ModesFile {
	const base: ModeSpec = {
		provider: ctx.model?.provider,
		modelId: ctx.model?.id,
		thinkingLevel: pi.getThinkingLevel(),
	};
	return {
		version: 1,
		currentMode: DEFAULT_MODE,
		modes: {
			default: { ...base },
			fast: { ...base, thinkingLevel: "off" },
		},
	};
}

function ensureDefaultModeEntries(file: ModesFile, ctx: ExtensionContext, pi: ExtensionAPI): void {
	// Only bootstrap "default" when there are no modes at all.
	if (orderedModeNames(file.modes).length === 0) {
		Object.assign(file.modes, createDefaultModes(ctx, pi).modes);
	}

	if (file.currentMode === CUSTOM_MODE_NAME) {
		file.currentMode = "" as any;
	}

	if (!file.currentMode || !(file.currentMode in file.modes) || file.currentMode === CUSTOM_MODE_NAME) {
		file.currentMode = orderedModeNames(file.modes)[0] ?? DEFAULT_MODE;
	}
}

async function loadModesFile(filePath: string, ctx: ExtensionContext, pi: ExtensionAPI): Promise<ModesFile> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const currentMode = typeof parsed.currentMode === "string" ? parsed.currentMode : DEFAULT_MODE;
		const modesRaw = parsed.modes && typeof parsed.modes === "object" ? (parsed.modes as Record<string, unknown>) : {};
		const modes: Record<string, ModeSpec> = {};
		for (const [k, v] of Object.entries(modesRaw)) modes[k] = sanitizeModeSpec(v);
		const file: ModesFile = { version: 1, currentMode, modes };
		ensureDefaultModeEntries(file, ctx, pi);
		return file;
	} catch {
		return createDefaultModes(ctx, pi);
	}
}

async function saveModesFile(filePath: string, data: ModesFile): Promise<void> {
	await atomicWriteUtf8(filePath, JSON.stringify(data, null, 2) + "\n");
}

export function orderedModeNames(modes: Record<string, ModeSpec>): string[] {
	return Object.keys(modes).filter((name) => name !== CUSTOM_MODE_NAME);
}

export function getModeBorderColor(ctx: ExtensionContext, pi: ExtensionAPI, mode: string): (text: string) => string {
	const theme = ctx.ui.theme;
	const spec = runtime.data.modes[mode];

	if (spec?.color) {
		try {
			theme.getFgAnsi(spec.color as any);
			return (text: string) => theme.fg(spec.color as any, text);
		} catch {
			// fall through to thinking-based colors
		}
	}

	return theme.getThinkingBorderColor(pi.getThinkingLevel());
}

export function formatModeLabel(mode: string): string {
	return mode;
}

async function resolveModesPath(cwd: string): Promise<string> {
	const projectPath = getProjectModesPath(cwd);
	if (await fileExists(projectPath)) return projectPath;
	return getGlobalModesPath();
}

export function inferModeFromSelection(ctx: ExtensionContext, pi: ExtensionAPI, data: ModesFile): string | null {
	const provider = ctx.model?.provider;
	const modelId = ctx.model?.id;
	const thinkingLevel = pi.getThinkingLevel();
	if (!provider || !modelId) return null;

	const names = orderedModeNames(data.modes);
	const supportsThinking = Boolean(ctx.model?.reasoning);

	// If thinking is supported, require an exact match so modes can differ by thinking level.
	if (supportsThinking) {
		for (const name of names) {
			const spec = data.modes[name];
			if (!spec) continue;
			if (spec.provider !== provider || spec.modelId !== modelId) continue;
			if ((spec.thinkingLevel ?? undefined) !== thinkingLevel) continue;
			return name;
		}
		return null;
	}

	// If thinking is NOT supported, the effective level is always "off".
	// Treat thinkingLevel differences in modes.json as non-distinguishing.
	const candidates: string[] = [];
	for (const name of names) {
		const spec = data.modes[name];
		if (!spec || spec.provider !== provider || spec.modelId !== modelId) continue;
		candidates.push(name);
	}
	if (candidates.length === 0) return null;

	for (const name of candidates) {
		if ((data.modes[name]?.thinkingLevel ?? "off") === thinkingLevel) return name;
	}
	for (const name of candidates) {
		if (!data.modes[name]?.thinkingLevel) return name;
	}
	return candidates[0] ?? null;
}

// =============================================================================
// Runtime state
// =============================================================================

export type ModeRuntime = {
	filePath: string;
	fileMtimeMs: number | null;
	/** Snapshot of what we last loaded/synced from disk (for patch computation). */
	baseline: ModesFile | null;
	data: ModesFile;
	/** Last non-overlay mode. Used as cycle base while in the overlay "custom" mode. */
	lastRealMode: string;
	/** Effective current mode. Can temporarily be "custom" (overlay, not persisted). */
	currentMode: string;
	/** Guard against feedback loops when we switch model ourselves. */
	applying: boolean;
};

export const runtime: ModeRuntime = {
	filePath: "",
	fileMtimeMs: null,
	baseline: null,
	data: { version: 1, currentMode: DEFAULT_MODE, modes: {} },
	lastRealMode: DEFAULT_MODE,
	currentMode: DEFAULT_MODE,
	applying: false,
};

let customOverlay: ModeSpec | null = null;
let lastObservedModel: { provider?: string; modelId?: string } = {};
let requestEditorRender: (() => void) | undefined;

export function getCustomOverlay(): ModeSpec | null {
	return customOverlay;
}
export function setCustomOverlay(v: ModeSpec | null): void {
	customOverlay = v;
}
export function setLastObservedModel(m: { provider?: string; modelId?: string }): void {
	lastObservedModel = m;
}
export function setRequestEditorRender(fn: (() => void) | undefined): void {
	requestEditorRender = fn;
}
export function triggerEditorRender(): void {
	requestEditorRender?.();
}

// =============================================================================
// Runtime operations
// =============================================================================

export async function ensureRuntime(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const filePath = await resolveModesPath(ctx.cwd);
	const mtimeMs = await getMtimeMs(filePath);
	const filePathChanged = runtime.filePath !== filePath;
	const fileChanged = filePathChanged || runtime.fileMtimeMs !== mtimeMs;

	if (fileChanged) {
		runtime.filePath = filePath;
		runtime.fileMtimeMs = mtimeMs;

		const loaded = await loadModesFile(filePath, ctx, pi);
		ensureDefaultModeEntries(loaded, ctx, pi);
		runtime.data = loaded;
		runtime.baseline = structuredClone(runtime.data);

		// Reset overlay when switching projects.
		if (filePathChanged && runtime.currentMode !== CUSTOM_MODE_NAME) {
			runtime.currentMode = runtime.data.currentMode;
			runtime.lastRealMode = runtime.currentMode;
		}
	}

	if (runtime.currentMode !== CUSTOM_MODE_NAME) {
		if (!runtime.currentMode || !(runtime.currentMode in runtime.data.modes)) {
			runtime.currentMode = runtime.data.currentMode;
		}
		if (!runtime.lastRealMode || !(runtime.lastRealMode in runtime.data.modes)) {
			runtime.lastRealMode = runtime.currentMode;
		}
	}
}

async function persistRuntime(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!runtime.filePath) return;

	// Do not persist currentMode; multiple running pi sessions would fight over it.
	runtime.baseline ??= structuredClone(runtime.data);
	const patch = computeModesPatch(runtime.baseline, runtime.data, false);
	if (!patch) return;

	await withFileLock(runtime.filePath, async () => {
		const latest = await loadModesFile(runtime.filePath, ctx, pi);
		applyModesPatch(latest, patch);
		ensureDefaultModeEntries(latest, ctx, pi);
		await saveModesFile(runtime.filePath, latest);

		runtime.data = latest;
		runtime.baseline = structuredClone(latest);
		runtime.fileMtimeMs = await getMtimeMs(runtime.filePath);
	});
}

export function getCurrentSelectionSpec(pi: ExtensionAPI, _ctx: ExtensionContext): ModeSpec {
	return {
		provider: lastObservedModel.provider,
		modelId: lastObservedModel.modelId,
		thinkingLevel: pi.getThinkingLevel(),
	};
}

export async function storeSelectionIntoMode(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	mode: string,
	selection: ModeSpec,
): Promise<void> {
	if (mode === CUSTOM_MODE_NAME) return;
	await ensureRuntime(pi, ctx);

	const next: ModeSpec = { ...(runtime.data.modes[mode] ?? {}) };
	if (selection.provider && selection.modelId) {
		next.provider = selection.provider;
		next.modelId = selection.modelId;
	}
	if (selection.thinkingLevel) next.thinkingLevel = selection.thinkingLevel;

	runtime.data.modes[mode] = next;
	await persistRuntime(pi, ctx);
}

export async function applyMode(pi: ExtensionAPI, ctx: ExtensionContext, mode: string): Promise<void> {
	await ensureRuntime(pi, ctx);

	if (mode === CUSTOM_MODE_NAME) {
		runtime.currentMode = CUSTOM_MODE_NAME;
		customOverlay = getCurrentSelectionSpec(pi, ctx);
		if (ctx.hasUI) requestEditorRender?.();
		return;
	}

	const spec = runtime.data.modes[mode];
	if (!spec) {
		if (ctx.hasUI) ctx.ui.notify(`Unknown mode: ${mode}`, "warning");
		return;
	}

	runtime.currentMode = mode;
	runtime.lastRealMode = mode;
	customOverlay = null;

	runtime.applying = true;
	let modelAppliedOk = true;
	try {
		if (spec.provider && spec.modelId) {
			const m = ctx.modelRegistry.find(spec.provider, spec.modelId);
			if (m) {
				const ok = await pi.setModel(m);
				modelAppliedOk = ok;
				if (!ok && ctx.hasUI) {
					ctx.ui.notify(`No API key available for ${spec.provider}/${spec.modelId}`, "warning");
				}
			} else {
				modelAppliedOk = false;
				if (ctx.hasUI) {
					ctx.ui.notify(`Mode "${mode}" references unknown model ${spec.provider}/${spec.modelId}`, "warning");
				}
			}
		}

		if (spec.thinkingLevel) pi.setThinkingLevel(spec.thinkingLevel);
	} finally {
		runtime.applying = false;
	}

	// If we couldn't apply the model, fall back to overlay.
	if (!modelAppliedOk) {
		runtime.currentMode = CUSTOM_MODE_NAME;
		customOverlay = getCurrentSelectionSpec(pi, ctx);
	}

	if (ctx.hasUI) requestEditorRender?.();
}

export async function cycleMode(pi: ExtensionAPI, ctx: ExtensionContext, direction: 1 | -1 = 1): Promise<void> {
	if (!ctx.hasUI) return;
	await ensureRuntime(pi, ctx);
	const names = orderedModeNames(runtime.data.modes);
	if (names.length === 0) return;

	const baseMode = runtime.currentMode === CUSTOM_MODE_NAME ? runtime.lastRealMode : runtime.currentMode;
	const idx = Math.max(0, names.indexOf(baseMode));
	const next = names[(idx + direction + names.length) % names.length] ?? names[0]!;
	await applyMode(pi, ctx, next);
}

// =============================================================================
// Mode selection UI
// =============================================================================

function isReservedModeName(name: string): boolean {
	return name === CUSTOM_MODE_NAME || name === MODE_UI_CONFIGURE || name === MODE_UI_ADD || name === MODE_UI_BACK;
}

function validateModeNameOrError(
	name: string,
	existing: Record<string, ModeSpec>,
	opts?: { allowExisting?: boolean },
): string | null {
	if (!name) return "Mode name cannot be empty";
	if (/\s/.test(name)) return "Mode name cannot contain whitespace";
	if (isReservedModeName(name)) return `Mode name "${name}" is reserved`;
	if (!opts?.allowExisting && existing[name]) return `Mode "${name}" already exists`;
	return null;
}

async function handleModeChoiceUI(pi: ExtensionAPI, ctx: ExtensionContext, choice: string): Promise<void> {
	if (runtime.currentMode === CUSTOM_MODE_NAME && choice !== CUSTOM_MODE_NAME) {
		const action = await ctx.ui.select(`Mode "${choice}"`, ["use", "store"]);
		if (!action) return;

		if (action === "use") {
			await applyMode(pi, ctx, choice);
			return;
		}

		await ensureRuntime(pi, ctx);
		const overlay = customOverlay ?? getCurrentSelectionSpec(pi, ctx);
		await storeSelectionIntoMode(pi, ctx, choice, overlay);
		await applyMode(pi, ctx, choice);
		ctx.ui.notify(`Stored ${CUSTOM_MODE_NAME} into "${choice}"`, "info");
		return;
	}

	await applyMode(pi, ctx, choice);
}

export async function selectModeUI(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	while (true) {
		await ensureRuntime(pi, ctx);
		const names = orderedModeNames(runtime.data.modes);
		const choice = await ctx.ui.select(`Mode (current: ${runtime.currentMode})`, [...names, MODE_UI_CONFIGURE]);
		if (!choice) return;

		if (choice === MODE_UI_CONFIGURE) {
			await configureModesUI(pi, ctx);
			continue;
		}

		await handleModeChoiceUI(pi, ctx, choice);
		return;
	}
}

async function configureModesUI(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	while (true) {
		await ensureRuntime(pi, ctx);
		const names = orderedModeNames(runtime.data.modes);
		const choice = await ctx.ui.select("Configure modes", [...names, MODE_UI_ADD, MODE_UI_BACK]);
		if (!choice || choice === MODE_UI_BACK) return;

		if (choice === MODE_UI_ADD) {
			const created = await addModeUI(pi, ctx);
			if (created) await editModeUI(pi, ctx, created);
			continue;
		}

		await editModeUI(pi, ctx, choice);
	}
}

async function addModeUI(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string | undefined> {
	if (!ctx.hasUI) return undefined;
	await ensureRuntime(pi, ctx);

	while (true) {
		const raw = await ctx.ui.input("New mode name", "e.g. docs, review, planning");
		if (raw === undefined) return undefined;

		const name = (raw ?? "").trim();
		const err = validateModeNameOrError(name, runtime.data.modes);
		if (err) {
			ctx.ui.notify(err, "warning");
			continue;
		}

		const selection = customOverlay ?? getCurrentSelectionSpec(pi, ctx);
		runtime.data.modes[name] = {
			provider: selection.provider,
			modelId: selection.modelId,
			thinkingLevel: selection.thinkingLevel,
		};
		await persistRuntime(pi, ctx);
		ctx.ui.notify(`Added mode "${name}"`, "info");
		return name;
	}
}

async function editModeUI(pi: ExtensionAPI, ctx: ExtensionContext, mode: string): Promise<void> {
	if (!ctx.hasUI) return;
	let modeName = mode;

	while (true) {
		await ensureRuntime(pi, ctx);
		const spec = runtime.data.modes[modeName];
		if (!spec) return;

		const modelLabel = spec.provider && spec.modelId ? `${spec.provider}/${spec.modelId}` : "(no model)";
		const thinkingLabel = spec.thinkingLevel ?? THINKING_UNSET_LABEL;

		const canDelete = orderedModeNames(runtime.data.modes).length > 1;
		const actions = ["Change name", "Change model", "Change thinking level"];
		if (canDelete) actions.push("Delete mode");
		actions.push(MODE_UI_BACK);

		const action = await ctx.ui.select(
			`Edit mode "${modeName}"  model: ${modelLabel}  thinking: ${thinkingLabel}`,
			actions,
		);
		if (!action || action === MODE_UI_BACK) return;

		if (action === "Change name") {
			const renamed = await renameModeUI(pi, ctx, modeName);
			if (renamed) modeName = renamed;
			continue;
		}

		if (action === "Change model") {
			const selected = await pickModelForModeUI(ctx, spec);
			if (!selected) continue;
			spec.provider = selected.provider;
			spec.modelId = selected.modelId;
			runtime.data.modes[modeName] = spec;
			await persistRuntime(pi, ctx);
			ctx.ui.notify(`Updated model for "${modeName}"`, "info");
			if (runtime.currentMode === modeName) await applyMode(pi, ctx, modeName);
			continue;
		}

		if (action === "Change thinking level") {
			const level = await pickThinkingLevelForModeUI(ctx, spec.thinkingLevel);
			if (level === undefined) continue;
			if (level === null) delete spec.thinkingLevel;
			else spec.thinkingLevel = level;
			runtime.data.modes[modeName] = spec;
			await persistRuntime(pi, ctx);
			ctx.ui.notify(`Updated thinking level for "${modeName}"`, "info");
			if (runtime.currentMode === modeName) await applyMode(pi, ctx, modeName);
			continue;
		}

		if (action === "Delete mode") {
			const ok = await ctx.ui.confirm("Delete mode", `Delete mode "${modeName}"?`);
			if (!ok) continue;

			delete runtime.data.modes[modeName];
			await persistRuntime(pi, ctx);

			if (runtime.currentMode === modeName) {
				runtime.currentMode = CUSTOM_MODE_NAME;
				customOverlay = getCurrentSelectionSpec(pi, ctx);
			}
			if (runtime.lastRealMode === modeName) {
			runtime.lastRealMode = orderedModeNames(runtime.data.modes)[0] ?? "";
		}
			requestEditorRender?.();
			ctx.ui.notify(`Deleted mode "${modeName}"`, "info");
			return;
		}
	}
}

function renameModesRecord(modes: Record<string, ModeSpec>, oldName: string, newName: string): Record<string, ModeSpec> {
	const out: Record<string, ModeSpec> = {};
	for (const [k, v] of Object.entries(modes)) {
		out[k === oldName ? newName : k] = v;
	}
	return out;
}

async function renameModeUI(pi: ExtensionAPI, ctx: ExtensionContext, oldName: string): Promise<string | undefined> {
	if (!ctx.hasUI) return undefined;
	await ensureRuntime(pi, ctx);

	while (true) {
		const raw = await ctx.ui.input(`Rename mode "${oldName}"`, oldName);
		if (raw === undefined) return undefined;

		const newName = (raw ?? "").trim();
		if (!newName || newName === oldName) return oldName;

		const err = validateModeNameOrError(newName, runtime.data.modes);
		if (err) {
			ctx.ui.notify(err, "warning");
			continue;
		}

		runtime.data.modes = renameModesRecord(runtime.data.modes, oldName, newName);
		await persistRuntime(pi, ctx);

		if (runtime.currentMode === oldName) runtime.currentMode = newName;
		if (runtime.lastRealMode === oldName) runtime.lastRealMode = newName;
		requestEditorRender?.();

		ctx.ui.notify(`Renamed "${oldName}" → "${newName}"`, "info");
		return newName;
	}
}

async function pickModelForModeUI(
	ctx: ExtensionContext,
	spec: ModeSpec,
): Promise<{ provider: string; modelId: string } | undefined> {
	if (!ctx.hasUI) return undefined;

	const settingsManager = SettingsManager.inMemory();
	const currentModel = spec.provider && spec.modelId ? ctx.modelRegistry.find(spec.provider, spec.modelId) : ctx.model;

	return ctx.ui.custom<{ provider: string; modelId: string } | undefined>((tui, _theme, _keybindings, done) => {
		return new ModelSelectorComponent(
			tui,
			currentModel,
			settingsManager,
			ctx.modelRegistry as any,
			[] as any,
			(model) => done({ provider: model.provider, modelId: model.id }),
			() => done(undefined),
		);
	});
}

async function pickThinkingLevelForModeUI(
	ctx: ExtensionContext,
	current: ThinkingLevel | undefined,
): Promise<ThinkingLevel | null | undefined> {
	if (!ctx.hasUI) return undefined;

	const defaultValue = current ?? "off";
	const options = [...ALL_THINKING_LEVELS, THINKING_UNSET_LABEL];
	const ordered = [defaultValue, ...options.filter((x) => x !== defaultValue)];

	const choice = await ctx.ui.select("Thinking level", ordered);
	if (!choice) return undefined;
	if (choice === THINKING_UNSET_LABEL) return null;
	if (ALL_THINKING_LEVELS.includes(choice as ThinkingLevel)) return choice as ThinkingLevel;
	return undefined;
}
