/**
 * GS SHIFT LOG / BLOWER R6
 * Fail-closed, read-only proof evaluator for a proposed cumulative RUN rebaseline.
 * It DOES NOT write to D1, call DataPARC, enqueue jobs, or authorize any change.
 * The production integration must independently validate raw OIS payloads,
 * authenticated request ownership, saved snapshot, revision, and DB atomicity.
 *
 * The existing Agent supplies per-chunk states and totals, not per-sample GOOD flags.
 * `contractValidated` means the server has revalidated the existing Agent wire
 * contract and rejected any explicit quality-failure flags. It does NOT claim
 * that absent GOOD-quality metadata was observed. Manual review remains required.
 * Required proof: two independently executed, identical-window full RUN reads,
 * one prefix RUN read and one suffix RUN read, all from the approved signal.
 * Prefix/suffix must meet at the historical append boundary and recompose to
 * both full reads. Never treat a same-request retry or cached response as
 * an independent measurement.
 */

export const R6_TARGET = Object.freeze({
  tag: '204SDF01AN002',
  signal: 'GSPOGE.ABB_DCS.204SDF01AN002XB04',
});

const FAIL = (code, message, details = {}) => ({
  status: 'blocked', code, message, ...details,
});
const isSeconds = value => Number.isSafeInteger(value) && value >= 0;
const isNonempty = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const isoEq = (a, b) => Number.isFinite(instant(a)) && instant(a) === instant(b);
const isState = value => ['running', 'stopped'].includes(value);
const goodAuditId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const reasonableSpan = (a, b) => Number.isFinite(instant(a)) && Number.isFinite(instant(b)) && instant(b) > instant(a);

/**
 * Each read must first be normalized by the authenticated server from its
 * *raw result*, not from a browser-supplied object. Do not use this check as
 * a substitute for normalizing the OIS probe result in production.
 */
function validateRead(read, name, begin, end, baseline) {
  if (!read || typeof read !== 'object' || !isNonempty(read.requestId) ||
      read.requestType !== 'blower_runtime_probe' || read.status !== 'complete' ||
      read.tag !== R6_TARGET.tag || read.signal !== R6_TARGET.signal ||
      !isoEq(read.startAt, begin) || !isoEq(read.endAt, end) ||
      !isSeconds(read.runningSeconds) || !isState(read.startState) || !isState(read.endState) ||
      read.coverageComplete !== true || read.contractValidated !== true ||
      read.badQualitySeconds > 0 || read.missingSeconds > 0 ||
      read.estimatedSeconds > 0 ||
      read.fromCachedResult === true || read.fromManualOverride === true ||
      read.expectedRevision !== baseline.cycleRevision ||
      read.expectedReplacementAt !== baseline.lastReplacementAt ||
      read.requestedBy !== baseline.actorId || !isNonempty(read.requestedBy) ||
      !Number.isFinite(instant(read.requestCreatedAt)) || !Number.isFinite(instant(read.completedAt)) ||
      !isoEq(read.observedAt,read.endAt) || !Number.isFinite(instant(read.collectedAt)) ||
      instant(read.completedAt) <= instant(read.requestCreatedAt) ||
      instant(read.completedAt) < instant(read.endAt) ||
      instant(read.collectedAt) < instant(read.endAt) ||
      instant(read.collectedAt) > instant(read.completedAt) + 5*60*1000 ||
      !reasonableSpan(read.startAt,read.endAt) ||
      read.runningSeconds > Math.ceil((instant(read.endAt)-instant(read.startAt))/1000) + 2) {
    return FAIL('R6_READ_INVALID', `${name}: 요청 원본·기간·신호·품질·기준이 검증되지 않았습니다.`);
  }
  return null;
}

/**
 * Read-only proof evaluation. Returns a correction PROPOSAL, never a write.
 * `baseline` must come from a fresh authenticated server-side DB snapshot.
 * `reads` must come from fresh separately executed and server-normalized jobs.
 * `freshSnapshotSha256` must be re-read immediately before authorized commit.
 */
export function evaluateVerifiedRebaseline({baseline, reads, freshSnapshotSha256, maxSampleDifferenceSeconds = 2}) {
  if (!baseline || baseline.tag !== R6_TARGET.tag || baseline.signal !== R6_TARGET.signal ||
      !isNonempty(baseline.actorId) || !isNonempty(baseline.cycleRevision) ||
      !isNonempty(baseline.lastReplacementAt) || !isState(baseline.lastState) ||
      !isSeconds(baseline.savedSeconds) || !isSeconds(baseline.failedAppendSeconds) ||
      !reasonableSpan(baseline.startAt, baseline.cutoffAt) ||
      !reasonableSpan(baseline.cutoffAt, baseline.endAt) ||
      !goodAuditId(baseline.snapshotSha256) ||
      freshSnapshotSha256 !== baseline.snapshotSha256) {
    return FAIL('R6_BASE_INVALID', '기존 저장 기준 또는 이력 스냅샷이 변경되어 재기준화할 수 없습니다.');
  }
  if (maxSampleDifferenceSeconds !== 2) {
    return FAIL('R6_TOLERANCE_MODIFIED','독립 조회 비교 허용오차를 변경할 수 없습니다.');
  }
  const {fullA, fullB, prefix, suffix} = reads || {};
  for (const [name, read, begin, end] of [
    ['전체 조회 A',fullA,baseline.startAt,baseline.endAt],
    ['전체 조회 B',fullB,baseline.startAt,baseline.endAt],
    ['경계 이전',prefix,baseline.startAt,baseline.cutoffAt],
    ['경계 이후',suffix,baseline.cutoffAt,baseline.endAt],
  ]) {
    const error = validateRead(read,name,begin,end,baseline);
    if (error) return error;
  }
  const all = [fullA,fullB,prefix,suffix];
  if (new Set(all.map(read=>read.requestId)).size !== 4 ||
      new Set(all.map(read=>read.requestCreatedAt)).size !== 4 ||
      new Set(all.map(read=>read.collectedAt)).size !== 4 ||
      all.some((read,index)=>index>0 && (
        instant(read.requestCreatedAt) <= instant(all[index-1].completedAt) ||
        instant(read.collectedAt) <= instant(all[index-1].collectedAt)))) {
    return FAIL('R6_NOT_INDEPENDENT','서로 다른 요청 ID와 실행시각을 가진 네 번의 실측이 필요합니다.');
  }
  if (fullA.startState !== fullB.startState || fullA.endState !== fullB.endState ||
      fullA.startState !== prefix.startState || fullA.endState !== suffix.endState ||
      prefix.endState !== suffix.startState) {
    return FAIL('R6_STATE_CONFLICT','전체 조회·경계 구간의 RUN 상태가 서로 일치하지 않습니다.');
  }
  const fullDifference = fullB.runningSeconds - fullA.runningSeconds;
  const sum = prefix.runningSeconds + suffix.runningSeconds;
  if (!Number.isSafeInteger(sum) || Math.abs(fullDifference) > 2 ||
      Math.abs(sum-fullA.runningSeconds) > 2 || Math.abs(sum-fullB.runningSeconds) > 2) {
    return FAIL('R6_MEASUREMENT_CONFLICT','독립 전체 조회 또는 앞뒤 경계 구간 합계가 일치하지 않습니다.',{
      fullDifferenceSeconds:fullDifference,
      composedDifferenceSeconds:sum-fullA.runningSeconds,
    });
  }
  if (suffix.runningSeconds < baseline.failedAppendSeconds - 2) {
    return FAIL('R6_DELTA_CONFLICT','경계 이후 측정이 기존 이후 구간보다 작아 원인 확인이 필요합니다.');
  }
  const expectedOld = baseline.savedSeconds + baseline.failedAppendSeconds;
  if (!Number.isSafeInteger(expectedOld)) return FAIL('R6_OVERFLOW','누적시간 계산 범위를 초과했습니다.');
  const proposedSeconds = fullA.runningSeconds;
  const historicalDifferenceSeconds = prefix.runningSeconds - baseline.savedSeconds;
  const suffixDifferenceSeconds = suffix.runningSeconds - baseline.failedAppendSeconds;
  const totalDifferenceSeconds = proposedSeconds - expectedOld;
  if (Math.abs(totalDifferenceSeconds) <= 2) {
    return {status:'no_correction_needed',code:'R6_WITHIN_EXISTING_TOLERANCE',
      proposedSeconds, expectedOldSeconds:expectedOld, totalDifferenceSeconds};
  }
  return {
    status:'requires_authorized_review', code:'R6_EVIDENCE_AGREES',
    tag:R6_TARGET.tag, signal:R6_TARGET.signal,
    baselineRevision:baseline.cycleRevision, snapshotSha256:baseline.snapshotSha256,
    startAt:baseline.startAt, cutoffAt:baseline.cutoffAt, endAt:baseline.endAt,
    previousSeconds:baseline.savedSeconds, appendSeconds:baseline.failedAppendSeconds,
    expectedOldSeconds:expectedOld, proposedSeconds,
    totalDifferenceSeconds, historicalDifferenceSeconds, suffixDifferenceSeconds,
    reconstructionDifferenceSeconds:sum-proposedSeconds,
    fullIndependentDifferenceSeconds:fullDifference,
    verifiedRequestIds: all.map(read=>read.requestId),
    // This output is NOT an authorization token. The server must verify every
    // immutable source receipt again in the same atomic guard as the write.
    authorizedToWrite:false,
  };
}
