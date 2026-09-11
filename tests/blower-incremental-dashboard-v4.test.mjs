import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] || process.cwd());
const html = fs.readFileSync(path.join(root, 'maintenance/blower-history.html'), 'utf8');
const uiSource = fs.readFileSync(path.join(root, 'maintenance/blower-history.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'maintenance/blower-history.css'), 'utf8');
const unifiedCss = fs.readFileSync(path.join(root, 'maintenance/blower-unified-refresh.css'), 'utf8');
const requestApi = fs.readFileSync(path.join(root, 'functions/api/ois-data-requests.js'), 'utf8');
const historyApi = fs.readFileSync(path.join(root, 'functions/api/blower-history.js'), 'utf8');
const require = createRequire(import.meta.url);
const core = require(path.join(root, 'maintenance/blower-unified-refresh.js'));
const incremental = await import(pathToFileURL(path.join(root, 'functions/_shared/blower-incremental.js')).href);

const signal = 'GSPOGE.ABB_DCS.TEST_ONLY_CONFIRMED_BINARY';

function asset(overrides = {}) {
  return {
    tagNumber: '104ETG30AN601',
    blowerType: 'flyash_bag',
    displayName: '#1호기 Fly Ash Bag Filter #A',
    enabled: true,
    lastReplacementAt: '2026-06-01T09:00:00+09:00',
    cycleStartState: 'legacy',
    cycleStoredStartedAt: '',
    cycleStartedAt: '',
    cycleStartRevision: 'cycle-start-r1',
    cycleRuntimeRevision: 'cycle-runtime-r1',
    dataParcTag: signal,
    ...overrides
  };
}

test('all-status dashboard owns one large latest-query card, one refresh icon, and live 0-100 progress UI', () => {
  assert.equal((html.match(/id="refreshButton"/g) || []).length, 1);
  assert.match(html, /id="overviewRefreshPanel"[\s\S]*?<span>최신 조회<\/span>[\s\S]*?id="overviewLatestQueryAt"/);
  assert.match(html, /id="overviewRefreshPercent">0%<\/strong>/);
  assert.match(html, /role="progressbar"[\s\S]*?aria-valuemin="0"[\s\S]*?aria-valuemax="100"/);
  assert.match(html, /<svg class="overview-refresh-icon"[^>]*>[\s\S]*?overview-refresh-icon-ring[\s\S]*?<\/svg>/);
  assert.doesNotMatch(html, />↻<\/span>/);
  assert.match(css, /\.overview-refresh-latest\s*>\s*strong[\s\S]*?font-size:\s*clamp\(/);
  assert.match(css, /\.overview-refresh-button\.is-spinning[\s\S]*?animation:\s*blower-overview-refresh-spin/);
  assert.match(css, /@keyframes blower-overview-refresh-spin/);
  assert.match(css, /\.overview-refresh-progress-track\s*>\s*span[\s\S]*?transition:\s*width/);
  assert.match(unifiedCss, /#refreshButton\.overview-refresh-button\s*\{\s*min-width:\s*48px/);
  assert.doesNotMatch(uiSource, /elements\.refreshButton\.textContent\s*=\s*`?최신화/);
});

test('dashboard explains append-only behavior and computes percentage from actually processed Blowers', () => {
  assert.match(uiSource, /다음 통합조회는 각 설비의 마지막 조회 종료시각 이후 구간만 이어서 조회합니다/);
  assert.match(uiSource, /Math\.floor\(\(safeProcessed\s*\/\s*safeTarget\)\s*\*\s*100\)/);
  assert.match(uiSource, /기존 저장값 유지|기존 누적값에 추가/);
  assert.match(uiSource, /기존 DataPARC 조회값 유지/);
  assert.match(uiSource, /setOverviewRefreshProcessed\(planned\.targetCount, planned\.targetCount/);
});

test('next unified query starts exactly at the previous successful end while preserving the original coverage start', () => {
  const previous = {
    startAt: '2026-06-01T09:00:00+09:00',
    observedAt: '2026-09-11T09:00:00+09:00',
    appendReady: true,
    dataParcTag: signal
  };
  const planned = core.plan([asset({ dataParcRuntimeBasis: previous })], new Date('2026-09-11T10:00:00+09:00'));
  assert.equal(planned.tasks.length, 1);
  assert.equal(planned.tasks[0].incremental, true);
  assert.equal(planned.tasks[0].startAt, previous.startAt);
  assert.equal(planned.tasks[0].queryStartAt, previous.observedAt);
});



test('existing confirmed results fail closed instead of falling back to a full-range requery', () => {
  const previous = {
    startAt: '2026-06-01T09:00:00+09:00',
    observedAt: '2026-09-11T09:00:00+09:00',
    appendReady: false,
    dataParcTag: signal
  };
  const planned = core.plan([asset({ dataParcRuntimeBasis: previous })], new Date('2026-09-11T10:00:00+09:00'));
  assert.equal(planned.tasks.length, 0);
  assert.equal(planned.skipped.length, 1);
  assert.match(planned.skipped[0].message, /기존 조회값 보호/);
  assert.match(planned.skipped[0].message, /전체 재조회하지 않음/);

  assert.match(requestApi, /body\.requireIncrementalAppend === true && !appendBase/);
  assert.match(requestApi, /BLOWER_INCREMENTAL_BASE_REQUIRED/);
});

test('browser marks every append task as requiring the server-side append base', async () => {
  const previous = {
    startAt: '2026-06-01T09:00:00+09:00',
    observedAt: '2026-09-11T09:00:00+09:00',
    appendReady: true,
    dataParcTag: signal
  };
  const task = core.plan([asset({ dataParcRuntimeBasis: previous })], new Date('2026-09-11T10:00:00+09:00')).tasks[0];
  let requestBody = null;
  const io = {
    assertWritable() {},
    progress() {},
    api: async options => {
      if (options?.body?.action === 'create_blower_runtime_probe') {
        requestBody = options.body;
        return { upToDate: true, message: 'test' };
      }
      throw new Error('unexpected API call');
    }
  };
  await core.executeDataParc(task, io);
  assert.equal(requestBody.incrementalRefresh, true);
  assert.equal(requestBody.requireIncrementalAppend, true);
  assert.equal(requestBody.startAt, previous.startAt);
});

test('server, not the browser, owns the append boundary and old cumulative value is combined with only the new RUN seconds', () => {
  assert.match(requestApi, /if \(body\.incrementalRefresh === true\)[\s\S]*?appendBase = await loadAppendBase\(database, asset, dataParcTag\)[\s\S]*?requestedStartText = appendBase\.observedAt/);
  assert.match(historyApi, /probe = combineAppendProbe\(probe, appendIntent\)/);
  assert.match(historyApi, /이전 조회값 보존/);

  const probe = {
    requestId: 'q-next', expectedCycleRuntimeRevision: 'rev-1',
    expectedLastReplacementAt: '2026-06-01T09:00:00+09:00',
    startAt: '2026-09-11T09:00:00+09:00', observedAt: '2026-09-11T10:00:00+09:00',
    runningSeconds: 1800, runtimeHours: 0.5
  };
  const receipt = {
    request_id: 'q-next', base_event_id: 'dataparc_runtime:q-prev', base_revision: 'rev-1',
    base_observed_at: '2026-09-11T09:00:00+09:00', coverage_start_at: '2026-06-01T09:00:00+09:00',
    base_running_seconds: 360000
  };
  const combined = incremental.combineAppendProbe(probe, receipt);
  assert.equal(combined.incremental.baseRunningSeconds, 360000);
  assert.equal(combined.incremental.deltaRunningSeconds, 1800);
  assert.equal(combined.incremental.totalRunningSeconds, 361800);
  assert.equal(combined.runtimeHours, 361800 / 3600);
  assert.equal(combined.incremental.coverageStartAt, '2026-06-01T09:00:00+09:00');
});
