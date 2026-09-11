import { randomUUID } from "node:crypto";
import { readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Result } from "effect";
import * as Schema from "effect/Schema";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  getSelectListTheme,
  parseFrontmatter,
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionHandler,
  type RegisteredCommand,
  type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { Container, SelectList, Text, type SelectItem } from "@earendil-works/pi-tui";

const OUTPUT_STYLE_DIRECTORY = "output-styles";

const OUTPUT_STYLE_PREFERENCE_FILE = "output-styles.json";

const OutputStyleId = Schema.NonEmptyString.pipe(
  Schema.refine((id): id is string => id !== "none"),
  Schema.brand("OutputStyleId"),
);

type OutputStyleId = typeof OutputStyleId.Type;

const OutputStyleFrontmatter = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
});

interface OutputStyleFrontmatter extends Schema.Schema.Type<typeof OutputStyleFrontmatter> {}

const OutputStylePreference = Schema.Struct({
  version: Schema.Literal(1),
  outputStyle: Schema.NullOr(OutputStyleId),
});

interface OutputStylePreference extends Schema.Schema.Type<typeof OutputStylePreference> {}

const ErrnoCause = Schema.Struct({ code: Schema.optionalKey(Schema.String) });

class OutputStyleError extends Schema.TaggedError<OutputStyleError>()("OutputStyle.Error", {
  kind: Schema.Union([
    Schema.Literal("directoryRead"),
    Schema.Literal("styleRead"),
    Schema.Literal("frontmatterParse"),
    Schema.Literal("instructionsMissing"),
    Schema.Literal("styleIdInvalid"),
    Schema.Literal("preferenceRead"),
    Schema.Literal("preferenceParse"),
    Schema.Literal("preferenceWrite"),
  ]),
  path: Schema.String,
  message: Schema.String,
  code: Schema.optionalKey(Schema.String),
  cause: Schema.optionalKey(Schema.Unknown),
}) {}

type OutputStyleErrorKind = OutputStyleError["kind"];

interface OutputStyle {
  readonly id: OutputStyleId;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}

interface OutputStyleCatalog {
  readonly styles: ReadonlyMap<OutputStyleId, OutputStyle>;
  readonly errors: ReadonlyArray<OutputStyleError>;
}

interface OutputStyleDirectoryResult {
  readonly styles: OutputStyle[];
  readonly errors: OutputStyleError[];
}

interface OutputStylesExtensionAPI {
  on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
  on(
    event: "before_agent_start",
    handler: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>,
  ): void;
  registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void;
}

/** Configures where global output styles are discovered; project styles follow the session cwd. */
export interface OutputStylesExtensionOptions {
  /** Pi agent directory containing global styles and the selected output-style preference. */
  readonly agentDir: string;
}

function errnoCode(cause: unknown): string | undefined {
  const errnoResult = Schema.decodeUnknownResult(ErrnoCause)(cause);

  return Result.isSuccess(errnoResult) ? errnoResult.success.code : undefined;
}

function makeOutputStyleError(
  kind: OutputStyleErrorKind,
  path: string,
  cause?: unknown,
): OutputStyleError {
  const message = (() => {
    switch (kind) {
      case "directoryRead":
        return `Output style directory read failed: ${path}`;
      case "styleRead":
        return `Output style file read failed: ${path}`;
      case "frontmatterParse":
        return `Output style frontmatter is invalid: ${path}`;
      case "instructionsMissing":
        return `Output style instructions are missing: ${path}`;
      case "styleIdInvalid":
        return `Output style ID is invalid or reserved: ${path}`;
      case "preferenceRead":
        return `Output style preference read failed: ${path}`;
      case "preferenceParse":
        return `Output style preference is invalid: ${path}`;
      case "preferenceWrite":
        return `Output style preference write failed: ${path}`;
    }
  })();

  if (cause === undefined) return new OutputStyleError({ kind, path, message });
  const code = errnoCode(cause);

  return code === undefined
    ? new OutputStyleError({ kind, path, message, cause })
    : new OutputStyleError({ kind, path, message, code, cause });
}

function outputStyleDescription(body: string): string {
  const firstLine =
    body
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? "";

  const plainLine = firstLine.replace(/^#+\s*/, "");

  return plainLine.length > 80 ? `${plainLine.slice(0, 77)}...` : plainLine;
}

async function loadOutputStyleFile(
  filePath: string,
): Promise<Result.Result<OutputStyle, OutputStyleError>> {
  let rawContent: string;

  try {
    rawContent = await readFile(filePath, "utf8");
  } catch (cause) {
    return Result.fail(makeOutputStyleError("styleRead", filePath, cause));
  }

  let parsedFrontmatter: ReturnType<typeof parseFrontmatter>;

  try {
    parsedFrontmatter = parseFrontmatter(rawContent);
  } catch (cause) {
    return Result.fail(makeOutputStyleError("frontmatterParse", filePath, cause));
  }

  const metadataResult = Schema.decodeUnknownResult(OutputStyleFrontmatter)(
    parsedFrontmatter.frontmatter,
  );

  if (Result.isFailure(metadataResult)) {
    return Result.fail(makeOutputStyleError("frontmatterParse", filePath, metadataResult.failure));
  }

  const instructions = parsedFrontmatter.body.trim();

  if (instructions.length === 0) {
    return Result.fail(makeOutputStyleError("instructionsMissing", filePath));
  }

  const idResult = Schema.decodeUnknownResult(OutputStyleId)(basename(filePath, ".md"));

  if (Result.isFailure(idResult)) {
    return Result.fail(makeOutputStyleError("styleIdInvalid", filePath, idResult.failure));
  }

  return Result.succeed({
    id: idResult.success,
    name: metadataResult.success.name?.trim() || idResult.success,
    description: metadataResult.success.description?.trim() ?? outputStyleDescription(instructions),
    instructions,
  });
}

async function loadOutputStyleDirectory(directory: string): Promise<OutputStyleDirectoryResult> {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    return errnoCode(cause) === "ENOENT"
      ? { styles: [], errors: [] }
      : {
          styles: [],
          errors: [makeOutputStyleError("directoryRead", directory, cause)],
        };
  }

  const styles: OutputStyle[] = [];
  const errors: OutputStyleError[] = [];

  const markdownEntries = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of markdownEntries) {
    const styleResult = await loadOutputStyleFile(join(directory, entry.name));

    if (Result.isSuccess(styleResult)) styles.push(styleResult.success);
    else errors.push(styleResult.failure);
  }

  return { styles, errors };
}

async function discoverOutputStyles(options: {
  readonly agentDir: string;
  readonly cwd: string;
  readonly includeProjectStyles: boolean;
}): Promise<OutputStyleCatalog> {
  const globalDirectory = join(options.agentDir, OUTPUT_STYLE_DIRECTORY);
  const projectDirectory = join(options.cwd, CONFIG_DIR_NAME, OUTPUT_STYLE_DIRECTORY);
  const globalResult = await loadOutputStyleDirectory(globalDirectory);

  const projectResult = options.includeProjectStyles
    ? await loadOutputStyleDirectory(projectDirectory)
    : { styles: [], errors: [] };

  const styles = new Map<OutputStyleId, OutputStyle>();

  for (const style of [...globalResult.styles, ...projectResult.styles]) {
    styles.set(style.id, style);
  }

  return {
    styles,
    errors: [...globalResult.errors, ...projectResult.errors],
  };
}

async function loadOutputStylePreference(
  agentDir: string,
): Promise<Result.Result<OutputStyleId | undefined, OutputStyleError>> {
  const preferencePath = join(agentDir, OUTPUT_STYLE_PREFERENCE_FILE);
  let rawPreference: string;

  try {
    rawPreference = await readFile(preferencePath, "utf8");
  } catch (cause) {
    return errnoCode(cause) === "ENOENT"
      ? Result.succeed(undefined)
      : Result.fail(makeOutputStyleError("preferenceRead", preferencePath, cause));
  }

  let encodedPreference: unknown;

  try {
    encodedPreference = JSON.parse(rawPreference);
  } catch (cause) {
    return Result.fail(makeOutputStyleError("preferenceParse", preferencePath, cause));
  }

  const preferenceResult = Schema.decodeUnknownResult(OutputStylePreference)(encodedPreference);

  return Result.isSuccess(preferenceResult)
    ? Result.succeed(preferenceResult.success.outputStyle ?? undefined)
    : Result.fail(
        makeOutputStyleError("preferenceParse", preferencePath, preferenceResult.failure),
      );
}

async function saveOutputStylePreference(
  agentDir: string,
  outputStyle: OutputStyleId | undefined,
): Promise<Result.Result<void, OutputStyleError>> {
  const preferencePath = join(agentDir, OUTPUT_STYLE_PREFERENCE_FILE);
  const temporaryPath = join(agentDir, `.${OUTPUT_STYLE_PREFERENCE_FILE}.${randomUUID()}.tmp`);

  const preference: OutputStylePreference = {
    version: 1,
    outputStyle: outputStyle ?? null,
  };

  try {
    await writeFile(temporaryPath, `${JSON.stringify(preference, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, preferencePath);

    return Result.succeed(undefined);
  } catch (cause) {
    await unlink(temporaryPath).catch(() => undefined);

    return Result.fail(makeOutputStyleError("preferenceWrite", preferencePath, cause));
  }
}

function buildOutputStylePrompt(systemPrompt: string, style: OutputStyle): string {
  return `${systemPrompt}\n\n## Active output style: ${style.name}\n\nThe active output style governs presentation. It does not override task, safety, project, or coding instructions.\n\n${style.instructions}`;
}

function notifyOutputStyleErrors(
  ctx: ExtensionContext,
  errors: ReadonlyArray<OutputStyleError>,
): void {
  for (const error of errors) ctx.ui.notify(error.message, "warning");
}

/** Registers selectable Markdown output styles with trusted project overrides and a global preference. */
export function registerOutputStylesExtension(
  pi: OutputStylesExtensionAPI,
  options: OutputStylesExtensionOptions,
): void {
  let catalog: OutputStyleCatalog = {
    styles: new Map(),
    errors: [],
  };

  let activeStyleId: OutputStyleId | undefined;

  const refreshCatalog = async (ctx: ExtensionContext): Promise<void> => {
    catalog = await discoverOutputStyles({
      agentDir: options.agentDir,
      cwd: ctx.cwd,
      includeProjectStyles: ctx.isProjectTrusted(),
    });
    notifyOutputStyleErrors(ctx, catalog.errors);
  };

  const activateStyle = async (
    ctx: ExtensionContext,
    styleId: OutputStyleId | undefined,
  ): Promise<boolean> => {
    const saveResult = await saveOutputStylePreference(options.agentDir, styleId);

    if (Result.isFailure(saveResult)) {
      ctx.ui.notify(saveResult.failure.message, "error");

      return false;
    }

    activeStyleId = styleId;

    return true;
  };

  pi.registerCommand("output-style", {
    description: "Select the output style used for agent responses",
    handler: async (args, ctx) => {
      await refreshCatalog(ctx);
      const requestedStyleId = args.trim();

      if (requestedStyleId === "none") {
        if (await activateStyle(ctx, undefined)) {
          ctx.ui.notify("Output style disabled", "info");
        }

        return;
      }

      if (requestedStyleId.length > 0) {
        const parsedStyleId = Schema.decodeUnknownResult(OutputStyleId)(requestedStyleId);

        const requestedStyle = Result.isSuccess(parsedStyleId)
          ? catalog.styles.get(parsedStyleId.success)
          : undefined;

        if (!requestedStyle) {
          const available = [...catalog.styles.keys(), "none"].join(", ");
          ctx.ui.notify(
            `Output styles: unknown style ${JSON.stringify(requestedStyleId)}. Available: ${available}`,
            "error",
          );

          return;
        }

        if (await activateStyle(ctx, requestedStyle.id)) {
          ctx.ui.notify(`Output style ${requestedStyle.name} enabled`, "info");
        }

        return;
      }

      if (!ctx.hasUI) {
        ctx.ui.notify("Output styles: pass a style name or none", "warning");

        return;
      }

      const availableStyles = [...catalog.styles.values()];
      const labels = new Map<string, OutputStyleId | undefined>();
      labels.set("(none)", undefined);

      for (const style of availableStyles) {
        const suffix = style.description ? `: ${style.description}` : "";
        labels.set(`${style.name} [${style.id}]${suffix}`, style.id);
      }

      const menuLabels = [...labels.keys()];

      const selection = await ctx.ui.custom<string | undefined>(
        (tui, theme, _keybindings, done) => {
          const items: SelectItem[] = menuLabels.map((label) => ({ value: label, label }));

          const selectList = new SelectList(
            items,
            Math.min(items.length, 10),
            getSelectListTheme(),
          );

          const activeIndex = menuLabels.findIndex((label) => labels.get(label) === activeStyleId);
          selectList.setSelectedIndex(activeIndex);
          selectList.onSelectionChange = () => tui.requestRender();
          selectList.onSelect = (item) => done(item.value);
          selectList.onCancel = () => done(undefined);

          const menu = new Container();
          menu.addChild(new Text(theme.fg("accent", theme.bold("Select output style")), 1, 1));
          menu.addChild(selectList);

          return {
            render: (width) => menu.render(width),
            invalidate: () => menu.invalidate(),
            handleInput: (data) => selectList.handleInput(data),
          };
        },
      );

      if (selection === undefined) return;
      const selectedStyleId = labels.get(selection);

      if (!(await activateStyle(ctx, selectedStyleId))) return;
      const selectedStyle = selectedStyleId ? catalog.styles.get(selectedStyleId) : undefined;
      ctx.ui.notify(
        selectedStyle ? `Output style ${selectedStyle.name} enabled` : "Output style disabled",
        "info",
      );
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    await refreshCatalog(ctx);
    const preferenceResult = await loadOutputStylePreference(options.agentDir);

    if (Result.isFailure(preferenceResult)) {
      ctx.ui.notify(preferenceResult.failure.message, "warning");
      activeStyleId = undefined;

      return;
    }

    activeStyleId = preferenceResult.success;
    const activeStyle = activeStyleId ? catalog.styles.get(activeStyleId) : undefined;

    if (activeStyleId && !activeStyle) {
      ctx.ui.notify(
        `Output styles: selected style ${JSON.stringify(activeStyleId)} was not found`,
        "warning",
      );
      activeStyleId = undefined;
    }
  });

  pi.on("before_agent_start", (event) => {
    if (!activeStyleId) return;
    const activeStyle = catalog.styles.get(activeStyleId);

    if (!activeStyle) return;

    return { systemPrompt: buildOutputStylePrompt(event.systemPrompt, activeStyle) };
  });
}

/** Loads the output-style extension from Pi's global agent directory. */
export default function outputStylesExtension(pi: ExtensionAPI): void {
  registerOutputStylesExtension(pi, { agentDir: getAgentDir() });
}
