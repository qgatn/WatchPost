import { describe, expect, it } from "vitest";
import { DEFAULT_WIDGET_DISPLAY, DEFAULT_WIDGET_PREFS } from "./widgetPrefs";
import { widgetDisplayLabel, widgetStripHtml } from "./widgetStrip";

const defaultDisplay = DEFAULT_WIDGET_PREFS.display;

describe("widgetStripHtml", () => {
  it("always includes host segment", () => {
    const html = widgetStripHtml("local", "Local", DEFAULT_WIDGET_PREFS.segments, defaultDisplay);
    expect(html).toContain("seg-host");
    expect(html).toContain("Local");
  });

  it("omits disabled segments", () => {
    const html = widgetStripHtml(
      "local",
      "Local",
      {
        cpu: true,
        mem: true,
        disk: false,
        net: false,
        users: false,
      },
      defaultDisplay,
    );
    expect(html).toContain("seg-cpu");
    expect(html).toContain("seg-mem");
    expect(html).not.toContain("seg-disk");
    expect(html).not.toContain("seg-net");
    expect(html).not.toContain("seg-users");
  });

  it("includes users segment when enabled", () => {
    const html = widgetStripHtml(
      "local",
      "Local",
      { ...DEFAULT_WIDGET_PREFS.segments, users: true },
      defaultDisplay,
    );
    expect(html).toContain("seg-users");
    expect(html).toContain("w-users");
  });

  it("renders number-only CPU without bar", () => {
    const html = widgetStripHtml("local", "Local", DEFAULT_WIDGET_PREFS.segments, {
      ...DEFAULT_WIDGET_DISPLAY,
      cpu: "number",
    });
    expect(html).toContain("w-cpu");
    expect(html).not.toContain("w-cpu-bar");
    expect(html).toContain("disp-number");
  });

  it("renders bar-only storage without value", () => {
    const html = widgetStripHtml("local", "Local", DEFAULT_WIDGET_PREFS.segments, {
      ...DEFAULT_WIDGET_DISPLAY,
      disk: "bar",
    });
    expect(html).toContain("w-disk-bar");
    expect(html).not.toContain('class="val w-disk"');
    expect(html).toContain("disp-bar");
  });
});

describe("widgetDisplayLabel", () => {
  it("shows Local for local source", () => {
    expect(widgetDisplayLabel("local", "ignored")).toBe("Local");
  });

  it("shows alias for remote", () => {
    expect(widgetDisplayLabel("prod-web", "prod-web")).toBe("prod-web");
  });
});
