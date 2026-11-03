/* Two historical import errors established by approved source logs, not inferred
 * replacement dates. They remain in the audit trail. This projection separates
 * a valid measured RUN range from an unverified physical belt-cycle boundary.
 * Recognition fixes prevent recurrence; this catalog never resets a counter,
 * changes an event, supplies a replacement instant, or authorizes new queries.
 */
export const REVIEWED_CYCLE_SOURCE_CASES = Object.freeze([
  Object.freeze({
    tagNumber: '104ETH03AN602', replacementEventId: 'v13:104ETH03AN602|2026-05-04',
    recordedReplacementAt: '2026-05-04T00:00:00+09:00', sourceType: 'shift_log_history_v13',
    sourceLogId: '38159',
    storedSourceText: 'Fly Ash Silo Aeration Blower는 추후 Belt 교체 후 #B 기동 요망 → 1층 주방용 환기팬 Belt 교체 완료_TM 작업',
    originalDiaryId: 'POCHEON#20260504#DAY#BCO1', originalBodyIndex: 2,
    message: '5/4 승인 일지는 Silo #B 벨트 교체 미실시를 명시합니다. 다른 환기팬의 완료 기록이 연결돼 교체 기준 확인이 필요합니다.'
  }),
  Object.freeze({
    tagNumber: '204HHL60AP621', replacementEventId: '471d302e-a2af-42e7-8ebb-32cbb9d9d55d',
    recordedReplacementAt: '2026-09-16T09:23:00+09:00', sourceType: 'shift_log_auto',
    sourceLogId: 'legacy-POCHEON#20260916#DAY#BO2',
    storedSourceText: 'V-Belt 교체 및 Alignment 교정 실시 후 차단기 투입 (Stand by 상태)',
    originalDiaryId: 'POCHEON#20260916#DAY#BO2', originalBodyIndex: 2,
    message: '9/16 승인 일지는 #C 벨트 교체와 #B 기동을 기록합니다. #B의 벨트 교체로 잘못 연결돼 교체 기준 확인이 필요합니다.'
  })
]);
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
export function reviewedCycleSourceWarning(asset, events) {
  if (!asset || !Array.isArray(events)) return null;
  const replacement = instant(asset.last_replacement_at);
  if (!Number.isFinite(replacement)) return null;
  const rows = events.filter(row => row?.tag_number === asset.tag_number && row.event_type === 'replacement' &&
    Number.isFinite(instant(row.event_date))).sort((a,b) => instant(b.event_date)-instant(a.event_date) ||
      String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id || '').localeCompare(String(a.id || '')));
  const current = rows[0];
  if (!current || instant(current.event_date) !== replacement) return null;
  const reviewed = REVIEWED_CYCLE_SOURCE_CASES.find(item => item.tagNumber === asset.tag_number &&
    item.replacementEventId === current.id && instant(item.recordedReplacementAt) === replacement &&
    item.sourceType === current.source_type && item.sourceLogId === current.source_log_id &&
    item.storedSourceText === current.source_text);
  if (!reviewed) return null;
  return { code: 'REVIEWED_REPLACEMENT_SOURCE_MISATTRIBUTED',
    message: reviewed.message, replacementEventId: current.id,
    recordedReplacementAt: current.event_date, sourceLogId: reviewed.sourceLogId,
    originalDiaryId: reviewed.originalDiaryId, originalBodyIndex: reviewed.originalBodyIndex,
    cycleBasisConfirmed: false, measuredRangeMayContinue: true };
}
