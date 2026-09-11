/** Webfetch core for URL validation, bounded fetches, retries, and content conversion. */

import { Duration, Effect } from "effect";
import * as Schema from "effect/Schema";
import { Parser } from "htmlparser2";
import TurndownService from "turndown";
import { collectBoundedBody, type HttpFetchContract } from "./http.ts";

/** Maximum fetched response size in bytes. */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Default fetch timeout in seconds. */
export const DEFAULT_TIMEOUT_SECONDS = 30;

/** Maximum fetch timeout in seconds. */
export const MAX_TIMEOUT_SECONDS = 120;

/** Supported webfetch output formats. */
export type FetchFormat = "text" | "markdown" | "html";

/** Webfetch request before defaults are applied. */
export interface FetchInput {
  url: string;
  format?: FetchFormat | undefined;
  timeout?: number | undefined;
  signal?: AbortSignal | undefined;
}

/** Webfetch request with required format and timeout. */
export interface NormalizedFetchInput {
  url: string;
  format: FetchFormat;
  timeout: number;
}

/** Applies webfetch request defaults. */
export const normalizeFetchInput = (input: FetchInput): NormalizedFetchInput => ({
  url: input.url,
  format: input.format ?? "markdown",
  timeout: input.timeout ?? DEFAULT_TIMEOUT_SECONDS,
});

/** Initial fetch User-Agent; a Cloudflare-challenge retry uses `opencode`. */
export const browserUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

const opencodeUserAgent = "opencode";

/** Webfetch failure with a stable model-facing message. */
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

/** Creates a WebFetchError with its stable message. */
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

/** Extracts text while skipping active HTML containers. */
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

/** Converts HTML to Markdown without active or metadata elements. */
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

/** Converts HTML content to the requested format. */
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

/** Converted webfetch result. */
export interface FetchedPage {
  url: string;
  contentType: string;
  format: FetchFormat;
  content: string;
}

/** Fetches and converts a page, failing with WebFetchError for expected errors. */
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
