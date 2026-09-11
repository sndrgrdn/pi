/**
 * Fetch domain core of `webfetch` (ported from opencode V2's
 * packages/core/src/tool/plugin/webfetch.ts): URL validation, fetch with
 * Cloudflare-challenge retry and timeout, bounded body reads, and
 * HTML→markdown/text conversion. Tool registration lives in `webfetch.ts`.
 */

import { Duration, Effect } from "effect";
import * as Schema from "effect/Schema";
import { Parser } from "htmlparser2";
import TurndownService from "turndown";
import { collectBoundedBody, type HttpFetchContract } from "./http.ts";

/** Byte cap on a fetched response body; declared or streamed sizes over this fail with `tooLarge`. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Default `FetchInput.timeout` when the caller omits one. */
export const DEFAULT_TIMEOUT_SECONDS = 30;

/** Upper bound the webfetch tool schema enforces on `timeout`. */
export const MAX_TIMEOUT_SECONDS = 120;

/** The content format the model asked for; decides HTML conversion and the `Accept` header. */
export type FetchFormat = "text" | "markdown" | "html";

/** Caller-facing fetch request; `format` and `timeout` default when omitted. */
export interface FetchInput {
  url: string;
  format?: FetchFormat | undefined;
  timeout?: number | undefined;
  signal?: AbortSignal | undefined;
}

/** FetchInput after the schema defaults are applied. */
export interface NormalizedFetchInput {
  url: string;
  format: FetchFormat;
  timeout: number;
}

/** Apply the format/timeout defaults so downstream code never re-checks for absence. */
export const normalizeFetchInput = (input: FetchInput): NormalizedFetchInput => ({
  url: input.url,
  format: input.format ?? "markdown",
  timeout: input.timeout ?? DEFAULT_TIMEOUT_SECONDS,
});

/** User-Agent sent on the first fetch attempt; tests assert this exact string as the observable UA contract. The Cloudflare-challenge retry sends `opencode` instead. */
export const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

const opencodeUserAgent = "opencode";

/** Typed fetch failures, each carrying what the model needs to recover; `message` holds the stable caller-facing text. */
export class WebFetchError extends Schema.TaggedError<WebFetchError>()("WebFetch.Error", {
  kind: Schema.Union([
    Schema.Literal("invalidUrl"),
    Schema.Literal("unsupportedImage"),
    Schema.Literal("unsupportedFile"),
    Schema.Literal("tooLarge"),
    Schema.Literal("timeout"),
    Schema.Literal("network"),
    Schema.Literal("conversion"),
    Schema.Literal("aborted"),
  ]),
  url: Schema.optionalKey(Schema.String),
  mime: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.Number),
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Unknown),
}) {}

/** Build a `WebFetchError` with the stable message its kind owns; fields add recovery context. */
export const makeWebFetchError = (
  kind: WebFetchError["kind"],
  fields: Partial<Omit<WebFetchError, "_tag" | "kind" | "message">> = {},
) => {
  const { url, mime, limit } = fields;

  const message = (() => {
    switch (kind) {
      case "invalidUrl":
        return "URL must use http:// or https://";
      case "unsupportedImage":
        return `Unsupported fetched image content type: ${mime ?? "(unknown)"}`;
      case "unsupportedFile":
        return `Unsupported fetched file content type: ${mime ?? "(unknown)"}`;
      case "tooLarge":
        return `Response too large (exceeds ${limit ?? MAX_RESPONSE_BYTES} byte limit)`;
      case "timeout":
        return "Request timed out";
      case "network":
      case "conversion":
        return `Unable to fetch ${url ?? "(unknown)"}`;
      case "aborted":
        return "Request aborted";
    }
  })();

  return new WebFetchError({ kind, ...fields, message });
};

const acceptHeader = (format: FetchFormat): string => {
  switch (format) {
    case "markdown":
      return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
    case "text":
      return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
    case "html":
      return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
  }
};

const isCloudflareChallenge = (response: Response) =>
  response.status === 403 && response.headers.get("cf-mitigated") === "challenge";

const mimeFrom = (contentType: string) => contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";

const isImageMime = (mime: string) =>
  mime.startsWith("image/") && mime !== "image/svg+xml" && mime !== "image/vnd.fastbidsheet";

const isTextualMime = (mime: string) =>
  !mime ||
  mime.startsWith("text/") ||
  mime === "application/json" ||
  mime.endsWith("+json") ||
  mime === "application/xml" ||
  mime.endsWith("+xml") ||
  mime === "application/javascript" ||
  mime === "application/x-javascript";

const toNetworkError = (
  error: Error,
  input: NormalizedFetchInput,
  signal?: AbortSignal,
): WebFetchError => {
  if (signal?.aborted) return makeWebFetchError("aborted", { url: input.url, cause: error });

  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return makeWebFetchError("timeout", { url: input.url, cause: error });
  }

  return makeWebFetchError("network", { url: input.url, cause: error });
};

/** The timeout wraps the whole network phase, retry included. */
export const fetchPage = Effect.fn("WebFetch.fetchPage")(function* (
  http: HttpFetchContract,
  input: FetchInput,
): Effect.fn.Return<
  { url: string; contentType: string; format: FetchFormat; body: Buffer },
  WebFetchError
> {
  const { url, format, timeout } = normalizeFetchInput(input);

  const parsedUrl = yield* Effect.try({
    try: () => new URL(url),
    catch: () => makeWebFetchError("invalidUrl"),
  });

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    return yield* Effect.fail(makeWebFetchError("invalidUrl", { url }));
  }

  const timeoutMs = timeout * 1000;

  const attempt = (userAgent: string) =>
    Effect.tryPromise({
      try: () =>
        http.fetch(url, {
          headers: {
            Accept: acceptHeader(format),
            "Accept-Language": "en-US,en;q=0.9",
            "User-Agent": userAgent,
          },
          redirect: "follow",
          signal: input.signal
            ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
            : AbortSignal.timeout(timeoutMs),
        }),
      catch: (error) =>
        toNetworkError(
          error instanceof Error ? error : new Error(String(error)),
          { url, format, timeout },
          input.signal,
        ),
    });

  const { contentType, body } = yield* Effect.gen(function* () {
    let response = yield* attempt(browserUserAgent);

    if (isCloudflareChallenge(response)) response = yield* attempt(opencodeUserAgent);

    const contentType = response.headers.get("content-type") ?? "";
    const mime = mimeFrom(contentType);

    if (isImageMime(mime)) {
      return yield* Effect.fail(makeWebFetchError("unsupportedImage", { url, mime }));
    }

    if (!isTextualMime(mime)) {
      return yield* Effect.fail(makeWebFetchError("unsupportedFile", { url, mime }));
    }

    const body = yield* collectBoundedBody(
      response,
      MAX_RESPONSE_BYTES,
      () => makeWebFetchError("tooLarge", { url, limit: MAX_RESPONSE_BYTES }),
      (error) => toNetworkError(error, { url, format, timeout }, input.signal),
    );

    return { contentType, body };
  }).pipe(
    Effect.timeoutOrElse({
      duration: Duration.seconds(timeout),
      orElse: () => Effect.fail(makeWebFetchError("timeout", { url })),
    }),
  );

  return { url, contentType, format, body };
});

/** Extract plain text from HTML, skipping active content containers (script, style, iframe, ...). */
export function extractTextFromHTML(html: string) {
  let text = "";
  let skipDepth = 0;

  const parser = new Parser({
    onopentag(name) {
      if (
        skipDepth > 0 ||
        ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)
      ) {
        skipDepth++;
      }
    },
    ontext(input) {
      if (skipDepth === 0) text += input;
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--;
    },
  });

  parser.write(html);
  parser.end();

  return text.trim();
}

/** Convert an HTML string to GitHub-flavored markdown, stripping script/style/meta/link elements. */
export function convertHTMLToMarkdown(html: string) {
  const turndown = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });

  turndown.remove(["script", "style", "meta", "link"]);

  return turndown.turndown(html);
}

/** No-op unless the response is HTML and a conversion was requested. */
export const convertFetchedContent = (
  content: string,
  contentType: string,
  format: FetchFormat,
): string => {
  if (!contentType.includes("text/html")) return content;

  if (format === "markdown") return convertHTMLToMarkdown(content);

  if (format === "text") return extractTextFromHTML(content);

  return content;
};

/** A successfully fetched page: final URL, response content type, and the converted body text. */
export interface FetchedPage {
  url: string;
  contentType: string;
  format: FetchFormat;
  content: string;
}

/** Fetch a page and convert its body to the requested format; every expected failure is a `WebFetchError`. */
export const fetchAndConvert = Effect.fn("WebFetch.fetchAndConvert")(function* (
  http: HttpFetchContract,
  input: FetchInput,
): Effect.fn.Return<FetchedPage, WebFetchError> {
  const { url, format } = normalizeFetchInput(input);
  const page = yield* fetchPage(http, input);

  const content = yield* Effect.try({
    try: () => convertFetchedContent(new TextDecoder().decode(page.body), page.contentType, format),
    catch: () => makeWebFetchError("conversion", { url }),
  });

  return { url, contentType: page.contentType, format, content } satisfies FetchedPage;
});
