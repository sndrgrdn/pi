import { homedir } from "node:os";
import type {
  ExtensionAPI,
  Theme,
  ThemeColor,
  ToolRenderers,
} from "@earendil-works/pi-coding-agent";
import { Box, type Component, Text, TruncatedText } from "@earendil-works/pi-tui";
import { Option } from "effect";
import * as Schema from "effect/Schema";

type RenderCall = NonNullable<ToolRenderers["renderCall"]>;

type RenderResult = NonNullable<ToolRenderers["renderResult"]>;

type RenderContext = Parameters<RenderCall>[2];

const decodeRowFields = Schema.decodeUnknownOption(
  Schema.Struct({
    description: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    file_path: Schema.optional(Schema.String),
    pattern: Schema.optional(Schema.String),
    url: Schema.optional(Schema.String),
    query: Schema.optional(Schema.String),
    offset: Schema.optional(Schema.NullOr(Schema.Number)),
    limit: Schema.optional(Schema.NullOr(Schema.Number)),
  }),
);

function shortenHome(path: string): string {
  const home = homedir();

  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

interface ToolIcon {
  icon: string;
  color: ThemeColor;
}

const look: ToolIcon = { icon: "→", color: "accent" };

const search: ToolIcon = { icon: "✱", color: "accent" };

const change: ToolIcon = { icon: "←", color: "warning" };

const web: ToolIcon = { icon: "%", color: "mdLinkUrl" };

const otherIcon: ToolIcon = { icon: "⚙", color: "mdHeading" };

const icons = new Map<string, ToolIcon>([
  ["bash", { icon: "$", color: "success" }],
  ["read", look],
  ["ls", look],
  ["grep", search],
  ["find", search],
  ["write", change],
  ["edit", change],
  ["webfetch", web],
  ["websearch", { ...web, icon: "◈" }],
]);

function label(toolName: string, args: Parameters<RenderCall>[0]): string {
  const fields = Option.getOrUndefined(decodeRowFields(args));
  const path = shortenHome(fields?.path ?? fields?.file_path ?? "");
  const inPath = path ? ` in ${path}` : "";

  switch (toolName) {
    case "bash":
      return fields?.description ?? "Shell";
    case "read": {
      const start = fields?.offset ?? 1;

      const range =
        fields?.offset || fields?.limit
          ? `:${start}-${fields.limit ? start + fields.limit - 1 : ""}`
          : "";

      return `Read ${path}${range}`;
    }

    case "write":
      return `Write ${path}`;
    case "edit":
      return `Edit ${path}`;
    case "ls":
      return `List ${path || "."}`;
    case "grep":
      return `Grep "${fields?.pattern ?? ""}"${inPath}`;
    case "find":
      return `Find "${fields?.pattern ?? ""}"${inPath}`;
    case "webfetch":
      return `WebFetch ${fields?.url ?? ""}`;
    case "websearch":
      return `Web Search "${fields?.query ?? ""}"`;
    default:
      return toolName;
  }
}

function textOf(result: Parameters<RenderResult>[0]): string {
  return result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((part) => part.trim())
      ?.trim() ?? ""
  );
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

function shellBox(context: RenderContext, theme: Theme): Box {
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

  return box;
}

export default function minimalToolRows(pi: ExtensionAPI) {
  pi.registerToolRenderer((toolName, next) => {
    const base = next();
    const ownsShell = base?.renderShell === "self";

    return {
      renderShell: "self",
      renderCall(args, theme, context) {
        if (!context.expanded) {
          const { icon, color } = icons.get(toolName) ?? otherIcon;
          const text = label(toolName, args);

          return new TruncatedText(
            context.isError
              ? theme.fg("error", `${icon} ${text}`)
              : `${theme.fg(color, icon)} ${theme.fg(context.isPartial ? "muted" : "text", text)}`,
            context.outputPad + 2,
          );
        }

        const call = base?.renderCall
          ? delegate(context, "baseCall", (delegated) => base.renderCall!(args, theme, delegated))
          : new Text(theme.fg("toolTitle", theme.bold(toolName)), 0, 0);

        if (ownsShell) return call;

        const box = shellBox(context, theme);

        box.addChild(call);

        return box;
      },
      renderResult(result, options, theme, context) {
        if (!options.expanded) {
          if (!context.isError) return new Text("", 0, 0);

          return new TruncatedText(
            theme.fg("error", firstLine(textOf(result)) || "failed"),
            context.outputPad + 4,
          );
        }

        const rendered = base?.renderResult
          ? delegate(context, "baseResult", (delegated) =>
              base.renderResult!(result, options, theme, delegated),
            )
          : new Text(
              theme.fg(context.isError ? "error" : "toolOutput", `\n${textOf(result).trim()}`),
              0,
              0,
            );

        if (ownsShell) return rendered;

        const box = context.state.shell;

        if (box instanceof Box) box.addChild(rendered);

        return new Text("", 0, 0);
      },
    };
  });
}
