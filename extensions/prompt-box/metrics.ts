/**
 * Streaming metrics — TTFT and tok/sec with running averages.
 *
 * Deep module: all state, event wiring, validation, and model-aware
 * reset behind a small read-only interface.
 *
 * Interface:
 *   register(pi)          — hooks into extension events
 *   getMetrics(): Metrics — read current snapshot
 *   onUpdate(cb)          — subscribe to changes (for UI refresh)
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── Types ────────────────────────────────────

export interface Metrics {
  latest?: { ttft: number; tokSec: number };
  avg?: { ttft: number; tokSec: number; samples: number };
  live?: { ttft: number };
}

interface AggregateStats {
  count: number;
  totalOutputTokens: number;
  totalGenerationMs: number;
  totalTtftMs: number;
}

const MIN_GENERATION_MS = 50;

// ── State ────────────────────────────────────

let reqStartMs: number | undefined;
let firstTokenMs: number | undefined;

let latestTtft: number | undefined;
let latestTokSec: number | undefined;

let stats: AggregateStats = emptyStats();
let currentModelKey: string | undefined;

const listeners = new Set<() => void>();

// ── Helpers ──────────────────────────────────

function emptyStats(): AggregateStats {
  return { count: 0, totalOutputTokens: 0, totalGenerationMs: 0, totalTtftMs: 0 };
}

function modelKey(model: { provider?: string; id?: string } | undefined): string | undefined {
  if (!model?.id) return undefined;
  return model.provider ? `${model.provider}/${model.id}` : model.id;
}

function resetInFlight(): void {
  reqStartMs = undefined;
  firstTokenMs = undefined;
}

function notify(): void {
  for (const cb of listeners) cb();
}

function addSample(ttftMs: number, outputTokens: number, generationMs: number): boolean {
  if (outputTokens <= 0) return false;
  if (generationMs < MIN_GENERATION_MS) return false;
  if (ttftMs < 0) return false;

  stats.count++;
  stats.totalOutputTokens += outputTokens;
  stats.totalGenerationMs += generationMs;
  stats.totalTtftMs += ttftMs;
  return true;
}

// ── Public interface ─────────────────────────

export function getMetrics(): Metrics {
  const result: Metrics = {};

  if (latestTtft != null && latestTokSec != null) {
    result.latest = { ttft: latestTtft, tokSec: latestTokSec };
  }

  if (stats.count > 0) {
    result.avg = {
      ttft: stats.totalTtftMs / stats.count / 1000,
      tokSec: stats.totalOutputTokens / (stats.totalGenerationMs / 1000),
      samples: stats.count,
    };
  }

  // Live TTFT while streaming (before message_end)
  if (firstTokenMs != null && reqStartMs != null) {
    result.live = { ttft: (firstTokenMs - reqStartMs) / 1000 };
  }

  return result;
}

export function onUpdate(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function register(pi: ExtensionAPI): void {
  // Mark the moment the HTTP request fires
  pi.on("before_provider_request", () => {
    reqStartMs = performance.now();
    firstTokenMs = undefined;
  });

  // Capture first token timestamp
  pi.on("message_update", (event) => {
    if (firstTokenMs != null) return;
    const ame = event.assistantMessageEvent;
    if (!ame) return;
    if (ame.type === "text_delta" || ame.type === "thinking_delta") {
      firstTokenMs = performance.now();
      notify();
    }
  });

  // Compute metrics on message completion
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant" || !reqStartMs) return;

    // Reject error/aborted messages
    const msg = event.message as unknown as { stopReason?: string; usage?: { output?: number } };
    if (msg.stopReason === "error" || msg.stopReason === "aborted") {
      resetInFlight();
      return;
    }

    const endMs = performance.now();
    const usage = msg.usage;
    const outputTokens = usage?.output;

    if (firstTokenMs && outputTokens) {
      const ttftMs = firstTokenMs - reqStartMs;
      const generationMs = endMs - firstTokenMs;

      latestTtft = ttftMs / 1000;
      latestTokSec = generationMs > 0 ? outputTokens / (generationMs / 1000) : undefined;

      addSample(ttftMs, outputTokens, generationMs);
    }

    resetInFlight();
    notify();
  });

  // Reset in-flight state on new turn (multi-turn tool loops)
  pi.on("turn_start", () => {
    resetInFlight();
  });

  // Hard reset on model switch — averages across models are noise
  pi.on("model_select", (event) => {
    const newKey = modelKey(event.model);
    if (newKey !== currentModelKey) {
      currentModelKey = newKey;
      stats = emptyStats();
      latestTtft = undefined;
      latestTokSec = undefined;
      notify();
    }
  });
}
