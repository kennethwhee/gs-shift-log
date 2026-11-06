"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const patrolDirectory = path.join(__dirname, "../inspection-logs/daily/night-patrol");
const mainSource = fs.readFileSync(path.join(patrolDirectory, "night-patrol.js"), "utf8");
const historySource = fs.readFileSync(path.join(patrolDirectory, "night-patrol-history.js"), "utf8");
// Keep the module's browser export out of the Node test process's global object.
const pureContext = vm.createContext({ module: { exports: {} } });
vm.runInContext(historySource, pureContext);
const { readRecord, readRecords, filteredRecords, validDate, escapeHtml, savedTime } = pureContext.module.exports;

const recordKey = (date, listNumber = 1) => `gsShiftLog.nightPatrol.${date}.${listNumber}`;
const plain = value => JSON.parse(JSON.stringify(value));

function record(date, listNumber = 1, changes = {}) {
  return {
    version: 2,
    date,
    listNumber,
    documentStatus: "작성중",
    members: ["김순찰", "이점검", "박운전"],
    entries: Array.from({ length: 20 }, (_, index) => ({
      entryId: `${date}|${listNumber}|historical-${index}|${index}`,
      pointId: `historical-${index}`,
      pointName: `저장 당시 점검 지점 ${index + 1}`,
      time: ["0:00", "2:00", "4:00", "6:00"][Math.floor(index / 5)],
      status: index === 0 ? "이상" : "양호",
      note: index === 0 ? "저장 당시 특이사항" : ""
    })),
    generalNote: "저장 당시 인계 내용",
    updatedAt: "2026-11-05T15:05:00.000Z",
    completedAt: "",
    ...changes
  };
}

class MemoryStorage {
  constructor(records = []) {
    this.values = new Map(records.map(value => [recordKey(value.date, value.listNumber), JSON.stringify(value)]));
    this.writes = [];
    this.removals = [];
    this.failWrite = () => false;
  }
  get length() { return this.values.size; }
  key(index) { return Array.from(this.values.keys())[index] ?? null; }
  getItem(key) { return this.values.get(String(key)) ?? null; }
  setItem(key, value) {
    if (this.failWrite(key)) throw new Error("QuotaExceededError");
    this.writes.push({ key: String(key), value: String(value) });
    this.values.set(String(key), String(value));
  }
  removeItem(key) {
    this.removals.push(key);
    this.values.delete(key);
  }
}

function element() {
  const handlers = new Map();
  return {
    value: "", textContent: "", innerHTML: "", dataset: {}, disabled: false, open: false,
    attributes: {},
    addEventListener(name, callback) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(callback);
    },
    dispatch(name, event = {}) {
      for (const callback of handlers.get(name) || []) callback(event);
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { this.focused = true; },
    showModal() { this.open = true; },
    close() { this.open = false; }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function browserFixture(records = [], { schedule = async () => ({ action: "canceled" }) } = {}) {
  const storage = new MemoryStorage(records);
  storage.values.set("gsShiftLog.currentUser", JSON.stringify({ name: "테스트 사용자", position: "TO" }));
  const elements = new Map();
  const getElement = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  getElement("patrolHistoryStatus").value = "all";
  const counts = [element(), element()];
  const ready = [];
  const timers = new Map();
  const alerts = [];
  const feedback = [];
  const scheduleCalls = [];
  let timerId = 0;
  let networkCalls = 0;
  let confirms = 0;
  const sandbox = {
    localStorage: storage,
    document: {
      getElementById: getElement,
      querySelectorAll: selector => selector === "[data-patrol-history-count]" ? counts : [],
      addEventListener: (name, callback) => { if (name === "DOMContentLoaded") ready.push(callback); }
    },
    console: { warn() {}, error() {}, log() {} },
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener() {},
    scrollTo() {},
    alert: value => alerts.push(value),
    confirm: () => { confirms += 1; return sandbox.confirmResult; },
    confirmResult: true,
    fetch: () => { networkCalls += 1; throw new Error("Unexpected network request in a local-history test"); },
    __feedback: feedback,
    __schedule: options => { scheduleCalls.push(plain(options)); return schedule(options); }
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(mainSource, context, { filename: "night-patrol.js" });
  // Exercise the production serializer, normalizer, storage, timers and save
  // continuations. Only screen rendering/collection and the remote schedule
  // boundary are replaced; these tests never initialize the entire page.
  vm.runInContext(`
    renderNightPatrolScreen = function () {};
    renderPatrolSummary = function () {};
    collectPatrolScreenValues = function () {};
    setPatrolSaveState = function (message, state) { __feedback.push({ message, state }); };
    synchronizeNightPatrolScheduleStatus = function (options) { return __schedule(options); };
    nightPatrolPointCatalog = loadNightPatrolPointCatalog();
    globalThis.patrolTest = {
      state: nightPatrolState,
      load: loadNightPatrolRecord,
      save: saveNightPatrolRecord,
      dirty: markPatrolDirty,
      snapshot: createPatrolSnapshot,
      savedSnapshot: function () { return nightPatrolSavedSnapshot; }
    };
  `, context);
  vm.runInContext(historySource, context, { filename: "night-patrol-history.js" });
  // Bind the real history controls, without running main page initialization.
  ready.at(-1)();
  return {
    storage, elements, getElement, counts, timers, alerts, feedback, scheduleCalls,
    app: sandbox.patrolTest,
    history: sandbox.GSNightPatrolHistory,
    sandbox,
    get networkCalls() { return networkCalls; },
    get confirms() { return confirms; }
  };
}

test("saved days and same-day lists coexist, sort by date/list, and overwrite without duplicates", () => {
  const storage = new MemoryStorage([
    record("2026-11-05", 2), record("2026-11-06", 3), record("2026-11-06", 1)
  ]);
  storage.values.set("gsShiftLog.nightPatrol.members.1", '["새 기본 순찰자"]');
  storage.values.set("gsShiftLog.nightPatrol.pointCatalog.v1", '[{"id":"one","name":"새 목록"}]');
  storage.values.set("gsShiftLog.nightPatrol.2026-11-06.5", "{}");
  storage.values.set("unrelated.record", "{}");
  let loaded = readRecords(storage);
  assert.deepEqual(plain(loaded.records.map(item => [item.date, item.listNumber])), [
    ["2026-11-06", 1], ["2026-11-06", 3], ["2026-11-05", 2]
  ]);
  assert.equal(loaded.unreadable, 0);
  assert.equal(loaded.error, false);
  assert.equal(storage.writes.length, 0);
  storage.setItem(recordKey("2026-11-06", 1), JSON.stringify(record("2026-11-06", 1, { members: ["수정 순찰자"] })));
  loaded = readRecords(storage);
  assert.equal(loaded.records.length, 3);
  assert.deepEqual(plain(loaded.records[0].members), ["수정 순찰자"]);
  assert.equal(storage.writes.length, 1, "reading must not rewrite existing records");
});

test("invalid dates, corrupt JSON, invalid shape and mismatched identities are skipped without changing storage", () => {
  const storage = new MemoryStorage([record("2024-02-29")]);
  for (const [date, value] of [
    ["2026-02-29", record("2026-02-29")],
    ["2026-13-01", record("2026-13-01")],
    ["2026-11-01", "{broken"],
    ["2026-11-02", []],
    ["2026-11-03", { date: "2026-11-03" }],
    ["2026-11-04", record("2026-11-05")],
    ["2026-11-05", record("2026-11-05", 2)]
  ]) storage.values.set(recordKey(date), typeof value === "string" ? value : JSON.stringify(value));
  const before = Array.from(storage.values);
  const loaded = readRecords(storage);
  assert.deepEqual(plain(loaded.records.map(item => item.date)), ["2024-02-29"]);
  assert.equal(loaded.unreadable, 7);
  assert.equal(loaded.error, false);
  assert.deepEqual(Array.from(storage.values), before);
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.removals.length, 0);
  assert.equal(validDate("2024-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2026-11-31"), false);
  assert.equal(validDate("2026-1-01"), false);
  const unavailable = readRecords({ get length() { throw new Error("SecurityError"); } });
  assert.equal(unavailable.error, true);
  assert.equal(unavailable.records.length, 0);
});

test("month and status filters preserve sorted order and report only known inspection statuses", () => {
  const storage = new MemoryStorage([
    record("2026-10-31", 1, { documentStatus: "점검완료" }),
    record("2026-11-05", 2, { documentStatus: "점검완료" }),
    record("2026-11-06", 1),
    record("2026-11-06", 2, { documentStatus: "점검완료" })
  ]);
  const records = readRecords(storage).records;
  const original = JSON.stringify(records);
  assert.deepEqual(plain(filteredRecords(records, "2026-11", "점검완료").map(item => item.key)), [
    recordKey("2026-11-06", 2), recordKey("2026-11-05", 2)
  ]);
  assert.equal(filteredRecords(records, "2026-11", "작성중").length, 1);
  assert.equal(filteredRecords(records, "", "all").length, 4);
  assert.equal(filteredRecords(records, "2025-11", "all").length, 0);
  assert.equal(JSON.stringify(records), original);
  const counted = readRecord(recordKey("2026-11-06"), JSON.stringify(record("2026-11-06", 1, {
    entries: ["양호", "이상", "미점검", "해당없음", "unknown", "constructor"].map(status => ({ status }))
  })));
  assert.deepEqual(plain(counted.counts), { "양호": 1, "이상": 1, "미점검": 1, "해당없음": 1 });
});

test("saved timestamps use Korea time including midnight, and unavailable timestamps have a readable fallback", () => {
  assert.equal(savedTime("2026-11-05T15:05:00.000Z"), "2026.11.06 00:05");
  assert.equal(savedTime("2026-12-31T16:30:00.000Z"), "2027.01.01 01:30");
  assert.equal(savedTime(""), "기록 없음");
  assert.equal(savedTime("not a date"), "기록 없음");
  assert.equal(escapeHtml('&<>"\''), "&amp;&lt;&gt;&quot;&#39;");
});

test("opening and filtering the history is read-only and renders saved names and attributes as text", () => {
  const attack = '<img src=x onerror="alert(1)">&\'';
  const fixture = browserFixture([
    record("2026-11-06", 1, { members: [attack], updatedAt: '" onmouseover="alert(2)' }),
    record("2026-10-31", 2, { documentStatus: "점검완료" })
  ]);
  fixture.app.load("2026-11-07", 1);
  const before = fixture.app.snapshot();
  const beforeStorage = Array.from(fixture.storage.values);
  fixture.history.open();
  const html = fixture.getElement("patrolHistoryBody").innerHTML;
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;&#39;/);
  assert.doesNotMatch(html, /<img\b/);
  assert.match(html, /datetime="&quot; onmouseover=&quot;alert\(2\)"/);
  assert.match(html, /기록 없음/);
  fixture.getElement("patrolHistoryMonth").value = "2026-10";
  fixture.getElement("patrolHistoryMonth").dispatch("change");
  assert.match(fixture.getElement("patrolHistoryBody").innerHTML, /2026-10-31/);
  assert.doesNotMatch(fixture.getElement("patrolHistoryBody").innerHTML, /2026-11-06/);
  fixture.getElement("patrolHistoryStatus").value = "작성중";
  fixture.getElement("patrolHistoryStatus").dispatch("change");
  assert.match(fixture.getElement("patrolHistoryBody").innerHTML, /해당하는 일지가 없습니다/);
  fixture.history.refresh();
  fixture.history.close();
  assert.equal(fixture.app.snapshot(), before);
  assert.deepEqual(Array.from(fixture.storage.values), beforeStorage);
  assert.equal(fixture.storage.writes.length, 0);
  assert.equal(fixture.scheduleCalls.length, 0);
  assert.equal(fixture.networkCalls, 0);
  assert.equal(fixture.timers.size, 0);
});

test("opening a historical record restores its saved points, members and notes and cancels an outgoing autosave", () => {
  const saved = record("2026-10-31", 3, {
    documentStatus: "점검완료", completedAt: "2026-10-31T21:00:00.000Z"
  });
  const fixture = browserFixture([saved]);
  fixture.storage.values.set("gsShiftLog.nightPatrol.members.3", '["현재 기본값","다른 이름","새 이름"]');
  fixture.app.load("2026-11-06", 1);
  fixture.app.state.generalNote = "아직 저장하지 않은 새 날짜";
  fixture.app.dirty();
  assert.equal(fixture.timers.size, 1);
  fixture.history.open();
  assert.equal(fixture.history.openRecord(recordKey(saved.date, 3)), true);
  assert.equal(fixture.confirms, 1);
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.getElement("patrolHistoryDialog").open, false);
  assert.equal(fixture.app.state.date, saved.date);
  assert.equal(fixture.app.state.listNumber, 3);
  assert.deepEqual(plain(fixture.app.state.members), saved.members);
  assert.deepEqual(plain(fixture.app.state.entries), saved.entries);
  assert.equal(fixture.app.state.generalNote, saved.generalNote);
  assert.equal(fixture.app.state.documentStatus, "점검완료");
  assert.equal(fixture.app.state.completedAt, saved.completedAt);
  assert.equal(fixture.app.snapshot(), fixture.app.savedSnapshot());
  assert.equal(fixture.storage.writes.length, 0);
  assert.equal(fixture.scheduleCalls.length, 0);
  assert.equal(fixture.networkCalls, 0);
});

test("canceled navigation and a corrupt selected record preserve the current unsaved form and stored bytes", () => {
  const saved = record("2026-11-05");
  const fixture = browserFixture([saved]);
  fixture.app.load("2026-11-06", 2);
  fixture.app.state.generalNote = "계속 작성할 내용";
  fixture.app.dirty();
  const before = fixture.app.snapshot();
  fixture.sandbox.confirmResult = false;
  assert.equal(fixture.history.openRecord(recordKey(saved.date)), false);
  assert.equal(fixture.app.snapshot(), before);
  assert.equal(fixture.timers.size, 1);
  fixture.storage.values.set(recordKey(saved.date), "{broken");
  const beforeStorage = Array.from(fixture.storage.values);
  fixture.sandbox.confirmResult = true;
  assert.equal(fixture.history.openRecord(recordKey(saved.date)), false);
  assert.equal(fixture.app.snapshot(), before);
  assert.equal(fixture.timers.size, 1);
  assert.deepEqual(Array.from(fixture.storage.values), beforeStorage);
  assert.equal(fixture.storage.writes.length, 0);
  assert.equal(fixture.storage.removals.length, 0);
  assert.equal(fixture.scheduleCalls.length, 0);
  assert.match(fixture.alerts.at(-1), /불러올 수 없습니다/);
});

test("saving persists the selected day/list immediately and a subsequent save updates the same history entry", async () => {
  const pending = deferred();
  const fixture = browserFixture([record("2026-11-05", 1)], { schedule: () => pending.promise });
  fixture.app.load("2026-11-06", 4);
  fixture.app.state.members = ["첫째", "둘째", "셋째"];
  fixture.app.state.generalNote = "오늘 새 기록";
  fixture.app.dirty();
  const first = fixture.app.save();
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.counts[0].textContent, "2", "persisted record is listed before remote synchronization finishes");
  assert.equal(JSON.parse(fixture.storage.getItem(recordKey("2026-11-06", 4))).generalNote, "오늘 새 기록");
  assert.deepEqual(fixture.scheduleCalls, [{ dateValue: "2026-11-06", listNumber: 4, documentStatus: "작성중" }]);
  pending.resolve({ action: "canceled" });
  assert.equal(await first, true);
  fixture.app.state.generalNote = "같은 일지 수정";
  assert.equal(await fixture.app.save({ silent: true }), true);
  const listed = fixture.history.refresh();
  assert.equal(listed.records.length, 2);
  assert.equal(JSON.parse(fixture.storage.getItem(recordKey("2026-11-06", 4))).generalNote, "같은 일지 수정");
  assert.equal(fixture.scheduleCalls.length, 1, "unchanged draft status does not resynchronize on autosave");
  assert.equal(fixture.app.snapshot(), fixture.app.savedSnapshot());
});

test("storage failure does not add a history entry or claim that the form was saved", async () => {
  const saved = record("2026-11-05", 1);
  const fixture = browserFixture([saved]);
  fixture.app.load("2026-11-06", 1);
  fixture.app.state.generalNote = "저장 실패할 내용";
  fixture.app.dirty();
  fixture.storage.failWrite = key => key === recordKey("2026-11-06", 1);
  assert.equal(await fixture.app.save(), false);
  assert.equal(fixture.storage.getItem(recordKey("2026-11-06", 1)), null);
  assert.equal(fixture.storage.getItem(recordKey(saved.date)), JSON.stringify(saved));
  assert.equal(fixture.history.refresh().records.length, 1);
  assert.equal(fixture.counts[0].textContent, "1");
  assert.notEqual(fixture.app.snapshot(), fixture.app.savedSnapshot());
  assert.equal(fixture.feedback.at(-1).state, "dirty");
  assert.equal(fixture.scheduleCalls.length, 0);
  assert.match(fixture.alerts.at(-1), /저장하지 못했습니다/);
});

test("schedule synchronization failure retains a saved record in history and reports the distinct failure", async () => {
  const fixture = browserFixture([], { schedule: async () => { throw new Error("일정 서버 응답 실패"); } });
  fixture.app.load("2026-11-06", 2);
  fixture.app.state.generalNote = "일정 서버와 관계없이 남길 기록";
  assert.equal(await fixture.app.save(), true);
  assert.equal(fixture.history.refresh().records.length, 1);
  assert.equal(fixture.counts[0].textContent, "1");
  assert.equal(JSON.parse(fixture.storage.getItem(recordKey("2026-11-06", 2))).generalNote, "일정 서버와 관계없이 남길 기록");
  assert.equal(fixture.feedback.at(-1).message, "저장됨 · 일정 연동 실패");
  assert.match(fixture.alerts.at(-1), /일지는 저장되었습니다/);
  assert.match(fixture.alerts.at(-1), /일정 서버 응답 실패/);
});

test("a delayed save result cannot alter another date's form, feedback or alerts", async t => {
  for (const outcome of ["success", "error"]) await t.test(outcome, async () => {
    const pending = deferred();
    const fixture = browserFixture([record("2026-11-05", 3)], { schedule: () => pending.promise });
    fixture.app.load("2026-11-06", 1);
    fixture.app.state.generalNote = "나중에 응답할 날짜의 내용";
    const saving = fixture.app.save();
    assert.equal(fixture.history.openRecord(recordKey("2026-11-05", 3)), true);
    const selected = fixture.app.snapshot();
    const feedbackBefore = plain(fixture.feedback);
    const alertsBefore = [...fixture.alerts];
    if (outcome === "success") pending.resolve({ action: "canceled" });
    else pending.reject(new Error("이전 날짜 일정 실패"));
    assert.equal(await saving, true);
    assert.equal(fixture.app.snapshot(), selected);
    assert.deepEqual(plain(fixture.feedback), feedbackBefore);
    assert.deepEqual(fixture.alerts, alertsBefore);
    assert.deepEqual(fixture.scheduleCalls, [{ dateValue: "2026-11-06", listNumber: 1, documentStatus: "작성중" }]);
    assert.equal(JSON.parse(fixture.storage.getItem(recordKey("2026-11-06", 1))).generalNote, "나중에 응답할 날짜의 내용");
    assert.equal(fixture.storage.writes.filter(item => item.key === recordKey("2026-11-05", 3)).length, 0);
  });
});

test("edits made while saving stay dirty and are not overwritten by an older completion", async () => {
  const pending = deferred();
  const fixture = browserFixture([], { schedule: () => pending.promise });
  fixture.app.load("2026-11-06", 1);
  fixture.app.state.generalNote = "처음 저장한 내용";
  const saving = fixture.app.save();
  fixture.app.state.generalNote = "응답을 기다리는 동안 추가한 내용";
  fixture.app.dirty();
  pending.resolve({ action: "canceled" });
  assert.equal(await saving, true);
  assert.equal(fixture.app.state.generalNote, "응답을 기다리는 동안 추가한 내용");
  assert.equal(fixture.feedback.at(-1).state, "dirty");
  assert.equal(fixture.timers.size, 1);
  assert.equal(fixture.alerts.length, 0);
  assert.notEqual(fixture.app.snapshot(), fixture.app.savedSnapshot());
  assert.equal(JSON.parse(fixture.storage.getItem(recordKey("2026-11-06", 1))).generalNote, "처음 저장한 내용");
});
