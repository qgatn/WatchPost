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

const WIDGET_SSH_ICON = `<svg class="widget-ssh-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M3 2.5h10a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V4A1.5 1.5 0 0 1 3 2.5zm0 1a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5V4a.5.5 0 0 0-.5-.5H3zm1.75 2.25h1.5v1h-1.5v-1zm0 2.25h4.5v1h-4.5v-1zm0 2.25h3v1h-3v-1z"/>
</svg>`;

const WIDGET_LOCAL_ICON = `<svg class="widget-local-icon" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
  <path fill="currentColor" d="M8 1.5 1.75 7v7.25A1.25 1.25 0 0 0 3 15.5h3.25V11h3.5v4.5H13a1.25 1.25 0 0 0 1.25-1.25V7L8 1.5zm0 1.6 4.75 4.32v5.58H10V10.25H6V12.5H3.25V7.42 8 6.1l4.75-4.32z"/>
</svg>`;

function leadingSlotHtml(source: string, showSshButton: boolean): string {
  if (!showSshButton) return "";
  const inner =
    source === "local"
      ? `<span class="widget-local-badge" title="This machine" aria-label="Local machine">${WIDGET_LOCAL_ICON}</span>`
      : `<button type="button" class="widget-ssh-btn" data-source="${source}" title="Open SSH" aria-label="Open SSH">${WIDGET_SSH_ICON}</button>`;
  return `<div class="widget-ssh-slot">${inner}</div>`;
}

export function widgetStripHtml(
  source: string,
  label: string,
  segments: WidgetSegments,
  display: WidgetDisplay,
  showSshButton = false,
): string {
  const parts = [
    `
    <div class="widget-strip" data-source="${source}" data-tauri-drag-region title="Double-click to open dashboard">
      ${leadingSlotHtml(source, showSshButton)}
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
