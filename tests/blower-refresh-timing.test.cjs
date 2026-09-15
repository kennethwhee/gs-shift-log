"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../maintenance/blower-refresh-timing.js"), "utf8");

function fixture(options = {}) {
  let time = 0, skew = 0, id = 0;
  const timers = new Map(), frames = new Map(), mutations = [], observers = [], elements = new Map();
  const rootEvents = new Map(), docEvents = new Map();
  const listen = (map, name, callback) => {
    if (!map.has(name)) map.set(name, []);
    map.get(name).push(callback);
  };
  const emit = (map, name, event = {}) => { for (const cb of map.get(name) || []) cb(event); };
  class Element {
    constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.disabled = false; this.isConnected = true; this.events = new Map(); this.textContent = ""; }
    set id(value) { this._id = value; elements.set(value, this); }
    get id() { return this._id; }
    appendChild(child) { this.children.push(child); child.parent = this; return child; }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, cb) { listen(this.events, name, cb); }
    click() { emit(this.events, "click", { target: this }); }
    remove() { this.isConnected = false; }
  }
  const button = new Element("button"); button.id = "refreshButton";
  const status = new Element("section"); status.id = "unifiedRefreshStatus";
  status.dataset.state = options.initialState || "";
  const host = new Element("div"), body = new Element("body");
  const document = {
    readyState: "complete", hidden: false, body,
    getElementById: name => elements.get(name) || null,
    querySelector: () => host,
    createElement: name => { if (options.badDom) throw new Error("DOM unavailable"); return new Element(name); },
    addEventListener: (name, cb) => listen(docEvents, name, cb)
  };
  class MockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [1789500000000 + time + skew])); }
    static now() { return 1789500000000 + time + skew; }
  }
  const schedule = (cb, delay, interval) => { const key = ++id; timers.set(key, { cb, at: time + delay, interval: interval ? delay : 0 }); return key; };
  const context = {
    document, Date: MockDate,
    performance: { now: () => { if (options.badPerformance) throw new Error("denied"); return time; } },
    setTimeout: (cb, delay) => schedule(cb, delay, false), clearTimeout: key => timers.delete(key),
    setInterval: (cb, delay) => schedule(cb, delay, true), clearInterval: key => timers.delete(key),
    requestAnimationFrame: cb => { if (options.badRaf) throw new Error("no RAF"); const key = ++id; frames.set(key, cb); return key; },
    cancelAnimationFrame: key => frames.delete(key),
    MutationObserver: class {
      constructor(cb) { this.cb = cb; observers.push(this); }
      observe() { if (options.badObserver) throw new Error("no observer"); }
    },
    addEventListener: (name, cb) => listen(rootEvents, name, cb)
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  const api = context.BlowerRefreshTiming;
  return {
    api, context, document, button, status, host, timers, frames, elements,
    at(value) { time = value; }, skew(value) { skew = value; },
    click() { emit(docEvents, "click", { target: button }); },
    setState(value) { mutations.push({ attributeName: "data-state", oldValue: status.dataset.state }); status.dataset.state = value; },
    flush() { const list = mutations.splice(0); for (const obs of observers) obs.cb(list); },
    frame(at = time) { time = at; const callbacks = [...frames.values()]; frames.clear(); for (const cb of callbacks) cb(time); },
    runTo(until) {
      let count = 0;
      while (count++ < 1000) {
        const pair = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!pair) break;
        const [key, timer] = pair;
        time = timer.at;
        if (timer.interval) timer.at += timer.interval; else timers.delete(key);
        timer.cb();
      }
      assert.ok(count < 1000, "timer loop must be bounded");
      time = until;
    },
    event(name) { emit(rootEvents, name); },
    visibility(hidden) { document.hidden = hidden; emit(docEvents, "visibilitychange"); },
    records() { return JSON.parse(JSON.stringify(api.exportRecords().records)); }
  };
}

test("ignored clicks do not start elapsed display; accepted click includes pre-running delay and render checkpoint", () => {
  const f = fixture();
  f.at(100); f.click();
  assert.equal(f.records().length, 0);
  assert.equal(f.elements.get("blowerRefreshElapsed").textContent, "조회 시간 · 대기");
  f.runTo(2200);
  f.at(3000); f.click();
  f.at(3020); f.setState("running"); f.flush();
  assert.equal(f.records()[0].startSource, "accepted_click");
  f.at(4000); f.setState("complete"); f.flush();
  assert.equal(f.records()[0].status, "rendering");
  f.frame(4016);
  const rec = f.records()[0];
  assert.equal(rec.totalMs, 1016);
  assert.equal(rec.terminalObservedMs, 1000);
  assert.equal(rec.status, "complete");
  assert.equal(rec.renderCheckpoint, "animation_frame");
  assert.equal(f.timers.size, 0);
  assert.equal(f.frames.size, 0);
});

test("beginPhase starts a running run before observer delivery and stores only allowlisted metadata", () => {
  const f = fixture();
  f.at(10); f.click(); f.at(20); f.setState("running");
  const phase = f.api.beginPhase("workLogs", { targetCount: 23, token: "SECRET", body: "SECRET", failedCount: -2 });
  f.flush();
  f.at(90); phase.end("complete", { requestCount: 20, completedCount: 18.8, error: "SECRET" });
  phase.end("failed");
  f.at(100); f.setState("partial"); f.flush(); f.frame(116);
  const rec = f.records()[0];
  assert.equal(f.records().length, 1);
  assert.deepEqual(rec.phases, [{ name: "workLogs", status: "complete", startOffsetMs: 10, durationMs: 70, targetCount: 23, requestCount: 20, completedCount: 18 }]);
  assert.equal(rec.status, "partial");
  assert.doesNotMatch(JSON.stringify(f.api.exportRecords()), /SECRET|"token"|"body"|"error"/);
});

test("ignored clicks while running and disabled buttons cannot reset measurement", () => {
  const f = fixture();
  f.button.disabled = true; f.at(10); f.click(); f.button.disabled = false;
  f.at(30); f.setState("running"); f.flush();
  assert.equal(f.records()[0].startSource, "running_state");
  f.at(60); f.click();
  f.at(90); f.setState("failed"); f.flush(); f.frame(100);
  assert.equal(f.records()[0].totalMs, 70);
  assert.equal(f.records()[0].status, "failed");
});

test("generation capture keeps prior render callbacks from overwriting the next run or label", () => {
  const f = fixture();
  f.at(10); f.click(); f.setState("running"); f.flush();
  f.at(100); f.setState("complete"); f.flush();
  f.at(110); f.click(); f.setState("running"); f.flush();
  f.frame(116);
  const records = f.records();
  assert.equal(records[0].status, "complete");
  assert.equal(records[1].status, "running");
  assert.equal(records[1].totalMs, 6);
  assert.match(f.elements.get("blowerRefreshElapsed").textContent, /경과/);
  f.at(200); f.setState("failed"); f.flush(); f.frame(216);
  assert.deepEqual(f.records().map(r => r.status), ["complete", "failed"]);
  assert.equal(f.timers.size, 0);
});

test("pagehide interrupts both running and terminal-awaiting-render records and cleans callbacks", () => {
  const f = fixture();
  f.at(10); f.click(); f.setState("running"); f.flush();
  f.api.beginPhase("waitResults");
  f.at(100); f.setState("complete"); f.flush();
  f.at(110); f.click(); f.setState("running"); f.flush();
  f.at(130); f.event("pagehide");
  assert.deepEqual(f.records().map(r => r.status), ["interrupted", "interrupted"]);
  assert.equal(f.records()[0].phases[0].status, "interrupted");
  assert.equal(f.timers.size, 0);
  assert.equal(f.frames.size, 0);
  f.frame(1000);
  assert.equal(f.records()[0].status, "interrupted");
});

test("timer fallback preserves wall elapsed time and records hidden-tab scheduling", () => {
  const f = fixture({ badRaf: true });
  f.at(100); f.click(); f.setState("running"); f.flush();
  f.visibility(true);
  // Simulate a throttled tab jumping forward without counting timer ticks.
  f.at(121000); f.setState("complete"); f.flush();
  f.runTo(121300);
  const rec = f.records()[0];
  assert.equal(rec.totalMs, 121200);
  assert.equal(rec.backgroundObserved, true);
  assert.equal(rec.renderCheckpoint, "timer_fallback");
  assert.equal(f.timers.size, 0);
});

test("throwing performance API uses a monotonic-clamped Date clock", () => {
  const f = fixture({ badPerformance: true });
  f.at(100); f.click(); f.setState("running"); f.flush();
  f.at(200);
  const a = f.records()[0].totalMs;
  f.skew(-10000); f.at(300);
  const b = f.records()[0].totalMs;
  assert.ok(b >= a);
  f.at(400); f.setState("complete"); f.flush(); f.frame(416);
  assert.ok(f.records()[0].totalMs >= b);
  assert.match(f.records()[0].clock, /monotonic-clamped/);
  assert.equal(f.timers.size, 0);
});

test("diagnostic DOM failure and malicious metadata getters never throw into caller", () => {
  const f = fixture({ badDom: true });
  f.click(); f.setState("running"); f.flush();
  const metadata = Object.defineProperty({}, "requestCount", { get() { throw new Error("SECRET"); } });
  assert.doesNotThrow(() => f.api.beginPhase("createRequests", metadata).end("complete", metadata));
  assert.doesNotThrow(() => f.api.beginPhase("notAllowed", {}).end("failed"));
  f.at(100); f.setState("complete"); f.flush(); f.frame(116);
  assert.equal(f.records()[0].status, "complete");
  assert.equal(f.records()[0].phases.length, 1);
  assert.equal(f.timers.size, 0);
});

test("rapid running to terminal mutations within one microtask remain a measured run", () => {
  const f = fixture();
  f.at(10); f.click(); f.setState("running");
  f.at(30); f.setState("complete"); f.flush(); f.frame(46);
  assert.equal(f.records().length, 1);
  assert.equal(f.records()[0].totalMs, 36);
  assert.equal(f.records()[0].status, "complete");
});

test("records and phases are bounded, exported snapshots cannot mutate internal state", () => {
  const f = fixture();
  for (let i = 0; i < 7; i++) {
    f.at(i * 1000); f.click(); f.setState("running"); f.flush();
    if (i === 6) for (let n = 0; n < 140; n++) f.api.beginPhase("waitResults", { pollCount: n }).end("complete");
    f.at(i * 1000 + 100); f.setState("complete"); f.flush(); f.frame(i * 1000 + 116);
  }
  const exported = f.api.exportRecords();
  assert.equal(exported.records.length, 5);
  assert.equal(exported.records[0].sequence, 3);
  assert.equal(exported.records[4].phases.length, 128);
  assert.equal(exported.records[4].droppedPhaseCount, 12);
  exported.records[4].phases[0].pollCount = 999;
  exported.records[4].status = "failed";
  assert.equal(f.records()[4].phases[0].pollCount, 0);
  assert.equal(f.records()[4].status, "complete");
  assert.equal(f.timers.size, 0);
});
