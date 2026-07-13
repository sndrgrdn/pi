import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { createTraceRenderer, formatTracePath, type TraceInvocation, withTraceDetails } from "../ui/trace.ts";

interface ReadParams {
	path: string;
	offset?: number;
	limit?: number;
}

const schema = Type.Object({
	path: Type.String({ description: "Path to a file (relative or absolute)." }),
	offset: Type.Optional(
		Type.Number({ description: "Start from this line/entry number (1-indexed). Use to continue after truncation." }),
	),
	limit: Type.Optional(
		Type.Number({
			description: "Maximum lines or entries to return. Prefer larger windows over tiny repeated chunks.",
		}),
	),
});

const description = [
	"Read the contents of a file.",
	"Supports text files and images (jpg, png, gif, webp). Images are sent as attachments.",
	`Output truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.`,
	"Use offset/limit for large files; continue with offset until complete when needed.",
].join(" ");

function readTraceInvocation(args: ReadParams, cwd: string): TraceInvocation {
	let range: string | undefined;
	if (args.offset !== undefined || args.limit !== undefined) {
		const start = args.offset ?? 1;
		const end = args.limit === undefined ? "" : start + args.limit - 1;
		range = `lines ${start}-${end}`;
	}
	return {
		action: "read",
		target: formatTracePath(args.path, cwd),
		qualifiers: range ? [range] : [],
	};
}

const traceRenderer = createTraceRenderer<ReadParams>({ invocation: readTraceInvocation });

export function createHarnessReadTool(cancelledCalls = new Set<string>()): ToolDefinition<any, any, any> {
	const base = createReadToolDefinition(process.cwd());
	return {
		...base,
		description,
		parameters: schema,
		renderShell: "self",
		async execute(toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
			onUpdate?.({ content: [{ type: "text", text: "" }], details: withTraceDetails(undefined, "running") });
			try {
				const result = await createReadToolDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
				const image = result.content.find((item) => item.type === "image");
				const qualifiers = image?.mimeType ? [image.mimeType] : undefined;
				return { ...result, details: withTraceDetails(result.details, "success", qualifiers) };
			} catch (error) {
				if (signal?.aborted) cancelledCalls.add(toolCallId);
				throw error;
			}
		},
		renderCall: traceRenderer.renderCall,
		renderResult: traceRenderer.renderResult,
	} as ToolDefinition<any, any, any>;
}

export function registerHarnessRead(pi: ExtensionAPI): void {
	const cancelledCalls = new Set<string>();
	pi.registerTool(createHarnessReadTool(cancelledCalls));
	pi.on("tool_result", (event) => {
		if (event.toolName !== "read" || !cancelledCalls.delete(event.toolCallId)) return undefined;
		return { details: withTraceDetails(event.details, "cancelled") };
	});
}

export default function (pi: ExtensionAPI) {
	registerHarnessRead(pi);
}
