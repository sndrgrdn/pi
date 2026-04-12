import type { ExtensionAPI, ExtensionContext, ModelSelectEvent } from "@mariozechner/pi-coding-agent";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import {
	CUSTOM_MODE_NAME,
	runtime,
	setRequestEditorRender,
	setCustomOverlay,
	getCustomOverlay,
	setLastObservedModel,
	triggerEditorRender,
	ensureRuntime,
	applyMode,
	cycleMode,
	selectModeUI,
	getCurrentSelectionSpec,
	storeSelectionIntoMode,
	inferModeFromSelection,
	orderedModeNames,
	getModeBorderColor,
	formatModeLabel,
} from "./modes.ts";
import {
	type PromptEntry,
	collectUserPromptsFromEntries,
	loadPromptHistoryForCwd,
	buildHistoryList,
	historiesMatch,
} from "./prompt-history.ts";

// =============================================================================
// PromptEditor
// =============================================================================

class PromptEditor extends CustomEditor {
	public modeLabelProvider?: () => string;
	/**
	 * Color function for the mode label. If unset, the label inherits the border color.
	 */
	public modeLabelColor?: (text: string) => string;
	private computeBorderColor?: (text: string) => string;

	setBorderColorFn(fn: (text: string) => string) {
		this.computeBorderColor = fn;
	}

	render(width: number): string[] {
		// Re-apply our border color right before render — always wins over framework writes.
		if (this.computeBorderColor) this.borderColor = this.computeBorderColor;

		const lines = super.render(width);
		const mode = this.modeLabelProvider?.();
		if (!mode) return lines;

		const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
		const topPlain = stripAnsi(lines[0] ?? "");

		// Preserve scroll indicator on the top border if present.
		const scrollPrefixMatch = topPlain.match(/^(─── ↑ \d+ more )/);
		const prefix = scrollPrefixMatch?.[1] ?? "──";

		let label = formatModeLabel(mode);

		const labelLeftSpace = prefix.endsWith(" ") ? "" : " ";
		const labelRightSpace = " ";
		const minRightBorder = 1;
		const maxLabelLen = Math.max(0, width - prefix.length - labelLeftSpace.length - labelRightSpace.length - minRightBorder);
		if (maxLabelLen <= 0) return lines;
		if (label.length > maxLabelLen) label = label.slice(0, maxLabelLen);

		const labelChunk = `${labelLeftSpace}${label}${labelRightSpace}`;
		const remaining = width - prefix.length - labelChunk.length;
		if (remaining < 0) return lines;

		const right = "─".repeat(Math.max(0, remaining));
		const labelColor = this.modeLabelColor ?? ((text: string) => this.borderColor(text));
		lines[0] = this.borderColor(prefix) + labelColor(labelChunk) + this.borderColor(right);
		return lines;
	}

	public requestRenderNow(): void {
		this.tui.requestRender();
	}
}

// =============================================================================
// Editor wiring
// =============================================================================

let loadCounter = 0;

function setEditor(pi: ExtensionAPI, ctx: ExtensionContext, history: PromptEntry[]) {
	ctx.ui.setEditorComponent((tui, theme, keybindings) => {
		const editor = new PromptEditor(tui, theme, keybindings);
		setRequestEditorRender(() => editor.requestRenderNow());

		editor.modeLabelProvider = () => runtime.currentMode;
		editor.modeLabelColor = (text: string) => ctx.ui.theme.fg("dim", text);
		editor.setBorderColorFn((text: string) => {
			const isBashMode = editor.getText().trimStart().startsWith("!");
			if (isBashMode) return ctx.ui.theme.getBashModeBorderColor()(text);
			return getModeBorderColor(ctx, pi, runtime.currentMode)(text);
		});

		for (const prompt of history) editor.addToHistory?.(prompt.text);
		return editor;
	});
}

function applyEditor(pi: ExtensionAPI, ctx: ExtensionContext) {
	if (!ctx.hasUI) return;

	const sessionFile = ctx.sessionManager.getSessionFile();
	const currentPrompts = collectUserPromptsFromEntries(ctx.sessionManager.getBranch());
	const immediateHistory = buildHistoryList(currentPrompts, []);

	const currentLoad = ++loadCounter;
	const initialText = ctx.ui.getEditorText();
	setEditor(pi, ctx, immediateHistory);

	// Async: load cross-session history and re-apply if it differs.
	void (async () => {
		const previousPrompts = await loadPromptHistoryForCwd(ctx.cwd, sessionFile ?? undefined);
		if (currentLoad !== loadCounter) return;
		if (ctx.ui.getEditorText() !== initialText) return;
		const history = buildHistoryList(currentPrompts, previousPrompts);
		if (historiesMatch(history, immediateHistory)) return;
		setEditor(pi, ctx, history);
	})();
}

// =============================================================================
// Extension export
// =============================================================================

export default function (pi: ExtensionAPI) {
	pi.registerCommand("mode", {
		description: "Select prompt mode",
		handler: async (args, ctx) => {
			const tokens = args
				.split(/\s+/)
				.map((x) => x.trim())
				.filter(Boolean);

			// /mode
			if (tokens.length === 0) {
				await selectModeUI(pi, ctx);
				return;
			}

			// /mode store [name]
			if (tokens[0] === "store") {
				await ensureRuntime(pi, ctx);

				let target = tokens[1];
				if (!target) {
					if (!ctx.hasUI) return;
					const names = orderedModeNames(runtime.data.modes);
					target = await ctx.ui.select("Store current selection into mode", names);
					if (!target) return;
				}

				if (target === CUSTOM_MODE_NAME) {
					if (ctx.hasUI) ctx.ui.notify(`Cannot store into "${CUSTOM_MODE_NAME}"`, "warning");
					return;
				}

				const selection = getCustomOverlay() ?? getCurrentSelectionSpec(pi, ctx);
				await storeSelectionIntoMode(pi, ctx, target, selection);
				if (ctx.hasUI) ctx.ui.notify(`Stored current selection into "${target}"`, "info");
				return;
			}

			// /mode <name>
			await applyMode(pi, ctx, tokens[0]!);
		},
	});

	pi.registerShortcut("alt+m", {
		description: "Cycle prompt mode",
		handler: async (ctx) => {
			await cycleMode(pi, ctx, 1);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		setLastObservedModel({ provider: ctx.model?.provider, modelId: ctx.model?.id });
		await ensureRuntime(pi, ctx);
		setCustomOverlay(null);

		const inferred = inferModeFromSelection(ctx, pi, runtime.data);
		if (inferred) {
			runtime.currentMode = inferred;
			runtime.lastRealMode = inferred;
		} else {
			runtime.currentMode = CUSTOM_MODE_NAME;
			setCustomOverlay(getCurrentSelectionSpec(pi, ctx));
		}

		applyEditor(pi, ctx);
	});

	pi.on("model_select", async (event: ModelSelectEvent, ctx) => {
		setLastObservedModel({ provider: event.model.provider, modelId: event.model.id });

		// Skip mode switching triggered by applyMode() itself.
		if (runtime.applying) return;

		// Manual model changes always go into the overlay "custom" mode.
		await ensureRuntime(pi, ctx);
		if (runtime.currentMode !== CUSTOM_MODE_NAME) {
			runtime.lastRealMode = runtime.currentMode;
		}
		runtime.currentMode = CUSTOM_MODE_NAME;

		setCustomOverlay({
			provider: event.model.provider,
			modelId: event.model.id,
			thinkingLevel: pi.getThinkingLevel(),
		});

		if (ctx.hasUI) triggerEditorRender();
	});
}
