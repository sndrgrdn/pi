import { describe, expect, it, vi } from "vitest";
import { CheckoutCache, type CheckoutOperations } from "./checkout.ts";

function operations(overrides: Partial<CheckoutOperations> = {}): CheckoutOperations {
	return {
		home: "/home/sander",
		now: () => 1_000,
		findCachedRepositories: vi.fn(() => []),
		isRepository: vi.fn(() => true),
		exists: vi.fn(() => false),
		readTimestamp: vi.fn(() => undefined),
		clone: vi.fn(),
		fetch: vi.fn(),
		isClean: vi.fn(() => true),
		fastForward: vi.fn(),
		writeTimestamp: vi.fn(),
		...overrides,
	};
}

describe("checkout cache", () => {
	it("maps qualified repository forms to the canonical cache path", async () => {
		for (const repo of ["acme/widgets", "https://github.com/acme/widgets.git", "git@github.com:acme/widgets.git"]) {
			const cache = new CheckoutCache(operations());
			expect(await cache.checkout(repo)).toBe("/home/sander/.cache/checkouts/github.com/acme/widgets");
		}
	});

	it("refreshes the sole cached bare-name match", async () => {
		const ops = operations({
			findCachedRepositories: vi.fn(() => ["/cache/gitlab.com/acme/widgets"]),
			exists: vi.fn(() => true),
		});
		const cache = new CheckoutCache(ops, "/cache");
		expect(await cache.checkout("widgets")).toBe("/cache/gitlab.com/acme/widgets");
		expect(ops.fetch).toHaveBeenCalledWith("/cache/gitlab.com/acme/widgets");
	});

	it("rejects ambiguous and missing bare names loudly", async () => {
		const ambiguous = new CheckoutCache(operations({ findCachedRepositories: () => ["/a/org/widgets", "/b/org/widgets"] }));
		await expect(ambiguous.checkout("widgets")).rejects.toThrow("/a/org/widgets\n/b/org/widgets");
		const missing = new CheckoutCache(operations());
		await expect(missing.checkout("widgets")).rejects.toThrow("owner/repo");
	});

	it("throttles refreshes for 300 seconds and fast-forwards only clean checkouts", async () => {
		const freshOps = operations({ exists: () => true, readTimestamp: () => 800 });
		await new CheckoutCache(freshOps).checkout("acme/widgets");
		expect(freshOps.fetch).not.toHaveBeenCalled();

		const dirtyOps = operations({ exists: () => true, readTimestamp: () => 699, isClean: () => false });
		await new CheckoutCache(dirtyOps).checkout("acme/widgets");
		expect(dirtyOps.fetch).toHaveBeenCalledOnce();
		expect(dirtyOps.fastForward).not.toHaveBeenCalled();
		expect(dirtyOps.writeTimestamp).toHaveBeenCalledWith(expect.any(String), 1_000);
	});
});
