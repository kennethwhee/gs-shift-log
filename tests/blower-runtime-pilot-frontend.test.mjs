import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";


const root = path.resolve(process.argv[2] || process.cwd());
const clientSource = fs.readFileSync(
  path.join(root, "maintenance/blower-history.js"),
  "utf8"
);
const SYNC_FUNCTION_NAME = "syncDataParcBlowerRuntime";


function extractFunction(source, name) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  assert.ok(declaration, `${name} function is missing`);

  const start = declaration.index;
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }

    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;

    if (depth === 0) return source.slice(start, index + 1);
  }

  assert.fail(`${name} function body is not balanced`);
}


function plain(value) {
  return JSON.parse(JSON.stringify(value));
}


test("frontend performs create, poll, then one request-id-only atomic sync", async () => {
  const apiCalls = [];
  const pollCalls = [];
  const statusCalls = [];
  const toasts = [];
  let loadCount = 0;
  let renderCount = 0;

  const context = vm.createContext({
    DATAPARC_RUNTIME_PILOT_TAG: "104ETH03AN602",
    OIS_REQUEST_API_URL: "/api/ois-data-requests",
    state: {
      dataparcRuntimeBusy: false,
      dataparcRuntimeTag: "",
      dataparcRuntimeStatus: "",
      operationSyncCompleted: false
    },
    stopMobileMutation: () => false,
    setDataparcRuntimeStatus: (tag, status) => statusCalls.push([tag, status]),
    waitForDataparcRuntimeProbe: async requestId => pollCalls.push(requestId),
    apiRequest: async options => {
      apiCalls.push(plain(options));
      return apiCalls.length === 1
        ? { item: { id: "probe-request-1" } }
        : { message: "synced" };
    },
    loadData: async () => {
      loadCount += 1;
    },
    showToast: (...args) => toasts.push(args),
    renderAssets: () => {
      renderCount += 1;
    },
    console
  });

  vm.runInContext(
    `${extractFunction(clientSource, SYNC_FUNCTION_NAME)}\n` +
      `this.${SYNC_FUNCTION_NAME} = ${SYNC_FUNCTION_NAME};`,
    context
  );

  await context[SYNC_FUNCTION_NAME]("104ETH03AN602");

  assert.equal(apiCalls.length, 2);
  assert.deepEqual(apiCalls[0], {
    method: "POST",
    url: "/api/ois-data-requests",
    body: {
      action: "create_blower_runtime_probe"
    }
  });
  assert.deepEqual(pollCalls, ["probe-request-1"]);
  assert.deepEqual(apiCalls[1], {
    method: "POST",
    body: {
      action: "dataparc_runtime_sync",
      requestId: "probe-request-1"
    }
  });
  assert.equal("runtimeHours" in apiCalls[1].body, false);
  assert.equal("isRunning" in apiCalls[1].body, false);
  assert.equal(loadCount, 1);
  assert.equal(context.state.operationSyncCompleted, true);
  assert.equal(context.state.dataparcRuntimeBusy, false);
  assert.equal(context.state.dataparcRuntimeTag, "");
  assert.equal(context.state.dataparcRuntimeStatus, "");
  assert.ok(statusCalls.some(([, status]) => status === "저장 중"));
  assert.deepEqual(toasts, [["synced"]]);
  assert.equal(renderCount, 1);
});


test("frontend sends a selected maintenance baseline only with the create request", async () => {
  const apiCalls = [];
  const context = vm.createContext({
    DATAPARC_RUNTIME_PILOT_TAG: "104ETH03AN602",
    OIS_REQUEST_API_URL: "/api/ois-data-requests",
    state: {
      dataparcRuntimeBusy: false,
      dataparcRuntimeTag: "",
      dataparcRuntimeStatus: "",
      operationSyncCompleted: false
    },
    stopMobileMutation: () => false,
    setDataparcRuntimeStatus: () => {},
    waitForDataparcRuntimeProbe: async () => {},
    apiRequest: async options => {
      apiCalls.push(plain(options));
      return apiCalls.length === 1
        ? { item: { id: "range-probe-1" } }
        : { message: "range synced" };
    },
    loadData: async () => {},
    showToast: () => {},
    renderAssets: () => {},
    console
  });

  vm.runInContext(
    `${extractFunction(clientSource, SYNC_FUNCTION_NAME)}\n` +
      `this.${SYNC_FUNCTION_NAME} = ${SYNC_FUNCTION_NAME};`,
    context
  );

  await context[SYNC_FUNCTION_NAME](
    "104ETH03AN602",
    "2026-08-15T00:00:00.000Z"
  );

  assert.equal(apiCalls.length, 2);
  assert.deepEqual(apiCalls[0].body, {
    action: "create_blower_runtime_probe",
    startAt: "2026-08-15T00:00:00.000Z"
  });
  assert.deepEqual(apiCalls[1].body, {
    action: "dataparc_runtime_sync",
    requestId: "range-probe-1"
  });
  assert.equal("startAt" in apiCalls[1].body, false);
});


test("frontend blocks unsupported assets and concurrent duplicate clicks", async () => {
  let apiCount = 0;
  const toasts = [];
  const context = vm.createContext({
    DATAPARC_RUNTIME_PILOT_TAG: "104ETH03AN602",
    OIS_REQUEST_API_URL: "/api/ois-data-requests",
    state: {
      dataparcRuntimeBusy: false
    },
    stopMobileMutation: () => false,
    setDataparcRuntimeStatus: () => {},
    waitForDataparcRuntimeProbe: async () => {},
    apiRequest: async () => {
      apiCount += 1;
      return { item: { id: "unexpected" } };
    },
    loadData: async () => {},
    showToast: (...args) => toasts.push(args),
    renderAssets: () => {},
    console
  });

  vm.runInContext(
    `${extractFunction(clientSource, SYNC_FUNCTION_NAME)}\n` +
      `this.${SYNC_FUNCTION_NAME} = ${SYNC_FUNCTION_NAME};`,
    context
  );

  await context[SYNC_FUNCTION_NAME]("104ETH03AN601");
  assert.equal(apiCount, 0);
  assert.equal(toasts.length, 1);

  context.state.dataparcRuntimeBusy = true;
  await context[SYNC_FUNCTION_NAME]("104ETH03AN602");
  assert.equal(apiCount, 0);
});


test("DataPARC range action is desktop-only, confirmed, and excludes startup-pending cycles", () => {
  assert.match(
    clientSource,
    /isDataparcRuntimePilot\s*&&\s*confirmed\s*&&\s*!startupPending\s*&&[\s\S]*?!isMobileMonitoringView\(\)/
  );
  assert.match(clientSource, /DataPARC 기간조회/);
  assert.match(clientSource, /openDataParcRuntimeDialog\s*\(/);
});


test("poller follows pending and processing until complete", async () => {
  const statuses = ["pending", "processing", "complete"];
  const waits = [];
  const renderedStatuses = [];
  const urls = [];

  const context = vm.createContext({
    DATAPARC_RUNTIME_PILOT_TAG: "104ETH03AN602",
    OIS_REQUEST_API_URL: "/api/ois-data-requests",
    apiRequest: async options => {
      urls.push(options.url);
      const status = statuses.shift();
      return {
        items: [{
          id: "probe-request-2",
          status
        }]
      };
    },
    setDataparcRuntimeStatus: (tag, status) => {
      renderedStatuses.push([tag, status]);
    },
    waitForMilliseconds: async milliseconds => waits.push(milliseconds),
    encodeURIComponent,
    Date,
    Error
  });

  vm.runInContext(
    `${extractFunction(clientSource, "waitForDataparcRuntimeProbe")}\n` +
      "this.waitForDataparcRuntimeProbe = waitForDataparcRuntimeProbe;",
    context
  );

  const item = await context.waitForDataparcRuntimeProbe("probe-request-2");

  assert.equal(item.status, "complete");
  assert.equal(urls.length, 3);
  assert.ok(urls.every(url =>
    url.includes("action=status_batch") &&
    url.includes("ids=probe-request-2")
  ));
  assert.deepEqual(waits, [3000, 3000]);
  assert.deepEqual(renderedStatuses, [
    ["104ETH03AN602", "대기 중"],
    ["104ETH03AN602", "계산 중"]
  ]);
});


test("poller treats failed as terminal and does not keep polling", async () => {
  let callCount = 0;
  const context = vm.createContext({
    DATAPARC_RUNTIME_PILOT_TAG: "104ETH03AN602",
    OIS_REQUEST_API_URL: "/api/ois-data-requests",
    apiRequest: async () => {
      callCount += 1;
      return {
        items: [{
          id: "probe-request-3",
          status: "failed",
          errorMessage: "Excel bridge failed"
        }]
      };
    },
    setDataparcRuntimeStatus: () => {},
    waitForMilliseconds: async () => {
      assert.fail("failed requests must not sleep or poll again");
    },
    encodeURIComponent,
    Date,
    Error
  });

  vm.runInContext(
    `${extractFunction(clientSource, "waitForDataparcRuntimeProbe")}\n` +
      "this.waitForDataparcRuntimeProbe = waitForDataparcRuntimeProbe;",
    context
  );

  await assert.rejects(
    context.waitForDataparcRuntimeProbe("probe-request-3"),
    /Excel bridge failed/
  );
  assert.equal(callCount, 1);
});


function runtimeUiFixture(options = {}) {
  const asset = {
    tagNumber: "104ETH03AN602",
    blowerType: "flyash_silo",
    unitNo: "shared",
    positionLabel: "#B",
    displayName: "Silo Aeration Blower 602",
    lastReplacementAt: "2026-05-03T15:00:00.000Z",
    cycleStartState: "legacy",
    cycleStartedAt: "2026-05-03T15:00:00.000Z",
    cycleStartRevision: "cycle-602",
    cycleRuntimeRevision: "runtime-after-sync",
    cycleRuntimeTracked: true,
    cycleElapsedHours: 40,
    isRunning: true,
    severity: "unset",
    ...options.asset
  };
  const elements = Object.fromEntries([
    "dataparcRuntimeDialogTag",
    "dataparcRuntimeDialogAsset",
    "dataparcRuntimeStartAt",
    "dataparcRuntimeMinimum",
    "dataparcRuntimePreviousBasis"
  ].map(key => [key, {
    value: "",
    textContent: "",
    hidden: false,
    focus() { this.focused = true; }
  }]));
  elements.dataparcRuntimeDialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
  const calls = [];
  const toasts = [];
  const context = vm.createContext({
    DATAPARC_RUNTIME_PILOT_TAG: "104ETH03AN602",
    OIS_REQUEST_API_URL: "/api/ois-data-requests",
    MOBILE_MONITORING_QUERY: "(max-width: 700px)",
    state: {
      data: {
        permissions: { canWrite: options.canWrite !== false },
        assets: [asset],
        events: options.events || [],
        backfill: { hasRun: true, status: "complete" }
      },
      dataparcRuntimeBusy: false
    },
    elements,
    window: {
      matchMedia: () => ({ matches: Boolean(options.mobile) }),
      setTimeout: callback => callback()
    },
    currentServerDate: () => new Date("2026-09-08T10:30:00.000Z"),
    showToast: (...args) => toasts.push(args),
    setDataparcRuntimeStatus: () => {},
    waitForDataparcRuntimeProbe: async requestId => calls.push({ poll: requestId }),
    apiRequest: async request => {
      calls.push(plain(request));
      return request.body.action === "create_blower_runtime_probe"
        ? { item: { id: "ui-period-request" } }
        : { message: "saved" };
    },
    loadData: async () => {},
    renderAssets: () => {},
    // These helpers only format the rest of the card; the eligibility and range paths below are real.
    roundHours: value => Number(value) || 0,
    displaySeverity: item => item.severity || "unset",
    readableEvidence: () => "V-Belt 교체 완료",
    fullEvidenceText: () => "V-Belt 교체 완료",
    evidenceSourceMeta: () => ({ label: "등록 이력", className: "other" }),
    emptyEvidenceMessage: () => "",
    projectedOperatingDueDate: () => "2026-09-08",
    addDaysToDate: () => "2026-09-08",
    formatOperatingDday: () => "-",
    formatRemainingDday: () => "-",
    formatSignedRemaining: () => "",
    formatDaysHours: value => String(value),
    formatCompactDaysHours: value => String(value),
    severityLabel: () => "기준 미설정",
    formatDate: value => String(value || "").slice(0, 10),
    console
  });
  const realFunctions = [
    "escapeHtml", "hasAuthenticatedWriteAccess", "isMobileMonitoringView",
    "stopMobileMutation", "findAsset", "getRawAssetEvents",
    "getLatestDataParcRuntimeBasis", "hasCanonicalBackfill", "shouldHideAutomaticData",
    "isShiftLogEvent", "getVisibleEvents", "getAssetEvents", "getLatestReplacementEvent",
    "isAssetAwaitingBackfill", "formatCardPosition", "renderAssetCard",
    "formatKstDateTimeInput", "formatKstDateTimeDisplay", "kstDateTimeInputToIso",
    "openDataParcRuntimeDialog", "submitDataParcRuntimeRange", "syncDataParcBlowerRuntime"
  ];
  vm.runInContext(
    realFunctions.map(name => extractFunction(clientSource, name)).join("\n") +
      `\nthis.ui = { ${realFunctions.join(", ")} };`,
    context
  );
  return { asset, elements, calls, toasts, state: context.state, ...context.ui };
}


function dataParcBasisEvent(overrides = {}, sourceOverrides = {}) {
  return {
    id: "basis-602",
    tagNumber: "104ETH03AN602",
    eventType: "runtime_correction",
    sourceType: "dataparc_runtime",
    eventDate: "2026-09-07T09:00:00.000Z",
    sourceText: JSON.stringify({
      startAt: "2026-08-15T00:00:00.000Z",
      observedAt: "2026-09-07T09:00:00.000Z",
      expectedLastReplacementAt: "2026-05-03T15:00:00.000Z",
      expectedCycleStartState: "legacy",
      expectedCycleStartedAt: "",
      expectedCycleStartRevision: "cycle-602",
      expectedCycleRuntimeRevision: "runtime-before-sync",
      ...sourceOverrides
    }),
    ...overrides
  };
}


test("legacy 602 card exposes a period query without a separately registered startup", () => {
  const ui = runtimeUiFixture();
  const html = ui.renderAssetCard(ui.asset, null);
  assert.match(html, /data-asset-action="dataparc_runtime_probe"[^>]*>DataPARC 기간조회/);
  assert.equal(ui.asset.cycleStartState, "legacy");
  assert.equal(ui.openDataParcRuntimeDialog(ui.asset.tagNumber), undefined);
  assert.equal(ui.elements.dataparcRuntimeDialog.open, true);
  assert.equal(ui.elements.dataparcRuntimeStartAt.value, "");
  assert.equal(ui.elements.dataparcRuntimeStartAt.min, "2026-05-04T00:00");
  assert.equal(ui.elements.dataparcRuntimeStartAt.max, "2026-09-08T19:30");
  assert.equal(ui.elements.dataparcRuntimePreviousBasis.hidden, true);
});


test("period dialog rounds its minimum upward to avoid selecting before replacement seconds", () => {
  const ui = runtimeUiFixture({ asset: { lastReplacementAt: "2026-05-03T15:00:20.000Z" } });
  ui.openDataParcRuntimeDialog(ui.asset.tagNumber);
  assert.equal(ui.elements.dataparcRuntimeStartAt.min, "2026-05-04T00:01");
});


test("real dialog submission converts KST input then creates, polls, and syncs by request ID", async () => {
  const ui = runtimeUiFixture();
  ui.openDataParcRuntimeDialog(ui.asset.tagNumber);
  ui.elements.dataparcRuntimeStartAt.value = "2026-08-15T09:00";
  let prevented = false;
  await ui.submitDataParcRuntimeRange({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(ui.elements.dataparcRuntimeDialog.open, false);
  assert.deepEqual(ui.calls, [
    {
      method: "POST",
      url: "/api/ois-data-requests",
      body: { action: "create_blower_runtime_probe", startAt: "2026-08-15T00:00:00.000Z" }
    },
    { poll: "ui-period-request" },
    { method: "POST", body: { action: "dataparc_runtime_sync", requestId: "ui-period-request" } }
  ]);
  assert.equal(ui.state.dataparcRuntimeBusy, false);
});


test("blank and pre-replacement dialog input never sends a request", async () => {
  const ui = runtimeUiFixture();
  ui.openDataParcRuntimeDialog(ui.asset.tagNumber);
  for (const value of ["", "not-a-date", "2026-05-03T23:59"]) {
    ui.elements.dataparcRuntimeStartAt.value = value;
    await ui.submitDataParcRuntimeRange({ preventDefault() {} });
    assert.equal(ui.elements.dataparcRuntimeDialog.open, true);
  }
  assert.deepEqual(ui.calls, []);
});


test("mobile and public views omit the DataPARC button and reject forced open or submit", async () => {
  for (const options of [{ mobile: true }, { canWrite: false }]) {
    const ui = runtimeUiFixture(options);
    assert.doesNotMatch(ui.renderAssetCard(ui.asset, null), /data-asset-action="dataparc_runtime_probe"/);
    ui.openDataParcRuntimeDialog(ui.asset.tagNumber);
    assert.equal(ui.elements.dataparcRuntimeDialog.open, false);
    ui.elements.dataparcRuntimeDialogTag.value = ui.asset.tagNumber;
    ui.elements.dataparcRuntimeStartAt.value = "2026-08-15T09:00";
    await ui.submitDataParcRuntimeRange({ preventDefault() {} });
    await ui.syncDataParcBlowerRuntime(ui.asset.tagNumber, "2026-08-15T00:00:00.000Z");
    assert.deepEqual(ui.calls, []);
  }
});


test("startup pending and unconfirmed assets do not expose the period query", () => {
  for (const asset of [{ cycleStartState: "pending" }, { lastReplacementAt: "" }]) {
    const ui = runtimeUiFixture({ asset });
    assert.doesNotMatch(ui.renderAssetCard(ui.asset, null), /data-asset-action="dataparc_runtime_probe"/);
    ui.openDataParcRuntimeDialog(ui.asset.tagNumber);
    assert.equal(ui.elements.dataparcRuntimeDialog.open, false);
  }
});


test("the current cycle baseline remains valid after the sync advances runtime revision", () => {
  const event = dataParcBasisEvent();
  const ui = runtimeUiFixture({ events: [event] });
  assert.equal(ui.getLatestDataParcRuntimeBasis(ui.asset.tagNumber)?.event.id, event.id);
  assert.match(ui.renderAssetCard(ui.asset, null), /class="dataparc-runtime-basis"/);
  ui.openDataParcRuntimeDialog(ui.asset.tagNumber);
  assert.equal(ui.elements.dataparcRuntimeStartAt.value, "2026-08-15T09:00");
  assert.equal(ui.elements.dataparcRuntimePreviousBasis.hidden, false);
});


test("old or unverifiable cycle baselines never label a new cycle or prefill its dialog", () => {
  const cases = [
    dataParcBasisEvent({}, { startAt: "2026-03-01T00:00:00.000Z" }),
    dataParcBasisEvent({}, { expectedLastReplacementAt: "2026-04-03T15:00:00.000Z" }),
    dataParcBasisEvent({}, { expectedCycleStartRevision: "different-cycle-at-same-time" }),
    dataParcBasisEvent({}, { expectedCycleStartState: "started" }),
    dataParcBasisEvent({}, { expectedCycleStartRevision: undefined }),
    dataParcBasisEvent({}, { expectedLastReplacementAt: undefined }),
    dataParcBasisEvent({ eventDate: "2026-05-01T00:00:00.000Z" }),
    dataParcBasisEvent({}, { observedAt: "2026-08-14T00:00:00.000Z" }),
    dataParcBasisEvent({ sourceText: "{malformed" })
  ];
  for (const event of cases) {
    const ui = runtimeUiFixture({ events: [event] });
    assert.equal(ui.getLatestDataParcRuntimeBasis(ui.asset.tagNumber), null);
    assert.doesNotMatch(ui.renderAssetCard(ui.asset, null), /class="dataparc-runtime-basis"/);
    ui.openDataParcRuntimeDialog(ui.asset.tagNumber);
    assert.equal(ui.elements.dataparcRuntimeStartAt.value, "");
    assert.equal(ui.elements.dataparcRuntimePreviousBasis.hidden, true);
  }
});


test("started-cycle baseline matches the actual startup and chooses latest eligible event", () => {
  const startedAt = "2026-05-05T00:00:00.000Z";
  const valid = dataParcBasisEvent({ id: "current-cycle" }, {
    expectedCycleStartState: "started", expectedCycleStartedAt: startedAt
  });
  const invalid = dataParcBasisEvent({ id: "later-wrong-start", eventDate: "2026-09-08T09:00:00.000Z" }, {
    expectedCycleStartState: "started", expectedCycleStartedAt: "2026-05-06T00:00:00.000Z"
  });
  const ui = runtimeUiFixture({
    asset: { cycleStartState: "started", cycleStartedAt: startedAt },
    events: [valid, invalid]
  });
  assert.equal(ui.getLatestDataParcRuntimeBasis(ui.asset.tagNumber)?.event.id, valid.id);
});
