import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createReadToolDefinition, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	createTraceRenderer,
	emitTraceRunning,
	formatTracePath,
	type TraceInvocation,
	type TraceToolRegistrar,
	withTraceDetails,
} from "../ui/trace.ts";

interface ReadParams {
	path: string;
	offset?: number;
	limit?: number;
}

const schema = Type.Object({
	path: Type.String({ description: "File path, relative or absolute." }),
	offset: Type.Optional(
		Type.Number({ description: "First line or entry to return, 1-indexed. Continue from here after truncation." }),
	),
	limit: Type.Optional(
		Type.Number({
			description: "Maximum lines or entries to return. Prefer one large window to many small reads.",
		}),
	),
});

const description = [
	"Read text files or inspect images (jpg, png, gif, webp). Images are returned as attachments.",
	`Output truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.`,
	"Continue truncated files with offset and limit until the needed content is covered.",
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

export function createHarnessReadTool(): ToolDefinition<any, any, any> {
	const base = createReadToolDefinition(process.cwd());
	return {
		...base,
		description,
		parameters: schema,
		renderShell: "self",
		async execute(toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) {
			emitTraceRunning(onUpdate);
			const result = await createReadToolDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
			const image = result.content.find((item) => item.type === "image");
			const qualifiers = image?.mimeType ? [image.mimeType] : undefined;
			return { ...result, details: withTraceDetails(result.details, "success", qualifiers) };
		},
		renderCall: traceRenderer.renderCall,
		renderResult: traceRenderer.renderResult,
	} as ToolDefinition<any, any, any>;
}

export function registerHarnessRead(
	pi: ExtensionAPI,
	register: TraceToolRegistrar["register"] = (tool) => pi.registerTool(tool),
): void {
	register(createHarnessReadTool());
}

export default function (pi: ExtensionAPI, register?: TraceToolRegistrar["register"]) {
	registerHarnessRead(pi, register);
}
