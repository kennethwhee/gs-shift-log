/* BLOWER_UNIFIED_REFRESH_V1 — deterministic planning and serial request handling. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlowerUnifiedRefresh = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Optional browser diagnostics are isolated from request/validation behavior.
  // They receive bounded counts only; credentials, bodies and error text stay out.
  async function measurePhase(name, metadata, operation) {
    let measurement = null;
    try { measurement = globalThis.BlowerRefreshTiming?.beginPhase(name, metadata); } catch (_) {}
    const finish = (status, result) => {
      try {
        const counts = Array.isArray(result) ? {
          completedCount: result.filter(item => item?.status === 'complete').length,
          failedCount: result.filter(item => item?.status === 'failed').length
        } : {};
        const waiting = Array.isArray(result) && result.some(item => ['waiting', 'pending', 'processing'].includes(item?.status));
        measurement?.end(counts.failedCount || waiting ? 'partial' : status, counts);
      } catch (_) {}
    };
    try { const result = await operation(); finish('complete', result); return result; }
    catch (error) { finish('failed'); throw error; }
  }
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
DP_TAGS.add("103HRJ01AN601");
DP_TAGS.add("103HRJ01AN602");
DP_TAGS.add("203HRJ01AN601");
DP_TAGS.add("203HRJ01AN602");
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
    // Keep the established FBHE/Seal view contract and also use verified RUN
    // evidence for pending replacements on every other supported Blower.
    if (!fbheSealRunAsset(a) && !(DP_TAGS.has(a?.tagNumber) && a.cycleStartState === 'pending')) return null;
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
  function plan(assets, now, basisFor = () => null, limestoneTrackingFor = () => null) {
    const end = now instanceof Date ? now.getTime() : time(now), today = day(new Date(end));
    if (!Number.isFinite(end)) throw new Error('서버 기준시각을 확인할 수 없습니다.');
    const tasks = [], skipped = [];
    for (const a of assets || []) {
      if (a.enabled === false || a.enabled === 0) continue;
      const skip = reason => skipped.push({ tagNumber: a.tagNumber, displayName: a.displayName || a.tagNumber, status: 'skipped', message: reason });
      // V3-F: read RUN samples for the three disputed Limestone cycles without
      // certifying their cumulative V-Belt runtime or moving an existing basis.
      const replacement = time(a.lastReplacementAt);
      const heldLimestoneTags = ['103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'];
      const candidate = a.blowerType === 'limestone' && heldLimestoneTags.includes(a.tagNumber);
      const unresolvedDay = candidate && ['103HRJ01AN602', '203HRJ01AN602'].includes(a.tagNumber) &&
        replacement === Date.parse('2026-09-22T00:00:00+09:00');
      const unresolved2A = candidate && a.tagNumber === '203HRJ01AN601' &&
        (!Number.isFinite(replacement) || replacement < Date.parse('2026-09-19T00:00:00+09:00'));
      const previewOnly = candidate && (unresolvedDay || unresolved2A || a.hasUnverifiedDataParcHistory === true);
      const holdReason = unresolvedDay ? '9/22 실제 V-Belt 교체시각 미확정'
        : unresolved2A ? '2호기 #A 9/19 V-Belt 교체 완료 근거 충돌'
        : '기존 DataPARC 누적 기준 미검증';
      if (!Number.isFinite(replacement)) { skip('교체일 등록 필요 · 이력 보기 / V-Belt 교체 등록'); continue; }
      if (replacement >= end) { skip('교체일이 현재 시각 이후입니다.'); continue; }
      if (!DP_TAGS.has(a.tagNumber)) { skip('연결된 운전시간 조회 방식이 없습니다.'); continue; }
      const dataParcTag = a.tagNumber === '104ETH03AN602' ? SIGNAL : String(a.dataParcTag || (a.blowerType === 'limestone' ? a.limestoneSignalCandidate : '') || '').trim();
      if (!/^GSPOGE\.ABB_DCS\.[A-Z0-9][A-Z0-9._-]*$/.test(dataParcTag) || dataParcTag.length > 200 || (a.tagNumber !== '104ETH03AN602' && dataParcTag === SIGNAL)) {
        skip('RUN TAG 설정 필요 · 이력 보기 → 조회 기준·상세'); continue;
      }
      if (previewOnly) {
        // An absolute last-24h window is independent of a disputed historical
        // maintenance reset. The existing read-only probe can safely observe
        // RUN=0/1; it must NEVER call dataparc_runtime_sync for this task.
        const storedTrack = limestoneTrackingFor(a.tagNumber) || null;
        // Use the confirmed server-owned endpoint, not the last-24h window,
        // for the second and every subsequent RUN tracking segment.
        if (storedTrack && (storedTrack.tagNumber !== a.tagNumber ||
            storedTrack.dataParcTag !== dataParcTag ||
            time(storedTrack.lastReplacementAt) !== replacement ||
            storedTrack.cycleStartRevision !== (a.cycleStartRevision || '') ||
            !Number.isSafeInteger(storedTrack.totalRunningSeconds) || storedTrack.totalRunningSeconds < 0 ||
            !Number.isFinite(time(storedTrack.observedAt)) ||
            time(storedTrack.observedAt) < replacement)) {
          skip('저장된 RUN 추적 기준이 현재 교체 Cycle과 다릅니다 · 자동 초기화 금지'); continue;
        }
        const firstStart = a.cycleStartState === 'started' ? time(a.cycleStartedAt) : NaN;
        const previewStart = storedTrack ? time(storedTrack.observedAt)
          : Math.max(end - DAY, replacement, Number.isFinite(firstStart) ? firstStart : replacement);
        if (!Number.isFinite(previewStart) || previewStart >= end) {
          skipped.push({ tagNumber: a.tagNumber, displayName: a.displayName || a.tagNumber,
            status: 'complete', unchanged: true, message: '새 RUN 추적 구간 없음 · 저장된 확인값 유지' }); continue;
        }
        if (end - previewStart > 366 * DAY) {
          skip('RUN 추적 공백이 366일을 초과합니다 · 기존 추적값 유지'); continue;
        }
        const startAt = new Date(previewStart).toISOString();
        tasks.push({ kind: 'dataparc', asset: a, snapshot: snapshot(a), startAt,
          queryStartAt: startAt, incremental: false, dataParcTag, previewOnly: true, holdReason });
        continue;
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
    let retry = 0, pollCount = 0;
    while (true) {
      io.assertWritable?.();
      const all = [...map.values()];
      const failed = all.find(x => x.status === 'failed');
      if (failed && !settleFailures) throw error(failed.errorMessage || '회사 PC 조회에 실패했습니다.', 'REQUEST_FAILED');
      if (all.every(x => settleFailures ? ['complete', 'failed'].includes(x.status) : x.status === 'complete')) return all;
      if (all.some(x => !['pending', 'processing', 'complete', ...(settleFailures ? ['failed'] : [])].includes(x.status))) {
        throw error('알 수 없는 조회 상태입니다.', 'INVALID_REQUEST_STATUS');
      }
      if (clock() >= deadline) {
        if (options.returnPendingOnTimeout === true) return all;
        throw error('운전시간 조회가 최대 대기시간을 초과했습니다.', 'REQUEST_TIMEOUT');
      }
      // No Agent response: do not leave a large all-Blower queue waiting indefinitely.
      const active = all.filter(x => !['complete', 'failed'].includes(x.status));
      if (active.length && active.every(x => x.status === 'pending') && clock() - start >= (options.pendingTimeoutMs || 180000)) {
        if (options.returnPendingOnTimeout === true) return all;
        throw error('회사 PC Agent 응답 대기시간을 초과했습니다. 완료된 값은 유지합니다.', 'AGENT_UNAVAILABLE');
      }
      const terminal = all.filter(x => ['complete', 'failed'].includes(x.status)).length;
      io.progress?.(`${terminal}/${all.length} · ${all.some(x => x.status === 'processing') ? 'DataPARC 일괄 계산 중' : '조회 대기 중'}`);
      // The request rows already exist when this function starts, so the first
      // status read can run immediately.  Poll quickly while a foreground
      // Blower batch normally finishes, then taper to the legacy interval for
      // a genuinely long DataPARC calculation.
      if (pollCount > 0) {
        const elapsed = Math.max(0, clock() - start);
        const interval = elapsed < 10000 ? 400 : elapsed < 60000 ? 1000 : 2500;
        await sleep(Math.min(interval, Math.max(0, deadline - clock())));
      }
      if (clock() >= deadline) continue;
      let payloads;
      try {
        const groups = [];
        for (let index = 0; index < ids.length; index += 24) groups.push(ids.slice(index, index + 24));
        payloads = await Promise.all(groups.map((group, groupIndex) => io.api({
          url: `/api/ois-data-requests?action=status_batch&compact=1&ids=${encodeURIComponent(group.join(','))}&_=${clock() + groupIndex}`,
          timeoutMs: Math.min(20000, Math.max(1, deadline - clock()))
        })));
        pollCount += 1;
        retry = 0;
      } catch (e) {
        if (e?.retryable === false || ![0,429,502,503,504].includes(Number(e?.status || 0)) || retry >= 4) throw e;
        await sleep(Math.min(Math.max(0, deadline - clock()), 30000, Math.max(1000 * 2 ** retry++, Number(e.retryAfterMs) || 0))); continue;
      }
      const returned = payloads.flatMap(payload => Array.isArray(payload?.items) ? payload.items : []);
      if (ids.some(id => !returned.some(x => String(x.id) === id))) throw error('조회 요청 상태가 누락되었습니다.', 'REQUEST_MISSING');
      for (const item of returned) if (map.has(String(item.id))) map.set(String(item.id), item);
      io.onStatuses?.([...map.values()]);
    }
  }

  function dataParcCreateBody(task) {
    const s = task.snapshot;
    return {
      action: 'create_blower_runtime_probe', unifiedRefresh: true,
      incrementalRefresh: task.previewOnly !== true,
      ...(task.previewOnly === true ? { limestoneTrackingOnly: true } : {}),
      requireIncrementalAppend: task.incremental === true, assetTag: s.tagNumber,
      dataParcTag: task.dataParcTag, confirmRunSignal: true, startAt: task.startAt,
      expectedLastReplacementAt: s.lastReplacementAt, expectedCycleStartState: s.cycleStartState,
      expectedCycleStartedAt: s.cycleStartedAt, expectedCycleStartRevision: s.cycleStartRevision,
      expectedCycleRuntimeRevision: s.cycleRuntimeRevision
    };
  }

  function verifiedLimestonePreview(reply, task, requestId) {
    // Status-batch intentionally omits probe result bodies. Read the exact
    // accepted request after completion and validate its immutable identity.
    const item = reply?.item, probe = item?.probe, result = item?.result;
    const s = task?.snapshot || {};
    const stamp = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
    const start = stamp(probe?.startAt), end = stamp(probe?.endAt);
    const observed = stamp(result?.observedAt);
    const runningSeconds = result?.runningSeconds;
    const hours = result?.totalRunningHours;
    if (!task?.previewOnly || !requestId || reply?.ok !== true ||
        item?.id !== requestId || item.status !== 'complete' ||
        item.requestType !== 'blower_runtime_probe' ||
        probe?.requestId !== requestId || probe?.assetTag !== s.tagNumber ||
        probe?.dataParcTag !== task.dataParcTag ||
        stamp(probe?.expectedLastReplacementAt) !== stamp(s.lastReplacementAt) ||
        result?.ok !== true || result?.readOnly !== true ||
        result?.requestType !== 'blower_runtime_probe' || result?.requestId !== requestId ||
        result?.assetTag !== s.tagNumber || result?.dataParcTag !== task.dataParcTag ||
        !['running', 'stopped'].includes(result?.endState) ||
        !Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(observed) ||
        start >= end || end !== observed ||
        stamp(result?.startAt) !== start || stamp(result?.endAt) !== end ||
        start < stamp(s.lastReplacementAt) || end - start > 366 * DAY ||
        !Number.isSafeInteger(runningSeconds) || runningSeconds < 0 ||
        runningSeconds > Math.ceil((end - start) / 1000) ||
        typeof hours !== 'number' || !Number.isFinite(hours) ||
        Math.abs(hours * 3600 - runningSeconds) > 0.01) {
      throw error('RUN 조회 결과의 요청·설비·신호·기간·0/1 상태가 일치하지 않습니다. 누적시간은 변경하지 않았습니다.',
        'LIMESTONE_PREVIEW_UNVERIFIED');
    }
    return { state: result.endState, runningHours: runningSeconds / 3600,
      startAt: probe.startAt, observedAt: result.observedAt };
  }

  async function executeDataParcBatch(tasks, io) {
    // BLOWER_LOADING_RECOVERY_V4: an accepted batch is resumed by its original
    // IDs. A long-running job is never recreated just because its UI wait ends.
    const resume = io.runtimeResume;
    const source = (resume?.tasks || tasks || []).filter(task => task?.snapshot?.tagNumber);
    if (!source.length) return [];
    io.assertWritable?.();
    io.progress?.(resume ? `${source.length}대 이전 조회 결과 확인 중` : `${source.length}대 증분 조회 요청 등록 중`);

    // One authenticated server action validates every Cycle/append intent and
    // publishes all new queue rows in one D1 transaction.  Never fall back to
    // per-asset POSTs: the one-second Agent poll could observe a partial set
    // and split one Latest click across several hidden-Excel startups.
    if (source.length > 27) throw error('Blower 일괄 조회는 한 번에 최대 27대까지 가능합니다.', 'CREATE_BATCH_TOO_LARGE');
    const sourceTags = source.map(task => String(task.snapshot.tagNumber));
    if (new Set(sourceTags).size !== sourceTags.length) throw error('같은 Blower가 일괄 조회에 중복 포함되었습니다.', 'CREATE_BATCH_DUPLICATE_ASSET');

    let createdBatch = resume?.createdBatch;
    if (!createdBatch) {
      try {
        createdBatch = await measurePhase('createRequests', { targetCount: source.length }, () => io.api({ method: 'POST', timeoutMs: 30000, url: '/api/ois-data-requests', body: {
          action: 'create_blower_runtime_probe_batch', requests: source.map(dataParcCreateBody)
        }}));
      } catch (cause) {
        if ([0, 502, 503, 504].includes(Number(cause?.status || 0))) {
          const e = error('조회 요청의 접수 결과를 확인하지 못했습니다. 회사 PC에서 이미 처리 중일 수 있습니다.', 'CREATE_RESULT_UNCONFIRMED');
          Object.assign(e, { status: cause?.status || 0, retryable: false, cause,
            cloudflareCode: cause?.cloudflareCode, cfRay: cause?.cfRay });
          throw e;
        }
        throw cause;
      }
    }
    const batchResults = Array.isArray(createdBatch?.results) ? createdBatch.results : [];
    if (createdBatch?.ok !== true || createdBatch?.atomic !== true || createdBatch?.batchVersion !== 1 ||
        Number(createdBatch?.requestedCount) !== source.length || batchResults.length !== source.length) {
      throw error('Blower 일괄 요청 등록 결과를 확인할 수 없습니다. 개별 요청으로 전환하지 않았습니다.', 'CREATE_BATCH_RESPONSE_INVALID');
    }
    const createdByTag = new Map();
    const requestIds = new Set();
    for (const created of batchResults) {
      const tag = String(created?.assetTag || '');
      const item = created?.item;
      const requestId = created?.upToDate === true ? '' : String(item?.id || '');
      const requestShapeValid = created?.upToDate === true || (
        item?.requestType === 'blower_runtime_probe' &&
        String(item?.probe?.assetTag || '') === tag &&
        String(item?.probe?.requestId || '') === requestId
      );
      if (!tag || !sourceTags.includes(tag) || createdByTag.has(tag) || created?.ok !== true ||
          (created?.upToDate !== true && !requestId) || !requestShapeValid ||
          (requestId && requestIds.has(requestId))) {
        throw error('Blower 일괄 요청 설비 목록이 요청과 일치하지 않습니다. 개별 요청으로 전환하지 않았습니다.', 'CREATE_BATCH_RESPONSE_MISMATCH');
      }
      if (requestId) requestIds.add(requestId);
      createdByTag.set(tag, created);
    }
    if (sourceTags.some(tag => !createdByTag.has(tag))) {
      throw error('Blower 일괄 요청 결과에 누락된 설비가 있습니다. 개별 요청으로 전환하지 않았습니다.', 'CREATE_BATCH_RESPONSE_MISSING');
    }
    const createOutcomes = source.map(task => ({ task, created: createdByTag.get(String(task.snapshot.tagNumber)) }));

    const resultByTag = new Map((resume?.outcomes || []).filter(item =>
      sourceTags.includes(item?.tagNumber) && ['complete', 'failed'].includes(item?.status)
    ).map(item => [item.tagNumber, item]));
    const saveCheckpoint = () => io.runtimeCheckpoint?.({ version: 1,
      tasks: source.map(task => ({ ...task, asset: { tagNumber: task.snapshot.tagNumber,
        displayName: task.asset?.displayName || task.snapshot.tagNumber } })),
      createdBatch: { ok: true, atomic: true, batchVersion: 1, requestedCount: source.length,
        results: batchResults.map(row => row.upToDate === true ? { ok: true, assetTag: row.assetTag, upToDate: true, message: row.message } : {
          ok: true, assetTag: row.assetTag, item: { id: row.item.id, status: row.item.status,
            requestType: 'blower_runtime_probe', probe: { assetTag: row.assetTag, requestId: row.item.id } }
        }) }, outcomes: [...resultByTag.values()].filter(item => ['complete', 'failed'].includes(item.status)) });
    // This checkpoint contains accepted IDs only. An uncertain create is not a receipt.
    saveCheckpoint();
    const pending = [];
    for (const outcome of createOutcomes) {
      const task = outcome.task, s = task.snapshot;
      if (resultByTag.has(s.tagNumber)) continue;
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
      let settled = pending.map(entry => ({ ...entry.item, status: resume ? 'pending' : entry.item.status })), waitError = null;
      try {
        settled = await measurePhase('waitResults', { requestCount: pending.length }, () => waitRequests(settled, {
          ...io, onStatuses: items => { settled = items; io.onStatuses?.(items); }
        }, { settleFailures: true, sleep: io.sleep, clock: io.clock,
          timeoutMs: 120000, pendingTimeoutMs: 45000, returnPendingOnTimeout: true }));
      } catch (cause) {
        if ([401, 403].includes(Number(cause?.status)) || cause?.code === 'WRITE_ACCESS_CHANGED') throw cause;
        waitError = cause;
      }
      const statusById = new Map(settled.map(item => [String(item.id), item]));
      io.assertWritable?.();

      let appliedCount = 0;
      const applyResults = await measurePhase('applyResults', { requestCount: pending.length }, () => Promise.all(pending.map(async entry => {
        const task = entry.task, s = task.snapshot, request = statusById.get(String(entry.item.id));
        if (!request || request.status === 'failed') {
          return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber, status: 'failed',
            message: request?.errorMessage || '회사 PC DataPARC 조회에 실패했습니다.' };
        }
        if (request.status !== 'complete') {
          return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber,
            requestId: entry.item.id, status: 'waiting', message: waitError
              ? `상태 확인 대기 · ${errorLabel(waitError)}`
              : request.status === 'processing' ? '회사 PC 처리 중 · 같은 요청으로 결과 확인 가능'
              : '회사 PC 응답 대기 · 같은 요청으로 결과 확인 가능' };
        }
        if (task.previewOnly === true) {
            try {
              const reply = await io.api({ url: `/api/ois-data-requests?id=${encodeURIComponent(entry.item.id)}`, timeoutMs: 20000 });
              io.assertWritable?.();
              const preview = verifiedLimestonePreview(reply, task, entry.item.id);
              const saved = await io.api({ method: 'POST', timeoutMs: 30000,
                body: { action: 'limestone_run_track_apply', requestId: entry.item.id } });
              io.assertWritable?.();
              if (saved?.ok !== true || saved.tagNumber !== s.tagNumber ||
                  saved.requestId !== entry.item.id ||
                  !Number.isSafeInteger(saved.totalRunningSeconds) ||
                  Date.parse(saved.observedAt) !== Date.parse(preview.observedAt)) {
                throw error('RUN 추적 저장 결과가 조회 원본과 일치하지 않습니다.', 'LIMESTONE_TRACK_SAVE_INVALID');
              }
              const stateText = preview.state === 'running' ? 'RUN=1 (기동)' : 'RUN=0 (정지)';
              return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber,
                status: 'complete', unchanged: true, previewOnly: true,
                previewState: preview.state, previewHours: preview.runningHours,
                previewStartAt: preview.startAt, previewObservedAt: preview.observedAt,
                trackedHours: saved.totalRunningSeconds / 3600,
                trackedStartAt: saved.coverageStartAt, trackedObservedAt: saved.observedAt,
                message: `RUN 단기조회 ${stateText} · 신규 ${preview.runningHours.toFixed(1)}시간 · 검증구간 누적 ${(saved.totalRunningSeconds / 3600).toFixed(1)}시간 저장 · ${task.holdReason} · V-Belt 누적시간 미반영` };
            } catch (cause) {
              if ([401, 403].includes(Number(cause?.status)) || cause?.code === 'WRITE_ACCESS_CHANGED') throw cause;
              if ([0, 429, 502, 503, 504].includes(Number(cause?.status || 0)) &&
                  cause?.code !== 'LIMESTONE_PREVIEW_UNVERIFIED') {
                return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber,
                  requestId: entry.item.id, status: 'waiting',
                  message: 'RUN 저장 확인 대기 · 같은 요청 ID로만 확인 · 기존 누적시간 유지' };
              }
              return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber,
                status: 'failed', message: `RUN 조회·저장 결과 확인 실패 · ${cause?.code || '자료 불일치'} · 기존 누적시간 유지` };
            }
          }
        try {
          const applied = await io.api({ method: 'POST', timeoutMs: 30000, body: { action: 'dataparc_runtime_sync', requestId: entry.item.id } });
          appliedCount += 1;
          io.progress?.(`조회 결과 저장 중 · ${appliedCount}/${pending.length}`);
          return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber, status: 'complete',
            message: applied.message || '증분 운전시간 반영 완료' };
        } catch (cause) {
          if ([401, 403].includes(Number(cause?.status))) throw cause;
          const uncertain = [0, 429, 502, 503, 504].includes(Number(cause?.status || 0));
          return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber,
            requestId: entry.item.id, status: uncertain ? 'waiting' : 'failed',
            message: uncertain ? '조회 결과 저장 확인 대기 · 같은 요청으로 재확인 가능' : cause?.message || '조회 결과 저장 실패 · 기존 값 유지' };
        }
      })));
      for (const item of applyResults) resultByTag.set(item.tagNumber, item);
    }

    if ([...resultByTag.values()].some(item => item.status === 'waiting')) saveCheckpoint();
    else io.runtimeCheckpoint?.(null);

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
    return e?.retryable !== false && [0,429,502,503,504].includes(Number(e?.status || 0)) &&
      !['INVALID_LOG_PAGE','BLOWER_LOG_PAGE_INVALID','WRITE_ACCESS_CHANGED'].includes(e?.code);
  }
  async function readWithRetry(read, io, label = '현황 다시 읽기', options = {}) {
    const sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    const clock = options.clock || Date.now;
    const remaining = () => Number.isFinite(options.deadline) ? Math.max(0, options.deadline - clock()) : Infinity;
    for (let retry = 0; ; retry++) {
      io.assertWritable?.();
      if (!remaining()) {
        const e = error(`${label} 응답 시간이 초과되었습니다. 기존 값은 유지합니다.`, 'READ_DEADLINE');
        e.retryable = false; throw e;
      }
      try { return await read(); }
      catch (e) {
        if (!transient(e) || retry >= 3) throw e;
        io.progress?.(`${label} · ${errorLabel(e)} · 재시도 ${retry + 1}/3`);
        await sleep(Math.min(remaining(), 30000, Math.max(1000 * 2 ** retry, Number(e.retryAfterMs) || 0)));
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
    const maxLimit = Math.max(1, Math.min(8, Number(options.pageLimit) || 8));
    let limit = Math.max(1, Math.min(maxLimit, Number(initial?.limit || Math.min(4, maxLimit))));
    const totals = { scannedReplacementLogs: 0, scannedOperationLogs: 0, insertedCount: 0, appliedStateChanges: 0, ...initial?.totals };
    let pages = 0;
    const clock = options.clock || Date.now;
    const deadline = Number.isFinite(options.timeBudgetMs) ? clock() + Math.max(1, options.timeBudgetMs) : Infinity;
    const maxPages = Math.max(1, Math.min(20000, Number(options.maxPages) || 20000));
    const pause = () => {
      const e = error(`업무일지 확인을 나누어 진행합니다 · 교체 기록 ${totals.scannedReplacementLogs}건 · 운전 기록 ${totals.scannedOperationLogs}건 확인 · 남은 기록은 다음 조회에서 이어서 확인`, 'LOG_REFRESH_PAUSED');
      e.retryable = false; e.logTotals = { ...totals }; throw e;
    };
    const remaining = () => Math.max(0, deadline - clock());
    const report = () => io.logProgress?.({ phase, ...totals });
    const checkpoint = () => io.checkpoint?.({ phase, window, cursor, limit, totals: { ...totals } });
    checkpoint();
    report();
    while (pages++ < maxPages) {
      io.assertWritable?.();
      if (!remaining()) pause();
      const label = phase === 'replacement' ? 'V-Belt 교체 기록 확인' : '교체운전 확인';
      const countKey = phase === 'replacement' ? 'scannedReplacementLogs' : 'scannedOperationLogs';
      const position = `${label} · ${totals[countKey]}건 확인${cursor?.workDate ? ' · ' + cursor.workDate : ''}`;
      let payload;
      for (let retry = 0; ; retry++) {
        io.assertWritable?.();
        if (!remaining()) pause();
        io.progress?.(`${position} · ${limit}건씩 처리${retry ? ` · 재시도 ${retry}/4` : ''}`);
        try {
          payload = await io.api({ method: 'POST', timeoutMs: Math.min(30000, remaining()),
            body: { action: 'latest_logs_step', incrementalLogs: true, phase, limit, window, cursor,
              autoApplyConfirmedReplacements: phase === 'replacement' } });
          break;
        } catch (e) {
          if (!transient(e) || retry >= 4) {
            e.message = `${position}에서 중단 · ${e.message || '요청 실패'}`;
            throw e;
          }
          if (!remaining()) pause();
          // Smaller replay after overload/timeout; the successful cursor is unchanged.
          limit = Math.max(1, Math.floor(limit / 2));
          checkpoint();
          io.progress?.(`${position} · ${errorLabel(e)} · ${limit}건으로 줄여 재시도 ${retry + 1}/4`);
          await sleep(Math.min(remaining(), 30000, Math.max(1000 * 2 ** retry, Number(e.retryAfterMs) || 0)));
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
      report();
      io.progress?.(`${label} · ${totals[countKey]}건 확인`);
      if (payload.done) {
        if (phase === 'operation') { io.checkpoint?.(null); return totals; }
        phase = 'operation'; cursor = null;
      } else cursor = next;
      checkpoint();
      await sleep(Math.min(20, remaining()));
    }
    if (options.maxPages) pause();
    throw logPageError('업무일지 묶음 처리 횟수 한도에 도달했습니다. 완료된 위치는 유지합니다.');
  }

  /* A failed log page remains incomplete and its checkpoint is retained.
   * Runtime can still use the freshly-read CONFIRMED cycle with server-side CAS.
   * Authentication/protocol errors are not bypassed, and no failed page is skipped.
   */
  async function refreshLogsForRuntime(io, options = {}) {
    try { return { complete: true, totals: await measurePhase('workLogs', {}, () => refreshLogs(io, { timeBudgetMs: 45000, maxPages: 80, pageLimit: 1, ...options })), warning: '' }; }
    catch (e) {
      if (e?.code !== 'LOG_REFRESH_PAUSED' && !transient(e)) throw e;
      io.assertWritable?.();
      const warning = errorLabel(e);
      io.progress?.(`업무일지 확인 미완료 · ${warning} · 저장된 교체 기준으로 운전시간 조회 계속`);
      return { complete: false, totals: e.logTotals || null, warning };
    }
  }

  return { fbheSealRunAsset, fbheSealRunView, plan, intermittent, snapshot, sameCycle, day, waitRequests, executeDataParc, executeDataParcBatch, executeOis, oisBody,
    refreshLogs, refreshLogsForRuntime, readWithRetry, errorLabel,
    register(kind, fn) { if (!['fbhe','seal_pot'].includes(kind) || typeof fn !== 'function') throw new Error('Invalid OIS bridge'); bridges[kind] = fn; } };
});
