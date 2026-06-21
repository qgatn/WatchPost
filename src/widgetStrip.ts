import type { MetricDisplay, WidgetDisplay, WidgetSegments } from "./widgetPrefs";

export function widgetDisplayLabel(source: string, alias: string): string {
  return source === "local" ? "Local" : alias;
}

function metricValueHtml(kind: "cpu" | "mem", mode: MetricDisplay): string {
  if (mode === "bar") return "";
  return `<span class="val w-${kind}">0%</span>`;
}

function metricBarHtml(kind: "cpu" | "mem", mode: MetricDisplay): string {
  if (mode === "number") return "";
  return `<div class="bar bar-inline"><span class="w-${kind}-bar"></span></div>`;
}

function metricSegmentHtml(kind: "cpu" | "mem", mode: MetricDisplay): string {
  const label = kind === "cpu" ? "CPU" : "MEM";
  return `
      <div class="seg seg-metric seg-${kind} disp-${mode}" data-tauri-drag-region>
        <span class="lbl">${label}</span>
        ${metricValueHtml(kind, mode)}
        ${metricBarHtml(kind, mode)}
      </div>`;
}

function diskSegmentHtml(mode: MetricDisplay): string {
  const valHtml = mode === "bar" ? "" : `<span class="val w-disk">–</span>`;
  const barHtml =
    mode === "number" ? "" : `<div class="bar bar-inline"><span class="w-disk-bar"></span></div>`;
  return `
      <div class="seg seg-storage seg-disk disp-${mode}" data-tauri-drag-region>
        <span class="lbl">DISK</span>
        ${valHtml}
        ${barHtml}
      </div>`;
}

function netSegmentHtml(): string {
  return `
      <div class="seg seg-net" data-tauri-drag-region>
        <span class="rx w-rx">↓ –</span>
        <span class="tx w-tx">↑ –</span>
      </div>`;
}

function usersSegmentHtml(): string {
  return `
      <div class="seg seg-users" data-tauri-drag-region>
        <span class="val w-users">0 users</span>
      </div>`;
}

export function widgetStripHtml(
  source: string,
  label: string,
  segments: WidgetSegments,
  display: WidgetDisplay,
): string {
  const parts = [
    `
    <div class="widget-strip" data-source="${source}" data-tauri-drag-region title="Double-click to open dashboard">
      <div class="seg seg-host" data-tauri-drag-region>
        <span class="dot w-dot"></span>
        <span class="name w-host" data-tauri-drag-region title="">${label}</span>
      </div>`,
  ];
  if (segments.cpu) parts.push(metricSegmentHtml("cpu", display.cpu));
  if (segments.mem) parts.push(metricSegmentHtml("mem", display.mem));
  if (segments.disk) parts.push(diskSegmentHtml(display.disk));
  if (segments.net) parts.push(netSegmentHtml());
  if (segments.users) parts.push(usersSegmentHtml());
  parts.push("</div>");
  return parts.join("");
}
