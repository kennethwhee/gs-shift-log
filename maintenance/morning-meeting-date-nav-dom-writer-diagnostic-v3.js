/*
 * GS Morning Meeting Date Navigation DOM Writer Diagnostic V3
 * Diagnostic only. Starts instrumentation in capture phase on a date-nav click,
 * before the app's bubble-phase date handler runs.
 */
(function installMorningMeetingDomWriterDiagnosticV3(root) {
  "use strict";

  if (!root || !root.document || !root.performance) return;
  if (root.__morningMeetingDomWriterDiagnosticV3) return;

  const VERSION = "20261003-v3";
  const WINDOW_MS = 6500;
  const OVERLAY_ID = "morningMeetingDomWriterDiagnosticV3Overlay";
  const TRIGGERS = new Set([
    "efficiencyMorningMeetingLimestonePreviousButton",
    "efficiencyMorningMeetingLimestoneTodayButton",
    "efficiencyMorningMeetingLimestoneNextButton",
    "efficiencyMorningMeetingAutoDatePicker"
  ]);

  const doc = root.document;
  const perf = root.performance;
  const nativeSetTimeout = root.setTimeout.bind(root);
  const nativeClearTimeout = root.clearTimeout.bind(root);
  const nativeRaf = root.requestAnimationFrame.bind(root);

  let active = null;
  let lastReport = "";
  let sessionSeq = 0;

  function now() {
    return perf.now();
  }

  function round(value) {
    return Number.isFinite(value)
      ? Math.round(value * 10) / 10
      : 0;
  }

  function selectedDate() {
    return String(
      doc.getElementById("efficiencyMorningMeetingWaterPanel")
        ?.dataset?.morningMeetingAutoBaseDate || ""
    ).trim();
  }

  function cleanStack(stack) {
    return String(stack || "")
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line =>
        line &&
        !line.includes("morning-meeting-date-nav-dom-writer-diagnostic-v3.js")
      )
      .slice(0, 8);
  }

  function callerFromStack(stack) {
    const lines = cleanStack(stack);

    return (
      lines.find(line =>
        /(?:\/maintenance\/|\/script\.js)/.test(line)
      ) ||
      lines.find(line => /^at /.test(line)) ||
      "(unknown caller)"
    );
  }

  function nodeLabel(node) {
    if (!node) return "(null)";
    if (node === doc) return "document";
    if (node === doc.documentElement) return "html";
    if (node === doc.body) return "body";

    if (node.nodeType !== 1) {
      return node.nodeName || "(non-element)";
    }

    const element = node;

    if (element.id) {
      return `#${element.id}`;
    }

    let current = element.parentElement;

    for (let depth = 0; current && depth < 4; depth += 1) {
      if (current.id) {
        return `${element.tagName.toLowerCase()} under #${current.id}`;
      }
      current = current.parentElement;
    }

    const classes =
      Array.from(element.classList || [])
        .slice(0, 3);

    return (
      element.tagName.toLowerCase() +
      (classes.length ? "." + classes.join(".") : "")
    );
  }

  function ensureOverlay() {
    let overlay = doc.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = doc.createElement("section");
    overlay.id = OVERLAY_ID;
    overlay.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "width:min(760px,calc(100vw - 32px))",
      "max-height:76vh",
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
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <strong style="flex:1;font:600 13px/1.2 system-ui,sans-serif">
          DOM Writer 진단 V3
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
      <div data-status
        style="font:600 12px/1.4 system-ui,sans-serif;margin-bottom:8px"></div>
      <pre data-report
        style="margin:0;white-space:pre-wrap;word-break:break-word"></pre>
    `;

    overlay.addEventListener("click", async event => {
      if (event.target?.hasAttribute("data-close")) {
        overlay.style.display = "none";
        return;
      }

      if (event.target?.hasAttribute("data-copy")) {
        try {
          await root.navigator.clipboard.writeText(lastReport || "");
          const button = event.target;
          button.textContent = "복사됨";
          nativeSetTimeout(() => {
            button.textContent = "결과 복사";
          }, 1200);
        } catch {
          const report = overlay.querySelector("[data-report]");
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

  function show(status, report = "") {
    const overlay = ensureOverlay();
    overlay.style.display = "block";
    overlay.querySelector("[data-status]").textContent = status;
    overlay.querySelector("[data-report]").textContent = report;
  }

  function getTrigger(event) {
    const target = event?.target;
    if (!(target instanceof root.Element)) return null;

    if (TRIGGERS.has(target.id)) return target;

    return target.closest?.(
      "#efficiencyMorningMeetingLimestonePreviousButton," +
      "#efficiencyMorningMeetingLimestoneTodayButton," +
      "#efficiencyMorningMeetingLimestoneNextButton," +
      "#efficiencyMorningMeetingAutoDatePicker"
    ) || null;
  }

  function addWriterSample(session, op, target, elapsed, stack, detail = "") {
    if (!session || active !== session) return;

    const caller = callerFromStack(stack);
    const key = `${op} | ${caller}`;

    let group = session.writers.get(key);

    if (!group) {
      group = {
        op,
        caller,
        calls: 0,
        totalMs: 0,
        maxMs: 0,
        targets: new Map(),
        details: new Map(),
        stack: cleanStack(stack)
      };
      session.writers.set(key, group);
    }

    group.calls += 1;
    group.totalMs += elapsed;
    group.maxMs = Math.max(group.maxMs, elapsed);

    const label = nodeLabel(target);
    group.targets.set(
      label,
      (group.targets.get(label) || 0) + 1
    );

    if (detail) {
      group.details.set(
        detail,
        (group.details.get(detail) || 0) + 1
      );
    }
  }

  function installTemporaryWriters(session) {
    const restores = session.restores;

    function wrapMethod(proto, name, opName, options = {}) {
      if (!proto) return;

      const original = proto[name];
      if (typeof original !== "function") return;

      const wrapped = function (...args) {
        if (active !== session) {
          return Reflect.apply(original, this, args);
        }

        const shouldStack =
          options.alwaysStack === true ||
          session.lowLevelStackBudget > 0;

        let stack = "";

        if (shouldStack) {
          stack = new Error(opName).stack;
          if (options.alwaysStack !== true) {
            session.lowLevelStackBudget -= 1;
          }
        }

        const started = now();
        const result = Reflect.apply(original, this, args);
        const elapsed = now() - started;

        if (
          options.alwaysStack === true ||
          stack
        ) {
          addWriterSample(
            session,
            opName,
            this,
            elapsed,
            stack,
            options.detail?.(args) || ""
          );
        } else {
          session.unsampledLowLevel[opName] =
            (session.unsampledLowLevel[opName] || 0) + 1;
        }

        return result;
      };

      try {
        proto[name] = wrapped;

        restores.push(() => {
          if (proto[name] === wrapped) {
            proto[name] = original;
          }
        });
      } catch {}
    }

    function wrapSetter(proto, property, opName, detailBuilder) {
      if (!proto) return;

      const descriptor =
        Object.getOwnPropertyDescriptor(
          proto,
          property
        );

      if (
        !descriptor ||
        typeof descriptor.set !== "function" ||
        descriptor.configurable !== true
      ) {
        return;
      }

      const originalSetter = descriptor.set;

      const replacement = {
        ...descriptor,
        set(value) {
          if (active !== session) {
            return Reflect.apply(
              originalSetter,
              this,
              [value]
            );
          }

          const stack =
            new Error(opName).stack;

          const started = now();

          const result =
            Reflect.apply(
              originalSetter,
              this,
              [value]
            );

          const elapsed =
            now() - started;

          addWriterSample(
            session,
            opName,
            this,
            elapsed,
            stack,
            detailBuilder?.(value) || ""
          );

          return result;
        }
      };

      try {
        Object.defineProperty(
          proto,
          property,
          replacement
        );

        restores.push(() => {
          try {
            const current =
              Object.getOwnPropertyDescriptor(
                proto,
                property
              );

            if (
              current?.set ===
              replacement.set
            ) {
              Object.defineProperty(
                proto,
                property,
                descriptor
              );
            }
          } catch {}
        });
      } catch {}
    }

    wrapSetter(
      root.Element?.prototype,
      "innerHTML",
      "innerHTML=",
      value => `chars=${String(value ?? "").length}`
    );

    wrapSetter(
      root.Element?.prototype,
      "outerHTML",
      "outerHTML=",
      value => `chars=${String(value ?? "").length}`
    );

    wrapSetter(
      root.Node?.prototype,
      "textContent",
      "textContent=",
      value => `chars=${String(value ?? "").length}`
    );

    wrapMethod(
      root.Element?.prototype,
      "replaceChildren",
      "replaceChildren",
      {
        alwaysStack: true,
        detail: args => `nodes=${args.length}`
      }
    );

    wrapMethod(
      root.Element?.prototype,
      "insertAdjacentHTML",
      "insertAdjacentHTML",
      {
        alwaysStack: true,
        detail: args => `pos=${args[0]} chars=${String(args[1] ?? "").length}`
      }
    );

    // Low-level node calls are sampled to avoid making the diagnostic itself
    // become the new 3-second freeze.
    wrapMethod(
      root.Node?.prototype,
      "appendChild",
      "appendChild"
    );

    wrapMethod(
      root.Node?.prototype,
      "insertBefore",
      "insertBefore"
    );

    wrapMethod(
      root.Node?.prototype,
      "removeChild",
      "removeChild"
    );

    wrapMethod(
      root.Node?.prototype,
      "replaceChild",
      "replaceChild"
    );

    wrapMethod(
      root.Element?.prototype,
      "remove",
      "Element.remove"
    );

    wrapMethod(
      root.Element?.prototype,
      "replaceWith",
      "replaceWith"
    );
  }

  function installMutationTargetObserver(session) {
    const modal =
      doc.getElementById("efficiencyTeamModal") ||
      doc.body;

    const observer =
      new MutationObserver(records => {
        if (active !== session) return;

        for (const record of records) {
          if (record.type !== "childList") continue;

          session.childListRecords += 1;
          session.addedNodes += record.addedNodes?.length || 0;
          session.removedNodes += record.removedNodes?.length || 0;

          const label = nodeLabel(record.target);

          const current =
            session.targets.get(label) ||
            {
              records: 0,
              added: 0,
              removed: 0
            };

          current.records += 1;
          current.added += record.addedNodes?.length || 0;
          current.removed += record.removedNodes?.length || 0;

          session.targets.set(
            label,
            current
          );
        }
      });

    observer.observe(
      modal,
      {
        childList: true,
        subtree: true
      }
    );

    session.mutationObserver = observer;
  }

  function begin(event, trigger) {
    if (active) return;

    const startPerf = now();

    const session = {
      id: ++sessionSeq,
      startPerf,
      startedAt: new Date().toISOString(),
      trigger: trigger.id || trigger.tagName,
      fromDate: selectedDate(),
      toDate: "",
      firstRafAt: null,
      secondRafAt: null,
      timeout0At: null,
      maxTimerDrift: 0,
      timerDrifts: [],
      driftTimer: 0,
      finishTimer: 0,
      mutationObserver: null,
      childListRecords: 0,
      addedNodes: 0,
      removedNodes: 0,
      targets: new Map(),
      writers: new Map(),
      restores: [],
      lowLevelStackBudget: 240,
      unsampledLowLevel: {}
    };

    active = session;

    show(
      "진단 중 · 날짜를 한 번만 이동한 뒤 6.5초간 기다려 주세요.",
      `From: ${session.fromDate || "-"}\nTrigger: ${session.trigger}`
    );

    installTemporaryWriters(session);
    installMutationTargetObserver(session);

    nativeSetTimeout(() => {
      if (active === session) {
        session.timeout0At =
          round(now() - startPerf);
      }
    }, 0);

    nativeRaf(() => {
      if (active !== session) return;

      session.firstRafAt =
        round(now() - startPerf);

      nativeRaf(() => {
        if (active === session) {
          session.secondRafAt =
            round(now() - startPerf);
        }
      });
    });

    let expected = now() + 100;

    session.driftTimer =
      root.setInterval(() => {
        if (active !== session) return;

        const current = now();
        const drift = current - expected;

        session.maxTimerDrift =
          Math.max(
            session.maxTimerDrift,
            drift
          );

        if (
          drift > 40 &&
          session.timerDrifts.length < 24
        ) {
          session.timerDrifts.push({
            at: round(current - startPerf),
            drift: round(drift)
          });
        }

        expected = current + 100;
      }, 100);

    session.finishTimer =
      nativeSetTimeout(
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
      session.mutationObserver?.disconnect();
    } catch {}

    for (const restore of session.restores.reverse()) {
      try {
        restore();
      } catch {}
    }

    session.toDate = selectedDate();

    const writers =
      [...session.writers.values()]
        .sort((a, b) =>
          (b.totalMs - a.totalMs) ||
          (b.calls - a.calls)
        );

    const targets =
      [...session.targets.entries()]
        .sort((a, b) =>
          (b[1].records - a[1].records) ||
          ((b[1].added + b[1].removed) -
           (a[1].added + a[1].removed))
        );

    const lines = [];

    lines.push("[GS Morning Meeting DOM Writer Diagnostic V3]");
    lines.push(`Started: ${session.startedAt}`);
    lines.push(`Trigger: ${session.trigger}`);
    lines.push(`Date: ${session.fromDate || "-"} -> ${session.toDate || "-"}`);
    lines.push("");

    lines.push("=== EVENT LOOP ===");
    lines.push(`setTimeout(0): ${session.timeout0At ?? "-"} ms`);
    lines.push(`1st rAF: ${session.firstRafAt ?? "-"} ms`);
    lines.push(`2nd rAF: ${session.secondRafAt ?? "-"} ms`);
    lines.push(`max timer drift: ${round(session.maxTimerDrift)} ms`);
    lines.push("");

    lines.push("=== CHILD-LIST MUTATION TARGETS ===");
    lines.push(`total records: ${session.childListRecords}`);
    lines.push(`added nodes: ${session.addedNodes}`);
    lines.push(`removed nodes: ${session.removedNodes}`);

    for (
      const [label, item] of
      targets.slice(0, 30)
    ) {
      lines.push(
        `  ${item.records} rec | +${item.added} -${item.removed} | ${label}`
      );
    }

    lines.push("");
    lines.push("=== DOM WRITERS / CALLERS ===");

    if (!writers.length) {
      lines.push("  (no wrapped DOM writer captured)");
    } else {
      writers.slice(0, 40).forEach((item, index) => {
        lines.push(
          `#${index + 1} ${item.op} | ${item.calls} calls | total ${round(item.totalMs)} ms | max ${round(item.maxMs)} ms`
        );
        lines.push(`   caller: ${item.caller}`);

        const targetRows =
          [...item.targets.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6);

        for (const [target, count] of targetRows) {
          lines.push(`   target: ${count}x ${target}`);
        }

        const details =
          [...item.details.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4);

        for (const [detail, count] of details) {
          lines.push(`   detail: ${count}x ${detail}`);
        }

        for (const frame of item.stack.slice(0, 4)) {
          lines.push(`   stack: ${frame}`);
        }
      });
    }

    lines.push("");
    lines.push("=== UNSAMPLED LOW-LEVEL WRITE COUNTS ===");

    const lowLevel =
      Object.entries(session.unsampledLowLevel)
        .sort((a, b) => b[1] - a[1]);

    if (!lowLevel.length) {
      lines.push("  (none)");
    } else {
      for (const [op, count] of lowLevel) {
        lines.push(`  ${op}: ${count}`);
      }
    }

    if (session.timerDrifts.length) {
      lines.push("");
      lines.push("=== TIMER DRIFTS ===");

      for (const item of session.timerDrifts) {
        lines.push(
          `  at ${item.at} ms | +${item.drift} ms`
        );
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
      "%c[Morning Meeting DOM Writer Diagnostic V3]",
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

  root.__morningMeetingDomWriterDiagnosticV3 =
    Object.freeze({
      version: VERSION,
      get report() {
        return lastReport;
      }
    });

  root.getMorningMeetingDomWriterDiagnosticV3Report =
    () => lastReport;

  if (doc.readyState === "loading") {
    doc.addEventListener(
      "DOMContentLoaded",
      ensureOverlay,
      {once: true}
    );
  } else {
    ensureOverlay();
  }
})(window);
