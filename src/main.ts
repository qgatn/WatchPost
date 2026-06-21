import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  diskUsedPct,
  fmtBytes,
  fmtRate,
  fmtUptime,
  fmtUsers,
  fmtDiskUsage,
  netStatusLine,
  usageLevel,
  segmentLevel,
} from "./format";
import { displayDisks, primaryDisk } from "./disks";
import { History } from "./history";
import lighthouseUrl from "./assets/lighthouse.png";
import {
  addServer,
  ALIAS_MAX_LEN,
  buildSetupCommands,
  copyText,
  diagnoseServer,
  entryToNewServer,
  getSshSetupInfo,
  listServers,
  testServer,
  type DiagnoseResult,
  type NewServer,
  type ServerEntry,
  type SourceStatus,
  type SshSetupInfo,
} from "./servers";
import { isStale } from "./status";
import {
  canDisableSegment,
  cloneWidgetPrefs,
  countEnabledMetrics,
  DEFAULT_WIDGET_PREFS,
  DISPLAY_SEGMENT_KEYS,
  DISPLAY_SEGMENT_LABELS,
  getWidgetPrefs,
  setWidgetPrefs,
  stackModeHint,
  type DisplaySegmentKey,
  type MetricDisplay,
  type MetricSegmentKey,
  type StackMode,
  type WidgetPrefs,
} from "./widgetPrefs";
import { widgetDisplayLabel, widgetStripHtml } from "./widgetStrip";

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

function drawDualSpark(
  canvas: HTMLCanvasElement,
  rxHist: History,
  txHist: History,
  rxColor: string,
  txColor: string,
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

  const rxVals = rxHist.values();
  const txVals = txHist.values();
  const len = Math.min(rxVals.length, txVals.length);
  if (len < 2) return;

  const max = Math.max(rxHist.max(), txHist.max(), 1);
  const step = w / (len - 1);
  const context = ctx;

  function strokeSeries(vals: number[], color: string, fill: string) {
    context.beginPath();
    vals.forEach((v, i) => {
      const x = i * step;
      const y = h - (Math.min(v, max) / max) * h;
      i === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
    });
    context.strokeStyle = color;
    context.lineWidth = 1.5;
    context.stroke();
    context.lineTo(w, h);
    context.lineTo(0, h);
    context.closePath();
    context.fillStyle = fill;
    context.fill();
  }

  strokeSeries(txVals.slice(-len), txColor, txColor + "18");
  strokeSeries(rxVals.slice(-len), rxColor, rxColor + "22");
}

// ---------- staleness / alert tracking ----------
const lastUpdateBySource = new Map<string, number>();
const snapshotsBySource = new Map<string, Snapshot>();
const sourceStatusBySource = new Map<string, SourceStatus>();

function formatTime(tsMs: number): string {
  return new Date(tsMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDiagnoseResult(result: DiagnoseResult): string {
  return result.steps
    .map((s) => `${s.ok ? "OK" : "FAIL"}  ${s.step}\n     ${s.detail}`)
    .join("\n");
}

function formatCpuSpec(cores: number, physical: number): string {
  if (physical > 0 && physical !== cores) {
    return `${cores} cores (${physical} physical)`;
  }
  return `${cores} core${cores === 1 ? "" : "s"}`;
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

function fillDiskRow(row: HTMLElement, disk: DiskInfo) {
  const used = disk.total - disk.available;
  const pct = diskUsedPct(disk.total, disk.available);
  row.querySelector(".disk-label")!.textContent = disk.mount;
  row.querySelector(".disk-pct")!.textContent = `${Math.round(pct)}%`;
  row.querySelector(".disk-sub")!.textContent = `${fmtBytes(used)} / ${fmtBytes(disk.total)}`;
  const bar = row.querySelector(".disk-bar") as HTMLElement;
  bar.style.width = `${pct}%`;
  bar.style.background = diskBarColor(pct);
}

function diskRowHtml(): string {
  return `
    <div class="bar-row">
      <div class="bar-label"><span class="disk-label">Disk</span><span class="disk-pct">–</span></div>
      <div class="bar bar-sm"><span class="disk-bar"></span></div>
      <div class="bar-sub disk-sub">–</div>
    </div>`;
}

//  MAIN WINDOW
// =====================================================================
function renderMain(root: HTMLElement) {
  document.body.classList.add("main-mode");
  root.innerHTML = `
    <div class="main">
      <div class="topbar">
        <div class="brand">
          <span class="brand-logo" id="brand-logo" aria-hidden="true"></span>
          <h1>WatchPost</h1>
          <select id="source-select" class="source-select" aria-label="Monitor target">
            <option value="local">Local</option>
          </select>
        </div>
        <div class="topbar-actions">
          <span class="status-pill"><span class="dot" id="status-dot"></span><span id="status-text">live</span></span>
          <button type="button" id="add-server-btn" class="btn-ghost">+ Add server</button>
          <button type="button" id="diag-btn" class="btn-ghost hidden">Diagnostics</button>
          <button type="button" id="widget-settings-btn" class="btn-ghost btn-icon" title="Widget settings" aria-label="Widget settings">⚙</button>
          <button type="button" id="widget-btn">Open Widget</button>
        </div>
      </div>
      <div id="diag-panel" class="diag-panel hidden" aria-hidden="true">
        <div class="diag-header">
          <h2 id="diag-title">Diagnostics</h2>
          <button type="button" id="diag-close" class="btn-ghost" aria-label="Close">✕</button>
        </div>
        <p class="diag-hint" id="diag-hint">Live poller messages and step-by-step checks for the selected server.</p>
        <div class="diag-actions">
          <button type="button" id="diag-run">Run full check</button>
          <button type="button" id="diag-copy" class="btn-ghost">Copy log</button>
        </div>
        <pre class="diag-log" id="diag-log"></pre>
      </div>
      <div id="widget-settings-modal" class="modal hidden" aria-hidden="true">
        <div class="modal-backdrop" data-close-widget-settings></div>
        <div class="modal-panel widget-settings-panel" role="dialog" aria-labelledby="widget-settings-title">
          <div class="modal-panel-header">
            <h2 id="widget-settings-title">Widget settings</h2>
          </div>
          <div class="modal-panel-scroll">
          <div class="settings-section">
            <h3>Widget position</h3>
            <div class="seg-control" id="stack-mode-control" role="radiogroup" aria-label="Widget position">
              <button type="button" class="seg-opt" data-stack="behind">Behind</button>
              <button type="button" class="seg-opt" data-stack="normal">Normal</button>
              <button type="button" class="seg-opt" data-stack="on_top">On top</button>
            </div>
            <p class="modal-hint" id="stack-mode-hint"></p>
          </div>
          <div class="settings-section">
            <h3>Show on widget</h3>
            <div class="checkbox-grid" id="segment-toggles">
              <label><input type="checkbox" data-seg="cpu" /> CPU</label>
              <label><input type="checkbox" data-seg="mem" /> Memory</label>
              <label><input type="checkbox" data-seg="disk" /> Disk</label>
              <label><input type="checkbox" data-seg="net" /> Network</label>
              <label><input type="checkbox" data-seg="users" /> Users</label>
            </div>
          </div>
          <div class="settings-section">
            <h3>Metric style</h3>
            <p class="modal-hint">CPU and memory show as percent (e.g. 14%). Storage can show used/total, a bar, or both.</p>
            <div class="display-style-list" id="display-style-list">
              ${DISPLAY_SEGMENT_KEYS.map(
                (key) => `
              <div class="display-style-row" data-display-row="${key}">
                <span class="display-style-label">${DISPLAY_SEGMENT_LABELS[key]}</span>
                <div class="seg-control seg-control-compact" role="radiogroup" aria-label="${DISPLAY_SEGMENT_LABELS[key]} display">
                  <button type="button" class="seg-opt" data-display="${key}" data-mode="number">Number</button>
                  <button type="button" class="seg-opt" data-display="${key}" data-mode="bar">Bar</button>
                  <button type="button" class="seg-opt" data-display="${key}" data-mode="both">Both</button>
                </div>
              </div>`,
              ).join("")}
            </div>
          </div>
          </div>
          <div class="modal-footer">
            <button type="button" id="widget-settings-done">Done</button>
          </div>
        </div>
      </div>
      <div id="add-server-modal" class="modal hidden" aria-hidden="true">
        <div class="modal-backdrop" data-close-modal></div>
        <div class="modal-panel" role="dialog" aria-labelledby="modal-title">
          <h2 id="modal-title">Add SSH server</h2>
          <div class="modal-steps">
            <span class="step-pill active" data-step-pill="1">1 Details</span>
            <span class="step-pill" data-step-pill="2">2 Setup</span>
            <span class="step-pill" data-step-pill="3">3 Test</span>
          </div>
          <div class="modal-body" data-step="1">
            <label>Alias <input id="srv-alias" placeholder="prod-web" maxlength="${ALIAS_MAX_LEN}" /><span class="field-hint">Short name, max ${ALIAS_MAX_LEN} characters</span></label>
            <label>Host <input id="srv-host" placeholder="192.168.1.50" /></label>
            <label>Port <input id="srv-port" type="number" value="22" /></label>
            <label>User <input id="srv-user" placeholder="deploy" /></label>
            <p class="modal-hint">Uses your SSH agent (same keys as Terminal). One-time: put your <strong>public</strong> key on the server.</p>
          </div>
          <div class="modal-body hidden" data-step="2">
            <p class="modal-hint">WatchPost logs in with your SSH key — no passwords stored. Run these once per server, top to bottom.</p>
            <p class="modal-hint" id="setup-key-status">Checking for SSH key…</p>
            <pre class="setup-key-line hidden" id="setup-pubkey"></pre>
            <button type="button" class="btn-ghost hidden" id="copy-pubkey">Copy public key</button>
            <div class="tab-row">
              <button type="button" class="tab active" data-shell-tab="bash">Bash</button>
              <button type="button" class="tab" data-shell-tab="ps">PowerShell</button>
            </div>
            <div class="cmd-block" data-shell-panel="bash">
              <div class="cmd-item">
                <div class="cmd-row"><span class="cmd-lbl">1 · Generate key</span><pre id="cmd-bash-keygen"></pre><button type="button" class="copy-cmd" data-copy="cmd-bash-keygen">Copy</button></div>
                <p class="cmd-why" id="why-bash-keygen">Creates an SSH key pair if you don't have one yet.</p>
              </div>
              <div class="cmd-item">
                <div class="cmd-row"><span class="cmd-lbl">2 · Install on server</span><pre id="cmd-bash-copy"></pre><button type="button" class="copy-cmd" data-copy="cmd-bash-copy">Copy</button></div>
                <p class="cmd-why">Adds your public key to the server's authorized_keys so WatchPost can log in without a password.</p>
              </div>
              <div class="cmd-item">
                <div class="cmd-row"><span class="cmd-lbl">3 · Test SSH</span><pre id="cmd-bash-test"></pre><button type="button" class="copy-cmd" data-copy="cmd-bash-test">Copy</button></div>
                <p class="cmd-why">Confirms it works — you should connect without being asked for a password.</p>
              </div>
            </div>
            <div class="cmd-block hidden" data-shell-panel="ps">
              <div class="cmd-item">
                <div class="cmd-row"><span class="cmd-lbl">1 · Generate key</span><pre id="cmd-ps-keygen"></pre><button type="button" class="copy-cmd" data-copy="cmd-ps-keygen">Copy</button></div>
                <p class="cmd-why" id="why-ps-keygen">Creates an SSH key pair if you don't have one yet.</p>
              </div>
              <div class="cmd-item">
                <div class="cmd-row"><span class="cmd-lbl">2 · Install on server</span><pre id="cmd-ps-copy"></pre><button type="button" class="copy-cmd" data-copy="cmd-ps-copy">Copy</button></div>
                <p class="cmd-why">Adds your public key to the server's authorized_keys so WatchPost can log in without a password.</p>
              </div>
              <div class="cmd-item">
                <div class="cmd-row"><span class="cmd-lbl">3 · Test SSH</span><pre id="cmd-ps-test"></pre><button type="button" class="copy-cmd" data-copy="cmd-ps-test">Copy</button></div>
                <p class="cmd-why">Confirms it works — you should connect without being asked for a password.</p>
              </div>
            </div>
          </div>
          <div class="modal-body hidden" data-step="3">
            <p id="test-result" class="test-result">Click Test connection to verify.</p>
            <button type="button" id="test-server-btn">Test connection</button>
            <button type="button" id="test-diag-btn" class="btn-ghost">Run full diagnostics</button>
          </div>
          <div class="modal-footer">
            <button type="button" id="modal-cancel">Cancel</button>
            <button type="button" id="modal-back" class="hidden">Back</button>
            <button type="button" id="modal-next">Continue</button>
            <button type="button" id="modal-save" class="hidden">Save & monitor</button>
          </div>
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
          <div class="card-section" id="disk-rows"></div>
        </div>
        <div class="card card-net">
          <h2>Network</h2>
          <div class="card-section">
            <div class="net-summary">
              <span class="net-stat rx"><span class="net-dir">↓</span> <span id="net-rx">–</span></span>
              <span class="net-stat total"><span class="net-dir">Σ</span> <span id="net-total">–</span></span>
              <span class="net-stat tx"><span class="net-dir">↑</span> <span id="net-tx">–</span></span>
            </div>
            <canvas class="spark net-spark-dual" id="net-spark"></canvas>
            <div class="net-stats">
              <span>Avg: <span id="net-avg">–</span></span>
              <span>Peak: <span id="net-peak">–</span></span>
            </div>
            <div class="net-status" id="net-status">–</div>
          </div>
        </div>
      </div>
    </div>`;

  const cpuHist = new History(60);
  const netRxHist = new History(60);
  const netTxHist = new History(60);
  const netTotalHist = new History(60);
  const $ = (id: string) => document.getElementById(id)!;

  const brandLogo = $("brand-logo");
  brandLogo.style.webkitMaskImage = `url(${lighthouseUrl})`;
  brandLogo.style.maskImage = `url(${lighthouseUrl})`;

  let selectedSource = "local";
  let coresBuilt = 0;
  let lastCoreCount = 0;
  let modalStep = 1;
  let setupInfo: SshSetupInfo | null = null;
  let savedServers: ServerEntry[] = [];
  let diskSectionKey = "";
  let diagLogLines: string[] = [];
  let widgetPrefs: WidgetPrefs = cloneWidgetPrefs(DEFAULT_WIDGET_PREFS);

  function appendDiag(line: string) {
    diagLogLines.push(line);
    const log = $("diag-log");
    log.textContent = diagLogLines.join("\n");
    log.scrollTop = log.scrollHeight;
  }

  function openDiagPanel(title: string) {
    $("diag-title").textContent = title;
    $("diag-panel").classList.remove("hidden");
    $("diag-panel").setAttribute("aria-hidden", "false");
  }

  function closeDiagPanel() {
    $("diag-panel").classList.add("hidden");
    $("diag-panel").setAttribute("aria-hidden", "true");
  }

  function updateDiagButtonVisibility() {
    $("diag-btn").classList.toggle("hidden", selectedSource === "local");
  }

  function renderDiagStatusForSource(source: string) {
    const st = sourceStatusBySource.get(source);
    if (st) {
      const tag = st.ok ? "OK" : "ERR";
      appendDiag(`[${formatTime(st.ts_ms)}] ${tag}  ${st.message}`);
    }
  }

  async function runDiagnostics(server: NewServer, label: string) {
    openDiagPanel(`Diagnostics — ${label}`);
    diagLogLines = [];
    appendDiag(`--- full check started ${new Date().toLocaleString()} ---`);
    $("diag-run").textContent = "Running…";
    try {
      const result = await diagnoseServer(server);
      appendDiag(formatDiagnoseResult(result));
      appendDiag(result.ok ? "--- all checks passed ---" : "--- check failed — see FAIL lines above ---");
    } catch (e) {
      appendDiag(`FAIL  diagnose command\n     ${String(e)}`);
    } finally {
      $("diag-run").textContent = "Run full check";
    }
  }

  function serverForSelectedSource(): NewServer | null {
    if (selectedSource === "local") return null;
    const entry = savedServers.find((s) => s.alias === selectedSource);
    return entry ? entryToNewServer(entry) : null;
  }

  function readForm(): NewServer | null {
    const alias = ($("srv-alias") as HTMLInputElement).value.trim();
    const host = ($("srv-host") as HTMLInputElement).value.trim();
    const port = Number(($("srv-port") as HTMLInputElement).value) || 22;
    const user = ($("srv-user") as HTMLInputElement).value.trim();
    if (!alias || !host || !user) return null;
    if (alias.length > ALIAS_MAX_LEN) return null;
    return { alias, host, port, user, auth: "agent", key_path: null };
  }

  function refreshSourceSelect(servers: ServerEntry[]) {
    const sel = $("source-select") as HTMLSelectElement;
    const prev = sel.value;
    sel.innerHTML = `<option value="local">Local</option>`;
    for (const s of servers) {
      const opt = document.createElement("option");
      opt.value = s.alias;
      opt.textContent = s.alias;
      sel.appendChild(opt);
    }
    if (prev === "local" || servers.some((s) => s.alias === prev)) {
      sel.value = prev;
    }
    selectedSource = sel.value;
    updateDiagButtonVisibility();
  }

  async function loadServersList() {
    savedServers = await listServers();
    refreshSourceSelect(savedServers);
  }

  function layoutCores(coreCount: number) {
    const cores = $("cores");
    const scroll = cores.parentElement as HTMLElement | null;
    if (!scroll || coreCount <= 0) return;

    const gap = 2;
    const minCoreWidth = 4;
    const available = scroll.clientWidth;
    const fitWidth = Math.floor((available - gap * (coreCount - 1)) / coreCount);

    if (fitWidth >= minCoreWidth) {
      cores.style.width = "100%";
      cores.style.gridTemplateColumns = `repeat(${coreCount}, minmax(0, 1fr))`;
    } else {
      const totalWidth = coreCount * minCoreWidth + gap * (coreCount - 1);
      cores.style.width = `${totalWidth}px`;
      cores.style.gridTemplateColumns = `repeat(${coreCount}, ${minCoreWidth}px)`;
    }
  }

  function setModalStep(step: number) {
    modalStep = step;
    document.querySelectorAll("[data-step]").forEach((el) => {
      el.classList.toggle("hidden", el.getAttribute("data-step") !== String(step));
    });
    document.querySelectorAll("[data-step-pill]").forEach((el) => {
      el.classList.toggle("active", el.getAttribute("data-step-pill") === String(step));
    });
    $("modal-back").classList.toggle("hidden", step === 1);
    $("modal-next").classList.toggle("hidden", step === 3);
    $("modal-save").classList.toggle("hidden", step !== 3);
  }

  function openModal() {
    const modal = $("add-server-modal");
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    setModalStep(1);
    ($("test-result") as HTMLElement).textContent = "Click Test connection to verify.";
    ($("test-result") as HTMLElement).className = "test-result";
  }

  function closeModal() {
    const modal = $("add-server-modal");
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }

  function syncWidgetSettingsUi() {
    document.querySelectorAll<HTMLButtonElement>("#stack-mode-control .seg-opt").forEach((btn) => {
      const mode = btn.getAttribute("data-stack") as StackMode;
      btn.classList.toggle("active", mode === widgetPrefs.stack_mode);
      btn.setAttribute("aria-checked", mode === widgetPrefs.stack_mode ? "true" : "false");
    });
    $("stack-mode-hint").textContent = stackModeHint(widgetPrefs.stack_mode);
    document.querySelectorAll<HTMLInputElement>("#segment-toggles input[data-seg]").forEach((input) => {
      const key = input.getAttribute("data-seg") as MetricSegmentKey;
      input.checked = widgetPrefs.segments[key];
      input.disabled = !canDisableSegment(widgetPrefs.segments, key);
    });
    document.querySelectorAll<HTMLButtonElement>("[data-display][data-mode]").forEach((btn) => {
      const key = btn.getAttribute("data-display") as DisplaySegmentKey;
      const mode = btn.getAttribute("data-mode") as MetricDisplay;
      btn.classList.toggle("active", widgetPrefs.display[key] === mode);
      btn.setAttribute("aria-checked", widgetPrefs.display[key] === mode ? "true" : "false");
    });
    document.querySelectorAll<HTMLElement>("[data-display-row]").forEach((row) => {
      const key = row.getAttribute("data-display-row") as DisplaySegmentKey;
      row.classList.toggle("disabled", !widgetPrefs.segments[key]);
    });
  }

  function openWidgetSettings() {
    syncWidgetSettingsUi();
    const modal = $("widget-settings-modal");
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
  }

  function closeWidgetSettings() {
    const modal = $("widget-settings-modal");
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }

  async function applyWidgetPrefs(prefs: WidgetPrefs) {
    await setWidgetPrefs(prefs);
  }

  function fillSetupCommands() {
    const form = readForm();
    if (!form) return;
    const cmds = buildSetupCommands(form.host, form.port, form.user);
    $("cmd-bash-keygen").textContent = cmds.bashKeygen;
    $("cmd-bash-copy").textContent = cmds.bashCopyId;
    $("cmd-bash-test").textContent = cmds.bashTest;
    $("cmd-ps-keygen").textContent = cmds.psKeygen;
    $("cmd-ps-copy").textContent = cmds.psCopyId;
    $("cmd-ps-test").textContent = cmds.psTest;
  }

  async function refreshSetupInfo() {
    setupInfo = await getSshSetupInfo();
    const status = $("setup-key-status");
    const pub = $("setup-pubkey");
    const copyBtn = $("copy-pubkey");
    const keygenWhy = [$("why-bash-keygen"), $("why-ps-keygen")];
    if (setupInfo.has_public_key && setupInfo.public_key) {
      status.textContent = `Found public key: ${setupInfo.public_key_path}`;
      pub.textContent = setupInfo.public_key;
      pub.classList.remove("hidden");
      copyBtn.classList.remove("hidden");
      for (const el of keygenWhy) {
        el.textContent = "You already have a key (shown above) — you can skip this step.";
        el.classList.add("cmd-why-optional");
      }
    } else {
      status.textContent = "No public key found — generate one with the command below.";
      pub.classList.add("hidden");
      copyBtn.classList.add("hidden");
      for (const el of keygenWhy) {
        el.textContent = "You don't have an SSH key yet — run this first to create one.";
        el.classList.remove("cmd-why-optional");
      }
    }
  }

  function updateDiskSection(disks: DiskInfo[]) {
    const list = displayDisks(disks);
    const key = list.map((d) => `${d.mount}:${d.total}`).join("|");
    const container = $("disk-rows");
    if (key !== diskSectionKey) {
      diskSectionKey = key;
      container.innerHTML =
        list.length === 0
          ? `<p class="bar-sub disk-empty">No disks detected</p>`
          : list.map(() => diskRowHtml()).join("");
    }
    container.querySelectorAll<HTMLElement>(".bar-row").forEach((row, i) => {
      if (list[i]) fillDiskRow(row, list[i]);
    });
  }

  function applySnapshot(s: Snapshot) {
    snapshotsBySource.set(s.source, s);
    lastUpdateBySource.set(s.source, Date.now());
    if (s.source !== selectedSource) return;

    $("spec-host").textContent = s.source === "local" ? s.hostname : `${s.source} — ${s.hostname}`;
    $("spec-os").textContent = s.os || "–";
    $("spec-cpu").textContent = formatCpuSpec(
      s.cpu_cores || s.per_core.length,
      s.physical_cores ?? 0,
    );
    $("spec-mem").textContent = fmtBytes(s.mem_total);
    $("spec-users").textContent = fmtUsers(s.active_users ?? 0);
    $("spec-uptime").textContent = fmtUptime(s.uptime_secs);

    const cpu = Math.round(s.cpu_usage);
    const coreCount = s.per_core.length;
    $("cpu-pct").textContent = `${cpu}%`;
    $("cpu-big").textContent = `${cpu}%`;
    $("cores-count").textContent = `${coreCount} core${coreCount === 1 ? "" : "s"}`;
    cpuHist.push(s.cpu_usage);
    drawSpark($("cpu-spark") as HTMLCanvasElement, cpuHist, "#d8dee4", 100);

    const cores = $("cores");
    if (coresBuilt !== coreCount) {
      cores.innerHTML = s.per_core
        .map((_, i) => `<div class="core" title="Core ${i + 1}"><span id="core-${i}"></span></div>`)
        .join("");
      coresBuilt = coreCount;
      lastCoreCount = coreCount;
    }
    layoutCores(coreCount);
    s.per_core.forEach((v, i) => {
      const el = document.getElementById(`core-${i}`);
      if (el) el.style.height = `${Math.min(100, v)}%`;
    });

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
    updateDiskSection(s.disks);

    $("net-rx").textContent = fmtRate(s.net_rx_bps);
    $("net-tx").textContent = fmtRate(s.net_tx_bps);
    $("net-total").textContent = fmtRate(s.net_rx_bps + s.net_tx_bps);
    netRxHist.push(s.net_rx_bps);
    netTxHist.push(s.net_tx_bps);
    netTotalHist.push(s.net_rx_bps + s.net_tx_bps);
    const netPeak = Math.max(netTotalHist.max(), s.net_rx_bps + s.net_tx_bps, 1);
    $("net-avg").textContent = fmtRate(netTotalHist.avg());
    $("net-peak").textContent = fmtRate(netPeak);
    $("net-status").textContent = netStatusLine(s.net_rx_bps, s.net_tx_bps);
    drawDualSpark(
      $("net-spark") as HTMLCanvasElement,
      netRxHist,
      netTxHist,
      "#63b3ed",
      "#b794f4",
    );
  }

  function syncWidgetButton(visible: boolean) {
    $("widget-btn").textContent = visible ? "Hide Widget" : "Open Widget";
  }

  $("widget-btn").addEventListener("click", async () => {
    const visible = await invoke<boolean>("toggle_widget");
    syncWidgetButton(visible);
  });

  listen("widget-shown", () => syncWidgetButton(true));
  listen("widget-hidden", () => syncWidgetButton(false));

  $("widget-settings-btn").addEventListener("click", () => openWidgetSettings());
  $("widget-settings-done").addEventListener("click", () => closeWidgetSettings());
  document.querySelectorAll("[data-close-widget-settings]").forEach((el) => {
    el.addEventListener("click", () => closeWidgetSettings());
  });

  document.querySelectorAll("#stack-mode-control .seg-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-stack") as StackMode;
      applyWidgetPrefs({ ...widgetPrefs, stack_mode: mode }).catch(() => {});
    });
  });

  document.querySelectorAll<HTMLInputElement>("#segment-toggles input[data-seg]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.getAttribute("data-seg") as MetricSegmentKey;
      const next = { ...widgetPrefs.segments, [key]: input.checked };
      if (countEnabledMetrics(next) === 0) {
        input.checked = widgetPrefs.segments[key];
        return;
      }
      applyWidgetPrefs({ ...widgetPrefs, segments: next }).catch(() => {});
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-display][data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-display") as DisplaySegmentKey;
      const mode = btn.getAttribute("data-mode") as MetricDisplay;
      if (!widgetPrefs.segments[key]) return;
      applyWidgetPrefs({
        ...widgetPrefs,
        display: { ...widgetPrefs.display, [key]: mode },
      }).catch(() => {});
    });
  });

  listen<WidgetPrefs>("widget-prefs-changed", (e) => {
    widgetPrefs = cloneWidgetPrefs(e.payload);
    syncWidgetSettingsUi();
  });

  getWidgetPrefs()
    .then((prefs) => {
      widgetPrefs = cloneWidgetPrefs(prefs);
      syncWidgetSettingsUi();
    })
    .catch(() => {});

  $("source-select").addEventListener("change", () => {
    selectedSource = ($("source-select") as HTMLSelectElement).value;
    updateDiagButtonVisibility();
    cpuHist.clear();
    netRxHist.clear();
    netTxHist.clear();
    netTotalHist.clear();
    coresBuilt = 0;
    lastCoreCount = 0;
    const cached = snapshotsBySource.get(selectedSource);
    if (cached) applySnapshot(cached);
  });

  window.addEventListener("resize", () => {
    if (lastCoreCount > 0) layoutCores(lastCoreCount);
  });

  $("add-server-btn").addEventListener("click", () => openModal());
  $("modal-cancel").addEventListener("click", () => closeModal());
  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => closeModal());
  });

  $("modal-back").addEventListener("click", () => setModalStep(modalStep - 1));

  $("modal-next").addEventListener("click", async () => {
    const form = readForm();
    if (!form) {
      const alias = ($("srv-alias") as HTMLInputElement).value.trim();
      if (alias.length > ALIAS_MAX_LEN) {
        alert(`Alias must be at most ${ALIAS_MAX_LEN} characters.`);
      } else {
        alert("Alias, host, and user are required.");
      }
      return;
    }
    if (modalStep === 1) {
      fillSetupCommands();
      await refreshSetupInfo();
      setModalStep(2);
    } else if (modalStep === 2) {
      setModalStep(3);
    }
  });

  document.querySelectorAll("[data-shell-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-shell-tab")!;
      document.querySelectorAll("[data-shell-tab]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll("[data-shell-panel]").forEach((p) => {
        p.classList.toggle("hidden", p.getAttribute("data-shell-panel") !== tab);
      });
    });
  });

  document.querySelectorAll(".copy-cmd").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-copy")!;
      const text = $(id).textContent ?? "";
      copyText(text).catch(() => {});
    });
  });

  $("copy-pubkey").addEventListener("click", () => {
    if (setupInfo?.public_key) copyText(setupInfo.public_key).catch(() => {});
  });

  $("test-server-btn").addEventListener("click", async () => {
    const form = readForm();
    if (!form) return;
    const result = $("test-result");
    result.textContent = "Testing…";
    result.className = "test-result";
    const r = await testServer(form);
    if (r.ok) {
      result.textContent = `Connected — ${r.os ?? "?"} — ${r.hostname ?? "?"} (${r.latency_ms}ms)`;
      result.className = "test-result ok";
    } else {
      result.textContent = r.message;
      result.className = "test-result err";
    }
  });

  $("test-diag-btn").addEventListener("click", async () => {
    const form = readForm();
    if (!form) return;
    await runDiagnostics(form, form.alias);
  });

  $("diag-btn").addEventListener("click", () => {
    const server = serverForSelectedSource();
    if (!server) return;
    diagLogLines = [];
    appendDiag(`--- ${server.alias} ---`);
    renderDiagStatusForSource(server.alias);
    openDiagPanel(`Diagnostics — ${server.alias}`);
  });

  $("diag-close").addEventListener("click", () => closeDiagPanel());

  $("diag-run").addEventListener("click", async () => {
    const server = serverForSelectedSource() ?? readForm();
    if (!server) return;
    await runDiagnostics(server, server.alias);
  });

  $("diag-copy").addEventListener("click", () => {
    copyText($("diag-log").textContent ?? "").catch(() => {});
  });

  listen<SourceStatus>("source-status", (e) => {
    const st = e.payload;
    sourceStatusBySource.set(st.source, st);
    if (st.source === selectedSource && !$("diag-panel").classList.contains("hidden")) {
      const tag = st.ok ? "OK" : "ERR";
      appendDiag(`[${formatTime(st.ts_ms)}] ${tag}  ${st.message}`);
    }
  });

  $("modal-save").addEventListener("click", async () => {
    const form = readForm();
    if (!form) return;
    try {
      await addServer(form);
      await loadServersList();
      closeModal();
    } catch (e) {
      alert(String(e));
    }
  });

  listen<Snapshot>("metrics", (e) => applySnapshot(e.payload));

  setInterval(() => {
    const ts = lastUpdateBySource.get(selectedSource) ?? 0;
    const stale = ts > 0 && isStale(ts, Date.now());
    $("status-dot").className = "dot" + (stale ? " err" : ts > 0 ? "" : " warn");
    $("status-text").textContent = ts === 0 ? "waiting" : stale ? "stale" : "live";
  }, 1000);

  loadServersList().catch(() => {});
}

// =====================================================================
function setSegmentUsage(seg: HTMLElement, pct: number) {
  seg.classList.remove("usage-ok", "usage-warn", "usage-err");
  seg.classList.add(`usage-${segmentLevel(pct)}`);
}

//  WIDGET WINDOW
// =====================================================================
function renderWidget(root: HTMLElement) {
  document.body.classList.add("widget-mode");
  root.classList.add("widget-root");
  root.innerHTML = `
    <div class="widget-wrap" id="widget-wrap">
      <div class="widget-stack" id="widget-stack"></div>
    </div>
    <div class="widget-context-menu hidden" id="widget-ctx-menu" role="menu" aria-hidden="true"></div>`;

  const wrap = document.getElementById("widget-wrap")!;
  const stack = document.getElementById("widget-stack")!;
  const ctxMenu = document.getElementById("widget-ctx-menu")!;
  const win = getCurrentWindow();
  const knownSources = new Set<string>();
  let widgetPrefs: WidgetPrefs = cloneWidgetPrefs(DEFAULT_WIDGET_PREFS);
  let ctxMenuOpen = false;

  function measureWindowSize(): { w: number; h: number } {
    const stripW = Math.ceil(wrap.scrollWidth + 8);
    const stripH = Math.ceil(measureStackHeight() + 4);
    if (!ctxMenuOpen || ctxMenu.classList.contains("hidden")) {
      return { w: stripW, h: stripH };
    }
    const menuRect = ctxMenu.getBoundingClientRect();
    return {
      w: Math.ceil(Math.max(stripW, menuRect.right + 8)),
      h: Math.ceil(Math.max(stripH, menuRect.bottom + 8)),
    };
  }

  function applyWindowSize() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const { w, h } = measureWindowSize();
        if (w > 0 && h > 0) {
          win.setSize(new LogicalSize(w, h)).catch(() => {});
        }
      });
    });
  }

  function hideCtxMenu() {
    ctxMenuOpen = false;
    ctxMenu.classList.add("hidden");
    ctxMenu.setAttribute("aria-hidden", "true");
    applyWindowSize();
  }

  function fillCtxMenu(mainOpen: boolean) {
    ctxMenu.innerHTML = mainOpen
      ? `<button type="button" data-ctx="hide" role="menuitem">Hide widget</button>
         <button type="button" data-ctx="quit" class="danger" role="menuitem">Quit WatchPost</button>`
      : `<button type="button" data-ctx="open" role="menuitem">Open App</button>
         <button type="button" data-ctx="close" class="danger" role="menuitem">Close</button>`;
  }

  function positionCtxMenu(x: number, y: number) {
    const pad = 8;
    const w = ctxMenu.offsetWidth || 148;
    const h = ctxMenu.offsetHeight || 64;
    let left = x;
    let top = y;
    if (y + h + pad > window.innerHeight || y > window.innerHeight / 2) {
      top = Math.max(pad, y - h);
    }
    left = Math.min(Math.max(pad, left), Math.max(pad, window.innerWidth - w - pad));
    top = Math.min(Math.max(pad, top), Math.max(pad, window.innerHeight - h - pad));
    ctxMenu.style.left = `${left}px`;
    ctxMenu.style.top = `${top}px`;
  }

  async function showCtxMenu(x: number, y: number) {
    const mainOpen = await invoke<boolean>("is_main_visible").catch(() => false);
    fillCtxMenu(mainOpen);
    ctxMenuOpen = true;
    ctxMenu.classList.remove("hidden");
    ctxMenu.setAttribute("aria-hidden", "false");
    positionCtxMenu(x, y);
    applyWindowSize();
  }

  stack.addEventListener("contextmenu", (e) => {
    if (!(e.target as HTMLElement).closest(".widget-strip")) return;
    e.preventDefault();
    showCtxMenu(e.clientX, e.clientY).catch(() => {});
  });

  ctxMenu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-ctx]");
    if (!btn) return;
    const action = btn.getAttribute("data-ctx");
    hideCtxMenu();
    switch (action) {
      case "hide":
        invoke("hide_widget").catch(() => {});
        break;
      case "quit":
        invoke("quit_app").catch(() => {});
        break;
      case "open":
        invoke("show_main_window").catch(() => {});
        break;
      case "close":
        // Main is hidden — hiding the widget quits the app (M3c).
        invoke("hide_widget").catch(() => {});
        break;
    }
  });

  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || ctxMenu.classList.contains("hidden")) return;
    if (!ctxMenu.contains(e.target as Node)) hideCtxMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideCtxMenu();
  });

  stack.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest(".widget-strip")) {
      invoke("show_main_window").catch(() => {});
    }
  });

  function syncNameColumnWidth(labels: string[]) {
    const cols = Math.min(
      ALIAS_MAX_LEN,
      Math.max(1, ...labels.map((l) => l.length)),
    );
    stack.style.setProperty("--name-cols", String(cols));
  }

  function measureStackHeight(): number {
    const strips = stack.querySelectorAll(".widget-strip");
    if (strips.length === 0) return 0;
    const measured = Math.ceil(stack.getBoundingClientRect().height);
    if (measured > 0) return measured;
    // Fallback when the window is hidden and layout reports 0.
    const rowH = 34;
    const gap = 4;
    return strips.length * rowH + Math.max(0, strips.length - 1) * gap;
  }

  function fitWindow() {
    applyWindowSize();
  }

  function rebuildStack(sources: { source: string; label: string }[]) {
    const displayLabels = sources.map((s) => widgetDisplayLabel(s.source, s.label));
    syncNameColumnWidth(displayLabels);
    stack.innerHTML = sources
      .map((s) =>
        widgetStripHtml(
          s.source,
          widgetDisplayLabel(s.source, s.label),
          widgetPrefs.segments,
          widgetPrefs.display,
        ),
      )
      .join("");
    knownSources.clear();
    for (const s of sources) knownSources.add(s.source);
    for (const [source, snap] of snapshotsBySource) {
      if (knownSources.has(source)) updateRow(source, snap);
    }
    fitWindow();
  }

  async function refreshSources() {
    const servers = await listServers().catch(() => [] as ServerEntry[]);
    const sources = [
      { source: "local", label: "Local" },
      ...servers.map((s) => ({ source: s.alias, label: s.alias })),
    ];
    rebuildStack(sources);
  }

  function updateRow(source: string, s: Snapshot) {
    const strip = stack.querySelector<HTMLElement>(`.widget-strip[data-source="${CSS.escape(source)}"]`);
    if (!strip) return;
    const hostEl = strip.querySelector(".w-host") as HTMLElement;
    const label = widgetDisplayLabel(source, source);
    hostEl.textContent = label;
    hostEl.title = source === "local" ? s.hostname : `${source} — ${s.hostname}`;

    const cpuSeg = strip.querySelector(".seg-cpu");
    if (cpuSeg) {
      const cpu = Math.round(s.cpu_usage);
      const cpuEl = strip.querySelector(".w-cpu");
      if (cpuEl) cpuEl.textContent = `${cpu}%`;
      const cpuBar = strip.querySelector(".w-cpu-bar") as HTMLElement | null;
      if (cpuBar) cpuBar.style.width = `${s.cpu_usage}%`;
      setSegmentUsage(cpuSeg as HTMLElement, s.cpu_usage);
    }

    const memSeg = strip.querySelector(".seg-mem");
    if (memSeg) {
      const memPct = s.mem_total ? (s.mem_used / s.mem_total) * 100 : 0;
      const memEl = strip.querySelector(".w-mem");
      if (memEl) memEl.textContent = `${Math.round(memPct)}%`;
      const memBar = strip.querySelector(".w-mem-bar") as HTMLElement | null;
      if (memBar) memBar.style.width = `${memPct}%`;
      setSegmentUsage(memSeg as HTMLElement, memPct);
    }

    const rxEl = strip.querySelector(".w-rx");
    if (rxEl) {
      rxEl.textContent = `↓ ${fmtRate(s.net_rx_bps)}`;
      strip.querySelector(".w-tx")!.textContent = `↑ ${fmtRate(s.net_tx_bps)}`;
    }

    const diskSeg = strip.querySelector(".seg-disk");
    if (diskSeg) {
      const disk = primaryDisk(s.disks);
      const diskEl = strip.querySelector(".w-disk");
      const diskBar = strip.querySelector(".w-disk-bar") as HTMLElement | null;
      if (disk && disk.total > 0) {
        const used = disk.total - disk.available;
        const diskPct = diskUsedPct(disk.total, disk.available);
        if (diskEl) diskEl.textContent = fmtDiskUsage(used, disk.total);
        if (diskBar) diskBar.style.width = `${diskPct}%`;
        setSegmentUsage(diskSeg as HTMLElement, diskPct);
      } else {
        if (diskEl) diskEl.textContent = "–";
        if (diskBar) diskBar.style.width = "0%";
        diskSeg.classList.remove("usage-ok", "usage-warn", "usage-err");
      }
    }

    const usersEl = strip.querySelector(".w-users");
    if (usersEl) {
      usersEl.textContent = fmtUsers(s.active_users ?? 0);
    }

    fitWindow();
  }

  function onMetrics(s: Snapshot) {
    snapshotsBySource.set(s.source, s);
    lastUpdateBySource.set(s.source, Date.now());
    if (!knownSources.has(s.source)) {
      refreshSources().catch(() => {});
      return;
    }
    updateRow(s.source, s);
  }

  listen<Snapshot>("metrics", (e) => onMetrics(e.payload));

  listen("servers-changed", () => {
    refreshSources().catch(() => {});
  });

  listen("widget-shown", () => {
    refreshSources()
      .catch(() => {})
      .finally(() => fitWindow());
  });

  listen<WidgetPrefs>("widget-prefs-changed", (e) => {
    widgetPrefs = cloneWidgetPrefs(e.payload);
    refreshSources().catch(() => {});
  });

  getWidgetPrefs()
    .then((prefs) => {
      widgetPrefs = cloneWidgetPrefs(prefs);
      refreshSources().catch(() => {});
    })
    .catch(() => {});

  win.onFocusChanged(({ payload: focused }) => {
    if (focused) {
      refreshSources()
        .catch(() => {})
        .finally(() => fitWindow());
    }
  });

  setInterval(() => {
    const now = Date.now();
    stack.querySelectorAll<HTMLElement>(".widget-strip").forEach((strip) => {
      const source = strip.getAttribute("data-source") ?? "";
      const ts = lastUpdateBySource.get(source) ?? 0;
      const connecting = ts === 0;
      const stale = ts > 0 && isStale(ts, now);
      const dot = strip.querySelector(".w-dot");
      if (dot) dot.className = "dot w-dot" + (stale ? " err" : connecting ? " warn" : "");
      // connecting (never received) = yellow tint; lost (was live, now stale) = red tint.
      strip.classList.toggle("connecting", connecting);
      strip.classList.toggle("stale", stale);
    });
    fitWindow();
  }, 1000);

  refreshSources().catch(() => {});
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
