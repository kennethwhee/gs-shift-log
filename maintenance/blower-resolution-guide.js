/* Read-only next steps for the same canonical assessments used by the cards.
 * This module never certifies a clock, changes a total or creates a query.
 * Automatic eligibility comes only from the caller's current recovery plan.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlowerResolutionGuide = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MODES = new Set(['role_priority', 'confirmed_gap', 'seal_first_run', 'seal_registered_range',
    'completion_window_zero', 'append_boundary_full']);
  const text = value => typeof value === 'string' ? value.trim() : '';
  const instant = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)) ? value : '';
  const day = value => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text(value))) {
      const parsed = Date.parse(value + 'T00:00:00Z');
      return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? value : '';
    }
    return instant(value) ? new Date(Date.parse(value) + 9 * 3600000).toISOString().slice(0, 10) : '';
  };
  const clip = value => text(value).slice(0, 1200);
  const sameInstant = (left, right) => Boolean(instant(left) && instant(right) && Date.parse(left) === Date.parse(right));

  function readableSource(event) {
    const raw = text(event?.sourceText);
    if (!raw) return clip(event?.note);
    // Structured runtime/source metadata is not an operator-facing quote.
    if (/^[\[{]/.test(raw)) {
      try {
        const parsed = JSON.parse(raw);
        return parsed && !Array.isArray(parsed) && typeof parsed.sourceText === 'string'
          ? clip(parsed.sourceText) : '';
      } catch {
        // Diary headings such as "[1호기]" are plain text. A broken
        // object/array-of-objects remains hidden as structured metadata.
        return raw.startsWith('{') || /^\[\s*[\[{"]/.test(raw) ? '' : clip(raw);
      }
    }
    return clip(raw);
  }

  function sourceFor(asset, events) {
    const rows = (Array.isArray(events) ? events : []).filter(event => event?.tagNumber === asset.tagNumber &&
      ['replacement', 'cycle_source_reconcile'].includes(event.eventType));
    const automatic = asset.replacementAutoCycle;
    const selection = automatic?.rolePrioritySelection;
    const selectedId = text(automatic?.confirmedClockEventId) || text(automatic?.eventId);
    // Public projections intentionally omit event IDs. Do not pretend that an
    // arbitrary date/quote re-establishes the selected authenticated source.
    const selected = selectedId ? rows.find(event => text(event.id) === selectedId) : null;
    const registered = rows.find(event => event.eventType === 'replacement' &&
      sameInstant(event.eventDate, asset.lastReplacementAt));
    const dated = rows.filter(event => event.eventType === 'replacement' && instant(event.eventDate) && readableSource(event))
      .sort((left, right) => Date.parse(right.eventDate) - Date.parse(left.eventDate));
    const event = selected || registered || dated[0] || null;
    const kind = selected ? 'selected' : registered ? 'registered' : event ? 'historical' : 'unlinked';
    const selectedContext = selected || registered && day(registered.eventDate) === day(selection?.selectedWorkDate);
    const workDate = day(selectedContext && selection?.selectedWorkDate) || day(event?.eventDate) || '';
    const shift = selectedContext && ['DS', 'NS', 'DAY', 'NIGHT'].includes(selection?.selectedShift)
      ? /^(?:DS|DAY)$/.test(selection.selectedShift) ? '주간' : '야간' : '';
    const role = selectedContext ? text(selection?.selectedRole) : '';
    return {
      kind,
      label: kind === 'selected' ? '현재 선택 근거' : kind === 'registered' ? '등록 이력의 내용'
        : kind === 'historical' ? '과거 교체 기록 · 현재 기준 미확정' : '현재 연결된 원문 없음',
      workDate, shift, role,
      excerpt: readableSource(event),
      completionClockKnown: automatic?.clockKnown === true && automatic?.completionClockConflict !== true,
      completionClockMissing: automatic?.clockKnown === false || automatic?.timePrecision === 'day'
        || event?.sourceTimePrecision === 'day'
    };
  }

  function validRecovery(recovery, asset) {
    return recovery && MODES.has(recovery.recoveryMode) && instant(recovery.startAt) &&
      typeof recovery.dataParcTag === 'string' && recovery.dataParcTag === asset.dataParcTag;
  }

  function cycleSnapshot(asset) {
    return { tagNumber: asset.tagNumber, lastReplacementAt: asset.lastReplacementAt || '',
      cycleStartState: asset.cycleStartState || 'legacy',
      cycleStartedAt: asset.cycleStoredStartedAt ?? asset.cycleStartedAt ?? '',
      cycleStartRevision: asset.cycleStartRevision || '', cycleRuntimeRevision: asset.cycleRuntimeRevision || '' };
  }

  // A previous tab result is useful context only while it belongs to the
  // current cycle. It cannot change that cycle or authorize a recovery query.
  function currentQueryResult(asset, results) {
    if (!asset || !Array.isArray(results)) return null;
    const result = results.filter(item => item?.tagNumber === asset.tagNumber).at(-1);
    if (!result || !['failed', 'waiting'].includes(result.status) || !result.cycleSnapshot ||
        typeof result.dataParcTag !== 'string' || result.dataParcTag !== asset.dataParcTag) return null;
    const current = cycleSnapshot(asset);
    if (!text(current.cycleStartRevision) || !text(current.cycleRuntimeRevision) ||
        Object.keys(current).some(key => typeof result.cycleSnapshot[key] !== 'string' ||
          result.cycleSnapshot[key] !== current[key])) return null;
    const startAt = instant(result.startAt), endAt = instant(result.endAt);
    if (result.startAt && !startAt || result.endAt && !endAt ||
        startAt && endAt && Date.parse(startAt) >= Date.parse(endAt)) return null;
    return { tagNumber: asset.tagNumber, status: result.status,
      requestId: text(result.requestId).slice(0, 200),
      errorCode: /^[A-Z][A-Z0-9_]{0,119}$/.test(text(result.errorCode)) ? result.errorCode : '',
      failureStage: ['query', 'apply', 'create'].includes(result.failureStage) ? result.failureStage : '',
      recoveryMode: MODES.has(result.recoveryMode) ? result.recoveryMode : '',
      startAt, endAt, completedAt: instant(result.completedAt), message: clip(result.message) };
  }

  // The API verifies the historical request, source and current append chain.
  // Check its projection against the current visible owner before displaying
  // the negative result. This is not a replacement-clock or duration proof.
  function verifiedCompletionWindowReview(asset) {
    const review = asset?.completionWindowRecoveryReview, automatic = asset?.replacementAutoCycle;
    const basis = asset?.dataParcRuntimeBasis, evidence = asset?.runtimeCoverageEvidence, runtime = asset?.runRuntime;
    const hours = asset?.cycleElapsedHours ?? asset?.runtimeHours;
    const boundedId = value => typeof value === 'string' && value.length > 0 && value.length <= 200 &&
      !/[\u0000-\u001f]/.test(value);
    if (asset?.tagNumber !== '204HHL60AP631' || asset.blowerType !== 'fbhe' || asset.enabled === false || asset.enabled === 0 ||
        asset.dataParcTag !== 'GSPOGE.ABB_DCS.204HHL60AP631XB04' || asset.measurementRequired === true ||
        asset.completionWindowProof || asset.completionWindowRecovery?.eligible !== false ||
        review?.version !== 1 || review.mode !== 'completion_window_zero' || review.status !== 'source_required' ||
        review.automaticRetry !== false || !['RUN_OBSERVED', 'CONTINUOUS_STOP_UNPROVEN'].includes(review.reasonCode) ||
        !sameInstant(review.windowStartAt, '2026-09-16T09:23:00+09:00') ||
        !sameInstant(review.windowEndAt, '2026-09-17T00:00:00+09:00') ||
        !sameInstant(asset.lastReplacementAt, '2026-09-16T00:00:00+09:00') || asset.actualLastReplacementAt ||
        automatic?.clockKnown !== false || automatic.completionClockConflict === true || automatic.rolePrioritySourceRevoked === true ||
        review.dataParcTag !== asset.dataParcTag || review.cycleStartRevision !== asset.cycleStartRevision ||
        review.runtimeRevision !== asset.cycleRuntimeRevision || review.runtimeRequestId !== basis?.requestId ||
        review.replacementEventId !== automatic.replacementEventId || review.sourceLogId !== automatic.sourceLogId ||
        review.sourceSnapshotSha256 !== automatic.sourceSnapshotSha256 ||
        !/^[a-f0-9]{64}$/.test(review.sourceSnapshotSha256 || '') || !/^[a-f0-9]{64}$/.test(review.proofFingerprint || '') ||
        !['requestId', 'runtimeRequestId', 'baseEventId', 'replacementEventId', 'sourceLogId', 'cycleStartRevision', 'runtimeRevision']
          .every(key => boundedId(review[key])) || !instant(review.collectedAt) || !instant(review.completedAt) ||
        !Number.isSafeInteger(review.runningSeconds) || review.runningSeconds < 0 || review.runningSeconds > 52620 ||
        (review.reasonCode === 'RUN_OBSERVED') !== (review.runningSeconds > 0) ||
        !['running', 'stopped', 'unknown'].includes(review.startState) || !['running', 'stopped', 'unknown'].includes(review.endState) ||
        typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || basis?.dataParcTag !== asset.dataParcTag ||
        typeof basis.runtimeHours !== 'number' || !Number.isFinite(basis.runtimeHours) || Math.abs(hours - basis.runtimeHours) > 0.000001 ||
        evidence?.version !== 1 || evidence.source !== 'dataparc' || evidence.measurementVerified !== true ||
        evidence.requestId !== basis.requestId || typeof evidence.hours !== 'number' || !Number.isFinite(evidence.hours) || Math.abs(hours - evidence.hours) > 0.000001 ||
        !sameInstant(basis.startAt, '2026-09-16T09:30:00+09:00') || !sameInstant(evidence.startAt, basis.startAt) ||
        !sameInstant(evidence.observedAt, basis.observedAt) || !sameInstant(asset.cycleRuntimeAnchorAt, basis.observedAt) ||
        runtime?.verified !== true || runtime.source !== 'dataparc' || !sameInstant(runtime.measuredAt, basis.observedAt)) return null;
    return review;
  }

  function queryFailure(result) {
    if (!result || !['failed', 'waiting'].includes(result.status)) return null;
    if (result.status === 'waiting') return { title: '조회 결과 확인 대기',
      detail: '접수한 조회의 결과 또는 저장 여부를 아직 확인하지 못했습니다.',
      nextStep: '같은 요청의 결과를 다시 확인합니다. 확인 대기 중에는 새 조회를 추가하지 않습니다.', action: 'resume' };
    if (result.recoveryMode === 'append_boundary_full') return { title: '연결 구간 보완 미반영',
      detail: '연결 불일치 후 실행한 전체 구간 재조회도 반영되지 않았습니다. 기존 누적값은 유지합니다.',
      nextStep: '조회 상세의 오류와 새 결과를 확인해 주세요. 현재 결과를 확인한 뒤 다시 조회합니다.', action: 'review' };
    const code = result.errorCode;
    if (code === 'DATAPARC_FIRST_RUN_UNVERIFIED') return { title: '최초 기동 시각 미확인',
      detail: '이번 결과에서 최초 RUN 전환시각을 확인하지 못해 기존 누적시간과 조회 기준을 유지했습니다.',
      nextStep: '조회 결과와 등록 기준을 확인해 주세요. 최초 기동을 확인한 것으로 처리하지 않습니다.', action: 'review' };
    if (code === 'BLOWER_COMPLETION_WINDOW_NOT_ZERO') return { title: '정지 구간 입증 안 됨',
      detail: '이번 결과로 교체 작업 구간 전체의 정지를 확인하지 못했습니다. 이 결과만으로 실제 운전 유무를 단정하지 않습니다.',
      nextStep: '조회 결과와 교체 완료시각의 근거를 확인해 주세요. 같은 과거 구간을 다시 조회하면 해결된다고 볼 수 없습니다.', action: 'review' };
    if (code === 'DATAPARC_APPEND_BOUNDARY_CHANGED') return { title: '조회 구간 연결 확인 필요',
      detail: '이전 조회 종료 상태와 새 구간 시작 상태가 달라 새 구간을 반영하지 않았습니다. 기존 누적값은 보존되어 있습니다.',
      nextStep: '전체 최신화에서 연결 조건을 다시 확인합니다. 허용되는 경우에만 저장된 구간 전체를 한 번 다시 검증합니다.', action: 'refresh' };
    if (result.recoveryMode) return { title: '보완 조회 미반영',
      detail: '이번 보완 결과를 저장하지 못했습니다. 현재 누적시간과 기준은 마지막 성공 값입니다.',
      nextStep: '조회 상세의 실패 이유를 확인한 뒤 보완 방법을 다시 선택해 주세요.', action: 'review' };
    return { title: '최근 조회 미반영',
      detail: result.failureStage === 'create' ? '조회 요청 접수가 완료되지 않았습니다. 기존 저장값을 표시합니다.'
        : result.failureStage === 'query' ? '회사 PC의 조회 결과를 확인하지 못했습니다. 기존 저장값을 표시합니다.'
          : '새 조회 결과가 반영되지 않았습니다. 기존 저장값을 표시합니다.',
      nextStep: '조회 상세의 실패 이유와 회사 PC의 조회 상태를 확인한 뒤 전체 최신화를 실행해 주세요.', action: 'refresh' };
  }

  function describe(asset, assessment, options = {}) {
    if (!asset || !assessment || asset.enabled === false || asset.enabled === 0 || assessment.enabled === false ||
        !text(asset.tagNumber) || assessment.tagNumber !== asset.tagNumber) return null;
    const queryResult = currentQueryResult(asset, options.results);
    const failure = queryFailure(queryResult);
    const windowReview = verifiedCompletionWindowReview(asset);
    const behind = assessment.freshness?.state === 'behind';
    if (assessment.requiresReview !== true && !queryResult && !behind) return null;
    const source = sourceFor(asset, options.events);
    const recovery = validRecovery(options.recovery, asset) ? options.recovery : null;
    const base = { tagNumber: asset.tagNumber, name: text(asset.displayName) || asset.tagNumber,
      reason: text(assessment.reasonLabel), source, requiresReview: assessment.requiresReview === true,
      behind, queryResult, failure, windowReview, action: 'review',
      measuredStartAt: instant(assessment.coverage?.startAt), measuredEndAt: instant(assessment.coverage?.observedAt) };
    if (windowReview && assessment.requiresReview === true) {
      return { ...base, kind: 'source', kindLabel: '교체 근거 확인', title: '교체 완료시각 확인',
        detail: windowReview.reasonCode === 'RUN_OBSERVED'
          ? '완료 가능 구간에 운전 기록이 있어 전체 정지 조건으로 교체 후 누적을 확정할 수 없습니다.'
          : '완료 가능 구간 전체의 정지를 입증하지 못해 실제 교체 완료시각 확인이 필요합니다.',
        recoveryMode: '', queryStartAt: '', action: queryResult?.status === 'waiting' ? 'resume' : 'refresh',
        nextStep: '전체 최신화는 확인된 구간 이후의 운전시간을 이어서 반영합니다. 같은 과거 정지 구간은 자동 재조회하지 않습니다.',
        steps: ['교체 원문에서 실제 완료시각을 확인합니다.',
          '완료일시가 확인되면 ‘V-belt 교체 완료 확인’을 정정하고 재승인한 뒤 전체 최신화로 반영합니다.'] };
    }
    // A changed, newly authorized method may address the previous failure.
    // Repeating the same unsuccessful method is not presented as a solution.
    const sameFailedMethod = queryResult?.status === 'failed' && queryResult.recoveryMode &&
      queryResult.recoveryMode === recovery?.recoveryMode;
    if (recovery && queryResult?.status !== 'waiting' && !sameFailedMethod) {
      const mode = recovery.recoveryMode;
      const title = mode === 'role_priority' ? '선택된 교체시각으로 다시 계산'
        : mode === 'confirmed_gap' ? '확정된 교체시각부터 누락 구간 보완'
          : mode === 'seal_first_run' ? '등록 기준부터 최초 기동 확인'
            : mode === 'seal_registered_range' ? '등록 기준의 전체 조회 구간 보완'
              : mode === 'append_boundary_full' ? '연결 불일치 구간 전체 재조회' : '교체 작업 중 정지 구간 검증';
      const detail = mode === 'role_priority' ? '선택한 완료시각과 현재 계산 시작점이 다릅니다.'
        : mode === 'confirmed_gap' ? '교체 완료시각은 확인됐으며, 앞쪽 운전 기록을 추가로 조회해야 합니다.'
          : mode === 'seal_first_run' ? '등록일 이후 앞 구간과 최초 기동을 확인해 누적 구간을 연결합니다.'
            : mode === 'seal_registered_range' ? '저장된 등록 기준부터 운전시간을 다시 측정합니다. 실제 최초 기동시각을 확인한 것으로 처리하지 않습니다.'
              : mode === 'append_boundary_full' ? '새로 확인된 구간 연결 불일치에 대해 저장된 조회 구간 전체를 한 번 다시 측정합니다.'
                : '정확한 완료시각은 미기록입니다. 완료 가능 구간 내내 정지했는지 확인해 교체 후 누적시간을 검증합니다.';
      return { ...base, kind: 'automatic', kindLabel: '자동 보완 대상', title, detail,
        recoveryMode: mode, queryStartAt: recovery.startAt, action: 'refresh',
        nextStep: '전체 최신화에서 이 보완 조회를 함께 실행합니다. 조회와 검증 결과가 저장되면 확인 항목에서 빠집니다.',
        steps: [] };
    }
    if (queryResult) return { ...base, kind: 'query', kindLabel: queryResult.status === 'waiting' ? '결과 확인 대기' : '최근 조회 미반영',
      title: failure.title, detail: failure.detail, nextStep: failure.nextStep, action: failure.action,
      recoveryMode: queryResult.recoveryMode, queryStartAt: '', steps: [] };
    if (assessment.requiresReview !== true) return { ...base, kind: 'freshness', kindLabel: '이전 조회값',
      title: '반영 시각 확인', detail: '저장된 조회 종료시각이 다른 설비보다 앞섭니다. 시각 차이만으로 조회 실패나 누적 기준 오류를 뜻하지 않습니다.',
      recoveryMode: '', queryStartAt: '', action: 'refresh',
      nextStep: '전체 최신화에서 마지막 성공 이후의 구간을 확인합니다. 저장이 완료되면 실제 반영 시각이 바뀝니다.', steps: [] };
    if (assessment.reviewGroup === 'measurement') {
      return { ...base, kind: 'measurement', kindLabel: '조회 필요', title: '운전시간 측정 근거 확인',
        detail: '현재 값에 연결된 정상 조회 결과가 부족합니다.', recoveryMode: '', queryStartAt: '', action: 'refresh',
        nextStep: '전체 최신화를 실행하고 조회 상세에서 이 설비의 반영 결과를 확인해 주세요.', steps: [] };
    }

    const organic = asset.blowerType === 'organic_fuel';
    const olderRecord = source.kind === 'historical' && source.workDate && day(asset.lastReplacementAt) &&
      source.workDate < day(asset.lastReplacementAt);
    const conflict = assessment.reasonKey === 'completion-time-conflict' || asset.replacementAutoCycle?.completionClockConflict === true;
    const missingClock = source.completionClockMissing ||
      ['role-priority-clock-missing', 'completion-time-missing'].includes(assessment.reasonKey);
    const title = organic ? 'V-Belt 교체 여부와 완료시각 확인' : olderRecord ? '과거 교체 기록과 현재 기준 대조'
      : conflict ? '교체 완료시각 대조' : missingClock ? '교체 완료시각 확인' : '계산 시작 기준 확인';
    const detail = organic ? 'Blower 본체 교체와 V-Belt 교체를 구분하고 실제 벨트 교체 완료일시를 확인해야 합니다.'
      : olderRecord ? '보존된 과거 교체 기록과 현재 계산 기준이 다릅니다. 원문과 이후 교체 이력을 함께 확인해야 합니다.'
        : conflict ? '교체 완료시각에 서로 다른 근거가 있습니다. 원문에서 실제 완료시각을 확인해야 합니다.'
          : missingClock ? '교체 사실은 기록됐지만 실제 완료시각이 없습니다.'
            : '조회된 구간은 보존되어 있습니다. 교체 후 전체 누적을 확인하려면 계산 시작 기준을 먼저 확인해야 합니다.';
    const steps = [
      organic ? '해당 업무일지에서 실제 V-Belt 교체 작업이었는지 확인합니다.'
        : olderRecord ? '과거 교체 원문의 승인 상태와 이후 실제 교체 이력을 확인합니다.'
          : '해당 업무일지의 교체 완료 항목과 작업 기록을 확인합니다.',
      '실제 완료일시가 확인되면 원문 항목의 ‘V-belt 교체 완료 확인’에 설비·날짜·완료 시각을 입력하고 정정본을 다시 승인받습니다.',
      '정정본 승인 후 전체 최신화에서 근거와 새 계산 구간의 반영 결과를 확인합니다.'
    ];
    return { ...base, kind: 'source', kindLabel: '근거 확인 필요', title, detail, recoveryMode: '', queryStartAt: '',
      nextStep: '작업 기록에서 확인되지 않는 시각은 입력하지 않습니다. 조회 시작시각이나 자정을 완료시각으로 대신 쓰지 마세요.', steps };
  }

  function summarize(guides, missingCount = 0) {
    const rows = Array.isArray(guides) ? guides.filter(Boolean) : [];
    const missing = Number.isSafeInteger(missingCount) && missingCount >= 0 ? missingCount : 0;
    const summary = { total: missing, automatic: 0, source: 0, measurement: missing, query: 0, freshness: 0,
      requiresReview: missing, latest: 0, failed: 0, waiting: 0, behind: 0, overlap: 0 };
    const seen = new Set();
    for (const guide of rows) {
      if (!text(guide.tagNumber) || seen.has(guide.tagNumber) || !['automatic', 'source', 'measurement', 'query', 'freshness'].includes(guide.kind)) continue;
      seen.add(guide.tagNumber); summary.total += 1; summary[guide.kind] += 1;
      if (guide.requiresReview === true) summary.requiresReview += 1;
      const latest = guide.behind === true || Boolean(guide.queryResult);
      if (latest) summary.latest += 1;
      if (guide.requiresReview === true && latest) summary.overlap += 1;
      if (guide.behind === true) summary.behind += 1;
      if (guide.queryResult?.status === 'failed') summary.failed += 1;
      if (guide.queryResult?.status === 'waiting') summary.waiting += 1;
    }
    return summary;
  }

  return Object.freeze({ describe, summarize, currentQueryResult, queryFailure, verifiedCompletionWindowReview });
});
