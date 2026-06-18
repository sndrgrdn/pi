import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keyHint, highlightCode } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const COLLAPSED_LINES = 6;
const CONFIG_FILE = join(dirname(dirname(import.meta.dirname)), "executor.json");

interface ExecutorConfig {
  url: string;
  auth?: { type: "bearer"; token: string };
}

function loadConfig(): ExecutorConfig {
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    throw new Error(`Missing or invalid ${CONFIG_FILE}`);
  }
}

type McpCallResult = {
  content?: Array<Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

function renderMcpResult(result: McpCallResult): string {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else {
      parts.push(JSON.stringify(block, null, 2));
    }
  }
  if (parts.length === 0 && result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  }
  if (parts.length === 0) {
    parts.push(JSON.stringify(result, null, 2));
  }
  return parts.join("\n");
}

function resultRenderer(
  result: { content: Array<{ type: string; text?: string }>; details: unknown },
  { expanded, isPartial }: { expanded: boolean; isPartial: boolean },
  theme: Parameters<NonNullable<Parameters<ExtensionAPI["registerTool"]>[0]["renderResult"]>>[2],
) {
  if (isPartial) {
    return new Text(theme.fg("warning", "Running…"), 0, 0);
  }

  const raw =
    result.content?.[0]?.type === "text"
      ? (result.content[0] as { text: string }).text
      : JSON.stringify(result.details, null, 2);
  const lines = raw.split("\n");
  const total = lines.length;
  if (expanded || total <= COLLAPSED_LINES) {
    return new Text(theme.fg("muted", raw), 0, 0);
  }

  const preview = lines.slice(0, COLLAPSED_LINES).join("\n");
  const container = new Container();
  container.addChild(new Text(theme.fg("muted", preview), 0, 0));
  container.addChild(new Spacer(1));
  container.addChild(
    new Text(
      theme.fg(
        "dim",
        `… ${total - COLLAPSED_LINES} more lines (${keyHint("app.tools.expand", "to expand")})`,
      ),
      0,
      0,
    ),
  );
  return container;
}

export default async function executor(pi: ExtensionAPI) {
  let client: Client | undefined;
  let connecting: Promise<Client> | undefined;

  function clearClient() {
    client = undefined;
    connecting = undefined;
  }

  async function disconnect() {
    const current = client;
    clearClient();
    if (current) {
      try {
        await current.close();
      } catch {
        /* ignore */
      }
    }
  }

  async function connect(): Promise<Client> {
    if (client) return client;
    if (connecting) return connecting;

    const config = loadConfig();
    const headers: Record<string, string> = {};
    if (config.auth?.type === "bearer") {
      headers["Authorization"] = `Bearer ${config.auth.token}`;
    }

    connecting = (async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers } },
      );

      transport.onclose = clearClient;
      transport.onerror = clearClient;

      const c = new Client({ name: "pi-executor", version: "0.1.0" });
      await c.connect(transport);
      client = c;
      return c;
    })();

    try {
      return await connecting;
    } catch (error) {
      clearClient();
      throw error;
    }
  }

  async function callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    const c = await connect();
    const result = (await c.callTool(
      { name, arguments: args },
      undefined,
      // TODO: SDK doesn't type the signal option yet
      { signal } as never,
    )) as McpCallResult;

    const text = renderMcpResult(result);
    if (result.isError) throw new Error(text);

    return {
      content: [{ type: "text" as const, text }],
      details: result,
    };
  }

  // --- Discover and register tools from the MCP server ---

  try {
    const c = await connect();
    const { tools } = await c.listTools();

    for (const tool of tools) {
      const toolName = `executor_${tool.name}`;

      pi.registerTool({
        name: toolName,
        label: `Executor ${tool.name}`,
        description: tool.description ?? tool.name,
        promptSnippet: tool.description?.split("\n")[0] ?? tool.name,
        parameters: Type.Unsafe(tool.inputSchema),

        async execute(_id, params, signal) {
          return callTool(tool.name, params, signal);
        },

        renderCall(args, theme, context) {
          const text =
            (context.lastComponent as Text | undefined) ??
            new Text("", 0, 0);

          let preview = "";
          if (args && typeof args === "object") {
            const raw = args.code ?? args.executionId ?? Object.values(args)[0];
            if (raw != null) {
              preview = String(raw).split("\n")[0].slice(0, 80);
            }
          }

          text.setText(
            theme.fg("toolTitle", theme.bold("executor ")) +
              theme.fg("accent", `${tool.name} `) +
              (preview
                ? highlightCode(preview, "typescript").join("\n") +
                  (preview.length >= 80 ? theme.fg("dim", " …") : "")
                : ""),
          );
          return text;
        },

        renderResult: resultRenderer,
      });
    }
  } catch {
    // Server unreachable at load time — tools will be registered on reconnect via /executor-restart
  }

  // --- Commands ---

  pi.registerCommand("executor-restart", {
    description: "Reconnect to Executor and re-discover tools",
    handler: async (_args, ctx) => {
      await disconnect();
      try {
        const c = await connect();
        const { tools } = await c.listTools();
        ctx.ui.notify(
          `Executor reconnected — ${tools.length} tool(s) available.`,
          "info",
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Executor reconnect failed: ${msg}`, "error");
      }
    },
  });

  // --- Lifecycle ---

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    try {
      await connect();
      ctx.ui.setStatus("executor", "executor ✓");
    } catch {
      ctx.ui.setStatus("executor", "executor ✗");
    }
  });

  pi.on("session_shutdown", async () => {
    await disconnect();
  });
}
