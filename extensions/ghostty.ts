import { keyHint, type ExtensionAPI, type Theme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(execFile);

async function runJxa(script: string): Promise<string> {
  const { stdout } = await execAsync("osascript", ["-l", "JavaScript", "-e", script], {
    timeout: 10_000,
  });
  return stdout.trim();
}

function resolveTerminal(id: string): string {
  return `
    const app = Application("Ghostty");
    const matches = app.terminals.whose({id: ${JSON.stringify(id)}});
    if (matches.length === 0) throw new Error("Terminal not found: " + ${JSON.stringify(id)});
    const t = matches[0];`;
}

interface TerminalInfo {
  id: string;
  name: string;
  cwd: string;
  pid: number;
  tty: string;
}

async function listTerminals(): Promise<TerminalInfo[]> {
  const raw = await runJxa(`
    const app = Application("Ghostty");
    const terms = app.terminals();
    JSON.stringify(terms.map(t => ({
      id: t.id(), name: t.name(), cwd: t.workingDirectory(),
      pid: t.pid(), tty: t.tty()
    })));`);
  return JSON.parse(raw);
}

async function sendText(terminalId: string, text: string, submit = false): Promise<void> {
  await runJxa(`${resolveTerminal(terminalId)}
    app.inputText(${JSON.stringify(text)}, {to: t});
    ${submit ? 'app.sendKey("enter", {to: t});' : ""}`);
}

async function focusTerminal(terminalId: string): Promise<void> {
  await runJxa(`${resolveTerminal(terminalId)}
    app.focus(t);`);
}

type GhosttyToolDetails =
  | { action: "list"; terminals: TerminalInfo[] }
  | { action: "send_text"; id: string; text: string; submitted: boolean }
  | { action: "focus"; id: string }
  | { error: string };

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "…" : id;
}

function renderTerminalLine(theme: Theme, t: TerminalInfo, compact: boolean): string {
  const id = theme.fg("accent", truncateId(t.id));
  const name = theme.fg("text", t.name || "(untitled)");
  if (compact) return `  ${id} ${name}`;
  return `  ${id} ${name} ${theme.fg("dim", t.cwd)} ${theme.fg("dim", t.tty)}`;
}

function renderTerminalList(theme: Theme, terminals: TerminalInfo[], expanded: boolean): string {
  if (!terminals.length) return theme.fg("dim", "No terminals found.");
  const header = theme.fg("muted", `${terminals.length} terminal(s)`);
  const lines = terminals.map((t) => renderTerminalLine(theme, t, !expanded));
  return [header, ...lines].join("\n");
}

const GhosttyParams = Type.Object({
  action: StringEnum(["list", "send_text", "focus"] as const, {
    description:
      "Operation to perform. list: all terminals with id/name/cwd/pid/tty. send_text: paste text into a terminal. focus: bring a terminal to front.",
  }),
  id: Type.Optional(
    Type.String({ description: "Terminal id from list. Required for send_text and focus." }),
  ),
  text: Type.Optional(
    Type.String({ description: "Text to send verbatim (no auto-Enter). Required for send_text." }),
  ),
  submit: Type.Optional(
    Type.Boolean({ description: "Press Enter after sending text. Default false — text stays in input for human review." }),
  ),
});

export default function ghosttyExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ghostty",
    label: "Ghostty",
    description:
      "Control Ghostty terminal tabs. List terminals, send text to a terminal, or focus it. Use list first to discover terminal ids.",
    parameters: GhosttyParams,

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      try {
        switch (params.action) {
          case "list": {
            const terminals = await listTerminals();
            return {
              content: [{ type: "text", text: terminals.length === 0 ? "No terminals found." : JSON.stringify(terminals, null, 2) }],
              details: { action: "list", terminals },
            };
          }

          case "send_text": {
            if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { error: "id required" } };
            if (!params.text) return { content: [{ type: "text", text: "Error: text required" }], details: { error: "text required" } };
            await sendText(params.id, params.text, Boolean(params.submit));
            const submitted = Boolean(params.submit);
            return {
              content: [{ type: "text", text: `Sent ${params.text.length} chars to terminal ${params.id}${submitted ? " (submitted)" : ""}` }],
              details: { action: "send_text", id: params.id, text: params.text, submitted },
            };
          }

          case "focus": {
            if (!params.id) return { content: [{ type: "text", text: "Error: id required" }], details: { error: "id required" } };
            await focusTerminal(params.id);
            return {
              content: [{ type: "text", text: `Focused terminal ${params.id}` }],
              details: { action: "focus", id: params.id },
            };
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Ghostty error: ${message}` }],
          details: { error: message },
        };
      }
    },

    renderCall(args, theme) {
      const action = typeof args.action === "string" ? args.action : "";
      const id = typeof args.id === "string" ? truncateId(args.id) : "";
      let text = theme.fg("toolTitle", theme.bold("ghostty ")) + theme.fg("muted", action);
      if (id) text += " " + theme.fg("accent", id);
      if (action === "send_text" && typeof args.text === "string") {
        const preview = args.text.length > 60 ? args.text.slice(0, 60) + "…" : args.text;
        text += " " + theme.fg("dim", `"${preview}"`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as GhosttyToolDetails | undefined;

      if (isPartial) return new Text(theme.fg("warning", "Processing..."), 0, 0);
      if (!details) {
        const t = result.content[0];
        return new Text(t?.type === "text" ? t.text : "", 0, 0);
      }
      if ("error" in details) return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);

      if (details.action === "list") {
        let text = renderTerminalList(theme, details.terminals, expanded);
        if (!expanded && details.terminals.length > 0) {
          text += "\n" + theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`);
        }
        return new Text(text, 0, 0);
      }

      if (details.action === "send_text") {
        const verb = details.submitted ? "Submitted to" : "Sent text to";
        const header = theme.fg("success", "✓ ") + theme.fg("muted", verb + " ") + theme.fg("accent", truncateId(details.id));
        if (expanded) return new Text(header + "\n" + details.text, 0, 0);
        const preview = details.text.length > 80
          ? details.text.slice(0, 80).replace(/\n/g, "⏎") + "…"
          : details.text.replace(/\n/g, "⏎");
        return new Text(
          header + "\n" + theme.fg("dim", preview) + "\n" + theme.fg("dim", `(${keyHint("app.tools.expand", "to expand")})`),
          0, 0,
        );
      }

      if (details.action === "focus") {
        return new Text(
          theme.fg("success", "✓ ") + theme.fg("muted", "Focused ") + theme.fg("accent", truncateId(details.id)),
          0, 0,
        );
      }

      const t = result.content[0];
      return new Text(t?.type === "text" ? t.text : "", 0, 0);
    },
  });
}
