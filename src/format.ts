/** Human-readable byte sizes (1024-based). */
export function fmtBytes(n: number): string {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function fmtRate(bps: number): string {
  return `${fmtBytes(bps)}/s`;
}

const NET_IDLE_BPS = 1024;

/** Second line under network sparkline: direction ratio + activity, or Idle. */
export function netStatusLine(rxBps: number, txBps: number): string {
  const total = rxBps + txBps;
  if (total < NET_IDLE_BPS) return "Idle";

  if (rxBps >= txBps * 1.25) {
    const ratio = txBps > 0 ? Math.round((rxBps / txBps) * 10) / 10 : null;
    return ratio !== null ? `↓ ${ratio}× download · Active` : "↓ download · Active";
  }
  if (txBps >= rxBps * 1.25) {
    const ratio = rxBps > 0 ? Math.round((txBps / rxBps) * 10) / 10 : null;
    return ratio !== null ? `↑ ${ratio}× upload · Active` : "↑ upload · Active";
  }
  return "Balanced · Active";
}

export function fmtUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function fmtUsers(n: number): string {
  return `${n} user${n === 1 ? "" : "s"}`;
}

export function fmtDiskUsage(used: number, total: number): string {
  return `${fmtBytes(used)} / ${fmtBytes(total)}`;
}

/** Disk used percentage from total/available byte counts. */
export function diskUsedPct(total: number, available: number): number {
  if (total <= 0) return 0;
  const used = total - available;
  return (used / total) * 100;
}

export type UsageLevel = "ok" | "warn" | "err";

/** Green ≤50%, orange >50%, red >90%. */
export function usageLevel(pct: number): UsageLevel {
  if (pct > 90) return "err";
  if (pct > 50) return "warn";
  return "ok";
}

export function usageLabel(pct: number): string {
  const level = usageLevel(pct);
  if (level === "ok") return "healthy (≤50%)";
  if (level === "warn") return "elevated (>50%)";
  return "critical (>90%)";
}

/** Widget segment highlight: yellow when elevated (≥70%), red when high (≥90%). */
export const SEGMENT_WARN_PCT = 70;
export const SEGMENT_ERR_PCT = 90;

export function segmentLevel(pct: number): UsageLevel {
  if (pct >= SEGMENT_ERR_PCT) return "err";
  if (pct >= SEGMENT_WARN_PCT) return "warn";
  return "ok";
}
