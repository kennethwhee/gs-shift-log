/*
 * GS Morning Meeting Date Navigation Diagnostic V1
 * Diagnostic only:
 * - no fetch interception
 * - no source/query behavior changes
 * - no storage/database writes
 * - observes one date-navigation interaction for 8 seconds
 */
(function installMorningMeetingDateNavDiagnostic(root) {
  "use strict";

  const VERSION = "20261003-v1-r3";
  const WINDOW_MS = 8000;
  const DRIFT_INTERVAL_MS = 100;
  const PANEL_ID = "efficiencyMorningMeetingWaterPanel";
  const OVERLAY_ID = "morningMeetingDateNavDiagnosticOverlay";

  if (!root || !root.document) return;
  if (root.__morningMeetingDateNavDiagnostic?.version === VERSION) return;

  const doc = root.document;
  let active = null;
  let lastReport = "";
  let sessionSeq = 0;

  const TRIGGER_IDS = new Set([
    "efficiencyMorningMeetingLimestonePreviousButton",
    "efficiencyMorningMeetingLimestoneTodayButton",
    "efficiencyMorningMeetingLimestoneNextButton",
    "efficiencyMorningMeetingAutoDatePicker"
  ]);

  function now() {
    return root.performance?.now?.() ?? Date.now();
  }

  function text(value) {
    return String(value ?? "").trim();
  }

  function round(value) {
    return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  }

  function safeUrl(value) {
    try {
      const parsed = new URL(value, root.location.href);
      return parsed.pathname + parsed.search;
    } catch {
      return String(value || "");
    }
  }

  function targetDate() {
    const panel = doc.getElementById(PANEL_ID);
    return text(panel?.dataset?.morningMeetingAutoBaseDate);
  }

  function getTrigger(event) {
    const target = event?.target;
    if (!target) return null;

    if (TRIGGER_IDS.has(target.id)) return target;

    const closest = target.closest?.(
      "#efficiencyMorningMeetingLimestonePreviousButton," +
      "#efficiencyMorningMeetingLimestoneTodayButton," +
      "#efficiencyMorningMeetingLimestoneNextButton," +
      "#efficiencyMorningMeetingAutoDatePicker"
    );

    return closest || null;
  }

  function ensureOverlay() {
    let overlay = doc.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = doc.createElement("section");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("aria-live", "polite");
    overlay.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483646",
      "width:min(620px,calc(100vw - 32px))",
      "max-height:70vh",
      "overflow:auto",
      "background:#111827",
      "color:#f9fafb",
      "border:1px solid rgba(255,255,255,.18)",
      "border-radius:12px",
      "box-shadow:0 18px 48px rgba(0,0,0,.35)",
      "padding:12px",
      "font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace",
      "display:none"
    ].join(";");

    overlay.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <strong style="font:600 13px/1.2 system-ui,sans-serif;flex:1">
          날짜 이동 진단
        </strong>
        <button type="button" data-action="copy"
          style="border:0;border-radius:7px;padding:6px 9px;cursor:pointer">
          결과 복사
        </button>
        <button type="button" data-action="close"
          style="border:0;border-radius:7px;padding:6px 9px;cursor:pointer">
          닫기
        </button>
      </div>
      <div data-role="state"
        style="font:600 12px/1.4 system-ui,sans-serif;margin-bottom:8px"></div>
      <pre data-role="report"
        style="white-space:pre-wrap;word-break:break-word;margin:0"></pre>
    `;

    overlay.addEventListener("click", async event => {
      const action = event.target?.dataset?.action;
      if (action === "close") {
        overlay.style.display = "none";
        return;
      }

      if (action === "copy") {
        try {
          await root.navigator.clipboard.writeText(lastReport || "");
          event.target.textContent = "복사됨";
          root.setTimeout(() => {
            event.target.textContent = "결과 복사";
          }, 1200);
        } catch {
          const report = overlay.querySelector('[data-role="report"]');
          const range = doc.createRange();
          range.selectNodeContents(report);
          const selection = root.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });

    doc.body.appendChild(overlay);
    return overlay;
  }

  function setOverlayState(label, report = "") {
    const overlay = ensureOverlay();
    overlay.style.display = "block";
    overlay.querySelector('[data-role="state"]').textContent = label;
    overlay.querySelector('[data-role="report"]').textContent = report;
  }

  function startObservers(session) {
    const panel = doc.getElementById(PANEL_ID);

    if (panel) {
      session.mutationObserver = new MutationObserver(records => {
        if (!active || active.id !== session.id) return;

        session.mutationBatches += 1;
        session.mutationRecords += records.length;
        session.maxMutationBatch = Math.max(
          session.maxMutationBatch,
          records.length
        );

        for (const record of records) {
          if (record.type === "attributes") session.mutationAttributes += 1;
          else if (record.type === "childList") session.mutationChildList += 1;
          else if (record.type === "characterData") session.mutationCharacter += 1;

          if (
            record.type === "attributes" &&
            record.target === panel &&
            record.attributeName === "data-morning-meeting-auto-base-date"
          ) {
            session.dateMutationAt = round(now() - session.startPerf);
            session.toDate = targetDate();
          }
        }
      });

      session.mutationObserver.observe(panel, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          "data-morning-meeting-auto-base-date",
          "class",
          "data-source",
          "data-steam-source",
          "data-status"
        ]
      });
    }

    if (root.PerformanceObserver) {
      const supported =
        root.PerformanceObserver.supportedEntryTypes || [];

      if (supported.includes("longtask")) {
        session.longTaskObserver = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.startTime < session.startPerf) continue;
            session.longTasks.push({
              at: round(entry.startTime - session.startPerf),
              duration: round(entry.duration)
            });
          }
        });

        session.longTaskObserver.observe({
          type: "longtask",
          buffered: true
        });
      }

      if (supported.includes("long-animation-frame")) {
        session.loafObserver = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.startTime < session.startPerf) continue;

            const scripts = Array.from(entry.scripts || [])
              .map(script => ({
                url: safeUrl(script.sourceURL || ""),
                fn: text(script.sourceFunctionName || script.invoker || "(anonymous)"),
                duration: round(script.duration),
                forcedLayout: round(script.forcedStyleAndLayoutDuration || 0)
              }))
              .sort((a, b) => (b.duration || 0) - (a.duration || 0))
              .slice(0, 8);

            session.longFrames.push({
              at: round(entry.startTime - session.startPerf),
              duration: round(entry.duration),
              blocking: round(entry.blockingDuration || 0),
              render: round(entry.renderStart ? entry.duration - (entry.renderStart - entry.startTime) : 0),
              scripts
            });
          }
        });

        session.loafObserver.observe({
          type: "long-animation-frame",
          buffered: true
        });
      }

      if (supported.includes("resource")) {
        session.resourceObserver = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.startTime < session.startPerf) continue;
            const url = safeUrl(entry.name);

            if (
              !url.includes("/api/") &&
              !url.includes("ois") &&
              !url.includes("morning") &&
              !url.includes("cofiring")
            ) {
              continue;
            }

            session.resources.push({
              url,
              at: round(entry.startTime - session.startPerf),
              duration: round(entry.duration),
              responseStart: round(entry.responseStart - session.startPerf),
              responseEnd: round(entry.responseEnd - session.startPerf),
              transferSize: Number(entry.transferSize || 0)
            });
          }
        });

        session.resourceObserver.observe({
          type: "resource",
          buffered: true
        });
      }
    }
  }

  function startDriftProbe(session) {
    let expected = now() + DRIFT_INTERVAL_MS;

    session.driftTimer = root.setInterval(() => {
      if (!active || active.id !== session.id) return;

      const current = now();
      const drift = current - expected;

      session.maxTimerDrift = Math.max(
        session.maxTimerDrift,
        drift
      );

      if (drift > 40) {
        session.timerDrifts.push({
          at: round(current - session.startPerf),
          drift: round(drift)
        });
      }

      expected = current + DRIFT_INTERVAL_MS;
    }, DRIFT_INTERVAL_MS);
  }

  function instrumentKnownGlobals(session) {
    const names = [
      "renderEfficiencyMorningMeetingAutoPreview",
      "renderEfficiencyMorningMeetingSteamStatus",
      "renderEfficiencyMorningMeetingDailyData",
      "renderEfficiencyMorningMeetingSmpPrice",
      "updateEfficiencyMorningMeetingCreateButton",
      "restoreEfficiencyMorningMeetingBoilerCache",
      "restoreEfficiencyMorningMeetingSiloCache"
    ];

    for (const name of names) {
      const original = root[name];
      if (typeof original !== "function") continue;

      try {
        const wrapped = function (...args) {
          const start = now();

          try {
            return Reflect.apply(original, this, args);
          } finally {
            const duration = now() - start;
            const item =
              session.functionTimings[name] ||
              {count: 0, total: 0, max: 0};

            item.count += 1;
            item.total += duration;
            item.max = Math.max(item.max, duration);
            session.functionTimings[name] = item;
          }
        };

        root[name] = wrapped;
        session.restoreFunctions.push(() => {
          if (root[name] === wrapped) root[name] = original;
        });
      } catch {
        // Diagnostic must never break the page if a property is non-writable.
      }
    }
  }

  function begin(event, trigger) {
    if (active) return;

    const startPerf = now();

    const session = {
      id: ++sessionSeq,
      triggerId: trigger.id || trigger.tagName,
      triggerType: event.type,
      startedAt: new Date().toISOString(),
      startPerf,
      fromDate: targetDate(),
      toDate: "",
      dateMutationAt: null,
      microtaskDelay: null,
      timeout0Delay: null,
      rafDelay: null,
      firstPaintDelay: null,
      maxTimerDrift: 0,
      timerDrifts: [],
      longTasks: [],
      longFrames: [],
      resources: [],
      mutationBatches: 0,
      mutationRecords: 0,
      mutationAttributes: 0,
      mutationChildList: 0,
      mutationCharacter: 0,
      maxMutationBatch: 0,
      functionTimings: {},
      restoreFunctions: [],
      mutationObserver: null,
      longTaskObserver: null,
      loafObserver: null,
      resourceObserver: null,
      driftTimer: null,
      finishTimer: null
    };

    active = session;

    setOverlayState(
      "진단 중 · 날짜를 한 번만 이동한 뒤 8초 동안 기다려 주세요.",
      `Trigger: ${session.triggerId}\nFrom: ${session.fromDate || "-"}`
    );

    startObservers(session);
    startDriftProbe(session);
    instrumentKnownGlobals(session);

    root.queueMicrotask(() => {
      if (active?.id !== session.id) return;
      session.microtaskDelay = round(now() - startPerf);
    });

    root.setTimeout(() => {
      if (active?.id !== session.id) return;
      session.timeout0Delay = round(now() - startPerf);
    }, 0);

    root.requestAnimationFrame(() => {
      if (active?.id !== session.id) return;
      session.rafDelay = round(now() - startPerf);

      root.requestAnimationFrame(() => {
        if (active?.id !== session.id) return;
        session.firstPaintDelay = round(now() - startPerf);
      });
    });

    session.finishTimer = root.setTimeout(
      () => finish(session),
      WINDOW_MS
    );
  }

  function classify(session) {
    const maxLongTask =
      Math.max(0, ...session.longTasks.map(item => item.duration || 0));

    const maxFrame =
      Math.max(0, ...session.longFrames.map(item => item.duration || 0));

    const maxResource =
      Math.max(0, ...session.resources.map(item => item.duration || 0));

    const mainBlock = Math.max(
      session.microtaskDelay || 0,
      session.rafDelay || 0,
      session.timeout0Delay || 0,
      session.maxTimerDrift || 0,
      maxLongTask,
      maxFrame
    );

    const domStorm =
      session.mutationRecords >= 1000 ||
      session.maxMutationBatch >= 500;

    if (mainBlock >= 1500 && maxResource >= 1500) {
      return "MIXED_MAIN_THREAD_AND_NETWORK";
    }

    if (mainBlock >= 1500) {
      return domStorm
        ? "MAIN_THREAD_BLOCK_WITH_DOM_STORM"
        : "MAIN_THREAD_BLOCK";
    }

    if (maxResource >= 1500) {
      return "NETWORK_WAIT";
    }

    if (domStorm) {
      return "DOM_MUTATION_STORM";
    }

    return "NO_CLEAR_5S_BLOCK_IN_THIS_SAMPLE";
  }

  function buildReport(session) {
    const lines = [];
    const maxLongTask =
      Math.max(0, ...session.longTasks.map(item => item.duration || 0));
    const totalLongTask =
      session.longTasks.reduce((sum, item) => sum + (item.duration || 0), 0);

    lines.push("[GS Morning Meeting Date Navigation Diagnostic V1]");
    lines.push(`Started: ${session.startedAt}`);
    lines.push(`Trigger: ${session.triggerType} / ${session.triggerId}`);
    lines.push(`Date: ${session.fromDate || "-"} -> ${session.toDate || targetDate() || "-"}`);
    lines.push(`Window: ${WINDOW_MS} ms`);
    lines.push("");

    lines.push("=== MAIN THREAD ===");
    lines.push(`event->microtask: ${session.microtaskDelay ?? "-"} ms`);
    lines.push(`event->setTimeout(0): ${session.timeout0Delay ?? "-"} ms`);
    lines.push(`event->1st rAF: ${session.rafDelay ?? "-"} ms`);
    lines.push(`event->2nd rAF: ${session.firstPaintDelay ?? "-"} ms`);
    lines.push(`max timer drift: ${round(session.maxTimerDrift)} ms`);
    lines.push(`long tasks: ${session.longTasks.length} / max ${round(maxLongTask)} ms / total ${round(totalLongTask)} ms`);
    lines.push(`long animation frames: ${session.longFrames.length}`);

    for (const [index, frame] of session.longFrames
      .slice()
      .sort((a, b) => (b.duration || 0) - (a.duration || 0))
      .slice(0, 6)
      .entries()) {
      lines.push(
        `  LoAF #${index + 1}: at ${frame.at} ms / ${frame.duration} ms / blocking ${frame.blocking} ms`
      );

      for (const script of frame.scripts || []) {
        lines.push(
          `    script ${script.duration} ms / layout ${script.forcedLayout} ms / ${script.fn} / ${script.url || "(inline)"}`
        );
      }
    }

    if (session.timerDrifts.length) {
      lines.push("  Timer drifts:");
      for (const item of session.timerDrifts.slice(0, 12)) {
        lines.push(`    at ${item.at} ms / +${item.drift} ms`);
      }
    }

    lines.push("");
    lines.push("=== KNOWN GLOBAL FUNCTIONS ===");

    const timings =
      Object.entries(session.functionTimings)
        .sort((a, b) => b[1].total - a[1].total);

    if (!timings.length) {
      lines.push("  (no wrapped global render function call captured)");
    } else {
      for (const [name, item] of timings) {
        lines.push(
          `  ${name}: ${item.count} calls / total ${round(item.total)} ms / max ${round(item.max)} ms`
        );
      }
    }

    lines.push("");
    lines.push("=== DOM ===");
    lines.push(`base-date mutation at: ${session.dateMutationAt ?? "-"} ms`);
    lines.push(`mutation batches: ${session.mutationBatches}`);
    lines.push(`mutation records: ${session.mutationRecords}`);
    lines.push(`  attributes: ${session.mutationAttributes}`);
    lines.push(`  childList: ${session.mutationChildList}`);
    lines.push(`  characterData: ${session.mutationCharacter}`);
    lines.push(`max mutation batch: ${session.maxMutationBatch}`);

    lines.push("");
    lines.push("=== NETWORK / RESOURCE TIMING ===");

    const resources =
      session.resources
        .slice()
        .sort((a, b) => (b.duration || 0) - (a.duration || 0));

    if (!resources.length) {
      lines.push("  (no matching API/resource timing captured)");
    } else {
      for (const item of resources.slice(0, 30)) {
        lines.push(
          `  ${item.duration} ms / start ${item.at} ms / end ${item.responseEnd} ms / ${item.url}`
        );
      }
    }

    lines.push("");
    lines.push("=== VERDICT ===");
    lines.push(classify(session));

    lines.push("");
    lines.push("Send this entire report back to ChatGPT.");

    return lines.join("\n");
  }

  function finish(session) {
    if (!active || active.id !== session.id) return;

    root.clearTimeout(session.finishTimer);
    root.clearInterval(session.driftTimer);

    for (const observer of [
      session.mutationObserver,
      session.longTaskObserver,
      session.loafObserver,
      session.resourceObserver
    ]) {
      try {
        observer?.disconnect?.();
      } catch {}
    }

    for (const restore of session.restoreFunctions) {
      try {
        restore();
      } catch {}
    }

    session.toDate ||= targetDate();

    lastReport = buildReport(session);
    active = null;

    setOverlayState(
      "진단 완료 · [결과 복사]를 눌러 전체 내용을 보내주세요.",
      lastReport
    );

    console.groupCollapsed(
      "%c[Morning Meeting Date Nav Diagnostic] complete",
      "color:#2563eb;font-weight:bold"
    );
    console.log(lastReport);
    console.groupEnd();
  }

  function cancel() {
    if (!active) return;
    const session = active;
    active = null;

    root.clearTimeout(session.finishTimer);
    root.clearInterval(session.driftTimer);

    for (const observer of [
      session.mutationObserver,
      session.longTaskObserver,
      session.loafObserver,
      session.resourceObserver
    ]) {
      try {
        observer?.disconnect?.();
      } catch {}
    }

    for (const restore of session.restoreFunctions) {
      try {
        restore();
      } catch {}
    }

    setOverlayState("진단 취소됨", "");
  }

  root.addEventListener(
    "click",
    event => {
      const trigger = getTrigger(event);
      if (trigger) begin(event, trigger);
    },
    true
  );

  root.addEventListener(
    "change",
    event => {
      const trigger = getTrigger(event);
      if (trigger) begin(event, trigger);
    },
    true
  );

  root.__morningMeetingDateNavDiagnostic = Object.freeze({
    version: VERSION,
    get active() {
      return Boolean(active);
    },
    get report() {
      return lastReport;
    },
    cancel
  });

  root.getMorningMeetingDateNavDiagnosticReport = () => lastReport;

  if (doc.readyState === "loading") {
    doc.addEventListener(
      "DOMContentLoaded",
      () => ensureOverlay(),
      {once: true}
    );
  } else {
    ensureOverlay();
  }
})(typeof window === "object" ? window : null);
