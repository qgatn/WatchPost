import { describe, expect, it } from "vitest";
import { diskUsedPct, fmtBytes, fmtRate, fmtUptime, fmtUsers, fmtDiskUsage, usageLevel, usageLabel } from "./format";

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

describe("fmtUsers", () => {
  it("singular and plural", () => {
    expect(fmtUsers(1)).toBe("1 user");
    expect(fmtUsers(3)).toBe("3 users");
  });
});

describe("fmtDiskUsage", () => {
  it("formats used and total", () => {
    expect(fmtDiskUsage(1024 * 1024 * 120, 1024 * 1024 * 500)).toBe("120 MB / 500 MB");
  });
});

describe("usageLevel", () => {
  it("maps thresholds to ok, warn, err", () => {
    expect(usageLevel(0)).toBe("ok");
    expect(usageLevel(50)).toBe("ok");
    expect(usageLevel(51)).toBe("warn");
    expect(usageLevel(90)).toBe("warn");
    expect(usageLevel(91)).toBe("err");
  });
});

describe("usageLabel", () => {
  it("describes threshold bands", () => {
    expect(usageLabel(30)).toContain("healthy");
    expect(usageLabel(60)).toContain("elevated");
    expect(usageLabel(95)).toContain("critical");
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
