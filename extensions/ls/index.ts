import type { ExtensionAPI, ToolDefinition } from "@mariozechner/pi-coding-agent"
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent"
import type { TruncationResult } from "@mariozechner/pi-coding-agent"
import { Text } from "@mariozechner/pi-tui"
import { Type } from "typebox"
import * as path from "node:path"
import { buildRgArgs, buildTree, renderTree, FILE_LIMIT } from "./ls.ts"

const lsSchema = Type.Object({
  path: Type.Optional(
    Type.String({
      description: "The absolute path to the directory to list (must be absolute, not relative)",
    }),
  ),
  ignore: Type.Optional(
    Type.Array(Type.String(), { description: "List of glob patterns to ignore" }),
  ),
})

type LsSchema = typeof lsSchema

interface LsDetails {
  count: number
  truncatedFiles: boolean
  truncation?: TruncationResult
}

export default function (pi: ExtensionAPI) {
  const tool: ToolDefinition<LsSchema, LsDetails, Record<string, never>> = {
    name: "ls",
    label: "ls",
    description: [
      "Lists files and directories in a given path.",
      "The path parameter must be absolute; omit it to use the current workspace directory.",
      "You can optionally provide an array of glob patterns to ignore with the ignore parameter.",
      "You should generally prefer the Glob and Grep tools, if you know which directories to search.",
    ].join(" "),

    promptSnippet: "List files as an indented tree (ripgrep-powered, respects .gitignore)",

    parameters: lsSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const searchPath = path.resolve(ctx.cwd, params.path || ".")
      const rgArgs = buildRgArgs(params.ignore)

      const result = await pi.exec("rg", rgArgs, { cwd: searchPath, signal, timeout: 15000 })

      if (result.code !== 0 && !result.stdout.trim()) {
        if (result.code === 1) {
          return {
            content: [{ type: "text" as const, text: "(empty directory)" }],
            details: { count: 0, truncatedFiles: false },
          }
        }
        throw new Error(`rg failed (exit ${result.code}): ${result.stderr}`)
      }

      const files = result.stdout.trim().split("\n").filter(Boolean)
      const truncatedFiles = files.length > FILE_LIMIT
      const limitedFiles = files.slice(0, FILE_LIMIT)

      const tree = buildTree(limitedFiles)
      let output = `${searchPath}/\n` + renderTree(tree)

      const truncation = truncateHead(output, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      })

      output = truncation.content

      const notices: string[] = []
      if (truncatedFiles) {
        notices.push(`${FILE_LIMIT} file limit reached`)
      }
      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} output limit reached`)
      }
      if (notices.length > 0) {
        output += `\n\n[Truncated: ${notices.join(". ")}]`
      }

      return {
        content: [{ type: "text" as const, text: output }],
        details: {
          count: limitedFiles.length,
          truncatedFiles,
          truncation: truncation.truncated ? truncation : undefined,
        },
      }
    },

    renderCall(args, theme, context) {
      const text =
        (context.lastComponent instanceof Text ? context.lastComponent : null) ?? new Text("", 0, 0)
      const displayPath = args?.path ? args.path.replace(process.env.HOME || "", "~") : "."
      let content = `${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", displayPath)}`
      if (args?.ignore?.length) {
        content += theme.fg("muted", ` (ignoring ${args.ignore.length} extra patterns)`)
      }
      text.setText(content)
      return text
    },

    renderResult(result, { expanded }, theme, context) {
      const text =
        (context.lastComponent instanceof Text ? context.lastComponent : null) ?? new Text("", 0, 0)

      if (context.isError) {
        const msg = (result.content.find((c: any) => c.type === "text") as any)?.text || "Failed"
        text.setText(theme.fg("error", msg))
        return text
      }

      if (!expanded) {
        const count = result.details.count
        text.setText(count > 0 ? theme.fg("muted", `${count} files`) : "")
        return text
      }

      let output = ""
      for (const block of result.content) {
        if (block.type === "text") {
          output += block.text
        }
      }
      output = output.trim()

      if (!output) {
        text.setText(theme.fg("muted", "(empty)"))
        return text
      }

      const lines = output.split("\n")
      let content = lines.map((line) => theme.fg("toolOutput", line)).join("\n")

      text.setText(content)
      return text
    },
  }

  pi.registerTool(tool)
}
