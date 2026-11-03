'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../maintenance/cofiring-click-timing-v1.js');

// Synthetic monotonic times exercise scheduling and ownership, not production speed.
const PERIOD = { startLocal: '2026-11-03T00:00', endLocal: '2026-11-03T18:44', stepUnit: 'minute', stepValue: 1 };
const REQUEST = 'request-current';
function fixture(extra = {}) {
  let clock = 1000, wall = '2026-11-03T09:45:00.000Z', serial = 0;
  const timers = new Map(), frames = new Map(), listeners = new Set(), changes = [];
  const document = {
    hidden: false,
    visibilityState: 'visible',
    addEventListener(name, listener) { assert.equal(name, 'visibilitychange'); listeners.add(listener); },
    removeEventListener(name, listener) { assert.equal(name, 'visibilitychange'); listeners.delete(listener); }
  };
  const timing = create({
    ...extra,
    document,
    now: () => clock,
    utcNow: () => wall,
    setTimeout(callback, delay) { const handle = ++serial; timers.set(handle, { callback, delay, at: clock + delay }); return handle; },
    clearTimeout(handle) { timers.delete(handle); },
    requestAnimationFrame(callback) { const handle = ++serial; frames.set(handle, callback); return handle; },
    cancelAnimationFrame(handle) { frames.delete(handle); },
    onChange(state) { changes.push(state); extra.onChange?.(state); }
  });
  return {
    timing, timers, frames, listeners, changes, document,
    jump(ms) { clock += ms; },
    wall(value) { wall = value; },
    advance(ms) {
      const target = clock + ms;
      for (;;) {
        const due = [...timers].filter(([, job]) => job.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        clock = due[1].at; timers.delete(due[0]); due[1].callback();
      }
      clock = target;
    },
    frame(ms = 16) {
      clock += ms;
      const entry = frames.entries().next().value;
      assert.ok(entry, 'an animation callback is pending');
      frames.delete(entry[0]); entry[1](clock);
    },
    hidden(value = true) {
      document.hidden = value; document.visibilityState = value ? 'hidden' : 'visible';
      for (const callback of [...listeners]) callback();
    },
    callbacks() { return [...frames.values(), ...[...timers.values()].map(job => job.callback), ...listeners]; },
    timeout() { return [...timers.values()].find(job => job.delay === 1000)?.callback; }
  };
}
function start(f, input = {}) {
  const token = f.timing.start({ mode: 'new_query', period: PERIOD, ...input });
  if (!input.activeRequestId) assert.equal(f.timing.acceptRequest(token, REQUEST), true);
  return token;
}
function data(extra = {}) {
  return {
    requestId: REQUEST, source: 'new_query', querySeconds: 2.25, workerSeconds: 8.5, controllerSeconds: 9.75,
    reportTiming: {
      agent: { schemaVersion: 1, collectorFinishedSeconds: 12.5, workerStages: { preparationSeconds: 5, cleanupSeconds: 1.25 }, progressDrainSeconds: 0.1 },
      worker: { workerPhases: [{ name: 'setupComAttach', outcome: 'complete', elapsedSeconds: 2.5 }] }
    },
    ...extra
  };
}
function drained(f) {
  assert.equal(f.timers.size, 0, 'all owned timer callbacks are cancelled');
  assert.equal(f.frames.size, 0, 'all owned animation callbacks are cancelled');
  assert.equal(f.listeners.size, 0, 'visibility listener is detached');
}
function completedOnce(f) { assert.equal(f.changes.filter(s => s.status === 'complete').length, 1); }
function row(state, label) { return state.details.find(item => item.label === label)?.seconds; }

test('a rendered result completes after the timeout when neither animation callback arrives', () => {
  const f = fixture(), token = start(f);
  f.advance(70);
  assert.equal(f.timing.finish(token, data()), true);
  assert.equal(f.timing.state().domReadyMs, 70);
  assert.equal(f.timing.state().completionBasis, null);
  const late = f.callbacks();
  f.advance(999);
  assert.equal(f.timing.state().status, 'finishing');
  f.advance(1);
  const state = f.timing.state();
  assert.equal(state.status, 'complete');
  assert.equal(state.completionBasis, 'dom_ready_timeout');
  assert.equal(state.elapsedMs, 1070);
  assert.equal(state.domReadyMs, 70);
  drained(f); completedOnce(f);
  for (const callback of late) callback();
  assert.deepEqual(f.timing.state(), state);
  completedOnce(f); drained(f);
});

test('the usual two-frame completion wins and clears its timeout and visibility listener', () => {
  const f = fixture(), token = start(f);
  f.advance(60); f.timing.finish(token, data());
  const timeout = f.timeout();
  assert.equal(typeof timeout, 'function');
  f.frame(); assert.equal(f.timing.state().status, 'finishing');
  f.frame();
  const state = f.timing.state();
  assert.equal(state.completionBasis, 'animation_frames');
  assert.equal(state.elapsedMs, 92);
  assert.equal(state.domReadyMs, 60);
  drained(f); completedOnce(f);
  timeout(); f.advance(2000);
  assert.deepEqual(f.timing.state(), state);
  completedOnce(f); drained(f);
});

test('a missing second animation callback is also bounded by the same timeout', () => {
  const f = fixture(), token = start(f);
  f.advance(20); f.timing.finish(token, data()); f.frame();
  const secondFrame = [...f.frames.values()][0];
  assert.equal(typeof secondFrame, 'function');
  f.advance(984);
  assert.equal(f.timing.state().completionBasis, 'dom_ready_timeout');
  assert.equal(f.timing.state().elapsedMs, 1020);
  const state = f.timing.state(); secondFrame();
  assert.deepEqual(f.timing.state(), state);
  drained(f); completedOnce(f);
});

test('a hidden tab completes from verified DOM readiness without waiting for callbacks', () => {
  const f = fixture(); f.hidden();
  const token = start(f); f.advance(35);
  assert.equal(f.timing.finish(token, data(), () => true), true);
  const state = f.timing.state();
  assert.equal(state.status, 'complete');
  assert.equal(state.completionBasis, 'dom_ready_hidden');
  assert.equal(state.domReadyMs, 35);
  assert.equal(state.elapsedMs, 35);
  drained(f); completedOnce(f);
});

test('switching to a background tab during the frame wait settles and removes all pending work', () => {
  const f = fixture(), token = start(f);
  f.advance(40); f.timing.finish(token, data()); f.frame();
  const late = f.callbacks();
  f.advance(10); f.hidden();
  const state = f.timing.state();
  assert.equal(state.status, 'complete');
  assert.equal(state.completionBasis, 'dom_ready_hidden');
  assert.equal(state.domReadyMs, 40);
  assert.equal(state.elapsedMs, 66);
  drained(f); completedOnce(f);
  f.hidden(false); for (const callback of late) callback();
  assert.deepEqual(f.timing.state(), state);
  drained(f); completedOnce(f);
});

test('visibilityState alone can identify a hidden document', () => {
  const f = fixture(), token = start(f);
  f.document.visibilityState = 'hidden';
  f.timing.finish(token, data());
  assert.equal(f.timing.state().completionBasis, 'dom_ready_hidden');
  drained(f);
});

test('an invalid initial result guard never arms the completion fallback', () => {
  const f = fixture(), token = start(f);
  assert.equal(f.timing.finish(token, data(), () => false), false);
  assert.equal(f.timing.finish(token, data(), () => { throw new Error('guard unavailable'); }), false);
  assert.equal(f.timeout(), undefined);
  assert.equal(f.frames.size, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.timing.state().domReadyMs, null);
  f.advance(1500);
  assert.equal(f.timing.state().status, 'running');
  assert.equal(f.changes.some(s => s.status === 'complete'), false);
  f.timing.dispose(); drained(f);
});

for (const path of ['animation_frames', 'dom_ready_timeout', 'dom_ready_hidden']) {
  test(`the ${path} path rechecks the final saved-result guard before reporting success`, () => {
    let valid = true;
    const f = fixture(), token = start(f);
    f.timing.finish(token, data(), () => valid);
    valid = false;
    if (path === 'animation_frames') { f.frame(); f.frame(); }
    else if (path === 'dom_ready_timeout') f.advance(1000);
    else f.hidden();
    assert.equal(f.timing.state().status, 'cancelled');
    assert.equal(f.timing.state().reason, 'context_changed');
    assert.equal(f.timing.state().completionBasis, null);
    assert.equal(f.changes.some(s => s.status === 'complete'), false);
    drained(f);
  });
}

test('the fallback rechecks the period/auth context even if normal tick callbacks never ran', () => {
  let valid = true;
  const f = fixture({ isCurrent: () => valid }), token = start(f);
  f.timing.finish(token, data()); const timeout = f.timeout();
  valid = false; f.jump(1000); timeout();
  assert.equal(f.timing.state().status, 'cancelled');
  assert.equal(f.timing.state().reason, 'context_changed');
  assert.equal(f.changes.some(s => s.status === 'complete'), false);
  drained(f);
});

test('a final guard that throws cancels rather than converting a timeout into success', () => {
  let throwNow = false;
  const f = fixture(), token = start(f);
  f.timing.finish(token, data(), () => { if (throwNow) throw new Error('changed store state'); return true; });
  throwNow = true; f.advance(1000);
  assert.equal(f.timing.state().status, 'cancelled');
  assert.equal(f.changes.some(s => s.status === 'complete'), false);
  drained(f);
});

for (const action of ['cancel', 'dispose']) {
  test(`${action} clears the frame wait and late callbacks cannot report completion`, () => {
    const f = fixture(), token = start(f);
    f.advance(25); f.timing.finish(token, data());
    const late = f.callbacks();
    if (action === 'cancel') f.timing.cancel('view closed'); else f.timing.dispose();
    const state = f.timing.state();
    assert.equal(state.status, 'cancelled');
    drained(f);
    for (const callback of late) callback();
    f.advance(5000); f.hidden();
    assert.deepEqual(f.timing.state(), state);
    assert.equal(f.changes.some(s => s.status === 'complete'), false);
    drained(f);
    if (action === 'dispose') assert.equal(f.timing.start({ mode: 'new_query' }), null);
  });
}

test('a new request supersedes the old fallback without touching the new request state', () => {
  const f = fixture(), oldToken = start(f);
  f.timing.finish(oldToken, data()); const late = f.callbacks();
  const token = f.timing.start({ mode: 'new_query', period: PERIOD });
  assert.notEqual(token, oldToken);
  assert.equal(f.timing.acceptRequest(token, 'request-new'), true);
  const state = f.timing.state(), timerCount = f.timers.size;
  assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0);
  for (const callback of late) callback();
  assert.deepEqual(f.timing.state(), state);
  assert.equal(f.timers.size, timerCount);
  assert.equal(f.timing.finish(oldToken, data()), false);
  assert.equal(f.timing.finish(token, data()), false);
  assert.equal(f.timeout(), undefined);
  assert.equal(f.timing.finish(token, data({ requestId: 'request-new' })), true);
  f.advance(1000);
  assert.equal(f.timing.state().requestId, 'request-new');
  completedOnce(f); drained(f);
});

test('pending, missing and foreign new-query request IDs cannot schedule a successful fallback', () => {
  const f = fixture(), token = f.timing.start({ mode: 'new_query', period: PERIOD });
  assert.equal(f.timing.finish(token, data()), false);
  assert.equal(f.timing.finish(token, {}), false);
  assert.equal(f.timing.acceptRequest(token, REQUEST), true);
  assert.equal(f.timing.finish(token, data({ requestId: null })), false);
  assert.equal(f.timing.finish(token, data({ requestId: 'foreign' })), false);
  assert.equal(f.timeout(), undefined);
  assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0);
  f.advance(1200);
  assert.equal(f.timing.state().status, 'running');
  assert.equal(f.changes.some(s => s.status === 'complete'), false);
  f.timing.dispose(); drained(f);
});

test('forced requery cannot use the previous saved result to activate the timeout path', () => {
  const f = fixture(), token = f.timing.start({ mode: 'forced_requery', previousRequestId: 'old' });
  f.timing.acceptRequest(token, 'old');
  assert.equal(f.timing.finish(token, data({ requestId: 'old' })), false);
  assert.equal(f.timeout(), undefined);
  assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0);
  f.timing.dispose(); drained(f);
});

test('DOM readiness and completion timings stay separate while backend measurements and caller data stay unchanged', () => {
  const f = fixture(), token = start(f), payload = data();
  const before = JSON.parse(JSON.stringify(payload));
  f.advance(25); f.timing.mark(token, 'complete_seen', REQUEST);
  f.advance(25); f.timing.mark(token, 'result_received', REQUEST);
  f.advance(30); f.timing.finish(token, payload);
  assert.equal(f.timing.state().domReadyMs, 80);
  f.advance(1000);
  const state = f.timing.state();
  assert.equal(state.querySeconds, 2.25);
  assert.equal(state.workerSeconds, 8.5);
  assert.equal(state.controllerSeconds, 9.75);
  assert.equal(state.agentSeconds, 12.5);
  assert.deepEqual(payload, before);
  assert.equal(row(state, '완료 관측 → 결과 수신'), 0.025);
  assert.equal(row(state, '결과 수신 → 화면 반영'), 1.03);
  assert.equal(row(state, '  결과 수신 → 계산·DOM 준비'), 0.03);
  assert.equal(row(state, '  DOM 준비 → 완료 처리 (프레임 대기 상한 적용)'), 1);
  assert.equal(row(state, 'Excel 준비'), 5);
  assert.equal(row(state, '  Excel 연결 (준비에 포함)'), 2.5);
  assert.equal(row(state, 'DataPARC 조회'), 2.25);
  assert.equal(row(state, 'Excel 종료·정리'), 1.25);
  assert.equal(row(state, '회사 PC 전체 (시작·후처리 포함)'), 12.5);
  assert.ok(state.details.every(item => Number.isFinite(item.seconds) && item.seconds >= 0));
  drained(f);
});

for (const [path, label] of [['animation_frames', '2프레임'], ['dom_ready_hidden', '백그라운드 DOM 기준']]) {
  test(`${path} describes its completion basis without claiming physical paint`, () => {
    const f = fixture(), token = start(f);
    f.advance(10); f.timing.mark(token, 'result_received', REQUEST);
    f.advance(20); f.timing.finish(token, data());
    if (path === 'animation_frames') { f.frame(); f.frame(); } else f.hidden();
    const state = f.timing.state();
    assert.equal(state.completionBasis, path);
    assert.equal(row(state, '  결과 수신 → 계산·DOM 준비'), 0.02);
    assert.equal(row(state, `  DOM 준비 → 완료 처리 (${label})`), path === 'animation_frames' ? 0.032 : 0);
    assert.equal(state.details.filter(item => item.label.startsWith('  DOM 준비 → 완료 처리')).length, 1);
    drained(f);
  });
}

test('missing or stale receipt observations do not invent a new timing breakdown', () => {
  const f = fixture(), token = start(f);
  assert.equal(f.timing.mark(token, 'result_received', 'foreign'), false);
  f.timing.finish(token, data()); f.advance(1000);
  assert.equal(f.timing.state().details.some(item => item.label.startsWith('  결과 수신 → 계산·DOM 준비') || item.label.startsWith('  DOM 준비 → 완료 처리')), false);
  assert.equal(f.timing.state().domReadyMs, 0);
  drained(f);
});

test('monotonic measurements stay nonnegative when the wall clock moves backwards', () => {
  const f = fixture(), token = start(f);
  f.advance(15); f.timing.mark(token, 'result_received', REQUEST);
  f.advance(25); f.wall('2020-01-01T00:00:00.000Z'); f.timing.finish(token, data());
  f.advance(1000);
  const state = f.timing.state();
  assert.equal(state.domReadyMs, 40);
  assert.equal(state.elapsedMs, 1040);
  assert.equal(state.finishedAt, '2020-01-01T00:00:00.000Z');
  assert.equal(row(state, '  결과 수신 → 계산·DOM 준비'), 0.025);
  assert.equal(row(state, '  DOM 준비 → 완료 처리 (프레임 대기 상한 적용)'), 1);
  assert.ok(state.details.every(item => item.seconds >= 0));
  drained(f);
});

test('a state observer starting a new request during finishing cannot arm the old completion work', () => {
  let f, superseded = false, newToken;
  f = fixture({ onChange(state) { if (state.status === 'finishing' && !superseded) { superseded = true; newToken = f.timing.start({ mode: 'new_query', period: PERIOD }); } } });
  const token = start(f);
  assert.equal(f.timing.finish(token, data()), true);
  assert.notEqual(newToken, token);
  assert.equal(f.timing.state().status, 'running');
  assert.equal(f.timing.state().domReadyMs, null);
  assert.equal(f.timeout(), undefined);
  assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0);
  f.timing.dispose(); drained(f);
});
