import { describe, expect, it } from "vitest";
import { displayDisks, primaryDisk } from "./disks";

describe("displayDisks", () => {
  it("drops zero-total and recovery mounts", () => {
    const out = displayDisks([
      { name: "C:", mount: "C:\\", total: 500e9, available: 200e9 },
      { name: "Recovery", mount: "C:\\Recovery", total: 1e9, available: 0 },
      { name: "empty", mount: "D:\\", total: 0, available: 0 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].mount).toBe("C:\\");
  });

  it("prefers macOS Data volume over small root", () => {
    const out = displayDisks([
      { name: "root", mount: "/", total: 500e6, available: 100e6 },
      { name: "data", mount: "/System/Volumes/Data", total: 500e9, available: 200e9 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].mount).toBe("/System/Volumes/Data");
  });

  it("keeps single root when no Data volume", () => {
    const out = displayDisks([
      { name: "root", mount: "/", total: 500e9, available: 200e9 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].mount).toBe("/");
  });

  it("primaryDisk returns first display disk", () => {
    const d = primaryDisk([
      { name: "a", mount: "/small", total: 1e6, available: 0 },
      { name: "b", mount: "/big", total: 500e9, available: 1e9 },
    ]);
    expect(d?.mount).toBe("/big");
  });
});
