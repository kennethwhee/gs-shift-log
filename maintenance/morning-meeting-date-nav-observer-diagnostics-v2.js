/*
 * GS Morning Meeting Date Navigation Observer Diagnostic V2
 * Loads before application scripts and instruments MutationObserver only.
 * Diagnostic behavior only: no API calls, no storage writes, no source refresh.
 */
(function installMorningMeetingObserverDiagnosticV2(root) {
  "use strict";

  if (!root || !root.document || !root.performance) return;
  if (root.__morningMeetingObserverDiagnosticV2) return;

  const VERSION = "20261003-v2";
  const WINDOW_MS = 8000;
  const DIAG_FILE = "morning-meeting-date-nav-observer-diagnostics-v2.js";
  const OVERLAY_ID = "morningMeetingObserverDiagnosticV2Overlay";
  const BUTTON_IDS = new Set([
    "efficiencyMorningMeetingLimestonePreviousButton",
    "efficiencyMorningMeetingLimestoneTodayButton",
    "efficiencyMorningMeetingLimestoneNextButton",
    "efficiencyMorningMeetingAutoDatePicker"
  ]);

  const NativeMutationObserver = root.MutationObserver;
  const nativeQueueMicrotask =
    typeof root.queueMicrotask === "function"
      ? root.queueMicrotask.bind(root)
      : callback => Promise.resolve().then(callback);
  const nativeSetTimeout = root.setTimeout.bind(root);
  const nativeClearTimeout = root.clearTimeout.bind(root);
  const nativeRequestAnimationFrame = root.requestAnimationFrame.bind(root);

  let observerSequence = 0;
  const observerMeta = new Map();
  const queueMicrotaskGroups = new Map();
  let active = null;
  let lastReport = "";

  function now() {
    return root.performance.now();
  }

  function round(value) {
    return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
  }

  function cleanStack(stack) {
    return String(stack || "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.includes(DIAG_FILE))
      .slice(0, 8);
  }

  function sourceFrame(stack) {
    const lines = cleanStack(stack);
    return (
      lines.find(line =>
        /(?:\/maintenance\/|\/script\.js|\/efficiency\/)/.test(line)
      ) ||
      lines.find(line => /https?:\/\//.test(line)) ||
      lines[0] ||
      "(unknown creator)"
    );
  }

  function describeTarget(target) {
    if (!(target instanceof root.Element)) {
      return target === root.document ? "document" :
        target === root.document.documentElement ? "html" :
        target?.nodeName || "(non-element)";
    }

    if (target.id) return `#${target.id}`;

    const classes = Array.from(target.classList || []).slice(0, 3);
    return `${target.tagName.toLowerCase()}${classes.length ? "." + classes.join(".") : ""}`;
  }

  function targetDate() {
    return String(
      root.document.getElementById("efficiencyMorningMeetingWaterPanel")
        ?.dataset?.morningMeetingAutoBaseDate || ""
    ).trim();
  }

  function ensureObserverStat(session, id, meta) {
    let stat = session.observers.get(id);
    if (!stat) {
      stat = {
        id,
        creator: meta.creator,
        stack: meta.stack,
        targets: [...meta.targets],
        calls: 0,
        records: 0,
        attributes: 0,
        childList: 0,
        characterData: 0,
        totalMs: 0,
        maxMs: 0,
        preRafCalls: 0,
        preRafRecords: 0,
        preRafMs: 0,
        firstAt: null,
        lastAt: null
      };
      session.observers.set(id, stat);
    } else if (meta.targets.length) {
      stat.targets = [...meta.targets];
    }
    return stat;
  }

  if (typeof NativeMutationObserver === "function") {
    class TracedMutationObserver extends NativeMutationObserver {
      constructor(callback) {
        const id = ++observerSequence;
        const creationStack = new Error(`MutationObserver#${id}`).stack;
        let selfReference = null;

        super((records, nativeObserver) => {
          const session = active;
          let stat = null;
          const start = now();

          if (session) {
            const meta = observerMeta.get(id);
            stat = ensureObserverStat(session, id, meta);
            const at = start - session.startPerf;

            stat.calls += 1;
            stat.records += records.length;
            stat.firstAt ??= at;
            stat.lastAt = at;

            for (const record of records) {
              if (record.type === "attributes") stat.attributes += 1;
              else if (record.type === "childList") stat.childList += 1;
              else if (record.type === "characterData") stat.characterData += 1;
            }
          }

          try {
            return callback(records, selfReference || nativeObserver);
          } finally {
            if (session && stat) {
              const elapsed = now() - start;
              stat.totalMs += elapsed;
              stat.maxMs = Math.max(stat.maxMs, elapsed);

              if (
                session.firstRafAt === null ||
                start - session.startPerf < session.firstRafAt
              ) {
                stat.preRafCalls += 1;
                stat.preRafRecords += records.length;
                stat.preRafMs += elapsed;
              }

              if (session.sequence.length < 5000) {
                session.sequence.push({
                  at: round(start - session.startPerf),
                  id,
                  records: records.length,
                  ms: round(elapsed)
                });
              }
            }
          }
        });

        selfReference = this;

        observerMeta.set(id, {
          id,
          creator: sourceFrame(creationStack),
          stack: cleanStack(creationStack),
          targets: []
        });

        Object.defineProperty(this, "__gsObserverDiagnosticId", {
          value: id,
          enumerable: false,
          configurable: false
        });
      }

      observe(target, options) {
        const id = this.__gsObserverDiagnosticId;
        const meta = observerMeta.get(id);

        if (meta) {
          const description = describeTarget(target);
          const optionSummary = [
            options?.subtree ? "subtree" : "",
            options?.childList ? "childList" : "",
            options?.attributes ? "attributes" : "",
            options?.characterData ? "characterData" : "",
            Array.isArray(options?.attributeFilter)
              ? `attrs=${options.attributeFilter.join(",")}`
              : ""
          ].filter(Boolean).join("|");

          const value = `${description}${optionSummary ? ` [${optionSummary}]` : ""}`;
          if (!meta.targets.includes(value)) meta.targets.push(value);

          if (active) {
            const stat = ensureObserverStat(active, id, meta);
            stat.targets = [...meta.targets];
          }
        }

        return super.observe(target, options);
      }
    }

    try {
      Object.defineProperty(TracedMutationObserver, "name", {
        value: "MutationObserver"
      });
    } catch {}

    root.MutationObserver = TracedMutationObserver;
  }

  if (typeof root.queueMicrotask === "function") {
    root.queueMicrotask = function tracedQueueMicrotask(callback) {
      const creationStack = new Error("queueMicrotask").stack;
      const creator = sourceFrame(creationStack);

      return nativeQueueMicrotask(() => {
        const session = active;
        const started = now();

        try {
          return callback();
        } finally {
          if (session) {
            const elapsed = now() - started;
            const group =
              session.queueMicrotasks.get(creator) ||
              {creator, calls: 0, totalMs: 0, maxMs: 0};

            group.calls += 1;
            group.totalMs += elapsed;
            group.maxMs = Math.max(group.maxMs, elapsed);
            session.queueMicrotasks.set(creator, group);
          }
        }
      });
    };
  }

  function makeOverlay() {
    let overlay = root.document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = root.document.createElement("section");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "width:min(720px,calc(100vw - 32px))",
      "max-height:75vh",
      "overflow:auto",
      "background:#0f172a",
      "color:#f8fafc",
      "border:1px solid rgba(255,255,255,.18)",
      "border-radius:12px",
      "box-shadow:0 18px 48px rgba(0,0,0,.38)",
      "padding:12px",
      "font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace",
      "display:none"
    ].join(";");

    overlay.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <strong style="flex:1;font:600 13px/1.2 system-ui,sans-serif">
          Observer 진단 V2
        </strong>
        <button type="button" data-copy
          style="border:0;border-radius:7px;padding:6px 9px;cursor:pointer">
          결과 복사
        </button>
        <button type="button" data-close
          style="border:0;border-radius:7px;padding:6px 9px;cursor:pointer">
          닫기
        </button>
      </div>
      <div data-status style="font:600 12px/1.4 system-ui,sans-serif;margin-bottom:8px"></div>
      <pre data-report style="margin:0;white-space:pre-wrap;word-break:break-word"></pre>
    `;

    overlay.addEventListener("click", async event => {
      if (event.target?.hasAttribute("data-close")) {
        overlay.style.display = "none";
        return;
      }

      if (event.target?.hasAttribute("data-copy")) {
        try {
          await root.navigator.clipboard.writeText(lastReport);
          const button = event.target;
          button.textContent = "복사됨";
          nativeSetTimeout(() => {
            button.textContent = "결과 복사";
          }, 1200);
        } catch {
          const range = root.document.createRange();
          range.selectNodeContents(overlay.querySelector("[data-report]"));
          const selection = root.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    });

    root.document.body.appendChild(overlay);
    return overlay;
  }

  function show(status, report = "") {
    const overlay = makeOverlay();
    overlay.style.display = "block";
    overlay.querySelector("[data-status]").textContent = status;
    overlay.querySelector("[data-report]").textContent = report;
  }

  function getTrigger(event) {
    const target = event.target;
    if (!(target instanceof root.Element)) return null;
    if (BUTTON_IDS.has(target.id)) return target;

    return target.closest?.(
      "#efficiencyMorningMeetingLimestonePreviousButton," +
      "#efficiencyMorningMeetingLimestoneTodayButton," +
      "#efficiencyMorningMeetingLimestoneNextButton," +
      "#efficiencyMorningMeetingAutoDatePicker"
    ) || null;
  }

  function begin(event, trigger) {
    if (active) return;

    const startPerf = now();

    const session = {
      startPerf,
      startedAt: new Date().toISOString(),
      trigger: trigger.id || trigger.tagName,
      fromDate: targetDate(),
      toDate: "",
      firstRafAt: null,
      secondRafAt: null,
      timeout0At: null,
      maxTimerDrift: 0,
      drifts: [],
      observers: new Map(),
      queueMicrotasks: new Map(),
      sequence: [],
      longTasks: [],
      finishTimer: 0,
      driftTimer: 0,
      longTaskObserver: null
    };

    active = session;

    show(
      "진단 중 · 날짜를 한 번만 이동한 뒤 8초간 기다려 주세요.",
      `From: ${session.fromDate || "-"}\nTrigger: ${session.trigger}`
    );

    nativeQueueMicrotask(() => {
      // Marker only: confirms the originating click task has yielded.
      session.originMicrotaskAt = round(now() - startPerf);
    });

    nativeSetTimeout(() => {
      if (active === session) {
        session.timeout0At = round(now() - startPerf);
      }
    }, 0);

    nativeRequestAnimationFrame(() => {
      if (active !== session) return;
      session.firstRafAt = round(now() - startPerf);

      nativeRequestAnimationFrame(() => {
        if (active === session) {
          session.secondRafAt = round(now() - startPerf);
        }
      });
    });

    let expected = now() + 100;
    session.driftTimer = root.setInterval(() => {
      if (active !== session) return;
      const current = now();
      const drift = current - expected;
      session.maxTimerDrift = Math.max(session.maxTimerDrift, drift);
      if (drift > 40 && session.drifts.length < 40) {
        session.drifts.push({
          at: round(current - startPerf),
          drift: round(drift)
        });
      }
      expected = current + 100;
    }, 100);

    if (
      root.PerformanceObserver &&
      (root.PerformanceObserver.supportedEntryTypes || []).includes("longtask")
    ) {
      session.longTaskObserver = new root.PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.startTime < startPerf) continue;
          session.longTasks.push({
            at: round(entry.startTime - startPerf),
            duration: round(entry.duration)
          });
        }
      });

      session.longTaskObserver.observe({
        type: "longtask",
        buffered: true
      });
    }

    session.finishTimer = nativeSetTimeout(
      () => finish(session),
      WINDOW_MS
    );
  }

  function finish(session) {
    if (active !== session) return;

    active = null;
    root.clearInterval(session.driftTimer);
    nativeClearTimeout(session.finishTimer);

    try {
      session.longTaskObserver?.disconnect();
    } catch {}

    session.toDate = targetDate();

    const observerRows =
      [...session.observers.values()]
        .filter(item => item.calls > 0)
        .sort((a, b) =>
          (b.preRafCalls - a.preRafCalls) ||
          (b.preRafMs - a.preRafMs) ||
          (b.calls - a.calls) ||
          (b.totalMs - a.totalMs)
        );

    const microtaskRows =
      [...session.queueMicrotasks.values()]
        .sort((a, b) =>
          (b.calls - a.calls) ||
          (b.totalMs - a.totalMs)
        );

    const lines = [];
    lines.push("[GS Morning Meeting Observer Diagnostic V2]");
    lines.push(`Started: ${session.startedAt}`);
    lines.push(`Trigger: ${session.trigger}`);
    lines.push(`Date: ${session.fromDate || "-"} -> ${session.toDate || "-"}`);
    lines.push("");
    lines.push("=== EVENT LOOP ===");
    lines.push(`origin click -> first microtask: ${session.originMicrotaskAt ?? "-"} ms`);
    lines.push(`setTimeout(0): ${session.timeout0At ?? "-"} ms`);
    lines.push(`1st rAF: ${session.firstRafAt ?? "-"} ms`);
    lines.push(`2nd rAF: ${session.secondRafAt ?? "-"} ms`);
    lines.push(`max timer drift: ${round(session.maxTimerDrift)} ms`);
    lines.push(`long tasks: ${session.longTasks.length}`);
    lines.push("");

    lines.push("=== MUTATION OBSERVERS (sorted by pre-rAF activity) ===");
    if (!observerRows.length) {
      lines.push("  (no MutationObserver callback captured)");
    } else {
      observerRows.slice(0, 30).forEach((item, index) => {
        lines.push(
          `#${index + 1} observer ${item.id} | pre-rAF ${item.preRafCalls} calls / ${item.preRafRecords} records / ${round(item.preRafMs)} ms`
        );
        lines.push(
          `   total ${item.calls} calls / ${item.records} records / ${round(item.totalMs)} ms / max ${round(item.maxMs)} ms`
        );
        lines.push(
          `   types attr=${item.attributes} child=${item.childList} text=${item.characterData}`
        );
        lines.push(`   creator: ${item.creator}`);
        for (const target of item.targets.slice(0, 5)) {
          lines.push(`   target: ${target}`);
        }
        for (const frame of item.stack.slice(0, 4)) {
          lines.push(`   stack: ${frame}`);
        }
      });
    }

    lines.push("");
    lines.push("=== EXPLICIT queueMicrotask CALLBACKS ===");
    if (!microtaskRows.length) {
      lines.push("  (no explicit queueMicrotask callbacks captured)");
    } else {
      microtaskRows.slice(0, 20).forEach((item, index) => {
        lines.push(
          `#${index + 1} ${item.calls} calls / total ${round(item.totalMs)} ms / max ${round(item.maxMs)} ms`
        );
        lines.push(`   creator: ${item.creator}`);
      });
    }

    lines.push("");
    lines.push("=== FIRST OBSERVER CALLBACK SEQUENCE ===");
    for (const item of session.sequence.slice(0, 120)) {
      const meta = observerMeta.get(item.id);
      lines.push(
        `at ${item.at} ms | obs ${item.id} | ${item.records} rec | ${item.ms} ms | ${meta?.creator || "unknown"}`
      );
    }

    if (session.drifts.length) {
      lines.push("");
      lines.push("=== TIMER DRIFTS ===");
      for (const item of session.drifts.slice(0, 20)) {
        lines.push(`at ${item.at} ms | +${item.drift} ms`);
      }
    }

    lines.push("");
    lines.push("Send this entire report back to ChatGPT.");

    lastReport = lines.join("\n");

    show(
      "진단 완료 · [결과 복사]를 눌러 전체 내용을 보내주세요.",
      lastReport
    );

    console.groupCollapsed(
      "%c[Morning Meeting Observer Diagnostic V2]",
      "font-weight:bold;color:#2563eb"
    );
    console.log(lastReport);
    console.groupEnd();
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

  root.__morningMeetingObserverDiagnosticV2 = Object.freeze({
    version: VERSION,
    get report() {
      return lastReport;
    },
    get observerCount() {
      return observerMeta.size;
    }
  });

  root.getMorningMeetingObserverDiagnosticV2Report =
    () => lastReport;
})(window);
