/** Injectable HTTP boundary for web tools. */

import { Effect } from "effect";

/** HTTP fetch implementation used by the web tools. */
export interface HttpFetchContract {
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
}

/** Reads through the byte cap and rejects declared oversize bodies before reading. */
export const collectBoundedBody = Effect.fn("Http.collectBoundedBody")(function* <E>(
  response: Response,
  maximumBytes: number,
  tooLarge: () => E,
  onError: (error: Error) => E,
): Effect.fn.Return<Buffer, E> {
  const contentLength = response.headers.get("content-length");
  const parsedSize = contentLength ? Number.parseInt(contentLength, 10) : undefined;

  const declaredSize =
    parsedSize !== undefined && Number.isSafeInteger(parsedSize) && parsedSize >= 0
      ? parsedSize
      : undefined;

  if (declaredSize !== undefined && declaredSize > maximumBytes)
    return yield* Effect.fail(tooLarge());
  const reader = response.body?.getReader();

  if (!reader) return Buffer.alloc(0);
  let size = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = yield* Effect.tryPromise({
      try: () => reader.read(),
      catch: (error) => onError(error instanceof Error ? error : new Error(String(error))),
    });

    if (done) break;

    if (value.byteLength === 0) continue;

    if (size + value.byteLength > maximumBytes) return yield* Effect.fail(tooLarge());
    chunks.push(value);
    size += value.byteLength;
  }

  return Buffer.concat(chunks, size);
});
