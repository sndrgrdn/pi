import { vi } from "vitest";

vi.mock("@pierre/diffs/worker", () => ({
  getOrCreateWorkerPoolSingleton: vi.fn(() => ({})),
  terminateWorkerPoolSingleton: vi.fn(),
}));
