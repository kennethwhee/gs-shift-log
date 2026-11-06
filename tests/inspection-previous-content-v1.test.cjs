"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const commonSource = fs.readFileSync(path.join(__dirname, "../inspection-logs/inspection-previous-content.js"), "utf8");
const patrolSource = fs.readFileSync(path.join(__dirname, "../inspection-logs/daily/night-patrol/night-patrol.js"), "utf8");
const pure = vm.createContext({ module: { exports: {} } });
vm.runInContext(commonSource, pure);
const { validDate, previousDate, validateSourceDate } = pure.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const key = (date, list = 1) => `gsShiftLog.nightPatrol.${date}.${list}`;

class Element {
  constructor(tag = "div", attributes = {}) {
    this.tag = tag; this.attributes = attributes; this.id = attributes.id || "";
    this.value = ""; this.disabled = false; this.hidden = "hidden" in attributes;
    this.open = false; this.textContent = ""; this.dataset = {}; this.handlers = new Map();
    this.children = []; this._html = "";
  }
  addEventListener(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, []);
    this.handlers.get(name).push(fn);
  }
  dispatch(name, event = {}) {
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    return (this.handlers.get(name) || []).map(fn => fn(event));
  }
  appendChild(element) { this.children.push(element); return element; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch("close"); }
  set innerHTML(value) {
    this._html = value;
    this.children = [];
    // A minimal DOM boundary, populated from the production dialog markup.
    for (const [, tag, source] of value.matchAll(/<([a-z][\w-]*)([^>]*)>/gi)) {
      const attrs = {};
      for (const [, name, quoted, bare] of source.matchAll(/([\w-]+)(?:="([^"]*)"|=([^\s>]+))?/g)) attrs[name] = quoted ?? bare ?? "";
      this.children.push(new Element(tag, attrs));
    }
  }
  get innerHTML() { return this._html; }
  querySelector(selector) {
    if (selector.startsWith("#")) return this.children.find(element => element.id === selector.slice(1)) || null;
    const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    return this.children.find(element => attribute && attribute in element.attributes) || null;
  }
}

function documentFixture() {
  const elements = new Map();
  const rows = [];
  const document = {
    body: new Element("body"),
    createElement: tag => new Element(tag),
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element("input", { id }));
      return elements.get(id);
    },
    querySelectorAll: selector => selector === "[data-patrol-entry-index]" ? rows : [],
    addEventListener() {}
  };
  return { document, elements, rows };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function controllerFixture(options = {}) {
  const dom = documentFixture();
  const alerts = [], reads = [], applied = [], signals = [];
  const state = { target: { date: "2026-11-06" }, snapshot: "original", busy: false, dirty: false, confirm: true };
  const sandbox = {
    ...dom, AbortController, console, alert: message => alerts.push(message),
    confirm: () => state.confirm
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(commonSource, context);
  const controller = sandbox.GSInspectionPreviousContent.create({
    button: dom.document.getElementById("launch"), title: "주간 점검일지", defaultDays: 7,
    getTarget: () => state.target, getSnapshot: () => state.snapshot,
    isBusy: () => state.busy, isDirty: () => state.dirty,
    read: (source, { signal }) => {
      reads.push(plain(source)); signals.push(signal);
      return options.read ? options.read(source, signal) : { content: "previous" };
    },
    apply: (content, source) => applied.push({ content, source: plain(source) })
  });
  const dialog = dom.document.body.children[0];
  return { controller, state, reads, applied, signals, alerts, dialog, dom,
    field: name => dialog.querySelector(`[data-previous-${name}]`) };
}

function patrolRecord(date, listNumber = 1, extra = {}) {
  return {
    version: 2, date, listNumber, documentStatus: "점검완료",
    members: ["이전 순찰자 1", "이전 순찰자 2", "이전 순찰자 3"],
    entries: Array.from({ length: 20 }, (_, index) => ({
      entryId: [date, listNumber, `previous-point-${index}`, index].join("|"),
      pointId: `previous-point-${index}`, pointName: `이전 구역 ${index + 1}`,
      time: ["0:00", "2:00", "4:00", "6:00"][Math.floor(index / 5)],
      status: index === 0 ? "이상" : "양호", note: index === 0 ? "이전 특이사항" : ""
    })),
    generalNote: "이전 비고", updatedAt: "2026-11-05T01:00:00Z",
    completedAt: "2026-11-05T01:00:00Z", ...extra
  };
}

function patrolFixture(records = [], { schedule = async () => ({ action: "canceled" }) } = {}) {
  const dom = documentFixture();
  const values = new Map(records.map(record => [key(record.date, record.listNumber), JSON.stringify(record)]));
  const writes = [], scheduleCalls = [], alerts = [], timers = new Map();
  let timerId = 0, failWrite = false, controller, adapter;
  const storage = {
    getItem: name => values.get(name) ?? null,
    setItem: (name, value) => {
      if (failWrite && /^gsShiftLog\.nightPatrol\.\d/.test(name)) throw new Error("Quota exceeded");
      writes.push({ name, value }); values.set(name, value);
    },
    removeItem: name => values.delete(name)
  };
  for (let index = 0; index < 20; index += 1) {
    const row = new Element(); row.dataset.patrolEntryIndex = String(index);
    row.children = ["point-name", "status", "note"].map(name => new Element("input", { [`data-patrol-${name}`]: "" }));
    dom.rows.push(row);
  }
  const sandbox = {
    document: dom.document, localStorage: storage, AbortController,
    console: { warn() {}, error() {}, log() {} },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener() {}, alert: message => alerts.push(message), confirm: () => true,
    __schedule: data => { scheduleCalls.push(plain(data)); return schedule(data); },
    __render: state => {
      const set = (name, value) => { dom.document.getElementById(name).value = value; };
      set("patrolDate", state.date); set("patrolDocumentStatus", state.documentStatus);
      state.members.forEach((member, index) => set(`patrolMember${index + 1}`, member));
      set("patrolGeneralNote", state.generalNote);
      state.entries.forEach((entry, index) => {
        for (const [name, value] of [["point-name", entry.pointName], ["status", entry.status], ["note", entry.note]]) {
          dom.rows[index].querySelector(`[data-patrol-${name}]`).value = value;
        }
      });
    }
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(commonSource, context);
  const common = sandbox.GSInspectionPreviousContent;
  sandbox.GSInspectionPreviousContent = { ...common, create(value) { adapter = value; controller = common.create(value); return controller; } };
  vm.runInContext(patrolSource, context);
  // Keep the production collector, serializer, loader, importer and saving flow.
  // Replace only visual rendering and the remote schedule boundary.
  vm.runInContext(`
    renderNightPatrolScreen = function () { __render(nightPatrolState); };
    renderPatrolSummary = function () {};
    synchronizeNightPatrolScheduleStatus = function (options) { return __schedule(options); };
    nightPatrolPointCatalog = loadNightPatrolPointCatalog();
    globalThis.testPatrol = {
      state: nightPatrolState, load: loadNightPatrolRecord, save: saveNightPatrolRecord,
      dirty: markPatrolDirty, collect: collectPatrolScreenValues,
      init: initializePreviousNightPatrolContents,
      snapshot: createPatrolSnapshot,
      savedSnapshot: function () { return nightPatrolSavedSnapshot; },
      imported: function () { return nightPatrolImportedDraftNeedsSave; }
    };
  `, context);
  sandbox.testPatrol.load("2026-11-06", 1);
  sandbox.testPatrol.init();
  const dialog = dom.document.body.children[0];
  return {
    ...dom, app: sandbox.testPatrol, adapter, controller, dialog, storage, values, writes, timers, alerts, scheduleCalls,
    failStorage: () => { failWrite = true; },
    field: name => dialog.querySelector(`[data-previous-${name}]`),
    set: (id, value) => { dom.document.getElementById(id).value = value; }
  };
}

test("source dates are calendar-valid and strictly earlier; day/week defaults cross month/year boundaries", () => {
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2026-11-31"), false);
  assert.equal(previousDate("2026-01-01"), "2025-12-31");
  assert.equal(previousDate("2026-11-06", 7), "2026-10-30");
  assert.equal(previousDate("2024-03-01"), "2024-02-29");
  assert.doesNotThrow(() => validateSourceDate("2026-11-05", "2026-11-06"));
  for (const date of ["2026-11-06", "2026-11-07", "2026-13-01", ""]) {
    assert.throws(() => validateSourceDate(date, "2026-11-06"));
  }
});

test("picker stays outside write views and refuses busy or invalid target without a request", () => {
  const fixture = controllerFixture();
  assert.equal(fixture.dom.document.body.children[0], fixture.dialog);
  fixture.state.busy = true;
  assert.equal(fixture.controller.open(), false);
  fixture.state.busy = false; fixture.state.target.date = "";
  assert.equal(fixture.controller.open(), false);
  assert.equal(fixture.reads.length, 0);
  fixture.state.target.date = "2026-11-06";
  assert.equal(fixture.controller.open(), true);
  assert.equal(fixture.field("date").value, "2026-10-30");
  assert.equal(fixture.field("date").max, "2026-11-05");
  assert.equal(fixture.field("list-field").hidden, true);
  assert.match(fixture.field("target").textContent, /2026-11-06/);
  fixture.dialog.dispatch("cancel");
  assert.equal(fixture.dialog.open, false);
});

test("invalid source date and changed target before submit do not read or replace data", async () => {
  const fixture = controllerFixture();
  fixture.controller.open();
  fixture.field("date").value = "2026-11-06";
  assert.equal(await fixture.controller.load(), false);
  fixture.field("date").value = "2026-11-05";
  fixture.state.target.date = "2026-11-07";
  assert.equal(await fixture.controller.load(), false);
  assert.equal(fixture.reads.length, 0);
  assert.equal(fixture.applied.length, 0);
});

test("cancel and reopen discard an older result without enabling the new pending operation", async () => {
  const first = deferred(), second = deferred(); let index = 0;
  const fixture = controllerFixture({ read: () => (++index === 1 ? first.promise : second.promise) });
  fixture.controller.open();
  const oldLoad = fixture.controller.load();
  assert.equal(await fixture.controller.load(), false, "duplicate submit is ignored");
  fixture.controller.close();
  assert.equal(fixture.signals[0].aborted, true);
  fixture.controller.open();
  const newLoad = fixture.controller.load();
  first.resolve({ content: "stale" });
  assert.equal(await oldLoad, false);
  assert.equal(fixture.field("apply").disabled, true);
  assert.equal(fixture.applied.length, 0);
  second.resolve({ content: "current request" });
  assert.equal(await newLoad, true);
  assert.equal(fixture.applied.length, 1);
  assert.equal(fixture.applied[0].content.content, "current request");
  assert.equal(fixture.dialog.open, false);
});

test("a queued native close event from the previous dialog session cannot abort a reopened request", async () => {
  const pending = deferred();
  const fixture = controllerFixture({ read: () => pending.promise });
  // Native close events are queued, so emulate delivery after a subsequent open.
  fixture.dialog.close = function () { this.open = false; };
  fixture.controller.open(); fixture.controller.close();
  fixture.controller.open();
  const loading = fixture.controller.load();
  fixture.dialog.dispatch("close");
  assert.equal(fixture.signals[0].aborted, false);
  assert.equal(fixture.field("apply").disabled, true);
  pending.resolve({ content: "new session" });
  assert.equal(await loading, true);
  assert.equal(fixture.applied.length, 1);
});

test("an in-flight response cannot replace a changed date, changed fields, or a busy target", async t => {
  for (const change of ["date", "fields", "busy"]) await t.test(change, async () => {
    const pending = deferred();
    const fixture = controllerFixture({ read: () => pending.promise });
    fixture.controller.open(); const loading = fixture.controller.load();
    if (change === "date") fixture.state.target.date = "2026-11-07";
    if (change === "fields") fixture.state.snapshot = "new user edits";
    if (change === "busy") fixture.state.busy = true;
    pending.resolve({ content: "old result" });
    assert.equal(await loading, false);
    assert.equal(fixture.applied.length, 0);
    assert.equal(fixture.field("status").dataset.state, "error");
    assert.equal(fixture.dialog.open, true);
  });
});

test("read failures and canceled dirty replacement retain the current form", async () => {
  const failed = controllerFixture({ read: async () => { throw new Error("저장 기록 없음"); } });
  failed.controller.open();
  assert.equal(await failed.controller.load(), false);
  assert.equal(failed.applied.length, 0);
  assert.equal(failed.field("status").textContent, "저장 기록 없음");
  const canceled = controllerFixture();
  canceled.state.dirty = true; canceled.state.confirm = false;
  canceled.controller.open();
  assert.equal(await canceled.controller.load(), false);
  assert.equal(canceled.applied.length, 0);
  assert.equal(canceled.state.snapshot, "original");
  assert.equal(canceled.dialog.open, true);
});

test("daily import carries matching point labels/results into the target date/list as an unsaved draft", async () => {
  const source = patrolRecord("2026-11-05", 3);
  const target = patrolRecord("2026-11-06", 1, { generalNote: "현재 저장된 비고" });
  const fixture = patrolFixture([source, target]);
  const before = Array.from(fixture.values);
  fixture.set("patrolGeneralNote", "아직 저장하지 않은 내용");
  fixture.app.collect(); fixture.app.dirty();
  assert.equal(fixture.timers.size, 1);
  fixture.controller.open(); fixture.field("list").value = "3";
  assert.equal(await fixture.controller.load(), true);
  assert.equal(fixture.app.state.date, "2026-11-06");
  assert.equal(fixture.app.state.listNumber, 1);
  assert.deepEqual(plain(fixture.app.state.members), source.members);
  fixture.app.state.entries.forEach((entry, index) => {
    assert.equal(entry.pointName, source.entries[index].pointName);
    assert.equal(entry.pointId, source.entries[index].pointId);
    assert.equal(entry.status, source.entries[index].status);
    assert.equal(entry.note, source.entries[index].note);
    assert.equal(entry.entryId, ["2026-11-06", 1, entry.pointId, index].join("|"));
  });
  assert.equal(fixture.app.state.generalNote, source.generalNote);
  assert.equal(fixture.app.state.documentStatus, "작성중");
  assert.equal(fixture.app.state.updatedAt, "");
  assert.equal(fixture.app.state.completedAt, "");
  assert.equal(fixture.app.imported(), true);
  assert.notEqual(fixture.app.snapshot(), fixture.app.savedSnapshot());
  assert.equal(fixture.timers.size, 0);
  assert.deepEqual(Array.from(fixture.values), before);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.scheduleCalls.length, 0);
  assert.match(fixture.document.getElementById("patrolSaveState").textContent, /확인 후 저장/);
});

test("daily imported edits do not autosave; explicit save updates only the target and restores ordinary autosave", async () => {
  const source = patrolRecord("2026-11-05");
  const fixture = patrolFixture([source]);
  fixture.controller.open();
  assert.equal(await fixture.controller.load(), true);
  fixture.set("patrolGeneralNote", "불러온 뒤 수정한 현재 내용");
  fixture.app.collect(); fixture.app.dirty();
  assert.equal(fixture.timers.size, 0);
  assert.equal(await fixture.app.save({ silent: true }), false);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.storage.getItem(key("2026-11-06")), null);
  assert.equal(await fixture.app.save(), true);
  const saved = JSON.parse(fixture.storage.getItem(key("2026-11-06")));
  assert.equal(saved.date, "2026-11-06");
  assert.equal(saved.listNumber, 1);
  assert.equal(saved.generalNote, "불러온 뒤 수정한 현재 내용");
  assert.equal(saved.documentStatus, "작성중");
  assert.equal(saved.completedAt, "");
  assert.notEqual(saved.updatedAt, source.updatedAt);
  assert.equal(fixture.storage.getItem(key(source.date)), JSON.stringify(source));
  assert.deepEqual(fixture.scheduleCalls, [{ dateValue: "2026-11-06", listNumber: 1, documentStatus: "작성중" }]);
  assert.equal(fixture.app.imported(), false);
  fixture.set("patrolGeneralNote", "정상 자동저장으로 돌아온 뒤 수정");
  fixture.app.collect(); fixture.app.dirty();
  assert.equal(fixture.timers.size, 1);
});

test("failed daily explicit save retains the import guard; normal date loading clears it", async () => {
  const source = patrolRecord("2026-11-05");
  const fixture = patrolFixture([source]);
  fixture.controller.open(); await fixture.controller.load();
  fixture.failStorage();
  assert.equal(await fixture.app.save(), false);
  assert.equal(fixture.app.imported(), true);
  assert.equal(fixture.storage.getItem(key("2026-11-06")), null);
  assert.equal(fixture.storage.getItem(key(source.date)), JSON.stringify(source));
  assert.equal(fixture.scheduleCalls.length, 0);
  fixture.app.load("2026-11-07", 2);
  assert.equal(fixture.app.imported(), false);
  fixture.set("patrolGeneralNote", "새 날짜 일반 편집");
  fixture.app.collect(); fixture.app.dirty();
  assert.equal(fixture.timers.size, 1);
});

test("daily busy save prevents importing until its existing schedule operation finishes", async () => {
  const pending = deferred();
  const fixture = patrolFixture([patrolRecord("2026-11-05")], { schedule: () => pending.promise });
  const saving = fixture.app.save();
  assert.equal(fixture.document.getElementById("importPreviousPatrolButton").disabled, true);
  assert.equal(fixture.controller.open(), false);
  pending.resolve({ action: "canceled" }); await saving;
  assert.equal(fixture.document.getElementById("importPreviousPatrolButton").disabled, false);
  assert.equal(fixture.controller.open(), true);
});

test("missing, corrupt and misidentified daily sources never replace or persist the current form", async t => {
  const cases = {
    missing: null, corrupt: "{broken",
    wrongDate: JSON.stringify(patrolRecord("2026-11-04")),
    wrongList: JSON.stringify(patrolRecord("2026-11-05", 2)),
    shortEntries: JSON.stringify(patrolRecord("2026-11-05", 1, { entries: [] })),
    invalidMembers: JSON.stringify(patrolRecord("2026-11-05", 1, { members: [{ name: "bad" }] })),
    missingPointLabel: JSON.stringify(patrolRecord("2026-11-05", 1, { entries: patrolRecord("2026-11-05").entries.map(entry => ({ ...entry, pointName: "" })) }))
  };
  for (const [name, value] of Object.entries(cases)) await t.test(name, async () => {
    const fixture = patrolFixture();
    if (value !== null) fixture.values.set(key("2026-11-05"), value);
    const before = fixture.app.snapshot(); const stored = Array.from(fixture.values);
    fixture.controller.open();
    assert.equal(await fixture.controller.load(), false);
    assert.equal(fixture.app.snapshot(), before);
    assert.deepEqual(Array.from(fixture.values), stored);
    assert.equal(fixture.writes.length, 0);
    assert.equal(fixture.scheduleCalls.length, 0);
    assert.equal(fixture.app.imported(), false);
  });
});
