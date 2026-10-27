import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
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

/**
 * Collapsed tool rows show the call only, like `read`.
 * ctrl+o restores the built-in call body and result.
 * Failures still show their first line.
 *
 * `edit` draws its own bar (`renderShell: "self"`). A plain Text has no background.
 */
const PATH_CALLS = new Set(["edit", "write"]);

const PathFields = Schema.Struct({
  path: Schema.optional(Schema.String),
  file_path: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
});

const EditFields = Schema.Struct({
  edits: Schema.Array(Schema.Unknown),
});

const decodePathFields = Schema.decodeUnknownOption(PathFields);

const decodeEditFields = Schema.decodeUnknownOption(EditFields);

type PathFields = Schema.Schema.Type<typeof PathFields>;

type RenderCall = NonNullable<ToolRenderers["renderCall"]>;

type RenderResult = NonNullable<ToolRenderers["renderResult"]>;

type RenderContext = Parameters<RenderCall>[2];

type RenderedResult = Parameters<RenderResult>[0];

function shortenPath(path: string): string {
  const home = homedir();

  if (path === home || path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;

  return path;
}

function pathLabel(path: string, cwd: string, theme: Theme): string {
  const styled = theme.fg("accent", shortenPath(path));

  if (!getCapabilities().hyperlinks) return styled;

  const absolute = isAbsolute(path) ? path : resolve(cwd, path);

  return hyperlink(styled, pathToFileURL(absolute).href);
}

function callLine(
  toolName: string,
  fields: PathFields | undefined,
  editCount: number | undefined,
  theme: Theme,
  cwd: string,
): string {
  const path = fields?.path ?? fields?.file_path;
  let text = `${theme.fg("toolTitle", theme.bold(toolName))} ${path ? pathLabel(path, cwd, theme) : theme.fg("toolOutput", "...")}`;

  if (toolName === "edit" && editCount !== undefined && editCount > 1) {
    text += theme.fg("dim", ` (${editCount} edits)`);
  }

  if (toolName === "write" && fields?.content) {
    text += theme.fg("dim", ` (${fields.content.split("\n").length} lines)`);
  }

  return text;
}

function textOf(result: RenderedResult): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n");
}

function firstLine(text: string): string {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);

  if (!line) return "";

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

function hiddenResult(
  base: ToolRenderers | undefined,
  result: RenderedResult,
  options: Parameters<RenderResult>[1],
  theme: Theme,
  context: RenderContext,
): Component {
  if (!options.expanded) {
    if (!context.isError) return new Text("", 0, 0);

    const line = firstLine(textOf(result)) || "failed";
    const box = context.state.shell;

    if (base?.renderShell === "self" && box instanceof Box) {
      box.addChild(new Spacer(1));
      box.addChild(new Text(theme.fg("error", line), 0, 0));

      return new Text("", 0, 0);
    }

    return new Text(theme.fg("error", line), 0, 0);
  }

  if (!base?.renderResult) {
    const text = textOf(result).trim();

    if (!text) return new Text("", 0, 0);

    return new Text(theme.fg(context.isError ? "error" : "toolOutput", text), 0, 0);
  }

  return delegate(context, "baseResult", (delegated) =>
    base.renderResult!(result, options, theme, delegated),
  );
}

export default function minimalToolRows(pi: ExtensionAPI) {
  pi.registerToolRenderer((toolName, next) => {
    const base = next();

    const renderResult: ToolRenderers["renderResult"] = (result, options, theme, context) =>
      hiddenResult(base, result, options, theme, context);

    if (!PATH_CALLS.has(toolName)) return { ...base, renderResult };

    return {
      ...base,
      renderCall(args, theme, context) {
        if (context.expanded && base?.renderCall) {
          return delegate(context, "baseCall", (delegated) =>
            base.renderCall!(args, theme, delegated),
          );
        }

        const fields = Option.getOrUndefined(decodePathFields(args));
        const editCount = Option.getOrUndefined(decodeEditFields(args))?.edits.length;
        const value = callLine(toolName, fields, editCount, theme, context.cwd);

        return base?.renderShell === "self"
          ? shellSlot(context, theme, value)
          : textSlot(context, value);
      },
      renderResult,
    };
  });
}
