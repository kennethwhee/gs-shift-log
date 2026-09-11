/* BLOWER_UNIFIED_REFRESH_V1 — deterministic planning and serial request handling. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlowerUnifiedRefresh = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const SIGNAL = 'GSPOGE.ABB_DCS.003ETH03AN602XB04';
  const DP_TAGS = new Set(['104ETH03AN601','104ETH03AN602','104ETG30AN601','104ETG30AN602',
    '204ETG30AN601','204ETG30AN602','104SDF01AN001','104SDF01AN002','204SDF01AN001','204SDF01AN002','204LMDF01AN001']);
  // Equipment identities only; actual 1/0 RUN signals must be field-confirmed.
  DP_TAGS.add("104HHL60AP611");
  DP_TAGS.add("104HHL60AP621");
  DP_TAGS.add("104HHL60AP631");
  DP_TAGS.add("204HHL60AP611");
  DP_TAGS.add("204HHL60AP621");
  DP_TAGS.add("204HHL60AP631");
  DP_TAGS.add("104HHL10AN611");
  DP_TAGS.add("104HHL10AN621");
  DP_TAGS.add("104HHL10AN631");
  DP_TAGS.add("204HHL10AN611");
  DP_TAGS.add("204HHL10AN621");
  DP_TAGS.add("204HHL10AN631");
  const bridges = Object.create(null);
  const time = value => value ? Date.parse(value) : NaN;
  const day = value => { const n = value instanceof Date ? value.getTime() : time(value); return Number.isFinite(n) ? new Date(n + 9 * 3600000).toISOString().slice(0,10) : ''; };
  function intermittent(a) {
    return a?.blowerType === 'organic_fuel' || a?.assetGroup === 'manure' || a?.tagNumber === '204LMDF01AN001';
  }

  function fbheSealRunAsset(a) {
    return /^(?:104|204)HHL(?:60AP|10AN)(?:611|621|631)$/.test(String(a?.tagNumber || '').trim().toUpperCase());
  }
  function fbheSealRunView(a, basis = null) {
    if (!fbheSealRunAsset(a)) return null;
    const p = a.runRuntime || {};
    const verified = p.verified === true && ['dataparc','manual'].includes(p.source) &&
      a.measurementRequired !== true && a.cycleElapsedHours !== null && a.cycleElapsedHours !== undefined &&
      Number.isFinite(Number(a.cycleElapsedHours)) && Number(a.cycleElapsedHours) >= 0;
    const configured = Boolean(a.dataParcTag);
    const pending = a.cycleStartState === 'pending' && !verified;
    const manual = verified && p.source === 'manual';
    const state = pending ? 'startup_pending' : verified && ['running','stopped'].includes(p.state) ? p.state : 'unknown';
    const hours = verified ? Number(a.cycleElapsedHours) : null;
    const primary = pending ? (configured ? 'RUN 재조회 필요' : 'RUN 조회 전') : verified
      ? `${hours.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}시간`
      : configured ? 'RUN 재조회 필요' : 'RUN 조회 전';
    const message = !a.lastReplacementAt ? '교체일 등록 후 RUN TAG를 연결해 주세요.'
      : manual ? (configured ? '직접 입력한 누적시간 · 다음 최신화에서 RUN 구간으로 재계산' : '직접 입력한 누적시간 · RUN TAG 연결 필요 · 이력 보기 → 조회 기준·상세')
      : verified ? 'RUN=1인 구간만 합산 · 상태는 조회 시점 기준'
      : !configured ? 'RUN TAG 연결 필요 · 이력 보기 → 조회 기준·상세'
      : pending ? 'RUN 조회 전 · 수동 기동등록 없이 DataPARC 1/0 신호로 확인'
      : '현재 교체 기준의 RUN 최신화 필요 · 이전 기록은 이력에 보존';
    return { verified, manual, pending, state, hours, primary, message,
      measuredAt: p.measuredAt || '', sourceLabel: manual ? '수동 보정' : 'DataPARC · RUN 1/0',
      basis: verified && !manual ? basis : null,
      stateLabel: pending ? 'RUN 미확인' : !verified ? 'RUN 미확인' :
        `${manual ? '수동 ' : ''}${state === 'running' ? '기동중' : '정지중'}` };
  }

  function snapshot(a) {
    return { tagNumber: a.tagNumber, lastReplacementAt: a.lastReplacementAt || '',
      cycleStartState: a.cycleStartState || 'legacy', cycleStartedAt: a.cycleStoredStartedAt ?? a.cycleStartedAt ?? '',
      cycleStartRevision: a.cycleStartRevision || '', cycleRuntimeRevision: a.cycleRuntimeRevision || '' };
  }
  function sameCycle(a, b) {
    if (!a || !b) return false;
    const left = snapshot(a), right = snapshot(b);
    return Object.keys(left).every(k => left[k] === right[k]);
  }
  function plan(assets, now, basisFor = () => null) {
    const end = now instanceof Date ? now.getTime() : time(now), today = day(new Date(end));
    if (!Number.isFinite(end)) throw new Error('서버 기준시각을 확인할 수 없습니다.');
    const tasks = [], skipped = [];
    for (const a of assets || []) {
      if (a.enabled === false || a.enabled === 0) continue;
      const skip = reason => skipped.push({ tagNumber: a.tagNumber, displayName: a.displayName || a.tagNumber, status: 'skipped', message: reason });
      const replacement = time(a.lastReplacementAt);
      if (!Number.isFinite(replacement)) { skip('교체일 등록 필요 · 이력 보기 / V-Belt 교체 등록'); continue; }
      if (replacement >= end) { skip('교체일이 현재 시각 이후입니다.'); continue; }
      if (!DP_TAGS.has(a.tagNumber)) { skip('연결된 운전시간 조회 방식이 없습니다.'); continue; }
      const dataParcTag = a.tagNumber === '104ETH03AN602' ? SIGNAL : String(a.dataParcTag || '').trim();
      if (!/^GSPOGE\.ABB_DCS\.[A-Z0-9][A-Z0-9._-]*$/.test(dataParcTag) || dataParcTag.length > 200 || (a.tagNumber !== '104ETH03AN602' && dataParcTag === SIGNAL)) {
        skip('RUN TAG 설정 필요 · 이력 보기 → 조회 기준·상세'); continue;
      }
      const previous = a.dataParcRuntimeBasis || basisFor(a.tagNumber);
      // Preserve every already-confirmed result. Once a basis exists, the integrated refresh may
      // continue only from a server-verified append owner; it must never fall back to a full requery.
      const startAt = previous?.startAt || (a.cycleStartState === 'started' && a.cycleStartedAt) || a.lastReplacementAt;
      const incremental = previous?.appendReady === true && previous?.dataParcTag === dataParcTag;
      if (previous && !incremental) {
        skip('기존 조회값 보호 · 증분 이어조회 기준 확인 필요 · 전체 재조회하지 않음');
        continue;
      }
      const queryStartAt = incremental ? previous.observedAt : startAt;
      const start = time(startAt), queryStart = time(queryStartAt);
      if (incremental && Number.isFinite(queryStart) && Math.floor(end / 1000) <= Math.floor(queryStart / 1000)) {
        skipped.push({ tagNumber: a.tagNumber, displayName: a.displayName || a.tagNumber, status: 'complete', unchanged: true, message: '새 조회 구간 없음 · 기존 값 유지' }); continue;
      }
      if (!Number.isFinite(start) || !Number.isFinite(queryStart) || start < replacement || queryStart < start || queryStart >= end || end - queryStart > 366 * DAY) {
        skip('조회 기준이 현재 교체 Cycle 또는 366일 한도와 맞지 않습니다.'); continue;
      }
      tasks.push({ kind: 'dataparc', asset: a, snapshot: snapshot(a), startAt, queryStartAt, incremental, dataParcTag });
    }
    return { tasks, skipped, targetCount: (assets || []).filter(a => a.enabled !== false && a.enabled !== 0).length };
  }
  function error(message, code) { const e = new Error(message); e.code = code; return e; }
  async function waitRequests(items, io, options = {}) {
    const map = new Map((items || []).filter(x => x?.id).map(x => [String(x.id), x]));
    if (!map.size || map.size > 32) throw error('운전시간 요청 ID를 확인할 수 없습니다.', 'INVALID_REQUEST_IDS');
    const ids = [...map.keys()], clock = options.clock || Date.now, sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    const start = clock(), deadline = start + (options.timeoutMs || 2 * 3600000);
    const settleFailures = options.settleFailures === true;
    let retry = 0;
    while (clock() < deadline) {
      io.assertWritable?.();
      const all = [...map.values()];
      const failed = all.find(x => x.status === 'failed');
      if (failed && !settleFailures) throw error(failed.errorMessage || '회사 PC 조회에 실패했습니다.', 'REQUEST_FAILED');
      if (all.every(x => settleFailures ? ['complete', 'failed'].includes(x.status) : x.status === 'complete')) return all;
      if (all.some(x => !['pending', 'processing', 'complete', ...(settleFailures ? ['failed'] : [])].includes(x.status))) {
        throw error('알 수 없는 조회 상태입니다.', 'INVALID_REQUEST_STATUS');
      }
      // No Agent response: do not leave a large all-Blower queue waiting indefinitely.
      if (all.every(x => x.status === 'pending') && clock() - start >= (options.pendingTimeoutMs || 180000)) {
        throw error('회사 PC Agent 응답 대기시간을 초과했습니다. 완료된 값은 유지합니다.', 'AGENT_UNAVAILABLE');
      }
      const terminal = all.filter(x => ['complete', 'failed'].includes(x.status)).length;
      io.progress?.(`${terminal}/${all.length} · ${all.some(x => x.status === 'processing') ? 'DataPARC 일괄 계산 중' : '조회 대기 중'}`);
      await sleep(Math.min(2500, Math.max(0, deadline - clock())));
      let payloads;
      try {
        const groups = [];
        for (let index = 0; index < ids.length; index += 12) groups.push(ids.slice(index, index + 12));
        payloads = await Promise.all(groups.map((group, groupIndex) => io.api({
          url: `/api/ois-data-requests?action=status_batch&compact=1&ids=${encodeURIComponent(group.join(','))}&_=${clock() + groupIndex}`,
          timeoutMs: 20000
        })));
        retry = 0;
      } catch (e) {
        if (![0,429,502,503,504].includes(Number(e?.status || 0)) || retry >= 4) throw e;
        await sleep(Math.min(30000, Math.max(1000 * 2 ** retry++, Number(e.retryAfterMs) || 0))); continue;
      }
      const returned = payloads.flatMap(payload => Array.isArray(payload?.items) ? payload.items : []);
      if (ids.some(id => !returned.some(x => String(x.id) === id))) throw error('조회 요청 상태가 누락되었습니다.', 'REQUEST_MISSING');
      for (const item of returned) if (map.has(String(item.id))) map.set(String(item.id), item);
    }
    throw error('운전시간 조회가 최대 대기시간을 초과했습니다.', 'REQUEST_TIMEOUT');
  }

  function dataParcCreateBody(task) {
    const s = task.snapshot;
    return {
      action: 'create_blower_runtime_probe', unifiedRefresh: true, incrementalRefresh: true,
      requireIncrementalAppend: task.incremental === true, assetTag: s.tagNumber,
      dataParcTag: task.dataParcTag, confirmRunSignal: true, startAt: task.startAt,
      expectedLastReplacementAt: s.lastReplacementAt, expectedCycleStartState: s.cycleStartState,
      expectedCycleStartedAt: s.cycleStartedAt, expectedCycleStartRevision: s.cycleStartRevision,
      expectedCycleRuntimeRevision: s.cycleRuntimeRevision
    };
  }

  async function executeDataParcBatch(tasks, io) {
    const source = (tasks || []).filter(task => task?.snapshot?.tagNumber);
    if (!source.length) return [];
    io.assertWritable?.();
    io.progress?.(`${source.length}대 증분 조회 요청 등록 중`);

    // Enqueue every asset first.  The local Agent can then coalesce adjacent
    // blower_runtime_probe requests into one hidden-Excel session instead of
    // starting/stopping Excel once per Blower.
    const createOutcomes = await Promise.all(source.map(async task => {
      try {
        const created = await io.api({ method: 'POST', url: '/api/ois-data-requests', body: dataParcCreateBody(task) });
        return { task, created };
      } catch (cause) {
        return { task, cause };
      }
    }));

    const resultByTag = new Map();
    const pending = [];
    for (const outcome of createOutcomes) {
      const task = outcome.task, s = task.snapshot;
      if (outcome.cause) {
        if ([401, 403].includes(Number(outcome.cause?.status))) throw outcome.cause;
        resultByTag.set(s.tagNumber, { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber,
          status: 'failed', message: outcome.cause?.message || 'DataPARC 조회 요청 생성 실패' });
        continue;
      }
      if (outcome.created?.upToDate === true) {
        resultByTag.set(s.tagNumber, { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber,
          status: 'complete', unchanged: true, message: outcome.created.message || '새 조회 구간 없음 · 기존 값 유지' });
        continue;
      }
      const item = outcome.created?.item || outcome.created?.items?.[0];
      if (!item?.id) {
        resultByTag.set(s.tagNumber, { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber,
          status: 'failed', message: 'DataPARC 조회 요청 ID를 받지 못했습니다.' });
        continue;
      }
      pending.push({ task, item });
    }

    if (pending.length) {
      io.progress?.(`숨김 Excel 일괄 조회 준비 · ${pending.length}대`);
      const settled = await waitRequests(pending.map(entry => entry.item), io, { settleFailures: true, sleep: io.sleep, clock: io.clock });
      const statusById = new Map(settled.map(item => [String(item.id), item]));
      io.assertWritable?.();

      let appliedCount = 0;
      const applyResults = await Promise.all(pending.map(async entry => {
        const task = entry.task, s = task.snapshot, request = statusById.get(String(entry.item.id));
        if (!request || request.status === 'failed') {
          return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber, status: 'failed',
            message: request?.errorMessage || '회사 PC DataPARC 조회에 실패했습니다.' };
        }
        try {
          const applied = await io.api({ method: 'POST', body: { action: 'dataparc_runtime_sync', requestId: entry.item.id } });
          appliedCount += 1;
          io.progress?.(`조회 결과 저장 중 · ${appliedCount}/${pending.length}`);
          return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber, status: 'complete',
            message: applied.message || '증분 운전시간 반영 완료' };
        } catch (cause) {
          if ([401, 403].includes(Number(cause?.status))) throw cause;
          return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber, status: 'failed',
            message: cause?.message || '조회 결과 저장 실패 · 기존 값 유지' };
        }
      }));
      for (const item of applyResults) resultByTag.set(item.tagNumber, item);
    }

    return source.map(task => resultByTag.get(task.snapshot.tagNumber) || {
      tagNumber: task.snapshot.tagNumber, displayName: task.asset.displayName || task.snapshot.tagNumber,
      status: 'failed', message: '통합조회 결과를 확인하지 못했습니다.'
    });
  }

  async function executeDataParc(task, io) {
    const results = await executeDataParcBatch([task], io);
    const result = results[0];
    if (result?.status === 'failed') throw error(result.message || 'DataPARC 조회에 실패했습니다.', 'REQUEST_FAILED');
    return result;
  }
  async function executeOis(task, io) {
    const bridge = bridges[task.kind];
    if (!bridge) throw error('OIS 분석 모듈을 불러오지 못했습니다. Ctrl+F5 후 다시 확인해 주세요.', 'MODULE_MISSING');
    io.assertWritable?.();
    const created = await io.api({ method: 'POST', url: '/api/ois-data-requests', body: {
      action: task.kind === 'fbhe' ? 'create_fbhe_vibration_batch' : 'create_seal_pot_runtime_batch',
      startDate: task.startDate, endDate: task.endDate, refreshLatest: true
    }});
    const items = await waitRequests(created?.items || [], io);
    return bridge(task, items, io);
  }
  function oisBody(task, items, a, p, observedAt) {
    const s = task.snapshots.find(x => x.tagNumber === a.tagNumber);
    if (!sameCycle(a, s)) throw error('조회 중 교체·운전 이력이 변경되었습니다. 다음 최신화에서 다시 조회합니다.', 'CYCLE_CONFLICT');
    // Reject an invalid/no-change plan too; equality with a bad report is not verification.
    if (p.runtimeReason) throw error(p.runtimeReason, 'OIS_NOT_VERIFIED');
    if (!p.stateFresh) throw error('최신 OIS 자료가 3시간 이내가 아닙니다.', 'OIS_STALE');
    return { action: 'ois_runtime_refresh_apply', tagNumber: a.tagNumber, requestType: task.kind === 'fbhe' ? 'fbhe_vibration' : 'seal_pot_runtime',
      requestIds: items.map(x => x.id), startDate: task.startDate, endDate: task.endDate,
      runtimeHours: p.cycleRuntimeHours, observedAt, latestSampleAt: p.latestSampleAt,
      cycleCoveragePct: p.cycleCoveragePct, rangeCoveragePct: p.rangeCoveragePct,
      cycleRangeComplete: true, targetState: p.stateEligible ? (p.targetRunning ? 'running' : 'stopped') : 'keep',
      stateSource: task.kind === 'seal_pot' ? (p.pressureState ? 'pressure' : 'temperature') : 'vibration',
      firstRunningAt: p.firstRunningAt || '', ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'tagNumber').map(([k,v]) => ['expected' + k[0].toUpperCase() + k.slice(1),v])) };
  }

  /* BLOWER_UNIFIED_REFRESH_503_FIX_V1 — only replay bounded/idempotent log pages.
   * Never use this retry path for runtime-create, manual edits or deletions.
   * A failed page does not advance its cursor and never starts an Agent request.
   */
  function errorLabel(e) {
    const parts = [String(e?.message || '연결 오류')];
    const status = Number(e?.status || 0);
    if (status && !parts[0].includes(String(status))) parts.push(`HTTP ${status}`);
    if (e?.code && !['HTTP_ERROR','NETWORK_ERROR','REQUEST_TIMEOUT'].includes(e.code)) parts.push(String(e.code));
    if (e?.cfRay) parts.push(`Ray ${String(e.cfRay).slice(0, 100)}`);
    return parts.join(' · ');
  }
  function transient(e) {
    return [0,429,502,503,504].includes(Number(e?.status || 0)) &&
      !['INVALID_LOG_PAGE','BLOWER_LOG_PAGE_INVALID','WRITE_ACCESS_CHANGED'].includes(e?.code);
  }
  async function readWithRetry(read, io, label = '현황 다시 읽기', options = {}) {
    const sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    for (let retry = 0; ; retry++) {
      io.assertWritable?.();
      try { return await read(); }
      catch (e) {
        if (!transient(e) || retry >= 3) throw e;
        io.progress?.(`${label} · ${errorLabel(e)} · 재시도 ${retry + 1}/3`);
        await sleep(Math.min(30000, Math.max(1000 * 2 ** retry, Number(e.retryAfterMs) || 0)));
      }
    }
  }
  function logCursorKey(cursor) {
    return cursor ? JSON.stringify([cursor.workDate, cursor.updatedAt, cursor.id]) : '';
  }
  function logPageError(message) { return error(message, 'INVALID_LOG_PAGE'); }
  async function refreshLogs(io, options = {}) {
    const sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    const initial = options.resume;
    let phase = initial?.phase === 'operation' ? 'operation' : 'replacement';
    let window = initial?.window || null, cursor = initial?.cursor || null;
    let limit = Math.max(1, Math.min(8, Number(initial?.limit || 4)));
    const totals = { scannedReplacementLogs: 0, scannedOperationLogs: 0, insertedCount: 0, appliedStateChanges: 0, ...initial?.totals };
    let pages = 0;
    const checkpoint = () => io.checkpoint?.({ phase, window, cursor, limit, totals: { ...totals } });
    checkpoint();
    while (pages++ < 20000) {
      const label = phase === 'replacement' ? 'V-Belt 교체 기록 확인' : '교체운전 확인';
      const countKey = phase === 'replacement' ? 'scannedReplacementLogs' : 'scannedOperationLogs';
      const position = `${label} · ${totals[countKey]}건 확인${cursor?.workDate ? ' · ' + cursor.workDate : ''}`;
      let payload;
      for (let retry = 0; ; retry++) {
        io.assertWritable?.();
        io.progress?.(`${position} · ${limit}건씩 처리${retry ? ` · 재시도 ${retry}/4` : ''}`);
        try {
          payload = await io.api({ method: 'POST', timeoutMs: 30000,
            body: { action: 'latest_logs_step', incrementalLogs: true, phase, limit, window, cursor,
              autoApplyConfirmedReplacements: phase === 'replacement' } });
          break;
        } catch (e) {
          if (!transient(e) || retry >= 4) {
            e.message = `${position}에서 중단 · ${e.message || '요청 실패'}`;
            throw e;
          }
          // Smaller replay after overload/timeout; the successful cursor is unchanged.
          limit = Math.max(1, Math.floor(limit / 2));
          checkpoint();
          io.progress?.(`${position} · ${errorLabel(e)} · ${limit}건으로 줄여 재시도 ${retry + 1}/4`);
          await sleep(Math.min(30000, Math.max(1000 * 2 ** retry, Number(e.retryAfterMs) || 0)));
        }
      }
      io.assertWritable?.();
      if (payload?.ok !== true || payload.version !== 'bounded-logs-v1' || payload.phase !== phase ||
          typeof payload.done !== 'boolean' || !payload.window ||
          !Number.isInteger(payload.scannedLogCount) || payload.scannedLogCount < 0 || payload.scannedLogCount > limit ||
          !['fromDate','endDate','snapshotAt'].every(key => typeof payload.window[key] === 'string') ||
          (window && ['fromDate','endDate','snapshotAt'].some(key => payload.window[key] !== window[key]))) {
        throw logPageError('업무일지 묶음 응답을 확인할 수 없습니다. 배포 완료 후 Ctrl+F5로 다시 확인해 주세요.');
      }
      const next = payload.nextCursor;
      if (!payload.done && (!next || !payload.scannedLogCount || typeof next.workDate !== 'string' ||
          typeof next.updatedAt !== 'string' || typeof next.id !== 'string' || !next.id ||
          logCursorKey(next) === logCursorKey(cursor))) {
        throw logPageError('업무일지 이어보기 위치가 진행되지 않았습니다. 기존 값은 유지합니다.');
      }
      window = payload.window;
      totals[countKey] += payload.scannedLogCount;
      totals.insertedCount += Math.max(0, Number(payload.insertedCount) || 0);
      totals.appliedStateChanges += Math.max(0, Number(payload.appliedStateChanges) || 0);
      io.progress?.(`${label} · ${totals[countKey]}건 확인`);
      if (payload.done) {
        if (phase === 'operation') { io.checkpoint?.(null); return totals; }
        phase = 'operation'; cursor = null;
      } else cursor = next;
      checkpoint();
      await sleep(20);
    }
    throw logPageError('업무일지 묶음 처리 횟수 한도에 도달했습니다. 완료된 위치는 유지합니다.');
  }

  /* A failed log page remains incomplete and its checkpoint is retained.
   * Runtime can still use the freshly-read CONFIRMED cycle with server-side CAS.
   * Authentication/protocol errors are not bypassed, and no failed page is skipped.
   */
  async function refreshLogsForRuntime(io, options = {}) {
    try { return { complete: true, totals: await refreshLogs(io, options), warning: '' }; }
    catch (e) {
      if (!transient(e)) throw e;
      io.assertWritable?.();
      const warning = errorLabel(e);
      io.progress?.(`업무일지 확인 미완료 · ${warning} · 저장된 교체 기준으로 운전시간 조회 계속`);
      return { complete: false, totals: null, warning };
    }
  }

  return { fbheSealRunAsset, fbheSealRunView, plan, intermittent, snapshot, sameCycle, day, waitRequests, executeDataParc, executeDataParcBatch, executeOis, oisBody,
    refreshLogs, refreshLogsForRuntime, readWithRetry, errorLabel,
    register(kind, fn) { if (!['fbhe','seal_pot'].includes(kind) || typeof fn !== 'function') throw new Error('Invalid OIS bridge'); bridges[kind] = fn; } };
});
