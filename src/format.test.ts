import { describe, expect, it } from "vitest";
import { diskUsedPct, fmtBytes, fmtRate, fmtUptime } from "./format";

describe("fmtBytes", () => {
  it("formats bytes and scales up", () => {
    expect(fmtBytes(0)).toBe("0 B");
    expect(fmtBytes(512)).toBe("512 B");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtBytes(1024 * 1024)).toBe("1.0 MB");
    expect(fmtBytes(1024 * 1024 * 5)).toBe("5.0 MB");
  });
});

describe("fmtRate", () => {
  it("appends /s", () => {
    expect(fmtRate(2048)).toBe("2.0 KB/s");
  });
});

describe("fmtUptime", () => {
  it("formats minutes only", () => {
    expect(fmtUptime(90)).toBe("1m");
  });

  it("formats hours and minutes", () => {
    expect(fmtUptime(3661)).toBe("1h 1m");
  });

  it("formats days, hours, and minutes", () => {
    expect(fmtUptime(90061)).toBe("1d 1h 1m");
  });
});

describe("diskUsedPct", () => {
  it("returns 0 for empty disk", () => {
    expect(diskUsedPct(0, 0)).toBe(0);
  });

  it("computes used percentage", () => {
    expect(diskUsedPct(1000, 250)).toBe(75);
  });
});
