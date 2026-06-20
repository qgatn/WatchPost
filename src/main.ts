import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fmtBytes, fmtRate, fmtUptime } from "./format";
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

// =====================================================================
//  MAIN WINDOW
// =====================================================================
function renderMain(root: HTMLElement) {
  document.body.classList.add("main-mode");
  root.innerHTML = `
    <div class="main">
      <div class="topbar">
        <div class="brand">
          <h1>NodeWatch</h1>
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
            <li><span>Uptime</span><span id="spec-uptime">–</span></li>
          </ul>
        </div>
        <div class="card">
          <h2>CPU <span id="cpu-pct">0%</span></h2>
          <div class="big" id="cpu-big">0%</div>
          <canvas class="spark" id="cpu-spark"></canvas>
          <div class="cores" id="cores"></div>
        </div>
        <div class="card">
          <h2>Memory <span id="mem-pct">0%</span></h2>
          <div class="big" id="mem-used">–</div>
          <div class="sub" id="mem-sub"></div>
          <div class="bar"><span id="mem-bar" style="background:var(--mem)"></span></div>
          <div class="sub" id="swap-sub" style="margin-top:10px"></div>
          <div class="bar"><span id="swap-bar" style="background:var(--warn)"></span></div>
        </div>
        <div class="card card-storage-net">
          <h2>Storage & Network</h2>
          <div class="section-label">Network</div>
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
          <div class="section-label section-gap">Storage</div>
          <div id="disks"></div>
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
    $("spec-uptime").textContent = fmtUptime(s.uptime_secs);

    // CPU
    const cpu = Math.round(s.cpu_usage);
    $("cpu-pct").textContent = `${cpu}%`;
    $("cpu-big").textContent = `${cpu}%`;
    cpuHist.push(s.cpu_usage);
    drawSpark($("cpu-spark") as HTMLCanvasElement, cpuHist, "#4fd1c5", 100);

    // per-core bars
    const cores = $("cores");
    if (coresBuilt !== s.per_core.length) {
      cores.innerHTML = s.per_core
        .map((_, i) => `<div class="core"><span id="core-${i}"></span></div>`)
        .join("");
      coresBuilt = s.per_core.length;
    }
    s.per_core.forEach((v, i) => {
      const el = document.getElementById(`core-${i}`);
      if (el) el.style.height = `${Math.min(100, v)}%`;
    });

    // Memory
    const memPct = s.mem_total ? (s.mem_used / s.mem_total) * 100 : 0;
    $("mem-pct").textContent = `${Math.round(memPct)}%`;
    $("mem-used").textContent = fmtBytes(s.mem_used);
    $("mem-sub").textContent = `of ${fmtBytes(s.mem_total)}`;
    ($("mem-bar") as HTMLElement).style.width = `${memPct}%`;
    if (s.swap_total > 0) {
      const swapPct = (s.swap_used / s.swap_total) * 100;
      $("swap-sub").textContent = `Swap: ${fmtBytes(s.swap_used)} / ${fmtBytes(s.swap_total)}`;
      ($("swap-bar") as HTMLElement).style.width = `${swapPct}%`;
    } else {
      $("swap-sub").textContent = "Swap: none";
    }

    // Network + activity bars (scaled to recent peak)
    $("net-rx").textContent = fmtRate(s.net_rx_bps);
    $("net-tx").textContent = fmtRate(s.net_tx_bps);
    netHist.push(s.net_rx_bps + s.net_tx_bps);
    const netPeak = Math.max(netHist.max(), s.net_rx_bps, s.net_tx_bps, 1);
    ($("net-rx-bar") as HTMLElement).style.width =
      `${netBarPct(s.net_rx_bps, netPeak)}%`;
    ($("net-tx-bar") as HTMLElement).style.width =
      `${netBarPct(s.net_tx_bps, netPeak)}%`;
    drawSpark($("net-spark") as HTMLCanvasElement, netHist, "#63b3ed");

    // Disks
    $("disks").innerHTML = s.disks
      .map((d) => {
        const used = d.total - d.available;
        const pct = d.total ? (used / d.total) * 100 : 0;
        return `<div class="disk-row">
            <div class="label"><span>${d.mount}</span><span>${fmtBytes(used)} / ${fmtBytes(d.total)}</span></div>
            <div class="bar"><span style="width:${pct}%;background:${pct > 90 ? "var(--err)" : "var(--accent)"}"></span></div>
          </div>`;
      })
      .join("");
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
//  WIDGET WINDOW
// =====================================================================
function renderWidget(root: HTMLElement) {
  document.body.classList.add("widget");
  root.innerHTML = `
    <div class="widget" data-tauri-drag-region>
      <div class="whead">
        <span class="name" id="w-host" data-tauri-drag-region>NodeWatch</span>
        <span class="status-pill"><span class="dot" id="w-dot" data-tauri-drag-region></span></span>
      </div>
      <div class="metric" data-tauri-drag-region>
        <div class="row1"><span>CPU</span><span class="val" id="w-cpu">0%</span></div>
        <div class="bar"><span id="w-cpu-bar" style="background:var(--cpu)"></span></div>
      </div>
      <div class="metric" data-tauri-drag-region>
        <div class="row1"><span>Memory</span><span class="val" id="w-mem">0%</span></div>
        <div class="bar"><span id="w-mem-bar" style="background:var(--mem)"></span></div>
      </div>
      <div class="metric" data-tauri-drag-region>
        <div class="row1"><span>Net ↓</span><span class="val rx" id="w-rx">–</span></div>
        <div class="row1"><span>Net ↑</span><span class="val tx" id="w-tx">–</span></div>
      </div>
      <div class="alert" id="w-alert">⚠ Disconnected — no data</div>
    </div>`;

  const $ = (id: string) => document.getElementById(id)!;

  function update(s: Snapshot) {
    lastUpdate = Date.now();
    $("w-host").textContent = s.hostname;
    const cpu = Math.round(s.cpu_usage);
    $("w-cpu").textContent = `${cpu}%`;
    ($("w-cpu-bar") as HTMLElement).style.width = `${cpu}%`;
    const memPct = s.mem_total ? (s.mem_used / s.mem_total) * 100 : 0;
    $("w-mem").textContent = `${Math.round(memPct)}%`;
    ($("w-mem-bar") as HTMLElement).style.width = `${memPct}%`;
    $("w-rx").textContent = fmtRate(s.net_rx_bps);
    $("w-tx").textContent = fmtRate(s.net_tx_bps);
  }

  listen<Snapshot>("metrics", (e) => update(e.payload));

  setInterval(() => {
    const stale = isStale(lastUpdate, Date.now());
    $("w-dot").className = "dot" + (stale ? " err" : "");
    $("w-alert").className = "alert" + (stale ? " show" : "");
  }, 1000);
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
