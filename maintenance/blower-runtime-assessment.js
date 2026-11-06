/* One read-only presentation assessment for every Blower. No queries or writes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlowerRuntimeAssessment = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // These keys come from the existing, guarded coverage/provenance helpers.
  // A date displayed on a card is not evidence that a review has been resolved.
  const REVIEWS = Object.freeze({
    'role-priority-clock-missing': { group: 'basis', label: '교체 완료시각 확인' },
    'role-priority-run-rebuild': { group: 'basis', label: '선택한 교체 기준으로 재조회' },
    'completion-time-conflict': { group: 'basis', label: '교체 시각 대조' },
    'completion-time-missing': { group: 'basis', label: '교체 완료시각 확인' },
    'replacement-basis-review': { group: 'basis', label: '교체 기준 확인' },
    'leading-gap': { group: 'range', label: '앞 구간 보완 필요' },
    'coverage-gap': { group: 'range', label: '조회 구간 확인' },
    'basis-or-coverage-review': { group: 'basis', label: '기준·구간 확인' }
  });
  const ACTIONS = Object.freeze({
    seal_pot_first_run: '실제 기동 기준 확인',
    confirmed_gap_recovery: '누락 구간 보완',
    limestone_basis_confirm: '교체 기준 확인',
    runtime_query: '조회 기준 확인',
    history: '근거 보기'
  });
  const PROVENANCE = new Set(['measured', 'manual', 'retained', 'unknown']);
  const STATES = new Set(['running', 'stopped', 'unknown']);
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const text = value => typeof value === 'string' ? value.trim() : '';
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  function timestamp(value) {
    const result = text(value);
    // Server timestamps carry a zone. Never compare a local browser time as KST.
    return result && /(?:Z|[+-]\d{2}:\d{2})$/.test(result) && Number.isFinite(Date.parse(result)) ? result : null;
  }

  function reviewFrom(value) {
    if (value === null || value === undefined || value === false) return null;
    const key = text(value?.key) || 'basis-or-coverage-review';
    const known = own(REVIEWS, key) ? REVIEWS[key] : null;
    return { key, group: known?.group || 'basis', label: known?.label || text(value?.label) || '기준·구간 확인' };
  }

  function freshness(observedAt, referenceAt) {
    const referenceObservedAt = timestamp(referenceAt);
    if (!observedAt || !referenceObservedAt) return {
      state: 'unknown', observedAt, referenceObservedAt, lagSeconds: null,
      label: observedAt ? '조회 비교 기준 없음' : '조회 시각 미확인'
    };
    const lagSeconds = Math.max(0, (Date.parse(referenceObservedAt) - Date.parse(observedAt)) / 1000);
    return {
      state: lagSeconds > 0 ? 'behind' : 'aligned', observedAt, referenceObservedAt, lagSeconds,
      // A different query time is not proof of failure or an overdue schedule.
      label: lagSeconds > 0 ? '조회 시각 차이' : '최신 조회 시각'
    };
  }

  /**
   * Input is a plain adapter of already-validated facts, not an asset/receipt.
   * { tagNumber, enabled, hours, provenance, pending, wholeCycleVerified,
   *   coverage: { complete, startAt, observedAt, requiredStartAt, missingLeadingSeconds },
   *   review: null | { key, label }, action: null | { key, label, available },
   *   operation: { state, intermittent, observedAt }, referenceObservedAt }
   *
   * `wholeCycleVerified` must be supplied by the canonical cycle/provenance
   * proof. Missing flags, matching dates, and an instantaneous RUN=1 are not
   * substitutes. `partial` means a measured window; it does not itself claim
   * that a prefix is missing. An otherwise valid registered range stays neutral.
   */
  function assess(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const rawCoverage = source.coverage || {};
    const coverage = {
      complete: typeof rawCoverage.complete === 'boolean' ? rawCoverage.complete : null,
      startAt: timestamp(rawCoverage.startAt), observedAt: timestamp(rawCoverage.observedAt),
      requiredStartAt: timestamp(rawCoverage.requiredStartAt),
      missingLeadingSeconds: number(rawCoverage.missingLeadingSeconds)
    };
    const provenance = PROVENANCE.has(source.provenance) ? source.provenance : 'unknown';
    // A pending new cycle may contain the storage sentinel 0, which is not a
    // measured zero. Preserve a genuine numeric zero when measurement exists.
    const hours = source.pending === true ? null : number(source.hours);
    const validRange = Boolean(coverage.startAt && coverage.observedAt &&
      Date.parse(coverage.startAt) <= Date.parse(coverage.observedAt));
    const leadingGap = coverage.missingLeadingSeconds !== null && coverage.missingLeadingSeconds > 0;
    let review = reviewFrom(source.review);
    if (!review && hours === null) {
      review = { key: 'measurement-missing', group: 'measurement', label: 'RUN 조회 필요' };
    } else if (!review && ['retained', 'unknown'].includes(provenance)) {
      review = { key: 'measurement-unverified', group: 'measurement', label: '저장값 근거 확인' };
    } else if (!review && provenance === 'measured' && !validRange) {
      review = { key: 'measurement-range-unverified', group: 'measurement', label: '조회 근거 확인' };
    } else if (!review && leadingGap) {
      review = { key: 'leading-gap', ...REVIEWS['leading-gap'] };
    } else if (!review && provenance === 'measured' && coverage.complete === false) {
      review = { key: 'coverage-gap', ...REVIEWS['coverage-gap'] };
    }

    const wholeCycleVerified = hours !== null && provenance === 'measured' &&
      source.wholeCycleVerified === true && coverage.complete === true && validRange && !leadingGap && !review;
    const scope = hours === null ? 'pending' : provenance === 'manual' ? 'manual'
      : provenance !== 'measured' ? 'retained' : wholeCycleVerified ? 'whole' : 'partial';
    const scopeLabel = scope === 'whole' ? '확정 기준 누적' : scope === 'manual' ? '직접 입력 누적'
      : scope === 'retained' ? '기존 저장값' : scope === 'pending' ? '조회 대기'
      : coverage.complete === true && !review ? '등록 기준 누적' : '조회 구간 RUN';
    const requestedAction = source.action;
    // Only expose a mutation workflow if the adapter's existing proof and
    // permission helpers explicitly made it available. Otherwise open history.
    const actionKey = requestedAction?.available === true && own(ACTIONS, requestedAction.key)
      ? requestedAction.key : 'history';
    const operation = source.operation || {};
    return {
      tagNumber: text(source.tagNumber), enabled: source.enabled !== false && source.enabled !== 0,
      hours, provenance, scope, scopeLabel, wholeCycleVerified,
      requiresReview: Boolean(review), reviewGroup: review?.group || null,
      reasonKey: review?.key || null, reasonLabel: review?.label || '',
      nextActionKey: actionKey,
      nextActionLabel: actionKey === 'history' ? ACTIONS.history : text(requestedAction.label) || ACTIONS[actionKey],
      nextActionAvailable: true,
      coverage,
      freshness: freshness(coverage.observedAt, source.referenceObservedAt),
      operation: {
        state: STATES.has(operation.state) ? operation.state : 'unknown',
        intermittent: operation.intermittent === true,
        observedAt: timestamp(operation.observedAt)
      }
    };
  }

  function summarize(assessments) {
    const summary = {
      total: 0, whole: 0, partial: 0, manual: 0, retained: 0, pending: 0,
      requiresReview: 0, basisReview: 0, rangeReview: 0, measurementReview: 0,
      behind: 0, running: 0, stopped: 0, intermittent: 0, operationUnknown: 0
    };
    for (const item of Array.isArray(assessments) ? assessments : []) {
      if (!item || item.enabled === false || item.enabled === 0) continue;
      summary.total += 1;
      if (['whole', 'partial', 'manual', 'retained', 'pending'].includes(item.scope)) summary[item.scope] += 1;
      if (item.requiresReview === true) {
        summary.requiresReview += 1;
        const group = item.reviewGroup === 'basis' ? 'basisReview'
          : item.reviewGroup === 'range' ? 'rangeReview' : 'measurementReview';
        summary[group] += 1;
      }
      if (item.freshness?.state === 'behind') summary.behind += 1;
      if (item.operation?.intermittent === true) summary.intermittent += 1;
      else if (item.operation?.state === 'running') summary.running += 1;
      else if (item.operation?.state === 'stopped') summary.stopped += 1;
      else summary.operationUnknown += 1;
    }
    return summary;
  }

  return Object.freeze({ assess, summarize });
});
