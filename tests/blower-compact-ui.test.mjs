import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(process.argv[2] || process.cwd());
const source = fs.readFileSync(path.join(root, "maintenance/blower-history.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "maintenance/blower-history.html"), "utf8");
const bootstrap = '  if (document.readyState === "loading") {';
assert.equal(source.split(bootstrap).length, 2, "the UI bootstrap must be available for isolated execution");

function element() {
  return {
    innerHTML: "", textContent: "", hidden: false, disabled: false, value: "", dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, replaceChildren() {},
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
}

function harness({ mobile = false, canWrite = true } = {}) {
  const nodes = new Map();
  let fetchCount = 0;
  const context = vm.createContext({
    console,
    clearTimeout() {},
    localStorage: { getItem: () => null },
    window: { matchMedia: () => ({ matches: mobile }), setTimeout: () => 1 },
    document: {
      readyState: "loading",
      addEventListener() {},
      getElementById(id) {
        if (!nodes.has(id)) nodes.set(id, element());
        return nodes.get(id);
      }
    },
    fetch: async () => {
      fetchCount += 1;
      throw new Error("this UI check must not send a request");
    }
  });
  const exports = `
    globalThis.compactUi = {
      state, elements, cacheElements, renderAssetCard, projectedOperatingDueDate,
      evidenceSourceMeta, displayEventContent, getLatestDataParcRuntimeBasis,
      openAssetHistory, hasAuthenticatedWriteAccess, isMobileMonitoringView,
      stopMobileMutation, toggleAssetOperation, syncDataParcBlowerRuntime,
      openRecordDialog, openDataParcRuntimeDialog
    };
  `;
  vm.runInContext(source.replace(bootstrap, `${exports}\n${bootstrap}`), context);
  const ui = context.compactUi;
  ui.cacheElements();
  ui.state.data = {
    permissions: { canWrite },
    user: canWrite ? { name: "operator", isSuperAdmin: false } : null,
    backfill: { hasRun: true, status: "complete" },
    assets: [], events: []
  };
  return { ui, fetchCount: () => fetchCount };
}

function asset(overrides = {}) {
  return {
    tagNumber: "104ETH03AN602", blowerType: "flyash_silo", unitNo: "shared",
    positionLabel: "#B", displayName: "Fly Ash Silo Aeration Blower #B",
    lastReplacementAt: "2026-05-03T15:00:00.000Z",
    cycleStartState: "legacy", cycleStartedAt: "2026-05-03T15:00:00.000Z",
    cycleStartRevision: "replacement-r1", cycleRuntimeRevision: "runtime-after-sync",
    cycleRuntimeTracked: true, cycleElapsedHours: 1262.313889,
    isRunning: true, remainingHours: null, severity: "unset",
    ...overrides
  };
}

function replacementEvent(item) {
  return {
    id: `replacement-${item.tagNumber}`, tagNumber: item.tagNumber, blowerType: item.blowerType,
    eventType: "replacement", eventDate: item.lastReplacementAt,
    sourceType: "shift_log_history_v13", sourceText: "V-Belt 교체 완료 <점검>"
  };
}

function dataParcEvent(item) {
  return {
    id: "dataparc-runtime-saved", tagNumber: item.tagNumber, blowerType: item.blowerType,
    eventType: "runtime_correction", eventDate: "2026-09-08T12:10:00.000Z",
    sourceType: "dataparc_runtime", runtimeHours: 1262.313889,
    sourceText: JSON.stringify({
      startAt: "2026-05-09T15:00:00.000Z", observedAt: "2026-09-08T12:10:00.000Z",
      expectedLastReplacementAt: item.lastReplacementAt,
      expectedCycleStartState: item.cycleStartState,
      expectedCycleStartRevision: item.cycleStartRevision,
      expectedCycleStartedAt: ""
    })
  };
}

function render(ui, item, setting = { cycleDays: null }, events = [replacementEvent(item)]) {
  ui.state.data.assets = [item];
  ui.state.data.events = events;
  return ui.renderAssetCard(item, setting);
}

function footerActions(markup) {
  const footer = /<div class="asset-actions">([\s\S]*?)<\/div>/.exec(markup)?.[1];
  assert.ok(footer, "an asset must retain its action row");
  return [...footer.matchAll(/data-asset-action="([^"]+)"/g)].map(match => match[1]);
}

test("all five Blower categories retain direct state, replacement, and history actions", () => {
  const { ui } = harness();
  const identities = [
    ["fbhe", "104HHL60AP611", "1"],
    ["seal_pot", "104HHL10AN611", "1"],
    ["organic_fuel", "104SDF01AN001", "1"],
    ["flyash_bag", "104ETG30AN601", "1"],
    ["flyash_silo", "104ETH03AN602", "shared"]
  ];
  for (const [blowerType, tagNumber, unitNo] of identities) {
    const markup = render(ui, asset({ blowerType, tagNumber, unitNo }));
    assert.deepEqual(footerActions(markup), ["operation_toggle", "replacement", "history"], blowerType);
    assert.ok(markup.includes(`data-tag="${tagNumber}"`));
    assert.ok(markup.includes(`data-unit="${unitNo}"`));
  }
});

test("an unset policy shows runtime without empty policy metrics or a made-up due date", () => {
  const { ui } = harness();
  for (const cycleDays of [null, undefined, "", 0]) {
    const markup = render(ui, asset(), { cycleDays });
    assert.ok(markup.includes("52일 14시간"));
    assert.doesNotMatch(markup, /class="cycle-(?:deadline|usage)-metric/);
    assert.doesNotMatch(markup, /<em>(?:예상|예정)<\/em>/);
    assert.doesNotMatch(markup, /role="progressbar"/);
    assert.ok(markup.includes("2026-05-04"), "the actual replacement date remains visible");
  }
  for (const missing of [null, undefined, ""]) {
    assert.equal(ui.projectedOperatingDueDate(missing), "-");
  }
});

test("a configured policy keeps remaining time, utilization, and progress while stopped state remains distinct", () => {
  const { ui } = harness();
  const configured = asset({ remainingHours: 500, severity: "normal" });
  const markup = render(ui, configured, { cycleDays: 90 });
  assert.match(markup, /class="cycle-deadline-metric/);
  assert.match(markup, /class="cycle-usage-metric/);
  assert.match(markup, /role="progressbar"/);
  assert.match(markup, /<em>예상<\/em>/);
  const stopped = render(ui, { ...configured, isRunning: false }, { cycleDays: 90 });
  assert.match(stopped, /data-operation-state="stopped"/);
  assert.match(stopped, /data-asset-action="operation_toggle"/);
});

test("replacement evidence starts collapsed, preserves its full text, and escapes markup", () => {
  const { ui } = harness();
  const item = asset();
  const event = replacementEvent(item);
  event.sourceText += " / 추가 정비 내용".repeat(40) + " / 근거 끝 확인";
  const markup = render(ui, item, { cycleDays: null }, [event]);
  const details = /<details\b[^>]*class="asset-evidence[^\"]*"[^>]*>/.exec(markup)?.[0];
  assert.ok(details);
  assert.doesNotMatch(details, /\bopen(?:\s|=|>)/);
  assert.ok(markup.includes("&lt;점검&gt;"));
  assert.ok(markup.includes("근거 끝 확인"), "expanding evidence must expose text beyond the old preview limit");
  assert.doesNotMatch(markup, /V13 문맥복구/);
});

test("DataPARC basis and history display the actual observed endpoint in KST", () => {
  const { ui } = harness();
  const item = asset();
  const event = dataParcEvent(item);
  const markup = render(ui, item, { cycleDays: null }, [replacementEvent(item), event]);
  const basis = /<div class="dataparc-runtime-basis"[\s\S]*?<\/div>/.exec(markup)?.[0];
  assert.ok(basis);
  assert.ok(basis.includes("2026-05-10 00:00"));
  assert.ok(basis.includes("2026-09-08 21:10"));
  assert.doesNotMatch(basis, /→\s*현재|\.000Z/);
  assert.equal(ui.evidenceSourceMeta(event).label, "DataPARC 조회");
  const content = ui.displayEventContent(event);
  assert.ok(content.includes("2026-05-10 00:00"));
  assert.ok(content.includes("2026-09-08 21:10"));
  assert.ok(content.includes("52일 14시간"));
  assert.doesNotMatch(content, /\.000Z|expectedCycle|dataparc_runtime/);
});

test("an old replacement cycle cannot supply the displayed DataPARC basis", () => {
  const { ui } = harness();
  const item = asset();
  const oldEvent = dataParcEvent({ ...item, cycleStartRevision: "previous-replacement" });
  const markup = render(ui, item, { cycleDays: null }, [replacementEvent(item), oldEvent]);
  assert.equal(ui.getLatestDataParcRuntimeBasis(item.tagNumber), null);
  assert.doesNotMatch(markup, /2026-05-10 00:00|2026-09-08 21:10/, "old query dates must not appear on the new cycle");
});

test("manual runtime correction remains available once in the history footer and respects pending/public access", () => {
  const { ui } = harness();
  const item = asset();
  render(ui, item);
  ui.openAssetHistory(item.tagNumber);
  assert.equal(ui.elements.historyDialog.open, true);
  assert.equal(ui.elements.historyRuntimeCorrectionButton.hidden, false);
  assert.equal(ui.elements.historyRuntimeCorrectionButton.disabled, false);
  assert.doesNotMatch(ui.elements.historyCycleSummary.innerHTML, /data-history-action="runtime"/);
  const footerButton = /<button\b[^>]*id="historyRuntimeCorrectionButton"[^>]*>/.exec(htmlSource)?.[0];
  assert.ok(footerButton, "the retained action must exist in the actual HTML");
  assert.match(footerButton, /data-history-action="runtime"/);
  assert.match(footerButton, /data-mobile-write/);
  ui.state.data.assets = [{ ...item, cycleStartState: "pending" }];
  ui.openAssetHistory(item.tagNumber);
  assert.equal(ui.elements.historyRuntimeCorrectionButton.hidden, true);
  ui.state.data.assets = [item];
  ui.state.data.permissions.canWrite = false;
  ui.openAssetHistory(item.tagNumber);
  assert.equal(ui.elements.historyRuntimeCorrectionButton.hidden, true);
});

test("supported DataPARC cards expose query setup while unsupported assets and unconfirmed signals cannot start", async () => {
  const { ui, fetchCount } = harness();
  const item = asset();
  assert.match(render(ui, item), /data-asset-action="dataparc_runtime_probe"/);
  for (const tagNumber of ["104ETH03AN601", "104ETG30AN602", "104SDF01AN001"]) {
    assert.match(render(ui, asset({ tagNumber })), /data-asset-action="dataparc_runtime_probe"/);
    await ui.syncDataParcBlowerRuntime(tagNumber, "2026-05-10T00:00:00+09:00");
  }
  for (const tagNumber of ["104HHL60AP611", "104HHL10AN611", "INVALID-TAG"]) {
    assert.doesNotMatch(render(ui, asset({ tagNumber })), /data-asset-action="dataparc_runtime_probe"/);
    await ui.syncDataParcBlowerRuntime(tagNumber, "2026-05-10T00:00:00+09:00");
  }
  assert.doesNotMatch(render(ui, { ...item, cycleStartState: "pending" }), /data-asset-action="dataparc_runtime_probe"/);
  assert.equal(fetchCount(), 0);
});

test("mobile and public views block mutation handlers while retaining asset history access", async () => {
  for (const options of [{ mobile: true }, { canWrite: false }]) {
    const { ui, fetchCount } = harness(options);
    const item = asset();
    const markup = render(ui, item);
    assert.doesNotMatch(markup, /data-asset-action="dataparc_runtime_probe"/);
    let prevented = 0;
    assert.equal(ui.stopMobileMutation({ preventDefault() { prevented += 1; } }), true);
    assert.equal(prevented, 1);
    await ui.toggleAssetOperation(item.tagNumber);
    await ui.syncDataParcBlowerRuntime(item.tagNumber, "2026-05-10T00:00:00+09:00");
    ui.openRecordDialog("runtime", item.tagNumber);
    ui.openDataParcRuntimeDialog(item.tagNumber);
    assert.equal(fetchCount(), 0);
    assert.notEqual(ui.elements.recordDialog.open, true);
    assert.notEqual(ui.elements.dataparcRuntimeDialog.open, true);
    ui.openAssetHistory(item.tagNumber);
    assert.equal(ui.elements.historyDialog.open, true);
  }
});
