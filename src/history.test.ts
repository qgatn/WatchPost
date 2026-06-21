import { describe, expect, it } from "vitest";
import { History } from "./history";

describe("History", () => {
  it("keeps values in insertion order", () => {
    const h = new History(10);
    h.push(1);
    h.push(2);
    expect(h.values()).toEqual([1, 2]);
  });

  it("drops oldest values when over capacity", () => {
    const h = new History(3);
    h.push(1);
    h.push(2);
    h.push(3);
    h.push(4);
    expect(h.values()).toEqual([2, 3, 4]);
  });

  it("max returns at least 1", () => {
    const h = new History(5);
    expect(h.max()).toBe(1);
    h.push(0.5);
    expect(h.max()).toBe(1);
    h.push(42);
    expect(h.max()).toBe(42);
  });

  it("avg returns mean of buffered values", () => {
    const h = new History(5);
    expect(h.avg()).toBe(0);
    h.push(10);
    h.push(20);
    h.push(30);
    expect(h.avg()).toBe(20);
  });
});
