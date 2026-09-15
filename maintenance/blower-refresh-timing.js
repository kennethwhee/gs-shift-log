/* BLOWER_REFRESH_TIMING_V1: optional, memory-only observation; no network or storage. */
(function (root) {
  "use strict";
  try {
    if (root.BlowerRefreshTiming) return;
    const PHASES = new Set(["workLogs", "createRequests", "waitResults", "applyResults"]);
    const COUNTS = ["targetCount", "requestCount", "completedCount", "failedCount", "pollCount", "retryCount"];
    const TERMINAL = new Set(["complete", "partial", "failed"]);
    const PHASE_STATUS = new Set(["complete", "partial", "failed", "interrupted", "unknown"]);
    const records = [], pending = new Set();
    const noop = Object.freeze({ end: function () {} });
    let active = null, candidate = null, candidateTimer = null, serial = 0;
    let statusNode = null, observer = null, label = null, downloadButton = null;
    let stopped = false, installed = false, lastMono = 0, lastDate = null, usedFallback = false;
    const safe = function (fn, fallback) { try { return fn(); } catch (_) { return fallback; } };
    function now() {
      const wall = safe(() => Date.now(), lastDate === null ? 0 : lastDate);
      let value = safe(() => root.performance.now(), NaN);
      if (!Number.isFinite(value)) {
        usedFallback = true;
        value = lastMono + (lastDate === null ? 0 : Math.max(0, wall - lastDate));
      }
      lastMono = Math.max(lastMono, value);
      lastDate = wall;
      return lastMono;
    }
    function counts(meta) {
      const out = {};
      if (!meta || typeof meta !== "object") return out;
      for (const key of COUNTS) {
        const value = safe(() => meta[key], undefined);
        if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1e9) out[key] = Math.floor(value);
      }
      return out;
    }
    function clearTimer(id, interval) {
      if (id !== null && id !== undefined) safe(() => interval ? root.clearInterval(id) : root.clearTimeout(id));
    }
    function discardCandidate() {
      candidate = null;
      clearTimer(candidateTimer, false);
      candidateTimer = null;
    }
    function state() { return safe(() => statusNode.dataset.state, ""); }
    function background(rec) { if (safe(() => root.document.hidden, false)) rec.backgroundObserved = true; }
    function view(rec, moment) {
      const elapsed = Math.max(0, (rec.endAt === null ? moment : rec.endAt) - rec.startAt);
      return {
        sequence: rec.sequence,
        startedAt: rec.startedAt,
        startSource: rec.startSource,
        status: rec.status,
        totalMs: Math.round(elapsed),
        terminalObservedMs: rec.terminalAt === null ? null : Math.round(Math.max(0, rec.terminalAt - rec.startAt)),
        renderCheckpoint: rec.checkpoint,
        backgroundObserved: rec.backgroundObserved,
        clock: usedFallback ? "Date.now fallback, monotonic-clamped" : "performance.now",
        droppedPhaseCount: rec.droppedPhaseCount,
        phases: rec.phases.map(p => ({
          name: p.name, status: p.status,
          startOffsetMs: Math.round(Math.max(0, p.startAt - rec.startAt)),
          durationMs: Math.round(Math.max(0, (p.endAt === null ? (rec.endAt === null ? moment : rec.endAt) : p.endAt) - p.startAt)),
          ...p.metadata
        }))
      };
    }
    function exportRecords() {
      return safe(() => ({
        schemaVersion: "blower-refresh-timing-v1",
        measurementBasis: "Accepted refresh-button click to terminal DOM state followed by requestAnimationFrame or bounded timer fallback. This is a screen-refresh checkpoint, not proof of physical paint. Runs without an accepted click start at running-state observation. Background-tab scheduling is included. In-memory only; latest five runs.",
        records: records.map(rec => view(rec, now()))
      }), { schemaVersion: "blower-refresh-timing-v1", records: [] });
    }
    function download() {
      safe(() => {
        if (!records.length) return;
        const blob = new root.Blob([JSON.stringify(exportRecords(), null, 2)], { type: "application/json" });
        const url = root.URL.createObjectURL(blob);
        try {
          const a = root.document.createElement("a");
          a.href = url;
          a.download = "blower-screen-timing-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
          root.document.body.appendChild(a);
          try { a.click(); } finally { a.remove(); }
        } finally {
          // Delay revocation until the browser has consumed the download URL.
          safe(() => root.setTimeout(() => safe(() => root.URL.revokeObjectURL(url)), 1000));
        }
      });
    }
    function mount() {
      if (label && label.isConnected) return;
      const doc = root.document;
      const host = doc.querySelector(".overview-refresh-progress") || doc.getElementById("overviewRefreshPanel");
      if (!host) return;
      const row = doc.createElement("div");
      row.id = "blowerRefreshTimingRow";
      row.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-top:6px;max-width:100%;font-size:12px;";
      // Avoid announcing every half-second through the parent's live region.
      row.setAttribute("aria-live", "off");
      label = doc.createElement("span");
      label.id = "blowerRefreshElapsed";
      label.style.cssText = "min-width:0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums;";
      label.textContent = "조회 시간 · 대기";
      downloadButton = doc.createElement("button");
      downloadButton.type = "button";
      downloadButton.textContent = "측정 기록";
      downloadButton.disabled = records.length === 0;
      downloadButton.title = "이 페이지에서 측정한 최근 5회 기록 다운로드";
      downloadButton.style.cssText = "padding:2px 7px;font-size:11px;line-height:1.5;white-space:nowrap;";
      downloadButton.addEventListener("click", download);
      row.appendChild(label);
      row.appendChild(downloadButton);
      host.appendChild(row);
    }
    function draw(rec) {
      safe(() => {
        if (rec && rec.sequence !== serial) return;
        mount();
        if (!rec || !label) return;
        const seconds = Math.max(0, (rec.endAt === null ? now() : rec.endAt) - rec.startAt) / 1000;
        const duration = seconds >= 60 ? Math.floor(seconds / 60) + "분 " + (seconds % 60).toFixed(1) + "초" : seconds.toFixed(1) + "초";
        const names = { running: "경과", rendering: "화면 반영", complete: "완료", partial: "부분 완료", failed: "실패", interrupted: "중단" };
        label.textContent = "화면 갱신 기준 · " + (names[rec.status] || "측정") + " " + duration;
        if (downloadButton) downloadButton.disabled = false;
      });
    }
    function beginRun(observedRunning) {
      if (active || stopped || (state() !== "running" && observedRunning !== true)) return active;
      const moment = now();
      const click = candidate && moment - candidate.at <= 2000 ? candidate : null;
      const rec = {
        sequence: ++serial, startAt: click ? click.at : moment,
        startedAt: click ? click.wall : safe(() => new Date().toISOString(), null),
        startSource: click ? "accepted_click" : "running_state",
        status: "running", endAt: null, terminalAt: null, checkpoint: null,
        phases: [], droppedPhaseCount: 0, backgroundObserved: false,
        interval: null, raf: null, fallbackTimer: null
      };
      discardCandidate();
      active = rec;
      records.push(rec);
      if (records.length > 5) records.shift();
      background(rec);
      draw(rec);
      rec.interval = safe(() => root.setInterval(() => safe(() => { background(rec); syncState(state()); draw(rec); }), 500), null);
      return rec;
    }
    function finalize(rec, outcome, checkpoint) {
      if (rec.endAt !== null) return;
      rec.endAt = now();
      rec.status = outcome;
      rec.checkpoint = checkpoint;
      background(rec);
      for (const p of rec.phases) {
        if (p.endAt === null) { p.endAt = rec.endAt; p.status = "interrupted"; }
      }
      clearTimer(rec.interval, true);
      clearTimer(rec.fallbackTimer, false);
      if (rec.raf !== null) safe(() => root.cancelAnimationFrame(rec.raf));
      rec.interval = rec.fallbackTimer = rec.raf = null;
      pending.delete(rec);
      if (active === rec) active = null;
      draw(rec);
    }
    function terminal(outcome) {
      const rec = active;
      if (!rec || rec.status !== "running") return;
      rec.terminalAt = now();
      rec.status = "rendering";
      active = null;
      pending.add(rec);
      clearTimer(rec.interval, true);
      rec.interval = null;
      draw(rec);
      rec.fallbackTimer = safe(() => root.setTimeout(() => safe(() => finalize(rec, outcome, "timer_fallback")), 300), null);
      rec.raf = safe(() => root.requestAnimationFrame(() => safe(() => finalize(rec, outcome, "animation_frame"))), null);
      if (rec.fallbackTimer === null && rec.raf === null) finalize(rec, "interrupted", "render_scheduler_unavailable");
    }
    function syncState(value) {
      if (value === "running") beginRun(true);
      else if (TERMINAL.has(value)) terminal(value);
    }
    function beginPhase(name, metadata) {
      return safe(() => {
        if (!PHASES.has(name) || stopped) return noop;
        // Business code can reach this before MutationObserver delivery.
        if (state() === "running") beginRun();
        const rec = active;
        if (!rec) return noop;
        if (rec.phases.length >= 128) { rec.droppedPhaseCount++; return noop; }
        const phase = { name, status: "running", startAt: now(), endAt: null, metadata: counts(metadata) };
        rec.phases.push(phase);
        return { end: function (status, meta) {
          safe(() => {
            if (phase.endAt !== null) return;
            phase.endAt = now();
            phase.status = PHASE_STATUS.has(status) ? status : "unknown";
            Object.assign(phase.metadata, counts(meta));
          });
        } };
      }, noop);
    }
    function click(event) {
      safe(() => {
        const button = root.document.getElementById("refreshButton");
        if (!button || !button.contains(event.target) || button.disabled || active || state() === "running" || stopped) return;
        discardCandidate();
        candidate = { at: now(), wall: safe(() => new Date().toISOString(), null) };
        candidateTimer = safe(() => root.setTimeout(discardCandidate, 2000), null);
        // A click alone never creates a run or changes the elapsed-time label.
      });
    }
    function pagehide() {
      safe(() => {
        stopped = true;
        discardCandidate();
        if (active) finalize(active, "interrupted", "pagehide");
        for (const rec of Array.from(pending)) finalize(rec, "interrupted", "pagehide");
      });
    }
    function install() {
      safe(() => {
        if (installed) return;
        installed = true;
        statusNode = root.document.getElementById("unifiedRefreshStatus");
        safe(mount);
        root.document.addEventListener("click", click, true);
        root.addEventListener("pagehide", pagehide);
        root.addEventListener("pageshow", () => { stopped = false; });
        root.document.addEventListener("visibilitychange", () => safe(() => { if (active) background(active); }));
        if (statusNode && typeof root.MutationObserver === "function") {
          observer = new root.MutationObserver(changes => safe(() => {
            // Preserve fast running -> terminal transitions in one microtask.
            const mutations = changes.filter(x => x.attributeName === "data-state");
            for (let i = 0; i < mutations.length; i++) {
              const value = i + 1 < mutations.length ? mutations[i + 1].oldValue : state();
              syncState(value);
            }
          }));
          observer.observe(statusNode, { attributes: true, attributeFilter: ["data-state"], attributeOldValue: true });
        }
        syncState(state());
      });
    }
    root.BlowerRefreshTiming = Object.freeze({ beginPhase, exportRecords });
    if (root.document) {
      if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", install, { once: true });
      else install();
    }
  } catch (_) { /* Optional diagnostics must never interrupt refresh behavior. */ }
})(typeof globalThis === "object" ? globalThis : window);
