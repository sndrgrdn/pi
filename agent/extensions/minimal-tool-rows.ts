import { homedir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, Theme, ToolRenderers } from "@earendil-works/pi-coding-agent";
import {
  Box,
  getCapabilities,
  hyperlink,
  type Component,
  Spacer,
  Text,
} from "@earendil-works/pi-tui";
import { Option } from "effect";
import * as Schema from "effect/Schema";

const decodePathFields = Schema.decodeUnknownOption(
  Schema.Struct({
    path: Schema.optional(Schema.String),
    file_path: Schema.optional(Schema.String),
    content: Schema.optional(Schema.String),
  }),
);

const decodeEditFields = Schema.decodeUnknownOption(
  Schema.Struct({ edits: Schema.Array(Schema.Unknown) }),
);

type RenderCall = NonNullable<ToolRenderers["renderCall"]>;

type RenderResult = NonNullable<ToolRenderers["renderResult"]>;

type RenderContext = Parameters<RenderCall>[2];

function pathLabel(path: string, cwd: string, theme: Theme): string {
  const home = homedir();
  const label = path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  const styled = theme.fg("accent", label);

  if (!getCapabilities().hyperlinks) return styled;

  const absolute =
    path === "~" || path.startsWith("~/") ? resolve(home, path.slice(2)) : resolve(cwd, path);

  return hyperlink(styled, pathToFileURL(absolute).href);
}

function callLine(
  toolName: string,
  args: Parameters<RenderCall>[0],
  theme: Theme,
  cwd: string,
): string {
  const fields = Option.getOrUndefined(decodePathFields(args));
  const path = fields?.path ?? fields?.file_path;
  let text = `${theme.fg("toolTitle", theme.bold(toolName))} ${path ? pathLabel(path, cwd, theme) : theme.fg("toolOutput", "...")}`;

  if (toolName === "edit") {
    const count = Option.getOrUndefined(decodeEditFields(args))?.edits.length;

    if (count !== undefined && count > 1) text += theme.fg("dim", ` (${count} edits)`);
  }

  if (toolName === "write" && fields?.content) {
    text += theme.fg("dim", ` (${fields.content.split("\n").length} lines)`);
  }

  return text;
}

function textOf(result: Parameters<RenderResult>[0]): string {
  return result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

function firstLine(text: string): string {
  const line =
    text
      .split("\n")
      .find((part) => part.trim())
      ?.trim() ?? "";

  return line.length > 160 ? `${line.slice(0, 157)}...` : line;
}

function textSlot(context: RenderContext, value: string): Text {
  const current = context.state.call;
  const text = current instanceof Text ? current : new Text("", 0, 0);

  context.state.call = text;
  text.setText(value);

  return text;
}

function shellSlot(context: RenderContext, theme: Theme, value: string): Box {
  const current = context.state.shell;
  const box = current instanceof Box ? current : new Box(1, 1);

  const token = context.isPartial
    ? "toolPendingBg"
    : context.isError
      ? "toolErrorBg"
      : "toolSuccessBg";

  context.state.shell = box;
  box.setBgFn((line) => theme.bg(token, line));
  box.setPaddingX(context.outputPad);
  box.clear();
  box.addChild(new Text(value, 0, 0));

  return box;
}

function delegate(
  context: RenderContext,
  slot: "baseCall" | "baseResult",
  render: (context: RenderContext) => Component,
): Component {
  const component = render({ ...context, lastComponent: context.state[slot] });

  context.state[slot] = component;

  return component;
}

export default function minimalToolRows(pi: ExtensionAPI) {
  pi.registerToolRenderer((toolName, next) => {
    const base = next();
    const renderResult = base?.renderResult;

    const renderers: ToolRenderers = {
      ...base,
      renderResult(result, options, theme, context) {
        const rendered = renderResult
          ? delegate(context, "baseResult", (delegated) =>
              renderResult(result, options, theme, delegated),
            )
          : undefined;

        if (options.expanded) {
          if (rendered) return rendered;

          const text = textOf(result).trim();

          return new Text(
            text ? theme.fg(context.isError ? "error" : "toolOutput", text) : "",
            0,
            0,
          );
        }

        if (!context.isError) return new Text("", 0, 0);

        const line = theme.fg("error", firstLine(textOf(result)) || "failed");
        const box = context.state.shell;

        if (base?.renderShell === "self" && box instanceof Box) {
          box.addChild(new Spacer(1));
          box.addChild(new Text(line, 0, 0));

          return new Text("", 0, 0);
        }

        return new Text(line, 0, 0);
      },
    };

    if (toolName === "edit" || toolName === "write") {
      renderers.renderCall = (args, theme, context) => {
        if (context.expanded && base?.renderCall) {
          return delegate(context, "baseCall", (delegated) =>
            base.renderCall!(args, theme, delegated),
          );
        }

        const value = callLine(toolName, args, theme, context.cwd);

        return base?.renderShell === "self"
          ? shellSlot(context, theme, value)
          : textSlot(context, value);
      };
    }

    return renderers;
  });
}
