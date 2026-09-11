import { Effect, Exit } from "effect";
import { Compile } from "typebox/compile";
import { describe, expect, it } from "vitest";
import {
  browserUserAgent,
  convertHTMLToMarkdown,
  type FetchedPage,
  DEFAULT_TIMEOUT_SECONDS,
  extractTextFromHTML,
  fetchAndConvert,
  type FetchFormat,
  MAX_RESPONSE_BYTES,
  MAX_TIMEOUT_SECONDS,
  normalizeFetchInput,
  type WebFetchError,
} from "../fetch-page.ts";
import { webFetchParameters } from "../webfetch.ts";
import { findExitError } from "./find-exit-error.ts";

/** Run fetchAndConvert against a fake HTTP boundary, returning the Exit. */
function runFetch(
  input: { url: string; format?: FetchFormat; timeout?: number },
  handler: (url: string, init: RequestInit) => Promise<Response>,
): Promise<Exit.Exit<FetchedPage, WebFetchError>> {
  const http = { fetch: (url: string, init: RequestInit) => handler(url, init) };

  return fetchAndConvert(http, input).pipe(Effect.exit, Effect.runPromise);
}

describe("input schema", () => {
  it("defaults format to markdown and timeout to 30 seconds", () => {
    expect(normalizeFetchInput({ url: "https://example.com" })).toEqual({
      url: "https://example.com",
      format: "markdown",
      timeout: DEFAULT_TIMEOUT_SECONDS,
    });
  });

  it("rejects timeout 0 and timeout over the maximum", () => {
    const compiled = Compile(webFetchParameters);
    expect(compiled.Check({ url: "https://example.com" })).toBe(true);
    expect(compiled.Check({ url: "https://example.com", timeout: 0 })).toBe(false);
    expect(compiled.Check({ url: "https://example.com", timeout: MAX_TIMEOUT_SECONDS + 1 })).toBe(
      false,
    );
    expect(compiled.Check({ url: "https://example.com", timeout: MAX_TIMEOUT_SECONDS })).toBe(true);
  });
});

describe("HTML conversion", () => {
  it("strips active content in text and markdown conversions", () => {
    const html =
      "<h1>Hello</h1><script>bad()</script><p>world <strong>wide</strong></p><style>.bad {}</style>";

    expect(extractTextFromHTML(html)).toBe("Helloworld wide");
    expect(convertHTMLToMarkdown(html)).toBe("# Hello\n\nworld **wide**");
  });
});

describe("fetch", () => {
  it("fetches a URL as plain text with the format accept header", async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];

    const exit = await runFetch(
      { url: "http://example.com/public", format: "text", timeout: 4 },
      async (url, init) => {
        // SAFETY: runFetch supplies headers as a plain string record; HeadersInit cannot retain that shape.
        requests.push({ url, headers: init.headers as Record<string, string> });

        return new Response("hello", { headers: { "content-type": "text/plain" } });
      },
    );

    expect(Exit.isSuccess(exit)).toBe(true);

    if (Exit.isSuccess(exit)) {
      expect(exit.value).toMatchObject({
        url: "http://example.com/public",
        contentType: "text/plain",
        format: "text",
        content: "hello",
      });
    }

    expect(requests).toEqual([
      {
        url: "http://example.com/public",
        headers: {
          Accept: expect.stringContaining("text/plain;q=1.0"),
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": browserUserAgent,
        },
      },
    ]);
  });

  it("rejects non-HTTP schemes", async () => {
    const exit = await runFetch({ url: "file:///etc/passwd", format: "text" }, async () => {
      throw new Error("should not be called");
    });

    expect(Exit.isFailure(exit)).toBe(true);
    const error = findExitError(exit);
    expect(error).toBeDefined();
    expect(error?.kind).toBe("invalidUrl");
  });

  it("retries Cloudflare challenges with the opencode user agent", async () => {
    const userAgents: string[] = [];
    let count = 0;

    const exit = await runFetch({ url: "https://1.1.1.1", format: "text" }, async (_url, init) => {
      count++;
      // SAFETY: runFetch supplies headers as a plain string record; HeadersInit cannot retain that shape.
      const headers = init.headers as Record<string, string>;
      userAgents.push(headers["User-Agent"] ?? "");

      if (count === 1) {
        return new Response("challenge", { status: 403, headers: { "cf-mitigated": "challenge" } });
      }

      return new Response("ok", { headers: { "content-type": "text/plain" } });
    });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(userAgents).toHaveLength(2);
    expect(userAgents[0]).toContain("Mozilla/5.0");
    expect(userAgents[1]).toBe("opencode");
  });

  it("rejects image MIME types", async () => {
    const exit = await runFetch(
      { url: "https://1.1.1.1/image", format: "html" },
      async () => new Response("png", { headers: { "content-type": "image/png" } }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = findExitError(exit);
    expect(error).toBeDefined();
    expect(error?.kind).toBe("unsupportedImage");
    expect(error?.mime).toBe("image/png");
  });

  it("rejects non-textual MIME types", async () => {
    const exit = await runFetch(
      { url: "https://1.1.1.1/file", format: "html" },
      async () => new Response("pdf", { headers: { "content-type": "application/pdf" } }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = findExitError(exit);
    expect(error).toBeDefined();
    expect(error?.kind).toBe("unsupportedFile");
  });

  it("rejects declared oversized bodies", async () => {
    const exit = await runFetch(
      { url: "https://1.1.1.1/declared", format: "text" },
      async () =>
        new Response("small", {
          headers: {
            "content-type": "text/plain",
            "content-length": String(MAX_RESPONSE_BYTES + 1),
          },
        }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = findExitError(exit);
    expect(error).toBeDefined();
    expect(error?.kind).toBe("tooLarge");
  });

  it("rejects streamed oversized bodies", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array(2));
        controller.close();
      },
    });

    const exit = await runFetch(
      { url: "https://1.1.1.1/streamed", format: "text" },
      async () => new Response(stream, { headers: { "content-type": "text/plain" } }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = findExitError(exit);
    expect(error).toBeDefined();
    expect(error?.kind).toBe("tooLarge");
  });

  it("converts HTML to the requested markdown and text formats", async () => {
    const html = "<h1>Hello</h1><p>world</p><script>bad()</script>";

    const markdown = await runFetch(
      { url: "https://1.1.1.1", format: "markdown" },
      async () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
    );

    expect(Exit.isSuccess(markdown)).toBe(true);

    if (Exit.isSuccess(markdown)) expect(markdown.value.content).toBe("# Hello\n\nworld");

    const text = await runFetch(
      { url: "https://1.1.1.1", format: "text" },
      async () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
    );

    expect(Exit.isSuccess(text)).toBe(true);

    if (Exit.isSuccess(text)) expect(text.value.content).toBe("Helloworld");
  });
});
