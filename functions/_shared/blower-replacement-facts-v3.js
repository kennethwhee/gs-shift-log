import { inspectVbeltAnnotations, annotationControlsFragment, collectConfirmedVbeltFacts } from './diary-vbelt-confirm-v1.js';
/* Approved replacement facts, separate from applying/resetting a cycle.
 * A day-precision event's 00:00 storage representation is NOT a reported
 * midnight completion. The consumer must preserve timePrecision and must not
 * use that placeholder to count pre-replacement RUN as new-belt runtime.
 */
const text = value => String(value ?? '').trim();
const workText = value => text(value).replace(/\bV\s*[-/]?\s*BLET\b/gi, 'V-Belt');
const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0,10) === value;
const requiredAdapters = ['parseFragments','contextualizeFragments','sourceText','identityText',
  'sourceRole','sourceTime','resolveTargets','actualBeltReplacement','detectDateTime','normalizeTime'];
const pieces = value => text(value).split(/\r?\n|[;；|]|\s*(?:->|=>|→|➡|⇒)\s*/g).map(text).filter(Boolean);

function explicitCompletion(value) {
  const valueText = workText(value);
  if (!/(?:\bV\s*[-/]?\s*BELT\b|\bVBELT\b|\bBELT\b|V\s*[-/]?\s*벨트|V벨트|벨트)/i.test(valueText)) return false;
  // "교체 실시" alone records performed work, not a separately timed finish.
  return /(?:교체|교환)\s*(?:작업\s*)?(?:완료|종료)/i.test(valueText) ||
    /(?:교체|교환).{0,100}(?:stand\s*-?\s*by|정상|양호)/i.test(valueText) ||
    /(?:교체|교환)\s*후\s*(?:재?기동|운전)/i.test(valueText);
}

function positivePerformed(value) {
  const valueText = workText(value);
  if (/(?:예정|계획|요청|요망|준비|미실시|미완료|미교체|보류|취소|불가|실패|(?:작업|진행|교체)\s*중|착수|시작|(?:실시|시행|완료)\s*여부|미확인|했는지|하였는지|[?？]|\bNOT\b|\bPLANNED\b|\bREQUESTED\b|\bIN\s+PROGRESS\b)/i.test(valueText)) return false;
  if (explicitCompletion(valueText)) return true;
  return /(?:교체|교환)\s*(?:작업\s*)?(?:실시|시행|함|하였(?:음)?|했(?:음)?|하여)/i.test(valueText) ||
    /\b(?:REPLACED|EXCHANGED)\b/i.test(valueText) ||
    /(?:신품|\bNEW\b).{0,40}(?:취부|설치|장착).{0,16}(?:완료|실시|함|하였|했)/i.test(valueText) ||
    /(?:취외|탈거|제거).{0,40}(?:취부|설치|장착).{0,16}(?:완료|정상|양호)/i.test(valueText);
}

function validTime(value, normalizeTime) {
  // A work range or list is not a single, explicitly timed completion.
  // normalizeTime historically returns its first clock; do not promote it.
  if ([...text(value).matchAll(/(?:[01]?\d|2[0-3]):[0-5]\d/g)].length > 1) return '';
  const normalized = text(normalizeTime(value));
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : '';
}

/**
 * adapters use existing production parser functions; this module deliberately
 * imports no API module and performs no I/O or database work.
 */
export function collectApprovedReplacementFacts(row, recognitionAssets, adapters) {
  for (const name of requiredAdapters) {
    if (typeof adapters?.[name] !== 'function') throw new Error('Missing replacement fact adapter: ' + name);
  }
  if (!['결재완료','APPROVED','approved'].includes(text(row?.status))) return [];
  const rowRole = typeof adapters.normalizeRole === 'function' ? text(adapters.normalizeRole(row?.role)) : text(row?.role);
  const recordDate = text(row?.work_date).slice(0,10);
  if (!day(recordDate)) return [];
  const assets = Array.isArray(recognitionAssets) ? recognitionAssets : [];
  const annotations = inspectVbeltAnnotations(row);
  const confirmedFacts = collectConfirmedVbeltFacts(row, assets, annotations);
  if (/^(?:PART_LEADER|GROUP_LEADER|파트장)$/i.test(rowRole)) return confirmedFacts;
  const parsedFragments = adapters.contextualizeFragments(adapters.parseFragments(row, assets), row, assets);
  const fragments = Array.isArray(parsedFragments) ? parsedFragments.filter(fragment => !annotationControlsFragment(annotations, fragment)) : parsedFragments;
  if (!Array.isArray(fragments)) throw new Error('Replacement parser returned an invalid fragment list.');
  const entryKeyFor = fragment => {
    const origin = fragment?.v3Origin || {};
    return text(origin.entryId) || `${text(origin.collectionName)}:${Number.isInteger(origin.entryIndex) ? origin.entryIndex : 0}`;
  };
  // The earlier scanner used the first eligible native detection per asset/log.
  // Preserve its exact evidence text for this same entry and TAG so a human's
  // unchanged exclusion is not lost when V3 selects the completed continuation
  // rather than the preceding "교체 실시" work heading.
  const earliestNativeEvidence = new Map();
  const explicitCompletionEntries = new Set();
  for (const fragment of fragments) {
    if (fragment?.identityConflict === true || fragment?.v13Context?.identityConflict === true) continue;
    const source = text(adapters.sourceText(fragment));
    if (!source || !adapters.actualBeltReplacement(source, recordDate, false)) continue;
    const record = { sourceText: source, identityText: text(adapters.identityText(fragment)),
      role: text(adapters.sourceRole(fragment) || row.role), workDate: recordDate,
      ...(fragment?.v13Context ? { v13Context: fragment.v13Context } : {}) };
    for (const asset of adapters.resolveTargets(record, assets, assets) || []) {
      const tag = text(asset?.tag_number || asset?.tagNumber).toUpperCase();
      const key = JSON.stringify([tag,entryKeyFor(fragment)]);
      if (!earliestNativeEvidence.has(key)) earliestNativeEvidence.set(key,text(fragment?.v13EvidenceText) || source);
      if (pieces(source).length === 1 && explicitCompletion(source) && positivePerformed(source)) explicitCompletionEntries.add(key);
    }
  }
  const facts = new Map(confirmedFacts.map(fact => [fact.sourceKey, fact]));
  for (const fragment of fragments) {
    if (fragment?.identityConflict === true || fragment?.v13Context?.identityConflict === true) continue;
    const source = text(adapters.sourceText(fragment));
    if (!source || !adapters.actualBeltReplacement(source, recordDate, false) || !positivePerformed(source)) continue;
    // The legacy parser also emits a combined fallback after its constituent
    // work clauses. It is corroborating context, not a second physical job.
    if (pieces(source).length > 1) continue;
    const role = text(adapters.sourceRole(fragment) || row.role);
    const identity = text(adapters.identityText(fragment));
    const sourceRecord = { sourceText: source, identityText: identity, role, workDate: recordDate,
      ...(fragment?.v13Context ? { v13Context: fragment.v13Context } : {}) };
    const targets = adapters.resolveTargets(sourceRecord, assets, assets) || [];
    const origin = fragment?.v3Origin || {};
    const originContent = text(origin.entryContent);
    const originFirstLine = pieces(originContent)[0] || '';
    const originIdentity = text(origin.structuredIdentityText || identity);
    const partTargets = (part, partIdentity = identity) => adapters.resolveTargets({
      sourceText: part, identityText: partIdentity, role, workDate: recordDate
    }, assets, assets) || [];
    for (const asset of targets) {
      const tagNumber = text(asset?.tag_number || asset?.tagNumber).toUpperCase();
      if (!tagNumber || !assets.some(item => text(item.tag_number || item.tagNumber).toUpperCase() === tagNumber)) continue;
      if (!explicitCompletion(source) && explicitCompletionEntries.has(JSON.stringify([tagNumber,entryKeyFor(fragment)]))) continue;
      const belongs = (part, partIdentity = identity) => partTargets(part, partIdentity).some(item =>
        text(item.tag_number || item.tagNumber).toUpperCase() === tagNumber);
      const actualPieces = pieces(source).filter(part =>
        adapters.actualBeltReplacement(part, recordDate, false) && positivePerformed(part) && belongs(part));
      if (!actualPieces.length) continue;
      let completionClock = '';
      let clockKind = 'none';
      for (const part of actualPieces) {
        if (!explicitCompletion(part)) continue;
        const ownClock = validTime(part, adapters.normalizeTime);
        if (ownClock) { completionClock = ownClock; clockKind = 'own_completion'; break; }
      }
      // Entry.time belongs to a completion only if the entry's own heading is
      // a completed Belt job for this same asset. Never borrow a stop/start or
      // an earlier "교체 실시" heading's clock for its later completion line.
      const entryClock = validTime(origin.entryTimeText ?? origin.entryTime, adapters.normalizeTime);
      if (!completionClock && entryClock && explicitCompletion(originFirstLine) &&
          adapters.actualBeltReplacement(originFirstLine, recordDate, false) && belongs(originFirstLine, originIdentity)) {
        completionClock = entryClock;
        clockKind = 'entry_completion';
      }
      const originalSourceClock = validTime(adapters.sourceTime(fragment), adapters.normalizeTime) ||
        entryClock || validTime(originFirstLine, adapters.normalizeTime);
      if (!completionClock && originalSourceClock) clockKind = 'work_context';
      const timePrecision = completionClock ? 'minute' : 'day';
      const eventDate = completionClock ? text(adapters.detectDateTime({
        ...row, sourceTime: completionClock, sourceText: source
      })) : `${recordDate}T00:00:00+09:00`;
      if (!Number.isFinite(Date.parse(eventDate))) throw new Error('Replacement completion date is invalid.');
      const sourceText = originContent || text(fragment?.v13EvidenceText) || source;
      const sourceEntryId = text(origin.entryId);
      const sourceEntryKey = entryKeyFor(fragment);
      const sourceClauseIndex = Number.isInteger(fragment.v3ClauseIndex) ? fragment.v3ClauseIndex : 0;
      const sourceKey = JSON.stringify([text(row.id), tagNumber, sourceEntryKey, sourceClauseIndex]);
      const priorCandidateText = earliestNativeEvidence.get(JSON.stringify([tagNumber,sourceEntryKey])) || text(fragment?.v13EvidenceText);
      const candidateTexts = [...new Set([source,priorCandidateText,originContent].filter(Boolean))].slice(0,3);
      const fact = { tagNumber, eventDate, recordDate, timePrecision, sourceText, sourceKey,
        sourceLogId: text(row.id), sourceEntryId, sourceRole: role, originalSourceClock, candidateTexts,
        sourceClockKind: clockKind,
        precisionReason: completionClock ? '직접 교체 완료 기록의 시각' : '교체 사실 확인 · 완료 시각 미기록' };
      const existing = facts.get(sourceKey);
      if (!existing || existing.timePrecision === 'day' && timePrecision === 'minute') facts.set(sourceKey, fact);
    }
  }
  return [...facts.values()];
}
