import { invoke } from "@tauri-apps/api/core";

export type StackMode = "behind" | "normal" | "on_top";
export type MetricDisplay = "number" | "bar" | "both";
export type SshClientPreset =
  | "system_default"
  | "mac_terminal"
  | "mac_i_term"
  | "windows_power_shell"
  | "windows_terminal"
  | "moba_xterm"
  | "pu_tty"
  | "custom";

export interface SshClientPrefs {
  preset: SshClientPreset;
  custom_command: string;
}

export interface WidgetSegments {
  cpu: boolean;
  mem: boolean;
  disk: boolean;
  net: boolean;
  users: boolean;
}

export interface WidgetDisplay {
  cpu: MetricDisplay;
  mem: MetricDisplay;
  disk: MetricDisplay;
}

export interface WidgetPrefs {
  stack_mode: StackMode;
  segments: WidgetSegments;
  display: WidgetDisplay;
  launch_at_login: boolean;
  show_widget_on_startup: boolean;
  server_poll_secs: number;
  ssh_client: SshClientPrefs;
}

export const METRIC_SEGMENT_KEYS = ["cpu", "mem", "disk", "net", "users"] as const;
export type MetricSegmentKey = (typeof METRIC_SEGMENT_KEYS)[number];

export const DISPLAY_SEGMENT_KEYS = ["cpu", "mem", "disk"] as const;
export type DisplaySegmentKey = (typeof DISPLAY_SEGMENT_KEYS)[number];

export const DISPLAY_SEGMENT_LABELS: Record<DisplaySegmentKey, string> = {
  cpu: "CPU",
  mem: "Memory",
  disk: "Storage",
};

export const DEFAULT_WIDGET_DISPLAY: WidgetDisplay = {
  cpu: "both",
  mem: "both",
  disk: "number",
};

export const DEFAULT_WIDGET_PREFS: WidgetPrefs = {
  stack_mode: "behind",
  segments: { cpu: true, mem: true, disk: true, net: true, users: false },
  display: { ...DEFAULT_WIDGET_DISPLAY },
  launch_at_login: false,
  show_widget_on_startup: true,
  server_poll_secs: 3,
  ssh_client: { preset: "system_default", custom_command: "" },
};

export function cloneWidgetPrefs(prefs: WidgetPrefs): WidgetPrefs {
  return {
    stack_mode: prefs.stack_mode,
    segments: { ...prefs.segments },
    display: { ...prefs.display },
    launch_at_login: prefs.launch_at_login,
    show_widget_on_startup: prefs.show_widget_on_startup,
    server_poll_secs: prefs.server_poll_secs,
    ssh_client: { ...prefs.ssh_client },
  };
}

export function countEnabledMetrics(segments: WidgetSegments): number {
  return METRIC_SEGMENT_KEYS.filter((k) => segments[k]).length;
}

export function canDisableSegment(segments: WidgetSegments, key: MetricSegmentKey): boolean {
  if (!segments[key]) return true;
  return countEnabledMetrics(segments) > 1;
}

export function stackModeHint(mode: StackMode): string {
  switch (mode) {
    case "behind":
      return "Stays under other windows.";
    case "normal":
      return "Regular window stack — click or drag to bring it forward.";
    case "on_top":
      return "Always visible over other windows. May cover full-screen apps.";
  }
}

export function getWidgetPrefs(): Promise<WidgetPrefs> {
  return invoke<WidgetPrefs>("get_widget_prefs");
}

export function setWidgetPrefs(prefs: WidgetPrefs): Promise<void> {
  return invoke("set_widget_prefs", { prefs });
}
