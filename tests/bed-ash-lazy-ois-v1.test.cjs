'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {collectBedAshWithHourlyFallback: realFallback} =
  require('../local-tools/ois-agent/bed-ash-minute-dataparc-agent.js');

// Read declarations only. Never import or execute the Agent entry point.
const source = fs.readFileSync(process.env.BED_ASH_MAIN_SOURCE ||
  path.join(__dirname, '../local-tools/ois-agent/ois-login.js'), 'utf8').replace(/\r\n?/g, '\n');
const config = Object.freeze({fixture: true});
const request = Object.freeze({id: 'bed-ash-fixture', requestType: 'bed_ash_level', targetDate: '2026-11-12'});
const silent = {log(){}, warn(){}, error(){}};

function closing(text, start, left, right) {
  let depth = 0, quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === '\\') {i++; continue;} if (c === quote) quote = null; continue; }
    if (text.startsWith('//', i)) { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (text.startsWith('/*', i)) {i = text.indexOf('*/', i + 2) + 1; assert.ok(i > 0); continue;}
    if (['"', "'", '`'].includes(c)) {quote = c; continue;}
    if (c === left) depth++; else if (c === right && --depth === 0) return i;
  }
  throw new Error('fixture declaration boundary missing');
}
function declaration(name) {
  const matcher = new RegExp(`(?:async )?function ${name}\\s*\\(`);
  const match = matcher.exec(source); assert.ok(match, `${name} exists`);
  const start = match.index, paren = source.indexOf('(', start);
  const endParen = closing(source, paren, '(', ')'), brace = source.indexOf('{', endParen);
  return source.slice(start, closing(source, brace, '{', '}') + 1);
}
function processDeclaration() {
  const start = source.indexOf('const processRequestItem = async requestItem =>');
  assert.ok(start >= 0, 'real Agent request handler exists');
  const brace = source.indexOf('{', start);
  return source.slice(start, closing(source, brace, '{', '}') + 1) + ';';
}
function vmLoad(extra = {}, includeProcess = false) {
  const context = vm.createContext({console: silent, ...extra});
  const definitions = [declaration('collectBedAshWithLazyOisFallback')];
  if (includeProcess) definitions.push(...[
    'isDailyDataExcelRequestType', 'isExcelComRequestType', 'isExcelOnlyRequestType'
  ].map(declaration));
  vm.runInContext(definitions.join('\n'), context);
  return context;
}
function error(message, {cleanupVerified, closed = false} = {}) {
  const value = new Error(message);
  if (cleanupVerified !== undefined) value.cleanupVerified = cleanupVerified;
  if (closed) value.code = 'BROWSER_CLOSED';
  return value;
}

function helperFixture({precise = async () => ({sourceKind: 'dataparc-minute', marker: 'precise'}), hourly} = {}) {
  const events = [], sessions = [1, 2, 3].map(id => ({id, usable: true}));
  let preciseCount = 0, fallbackCount = 0, ensureCount = 0, hourlyCount = 0;
  const context = vmLoad({
    collectBedAshWithHourlyFallback(actualConfig, actualRequest, options) {
      assert.equal(actualConfig, config); assert.equal(actualRequest, request);
      fallbackCount++;
      return realFallback(actualConfig, actualRequest, {...options, log(){},
        precise: async (c, r) => {preciseCount++; events.push('precise'); return precise(c, r);}});
    }
  });
  const ops = {
    async ensure(reason) {assert.equal(typeof reason, 'string'); events.push('ensure'); return sessions[ensureCount++];},
    async closeAuxiliaryPages(session) {events.push(`aux:${session.id}`);},
    async collectHourly(session) {
      hourlyCount++; events.push(`hourly:${session.id}`);
      return hourly ? hourly(session, hourlyCount) : {marker: 'hourly'};
    },
    async close(session) {events.push(`close:${session.id}`); session.usable = false;},
    isBrowserClosedError(value) {return value?.code === 'BROWSER_CLOSED';},
    isBrowserSessionUsable(session) {return !!session?.usable;},
    warn() {events.push('warn');}
  };
  return {events, sessions, ops,
    run: () => context.collectBedAshWithLazyOisFallback(config, request, ops),
    counts: () => ({preciseCount, fallbackCount, ensureCount, hourlyCount})};
}

test('actual lazy helper returns successful precise data without acquiring an OIS session', async () => {
  const payload = {sourceKind: 'dataparc-minute', marker: 'same-object'};
  const f = helperFixture({precise: async () => payload});
  assert.equal(await f.run(), payload);
  assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1, ensureCount: 0, hourlyCount: 0});
  assert.deepEqual(f.events, ['precise']);
});

test('real fallback cleanup gate rejects false, absent and nonboolean cleanup flags before OIS', async () => {
  for (const cleanupVerified of [false, undefined, 'true']) {
    const failure = error('precise cleanup not proved', {cleanupVerified, closed: true});
    const f = helperFixture({precise: async () => {throw failure;}});
    await assert.rejects(f.run(), actual => actual === failure);
    assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1, ensureCount: 0, hourlyCount: 0});
    assert.deepEqual(f.events, ['precise']);
  }
});

test('verified precise failure lazily ensures and cleans OIS once before the real hourly fallback', async () => {
  const f = helperFixture({precise: async () => {throw error('raw query failed', {cleanupVerified: true});}});
  const result = await f.run();
  assert.equal(result.marker, 'hourly');
  assert.equal(result.sourceKind, 'ois_hourly_fallback');
  assert.equal(result.sampleIntervalSeconds, 3600);
  assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1, ensureCount: 1, hourlyCount: 1});
  assert.deepEqual(f.events.filter(e => e !== 'warn'), ['precise', 'ensure', 'aux:1', 'hourly:1']);
});

test('closed-browser hourly failure retries only hourly once and never repeats precise collection', async () => {
  const f = helperFixture({precise: async () => {throw error('precise unavailable', {cleanupVerified: true});},
    hourly: async (_session, attempt) => {if (attempt === 1) throw error('browser closed', {closed: true}); return {attempt};}});
  const result = await f.run(); assert.equal(result.attempt, 2);
  assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1, ensureCount: 2, hourlyCount: 2});
  assert.deepEqual(f.events.filter(e => e !== 'warn'), [
    'precise', 'ensure', 'aux:1', 'hourly:1', 'close:1', 'ensure', 'hourly:2'
  ]);
});

test('an unusable hourly session receives the same bounded hourly-only recovery', async () => {
  const f = helperFixture({precise: async () => {throw error('precise unavailable', {cleanupVerified: true});},
    hourly: async (session, attempt) => {
      if (attempt === 1) {session.usable = false; throw error('frame disconnected');}
      return {attempt};
    }});
  assert.equal((await f.run()).attempt, 2);
  assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1, ensureCount: 2, hourlyCount: 2});
});

test('ordinary hourly failure on a usable session is not retried', async () => {
  const failure = error('hourly source returned invalid data');
  const f = helperFixture({precise: async () => {throw error('precise unavailable', {cleanupVerified: true});},
    hourly: async () => {throw failure;}});
  await assert.rejects(f.run(), actual => actual === failure);
  assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1, ensureCount: 1, hourlyCount: 1});
  assert.equal(f.events.some(e => e.startsWith('close:')), false);
});

test('second closed-browser failure stops after two hourly attempts and one precise attempt', async () => {
  const failure = error('still closed', {closed: true});
  const f = helperFixture({precise: async () => {throw error('precise unavailable', {cleanupVerified: true});},
    hourly: async () => {throw failure;}});
  await assert.rejects(f.run(), actual => actual === failure);
  assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1, ensureCount: 2, hourlyCount: 2});
});

function handlerFixture({precise, uploadError, hourly, initiallyUsable = false} = {}) {
  const events = [], posted = [], failed = [];
  let preciseCount = 0, fallbackCount = 0;
  const session = {usable: initiallyUsable, page: {fixture: true},
    context: {async storageState() {events.push('storage');}}};
  const context = vmLoad({
    normalizeOisAgentText: value => String(value ?? '').trim(),
    getOisAgentRequestType: item => item.requestType,
    BLOWER_RUNTIME_PROBE_REQUEST_TYPE: 'blower_runtime_probe', ORGANIC_SILO_REQUEST_TYPE: 'organic_silo',
    OIS_SESSION_FILE_PATH: 'fixture-only-no-write',
    getOisAgentRequestLabel: () => 'Bed Ash fixture',
    collectBedAshWithHourlyFallback(c, r, options) {
      fallbackCount++;
      return realFallback(c, r, {...options, log(){}, precise: async () => {
        preciseCount++; events.push('precise');
        return precise ? precise() : {marker: 'precise', sourceKind: 'dataparc-minute'};
      }});
    },
    async ensureBrowserSession() {events.push('ensure'); session.usable = true; return session;},
    async closeOisAuxiliaryPages(actual) {assert.equal(actual, session); events.push('aux');},
    async closeBrowserSession(actual) {assert.equal(actual, session); events.push('close'); session.usable = false;},
    isBrowserClosedError: value => value?.code === 'BROWSER_CLOSED',
    isBrowserSessionUsable(actual) {events.push('usable-check'); return !!actual?.usable;},
    async collectOisBedAshLevelValues(page, c, day) {
      assert.equal(page, session.page); assert.equal(c, config); assert.equal(day, request.targetDate);
      events.push('hourly'); return hourly ? hourly(session) : {marker: 'hourly'};
    },
    async collectOisAgentRequestResult(_page, _config, item) {
      events.push('generic-collector'); assert.notEqual(item.requestType, 'bed_ash_level'); return {marker: 'generic'};
    },
    async completeOisAgentRequest(c, id, result, type) {
      assert.equal(c, config); events.push('complete'); posted.push({id, result, type});
      if (uploadError) throw uploadError;
    },
    async failOisAgentRequest(_c, id, failure) {events.push('fail'); failed.push({id, failure});},
    async saveOisAgentErrorScreenshot() {events.push('screenshot'); return '';},
    printOisAgentRequestResult() {events.push('print');}
  }, true);
  context.__session = session; context.__config = config;
  vm.runInContext(`
    let browserSession = __session;
    const config = __config;
    const morningWorkerBatch = null;
    const phase27aHasWaterRequest = false;
    let phase27aWaterFinished = true;
    let morningExcelActive = false;
    let morningOwnerSessionExpired = false;
    ${processDeclaration()}
    globalThis.runRequest = processRequestItem;
  `, context);
  return {events, posted, failed, context,
    run: (item = request) => context.runRequest(item),
    counts: () => ({preciseCount, fallbackCount})};
}

function assertNoBrowserEvents(events) {
  for (const name of ['ensure', 'aux', 'close', 'storage', 'screenshot', 'hourly', 'usable-check', 'generic-collector']) {
    assert.equal(events.includes(name), false, `unexpected ${name}: ${events.join(',')}`);
  }
}

test('real request handler completes precise Bed Ash without browser setup, storage or generic routing', async () => {
  for (const initiallyUsable of [false, true]) {
    const f = handlerFixture({initiallyUsable}); await f.run();
    assertNoBrowserEvents(f.events);
    assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1});
    assert.equal(f.posted.length, 1); assert.equal(f.posted[0].result.marker, 'precise');
    assert.equal(f.failed.length, 0);
  }
});

test('real request handler keeps unsafe cleanup failure away from browser recovery and screenshots', async () => {
  for (const initiallyUsable of [false, true]) {
    const failure = error('precise cleanup unsafe', {cleanupVerified: false, closed: true});
    const f = handlerFixture({initiallyUsable, precise: async () => {throw failure;}}); await f.run();
    assertNoBrowserEvents(f.events);
    assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1});
    assert.equal(f.posted.length, 0); assert.equal(f.failed.length, 1); assert.equal(f.failed[0].failure, failure);
  }
});

test('precise result upload failure cannot trigger OIS setup, state writes or screenshots', async () => {
  for (const initiallyUsable of [false, true]) {
    const uploadError = error('upload failed with browser-like message', {closed: true});
    const f = handlerFixture({initiallyUsable, uploadError}); await f.run();
    assertNoBrowserEvents(f.events);
    assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1});
    assert.equal(f.posted.length, 1); assert.equal(f.failed.length, 1); assert.equal(f.failed[0].failure, uploadError);
  }
});

test('real request handler activates ordinary OIS state behavior only after verified hourly fallback', async () => {
  const f = handlerFixture({precise: async () => {throw error('minute failed', {cleanupVerified: true});}});
  await f.run();
  assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1});
  assert.equal(f.events.filter(e => e === 'ensure').length, 1);
  assert.equal(f.events.filter(e => e === 'aux').length, 1);
  assert.equal(f.events.filter(e => e === 'hourly').length, 1);
  assert.equal(f.events.filter(e => e === 'storage').length, 1);
  assert.equal(f.events.includes('generic-collector'), false);
  assert.equal(f.posted[0].result.sourceKind, 'ois_hourly_fallback');
});

test('real request handler does not add a third browser recovery after the second hourly failure', async () => {
  const failure = error('hourly browser remains closed', {closed: true});
  const f = handlerFixture({
    precise: async () => {throw error('precise unavailable', {cleanupVerified: true});},
    hourly: async session => {session.usable = false; throw failure;}
  });
  await f.run();
  assert.deepEqual(f.counts(), {preciseCount: 1, fallbackCount: 1});
  assert.equal(f.events.filter(e => e === 'ensure').length, 2);
  assert.equal(f.events.filter(e => e === 'close').length, 1);
  assert.equal(f.events.filter(e => e === 'hourly').length, 2);
  assert.equal(f.events.includes('storage'), false);
  assert.equal(f.events.includes('screenshot'), false);
  assert.equal(f.posted.length, 0);
  assert.equal(f.failed.length, 1); assert.equal(f.failed[0].failure, failure);
});

test('Bed Ash stays in the existing OIS lane and ordinary OIS requests keep their browser routing', async () => {
  const f = handlerFixture();
  assert.equal(f.context.isExcelOnlyRequestType('bed_ash_level'), false);
  assert.equal(f.context.isExcelComRequestType('bed_ash_level'), false);
  await f.run({...request, id: 'ordinary-ois', requestType: 'turbine_gear_pinion'});
  assert.deepEqual(f.counts(), {preciseCount: 0, fallbackCount: 0});
  assert.equal(f.events.filter(e => e === 'ensure').length, 1);
  assert.equal(f.events.filter(e => e === 'aux').length, 1);
  assert.equal(f.events.filter(e => e === 'generic-collector').length, 1);
  assert.equal(f.events.filter(e => e === 'storage').length, 1);
});
