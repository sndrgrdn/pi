import http from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createSessionManager } from "./session";

async function request(
  baseUrl: string,
  token: string,
  method: string,
  pathname: string,
  body?: string,
): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname,
        port,
        path: `${pathname}?token=${encodeURIComponent(token)}`,
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function postReview(baseUrl: string, token: string): Promise<{ status: number; body: string }> {
  return request(
    baseUrl,
    token,
    "POST",
    "/api/submit",
    JSON.stringify({ decision: "approve", summary: "", annotations: [] }),
  );
}

describe("session submit", () => {
  it("returns 409 on duplicate submit", async () => {
    const pi = { sendUserMessage: vi.fn() };
    const manager = createSessionManager("/tmp/dist");
    const handle = await manager.ensureSession(process.cwd(), pi as never);
    expect(handle).not.toBeNull();

    const token = new URL(handle!.url).searchParams.get("token")!;
    const first = await postReview(handle!.url, token);
    const second = await postReview(handle!.url, token);

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(pi.sendUserMessage).toHaveBeenCalledOnce();
  });

  it("allows submit again after diff fetch (page reload)", async () => {
    const pi = { sendUserMessage: vi.fn() };
    const manager = createSessionManager("/tmp/dist");
    const handle = await manager.ensureSession(process.cwd(), pi as never);
    expect(handle).not.toBeNull();

    const token = new URL(handle!.url).searchParams.get("token")!;
    expect((await postReview(handle!.url, token)).status).toBe(200);
    expect((await postReview(handle!.url, token)).status).toBe(409);

    expect((await request(handle!.url, token, "GET", "/api/diff")).status).toBe(200);
    expect((await postReview(handle!.url, token)).status).toBe(200);
    expect(pi.sendUserMessage).toHaveBeenCalledTimes(2);
  });
});
