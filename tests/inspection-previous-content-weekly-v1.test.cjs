"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const TARGET_DATE = "2026-11-09";
const SOURCE_DATE = "2026-11-02";
const NEXT_DATE = "2026-11-16";
const plain = value => JSON.parse(JSON.stringify(value));
const definitions = {
  gas: {
    file: "high-pressure-gas/high-pressure-gas", prefix: "gas", shift: "DS",
    endpoint: "/api/inspection-logs/high-pressure-gas", button: "importPreviousGasButton",
    draftPrefix: "inspectionLogs.weekly.highPressureGas.draft.", editId: "gasOverallResult"
  },
  lng: {
    file: "lng-weekly/lng-weekly", prefix: "lng", shift: "DS",
    endpoint: "/api/inspection-logs/lng-weekly", button: "importPreviousLngButton",
    draftPrefix: "inspectionLogs.weekly.lng.draft.", editId: "lngContent1"
  },
  soot: {
    file: "soot-blower/soot-blower-weekly", prefix: "soot", shift: "NS",
    endpoint: "/api/inspection-logs/soot-blower-weekly", button: "importPreviousSootButton",
    draftPrefix: "inspectionLogs.weekly.sootBlower.draft.", editId: "sootUnit1Remark1"
  }
};

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.disabled = false;
    this.hidden = true;
    this.textContent = "";
    this.innerHTML = "";
    this.dataset = {};
    this.style = {};
    this.handlers = new Map();
    this.attributes = new Map();
    this.children = [];
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name)
    };
  }
  addEventListener(name, callback) {
    if (!this.handlers.has(name)) this.handlers.set(name, []);
    this.handlers.get(name).push(callback);
  }
  dispatch(name, event = {}) {
    for (const callback of this.handlers.get(name) || []) callback(event);
  }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest() { return null; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(child) { this.children.push(child); return child; }
  cloneNode() { return new FakeElement(); }
  replaceWith() {}
  focus() {}
}
class FakeInput extends FakeElement {}
class FakeTextarea extends FakeElement {}
class FakeSelect extends FakeElement {}

function jsonResponse(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function fixedSootRows(label) {
  return [
    ...Array.from({ length: 16 }, (_, index) => ({
      key: `eco-${index + 11}`, type: "Eco Side S.B", number: String(index + 11)
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      key: `super-heater-${index + 1}`, type: "Super Heater Side S.B", number: String(index + 1)
    })),
    ...["A-1", "A-2", "A-3", "A-4", "B-1", "B-2", "B-3", "B-4"].map(number => ({
      key: `acoustic-${number.toLowerCase()}`, type: "음파식 제매기", number
    }))
  ].map((item, index) => ({
    ...item, status: index === 0 ? "X" : "O",
    remark: `${label} ${index + 1} 특이사항`,
    occurrenceDate: index === 0 ? "2026-10-19" : ""
  }));
}

function fixture(kind) {
  const spec = definitions[kind];
  const stem = path.join(__dirname, "../inspection-logs/weekly", spec.file);
  const html = fs.readFileSync(stem + ".html", "utf8");
  const tags = new Map();
  for (const match of html.matchAll(/<(input|textarea|select)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    tags.set(match[2], match[1]);
  }
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) {
      const tag = tags.get(id) || (/^sootUnit[12]Status\d+$/.test(id) ? "select" : "input");
      const Type = tag === "textarea" ? FakeTextarea : tag === "select" ? FakeSelect : FakeInput;
      elements.set(id, new Type(id));
    }
    return elements.get(id);
  };
  const lngWriteHtml = html.split('id="lngArchiveView"')[0];
  const lngFields = kind === "lng" ? Array.from(
    lngWriteHtml.matchAll(/<(?:input|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/g),
    match => getElement(match[1])
  ) : [];
  if (kind === "lng") {
    getElement("lngWriteView").querySelectorAll = selector =>
      selector === "input[id], textarea[id]" ? lngFields : [];
  }

  const storage = new Map([
    ["gsShiftLog.currentUser", JSON.stringify({ sessionToken: "current-token", name: "현재 사용자", role: "user" })],
    [spec.draftPrefix + SOURCE_DATE, "원본 날짜의 기존 복구 초안"]
  ]);
  const storageWrites = [];
  const storageRemovals = [];
  const calls = [];
  const scheduleEvents = [];
  const alerts = [];
  const timers = new Map();
  const ready = [];
  const windowHandlers = new Map();
  let timerId = 0;
  let adapter;
  let responder;
  const sandbox = {
    document: {
      body: new FakeElement("body"),
      getElementById: getElement,
      querySelector: selector => getElement(selector),
      querySelectorAll: () => [],
      createElement: () => new FakeElement(),
      addEventListener: (name, callback) => { if (name === "DOMContentLoaded") ready.push(callback); }
    },
    HTMLInputElement: FakeInput, HTMLTextAreaElement: FakeTextarea,
    HTMLSelectElement: FakeSelect, Element: FakeElement,
    Headers, URL, AbortController,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem(key, value) { storageWrites.push({ key, value }); storage.set(key, value); },
      removeItem(key) { storageRemovals.push(key); storage.delete(key); }
    },
    location: { origin: "https://fixture.invalid" },
    parent: { postMessage: (...args) => scheduleEvents.push(args) },
    console: { log() {}, warn() {}, error() {} },
    alert: message => alerts.push(message),
    confirm: () => true,
    print() {},
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener(name, callback) {
      if (!windowHandlers.has(name)) windowHandlers.set(name, []);
      windowHandlers.get(name).push(callback);
    },
    GSInspectionPreviousContent: { create: options => { adapter = options; return {}; } },
    fetch: async (url, options = {}) => {
      calls.push({ url, options });
      return responder(url, options);
    }
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const originalSource = fs.readFileSync(stem + ".js", "utf8");
  const marker = "  /* =======================================================\n    최초 실행\n  ======================================================= */";
  assert.equal(originalSource.split(marker).length, 2, `${kind}: initialization boundary is unique`);
  // Bind and execute the real adapter, transport, form collection/application,
  // draft, print/unload and save code. Skip only automatic startup loading; the
  // tests explicitly load their target records through the real form function.
  const exposed = `
    globalThis.weeklyTest = {
      applyLog: applyLogToForm,
      load: loadLogForDate,
      save: saveInspectionLog,
      collect: collectFormData,
      dirty: markDirty,
      saveDraft: saveRecoveryDraft,
      preview: openPrintPreview,
      setBusy: setToolbarBusy,
      getState: function () {
        return { date: inspectionDate.value, id: currentLogId,
          revision: currentRevision, lastLoadedDate, isDirty, importedDraftNeedsSave,
          form: collectFormData()${kind !== "soot" ? ", templateItems: cloneTemplateItems(currentTemplateItems), canEditTemplate" : ""}
        };
      }
    };
    return;
  `;
  vm.runInContext(originalSource.replace(marker, exposed + marker), context, { filename: spec.file + ".js" });
  ready[0]();
  assert.ok(adapter, `${kind}: previous-content adapter registers`);
  const app = sandbox.weeklyTest;
  const initial = plain(app.getState());

  function form(label) {
    if (kind === "gas") return {
      safetyManager: `${label} 안전책임자`, safetyGeneralManager: `${label} 총괄책임자`,
      inspectorName: `${label} 점검자`, overallResult: `${label} 종합의견`,
      results: Array.from({ length: 12 }, (_, index) => `${label} 결과 ${index + 1}`),
      workplaceConfirmation: `${label} 현장확인`, finalInspector: `${label} 최종확인`
    };
    if (kind === "lng") {
      const fields = Object.fromEntries(lngFields
        .filter(element => element.id !== "lngInspectionDate")
        .map(element => [element.id, `${label} ${element.id}`]));
      return { fields, inspectorName: fields.lngInspectorName, remark: fields.lngRemark };
    }
    return {
      partLeaderApproval: `${label} 파트장`, unit1Inspector: `${label} 1호기 점검자`,
      unit2Inspector: `${label} 2호기 점검자`,
      units: { unit1: fixedSootRows(label + " 1호기"), unit2: fixedSootRows(label + " 2호기") }
    };
  }
  function log(date, label, revision) {
    return {
      id: `${kind}-${label}`, inspectionDate: date, shift: spec.shift,
      status: "저장완료", serverRevision: revision, form: form(label),
      ...(kind !== "soot" ? { templateItems: plain(initial.templateItems) } : {}),
      authorId: `${label}-author`, authorName: `${label} 작성자`,
      createdAt: "2026-10-20T01:00:00Z", updatedAt: "2026-11-02T01:00:00Z",
      canDelete: true, source: "shared-d1"
    };
  }
  const targetLog = log(TARGET_DATE, "target", 4);
  const sourceLog = log(SOURCE_DATE, "source", 8);
  app.applyLog(targetLog);
  responder = (url, options) => {
    const parsed = new URL(url, sandbox.location.origin);
    if (options.method === "POST") {
      if (parsed.pathname === "/api/inspection-schedule-status") return jsonResponse({ ok: true });
      const body = JSON.parse(options.body);
      return jsonResponse({ ok: true, created: false, log: { ...body.log, serverRevision: body.expectedRevision + 1 } });
    }
    if (parsed.searchParams.get("date") === SOURCE_DATE) return jsonResponse({ ok: true, log: sourceLog, canEditTemplate: true });
    if (parsed.searchParams.get("date") === NEXT_DATE) return jsonResponse({ ok: true, log: log(NEXT_DATE, "next", 2) });
    if (parsed.searchParams.has("date")) return jsonResponse({ ok: true, log: targetLog });
    return jsonResponse({ ok: true, logs: [targetLog] });
  };
  return {
    kind, spec, app, adapter, getElement, targetLog, sourceLog, storage,
    storageWrites, storageRemovals, calls, scheduleEvents, alerts, timers,
    setResponder: value => { responder = value; },
    state: () => plain(app.getState()),
    read: () => adapter.read({ date: SOURCE_DATE }, { signal: new AbortController().signal }),
    async import() {
      const content = await adapter.read({ date: SOURCE_DATE }, { signal: new AbortController().signal });
      adapter.apply(content, { date: SOURCE_DATE });
      return content;
    },
    flushTimers() {
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
    unload() {
      let prevented = false;
      const event = { preventDefault() { prevented = true; }, returnValue: undefined };
      for (const callback of windowHandlers.get("beforeunload") || []) callback(event);
      return { prevented, returnValue: event.returnValue };
    }
  };
}

function assertNoPersistence(h) {
  assert.equal(h.storageWrites.length, 0, `${h.kind}: no draft storage writes`);
  assert.equal(h.storageRemovals.length, 0, `${h.kind}: no draft deletion`);
  assert.equal(h.calls.filter(call => call.options.method && call.options.method !== "GET").length, 0, `${h.kind}: no writes to APIs`);
  assert.equal(h.scheduleEvents.length, 0, `${h.kind}: no completion notification`);
}

test("all three adapters copy technical content into the current identity and clear approvals without mutating the source", async () => {
  for (const kind of Object.keys(definitions)) {
    const h = fixture(kind);
    const before = h.state();
    const sourceBefore = JSON.stringify(h.sourceLog);
    const controller = new AbortController();
    assert.equal(h.adapter.button.id, h.spec.button);
    assert.equal(h.adapter.defaultDays, 7);
    const content = await h.adapter.read({ date: SOURCE_DATE }, { signal: controller.signal });
    assert.equal(h.calls[0].url, h.spec.endpoint + "?date=" + SOURCE_DATE);
    assert.equal(h.calls[0].options.signal, controller.signal);
    assert.equal(new Headers(h.calls[0].options.headers).get("Authorization"), "Bearer current-token");
    h.adapter.apply(content, { date: SOURCE_DATE });
    const after = h.state();
    for (const field of ["date", "id", "revision", "lastLoadedDate"]) assert.equal(after[field], before[field], `${kind}: ${field} remains current`);
    assert.deepEqual(after.templateItems, before.templateItems);
    assert.equal(after.canEditTemplate, before.canEditTemplate);
    assert.equal(after.isDirty, true);
    assert.equal(after.importedDraftNeedsSave, true);
    assert.equal(h.adapter.isDirty(), true);
    assert.equal(h.adapter.getTarget().date, TARGET_DATE);
    assert.equal(JSON.parse(h.adapter.getSnapshot()).id, before.id);
    if (kind === "gas") {
      assert.equal(after.form.inspectorName, h.sourceLog.form.inspectorName);
      assert.deepEqual(after.form.results, h.sourceLog.form.results);
      assert.equal(after.form.overallResult, h.sourceLog.form.overallResult);
      for (const key of ["safetyManager", "safetyGeneralManager", "workplaceConfirmation", "finalInspector"]) assert.equal(after.form[key], "");
    } else if (kind === "lng") {
      assert.equal(after.form.fields.lngContent1, h.sourceLog.form.fields.lngContent1);
      assert.equal(after.form.fields.lngAction19Aux2, h.sourceLog.form.fields.lngAction19Aux2);
      assert.equal(after.form.inspectorName, h.sourceLog.form.fields.lngInspectorName);
      assert.equal(after.form.remark, h.sourceLog.form.fields.lngRemark);
      assert.equal(after.form.fields.lngPartLeaderApproval, "");
      assert.equal(after.form.fields.lngTeamLeaderApproval, "");
    } else {
      assert.equal(after.form.partLeaderApproval, "");
      assert.equal(after.form.unit1Inspector, h.sourceLog.form.unit1Inspector);
      assert.equal(after.form.units.unit1.length, 34);
      assert.equal(after.form.units.unit2.length, 34);
      assert.equal(after.form.units.unit1[0].status, "X");
      assert.equal(after.form.units.unit1[0].occurrenceDate, "2026-10-19");
      assert.equal(after.form.units.unit2[33].remark, h.sourceLog.form.units.unit2[33].remark);
    }
    assert.equal(JSON.stringify(h.sourceLog), sourceBefore);
    assert.match(h.getElement(h.spec.prefix + "CheckSaveState").textContent, /확인 후 일지 저장/);
    assertNoPersistence(h);
  }
});

test("absent, malformed or mismatched records never replace the current form", async () => {
  for (const kind of Object.keys(definitions)) {
    const h = fixture(kind);
    const before = h.state();
    const badLogs = [
      null, [], {},
      { ...h.sourceLog, inspectionDate: TARGET_DATE },
      { ...h.sourceLog, shift: kind === "soot" ? "DS" : "NS" },
      { ...h.sourceLog, form: [] }
    ];
    for (const payload of [{ ok: true }, { log: h.sourceLog }, ...badLogs.map(log => ({ ok: true, log }))]) {
      h.setResponder(() => jsonResponse(payload));
      await assert.rejects(h.read(), /응답|없습니다|확인할 수 없습니다/);
      assert.deepEqual(h.state(), before, `${kind}: invalid response retains the current form`);
    }
    assertNoPersistence(h);
  }
});

test("required row structures and soot item identities are checked before applying any values", async () => {
  for (const kind of Object.keys(definitions)) {
    const h = fixture(kind);
    const before = h.state();
    const invalid = plain(h.sourceLog);
    if (kind === "gas") invalid.form.results.pop();
    if (kind === "lng") invalid.form.fields = [];
    if (kind === "soot") invalid.form.units.unit2.pop();
    h.setResponder(() => jsonResponse({ ok: true, log: invalid }));
    await assert.rejects(h.read());
    const malformedValue = plain(h.sourceLog);
    if (kind === "gas") malformedValue.form.results[0] = { misleading: "value" };
    if (kind === "lng") malformedValue.form.fields.lngContent1 = { misleading: "value" };
    if (kind === "soot") malformedValue.form.units.unit1[0].status = "양호";
    h.setResponder(() => jsonResponse({ ok: true, log: malformedValue }));
    await assert.rejects(h.read());
    if (kind === "soot") {
      for (const field of ["key", "type", "number"]) {
        const wrongIdentity = plain(h.sourceLog);
        wrongIdentity.form.units.unit1[0][field] = "another item";
        h.setResponder(() => jsonResponse({ ok: true, log: wrongIdentity }));
        await assert.rejects(h.read(), /점검항목이 달라/);
      }
    }
    assert.deepEqual(h.state(), before);
    assertNoPersistence(h);
  }
});

test("gas and LNG require a complete matching template and retain the target template", async () => {
  for (const kind of ["gas", "lng"]) {
    const h = fixture(kind);
    const before = h.state();
    const badTemplates = [undefined, [], h.sourceLog.templateItems.slice(1)];
    const renamed = plain(h.sourceLog.templateItems);
    renamed[0].item = "의미가 다른 점검항목";
    badTemplates.push(renamed);
    const malformed = plain(h.sourceLog.templateItems);
    delete malformed[0].item;
    badTemplates.push(malformed);
    if (kind === "gas") {
      const missingDescription = plain(h.sourceLog.templateItems);
      delete missingDescription[0].description;
      badTemplates.push(missingDescription);
    }
    for (const templateItems of badTemplates) {
      h.setResponder(() => jsonResponse({ ok: true, log: { ...h.sourceLog, templateItems } }));
      await assert.rejects(h.read(), /점검항목/);
    }
    const equivalent = plain(h.sourceLog.templateItems);
    equivalent[0].item = "  " + equivalent[0].item + "  ";
    h.setResponder(() => jsonResponse({ ok: true, log: { ...h.sourceLog, templateItems: equivalent } }));
    const content = await h.read();
    h.adapter.apply(content, { date: SOURCE_DATE });
    assert.deepEqual(h.state().templateItems, before.templateItems);
    assertNoPersistence(h);
  }
});

test("omitted optional fields become blank instead of mixing previous and current contents", async () => {
  for (const kind of Object.keys(definitions)) {
    const h = fixture(kind);
    if (kind === "gas") {
      delete h.sourceLog.form.overallResult;
      h.sourceLog.form.results[0] = 0;
    } else if (kind === "lng") {
      delete h.sourceLog.form.fields.lngContent1;
      h.sourceLog.form.fields.lngContent2 = 0;
      h.sourceLog.form.fields.lngInspectionDate = SOURCE_DATE;
      h.sourceLog.form.fields.unrelatedInput = "must not copy";
    } else {
      delete h.sourceLog.form.unit2Inspector;
      delete h.sourceLog.form.units.unit1[0].remark;
    }
    await h.import();
    const current = h.state();
    assert.equal(current.date, TARGET_DATE);
    if (kind === "gas") {
      assert.equal(current.form.overallResult, "");
      assert.equal(current.form.results[0], "0");
    } else if (kind === "lng") {
      assert.equal(current.form.fields.lngContent1, "");
      assert.equal(current.form.fields.lngContent2, "0");
      assert.equal(Object.hasOwn(current.form.fields, "lngInspectionDate"), false);
      assert.equal(Object.hasOwn(current.form.fields, "unrelatedInput"), false);
    } else {
      assert.equal(current.form.unit2Inspector, "");
      assert.equal(current.form.units.unit1[0].remark, "");
    }
    assertNoPersistence(h);
  }
});

test("import cancels an old draft timer and editing, print preview and unload cannot persist the imported draft", async () => {
  for (const kind of Object.keys(definitions)) {
    const h = fixture(kind);
    h.getElement(h.spec.editId).value = "기존 미저장 변경";
    h.app.dirty();
    assert.equal(h.timers.size, 1);
    let completeLookup;
    h.setResponder(() => new Promise(resolve => { completeLookup = resolve; }));
    const reading = h.read();
    assert.equal(h.timers.size, 0, `${kind}: the timer is canceled before the import lookup resolves`);
    h.flushTimers();
    assertNoPersistence(h);
    completeLookup(jsonResponse({ ok: true, log: h.sourceLog }));
    h.adapter.apply(await reading, { date: SOURCE_DATE });
    assert.equal(h.timers.size, 0, `${kind}: the previous timer is canceled`);
    h.app.preview();
    assert.deepEqual(h.unload(), { prevented: true, returnValue: "" });
    h.getElement(h.spec.editId).value = "가져온 후 직접 수정";
    h.app.dirty();
    h.flushTimers();
    h.app.saveDraft();
    assert.equal(h.state().importedDraftNeedsSave, true);
    assert.equal(h.state().isDirty, true);
    assertNoPersistence(h);
    assert.equal(h.storage.get(h.spec.draftPrefix + SOURCE_DATE), "원본 날짜의 기존 복구 초안");
  }
});

test("only explicit save posts the current date, ID and revision, then restores ordinary draft behavior", async () => {
  for (const kind of Object.keys(definitions)) {
    const h = fixture(kind);
    const sourceBefore = JSON.stringify(h.sourceLog);
    await h.import();
    assertNoPersistence(h);
    const importedForm = h.state().form;
    await h.app.save();
    const posts = h.calls.filter(call => call.options.method === "POST");
    assert.equal(posts.length, 2, `${kind}: one explicit log save and its existing schedule update`);
    assert.equal(posts[0].url, h.spec.endpoint);
    const body = JSON.parse(posts[0].options.body);
    assert.equal(body.log.id, h.targetLog.id);
    assert.equal(body.log.inspectionDate, TARGET_DATE);
    assert.equal(body.expectedRevision, 4);
    assert.equal(body.log.shift, h.spec.shift);
    assert.equal(body.log.status, "저장완료");
    assert.deepEqual(body.log.form, importedForm);
    if (kind !== "soot") assert.deepEqual(body.log.templateItems, h.targetLog.templateItems);
    assert.equal(posts[1].url, "/api/inspection-schedule-status");
    assert.equal(JSON.parse(posts[1].options.body).dueDate, kind === "soot" ? "2026-11-08" : TARGET_DATE);
    assert.equal(h.state().id, h.targetLog.id);
    assert.equal(h.state().revision, 5);
    assert.equal(h.state().importedDraftNeedsSave, false);
    assert.equal(h.state().isDirty, false);
    assert.equal(JSON.stringify(h.sourceLog), sourceBefore);
    assert.equal(h.storage.get(h.spec.draftPrefix + SOURCE_DATE), "원본 날짜의 기존 복구 초안");
    h.getElement(h.spec.editId).value = "정상 저장 후 새 수정";
    h.app.dirty();
    h.flushTimers();
    assert.equal(h.storageWrites.length, 1, `${kind}: normal draft behavior resumes after successful save`);
    assert.equal(h.storageWrites[0].key, h.spec.draftPrefix + TARGET_DATE);
  }
});

test("a failed explicit save retains the imported draft in memory and does not mark the schedule complete", async () => {
  for (const kind of Object.keys(definitions)) {
    const h = fixture(kind);
    await h.import();
    const before = h.state();
    h.setResponder(() => jsonResponse({ ok: false, message: "저장 실패" }, 500));
    await h.app.save();
    assert.deepEqual(h.state(), before);
    h.app.preview();
    h.unload();
    h.app.saveDraft();
    assert.equal(h.storageWrites.length, 0);
    assert.equal(h.storageRemovals.length, 0);
    assert.equal(h.scheduleEvents.length, 0);
    assert.equal(h.calls.filter(call => call.url === "/api/inspection-schedule-status").length, 0);
    assert.equal(h.adapter.button.disabled, false);
  }
});

test("date loading cancels the outgoing timer and resets the imported flag only when a normal record loads", async () => {
  for (const kind of Object.keys(definitions)) {
    const h = fixture(kind);
    h.app.dirty();
    assert.equal(h.timers.size, 1);
    let completeLookup;
    h.setResponder(() => new Promise(resolve => { completeLookup = resolve; }));
    const loading = h.app.load(NEXT_DATE);
    assert.equal(h.timers.size, 0, `${kind}: cancel before the next date request resolves`);
    h.flushTimers();
    assert.equal(h.storageWrites.length, 0);
    completeLookup(jsonResponse({ ok: true, log: { ...h.targetLog, inspectionDate: NEXT_DATE, id: `${kind}-next` } }));
    await loading;
    assert.equal(h.timers.size, 0);
    assert.equal(h.state().date, NEXT_DATE);
    assert.equal(h.storageWrites.length, 0);
    h.setResponder(() => jsonResponse({ ok: true, log: h.sourceLog }));
    await h.import();
    h.storageRemovals.length = 0;
    const beforeFailure = h.state();
    h.setResponder(() => jsonResponse({ ok: false, message: "조회 실패" }, 503));
    await h.app.load(TARGET_DATE);
    assert.deepEqual(h.state(), beforeFailure);
    h.app.saveDraft();
    assert.equal(h.storageWrites.length, 0);
    h.setResponder(() => jsonResponse({ ok: true, log: h.targetLog }));
    await h.app.load(TARGET_DATE);
    assert.equal(h.state().importedDraftNeedsSave, false);
    assert.equal(h.state().date, TARGET_DATE);
    h.app.dirty();
    h.flushTimers();
    assert.equal(h.storageWrites.length, 1);

    h.setResponder(() => jsonResponse({ ok: true, log: h.sourceLog }));
    await h.import();
    h.setResponder(url => jsonResponse(new URL(url, "https://fixture.invalid").searchParams.has("date")
      ? { ok: true, log: null } : { ok: true, logs: [] }));
    await h.app.load("2026-11-23");
    assert.equal(h.state().date, "2026-11-23");
    assert.equal(h.state().id, "");
    assert.equal(h.state().revision, 0);
    assert.equal(h.state().importedDraftNeedsSave, false, `${kind}: a successfully cleared new date restores ordinary drafts`);
    h.getElement(h.spec.editId).value = "새 날짜 작성";
    h.app.dirty();
    h.flushTimers();
    assert.equal(h.storageWrites.length, 2);
    assert.equal(h.storageWrites.at(-1).key, h.spec.draftPrefix + "2026-11-23");
  }
});

test("import controls follow toolbar busy state and each read uses the current authenticated session and supplied signal", async () => {
  for (const kind of Object.keys(definitions)) {
    const h = fixture(kind);
    h.app.setBusy(true);
    assert.equal(h.adapter.button.disabled, true);
    assert.equal(h.adapter.isBusy(), true);
    h.app.setBusy(false);
    assert.equal(h.adapter.button.disabled, false);
    assert.equal(h.adapter.isBusy(), false);
    h.storage.set("gsShiftLog.currentUser", JSON.stringify({ session_token: " refreshed-token " }));
    const controller = new AbortController();
    await h.adapter.read({ date: SOURCE_DATE }, { signal: controller.signal });
    assert.equal(new Headers(h.calls.at(-1).options.headers).get("Authorization"), "Bearer refreshed-token");
    assert.equal(h.calls.at(-1).options.signal, controller.signal);
    const count = h.calls.length;
    h.storage.delete("gsShiftLog.currentUser");
    await assert.rejects(h.read(), /로그인 정보가 없습니다/);
    assert.equal(h.calls.length, count);
    assert.equal(h.state().importedDraftNeedsSave, false);
    assertNoPersistence(h);
  }
});

test("a date input changed before a failed target lookup cannot import into the previous record identity", async () => {
  for (const kind of Object.keys(definitions)) {
    const h = fixture(kind);
    // A real date input changes before its change handler starts the lookup.
    h.getElement(h.spec.prefix + "InspectionDate").value = NEXT_DATE;
    h.setResponder(() => jsonResponse({ ok: false, message: "대상 날짜 조회 실패" }, 503));
    await h.app.load(NEXT_DATE);
    h.app.dirty();
    const before = h.state();
    assert.equal(before.date, NEXT_DATE);
    assert.equal(before.lastLoadedDate, TARGET_DATE);
    assert.equal(before.id, h.targetLog.id);
    assert.equal(before.revision, 4);
    assert.equal(JSON.parse(h.adapter.getSnapshot()).lastLoadedDate, TARGET_DATE);
    const callCount = h.calls.length;
    const timerCount = h.timers.size;
    await assert.rejects(h.read(), /현재 선택한 날짜의 일지 조회가 완료되지 않았습니다.*다시 선택/);
    assert.equal(h.calls.length, callCount, `${kind}: reject before requesting the source date`);
    assert.equal(h.timers.size, timerCount, `${kind}: reject before changing existing draft timers`);
    assert.deepEqual(h.state(), before, `${kind}: rejected import preserves the displayed date and old identity/content`);
    assertNoPersistence(h);

    const nextLog = { ...h.targetLog, id: `${kind}-next`, inspectionDate: NEXT_DATE, serverRevision: 2 };
    h.setResponder(() => jsonResponse({ ok: true, log: nextLog }));
    await h.app.load(NEXT_DATE);
    assert.equal(JSON.parse(h.adapter.getSnapshot()).lastLoadedDate, NEXT_DATE);
    h.setResponder(() => jsonResponse({ ok: true, log: h.sourceLog }));
    await h.import();
    assert.equal(h.state().date, NEXT_DATE);
    assert.equal(h.state().lastLoadedDate, NEXT_DATE);
    assert.equal(h.state().id, nextLog.id);
    assert.equal(h.state().revision, 2);
    assert.equal(h.state().importedDraftNeedsSave, true);
    assert.equal(h.storageWrites.length, 0);
    assert.equal(h.calls.filter(call => call.options.method === "POST").length, 0);
  }
});

test("an imported draft cannot save with the previous ID after the visible target date lookup fails", async () => {
  for (const kind of Object.keys(definitions)) {
    const h = fixture(kind);
    const sourceBefore = JSON.stringify(h.sourceLog);
    await h.import();
    h.getElement(h.spec.prefix + "InspectionDate").value = NEXT_DATE;
    h.setResponder(() => jsonResponse({ ok: false, message: "새 대상 날짜 조회 실패" }, 503));
    await h.app.load(NEXT_DATE);
    const before = h.state();
    assert.equal(before.date, NEXT_DATE);
    assert.equal(before.lastLoadedDate, TARGET_DATE);
    assert.equal(before.id, h.targetLog.id);
    assert.equal(before.importedDraftNeedsSave, true);
    const callCount = h.calls.length;
    await h.app.save();
    assert.equal(h.calls.length, callCount, `${kind}: reject the save before any API request`);
    assert.deepEqual(h.state(), before, `${kind}: rejected save preserves imported contents and metadata`);
    assert.match(h.alerts.at(-1), /현재 선택한 날짜의 일지 조회가 완료되지 않았습니다.*저장/);
    assertNoPersistence(h);

    const nextLog = { ...h.targetLog, id: `${kind}-next`, inspectionDate: NEXT_DATE, serverRevision: 2 };
    h.setResponder((url, options) => {
      if (options.method === "POST") {
        if (url === "/api/inspection-schedule-status") return jsonResponse({ ok: true });
        const body = JSON.parse(options.body);
        return jsonResponse({ ok: true, created: false, log: { ...body.log, serverRevision: body.expectedRevision + 1 } });
      }
      return jsonResponse({ ok: true, log: new URL(url, "https://fixture.invalid").searchParams.get("date") === SOURCE_DATE
        ? h.sourceLog : nextLog });
    });
    await h.app.load(NEXT_DATE);
    assert.equal(h.state().importedDraftNeedsSave, false);
    await h.import();
    await h.app.save();
    const logPosts = h.calls.filter(call => call.options.method === "POST" && call.url === h.spec.endpoint);
    assert.equal(logPosts.length, 1);
    const saved = JSON.parse(logPosts[0].options.body);
    assert.equal(saved.log.inspectionDate, NEXT_DATE);
    assert.equal(saved.log.id, nextLog.id);
    assert.equal(saved.expectedRevision, 2);
    assert.equal(h.state().importedDraftNeedsSave, false);
    assert.equal(JSON.stringify(h.sourceLog), sourceBefore);
  }
});

test("LNG rejects empty or unrelated field maps without rejecting individually omitted optional fields", async () => {
  const h = fixture("lng");
  const before = h.state();
  for (const fields of [
    {},
    { unrelatedInput: "다른 양식의 값" },
    { lngContent999: "현재 양식에 없는 항목" },
    { lngPartLeaderApproval: "이전 승인", lngTeamLeaderApproval: "이전 결재" },
    { lngInspectorName: "이전 점검자", lngPartLeaderApproval: "이전 승인" }
  ]) {
    h.setResponder(() => jsonResponse({ ok: true, log: { ...h.sourceLog, form: { fields } } }));
    await assert.rejects(h.read(), /점검 내용 형식을 확인할 수 없습니다/);
    assert.deepEqual(h.state(), before);
    assertNoPersistence(h);
  }
  h.setResponder(() => jsonResponse({
    ok: true, log: { ...h.sourceLog, form: { fields: { lngContent1: "4.2", lngRemark: "이전 특이사항" } } }
  }));
  await h.import();
  assert.equal(h.state().form.fields.lngContent1, "4.2");
  assert.equal(h.state().form.fields.lngContent2, "");
  assert.equal(h.state().form.remark, "이전 특이사항");
  assertNoPersistence(h);
});

test("the unavailable LNG endpoint or HTML response reports an error without converting the current form into an empty log", async () => {
  const h = fixture("lng");
  const before = h.state();
  for (const status of [200, 404, 500]) {
    h.setResponder(() => ({ ok: status === 200, status, json: async () => { throw new SyntaxError("HTML is not JSON"); } }));
    await assert.rejects(h.read(), status === 200 ? /서버 조회 기능/ : /요청에 실패/);
    assert.deepEqual(h.state(), before);
  }
  assertNoPersistence(h);
});
