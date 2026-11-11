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
  function replacementRangeTracking(a) {
    const p = a?.replacementAutoCycle, start = time(p?.rangeStartAt), replacement = time(a?.lastReplacementAt);
    return p?.schemaVersion === 3 && p.normalizationVersion === 4 && p.rangeTrackingAllowed === true &&
      p.registeredRuntimeRange !== true && p.timePrecision === 'day' && p.clockKnown !== true &&
      Number.isFinite(start) && Number.isFinite(replacement) && start > replacement && start - replacement <= 3 * DAY &&
      (start + 9 * 3600000) % DAY === 0 &&
      Math.floor((start + 9 * 3600000) / DAY) > Math.floor((replacement + 9 * 3600000) / DAY);
  }
  // This is a server-selected source, not a role ranking performed by the UI.
  // Its clock is kept separate from the registered owner of the saved RUN.
  function rolePriorityReview(a) {
    const proof = a?.replacementAutoCycle, selected = proof?.rolePrioritySelection;
    if (proof?.schemaVersion !== 3 || selected?.version !== 1 ||
        !['BCO1', 'BCO2', 'TGO'].includes(selected.selectedRole) ||
        !['minute', 'day'].includes(selected.timePrecision) ||
        typeof selected.selectedSourceLogId !== 'string' || !selected.selectedSourceLogId.trim() ||
        typeof selected.selectedSourceKey !== 'string' || !selected.selectedSourceKey.trim() ||
        !/^[a-f0-9]{64}$/.test(String(selected.selectedSourceSnapshotSha256 || '')) ||
        !/^\d{4}-\d\d-\d\d$/.test(String(selected.selectedWorkDate || '')) ||
        !Number.isFinite(time(selected.registeredReplacementAt)) ||
        time(selected.registeredReplacementAt) !== time(a?.lastReplacementAt)) return null;
    if (selected.timePrecision === 'day') {
      if (selected.selectedCompletionAt) return null;
      return { key: 'role-priority-clock-missing', label: '상위 보직 기준 선택 · 완료 시각 미기록', selected };
    }
    if (!Number.isFinite(time(selected.selectedCompletionAt)) ||
        selected.requiredRebuild !== true ||
        time(selected.selectedCompletionAt) === time(selected.registeredReplacementAt)) return null;
    return { key: 'role-priority-run-rebuild', label: '상위 보직 기준 선택 · RUN 재조회 필요', selected };
  }
  // A zero uncertainty window proves the duration without inventing a clock.
  // Link the server certificate to the exact current measurement and source;
  // an old certificate, equal hours or a bare success flag cannot clear review.
  function verifiedCompletionWindow(a) {
    const p = a?.completionWindowProof, evidence = a?.runtimeCoverageEvidence;
    const basis = a?.dataParcRuntimeBasis, runtime = a?.runRuntime, automatic = a?.replacementAutoCycle;
    const hours = a?.cycleElapsedHours ?? a?.runtimeHours;
    if (a?.tagNumber !== '204HHL60AP631' || a.blowerType !== 'fbhe' || a.enabled === false || a.enabled === 0 ||
        a.dataParcTag !== 'GSPOGE.ABB_DCS.204HHL60AP631XB04' || a.measurementRequired === true || a.cycleSourceReview ||
        p?.version !== 1 || p.kind !== 'completion_window_zero' || p.durationVerified !== true || p.completionClockKnown !== false ||
        p.certificateOnly !== true || p.dataParcTag !== a.dataParcTag || p.cycleStartRevision !== a.cycleStartRevision ||
        ![p.certificateEventId,p.requestId,p.runtimeRequestId,p.runtimeRevision,p.baseEventId,p.sourceLogId].every(value=>typeof value==='string'&&value.trim()) ||
        !/^[a-f0-9]{64}$/.test(String(p.sourceSnapshotSha256 || '')) || p.runtimeRevision !== a.cycleRuntimeRevision ||
        time(p.windowStartAt) !== time('2026-09-16T09:23:00+09:00') ||
        time(p.windowEndAt) !== time('2026-09-17T00:00:00+09:00') ||
        time(a.lastReplacementAt) !== time('2026-09-16T00:00:00+09:00') || a.actualLastReplacementAt ||
        automatic?.clockKnown !== false || automatic.completionClockConflict === true || automatic.rolePrioritySourceRevoked === true ||
        automatic.sourceLogId !== p.sourceLogId || automatic.sourceSnapshotSha256 !== p.sourceSnapshotSha256 ||
        evidence?.version !== 1 || evidence.source !== 'dataparc' || evidence.measurementVerified !== true ||
        evidence.durationEquivalent !== true || evidence.durationVerified !== true || evidence.coverageComplete !== true ||
        evidence.completionClockKnown !== false || evidence.completionWindowCertificateId !== p.certificateEventId ||
        evidence.missingLeadingSeconds !== 0 || runtime?.verified !== true || runtime.source !== 'dataparc' ||
        typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0 || typeof basis?.runtimeHours !== 'number' ||
        typeof evidence.hours !== 'number' || !Number.isFinite(basis.runtimeHours) || !Number.isFinite(evidence.hours) ||
        Math.abs(hours-basis.runtimeHours)>0.000001 || Math.abs(hours-evidence.hours)>0.000001 ||
        basis.dataParcTag !== a.dataParcTag || basis.requestId !== p.runtimeRequestId || evidence.requestId !== p.runtimeRequestId ||
        time(basis.startAt) !== time('2026-09-16T09:30:00+09:00') ||
        time(evidence.startAt) !== time(basis.startAt) || time(basis.observedAt) < time(p.windowEndAt) ||
        time(evidence.observedAt) !== time(basis.observedAt) || time(runtime.measuredAt) !== time(basis.observedAt) ||
        time(a.cycleRuntimeAnchorAt) !== time(basis.observedAt)) return null;
    return p;
  }
  // Presentation metadata only. These reasons never authorize a query or a
  // stored-value change; the unchanged receipt/cycle guards below own those.
  function verifiedLimestone2aFirstRun(a) {
    const basis = a?.dataParcRuntimeBasis, evidence = a?.runtimeCoverageEvidence, runtime = a?.runRuntime;
    const proof = a?.limestone2aFirstRunProof, owned = basis?.limestone2aFirstRun, measured = evidence?.limestone2aFirstRun;
    const origin = time('2026-09-19T00:00:00+09:00'), first = time('2026-09-19T09:58:26+09:00');
    const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
    const safeSeconds = value => Number.isSafeInteger(value) && value >= 0;
    const fields = ['version', 'certificateEventId', 'prefixRequestId', 'auditId', 'proofHash', 'sourceProofHash',
      'cycleStartRevision', 'currentRuntimeRevision', 'currentRunningSeconds', 'firstRunAt', 'completionDay',
      'completionClockKnown', 'completionBeforeFirstRun', 'noEarlierPostReplacementRun', 'durationEquivalent',
      'prefixRunningSeconds', 'originalTailRunningSeconds', 'sampleGoodCertified', 'preservedStateBoundary',
      'measuredState', 'currentState', 'currentAnchorAt', 'currentObservedAt'];
    const boundary = basis?.preservedStateBoundary === true;
    const stateValid = boundary
      ? proof?.preservedStateBoundary === true && proof.measuredState === basis.state &&
        proof.currentState === runtime?.state && proof.currentState === a?.cycleRuntimeState &&
        time(proof.currentObservedAt) === time(basis.observedAt) && time(proof.currentAnchorAt) === time(a?.cycleRuntimeAnchorAt) &&
        time(proof.currentAnchorAt) > time(basis.observedAt)
      : proof?.preservedStateBoundary !== true && runtime?.state === basis?.state && a?.cycleRuntimeState === basis?.state &&
        time(a?.cycleRuntimeAnchorAt) === time(basis?.observedAt);
    if (a?.tagNumber !== '203HRJ01AN601' || a.blowerType !== 'limestone' || String(a.unitNo) !== '2' ||
        a.enabled === false || a.enabled === 0 || a.dataParcTag !== 'GSPOGE.ABB_DCS.203HRJ01AN601XB04' ||
        a.cycleStartState !== 'pending' || a.cycleStartedAt || a.cycleStoredStartedAt ||
        !/^lime2a-first-run-v1:[a-f0-9]{64}$/.test(String(a.cycleStartRevision || '')) ||
        typeof a.cycleRuntimeRevision !== 'string' || !a.cycleRuntimeRevision ||
        time(a.lastReplacementAt) !== origin || a.actualLastReplacementAt !== '' || a.cycleSourceReview ||
        a.measurementRequired === true || a.replacementAutoCycle?.requiresRunRefresh === true ||
        a.replacementAutoCycle?.completionClockConflict === true || a.replacementAutoCycle?.rolePrioritySourceRevoked === true ||
        proof?.version !== 1 || !owned || !measured || fields.some(key => proof[key] !== owned[key] || proof[key] !== measured[key]) ||
        !safeId(proof.prefixRequestId) || proof.auditId !== 'lime2a_first_run:' + proof.prefixRequestId ||
        proof.certificateEventId !== 'dataparc_limestone2a_first_run:' + proof.prefixRequestId ||
        !/^[a-f0-9]{64}$/.test(String(proof.proofHash || '')) || !/^[a-f0-9]{64}$/.test(String(proof.sourceProofHash || '')) ||
        a.cycleStartRevision !== 'lime2a-first-run-v1:' + proof.proofHash || proof.cycleStartRevision !== a.cycleStartRevision ||
        proof.currentRuntimeRevision !== a.cycleRuntimeRevision || proof.currentRunningSeconds !== basis.runningSeconds ||
        time(proof.currentObservedAt) !== time(basis.observedAt) || time(proof.currentAnchorAt) !== time(a.cycleRuntimeAnchorAt) ||
        proof.currentState !== a.cycleRuntimeState || proof.measuredState !== basis.state ||
        proof.completionDay !== '2026-09-19' || proof.completionClockKnown !== false ||
        proof.completionBeforeFirstRun !== true || proof.noEarlierPostReplacementRun !== true ||
        proof.durationEquivalent !== true || proof.prefixRunningSeconds !== 50494 ||
        !safeSeconds(proof.originalTailRunningSeconds) || proof.sampleGoodCertified !== false ||
        typeof proof.firstRunAt !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(proof.firstRunAt) ||
        !Number.isFinite(time(proof.firstRunAt)) || Math.floor(time(proof.firstRunAt) / 1000) !== first / 1000 ||
        basis.composite !== true || basis.appendReady !== true || basis.coverageComplete !== true ||
        basis.dataParcTag !== a.dataParcTag || time(basis.startAt) !== origin || time(basis.requiredStartAt) !== origin ||
        basis.missingLeadingSeconds !== 0 || basis.cycleRuntimeRevision !== a.cycleRuntimeRevision ||
        !safeId(basis.requestId) || !safeSeconds(basis.runningSeconds) ||
        basis.runningSeconds < proof.prefixRunningSeconds + proof.originalTailRunningSeconds ||
        !(time(basis.observedAt) >= time('2026-09-20T00:00:00+09:00')) ||
        typeof basis.runtimeHours !== 'number' || !Number.isFinite(basis.runtimeHours) ||
        Math.abs(basis.runtimeHours * 3600 - basis.runningSeconds) > 0.01 ||
        typeof (a.cycleElapsedHours ?? a.runtimeHours) !== 'number' || !Number.isFinite(a.cycleElapsedHours ?? a.runtimeHours) ||
        Math.abs((a.cycleElapsedHours ?? a.runtimeHours) * 3600 - basis.runningSeconds) > 0.01 ||
        runtime?.verified !== true || runtime.source !== 'dataparc' || !['running', 'stopped'].includes(runtime.state) ||
        !['running', 'stopped'].includes(basis.state) || !stateValid || time(runtime.measuredAt) !== time(basis.observedAt) ||
        evidence?.version !== 1 || evidence.source !== 'dataparc' || evidence.measurementVerified !== true ||
        evidence.durationEquivalent !== true || evidence.durationVerified !== true || evidence.completionClockKnown !== false ||
        evidence.wholeCycleVerified !== false || evidence.cycleBasisConfirmed !== false || evidence.coverageComplete !== true ||
        evidence.missingLeadingSeconds !== 0 || evidence.requestId !== basis.requestId ||
        time(evidence.startAt) !== origin || time(evidence.observedAt) !== time(basis.observedAt) ||
        typeof evidence.hours !== 'number' || !Number.isFinite(evidence.hours) || Math.abs(evidence.hours * 3600 - basis.runningSeconds) > 0.01) return null;
    return proof;
  }
  function verifiedLimestone1bFirstRun(a) {
    const basis = a?.dataParcRuntimeBasis, evidence = a?.runtimeCoverageEvidence, runtime = a?.runRuntime;
    const proof = a?.limestone1bFirstRunProof, owned = basis?.limestone1bFirstRun, measured = evidence?.limestone1bFirstRun;
    const origin = time('2026-09-22T00:00:00+09:00'), first = time('2026-09-22T09:50:26+09:00');
    const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
    const safeSeconds = value => Number.isSafeInteger(value) && value >= 0;
    const fields = ['version', 'certificateEventId', 'freshRequestId', 'auditId', 'proofHash', 'sourceProofHash',
      'cycleStartRevision', 'currentRuntimeRevision', 'currentRunningSeconds', 'firstRunAt', 'completionDay',
      'completionClockKnown', 'completionBeforeFirstRun', 'noEarlierPostReplacementRun', 'durationEquivalent',
      'r9RequestId', 'rawFirstRunAt', 'rawOldStopAt', 'measurementStartAt', 'completionWithinStoppedWindow',
      'excludedRunningSeconds', 'comparisonToleranceSeconds', 'comparisonDifferenceSeconds', 'originalRunningSeconds', 'freshRunningSeconds', 'sampleGoodCertified', 'preservedStateBoundary',
      'measuredState', 'currentState', 'currentAnchorAt', 'currentObservedAt'];
    const boundary = basis?.preservedStateBoundary === true;
    const stateValid = boundary
      ? proof?.preservedStateBoundary === true && proof.measuredState === basis.state &&
        proof.currentState === runtime?.state && proof.currentState === a?.cycleRuntimeState &&
        time(proof.currentObservedAt) === time(basis.observedAt) && time(proof.currentAnchorAt) === time(a?.cycleRuntimeAnchorAt) &&
        time(proof.currentAnchorAt) > time(basis.observedAt)
      : proof?.preservedStateBoundary !== true && runtime?.state === basis?.state && a?.cycleRuntimeState === basis?.state &&
        time(a?.cycleRuntimeAnchorAt) === time(basis?.observedAt);
    if (a?.tagNumber !== '103HRJ01AN602' || a.blowerType !== 'limestone' || String(a.unitNo) !== '1' ||
        a.enabled === false || a.enabled === 0 || a.dataParcTag !== 'GSPOGE.ABB_DCS.103HRJ01AN602XB04' ||
        a.cycleStartState !== 'pending' || a.cycleStartedAt || a.cycleStoredStartedAt ||
        !/^lime1b-first-run-v1:[a-f0-9]{64}$/.test(String(a.cycleStartRevision || '')) ||
        typeof a.cycleRuntimeRevision !== 'string' || !a.cycleRuntimeRevision ||
        time(a.lastReplacementAt) !== origin || a.actualLastReplacementAt !== '' || a.cycleSourceReview ||
        a.measurementRequired === true || a.replacementAutoCycle?.requiresRunRefresh === true ||
        a.replacementAutoCycle?.completionClockConflict === true || a.replacementAutoCycle?.rolePrioritySourceRevoked === true ||
        proof?.version !== 1 || !owned || !measured || fields.some(key => proof[key] !== owned[key] || proof[key] !== measured[key]) ||
        !safeId(proof.freshRequestId) || !safeId(proof.r9RequestId) || proof.auditId !== 'lime1b_first_run:' + proof.freshRequestId ||
        proof.certificateEventId !== 'dataparc_limestone1b_first_run:' + proof.freshRequestId ||
        !/^[a-f0-9]{64}$/.test(String(proof.proofHash || '')) || !/^[a-f0-9]{64}$/.test(String(proof.sourceProofHash || '')) ||
        a.cycleStartRevision !== 'lime1b-first-run-v1:' + proof.proofHash || proof.cycleStartRevision !== a.cycleStartRevision ||
        proof.currentRuntimeRevision !== a.cycleRuntimeRevision || proof.currentRunningSeconds !== basis.runningSeconds ||
        time(proof.currentObservedAt) !== time(basis.observedAt) || time(proof.currentAnchorAt) !== time(a.cycleRuntimeAnchorAt) ||
        proof.currentState !== a.cycleRuntimeState || proof.measuredState !== basis.state ||
        proof.completionDay !== '2026-09-22' || proof.completionClockKnown !== false ||
        proof.completionBeforeFirstRun !== true || proof.noEarlierPostReplacementRun !== true ||
        proof.durationEquivalent !== true || proof.completionWithinStoppedWindow !== true ||
        !safeSeconds(proof.freshRunningSeconds) || !safeSeconds(proof.originalRunningSeconds) ||
        ![34166,34167].includes(proof.excludedRunningSeconds) ||
        !Number.isSafeInteger(proof.comparisonToleranceSeconds) || proof.comparisonToleranceSeconds < 2 || proof.comparisonToleranceSeconds > 10000 ||
        !Number.isSafeInteger(proof.comparisonDifferenceSeconds) ||
        proof.comparisonDifferenceSeconds !== proof.freshRunningSeconds - (proof.originalRunningSeconds-proof.excludedRunningSeconds) ||
        Math.abs(proof.comparisonDifferenceSeconds) > proof.comparisonToleranceSeconds ||
        proof.rawFirstRunAt !== proof.firstRunAt || time(proof.measurementStartAt) !== first ||
        Math.floor(time(proof.rawOldStopAt)/1000) !== time('2026-09-22T09:29:26+09:00')/1000 ||
        proof.excludedRunningSeconds !== Math.round((time(proof.rawOldStopAt)-origin)/1000) || proof.sampleGoodCertified !== false ||
        typeof proof.firstRunAt !== 'string' || !/(?:Z|[+-]\d\d:\d\d)$/.test(proof.firstRunAt) ||
        !Number.isFinite(time(proof.firstRunAt)) || Math.floor(time(proof.firstRunAt) / 1000) !== first / 1000 ||
        basis.composite !== true || basis.appendReady !== true || basis.coverageComplete !== true ||
        basis.dataParcTag !== a.dataParcTag || time(basis.startAt) !== first || time(basis.requiredStartAt) !== first ||
        basis.missingLeadingSeconds !== 0 || basis.cycleRuntimeRevision !== a.cycleRuntimeRevision ||
        !safeId(basis.requestId) || !safeSeconds(basis.runningSeconds) ||
        basis.runningSeconds < proof.freshRunningSeconds ||
        !(time(basis.observedAt) > first) ||
        typeof basis.runtimeHours !== 'number' || !Number.isFinite(basis.runtimeHours) ||
        Math.abs(basis.runtimeHours * 3600 - basis.runningSeconds) > 0.01 ||
        typeof (a.cycleElapsedHours ?? a.runtimeHours) !== 'number' || !Number.isFinite(a.cycleElapsedHours ?? a.runtimeHours) ||
        Math.abs((a.cycleElapsedHours ?? a.runtimeHours) * 3600 - basis.runningSeconds) > 0.01 ||
        runtime?.verified !== true || runtime.source !== 'dataparc' || !['running', 'stopped'].includes(runtime.state) ||
        !['running', 'stopped'].includes(basis.state) || !stateValid || time(runtime.measuredAt) !== time(basis.observedAt) ||
        evidence?.version !== 1 || evidence.source !== 'dataparc' || evidence.measurementVerified !== true ||
        evidence.durationEquivalent !== true || evidence.durationVerified !== true || evidence.completionClockKnown !== false ||
        evidence.wholeCycleVerified !== false || evidence.cycleBasisConfirmed !== false || evidence.coverageComplete !== true ||
        evidence.missingLeadingSeconds !== 0 || evidence.requestId !== basis.requestId ||
        time(evidence.startAt) !== first || time(evidence.observedAt) !== time(basis.observedAt) ||
        typeof evidence.hours !== 'number' || !Number.isFinite(evidence.hours) || Math.abs(evidence.hours * 3600 - basis.runningSeconds) > 0.01) return null;
    return proof;
  }
  function verifiedFbhe1bStandby(a) {
    const basis = a?.dataParcRuntimeBasis, evidence = a?.runtimeCoverageEvidence, runtime = a?.runRuntime;
    const p = a?.fbhe1bStandbyProof, owned = basis?.fbhe1bStandby, measured = evidence?.fbhe1bStandby;
    const day = time('2026-10-08T00:00:00+09:00'), seam = time('2026-10-09T00:00:00+09:00');
    const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
    const count = value => Number.isSafeInteger(value) && value >= 0;
    const fields = ['version', 'certificateId', 'auditId', 'r9RequestId', 'proofHash', 'sourceProofHash', 'cycleStartRevision',
      'currentRuntimeRevision', 'currentRunningSeconds', 'currentState', 'currentAnchorAt', 'currentObservedAt', 'completionDay',
      'lastRunStoppedAt', 'zeroWindowEndAt', 'measuredStartAt', 'completionClockKnown', 'durationEquivalent',
      'originalTailRunningSeconds', 'replacementCompletedAfterStop', 'noRestartAfterReplacement', 'sampleGoodCertified'];
    const hours = a?.cycleElapsedHours ?? a?.runtimeHours;
    if (a?.tagNumber !== '104HHL60AP621' || a.blowerType !== 'fbhe' || String(a.unitNo) !== '1' ||
        a.enabled === false || a.enabled === 0 || a.dataParcTag !== 'GSPOGE.ABB_DCS.104HHL60AP621XB04' ||
        a.cycleStartState !== 'pending' || a.cycleStartedAt || a.cycleStoredStartedAt || time(a.lastReplacementAt) !== day ||
        a.actualLastReplacementAt !== '' || a.cycleSourceReview || a.measurementRequired === true ||
        a.replacementAutoCycle?.requiresRunRefresh === true || a.replacementAutoCycle?.completionClockConflict === true ||
        a.replacementAutoCycle?.rolePrioritySourceRevoked === true || p?.version !== 1 || !owned || !measured ||
        fields.some(key => p[key] !== owned[key] || p[key] !== measured[key]) || !safeId(p.r9RequestId) ||
        p.certificateId !== 'fbhe1b_standby:' + p.r9RequestId || p.auditId !== 'fbhe1b_standby_audit:' + p.r9RequestId ||
        !/^[a-f0-9]{64}$/.test(String(p.proofHash || '')) || !/^[a-f0-9]{64}$/.test(String(p.sourceProofHash || '')) ||
        typeof a.cycleStartRevision !== 'string' || !a.cycleStartRevision || p.cycleStartRevision !== a.cycleStartRevision ||
        typeof a.cycleRuntimeRevision !== 'string' || !a.cycleRuntimeRevision || p.currentRuntimeRevision !== a.cycleRuntimeRevision ||
        p.currentRunningSeconds !== basis.runningSeconds || p.currentState !== a.cycleRuntimeState ||
        !['running', 'stopped'].includes(p.currentState) || time(p.currentAnchorAt) !== time(a.cycleRuntimeAnchorAt) ||
        time(p.currentObservedAt) !== time(basis.observedAt) || time(p.currentAnchorAt) !== time(basis.observedAt) ||
        p.completionDay !== '2026-10-08' || p.completionClockKnown !== false || p.durationEquivalent !== true ||
        p.replacementCompletedAfterStop !== true || p.noRestartAfterReplacement !== true || p.sampleGoodCertified !== false ||
        !count(p.originalTailRunningSeconds) || Math.floor(time(p.lastRunStoppedAt) / 1000) !== time('2026-10-08T13:14:47+09:00') / 1000 ||
        time(p.zeroWindowEndAt) !== seam || time(p.measuredStartAt) !== seam ||
        basis.composite !== true || basis.appendReady !== true || basis.coverageComplete !== true || basis.dataParcTag !== a.dataParcTag ||
        time(basis.startAt) !== seam || time(basis.requiredStartAt) !== day || basis.missingLeadingSeconds !== 0 ||
        !safeId(basis.requestId) || !count(basis.runningSeconds) || basis.runningSeconds < p.originalTailRunningSeconds ||
        !(time(basis.observedAt) > seam) || typeof basis.runtimeHours !== 'number' || !Number.isFinite(basis.runtimeHours) ||
        Math.abs(basis.runtimeHours * 3600 - basis.runningSeconds) > 0.01 || typeof hours !== 'number' || !Number.isFinite(hours) ||
        Math.abs(hours * 3600 - basis.runningSeconds) > 0.01 ||
        basis.cycleRuntimeRevision !== undefined && basis.cycleRuntimeRevision !== a.cycleRuntimeRevision ||
        runtime?.verified !== true || runtime.source !== 'dataparc' || runtime.state !== p.currentState ||
        time(runtime.measuredAt) !== time(basis.observedAt) || evidence?.version !== 1 || evidence.source !== 'dataparc' ||
        evidence.measurementVerified !== true || evidence.durationEquivalent !== true || evidence.durationVerified !== true ||
        evidence.completionClockKnown !== false || evidence.wholeCycleVerified !== false || evidence.cycleBasisConfirmed !== false ||
        evidence.coverageComplete !== true || evidence.missingLeadingSeconds !== 0 || evidence.requestId !== basis.requestId ||
        time(evidence.startAt) !== seam || time(evidence.requiredStartAt) !== day || time(evidence.observedAt) !== time(basis.observedAt) ||
        typeof evidence.hours !== 'number' || !Number.isFinite(evidence.hours) || Math.abs(evidence.hours * 3600 - basis.runningSeconds) > 0.01) return null;
    return p;
  }
  function verifiedFbhe2cStandby(a) {
    const basis = a?.dataParcRuntimeBasis, evidence = a?.runtimeCoverageEvidence, runtime = a?.runRuntime;
    const p = a?.fbhe2cStandbyProof, owned = basis?.fbhe2cStandby, measured = evidence?.fbhe2cStandby;
    const day = time('2026-09-16T00:00:00+09:00'), seam = time('2026-09-17T00:00:00+09:00');
    const measuredStart = time('2026-09-16T09:30:00+09:00');
    const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
    const count = value => Number.isSafeInteger(value) && value >= 0;
    const fields = ['version', 'certificateId', 'auditId', 'r9RequestId', 'proofHash', 'sourceProofHash', 'cycleStartRevision',
      'currentRuntimeRevision', 'currentRunningSeconds', 'currentState', 'currentAnchorAt', 'currentObservedAt', 'completionDay',
      'lastRunStoppedAt', 'zeroWindowEndAt', 'measuredStartAt', 'completionClockKnown', 'durationEquivalent',
      'originalTailRunningSeconds', 'replacementCompletedAfterStop', 'noRestartThroughWindowEnd', 'sampleGoodCertified'];
    const hours = a?.cycleElapsedHours ?? a?.runtimeHours;
    if (a?.tagNumber !== '204HHL60AP631' || a.blowerType !== 'fbhe' || String(a.unitNo) !== '2' ||
        a.enabled === false || a.enabled === 0 || a.dataParcTag !== 'GSPOGE.ABB_DCS.204HHL60AP631XB04' ||
        a.cycleStartState !== 'pending' || a.cycleStartedAt || a.cycleStoredStartedAt || time(a.lastReplacementAt) !== day ||
        a.actualLastReplacementAt !== '' || a.cycleSourceReview || a.measurementRequired === true ||
        a.replacementAutoCycle?.requiresRunRefresh === true || a.replacementAutoCycle?.completionClockConflict === true ||
        a.replacementAutoCycle?.rolePrioritySourceRevoked === true || p?.version !== 1 || !owned || !measured ||
        fields.some(key => p[key] !== owned[key] || p[key] !== measured[key]) || !safeId(p.r9RequestId) ||
        p.certificateId !== 'fbhe2c_standby:' + p.r9RequestId || p.auditId !== 'fbhe2c_standby_audit:' + p.r9RequestId ||
        !/^[a-f0-9]{64}$/.test(String(p.proofHash || '')) || !/^[a-f0-9]{64}$/.test(String(p.sourceProofHash || '')) ||
        typeof a.cycleStartRevision !== 'string' || !a.cycleStartRevision || p.cycleStartRevision !== a.cycleStartRevision ||
        typeof a.cycleRuntimeRevision !== 'string' || !a.cycleRuntimeRevision || p.currentRuntimeRevision !== a.cycleRuntimeRevision ||
        p.currentRunningSeconds !== basis.runningSeconds || p.currentState !== a.cycleRuntimeState ||
        !['running', 'stopped'].includes(p.currentState) || time(p.currentAnchorAt) !== time(a.cycleRuntimeAnchorAt) ||
        time(p.currentObservedAt) !== time(basis.observedAt) || time(p.currentAnchorAt) !== time(basis.observedAt) ||
        p.completionDay !== '2026-09-16' || p.completionClockKnown !== false || p.durationEquivalent !== true ||
        p.replacementCompletedAfterStop !== true || p.noRestartThroughWindowEnd !== true || p.sampleGoodCertified !== false ||
        !count(p.originalTailRunningSeconds) || Math.floor(time(p.lastRunStoppedAt) / 1000) !== time('2026-09-16T09:28:25+09:00') / 1000 ||
        time(p.zeroWindowEndAt) !== seam || time(p.measuredStartAt) !== measuredStart ||
        !(time(p.lastRunStoppedAt) < measuredStart && measuredStart < seam) ||
        basis.composite !== true || basis.appendReady !== true || basis.coverageComplete !== true || basis.dataParcTag !== a.dataParcTag ||
        time(basis.startAt) !== measuredStart || time(basis.requiredStartAt) !== day || basis.missingLeadingSeconds !== 0 ||
        !safeId(basis.requestId) || !count(basis.runningSeconds) || basis.runningSeconds < p.originalTailRunningSeconds ||
        !(time(basis.observedAt) >= seam) || time(basis.observedAt) === seam && (basis.runningSeconds !== 0 || p.currentState !== 'stopped') ||
        typeof basis.runtimeHours !== 'number' || !Number.isFinite(basis.runtimeHours) ||
        Math.abs(basis.runtimeHours * 3600 - basis.runningSeconds) > 0.01 || typeof hours !== 'number' || !Number.isFinite(hours) ||
        Math.abs(hours * 3600 - basis.runningSeconds) > 0.01 ||
        basis.cycleRuntimeRevision !== undefined && basis.cycleRuntimeRevision !== a.cycleRuntimeRevision ||
        runtime?.verified !== true || runtime.source !== 'dataparc' || runtime.state !== p.currentState ||
        time(runtime.measuredAt) !== time(basis.observedAt) || evidence?.version !== 1 || evidence.source !== 'dataparc' ||
        evidence.measurementVerified !== true || evidence.durationEquivalent !== true || evidence.durationVerified !== true ||
        evidence.completionClockKnown !== false || evidence.wholeCycleVerified !== false || evidence.cycleBasisConfirmed !== false ||
        evidence.coverageComplete !== true || evidence.missingLeadingSeconds !== 0 || evidence.requestId !== basis.requestId ||
        time(evidence.startAt) !== measuredStart || time(evidence.requiredStartAt) !== day || time(evidence.observedAt) !== time(basis.observedAt) ||
        typeof evidence.hours !== 'number' || !Number.isFinite(evidence.hours) || Math.abs(evidence.hours * 3600 - basis.runningSeconds) > 0.01) return null;
    return p;
  }
  function verifiedFbhe1aRuntime(a) {
    const b = a?.dataParcRuntimeBasis, e = a?.runtimeCoverageEvidence, r = a?.runRuntime;
    const p = a?.fbhe1aRuntimeProof, owned = b?.fbhe1aRuntime, measured = e?.fbhe1aRuntime;
    const day = time('2026-09-04T00:00:00+09:00'), start = time('2026-09-05T00:00:00+09:00');
    const oldStart = time('2026-09-04T10:50:00+09:00'), stop = time('2026-09-04T10:50:39+09:00');
    const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
    const seconds = value => Number.isSafeInteger(value) && value >= 0;
    const fields = ['version', 'certificateEventId', 'auditId', 'proofHash', 'sourceProofHash', 'witnessRequestId', 'freshRequestId',
      'cycleStartRevision', 'currentRuntimeRevision', 'currentRunningSeconds', 'currentState', 'currentAnchorAt', 'currentObservedAt',
      'completionDay', 'lastRunStoppedAt', 'zeroWindowEndAt', 'measuredStartAt', 'excludedPreReplacementSeconds',
      'measuredRunningSeconds', 'completionClockKnown', 'durationEquivalent', 'sampleGoodCertified'];
    const hours = a?.cycleElapsedHours ?? a?.runtimeHours;
    if (a?.tagNumber !== '104HHL60AP611' || a.blowerType !== 'fbhe' || String(a.unitNo) !== '1' ||
        a.enabled === false || a.enabled === 0 || a.dataParcTag !== 'GSPOGE.ABB_DCS.104HHL60AP611XB04' ||
        a.cycleStartState !== 'legacy' || !Object.hasOwn(a, 'cycleStoredStartedAt') || a.cycleStoredStartedAt ||
        a.cycleStartedAt && time(a.cycleStartedAt) !== day || time(a.lastReplacementAt) !== day || a.actualLastReplacementAt !== '' ||
        a.cycleSourceReview || a.measurementRequired === true || a.replacementAutoCycle?.requiresRunRefresh === true ||
        a.replacementAutoCycle?.completionClockConflict === true || a.replacementAutoCycle?.rolePrioritySourceRevoked === true ||
        p?.version !== 1 || !owned || !measured || fields.some(key => p[key] !== owned[key] || p[key] !== measured[key]) ||
        !id(p.witnessRequestId) || !id(p.freshRequestId) || p.certificateEventId !== 'dataparc_fbhe1a_runtime:' + p.freshRequestId ||
        p.auditId !== 'fbhe1a_runtime:' + p.freshRequestId || !/^[a-f0-9]{64}$/.test(String(p.proofHash || '')) ||
        !/^[a-f0-9]{64}$/.test(String(p.sourceProofHash || '')) || p.cycleStartRevision !== a.cycleStartRevision ||
        a.cycleStartRevision !== 'fbhe1a-runtime-v1:' + p.proofHash || typeof a.cycleRuntimeRevision !== 'string' || !a.cycleRuntimeRevision ||
        p.currentRuntimeRevision !== a.cycleRuntimeRevision || p.currentRunningSeconds !== b.runningSeconds ||
        p.currentState !== a.cycleRuntimeState || !['running', 'stopped'].includes(p.currentState) ||
        time(p.currentAnchorAt) !== time(a.cycleRuntimeAnchorAt) || time(p.currentObservedAt) !== time(b.observedAt) ||
        !(time(p.currentAnchorAt) >= time(p.currentObservedAt)) || p.completionDay !== '2026-09-04' ||
        p.completionClockKnown !== false || p.durationEquivalent !== true || p.sampleGoodCertified !== false ||
        Math.floor(time(p.lastRunStoppedAt) / 1000) !== stop / 1000 || time(p.zeroWindowEndAt) !== start ||
        time(p.measuredStartAt) !== start || !seconds(p.excludedPreReplacementSeconds) ||
        p.excludedPreReplacementSeconds !== Math.round((time(p.lastRunStoppedAt) - oldStart) / 1000) ||
        !seconds(p.measuredRunningSeconds) || b.composite !== true || b.appendReady !== true || b.coverageComplete !== true ||
        b.dataParcTag !== a.dataParcTag || time(b.startAt) !== start || time(b.requiredStartAt) !== day || b.missingLeadingSeconds !== 0 ||
        !id(b.requestId) || !seconds(b.runningSeconds) || b.runningSeconds < p.measuredRunningSeconds || !(time(b.observedAt) > start) ||
        typeof b.runtimeHours !== 'number' || !Number.isFinite(b.runtimeHours) || Math.abs(b.runtimeHours * 3600 - b.runningSeconds) > 0.01 ||
        typeof hours !== 'number' || !Number.isFinite(hours) || Math.abs(hours * 3600 - b.runningSeconds) > 0.01 ||
        b.cycleRuntimeRevision !== undefined && b.cycleRuntimeRevision !== a.cycleRuntimeRevision ||
        r?.verified !== true || r.source !== 'dataparc' || r.state !== p.currentState || time(r.measuredAt) !== time(b.observedAt) ||
        e?.version !== 1 || e.source !== 'dataparc' || e.measurementVerified !== true || e.durationEquivalent !== true ||
        e.durationVerified !== true || e.completionClockKnown !== false || e.wholeCycleVerified !== false || e.cycleBasisConfirmed !== false ||
        e.coverageComplete !== true || e.missingLeadingSeconds !== 0 || e.requestId !== b.requestId || time(e.startAt) !== start ||
        time(e.requiredStartAt) !== day || time(e.observedAt) !== time(b.observedAt) ||
        typeof e.hours !== 'number' || !Number.isFinite(e.hours) || Math.abs(e.hours * 3600 - b.runningSeconds) > 0.01) return null;
    return p;
  }
  function runReviewStatus(a, basis = a?.dataParcRuntimeBasis) {
    if (verifiedCompletionWindow(a) || verifiedLimestone2aFirstRun(a) || verifiedLimestone1bFirstRun(a) || verifiedFbhe1bStandby(a) || verifiedFbhe2cStandby(a) || verifiedFbhe1aRuntime(a)) return null;
    const priority = rolePriorityReview(a);
    if (priority) return { key: priority.key, label: priority.label };
    const automatic = a?.replacementAutoCycle;
    const rangeTracking = replacementRangeTracking(a);
    const registeredRange = automatic?.schemaVersion === 3 && automatic.normalizationVersion === 4 &&
      automatic.registeredRuntimeRange === true;
    if (automatic?.schemaVersion === 3 && automatic.requiresRunRefresh === true && !rangeTracking) return null;
    const clockUnknown = automatic?.schemaVersion === 3 && automatic.clockKnown !== true && automatic.registeredBaseline !== true;
    const review = a?.cycleSourceReview;
    if (basis?.coverageComplete !== false && !review && !clockUnknown && !rangeTracking && !registeredRange) return null;
    if (automatic?.completionClockConflict === true) return { key: 'completion-time-conflict', label: '교체 시각 불일치' };
    if (review?.code === 'CONFIRMED_REPLACEMENT_RUN_GAP' && review.cycleBasisConfirmed === true &&
        automatic?.clockKnown === true && Number.isFinite(time(automatic.confirmedReplacementAt))) {
      return { key: 'leading-gap', label: '누적 구간 확인' };
    }
    if (rangeTracking || clockUnknown && !registeredRange) return { key: 'completion-time-missing', label: '완료 시각 미기록' };
    if (review || registeredRange) return { key: 'replacement-basis-review', label: '교체 기준 확인' };
    return { key: 'coverage-gap', label: '누적 구간 확인' };
  }

  function partialAppendResultStatus(task, current) {
    if (verifiedCompletionWindow(current) || verifiedLimestone2aFirstRun(current) || verifiedLimestone1bFirstRun(current) || verifiedFbhe1bStandby(current) || verifiedFbhe2cStandby(current) || verifiedFbhe1aRuntime(current)) return null;
    // Current server projection also supports resuming an older checkpoint
    // whose compact saved asset predates this display-only metadata.
    const currentReason = current ? runReviewStatus(current) : null;
    if (currentReason) return currentReason;
    const saved = task?.runReviewStatus;
    const labels = { 'completion-time-conflict': '교체 시각 불일치', 'leading-gap': '누적 구간 확인',
      'completion-time-missing': '완료 시각 미기록', 'replacement-basis-review': '교체 기준 확인', 'coverage-gap': '누적 구간 확인',
      'role-priority-run-rebuild': '상위 보직 기준 선택 · RUN 재조회 필요',
      'role-priority-clock-missing': '상위 보직 기준 선택 · 완료 시각 미기록' };
    if (saved && labels[saved.key]) return { key: saved.key, label: labels[saved.key] };
    const assetReason = runReviewStatus(task?.asset);
    if (assetReason) return assetReason;
    if (task?.registeredRuntimeRange === true) return { key: 'replacement-basis-review', label: '교체 기준 확인' };
    if (task?.partialTracking === true) return { key: 'completion-time-missing', label: '완료 시각 미기록' };
    return { key: 'basis-or-coverage-review', label: '기준·구간 확인' };
  }
  function freshReplacementQuery(a, now) {
    const proof = a?.replacementAutoCycle;
    const isNumber = value => value !== null && value !== undefined && typeof value !== 'boolean' &&
      !(typeof value === 'string' && value.trim() === '') && Number.isFinite(Number(value));
    const current = [a?.runtimeHours, a?.cycleElapsedHours].filter(isNumber).map(Number);
    // Public projections intentionally hide an unmeasured reset value. Only
    // the server-owned fresh-cycle proof may expose the zero checkpoint here.
    const resetCheckpoint = current.length ? current.every(value => value === 0)
      : proof?.storedRuntimeHours === 0 && proof?.storedLegacyRuntimeHours === 0;
    const end = now instanceof Date ? now.getTime() : time(now);
    const range = replacementRangeTracking(a) && proof?.rangeQueryEligible === true;
    if (range && (proof.cycleStartRevision !== a.cycleStartRevision || proof.cycleRuntimeRevision !== a.cycleRuntimeRevision ||
        a.cycleStartState !== 'pending' || String(a.cycleStoredStartedAt ?? a.cycleStartedAt ?? '').trim() ||
        proof.storedRuntimeHours !== 0 || proof.storedLegacyRuntimeHours !== 0)) return null;
    const startAt = range ? proof.rangeStartAt : proof?.requiredStartAt;
    const start = time(startAt), replacement = time(a?.lastReplacementAt);
    if (proof?.schemaVersion !== 3 || proof.requiresRunRefresh !== true ||
        (!range && proof.freshQueryEligible !== true) ||
        (!range && proof.clockKnown !== true && proof.registeredBaseline !== true) ||
        !['minute','day'].includes(proof.timePrecision) || typeof proof.sourceLogId !== 'string' || !proof.sourceLogId.trim() ||
        typeof proof.eventId !== 'string' || !proof.eventId.trim() ||
        typeof a.cycleStartRevision !== 'string' || !a.cycleStartRevision ||
        typeof a.cycleRuntimeRevision !== 'string' || !a.cycleRuntimeRevision ||
        !resetCheckpoint ||
        !Number.isFinite(start) || !Number.isFinite(replacement) || !Number.isFinite(end) ||
        start < replacement || start >= end || end - start > 366 * DAY) return null;
    return { startAt, ...(range ? { replacementAutoRange: true } : {}) };
  }
  function partialAppendBase(a, basis, dataParcTag, end = Infinity) {
    if ((basis?.coverageComplete !== false && a?.cycleSourceReview?.measuredRangeMayContinue !== true) ||
        basis?.appendReady !== true || basis.dataParcTag !== dataParcTag ||
        typeof basis.requestId !== 'string' || !basis.requestId ||
        !Number.isFinite(time(a?.lastReplacementAt)) || !Number.isFinite(time(basis.startAt)) ||
        !Number.isFinite(time(basis.observedAt)) || time(basis.startAt) < time(a.lastReplacementAt) ||
        time(basis.observedAt) <= time(basis.startAt) || time(basis.observedAt) > end ||
        !Number.isSafeInteger(basis.runningSeconds) || basis.runningSeconds < 0 ||
        typeof basis.runtimeHours !== 'number' || !Number.isFinite(basis.runtimeHours) || basis.runtimeHours < 0 ||
        Math.abs(basis.runtimeHours * 3600 - basis.runningSeconds) > 2) return null;
    const stored = a.cycleElapsedHours ?? a.runtimeHours;
    if (stored !== null && stored !== undefined && stored !== '' && Number.isFinite(Number(stored)) &&
        Math.abs(Number(stored) - basis.runtimeHours) > 0.000001) return null;
    return { requestId: basis.requestId, startAt: basis.startAt, observedAt: basis.observedAt,
      runtimeHours: basis.runtimeHours, runningSeconds: basis.runningSeconds, dataParcTag };
  }
  function recognizedPartialAppend(task, current, acceptedId = '') {
    const base = task?.partialBase, s = task?.snapshot;
    if (task?.partialRange !== true || task.incremental !== true || task.previewOnly === true || !base || !s ||
        time(task.startAt) !== time(base.startAt) || time(task.queryStartAt) !== time(base.observedAt) ||
        task.dataParcTag !== base.dataParcTag || !partialAppendBase({ lastReplacementAt: s.lastReplacementAt,
          cycleElapsedHours: base.runtimeHours }, { ...base, coverageComplete: false, appendReady: true }, task.dataParcTag)) return false;
    if (current === null) return false;
    if (!current) return true; // The accepted server intent remains the final owner check.
    const saved = current.dataParcRuntimeBasis;
    const currentSnapshot = snapshot(current);
    const samePhysicalCycle = Object.keys(s).filter(key => key !== 'cycleRuntimeRevision').every(key => currentSnapshot[key] === s[key]);
    if (acceptedId && saved?.requestId === acceptedId && samePhysicalCycle) return true;
    const currentBase = partialAppendBase(current, saved, task.dataParcTag);
    return samePhysicalCycle && currentSnapshot.cycleRuntimeRevision === s.cycleRuntimeRevision && !!currentBase &&
      Object.keys(base).every(key => currentBase[key] === base[key]);
  }
  function recognizedFreshRange(task, current, acceptedId = '') {
    if (task?.replacementAutoRange !== true || task.replacementAutoFresh !== true || task.partialTracking !== true ||
        task.incremental === true || task.previewOnly === true || !current || !task.snapshot ||
        time(task.startAt) !== time(task.queryStartAt)) return false;
    const s = task.snapshot, currentSnapshot = snapshot(current);
    const samePhysicalCycle = Object.keys(s).filter(key => key !== 'cycleRuntimeRevision').every(key => currentSnapshot[key] === s[key]);
    const saved = current.dataParcRuntimeBasis;
    if (acceptedId && saved?.requestId === acceptedId && samePhysicalCycle && saved.coverageComplete === false &&
        time(saved.startAt) === time(task.startAt) && partialAppendBase(current, saved, task.dataParcTag)) return true;
    // Revalidate against the captured server plan clock, never the PC clock.
    const fresh = freshReplacementQuery(current, task.replacementRangePlannedAt);
    return sameCycle(s, current) && fresh?.replacementAutoRange === true && time(fresh.startAt) === time(task.startAt);
  }

  // Automatic repairs use the same current receipt as an append, plus a
  // narrowly scoped proof for the different full-query boundary. These facts
  // authorize planning only; the server freezes and revalidates the intent.
  function runtimeRecoveryPlan(a, now) {
    const end = now instanceof Date ? now.getTime() : time(now);
    const basis = a?.dataParcRuntimeBasis, automatic = a?.replacementAutoCycle;
    const signal = a?.dataParcTag, stored = a?.cycleElapsedHours ?? a?.runtimeHours;
    const pendingRole = a?.tagNumber === '103HRJ01AN601' && a.blowerType === 'limestone' &&
      a.cycleStartState === 'pending' && automatic?.rolePriorityRecoveryEligible === true &&
      !String(a.cycleStoredStartedAt ?? a.cycleStartedAt ?? '').trim();
    const pendingWindow = a?.tagNumber === '204HHL60AP631' && a.blowerType === 'fbhe' &&
      a.cycleStartState === 'pending' && a.completionWindowRecovery?.eligible === true &&
      !String(a.cycleStoredStartedAt ?? a.cycleStartedAt ?? '').trim();
    if (!a || !DP_TAGS.has(a.tagNumber) || a.enabled === false || a.enabled === 0 ||
        a.hasUnverifiedDataParcHistory !== false || a.measurementRequired === true ||
        (!['legacy', 'started'].includes(a.cycleStartState) && !pendingRole && !pendingWindow) || automatic?.requiresRunRefresh === true ||
        ![a.cycleStartRevision, a.cycleRuntimeRevision].every(value => typeof value === 'string' && value.trim()) ||
        typeof signal !== 'string' || !/^GSPOGE\.ABB_DCS\.[A-Z0-9][A-Z0-9._-]*$/.test(signal) ||
        signal.length > 200 || signal === SIGNAL || !Number.isFinite(end) ||
        typeof stored !== 'number' || !Number.isFinite(stored) || stored < 0) return null;
    const base = partialAppendBase(a, basis, signal, end);
    if (!base || !base.requestId.trim() || Math.abs(stored - base.runtimeHours) > 0.000001 ||
        base.runningSeconds * 1000 > time(base.observedAt) - time(base.startAt) + 2000) return null;
    const runtime = a.runRuntime, evidence = a.runtimeCoverageEvidence;
    if (runtime && (runtime.verified !== true || runtime.source !== 'dataparc' ||
        time(runtime.measuredAt) !== time(base.observedAt))) return null;
    if (evidence && (evidence.version !== 1 || evidence.source !== 'dataparc' || evidence.measurementVerified !== true ||
        evidence.requestId !== base.requestId || typeof evidence.hours !== 'number' ||
        !Number.isFinite(evidence.hours) || Math.abs(evidence.hours - stored) > 0.000001 ||
        time(evidence.startAt) !== time(base.startAt) || time(evidence.observedAt) !== time(base.observedAt))) return null;

    let recoveryMode = '', startAt = '', endAt = '';
    if (a.tagNumber === '103HRJ01AN601' && a.blowerType === 'limestone') {
      const selected = rolePriorityReview(a)?.selected;
      const selectedAt = time(selected?.selectedCompletionAt), replacement = time(a.lastReplacementAt);
      if (automatic?.rolePriorityRecoveryEligible !== true || automatic.rolePrioritySourceRevoked === true ||
          (a.cycleStartState !== 'legacy' && !pendingRole) || selected?.timePrecision !== 'minute' || selected.requiredRebuild !== true ||
          String(a.cycleStoredStartedAt ?? a.cycleStartedAt ?? '').trim() ||
          signal !== `GSPOGE.ABB_DCS.${a.tagNumber}XB04` || !Number.isFinite(selectedAt) || selectedAt % 60000 !== 0 ||
          !(replacement < selectedAt && selectedAt < time(base.observedAt)) || time(base.startAt) !== replacement) return null;
      recoveryMode = 'role_priority'; startAt = selected.selectedCompletionAt;
    } else if (a.tagNumber === '104ETG30AN602' && a.blowerType === 'flyash_bag') {
      const clock = time(automatic?.confirmedReplacementAt);
      const eventId = automatic?.confirmedClockEventId || automatic?.eventId;
      const sourceHash = automatic?.confirmedClockSourceSnapshotSha256 || automatic?.sourceSnapshotSha256;
      if (basis.confirmedGapRecoveryEligible !== true || basis.coverageComplete !== false || basis.cycleBasisConfirmed !== true ||
          automatic?.schemaVersion !== 3 || automatic.timePrecision !== 'minute' || automatic.clockKnown !== true ||
          automatic.completionClockConflict === true || a.cycleSourceReview?.cycleBasisConfirmed === false ||
          typeof eventId !== 'string' || !eventId.trim() || !/^[a-f0-9]{64}$/.test(String(sourceHash || '')) ||
          !Number.isFinite(clock) || clock % 60000 !== 0 || !(clock < time(base.startAt)) ||
          clock !== time(basis.requiredStartAt) || clock !== time(a.lastReplacementAt) || clock !== time(a.actualLastReplacementAt)) return null;
      recoveryMode = 'confirmed_gap'; startAt = automatic.confirmedReplacementAt;
    } else if (/^204HHL10AN(?:611|631)$/.test(a.tagNumber) && a.blowerType === 'seal_pot') {
      const origin = time('2026-05-11T00:00:00+09:00');
      if (a.cycleStartState !== 'legacy' || time(a.lastReplacementAt) !== origin || time(basis.requiredStartAt) !== origin ||
          time(base.startAt) < origin || signal !== `GSPOGE.ABB_DCS.${a.tagNumber}XB04` ||
          runtime?.verified !== true || runtime.source !== 'dataparc' || basis.coverageComplete !== false ||
          evidence?.firstRunVerified === true) return null;
      recoveryMode = a.tagNumber === '204HHL10AN631' ? 'seal_registered_range' : 'seal_first_run';
      startAt = basis.requiredStartAt;
    } else if (pendingWindow) {
      const candidate = a.completionWindowRecovery;
      if (verifiedCompletionWindow(a) || candidate.version !== 1 || candidate.dataParcTag !== signal ||
          signal !== 'GSPOGE.ABB_DCS.204HHL60AP631XB04' ||
          time(a.lastReplacementAt) !== time('2026-09-16T00:00:00+09:00') ||
          time(candidate.startAt) !== time('2026-09-16T09:23:00+09:00') ||
          time(candidate.windowStartAt) !== time(candidate.startAt) ||
          time(candidate.endAt) !== time('2026-09-17T00:00:00+09:00') ||
          time(candidate.windowEndAt) !== time(candidate.endAt) ||
          time(base.startAt) !== time('2026-09-16T09:30:00+09:00') ||
          time(base.observedAt) < time(candidate.endAt) || automatic?.clockKnown !== false ||
          automatic.completionClockConflict === true) return null;
      recoveryMode = 'completion_window_zero'; startAt = candidate.startAt; endAt = candidate.endAt;
    } else return null;
    const start = time(startAt);
    if (!Number.isFinite(start) || !(start < end) || end - start > 366 * DAY) return null;
    return { recoveryMode, startAt, ...(endAt ? {endAt} : {}), dataParcTag: signal };
  }

  function runtimeRecoverySnapshot(a) {
    const pick = (value, keys) => value && typeof value === 'object'
      ? Object.fromEntries(keys.filter(key => value[key] !== undefined).map(key => [key, value[key]])) : null;
    const proof = pick(a, ['tagNumber', 'blowerType', 'enabled', 'lastReplacementAt', 'actualLastReplacementAt',
      'cycleStartState', 'cycleStartRevision', 'cycleRuntimeRevision', 'dataParcTag', 'runtimeHours', 'cycleElapsedHours',
      'measurementRequired', 'hasUnverifiedDataParcHistory']);
    if (!proof) return null;
    proof.cycleStoredStartedAt = a.cycleStoredStartedAt ?? a.cycleStartedAt ?? '';
    proof.dataParcRuntimeBasis = pick(a.dataParcRuntimeBasis, ['requestId', 'dataParcTag', 'startAt', 'observedAt',
      'requiredStartAt', 'runtimeHours', 'runningSeconds', 'appendReady', 'coverageComplete', 'cycleBasisConfirmed',
      'confirmedGapRecoveryEligible', 'firstRunStartedAt']);
    proof.runRuntime = pick(a.runRuntime, ['verified', 'source', 'measuredAt']);
    proof.runtimeCoverageEvidence = pick(a.runtimeCoverageEvidence, ['version', 'source', 'measurementVerified',
      'requestId', 'hours', 'startAt', 'observedAt', 'firstRunVerified']);
    proof.cycleSourceReview = pick(a.cycleSourceReview, ['code', 'cycleBasisConfirmed', 'measuredRangeMayContinue']);
    proof.replacementAutoCycle = pick(a.replacementAutoCycle, ['schemaVersion', 'normalizationVersion', 'requiresRunRefresh',
      'rolePriorityRecoveryEligible', 'rolePrioritySourceRevoked', 'timePrecision', 'clockKnown', 'completionClockConflict',
      'confirmedReplacementAt', 'confirmedClockEventId', 'eventId', 'confirmedClockSourceSnapshotSha256', 'sourceSnapshotSha256']);
    if (a.completionWindowRecovery) proof.completionWindowRecovery = pick(a.completionWindowRecovery,
      ['version','eligible','startAt','endAt','windowStartAt','windowEndAt','dataParcTag']);
    if (proof.replacementAutoCycle) proof.replacementAutoCycle.rolePrioritySelection = pick(a.replacementAutoCycle.rolePrioritySelection,
      ['version', 'selectedRole', 'timePrecision', 'selectedSourceLogId', 'selectedSourceKey', 'selectedSourceSnapshotSha256',
        'selectedWorkDate', 'selectedShift', 'registeredReplacementAt', 'selectedCompletionAt', 'requiredRebuild']);
    return proof;
  }

  function runtimeRecoveryMarker(task) {
    return task?.kind === 'dataparc_repair' || ['recoveryMode', 'recoveryProof', 'recoveryPlannedAt', 'recoveryVersion']
      .some(key => task && Object.prototype.hasOwnProperty.call(task, key));
  }

  function validRuntimeRecoveryTask(task) {
    if (task?.kind !== 'dataparc_repair' || task.recoveryVersion !== 1 || task.incremental !== false ||
        task.previewOnly === true || task.partialRange === true || task.replacementAutoFresh === true ||
        task.replacementAutoRange === true || task.limestoneAutoRebuild === true || !task.snapshot ||
        task.startAt !== task.queryStartAt || !sameCycle(task.snapshot, task.recoveryProof)) return false;
    if (task.recoveryMode === 'append_boundary_full') {
      const a = task.recoveryProof, basis = a.dataParcRuntimeBasis;
      const seconds = basis?.runningSeconds, hours = a.cycleElapsedHours ?? a.runtimeHours;
      return a.tagNumber === '204SDF01AN002' && a.blowerType === 'organic_fuel' &&
        a.cycleStartState === 'started' && a.hasUnverifiedDataParcHistory === false && a.measurementRequired !== true &&
        task.dataParcTag === 'GSPOGE.ABB_DCS.204SDF01AN002XB04' && basis?.dataParcTag === task.dataParcTag &&
        basis.appendReady === true && basis.coverageComplete === true &&
        typeof basis.requestId === 'string' && !!basis.requestId.trim() &&
        typeof task.boundaryFailureRequestId === 'string' && !!task.boundaryFailureRequestId.trim() &&
        task.boundaryFailureRequestId.length <= 200 && task.boundaryFailureRequestId !== basis.requestId &&
        Number.isSafeInteger(seconds) && seconds >= 0 && typeof hours === 'number' && Number.isFinite(hours) &&
        Math.abs(hours * 3600 - seconds) <= 0.01 && time(task.startAt) === time(basis.startAt) &&
        time(task.startAt) === time(a.cycleStoredStartedAt) && time(task.startAt) < time(basis.observedAt) &&
        time(task.boundaryFailureEndAt) > time(basis.observedAt) &&
        time(task.recoveryPlannedAt) >= time(task.boundaryFailureEndAt) &&
        time(task.recoveryPlannedAt) - time(task.boundaryFailureEndAt) <= 15 * 60000 && !task.endAt;
    }
    const planned = runtimeRecoveryPlan(task.recoveryProof, task.recoveryPlannedAt);
    return !!planned && planned.recoveryMode === task.recoveryMode && planned.startAt === task.startAt &&
      planned.dataParcTag === task.dataParcTag && (planned.endAt || '') === (task.endAt || '');
  }

  function recognizedRuntimeRecovery(task, current, acceptedId = '') {
    if (!validRuntimeRecoveryTask(task) || !current || current.tagNumber !== task.snapshot.tagNumber ||
        current.enabled === false || current.enabled === 0) return false;
    const saved = current.dataParcRuntimeBasis, stored = current.cycleElapsedHours ?? current.runtimeHours;
    const durationProof = task.recoveryMode === 'completion_window_zero' ? verifiedCompletionWindow(current) : null;
    if (acceptedId && durationProof?.requestId === acceptedId &&
        time(saved.observedAt) >= time(task.recoveryProof.dataParcRuntimeBasis.observedAt)) return true;
    // A lost apply response may be retried only by its accepted ID. Its new
    // receipt is allowed to own a new revision/boundary; the server checks the
    // immutable repair intent and audit before returning an idempotent result.
    if (acceptedId && saved?.requestId === acceptedId && saved.dataParcTag === task.dataParcTag &&
        saved.coverageComplete === true && time(saved.startAt) === time(task.startAt) &&
        time(saved.observedAt) >= time(task.recoveryProof.dataParcRuntimeBasis.observedAt) &&
        time(current.lastReplacementAt) === time(task.recoveryMode === 'role_priority' ? task.startAt : task.snapshot.lastReplacementAt) &&
        typeof stored === 'number' && Number.isFinite(stored) && typeof saved.runtimeHours === 'number' &&
        Number.isFinite(saved.runtimeHours) && Math.abs(stored - saved.runtimeHours) <= 0.000001) return true;
    return sameCycle(task.snapshot, current) &&
      JSON.stringify(runtimeRecoverySnapshot(current)) === JSON.stringify(task.recoveryProof);
  }
  function fbheSealRunView(a, basis = null) {
    const limestoneEquivalent = verifiedLimestone2aFirstRun(a) || verifiedLimestone1bFirstRun(a);
    const standbyEquivalent = verifiedFbhe1bStandby(a) || verifiedFbhe2cStandby(a);
    const runtimeEquivalent = verifiedFbhe1aRuntime(a);
    const equivalent = verifiedCompletionWindow(a) || limestoneEquivalent || standbyEquivalent || runtimeEquivalent;
    if (equivalent) {
      const hours = a.cycleElapsedHours ?? a.runtimeHours, state = a.runRuntime.state;
      return {verified:true,manual:false,pending:false,state,hours,durationEquivalent:true,
        primary:`${hours.toLocaleString('ko-KR',{minimumFractionDigits:1,maximumFractionDigits:1})}시간`,
        message:runtimeEquivalent ? '교체 후 정지 확인과 RUN 재측정 검증 · 완료시각 미기록' : standbyEquivalent ? '교체 후 정지 구간과 이후 RUN 누적 검증 · 완료시각 미기록' : limestoneEquivalent ? '교체 완료 후 최초 기동과 RUN 누적 검증 · 완료시각 미기록' : '교체 작업 구간의 정지를 검증한 누적시간 · 완료시각 미기록',
        measuredAt:a.dataParcRuntimeBasis.observedAt,sourceLabel:runtimeEquivalent ? 'DataPARC · 교체 후 RUN 재측정' : standbyEquivalent ? 'DataPARC · 교체 후 정지 구간 확인' : limestoneEquivalent ? 'DataPARC · 최초 기동 확인' : 'DataPARC · 정지 구간 검증',
        basis:a.dataParcRuntimeBasis,stateLabel:state==='running'?'기동중':'정지중'};
    }
    const replacement = a?.replacementAutoCycle;
    const priority = rolePriorityReview(a);
    const rangeTracking = replacementRangeTracking(a);
    const registeredRange = replacement?.schemaVersion === 3 && replacement.normalizationVersion === 4 && replacement.registeredRuntimeRange === true;
    const clockUnknown = replacement?.schemaVersion === 3 && replacement.clockKnown !== true && replacement.registeredBaseline !== true;
    if (!priority && replacement?.schemaVersion === 3 && !registeredRange && (replacement.requiresRunRefresh === true || clockUnknown && !rangeTracking)) {
      const selected = a.cycleElapsedHours ?? a.runtimeHours;
      const retained = replacement.requiresRunRefresh !== true && selected !== null && selected !== undefined && typeof selected !== 'boolean' &&
        !(typeof selected === 'string' && selected.trim() === '') && Number.isFinite(Number(selected)) && Number(selected) >= 0 ? Number(selected) : null;
      return { verified: false, pending: replacement.requiresRunRefresh === true, automaticReplacement: true, rangeTracking, clockUnknown, manual: false,
        state: 'unknown', hours: retained, primary: retained !== null ? `${retained.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}시간` : rangeTracking ? 'RUN 조회 대기' : clockUnknown ? '완료 시각 미기록' : 'RUN 조회 대기',
        stateLabel: rangeTracking ? 'RUN 조회 대기' : clockUnknown ? '완료 시각 미기록' : 'RUN 조회 대기', sourceLabel: '업무일지 교체 자동반영',
        message: rangeTracking ? '교체 기록 이후 확인 구간 RUN 조회 대기 · 완료 시각 미기록' : clockUnknown ? '교체 자동반영 완료 · 완료 시각 미기록 · 새 벨트 RUN 기준 확인 필요'
          : '교체 자동반영 · 새 교체 기준 RUN 조회 대기', basis: null, measuredAt: '' };
    }
    const coverage = a?.dataParcRuntimeBasis || basis;
    const storedHours = a?.cycleElapsedHours ?? a?.runtimeHours;
    const staleCoverage = coverage?.runtimeHours !== null && coverage?.runtimeHours !== undefined && coverage?.runtimeHours !== '' &&
      storedHours !== null && storedHours !== undefined && storedHours !== '' &&
      Number.isFinite(Number(coverage.runtimeHours)) && Number.isFinite(Number(storedHours)) &&
      Math.abs(Number(coverage.runtimeHours) - Number(storedHours)) > 0.000001;
    const sourceReview = a?.cycleSourceReview;
    if (coverage?.coverageComplete === false && !staleCoverage || sourceReview || rangeTracking || registeredRange || priority) {
      const manual = a?.runRuntime?.verified === true && a.runRuntime.source === 'manual';
      const selectedHours = manual || staleCoverage ? storedHours : coverage?.runtimeHours ?? storedHours;
      const hours = selectedHours === null || selectedHours === undefined ||
        typeof selectedHours === 'string' && selectedHours.trim() === '' ||
        typeof selectedHours === 'boolean' ? NaN : Number(selectedHours);
      const state = [a.runRuntime?.state, a.cycleRuntimeState].find(value => ['running', 'stopped'].includes(value)) || 'unknown';
      return { verified: false, partial: true, sourceReview: Boolean(sourceReview), rangeTracking, registeredRuntimeRange: registeredRange, manual, pending: false, state,
        hours: Number.isFinite(hours) && hours >= 0 ? hours : null,
        primary: Number.isFinite(hours) && hours >= 0
          ? `${hours.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}시간` : '확인 필요',
        message: priority ? priority.label : rangeTracking ? '확인 구간 RUN 누적 · 교체 기록 이후 확인된 RUN · 완료 시각 미기록'
          : registeredRange ? '확인 구간 누적 · RUN 조회기준 · 실제 교체 기준 미확정'
          : sourceReview ? '확인 구간 누적 · 교체 기준 확인 필요' : '일부 기간 RUN 누적 · 교체 기준 확인 필요',
        measuredAt: manual ? a.runRuntime.measuredAt || '' : coverage?.observedAt || '',
        sourceLabel: manual ? '수동 보정 · 교체 기준 확인 필요' : 'DataPARC · 확인 구간', basis: manual ? null : coverage,
        stateLabel: state === 'running' ? '기동중' : state === 'stopped' ? '정지중' : 'RUN 미확인' };
    }
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
      const recovery = runtimeRecoveryPlan(a, new Date(end));
      if (recovery) {
        tasks.push({ kind: 'dataparc_repair', asset: a, snapshot: snapshot(a), ...recovery,
          queryStartAt: recovery.startAt, incremental: false, recoveryVersion: 1,
          recoveryPlannedAt: new Date(end).toISOString(), recoveryProof: runtimeRecoverySnapshot(a) });
        continue;
      }
      const replacementProof = a.replacementAutoCycle;
      const standbyProof = verifiedFbhe1bStandby(a) || verifiedFbhe2cStandby(a) || verifiedFbhe1aRuntime(a);
      const priority = standbyProof ? null : rolePriorityReview(a);
      if (priority && a.cycleSourceReview?.measuredRangeMayContinue !== true) {
        skip(`${priority.label} · 기존 조회값 보존`); continue;
      }
      const rangeTracking = !standbyProof && replacementRangeTracking(a);
      const registeredRange = !standbyProof && replacementProof?.schemaVersion === 3 && replacementProof.normalizationVersion === 4 && replacementProof.registeredRuntimeRange === true;
      const freshReplacement = freshReplacementQuery(a, new Date(end));
      if (replacementProof?.schemaVersion === 3 && replacementProof.clockKnown !== true && replacementProof.registeredBaseline !== true && !rangeTracking && !registeredRange) {
        skip('교체 자동반영 완료 · 완료 시각 미기록 · 새 벨트 RUN 기준 확인 필요');
        continue;
      }
      if (replacementProof?.schemaVersion === 3 && replacementProof.requiresRunRefresh === true && !freshReplacement) {
        skip(replacementProof.clockKnown !== true && replacementProof.registeredBaseline !== true
          ? '교체 자동반영 완료 · 완료 시각 미기록 · 새 벨트 RUN 기준 확인 필요'
          : '교체 자동반영 완료 · 새 Cycle RUN 조회 기준 확인 필요');
        continue;
      }
      // V3-F: read RUN samples for the three disputed Limestone cycles without
      // certifying their cumulative V-Belt runtime or moving an existing basis.
      const replacement = time(a.lastReplacementAt);
      const heldLimestoneTags = ['103HRJ01AN602', '203HRJ01AN601', '203HRJ01AN602'];
      const candidate = a.blowerType === 'limestone' && heldLimestoneTags.includes(a.tagNumber);
      // This server capability permits measured RUN from the existing stored
      // baseline without asserting an actual V-Belt replacement completion.
      const automaticLimestone = candidate && a.limestoneAutoApply === true;
      const unresolvedDay = candidate && ['103HRJ01AN602', '203HRJ01AN602'].includes(a.tagNumber) &&
        replacement === Date.parse('2026-09-22T00:00:00+09:00');
      const unresolved2A = candidate && a.tagNumber === '203HRJ01AN601' &&
        (!Number.isFinite(replacement) || replacement < Date.parse('2026-09-19T00:00:00+09:00'));
      // A server-confirmed replacement basis is bound to this exact cycle and
      // revision. In particular, an actual midnight replacement must not stay
      // blocked merely because it matches the former date-only placeholder.
      const basisConfirmed = candidate && a.limestoneBasisConfirmed === true &&
        a.limestoneRunDisputed !== true;
      const authoritativeDispute = candidate && typeof a.limestoneRunDisputed === 'boolean';
      const disputed = candidate && !basisConfirmed && (authoritativeDispute
        ? a.limestoneRunDisputed : unresolvedDay || unresolved2A);
      // An explicitly resolved server cycle with unverified older history is
      // not permission to requery and replace its saved total. It also cannot
      // use the separate tracking apply route, which accepts disputed cycles.
      if (!freshReplacement && !rangeTracking && !automaticLimestone && candidate && !basisConfirmed && authoritativeDispute && !disputed &&
          a.hasUnverifiedDataParcHistory === true) {
        skip('기존 조회 기준 미검증 · 실제 V-Belt 교체 기준 확정 후 재조회 필요'); continue;
      }
      const previewOnly = !freshReplacement && !rangeTracking && !automaticLimestone && candidate && !basisConfirmed &&
        (disputed || !authoritativeDispute && a.hasUnverifiedDataParcHistory === true);
      const holdReason = unresolvedDay ? '9/22 실제 V-Belt 교체시각 미확정'
        : unresolved2A ? '2호기 #A 9/19 V-Belt 교체 완료 근거 충돌'
        : '기존 DataPARC 누적 기준 미검증';
      if (!Number.isFinite(replacement)) { skip('교체일 등록 필요 · 이력 보기 / V-Belt 교체 등록'); continue; }
      if (replacement >= end) { skip('교체일이 현재 시각 이후입니다.'); continue; }
      if (!DP_TAGS.has(a.tagNumber)) { skip('연결된 운전시간 조회 방식이 없습니다.'); continue; }
      const dataParcTag = automaticLimestone ? `GSPOGE.ABB_DCS.${a.tagNumber}XB04`
        : a.tagNumber === '104ETH03AN602' ? SIGNAL : String(a.dataParcTag || (a.blowerType === 'limestone' ? a.limestoneSignalCandidate : '') || '').trim();
      if (!/^GSPOGE\.ABB_DCS\.[A-Z0-9][A-Z0-9._-]*$/.test(dataParcTag) || dataParcTag.length > 200 || (a.tagNumber !== '104ETH03AN602' && dataParcTag === SIGNAL)) {
        skip('RUN TAG 설정 필요 · 이력 보기 → 조회 기준·상세'); continue;
      }
      const previous = freshReplacement ? null : automaticLimestone || basisConfirmed ? a.dataParcRuntimeBasis || null
        : a.dataParcRuntimeBasis || basisFor(a.tagNumber);
      if (rangeTracking && previous && time(previous.startAt) !== time(replacementProof.rangeStartAt)) {
        skip('확인 구간 RUN 기준 불일치 · 기존 조회값 보호'); continue;
      }
      const sourceReviewRange = a.cycleSourceReview?.measuredRangeMayContinue === true;
      const partialRange = !freshReplacement && (previous?.coverageComplete === false || sourceReviewRange || rangeTracking || registeredRange);
      const partialBase = partialRange ? partialAppendBase(a, previous, dataParcTag, end) : null;
      if (partialRange && !partialBase) {
        skip('일부 기간 RUN 누적 · 교체 기준 확인 필요 · 기존 조회값 보호 · 전체 재조회하지 않음');
        continue;
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
      // Confirmation invalidates the prior checkpoint; a null server basis
      // must not be replaced by cached browser history or the old RUN ledger.
      // Once this new cycle has a verified basis, its normal append guard wins.
      // A verified partial receipt may advance its own measured range. It does
      // not certify the omitted leading interval or a physical replacement time.
      const automaticAppend = automaticLimestone && previous?.appendReady === true &&
        previous.dataParcTag === dataParcTag && (time(previous.startAt) === replacement || !!partialBase) &&
        Number.isFinite(time(previous.observedAt)) && time(previous.observedAt) > replacement &&
        time(previous.observedAt) <= end;
      const limestoneAutoRebuild = automaticLimestone && !automaticAppend;
      // Preserve every already-confirmed result. Once a basis exists, the integrated refresh may
      // continue only from a server-verified append owner; it must never fall back to a full requery.
      const startAt = freshReplacement ? freshReplacement.startAt : automaticLimestone ? automaticAppend ? previous.startAt : a.lastReplacementAt
        : previous?.startAt || (basisConfirmed ? a.lastReplacementAt
          : (a.cycleStartState === 'started' && a.cycleStartedAt) || a.lastReplacementAt);
      const incremental = automaticLimestone ? automaticAppend
        : previous?.appendReady === true && previous?.dataParcTag === dataParcTag;
      if (!automaticLimestone && previous && !incremental) {
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
      tasks.push({ kind: 'dataparc', asset: a, snapshot: snapshot(a), startAt, queryStartAt, incremental, dataParcTag,
        ...(freshReplacement ? { replacementAutoFresh: true } : {}),
        ...(freshReplacement?.replacementAutoRange === true ? { replacementAutoRange: true,
          replacementRangePlannedAt: new Date(end).toISOString() } : {}),
        ...(rangeTracking || registeredRange ? { partialTracking: true } : {}),
        ...(registeredRange ? { registeredRuntimeRange: true } : {}),
        ...(partialRange ? { partialRange: true, partialBase, runReviewStatus: runReviewStatus(a, previous) } : {}),
        ...(sourceReviewRange ? { sourceReviewRange: true } : {}),
        ...(limestoneAutoRebuild ? { limestoneAutoRebuild: true } : {}) });
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
    const recovery = runtimeRecoveryMarker(task);
    if (recovery && !validRuntimeRecoveryTask(task)) throw error('누적 보완 조회의 종류와 고정 근거를 확인할 수 없습니다.', 'BLOWER_RUNTIME_RECOVERY_INVALID');
    return {
      action: 'create_blower_runtime_probe', unifiedRefresh: true,
      incrementalRefresh: !recovery && task.previewOnly !== true && (task.limestoneAutoRebuild !== true || task.replacementAutoFresh === true),
      ...(task.recoveryMode === 'role_priority' ? { rolePriorityRecovery: true, selectedCompletionAt: task.startAt } : {}),
      ...(task.recoveryMode === 'confirmed_gap' ? { confirmedGapRecovery: true } : {}),
      ...(task.recoveryMode === 'seal_first_run' ? { requireFirstRunStart: true } : {}),
      ...(task.recoveryMode === 'seal_registered_range' ? { registeredRangeRecovery: true } : {}),
      ...(task.recoveryMode === 'append_boundary_full' ? { appendBoundaryRecovery: true,
        boundaryFailureRequestId: task.boundaryFailureRequestId } : {}),
      ...(task.recoveryMode === 'completion_window_zero' ? { completionWindowRecovery: true, endAt:task.endAt } : {}),
      ...(task.replacementAutoRange === true ? { replacementAutoRange: true, partialTracking: true } : {}),
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
    if (resume?.boundaryCreateUnconfirmed) {
      const uncertain = resume.boundaryCreateUnconfirmed, task = uncertain.task;
      const original = resume.createdBatch?.results?.find(row => row.assetTag === task?.snapshot?.tagNumber);
      if (uncertain.version !== 1 || !validRuntimeRecoveryTask(task) || task.recoveryMode !== 'append_boundary_full' ||
          original?.item?.id !== task.boundaryFailureRequestId || !Array.isArray(resume.tasks) ||
          !resume.tasks.some(row => row.snapshot?.tagNumber === task.snapshot.tagNumber)) {
        throw error('접수 미확인 복구 요청의 고정 근거가 변경되었습니다. 새 요청을 만들지 않았습니다.','BLOWER_RUNTIME_RECOVERY_INVALID');
      }
      io.assertWritable?.();
      let reply, cause = null;
      try {
        reply = await io.api({url:`/api/ois-data-requests?action=boundary_recovery_status&failureRequestId=${encodeURIComponent(task.boundaryFailureRequestId)}`,
          timeoutMs:20000});
      } catch (error) {
        if ([401,403].includes(Number(error?.status)) || error?.code === 'WRITE_ACCESS_CHANGED') throw error;
        cause = error;
      }
      if (reply?.ok === true && reply.found === false && reply.failureRequestId === task.boundaryFailureRequestId) {
        // After an explicit resume and a successful absence lookup, replay
        // only the same frozen full body. Its server reuse key includes the
        // failed request and proof hash (not the new end time); concurrent
        // original/replayed POSTs share one atomic accepted request.
        io.assertWritable?.();
        try {
          const accepted = await io.api({method:'POST',url:'/api/ois-data-requests',timeoutMs:30000,
            body:{action:'create_blower_runtime_probe_batch',requests:[dataParcCreateBody(task)]}});
          const row = accepted?.results?.[0];
          if (accepted?.ok === true && accepted.atomic === true && accepted.batchVersion === 1 &&
              accepted.requestedCount === 1 && accepted.results?.length === 1 && row?.ok === true &&
              row.assetTag === task.snapshot.tagNumber && row.upToDate !== true) {
            reply = {ok:true,found:true,failureRequestId:task.boundaryFailureRequestId,item:row.item};
          } else cause = error('전체 구간 복구 요청 접수 응답을 확인하지 못했습니다. 같은 고정 요청만 다시 확인합니다.','CREATE_RESULT_UNCONFIRMED');
        } catch (error) {
          if ([401,403].includes(Number(error?.status)) || error?.code === 'WRITE_ACCESS_CHANGED') throw error;
          cause = error;
          if (![0,429,502,503,504].includes(Number(error?.status || 0))) {
            const resolved = {...resume,outcomes:[...(resume.outcomes || []).filter(row => row.tagNumber !== task.snapshot.tagNumber),
              {tagNumber:task.snapshot.tagNumber,displayName:task.asset?.displayName || task.snapshot.tagNumber,status:'failed',
                requestId:task.boundaryFailureRequestId,recoveryMode:'append_boundary_full',errorCode:error.code || 'REQUEST_FAILED',
                failureStage:'recovery_create',dataParcTag:task.dataParcTag,cycleSnapshot:{...task.snapshot},message:error.message}]};
            delete resolved.boundaryCreateUnconfirmed;
            io.runtimeCheckpoint?.(resolved);
            return executeDataParcBatch(resolved.tasks,{...io,runtimeResume:resolved,allowBoundaryRecovery:false});
          }
        }
      }
      const item = reply?.item, probe = item?.probe;
      if (reply?.ok === true && reply.found === true && reply.failureRequestId === task.boundaryFailureRequestId &&
          item?.id && item.requestType === 'blower_runtime_probe' && probe?.requestId === item.id &&
          probe.assetTag === task.snapshot.tagNumber && probe.dataParcTag === task.dataParcTag &&
          time(probe.startAt) === time(task.startAt) && probe.runtimeRecovery?.mode === 'append_boundary_full') {
        const restored = {...resume,tasks:resume.tasks.map(row => row.snapshot.tagNumber === task.snapshot.tagNumber ? task : row),
          createdBatch:{...resume.createdBatch,results:resume.createdBatch.results.map(row => row.assetTag === task.snapshot.tagNumber
            ? {ok:true,assetTag:row.assetTag,recoveryMode:task.recoveryMode,item} : row)},
          outcomes:(resume.outcomes || []).filter(row => row.tagNumber !== task.snapshot.tagNumber)};
        delete restored.boundaryCreateUnconfirmed;
        io.runtimeCheckpoint?.(restored);
        return executeDataParcBatch(restored.tasks,{...io,runtimeResume:restored,allowBoundaryRecovery:false});
      }
      // A missing GET result does not prove the earlier POST failed. Keep the
      // receipt uncertainty and only repeat this read; never create a new full
      // request or pretend the original delta was the accepted full request.
      io.runtimeCheckpoint?.(resume);
      return resume.tasks.map(row => row.snapshot.tagNumber === task.snapshot.tagNumber
        ? {tagNumber:task.snapshot.tagNumber,displayName:task.asset?.displayName || task.snapshot.tagNumber,
          status:'waiting',requestId:'',recoveryMode:'append_boundary_full',errorCode:cause?.code || 'CREATE_RESULT_UNCONFIRMED',
          failureStage:'recovery_create',dataParcTag:task.dataParcTag,cycleSnapshot:{...task.snapshot},
          message:cause?.message || '전체 구간 복구 요청 접수 확인 대기 · 새 요청 없이 서버 접수 결과만 확인합니다.'}
        : (resume.outcomes || []).find(outcome => outcome.tagNumber === row.snapshot.tagNumber) || {
          tagNumber:row.snapshot.tagNumber,displayName:row.asset?.displayName || row.snapshot.tagNumber,status:'waiting',
          message:'앞선 조회 결과 확인 대기'});
    }
    const source = (resume?.tasks || tasks || []).filter(task => task?.snapshot?.tagNumber);
    if (!source.length) return [];
    const currentFor = task => io.currentAssetFor ? io.currentAssetFor(task.snapshot.tagNumber)
      : task.asset?.dataParcRuntimeBasis ? task.asset : undefined;
    const resultContext = (task,item = {},cause = null,failureStage = '') => ({
      requestId: String(item.id || ''), dataParcTag: task.dataParcTag,
      cycleSnapshot: {...task.snapshot}, recoveryMode: task.recoveryMode || null,
      startAt: String(item.probe?.startAt || task.queryStartAt || task.startAt || ''),
      endAt: String(item.probe?.endAt || cause?.boundaryRecovery?.endAt || task.endAt || ''),
      completedAt: String(item.completedAt || ''),
      ...(cause ? {errorCode:String(cause.code || 'REQUEST_FAILED'),failureStage} : {})
    });
    const acceptedIdFor = task => String(resume?.createdBatch?.results?.find(row => row.assetTag === task.snapshot.tagNumber)?.item?.id || '');
    for (const task of source) {
      const repair = runtimeRecoveryMarker(task);
      const accepted = resume?.createdBatch?.results?.find(row => row.assetTag === task.snapshot.tagNumber);
      if (repair && !validRuntimeRecoveryTask(task) ||
          resume && resume.runtimeRecoveryVersion !== undefined && resume.runtimeRecoveryVersion !== 1 ||
          resume && repair && (resume.runtimeRecoveryVersion !== 1 || accepted?.recoveryMode !== task.recoveryMode) ||
          resume && !repair && accepted?.recoveryMode !== undefined && accepted.recoveryMode !== null ||
          resume?.runtimeRecoveryVersion === 1 && accepted?.recoveryMode === undefined) {
        throw error('접수된 누적 보완 조회의 종류 또는 근거가 변경됐습니다. 일반 조회로 전환하지 않았습니다.', 'BLOWER_RUNTIME_RECOVERY_INVALID');
      }
    }
    const partialTags = new Set(source.filter(task => {
      const current = currentFor(task);
      if (runtimeRecoveryMarker(task)) return !recognizedRuntimeRecovery(task, current, acceptedIdFor(task));
      return (task.partialRange === true || task.asset?.dataParcRuntimeBasis?.coverageComplete === false ||
        current?.dataParcRuntimeBasis?.coverageComplete === false || task.asset?.cycleSourceReview || current?.cycleSourceReview) &&
        !recognizedPartialAppend(task, current, acceptedIdFor(task)) && !recognizedFreshRange(task, current, acceptedIdFor(task));
    }).map(task => task.snapshot.tagNumber));
    if (!resume && partialTags.size) {
      const recoveryChanged = source.some(task => runtimeRecoveryMarker(task) && partialTags.has(task.snapshot.tagNumber));
      throw error(recoveryChanged ? '누적 보완 조회의 현재 근거 또는 저장값이 변경됐습니다. 기존 값을 유지합니다.'
        : '일부 기간 RUN 누적 · 교체 기준 확인 필요 · 기존 조회값을 유지합니다.',
      recoveryChanged ? 'BLOWER_RUNTIME_RECOVERY_CHANGED' : 'BLOWER_CYCLE_COVERAGE_INCOMPLETE');
    }
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
      const recovery = source.some(task => task.snapshot.tagNumber === tag && runtimeRecoveryMarker(task));
      const requestShapeValid = created?.upToDate === true || (
        item?.requestType === 'blower_runtime_probe' &&
        String(item?.probe?.assetTag || '') === tag &&
        String(item?.probe?.requestId || '') === requestId
      );
      if (!tag || !sourceTags.includes(tag) || createdByTag.has(tag) || created?.ok !== true ||
          (recovery && created?.upToDate === true) ||
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
    for (const task of source) {
      if (partialTags.has(task.snapshot.tagNumber)) resultByTag.set(task.snapshot.tagNumber, {
        tagNumber: task.snapshot.tagNumber, displayName: task.asset?.displayName || task.snapshot.tagNumber,
        status: 'skipped', message: runtimeRecoveryMarker(task)
          ? '누적 보완 조회의 현재 근거 변경 · 이전 요청 자동 반영 보류 · 기존 값 유지'
          : '일부 기간 RUN 누적 · 교체 기준 확인 필요 · 이전 요청 자동 반영 보류 · 기존 값 유지'
      });
    }
    let boundaryCheckpoint = null;
    let boundaryCreateUnconfirmed = null;
    const saveCheckpoint = () => {
      let value = { version: 1, runtimeRecoveryVersion: 1,
      tasks: source.map(task => ({ ...task, asset: { tagNumber: task.snapshot.tagNumber,
        displayName: task.asset?.displayName || task.snapshot.tagNumber } })),
      createdBatch: { ok: true, atomic: true, batchVersion: 1, requestedCount: source.length,
        results: batchResults.map(row => row.upToDate === true ? { ok: true, assetTag: row.assetTag, upToDate: true, message: row.message,
          recoveryMode: source.find(task => task.snapshot.tagNumber === row.assetTag)?.recoveryMode || null } : {
          ok: true, assetTag: row.assetTag, recoveryMode: source.find(task => task.snapshot.tagNumber === row.assetTag)?.recoveryMode || null,
          item: { id: row.item.id, status: row.item.status,
            requestType: 'blower_runtime_probe', probe: { assetTag: row.assetTag, requestId: row.item.id,
              dataParcTag:row.item.probe?.dataParcTag,startAt:row.item.probe?.startAt,endAt:row.item.probe?.endAt } }
        }) }, outcomes: [...resultByTag.values()].filter(item => ['complete', 'failed'].includes(item.status)) };
      // The full-range fallback replaces only its failed predecessor in the
      // same durable browser checkpoint. Other accepted IDs/results survive a
      // timeout or reload; the failed append is never recreated or re-applied.
      if (boundaryCheckpoint) {
        const tags = new Set(boundaryCheckpoint.tasks.map(task => task.snapshot.tagNumber));
        value = {...value,tasks:value.tasks.map(task => boundaryCheckpoint.tasks.find(next => next.snapshot.tagNumber === task.snapshot.tagNumber) || task),
          createdBatch:{...value.createdBatch,results:value.createdBatch.results.map(row =>
            boundaryCheckpoint.createdBatch.results.find(next => next.assetTag === row.assetTag) || row)},
          outcomes:[...value.outcomes.filter(item => !tags.has(item.tagNumber)),...boundaryCheckpoint.outcomes]};
      }
      if (boundaryCreateUnconfirmed) value.boundaryCreateUnconfirmed = boundaryCreateUnconfirmed;
      io.runtimeCheckpoint?.(value);
    };
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
            ...resultContext(task,{...entry.item,...request},{code:request?.errorCode || 'AGENT_QUERY_FAILED'},'query'),
            message: request?.errorMessage || '회사 PC DataPARC 조회에 실패했습니다.' };
        }
        if (request.status !== 'complete') {
          return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber,
            ...resultContext(task,{...entry.item,...request},waitError,'query'), status: 'waiting', message: waitError
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
          const recovery = runtimeRecoveryMarker(task);
          if (recovery && !recognizedRuntimeRecovery(task, currentFor(task), String(entry.item.id))) {
            return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber, status: 'skipped',
              recoveryMode: task.recoveryMode, message: '누적 보완 조회 중 근거 또는 저장값 변경 · 기존 값 유지' };
          }
          if (task.replacementAutoRange === true && !recognizedFreshRange(task, currentFor(task), String(entry.item.id))) {
            return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber, status: 'skipped',
              message: '확인 구간 조회 중 저장 기준 변경 · 기존 값 유지' };
          }
          const partialCurrent = task.partialRange === true ? currentFor(task) : undefined;
          if (task.partialRange === true && !recognizedPartialAppend(task, partialCurrent, String(entry.item.id))) {
            return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber, status: 'skipped',
              message: '이어조회 중 저장 기준 변경 · 기존 일부 기간 누적 유지' };
          }
          const applied = await io.api({ method: 'POST', timeoutMs: 30000, body: {
            action: task.recoveryMode === 'role_priority' ? 'apply_role_priority_runtime_recovery'
              : task.recoveryMode === 'completion_window_zero' ? 'apply_completion_window_runtime_recovery' : 'dataparc_runtime_sync',
            requestId: entry.item.id,
            ...(task.recoveryMode === 'confirmed_gap' ? { confirmedGapRecovery: true } : {}),
            ...(task.recoveryMode === 'seal_first_run' ? { requireFirstRunStart: true } : {}),
            ...(task.recoveryMode === 'seal_registered_range' ? { registeredRangeRecovery: true } : {}),
            ...(task.recoveryMode === 'append_boundary_full' ? { appendBoundaryRecovery: true } : {})
          } });
          if (recovery) {
            io.assertWritable?.();
            if (applied?.ok !== true || applied.requestId !== entry.item.id ||
                String(applied.assetTag || applied.tagNumber || '') !== s.tagNumber ||
                (applied.applied !== true && applied.replayed !== true) || applied.incremental === true ||
                (task.recoveryMode === 'append_boundary_full' && applied.appendBoundaryRecovery !== true) ||
                typeof applied.runtimeHours !== 'number' || !Number.isFinite(applied.runtimeHours) || applied.runtimeHours < 0 ||
                !Number.isFinite(time(applied.observedAt)) || time(applied.observedAt) < time(task.recoveryProof.dataParcRuntimeBasis.observedAt) ||
                (task.recoveryMode === 'role_priority'
                  ? applied.rolePriorityRecovery !== true || time(applied.selectedCompletionAt) !== time(task.startAt)
                  : task.recoveryMode === 'completion_window_zero'
                    ? applied.completionWindowRecovery !== true || applied.certificateOnly !== true ||
                      time(applied.verifiedWindowStartAt) !== time(task.startAt) || time(applied.verifiedWindowEndAt) !== time(task.endAt) ||
                      applied.dataParcTag !== task.dataParcTag || Math.abs(applied.runtimeHours-task.recoveryProof.dataParcRuntimeBasis.runtimeHours)>0.000001 ||
                      time(applied.observedAt)!==time(task.recoveryProof.dataParcRuntimeBasis.observedAt)
                    : applied.dataParcTag !== task.dataParcTag)) {
              throw error('누적 보완 결과의 저장 응답을 확인하지 못했습니다. 같은 요청 ID로만 다시 확인합니다.', 'BLOWER_RUNTIME_RECOVERY_APPLY_UNCONFIRMED');
            }
          }
          appliedCount += 1;
          io.progress?.(`조회 결과 저장 중 · ${appliedCount}/${pending.length}`);
          if (recovery) return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber,
            ...resultContext(task,{...entry.item,...request}),
            status: 'complete', recoveryMode: task.recoveryMode, recoveryApplied: applied.applied === true,
            ...(applied.replayed === true ? { unchanged: true } : {}),
            message: applied.replayed === true ? '이미 보완된 결과 확인 · 현재 값 유지'
              : task.recoveryMode === 'role_priority' ? '선택 교체 기준과 누적시간 보완 완료'
              : task.recoveryMode === 'confirmed_gap' ? '앞 구간을 포함한 누적시간 보완 완료'
              : task.recoveryMode === 'completion_window_zero' ? '교체 작업 구간 정지 검증 완료 · 누적값 유지 · 완료시각 미기록'
              : task.recoveryMode === 'seal_registered_range' ? '등록 기준부터 전체 운전시간 보완 완료 · 최초 기동시각 미확정'
              : task.recoveryMode === 'append_boundary_full' ? '이어조회 경계 불일치 복구 완료 · 저장된 기준부터 전체 운전시간 재검증'
              : '최초 기동과 앞 구간 확인 완료' };
          const reviewStatus = task.partialRange === true ? partialAppendResultStatus(task, partialCurrent) : null;
          return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber, status: 'complete',
            ...resultContext(task,{...entry.item,...request}),
            ...(task.partialRange === true ? { partialRange: true, runReviewStatus: reviewStatus } : {}),
            message: task.replacementAutoRange === true ? '확인 구간 RUN 조회 완료 · 교체 기록 이후 확인된 RUN'
              : task.replacementAutoFresh === true ? '새 교체 기준 RUN 조회 완료'
              : reviewStatus ? `RUN 이어조회 완료 · ${reviewStatus.label}`
              : task.registeredRuntimeRange === true ? '확인 구간 이어조회 완료 · RUN 조회기준 유지'
              : task.partialTracking === true ? '확인 구간 RUN 이어조회 완료 · 교체 기록 이후 확인된 RUN'
              : applied.message || '증분 운전시간 반영 완료' };
        } catch (cause) {
          if ([401, 403].includes(Number(cause?.status)) || cause?.code === 'WRITE_ACCESS_CHANGED') throw cause;
          const uncertain = [0, 429, 502, 503, 504].includes(Number(cause?.status || 0));
          return { tagNumber: s.tagNumber, displayName: task.asset.displayName || s.tagNumber,
            ...resultContext(task,{...entry.item,...request},cause,'apply'), status: uncertain ? 'waiting' : 'failed',
            ...(cause?.code === 'DATAPARC_APPEND_BOUNDARY_CHANGED' && cause.boundaryRecovery
              ? {boundaryRecovery:cause.boundaryRecovery} : {}),
            message: uncertain ? '조회 결과 저장 확인 대기 · 같은 요청으로 재확인 가능' : cause?.message || '조회 결과 저장 실패 · 기존 값 유지' };
        }
      })));
      for (const item of applyResults) resultByTag.set(item.tagNumber, item);
    }

    if (io.allowBoundaryRecovery !== false && ![...resultByTag.values()].some(item => item.status === 'waiting')) {
      const failed = resultByTag.get('204SDF01AN002');
      const original = source.find(task => task.snapshot.tagNumber === '204SDF01AN002');
      const current = original && currentFor(original), proof = failed?.boundaryRecovery;
      if (failed?.status === 'failed' && failed.errorCode === 'DATAPARC_APPEND_BOUNDARY_CHANGED' &&
          original?.kind === 'dataparc' && original.incremental === true && !runtimeRecoveryMarker(original) &&
          sameCycle(original.snapshot,current) && proof?.version === 1 && proof.eligible === true &&
          proof.requestId === failed.requestId && proof.assetTag === original.snapshot.tagNumber &&
          proof.dataParcTag === original.dataParcTag && time(proof.startAt) === time(current.dataParcRuntimeBasis?.startAt)) {
        const task = {kind:'dataparc_repair',asset:current,snapshot:snapshot(current),recoveryMode:'append_boundary_full',
          recoveryVersion:1,recoveryProof:runtimeRecoverySnapshot(current),recoveryPlannedAt:proof.endAt,
          startAt:proof.startAt,queryStartAt:proof.startAt,dataParcTag:proof.dataParcTag,incremental:false,
          boundaryFailureRequestId:failed.requestId,boundaryFailureEndAt:proof.endAt};
        if (validRuntimeRecoveryTask(task)) {
          io.progress?.('유기성 2호기 B · 이어조회 경계 불일치 · 전체 운전시간 재검증 중');
          try {
            const recovered = await executeDataParcBatch([task],{...io,runtimeResume:null,allowBoundaryRecovery:false,
              runtimeCheckpoint(value) { if (value) {boundaryCheckpoint=value;saveCheckpoint();} }
            });
            if (recovered[0]) resultByTag.set(task.snapshot.tagNumber,recovered[0]);
          } catch (cause) {
            if ([401,403].includes(Number(cause?.status)) || cause?.code === 'WRITE_ACCESS_CHANGED') throw cause;
            if (cause?.code === 'CREATE_RESULT_UNCONFIRMED') {
              boundaryCreateUnconfirmed = {version:1,task};
              resultByTag.set(task.snapshot.tagNumber,{...failed,status:'waiting',requestId:'',
                errorCode:cause.code,failureStage:'recovery_create',recoveryMode:'append_boundary_full',
                message:'전체 구간 복구 요청 접수 확인 대기 · 새 요청 없이 서버 접수 결과만 확인합니다.'});
            } else {
            resultByTag.set(task.snapshot.tagNumber,{...failed,errorCode:cause?.code || failed.errorCode,
              failureStage:'recovery_create',recoveryMode:'append_boundary_full',
              message:cause?.message || '전체 구간 복구 요청을 확인하지 못했습니다. 기존 누적값은 유지합니다.'});
            }
          }
        }
      }
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
  // Preserve only the already-sanitized public error fields. Never retain a
  // request, payload, headers, token, raw response body or nested cause here.
  function logContinuationFailure(e) {
    const boundedText = (value, maximum) => typeof value === 'string'
      ? value.replace(/[\u0000-\u001f]/g, ' ').slice(0, maximum) : '';
    const status = Number(e?.status || 0);
    const failure = { message: boundedText(e?.message, 700) || '연결 오류',
      status: Number.isInteger(status) && status >= 0 && status <= 599 ? status : 0,
      code: boundedText(e?.code, 120), cfRay: boundedText(e?.cfRay, 100),
      cloudflareCode: boundedText(e?.cloudflareCode, 16), responseKind: boundedText(e?.responseKind, 16) };
    return { ...failure, label: errorLabel(failure) };
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
    const replacementV3 = options.replacementAutoVersion === 3;
    const normalizationV4 = replacementV3 && options.normalizationVersion === 4;
    const candidateResume = (!replacementV3 || options.resume?.replacementAutoVersion === 3) &&
      (!normalizationV4 || options.resume?.normalizationVersion === 4) ? options.resume : null;
    const initial = replacementV3 && candidateResume?.phase === 'operation' && candidateResume.replacementComplete !== true ? null : candidateResume;
    let phase = initial?.phase === 'operation' ? 'operation' : 'replacement';
    let replacementComplete = replacementV3 && initial?.replacementComplete === true && phase === 'operation';
    let window = initial?.window || null, cursor = initial?.cursor || null;
    const maxLimit = Math.max(1, Math.min(8, Number(options.pageLimit) || 8));
    let limit = Math.max(1, Math.min(maxLimit, Number(initial?.limit || Math.min(4, maxLimit))));
    const replacementCounts = ['autoAppliedReplacementCount','autoCorrectedReplacementCount','autoRetractedReplacementCount','autoHistoricalReplacementCount','autoLinkedReplacementCount','autoConfirmedReplacementCount'];
    const totals = { scannedReplacementLogs: 0, scannedOperationLogs: 0, insertedCount: 0, appliedStateChanges: 0,
      ...(replacementV3 ? Object.fromEntries(replacementCounts.map(key => [key, 0])) : {}), ...initial?.totals };
    let pages = 0;
    const clock = options.clock || Date.now;
    const deadline = Number.isFinite(options.timeBudgetMs) ? clock() + Math.max(1, options.timeBudgetMs) : Infinity;
    const maxPages = Math.max(1, Math.min(20000, Number(options.maxPages) || 20000));
    const pause = () => {
      const e = error(`업무일지 확인을 나누어 진행합니다 · 교체 기록 ${totals.scannedReplacementLogs}건 · 운전 기록 ${totals.scannedOperationLogs}건 확인 · 남은 기록은 다음 조회에서 이어서 확인`, 'LOG_REFRESH_PAUSED');
      e.retryable = false; e.logTotals = { ...totals }; e.logPhase = phase; e.replacementComplete = replacementComplete; throw e;
    };
    const remaining = () => Math.max(0, deadline - clock());
    const report = () => io.logProgress?.({ phase, ...totals });
    const checkpoint = () => io.checkpoint?.({ phase, window, cursor, limit, totals: { ...totals },
      ...(replacementV3 ? { replacementAutoVersion: 3, replacementComplete } : {}),
      ...(normalizationV4 ? { normalizationVersion: 4 } : {}) });
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
              ...(replacementV3 && phase === 'replacement' ? { replacementAutoVersion: 3 } : {}),
              ...(normalizationV4 && phase === 'replacement' ? { normalizationVersion: 4 } : {}),
              autoApplyConfirmedReplacements: phase === 'replacement' } });
          break;
        } catch (e) {
          if (!transient(e) || retry >= 4) {
            e.message = `${position}에서 중단 · ${e.message || '요청 실패'}`;
            if (replacementV3) {
              e.logPhase = phase; e.replacementComplete = replacementComplete; e.logTotals = { ...totals };
            }
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
          (replacementV3 && phase === 'replacement' && payload.replacementAutoVersion !== 3) ||
          (normalizationV4 && phase === 'replacement' && payload.normalizationVersion !== 4) ||
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
      if (replacementV3 && phase === 'replacement') for (const key of replacementCounts) totals[key] += Math.max(0, Number(payload[key]) || 0);
      report();
      io.progress?.(`${label} · ${totals[countKey]}건 확인`);
      if (payload.done) {
        if (phase === 'operation') { io.checkpoint?.(null); return totals; }
        replacementComplete = true; phase = 'operation'; cursor = null;
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
    const replacementV3 = options.replacementAutoVersion === 3;
    if (replacementV3 && options.autoContinue === true) return continueReplacementLogs(io, options);
    const defaults = replacementV3 ? { timeBudgetMs: 120000, maxPages: 200, pageLimit: 2 } : { timeBudgetMs: 45000, maxPages: 80, pageLimit: 1 };
    try { return { complete: true, totals: await measurePhase('workLogs', {}, () => refreshLogs(io, { ...defaults, ...options })), warning: '',
      ...(replacementV3 ? { replacementComplete: true, runtimeAllowed: true } : {}) }; }
    catch (e) {
      if (e?.code !== 'LOG_REFRESH_PAUSED' && !transient(e)) throw e;
      io.assertWritable?.();
      const warning = errorLabel(e);
      const runtimeAllowed = !replacementV3 || e.replacementComplete === true;
      io.progress?.(runtimeAllowed ? `업무일지 확인 미완료 · ${warning} · 저장된 교체 기준으로 운전시간 조회 계속`
        : `교체 기록 확인 미완료 · ${warning} · RUN 조회 보류 · 교체 이력은 다시 확인할 수 있습니다.`);
      return { complete: false, totals: e.logTotals || null, warning,
        ...(replacementV3 ? { replacementComplete: e.replacementComplete === true, runtimeAllowed } : {}),
        ...(options._continuationDetails ? { continuationCode: e.code || 'TRANSIENT_LOG_PAGE_FAILED',
          continuationTransient: transient(e),
          continuationFailure: e.code === 'LOG_REFRESH_PAUSED' ? null : logContinuationFailure(e) } : {}) };
    }
  }

  async function continueReplacementLogs(io, options) {
    const clock = options.clock || Date.now;
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const bounded = (value, fallback, maximum) => Number.isFinite(Number(value))
      ? Math.max(1, Math.min(maximum, Math.floor(Number(value)))) : fallback;
    const deadline = clock() + bounded(options.totalTimeBudgetMs, 600000, 600000);
    const maximumChunks = bounded(options.maxContinuationChunks, 12, 12);
    const maximumStrikes = bounded(options.maxContinuationStrikes, 3, 3);
    const sliceBudget = bounded(options.timeBudgetMs, 120000, 120000);
    let checkpoint = options.resume || null, chunks = 0, strikes = 0, last = null, lastFailure = null;
    const sourceCount = value => Math.max(0, Number(value?.totals?.scannedReplacementLogs) || 0);
    const stop = reason => {
      const { continuationCode, continuationTransient, continuationFailure, ...result } = last || { totals: checkpoint?.totals || null };
      const completedDate = /^\d{4}-\d\d-\d\d$/.test(String(checkpoint?.cursor?.workDate || ''))
        ? checkpoint.cursor.workDate : '';
      const position = { phase: 'replacement', processedSourceCount: sourceCount(checkpoint),
        lastCompletedWorkDate: completedDate, pageLimit: Math.max(1, Math.min(8, Number(checkpoint?.limit) || 2)) };
      const cause = lastFailure ? ` · 마지막 오류: ${lastFailure.label}${completedDate ? ` · 마지막 완료 업무일지 ${completedDate}` : ''} · 누적 확인 ${position.processedSourceCount}건 · 요청당 ${position.pageLimit}건` : '';
      return { ...result, complete: false, replacementComplete: false, runtimeAllowed: false,
        warning: `교체 원문 자동 이어처리 ${reason} · 완료된 처리 위치는 보존했습니다. RUN 조회는 시작하지 않았습니다.${cause}`,
        automaticContinuation: { chunks, strikes, stopped: reason,
          ...(lastFailure ? { lastFailure: { ...lastFailure, ...position } } : {}) } };
    };
    while (chunks < maximumChunks) {
      io.assertWritable?.();
      const remaining = deadline - clock();
      if (remaining <= 0) return stop('시간 한도 도달');
      const before = options.normalizationVersion === 4 && checkpoint?.normalizationVersion !== 4 ? 0 : sourceCount(checkpoint);
      const passIo = { ...io, checkpoint: value => { checkpoint = value; io.checkpoint?.(value); } };
      chunks += 1;
      // The existing pass owns retries, receipts and the captured source window.
      // No failed page is skipped and no runtime request is created here.
      last = await refreshLogsForRuntime(passIo, { ...options, autoContinue: false, _continuationDetails: true,
        resume: checkpoint, timeBudgetMs: Math.max(1, Math.min(sliceBudget, remaining)) });
      if (last.continuationFailure) lastFailure = last.continuationFailure;
      if (last.complete || last.runtimeAllowed === true) {
        const { continuationCode, continuationTransient, continuationFailure, ...result } = last;
        return { ...result, automaticContinuation: { chunks, strikes, stopped: '' } };
      }
      const progressed = sourceCount(checkpoint) > before;
      const naturalPause = last.continuationCode === 'LOG_REFRESH_PAUSED';
      if (!naturalPause && last.continuationTransient !== true) return stop('원문 오류 확인 필요');
      strikes = naturalPause && progressed ? 0 : strikes + 1;
      if (strikes >= maximumStrikes) return stop('연속 재시도 한도 도달');
      if (chunks >= maximumChunks) return stop('처리 단위 한도 도달');
      io.progress?.(`교체 원문 자동 이어서 확인 중 · ${sourceCount(checkpoint)}건 처리 · RUN 요청 전`);
      const delay = naturalPause && progressed ? 20 : Math.min(10000, 1000 * 2 ** Math.max(0, strikes - 1));
      const wait = Math.min(delay, Math.max(0, deadline - clock()));
      if (wait > 0) await sleep(wait);
    }
    return stop('처리 단위 한도 도달');
  }

  return { fbheSealRunAsset, fbheSealRunView, freshReplacementQuery, replacementRangeTracking, rolePriorityReview, runReviewStatus, verifiedCompletionWindow, verifiedLimestone2aFirstRun, verifiedLimestone1bFirstRun, verifiedFbhe1bStandby, verifiedFbhe2cStandby, verifiedFbhe1aRuntime,
    runtimeRecoveryPlan, recognizedRuntimeRecovery, plan, intermittent, snapshot, sameCycle, day, waitRequests, executeDataParc, executeDataParcBatch, executeOis, oisBody,
    refreshLogs, refreshLogsForRuntime, readWithRetry, errorLabel,
    register(kind, fn) { if (!['fbhe','seal_pot'].includes(kind) || typeof fn !== 'function') throw new Error('Invalid OIS bridge'); bridges[kind] = fn; } };
});
