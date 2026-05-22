import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { ReviewAnnotation, ReviewDecision } from "./src/types";

const execFileAsync = promisify(execFile);
const EXTENSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const DIST_DIR = join(EXTENSION_DIR, "dist");

type SubmitBody = {
  decision?: ReviewDecision;
  summary?: string;
  annotations?: ReviewAnnotation[];
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

export default function (pi: ExtensionAPI) {
  pi.registerCommand("diffs", {
    description: "Open a one-shot browser review for the current working tree diff",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (!existsSync(join(DIST_DIR, "index.html"))) {
        ctx.ui.notify("Diff review app is not built. Run: pnpm --dir ~/.pi/agent/extensions/diff-review build", "error");
        return;
      }

      const patch = await getCurrentWorkingTreeDiff(ctx.cwd);
      if (!patch.trim()) {
        ctx.ui.notify("No current working tree diff to review", "info");
        return;
      }

      const token = randomBytes(24).toString("base64url");
      const server = createServer();
      let submitted = false;

      server.on("request", async (req, res) => {
        try {
          const host = req.headers.host ?? "";
          const origin = req.headers.origin;
          const expectedOrigin = `http://${host}`;
          const url = new URL(req.url ?? "/", expectedOrigin);

          if (url.pathname.startsWith("/api/")) {
            if (!isAuthorized(req, url, token, expectedOrigin, origin)) {
              sendText(res, 403, "Forbidden");
              return;
            }
          }

          if (req.method === "GET" && url.pathname === "/api/diff") {
            sendJson(res, { cwd: ctx.cwd, patch });
            return;
          }

          if (req.method === "POST" && url.pathname === "/api/submit") {
            if (submitted) {
              sendText(res, 409, "Review already submitted");
              return;
            }
            submitted = true;
            const body = await readJsonBody<SubmitBody>(req);
            const decision = sanitizeDecision(body.decision);
            const summary = typeof body.summary === "string" ? body.summary.trim().slice(0, 8000) : "";
            const annotations = Array.isArray(body.annotations) ? sanitizeAnnotations(body.annotations) : [];
            sendJson(res, { ok: true });
            pi.sendUserMessage(buildReviewPrompt(ctx.cwd, decision, summary, annotations), { deliverAs: "followUp" });
            setTimeout(() => server.close(), 250);
            return;
          }

          if (req.method === "GET") {
            await serveStatic(url.pathname, res);
            return;
          }

          sendText(res, 405, "Method not allowed");
        } catch (error) {
          sendText(res, 500, error instanceof Error ? error.message : String(error));
        }
      });

      await new Promise<void>((resolveListen, rejectListen) => {
        server.once("error", rejectListen);
        server.listen(0, "127.0.0.1", () => resolveListen());
      });

      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        ctx.ui.notify("Could not start diff review server", "error");
        return;
      }

      const url = `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}`;
      await execFileAsync("open", [url]);
      ctx.ui.notify("Opened diff review", "info");
    },
  });
}

async function getCurrentWorkingTreeDiff(cwd: string): Promise<string> {
  const { stdout: trackedDiff } = await execFileAsync("git", ["diff", "--no-ext-diff", "--no-color", "--binary"], {
    cwd,
    maxBuffer: 50 * 1024 * 1024,
  });
  const { stdout: untrackedOutput } = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd,
    encoding: "buffer",
    maxBuffer: 50 * 1024 * 1024,
  });
  const untrackedFiles = untrackedOutput.toString("utf8").split("\0").filter(Boolean);
  const untrackedDiffs = await mapLimit(untrackedFiles, 4, (file) => diffUntrackedFile(cwd, file));
  return [trackedDiff, ...untrackedDiffs].filter(Boolean).join("\n");
}

async function mapLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function diffUntrackedFile(cwd: string, file: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--no-index", "--no-ext-diff", "--no-color", "--binary", "--", "/dev/null", file], {
      cwd,
      maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const diffError = error as { code?: number; stdout?: string };
    if (diffError.code === 1 && diffError.stdout) return diffError.stdout;
    throw error;
  }
}

function isAuthorized(req: IncomingMessage, url: URL, token: string, expectedOrigin: string, origin: string | undefined): boolean {
  const requestToken = url.searchParams.get("token") || req.headers["x-pi-diff-review-token"];
  const validToken = requestToken === token;
  const validOrigin = !origin || origin === expectedOrigin;
  return validToken && validOrigin;
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function sanitizeDecision(decision: ReviewDecision | undefined): ReviewDecision {
  if (decision === "approve" || decision === "request-changes") return decision;
  return "comment";
}

function sanitizeAnnotations(annotations: ReviewAnnotation[]): ReviewAnnotation[] {
  return annotations
    .filter((annotation) => annotation && typeof annotation.body === "string" && annotation.body.trim())
    .map((annotation) => ({
      id: String(annotation.id),
      file: String(annotation.file),
      previousFile: annotation.previousFile ? String(annotation.previousFile) : undefined,
      side: annotation.side === "deletions" ? "deletions" as const : "additions" as const,
      startLine: Number(annotation.startLine),
      endLine: Number(annotation.endLine),
      body: annotation.body.trim().slice(0, 8000),
    }));
}

function buildReviewPrompt(cwd: string, decision: ReviewDecision, summary: string, annotations: ReviewAnnotation[]): string {
  const decisionLabel = decision === "approve" ? "Approve" : decision === "request-changes" ? "Request changes" : "Comment";
  const summaryBlock = summary ? `\n\nReview summary:\n${summary}` : "";

  if (annotations.length === 0) {
    if (decision === "approve") {
      return `Diff review result for ${cwd}: Approved.${summaryBlock}\n\nThe reviewer found the current working tree diff acceptable. Do not change files unless you see a critical issue; briefly acknowledge.`;
    }
    if (decision === "request-changes") {
      return `Diff review result for ${cwd}: Changes requested.${summaryBlock}\n\nEvaluate the requested changes and apply them when correct. Explain any disagreements. Use normal repo validation after edits.`;
    }
    return `Diff review result for ${cwd}: Comment.${summaryBlock || "\n\nNo inline annotations were provided."} Briefly acknowledge.`;
  }

  const rendered = annotations.map((annotation) => {
    const side = annotation.side === "additions" ? "new" : "old";
    const lines = annotation.startLine === annotation.endLine ? `${side}:${annotation.startLine}` : `${side}:${annotation.startLine}-${annotation.endLine}`;
    return `## ${annotation.file} (${lines})\n${annotation.body}`;
  }).join("\n\n");

  return `Diff review submitted for ${cwd}. Decision: ${decisionLabel}.${summaryBlock}\n\nEvaluate each annotation, apply it when correct, and explain any disagreements. Use normal repo validation after edits.\n\n${rendered}`;
}

function sendJson(res: ServerResponse, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  res.end(body);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(DIST_DIR, relative);
  if (!filePath.startsWith(resolve(DIST_DIR))) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (!existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }
  const fileStat = await stat(filePath);
  res.writeHead(200, {
    "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
    "content-length": fileStat.size,
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}
