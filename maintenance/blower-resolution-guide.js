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

  const MODES = new Set(['role_priority', 'confirmed_gap', 'seal_first_run', 'completion_window_zero']);
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

  function describe(asset, assessment, options = {}) {
    if (!asset || !assessment || asset.enabled === false || asset.enabled === 0 || assessment.enabled === false ||
        !text(asset.tagNumber) || assessment.tagNumber !== asset.tagNumber || assessment.requiresReview !== true) return null;
    const source = sourceFor(asset, options.events);
    const recovery = validRecovery(options.recovery, asset) ? options.recovery : null;
    const base = { tagNumber: asset.tagNumber, name: text(asset.displayName) || asset.tagNumber,
      reason: text(assessment.reasonLabel) || '기준·구간 확인', source,
      measuredStartAt: instant(assessment.coverage?.startAt), measuredEndAt: instant(assessment.coverage?.observedAt) };
    if (recovery) {
      const mode = recovery.recoveryMode;
      const title = mode === 'role_priority' ? '선택된 교체시각으로 다시 계산'
        : mode === 'confirmed_gap' ? '확정된 교체시각부터 누락 구간 보완'
          : mode === 'seal_first_run' ? '등록 기준부터 최초 기동 확인' : '교체 작업 중 정지 구간 검증';
      const detail = mode === 'role_priority' ? '선택한 완료시각과 현재 계산 시작점이 다릅니다.'
        : mode === 'confirmed_gap' ? '교체 완료시각은 확인됐으며, 앞쪽 운전 기록을 추가로 조회해야 합니다.'
          : mode === 'seal_first_run' ? '등록일 이후 앞 구간과 최초 기동을 확인해 누적 구간을 연결합니다.'
            : '정확한 완료시각은 미기록입니다. 완료 가능 구간 내내 정지했는지 확인해 교체 후 누적시간을 검증합니다.';
      return { ...base, kind: 'automatic', kindLabel: '자동 보완 대상', title, detail,
        recoveryMode: mode, queryStartAt: recovery.startAt,
        nextStep: '전체 최신화에서 이 보완 조회를 함께 실행합니다. 조회와 검증 결과가 저장되면 확인 항목에서 빠집니다.',
        steps: [] };
    }
    if (assessment.reviewGroup === 'measurement') {
      return { ...base, kind: 'measurement', kindLabel: '조회 필요', title: '운전시간 측정 근거 확인',
        detail: '현재 값에 연결된 정상 조회 결과가 부족합니다.', recoveryMode: '', queryStartAt: '',
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
    const summary = { total: missing, automatic: 0, source: 0, measurement: missing };
    const seen = new Set();
    for (const guide of rows) {
      if (!text(guide.tagNumber) || seen.has(guide.tagNumber) || !['automatic', 'source', 'measurement'].includes(guide.kind)) continue;
      seen.add(guide.tagNumber); summary.total += 1; summary[guide.kind] += 1;
    }
    return summary;
  }

  return Object.freeze({ describe, summarize });
});
