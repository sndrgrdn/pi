import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  buildReviewPrompt,
  normalizeDecision,
  parseSubmitBody,
} from "./src/reviewContract";
import type { ReviewPayload } from "./src/types";

const execFileAsync = promisify(execFile);

type ActiveSession = {
  server: Server;
  token: string;
  port: number;
  cwd: string;
  submitted: boolean;
};

const GLOBAL_SESSION_KEY = "__piDiffReviewSession";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
} as const satisfies Record<string, string>;

function readSession(): ActiveSession | null {
  return (globalThis as unknown as Record<string, ActiveSession | undefined>)[GLOBAL_SESSION_KEY] ?? null;
}

function writeSession(session: ActiveSession | null): void {
  const g = globalThis as unknown as Record<string, ActiveSession | undefined>;
  if (session) g[GLOBAL_SESSION_KEY] = session;
  else delete g[GLOBAL_SESSION_KEY];
}

export type SessionHandle = { url: string };

export function createSessionManager(distDir: string) {
  const staleSession = readSession();
  if (staleSession) {
    staleSession.server.close();
    writeSession(null);
  }

  async function ensureSession(cwd: string, pi: ExtensionAPI): Promise<SessionHandle | null> {
    const existing = readSession();
    if (existing?.cwd === cwd && existing.server.listening) {
      return { url: `http://127.0.0.1:${existing.port}/?token=${encodeURIComponent(existing.token)}` };
    }

    if (existing) {
      existing.server.close();
      writeSession(null);
    }

    const token = randomBytes(24).toString("base64url");
    const server = createServer();

    server.on("request", async (req, res) => {
      try {
        await handleRequest(req, res, { cwd, token, distDir, pi });
      } catch (error) {
        sendText(res, 500, error instanceof Error ? error.message : String(error));
      }
    });

    server.on("close", () => {
      if (readSession()?.server === server) writeSession(null);
    });

    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(0, "127.0.0.1", () => resolveListen());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      return null;
    }

    writeSession({ server, token, port: address.port, cwd, submitted: false });
    return { url: `http://127.0.0.1:${address.port}/?token=${encodeURIComponent(token)}` };
  }

  return { ensureSession };
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { cwd: string; token: string; distDir: string; pi: ExtensionAPI },
): Promise<void> {
  const host = req.headers.host ?? "";
  const origin = req.headers.origin;
  const expectedOrigin = `http://${host}`;
  const url = new URL(req.url ?? "/", expectedOrigin);

  if (url.pathname.startsWith("/api/")) {
    if (!isAuthorized(req, url, ctx.token, expectedOrigin, origin)) {
      sendText(res, 403, "Forbidden");
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/diff") {
    const session = readSession();
    if (session) session.submitted = false;
    const patch = await fetchWorkingTreeDiff(ctx.cwd);
    sendJson(res, { cwd: ctx.cwd, patch });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/submit") {
    const session = readSession();
    if (!session || session.submitted) {
      sendText(res, 409, "Review already submitted");
      return;
    }
    const raw = await readJsonBody(req);
    const body = parseSubmitBody(raw);
    const payload: ReviewPayload = {
      cwd: ctx.cwd,
      decision: normalizeDecision(body.decision),
      summary: typeof body.summary === "string" ? body.summary.trim().slice(0, 8000) : "",
      annotations: body.annotations ?? [],
    };
    ctx.pi.sendUserMessage(buildReviewPrompt(payload), { deliverAs: "followUp" });
    session.submitted = true;
    sendJson(res, { ok: true });
    return;
  }

  if (req.method === "GET") {
    await serveStatic(url.pathname, res, ctx.distDir);
    return;
  }

  sendText(res, 405, "Method not allowed");
}

async function fetchWorkingTreeDiff(cwd: string): Promise<string> {
  const { stdout: trackedDiff } = await execFileAsync("git", ["diff", "HEAD", "--no-ext-diff", "--no-color", "--binary"], {
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
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await mapper(item);
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
  return requestToken === token && (!origin || origin === expectedOrigin);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
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

async function serveStatic(pathname: string, res: ServerResponse, distDir: string): Promise<void> {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = resolve(distDir, relative);
  if (!filePath.startsWith(resolve(distDir))) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (!existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }
  const fileStat = await stat(filePath);
  const ext = extname(filePath);
  const mime = ext in MIME_TYPES ? MIME_TYPES[ext as keyof typeof MIME_TYPES] : "application/octet-stream";
  res.writeHead(200, {
    "content-type": mime,
    "content-length": fileStat.size,
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(res);
}
