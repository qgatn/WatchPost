import { describe, expect, it } from "vitest";
import {
  canDisableSegment,
  cloneWidgetPrefs,
  countEnabledMetrics,
  DEFAULT_WIDGET_PREFS,
  stackModeHint,
} from "./widgetPrefs";

describe("widget prefs validation helpers", () => {
  it("counts enabled metric segments", () => {
    expect(countEnabledMetrics(DEFAULT_WIDGET_PREFS.segments)).toBe(4);
  });

  it("defaults storage to number-only display", () => {
    expect(DEFAULT_WIDGET_PREFS.display.disk).toBe("number");
    expect(DEFAULT_WIDGET_PREFS.display.cpu).toBe("both");
  });

  it("defaults startup prefs", () => {
    expect(DEFAULT_WIDGET_PREFS.launch_at_login).toBe(false);
    expect(DEFAULT_WIDGET_PREFS.show_widget_on_startup).toBe(true);
  });

  it("cloneWidgetPrefs deep-copies nested fields", () => {
    const copy = cloneWidgetPrefs(DEFAULT_WIDGET_PREFS);
    copy.display.cpu = "number";
    expect(DEFAULT_WIDGET_PREFS.display.cpu).toBe("both");
  });

  it("blocks disabling the last metric", () => {
    const onlyCpu = { cpu: true, mem: false, disk: false, net: false, users: false };
    expect(canDisableSegment(onlyCpu, "cpu")).toBe(false);
    expect(canDisableSegment(onlyCpu, "mem")).toBe(true);
  });

  it("allows disabling when another metric remains", () => {
    expect(canDisableSegment(DEFAULT_WIDGET_PREFS.segments, "disk")).toBe(true);
  });
});

describe("stackModeHint", () => {
  it("describes each mode", () => {
    expect(stackModeHint("behind")).toMatch(/under/i);
    expect(stackModeHint("on_top")).toMatch(/full-screen/i);
  });
});
