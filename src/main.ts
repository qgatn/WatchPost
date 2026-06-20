import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { diskUsedPct, fmtBytes, fmtRate, fmtUptime, fmtUsers, fmtDiskUsage, usageLevel } from "./format";
import { History } from "./history";
import { isStale } from "./status";

interface DiskInfo {
  name: string;
  mount: string;
  total: number;
  available: number;
}

interface Snapshot {
  source: string;
  hostname: string;
  os: string;
  cpu_usage: number;
  per_core: number[];
  cpu_cores: number;
  physical_cores: number;
  mem_used: number;
  mem_total: number;
  swap_used: number;
  swap_total: number;
  net_rx_bps: number;
  net_tx_bps: number;
  disks: DiskInfo[];
  uptime_secs: number;
  active_users: number;
  ts_ms: number;
}

function drawSpark(
  canvas: HTMLCanvasElement,
  hist: History,
  color: string,
  fixedMax?: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const vals = hist.values();
  if (vals.length < 2) return;
  const max = fixedMax ?? hist.max();
  const step = w / (vals.length - 1);
  ctx.beginPath();
  vals.forEach((v, i) => {
    const x = i * step;
    const y = h - (Math.min(v, max) / max) * h;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = color + "22";
  ctx.fill();
}

// ---------- staleness / alert tracking ----------
let lastUpdate = 0;

function formatCpuSpec(cores: number, physical: number): string {
  if (physical > 0 && physical !== cores) {
    return `${cores} cores (${physical} physical)`;
  }
  return `${cores} core${cores === 1 ? "" : "s"}`;
}

function netBarPct(bps: number, maxBps: number): number {
  if (maxBps <= 0) return 0;
  return Math.min(100, (bps / maxBps) * 100);
}

function primaryDisk(disks: DiskInfo[]): DiskInfo | undefined {
  return disks.find((d) => d.mount === "/") ?? disks[0];
}

function secondaryDisk(disks: DiskInfo[]): DiskInfo | undefined {
  const primary = primaryDisk(disks);
  return disks.find((d) => d !== primary);
}

function diskBarColor(pct: number): string {
  const level = usageLevel(pct);
  if (level === "err") return "var(--err)";
  if (level === "warn") return "var(--warn)";
  return "var(--accent)";
}

function setBar(elId: string, pct: number, color: string) {
  const bar = document.getElementById(elId) as HTMLElement | null;
  if (!bar) return;
  bar.style.width = `${Math.min(100, pct)}%`;
  bar.style.background = color;
}

function updateDiskRow(
  $: (id: string) => HTMLElement,
  prefix: string,
  disk: DiskInfo | undefined,
  fallbackLabel: string,
) {
  const label = $(`${prefix}-label`);
  const pctEl = $(`${prefix}-pct`);
  const sub = $(`${prefix}-sub`);
  const bar = $(`${prefix}-bar`);
  if (!disk || disk.total <= 0) {
    label.textContent = fallbackLabel;
    pctEl.textContent = "–";
    sub.textContent = "–";
    bar.style.width = "0%";
    return;
  }
  const used = disk.total - disk.available;
  const pct = diskUsedPct(disk.total, disk.available);
  label.textContent = disk.mount;
  pctEl.textContent = `${Math.round(pct)}%`;
  sub.textContent = `${fmtBytes(used)} / ${fmtBytes(disk.total)}`;
  bar.style.width = `${pct}%`;
  bar.style.background = diskBarColor(pct);
}

//  MAIN WINDOW
// =====================================================================
function renderMain(root: HTMLElement) {
  document.body.classList.add("main-mode");
  root.innerHTML = `
    <div class="main">
      <div class="topbar">
        <div class="brand">
          <h1>WatchPost</h1>
          <span class="host" id="host">connecting…</span>
        </div>
        <div style="display:flex;align-items:center;gap:14px;">
          <span class="status-pill"><span class="dot" id="status-dot"></span><span id="status-text">live</span></span>
          <button id="widget-btn">Open Widget</button>
        </div>
      </div>
      <div class="grid grid-4">
        <div class="card card-system">
          <h2>System</h2>
          <div class="spec-host" id="spec-host">connecting…</div>
          <ul class="spec-list">
            <li><span>OS</span><span id="spec-os">–</span></li>
            <li><span>CPU</span><span id="spec-cpu">–</span></li>
            <li><span>Memory</span><span id="spec-mem">–</span></li>
            <li><span>Active users</span><span id="spec-users">–</span></li>
            <li><span>Uptime</span><span id="spec-uptime">–</span></li>
          </ul>
        </div>
        <div class="card card-cpu">
          <h2>CPU <span id="cpu-pct">0%</span></h2>
          <div class="big" id="cpu-big">0%</div>
          <canvas class="spark" id="cpu-spark"></canvas>
          <div class="cores-meta"><span id="cores-count">–</span></div>
          <div class="cores-scroll">
            <div class="cores" id="cores"></div>
          </div>
        </div>
        <div class="card card-mem-storage">
          <h2>Memory & Storage</h2>
          <div class="card-section">
            <div class="bar-row">
              <div class="bar-label"><span>Memory</span><span id="mem-pct">0%</span></div>
              <div class="bar bar-sm"><span id="mem-bar" style="background:var(--mem)"></span></div>
              <div class="bar-sub" id="mem-sub">–</div>
            </div>
            <div class="bar-row">
              <div class="bar-label"><span>Swap</span><span id="swap-pct">–</span></div>
              <div class="bar bar-sm"><span id="swap-bar" style="background:var(--warn)"></span></div>
              <div class="bar-sub" id="swap-sub">–</div>
            </div>
          </div>
          <div class="card-divider"></div>
          <div class="card-section">
            <div class="bar-row">
              <div class="bar-label"><span id="disk1-label">Disk</span><span id="disk1-pct">–</span></div>
              <div class="bar bar-sm"><span id="disk1-bar"></span></div>
              <div class="bar-sub" id="disk1-sub">–</div>
            </div>
            <div class="bar-row">
              <div class="bar-label"><span id="disk2-label">Disk 2</span><span id="disk2-pct">–</span></div>
              <div class="bar bar-sm"><span id="disk2-bar"></span></div>
              <div class="bar-sub" id="disk2-sub">–</div>
            </div>
          </div>
        </div>
        <div class="card card-net-sessions">
          <h2>Network & Sessions</h2>
          <div class="card-section">
            <div class="net-bar-row">
              <span class="rx">↓ RX</span>
              <div class="bar bar-sm"><span id="net-rx-bar" style="background:var(--net-rx)"></span></div>
              <span class="val rx" id="net-rx">–</span>
            </div>
            <div class="net-bar-row">
              <span class="tx">↑ TX</span>
              <div class="bar bar-sm"><span id="net-tx-bar" style="background:var(--net-tx)"></span></div>
              <span class="val tx" id="net-tx">–</span>
            </div>
            <canvas class="spark" id="net-spark"></canvas>
            <div class="bar-sub" id="net-peak">Peak: –</div>
          </div>
          <div class="card-divider"></div>
          <div class="card-section">
            <div class="session-stat">
              <span class="session-lbl">Active users</span>
              <span class="session-val" id="sess-users">–</span>
            </div>
            <div class="session-stat">
              <span class="session-lbl">Uptime</span>
              <span class="session-val" id="sess-uptime">–</span>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  const cpuHist = new History(60);
  const netHist = new History(60);
  const $ = (id: string) => document.getElementById(id)!;

  $("widget-btn").addEventListener("click", async () => {
    const visible = await invoke<boolean>("toggle_widget");
    $("widget-btn").textContent = visible ? "Hide Widget" : "Open Widget";
  });

  let coresBuilt = 0;

  function update(s: Snapshot) {
    lastUpdate = Date.now();
    $("host").textContent = s.hostname;
    $("spec-host").textContent = s.hostname;
    $("spec-os").textContent = s.os || "–";
    $("spec-cpu").textContent = formatCpuSpec(
      s.cpu_cores || s.per_core.length,
      s.physical_cores ?? 0,
    );
    $("spec-mem").textContent = fmtBytes(s.mem_total);
    $("spec-users").textContent = fmtUsers(s.active_users ?? 0);
    $("spec-uptime").textContent = fmtUptime(s.uptime_secs);

    // CPU
    const cpu = Math.round(s.cpu_usage);
    const coreCount = s.per_core.length;
    $("cpu-pct").textContent = `${cpu}%`;
    $("cpu-big").textContent = `${cpu}%`;
    $("cores-count").textContent = `${coreCount} core${coreCount === 1 ? "" : "s"}`;
    cpuHist.push(s.cpu_usage);
    drawSpark($("cpu-spark") as HTMLCanvasElement, cpuHist, "#4fd1c5", 100);

    const cores = $("cores");
    if (coresBuilt !== coreCount) {
      cores.innerHTML = s.per_core
        .map((_, i) => `<div class="core" title="Core ${i + 1}"><span id="core-${i}"></span></div>`)
        .join("");
      coresBuilt = coreCount;
    }
    s.per_core.forEach((v, i) => {
      const el = document.getElementById(`core-${i}`);
      if (el) el.style.height = `${Math.min(100, v)}%`;
    });

    // Memory & Storage (4 bars)
    const memPct = s.mem_total ? (s.mem_used / s.mem_total) * 100 : 0;
    $("mem-pct").textContent = `${Math.round(memPct)}%`;
    $("mem-sub").textContent = `${fmtBytes(s.mem_used)} / ${fmtBytes(s.mem_total)}`;
    setBar("mem-bar", memPct, "var(--mem)");
    if (s.swap_total > 0) {
      const swapPct = (s.swap_used / s.swap_total) * 100;
      $("swap-pct").textContent = `${Math.round(swapPct)}%`;
      $("swap-sub").textContent = `${fmtBytes(s.swap_used)} / ${fmtBytes(s.swap_total)}`;
      setBar("swap-bar", swapPct, "var(--warn)");
    } else {
      $("swap-pct").textContent = "–";
      $("swap-sub").textContent = "none";
      setBar("swap-bar", 0, "var(--warn)");
    }
    updateDiskRow($, "disk1", primaryDisk(s.disks), "Disk");
    updateDiskRow($, "disk2", secondaryDisk(s.disks), "Disk 2");

    // Network & Sessions
    $("net-rx").textContent = fmtRate(s.net_rx_bps);
    $("net-tx").textContent = fmtRate(s.net_tx_bps);
    netHist.push(s.net_rx_bps + s.net_tx_bps);
    const netPeak = Math.max(netHist.max(), s.net_rx_bps, s.net_tx_bps, 1);
    ($("net-rx-bar") as HTMLElement).style.width = `${netBarPct(s.net_rx_bps, netPeak)}%`;
    ($("net-tx-bar") as HTMLElement).style.width = `${netBarPct(s.net_tx_bps, netPeak)}%`;
    $("net-peak").textContent = `Peak: ${fmtRate(netPeak)}`;
    drawSpark($("net-spark") as HTMLCanvasElement, netHist, "#63b3ed");
    $("sess-users").textContent = fmtUsers(s.active_users ?? 0);
    $("sess-uptime").textContent = fmtUptime(s.uptime_secs);
  }

  listen<Snapshot>("metrics", (e) => update(e.payload));

  setInterval(() => {
    const stale = isStale(lastUpdate, Date.now());
    const dot = $("status-dot");
    dot.className = "dot" + (stale ? " err" : "");
    $("status-text").textContent = stale ? "stale" : "live";
  }, 1000);
}

// =====================================================================
function setSegmentUsage(seg: HTMLElement, pct: number) {
  seg.classList.remove("usage-ok", "usage-warn", "usage-err");
  seg.classList.add(`usage-${usageLevel(pct)}`);
}

//  WIDGET WINDOW
// =====================================================================
function renderWidget(root: HTMLElement) {
  document.body.classList.add("widget-mode");
  root.classList.add("widget-root");
  root.innerHTML = `
    <div class="widget-wrap" id="widget-wrap">
      <div class="widget-strip" id="widget-strip" data-tauri-drag-region>
        <div class="seg seg-host" data-tauri-drag-region>
          <span class="dot" id="w-dot"></span>
          <span class="name" id="w-host" data-tauri-drag-region>…</span>
        </div>
        <div class="seg seg-users" data-tauri-drag-region>
          <span id="w-users">–</span>
        </div>
        <div class="seg seg-metric" data-tauri-drag-region>
          <span class="lbl">CPU</span>
          <span class="val" id="w-cpu">0%</span>
          <div class="bar bar-inline"><span id="w-cpu-bar"></span></div>
        </div>
        <div class="seg seg-metric" data-tauri-drag-region>
          <span class="lbl">MEM</span>
          <span class="val" id="w-mem">0%</span>
          <div class="bar bar-inline"><span id="w-mem-bar"></span></div>
        </div>
        <div class="seg seg-storage" data-tauri-drag-region>
          <span class="lbl">DISK</span>
          <span class="val" id="w-disk">–</span>
        </div>
        <div class="seg seg-net" data-tauri-drag-region>
          <span class="rx" id="w-rx">↓ –</span>
          <span class="tx" id="w-tx">↑ –</span>
        </div>
      </div>
    </div>`;

  const $ = (id: string) => document.getElementById(id)!;
  const wrap = $("widget-wrap");
  const strip = $("widget-strip");
  const win = getCurrentWindow();

  function fitWindow() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const w = Math.ceil(strip.scrollWidth + 8);
        const h = Math.ceil(strip.offsetHeight + 4);
        if (w > 0 && h > 0) {
          win.setSize(new LogicalSize(w, h)).catch(() => {});
        }
      });
    });
  }

  function update(s: Snapshot) {
    lastUpdate = Date.now();
    $("w-host").textContent = s.hostname;
    $("w-users").textContent = fmtUsers(s.active_users ?? 0);
    const cpu = Math.round(s.cpu_usage);
    $("w-cpu").textContent = `${cpu}%`;
    ($("w-cpu-bar") as HTMLElement).style.width = `${cpu}%`;
    setSegmentUsage($("w-cpu").closest(".seg")!, s.cpu_usage);
    const memPct = s.mem_total ? (s.mem_used / s.mem_total) * 100 : 0;
    $("w-mem").textContent = `${Math.round(memPct)}%`;
    ($("w-mem-bar") as HTMLElement).style.width = `${memPct}%`;
    setSegmentUsage($("w-mem").closest(".seg")!, memPct);
    $("w-rx").textContent = `↓ ${fmtRate(s.net_rx_bps)}`;
    $("w-tx").textContent = `↑ ${fmtRate(s.net_tx_bps)}`;
    const disk = primaryDisk(s.disks);
    const diskEl = $("w-disk");
    const diskSeg = diskEl.closest(".seg")!;
    if (disk && disk.total > 0) {
      const used = disk.total - disk.available;
      const diskPct = diskUsedPct(disk.total, disk.available);
      diskEl.textContent = fmtDiskUsage(used, disk.total);
      setSegmentUsage(diskSeg, diskPct);
    } else {
      diskEl.textContent = "–";
      diskSeg.classList.remove("usage-ok", "usage-warn", "usage-err");
    }
    fitWindow();
  }

  listen<Snapshot>("metrics", (e) => update(e.payload));

  setInterval(() => {
    const stale = isStale(lastUpdate, Date.now());
    $("w-dot").className = "dot" + (stale ? " err" : "");
    strip.classList.toggle("stale", stale);
    fitWindow();
  }, 1000);

  fitWindow();
}

// ---------- bootstrap ----------
window.addEventListener("DOMContentLoaded", () => {
  const root = document.getElementById("app")!;
  const label = getCurrentWindow().label;
  if (label === "widget") {
    renderWidget(root);
  } else {
    renderMain(root);
  }
});
