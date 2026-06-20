import { describe, expect, it } from "vitest";
import { STALE_MS, isStale } from "./status";

describe("isStale", () => {
  it("is false before first update", () => {
    expect(isStale(0, 10_000)).toBe(false);
  });

  it("is false within the stale window", () => {
    const now = 10_000;
    expect(isStale(now - STALE_MS, now)).toBe(false);
    expect(isStale(now - 1000, now)).toBe(false);
  });

  it("is true after the stale window", () => {
    const now = 10_000;
    expect(isStale(now - STALE_MS - 1, now)).toBe(true);
    expect(isStale(1, now)).toBe(true);
  });
});
