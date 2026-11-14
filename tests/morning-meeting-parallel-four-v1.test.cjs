"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8");
const start = source.indexOf("  async function runMorningMeetingOisSerialLaneV23(");
const end = source.indexOf("  function runBulkLookup(", start);
assert.ok(start >= 0 && end > start);
const queueCode = source.slice(start, end);
const keys = ["water", "limestone", "gear-pinion", "silo-level", "daily-data"];
const flush = async () => { for (let count = 0; count < 12; count++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function harness() {
  const state = { date: "2026-11-14", session: "test-session", syncs: 0 };
  const context = vm.createContext({
    console: { info() {}, warn() {} },
    getBulkCurrentBaseDate: () => state.date,
    getShiftLogSessionToken: () => state.session,
    runBulkLookupItem: item => item.load(),
    scheduleSync: () => { state.syncs++; }
  });
  vm.runInContext(queueCode, context);
  return { state, run: items => context.runMorningMeetingOisSerialLaneV23(items, {}) };
}

test("four pending OIS sources start together and each completion refreshes before the slowest source", async () => {
  const env = harness(), pending = keys.slice(0, 4).map(deferred), started = [], applied = [];
  const items = keys.slice(0, 4).map((key, index) => ({
    key,
    load: async () => { started.push(key); const value = await pending[index].promise; applied.push(key); return value; }
  }));
  let finished = false;
  const result = env.run(items).then(value => { finished = true; return value; });
  assert.deepEqual(started, keys.slice(0, 4));
  pending[2].resolve("gear");
  await flush();
  assert.deepEqual(applied, ["gear-pinion"]);
  assert.equal(env.state.syncs, 1);
  assert.equal(finished, false);
  pending[3].resolve("silo"); pending[1].resolve("lime"); pending[0].resolve("water");
  const outcomes = await result;
  assert.deepEqual(Array.from(outcomes, item => item.value), ["water", "lime", "gear", "silo"]);
  assert.equal(env.state.syncs, 4);
});

test("a fifth compatibility OIS item waits for one slot, then starts without a group barrier", async () => {
  const env = harness(), pending = keys.map(deferred), started = [];
  let active = 0, maximum = 0;
  const items = keys.map((key, index) => ({
    key,
    load: async () => {
      started.push(key); active++; maximum = Math.max(maximum, active);
      try { return await pending[index].promise; } finally { active--; }
    }
  }));
  const result = env.run(items);
  assert.deepEqual(started, keys.slice(0, 4));
  assert.equal(active, 4);
  pending[2].resolve("gear"); await flush();
  assert.deepEqual(started, keys);
  assert.equal(active, 4);
  pending.forEach((item, index) => item.resolve(index));
  const outcomes = await result;
  assert.equal(maximum, 4);
  assert.equal(outcomes.length, 5);
});

test("a failed source releases its slot and cannot cancel or reorder the remaining results", async () => {
  const env = harness(), pending = keys.map(deferred), started = [];
  const items = keys.map((key, index) => ({ key, load: () => { started.push(key); return pending[index].promise; } }));
  const result = env.run(items);
  pending[0].reject(new Error("water failed")); await flush();
  assert.deepEqual(started, keys);
  pending.slice(1).forEach((item, index) => item.resolve(keys[index + 1]));
  const outcomes = await result;
  assert.equal(outcomes[0].status, "rejected");
  assert.match(outcomes[0].reason.message, /water failed/);
  assert.deepEqual(Array.from(outcomes.slice(1), item => item.value), keys.slice(1));
});

for (const changed of ["date", "session"]) {
  test(`${changed} change prevents a queued compatibility item from starting for the new selection`, async () => {
    const env = harness(), pending = keys.slice(0, 4).map(deferred), started = [];
    const items = keys.map((key, index) => ({
      key, load: () => { started.push(key); return pending[index]?.promise || Promise.resolve("unexpected"); }
    }));
    const result = env.run(items);
    env.state[changed] = changed === "date" ? "2026-11-15" : "different-session";
    pending[0].resolve("water"); await flush();
    assert.deepEqual(started, keys.slice(0, 4));
    pending.slice(1).forEach(item => item.resolve("finished"));
    const outcomes = await result;
    assert.equal(outcomes[4].status, "rejected");
    assert.match(outcomes[4].reason.message, /기준일 또는 로그인 상태/);
  });
}

test("SMP and weather do not consume any of the four OIS slots", async () => {
  const env = harness(), pending = keys.slice(0, 4).map(deferred), started = [];
  const items = ["smp-price", "weather", ...keys.slice(0, 4)].map((key, index) => ({
    key, load: () => { started.push(key); return index < 2 ? Promise.resolve(key) : pending[index - 2].promise; }
  }));
  const result = env.run(items);
  assert.deepEqual(started, items.map(item => item.key));
  pending.forEach(item => item.resolve("OIS"));
  const outcomes = await result;
  assert.deepEqual(Array.from(outcomes, item => item.status), new Array(6).fill("fulfilled"));
});
