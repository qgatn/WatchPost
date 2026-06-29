import {
  canDisableSegment,
  DISPLAY_SEGMENT_KEYS,
  DISPLAY_SEGMENT_LABELS,
  stackModeHint,
  type DisplaySegmentKey,
  type MetricDisplay,
  type MetricSegmentKey,
  type StackMode,
  type WidgetPrefs,
} from "./widgetPrefs";

/** Shared widget-settings body (main app tab + widget overlay). */
export function widgetSettingsBodyHtml(): string {
  return `
    <div class="settings-section">
      <h3>Widget position</h3>
      <div class="seg-control wset-stack-mode" role="radiogroup" aria-label="Widget position">
        <button type="button" class="seg-opt" data-stack="behind">Behind</button>
        <button type="button" class="seg-opt" data-stack="normal">Normal</button>
        <button type="button" class="seg-opt" data-stack="on_top">On top</button>
      </div>
      <p class="modal-hint wset-stack-hint"></p>
    </div>
    <div class="settings-section">
      <h3>Actions</h3>
      <div class="checkbox-grid checkbox-grid-single">
        <label><input type="checkbox" class="wset-show-ssh" /> Show SSH button on remote servers</label>
      </div>
      <p class="modal-hint">Adds a small button on the left of each remote server strip to open SSH.</p>
    </div>
    <div class="settings-section">
      <h3>Show on widget</h3>
      <div class="checkbox-grid wset-segments">
        <label><input type="checkbox" data-seg="cpu" /> CPU</label>
        <label><input type="checkbox" data-seg="mem" /> Memory</label>
        <label><input type="checkbox" data-seg="disk" /> Disk</label>
        <label><input type="checkbox" data-seg="net" /> Network</label>
        <label><input type="checkbox" data-seg="users" /> Users</label>
      </div>
    </div>
    <div class="settings-section">
      <h3>Metric style</h3>
      <p class="modal-hint">CPU and memory show as percent. Storage can show used/total, a bar, or both.</p>
      <div class="display-style-list wset-display">
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
    </div>`;
}

export function syncWidgetSettingsInContainer(container: HTMLElement, prefs: WidgetPrefs): void {
  const hint = container.querySelector<HTMLElement>(".wset-stack-hint");
  if (hint) hint.textContent = stackModeHint(prefs.stack_mode);

  container.querySelectorAll<HTMLButtonElement>(".wset-stack-mode .seg-opt").forEach((btn) => {
    const mode = btn.getAttribute("data-stack") as StackMode;
    const active = mode === prefs.stack_mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-checked", active ? "true" : "false");
  });

  const sshInput = container.querySelector<HTMLInputElement>(".wset-show-ssh");
  if (sshInput) sshInput.checked = prefs.show_ssh_button;

  container.querySelectorAll<HTMLInputElement>(".wset-segments input[data-seg]").forEach((input) => {
    const key = input.getAttribute("data-seg") as MetricSegmentKey;
    input.checked = prefs.segments[key];
    input.disabled = !canDisableSegment(prefs.segments, key);
  });

  container.querySelectorAll<HTMLButtonElement>(".wset-display [data-display][data-mode]").forEach((btn) => {
    const key = btn.getAttribute("data-display") as DisplaySegmentKey;
    const mode = btn.getAttribute("data-mode") as MetricDisplay;
    btn.classList.toggle("active", prefs.display[key] === mode);
    btn.setAttribute("aria-checked", prefs.display[key] === mode ? "true" : "false");
  });

  container.querySelectorAll<HTMLElement>(".wset-display [data-display-row]").forEach((row) => {
    const key = row.getAttribute("data-display-row") as DisplaySegmentKey;
    row.classList.toggle("disabled", !prefs.segments[key]);
  });
}

export function bindWidgetSettingsInContainer(
  container: HTMLElement,
  getPrefs: () => WidgetPrefs,
  applyPrefs: (prefs: WidgetPrefs) => void | Promise<void>,
): void {
  container.querySelectorAll<HTMLButtonElement>(".wset-stack-mode .seg-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.getAttribute("data-stack") as StackMode;
      void applyPrefs({ ...getPrefs(), stack_mode: mode });
    });
  });

  container.querySelector<HTMLInputElement>(".wset-show-ssh")?.addEventListener("change", () => {
    const input = container.querySelector<HTMLInputElement>(".wset-show-ssh")!;
    void applyPrefs({ ...getPrefs(), show_ssh_button: input.checked });
  });

  container.querySelectorAll<HTMLInputElement>(".wset-segments input[data-seg]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.getAttribute("data-seg") as MetricSegmentKey;
      const next = { ...getPrefs().segments, [key]: input.checked };
      if (!Object.values(next).some(Boolean)) {
        input.checked = getPrefs().segments[key];
        return;
      }
      void applyPrefs({ ...getPrefs(), segments: next });
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".wset-display [data-display][data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-display") as DisplaySegmentKey;
      const mode = btn.getAttribute("data-mode") as MetricDisplay;
      if (!getPrefs().segments[key]) return;
      void applyPrefs({
        ...getPrefs(),
        display: { ...getPrefs().display, [key]: mode },
      });
    });
  });
}
