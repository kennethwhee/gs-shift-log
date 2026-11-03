/* Author choices are source facts only after the ordinary diary approval.
 * Presence, even when stale/malformed, prevents falling back to text guesses. */
import { normalizeContent, normalizeAnnotation } from '../../maintenance/diary-vbelt-core-v1.js';

const COLLECTIONS = ['entries', 'tmEntries', 'handoverEntries', 'remarkEntries'];
const own = (value, key) => Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
const text = value => typeof value === 'string' ? value.trim() : '';
export const entryContent = entry => entry?.content || entry?.text || entry?.description || entry?.value || entry?.note || entry?.remark || entry?.remarks || '';
const entries = log => COLLECTIONS.flatMap(collectionName => Array.isArray(log?.[collectionName])
  ? log[collectionName].map((entry, index) => ({ entry, collectionName, index })).filter(item => item.entry && typeof item.entry === 'object' && !Array.isArray(item.entry)) : []);
function parseLog(row) {
  if (typeof row?.log_json !== 'string') return row || {};
  try { const log = JSON.parse(row.log_json); return log && typeof log === 'object' && !Array.isArray(log) ? log : {}; } catch { return {}; }
}
export function inspectVbeltAnnotations(row) {
  const log = parseLog(row);
  const sourceId = text(row?.id || log.id);
  const records = entries(log).filter(({entry}) => own(entry, 'vBeltReplacement')).map(({entry, collectionName, index}) => ({
    entryId: text(entry.id), content: normalizeContent(entryContent(entry)), collectionName, index,
    annotation: normalizeAnnotation(entry.vBeltReplacement, entryContent(entry)),
    copied: /previous-shift/i.test(text(entry.source)) || Boolean(text(entry.inheritedFromDate)) ||
      Boolean(text(entry.importedFromLogId) && text(entry.importedFromLogId) !== sourceId)
  }));
  return { records, hasAnnotations: records.length > 0,
    entryIds: [...new Set(records.map(record => record.entryId).filter(Boolean))] };
}
export function annotationControlsFragment(state, fragment) {
  const origin = fragment?.v3Origin || {};
  const id = text(origin.entryId), content = normalizeContent(origin.entryContent);
  const collection = text(origin.collectionName);
  return state.records.some(record => {
    // Secondary fields belong to their exact parent entry, even though the
    // legacy parser gives them a synthetic suffix in its fragment identity.
    const secondary = /^(?:entries|tmEntries|handoverEntries|remarkEntries)\.(note|remark|remarks)$/.exec(collection);
    if (secondary && record.entryId && id === `${record.entryId}-${secondary[1]}`) return true;
    // Top-level legacy note mirrors have no physical entry identity.
    if (/^(?:note|remark|remarks)$/.test(collection)) return record.content.length >= 8 && content.includes(record.content);
    if (id && record.entryId) return record.entryId === id;
    return Boolean(content && record.content === content);
  });
}
export function collectConfirmedVbeltFacts(row, assets, state = inspectVbeltAnnotations(row)) {
  const facts = new Map();
  for (const record of state.records) {
    const annotation = record.annotation;
    if (!record.entryId || record.copied || annotation?.confirmed !== true) continue;
    const mirrors = state.records.filter(other => other.entryId === record.entryId);
    // A stale or unchecked mirror must never be overridden by array order.
    if (mirrors.some(other => other.copied || other.annotation?.confirmed !== true ||
      JSON.stringify(other.annotation.targets) !== JSON.stringify(annotation.targets))) continue;
    for (const target of annotation.targets) {
      if (!assets.some(asset => text(asset.tag_number || asset.tagNumber).toUpperCase() === target.tagNumber && Number(asset.enabled ?? 1) === 1)) continue;
      const sourceKey = JSON.stringify([text(row.id), target.tagNumber, record.entryId, 'author-confirmed-v1']);
      facts.set(sourceKey, { tagNumber: target.tagNumber,
        eventDate: `${target.replacedOn}T${target.completedTime || '00:00'}:00+09:00`,
        recordDate: target.replacedOn, timePrecision: target.completedTime ? 'minute' : 'day',
        sourceText: record.content, sourceKey, sourceLogId: text(row.id), sourceEntryId: record.entryId,
        sourceRole: text(row.role), originalSourceClock: target.completedTime,
        candidateTexts: [record.content], sourceClockKind: target.completedTime ? 'author_completion' : 'none',
        precisionReason: target.completedTime ? '작성자가 확인한 교체 완료 시각' : '작성자가 교체 완료 날짜 확인 · 완료 시각 미기록' });
    }
  }
  return [...facts.values()];
}

/** Pure validation, then the caller retains its existing authorization/revision
 * rules. Existing controlled entries cannot accidentally revert to legacy mode
 * when an older client omits the property. No old unannotated entry is changed. */
export function normalizeDiaryVbeltAnnotations(log, previousLog = null) {
  const previous = inspectVbeltAnnotations(previousLog || {});
  const result = {...log};
  for (const collectionName of COLLECTIONS) {
    if (!Array.isArray(log?.[collectionName])) continue;
    result[collectionName] = log[collectionName].map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
      const content = normalizeContent(entryContent(entry));
      const previouslyControlled = text(entry.id) && previous.entryIds.includes(text(entry.id));
      if (!own(entry, 'vBeltReplacement') && !previouslyControlled) return entry;
      const annotation = own(entry, 'vBeltReplacement') ? normalizeAnnotation(entry.vBeltReplacement, entryContent(entry)) :
        (content ? {version: 1, confirmed: false, content, targets: []} : null);
      if (!annotation || !text(entry.id) || text(entry.id).length > 160) {
        const error = new Error('V-belt 교체 확인 내용이 본문과 다릅니다. 해당 항목의 교체 확인을 다시 선택해 주세요.');
        error.code = 'VBELT_CONFIRMATION_INVALID'; throw error;
      }
      return {...entry, vBeltReplacement: annotation};
    });
  }
  return result;
}

export async function validateDiaryVbeltTargets(database, log, now = new Date()) {
  const selected = inspectVbeltAnnotations(log).records.flatMap(record => record.annotation?.confirmed ? record.annotation.targets : []);
  const today = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  if (selected.some(target => target.replacedOn > today || (target.completedTime &&
      Date.parse(`${target.replacedOn}T${target.completedTime}:00+09:00`) > now.getTime() + 5 * 60000))) {
    const error = new Error('교체 완료 날짜와 시각은 현재보다 미래일 수 없습니다.');
    error.code = 'VBELT_CONFIRMATION_FUTURE'; throw error;
  }
  const targets = [...new Set(selected.map(target => target.tagNumber))];
  if (!targets.length) return;
  const result = await database.prepare('SELECT tag_number FROM blower_history_assets WHERE enabled = 1 AND tag_number IN (SELECT value FROM json_each(?))').bind(JSON.stringify(targets)).all();
  if (!Array.isArray(result?.results) || targets.some(tag => !result.results.some(row => row.tag_number === tag))) {
    const error = new Error('V-belt 교체 대상은 현재 등록된 Blower 설비에서 선택해 주세요.');
    error.code = 'VBELT_CONFIRMATION_TARGET_INVALID'; throw error;
  }
}
