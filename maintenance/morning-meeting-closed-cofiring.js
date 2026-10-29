/* Morning cards read the selected day's saved closing; no Excel/Agent query. */
(function (root) {
  'use strict';
  const API = '/api/cofiring-closed-history';
  const PREFIX = 'efficiencyMorningMeetingAutoDaily';
  const ORGANIC_IDS = {
    sludgeTotal: PREFIX + 'SludgeTotal', sludgeTruckCount: PREFIX + 'SludgeTruckCount',
    organicDaySilo: PREFIX + 'OrganicDaySilo', organicStorageSiloA: PREFIX + 'OrganicStorageSiloA',
    organicStorageSiloB: PREFIX + 'OrganicStorageSiloB', organicSiloTotal: PREFIX + 'OrganicSiloTotal'
  };
  const ALIASES = ['organicDaySiloLevel', 'organicStorageSiloALevel', 'organicStorageSiloBLevel', 'organicTruckCount', 'organicReceivedAmount'];
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const dateValid = value => /^20\d{2}-\d{2}-\d{2}$/.test(value || '') &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  const emptyOrganic = () => Object.fromEntries(Object.keys(ORGANIC_IDS).map(key => [key, null]));

  // MORNING_MEETING_CLOSED_SUMMARY_COMPAT_V4
  // The persisted closed summary is intentionally compact. Some ratio fields
  // live only in snapshot.result. Fill only missing summary fields from that
  // already-saved result; never query/recalculate or override summary values.
  // COFIRING_TOTAL_HEAT_BASIS_V2_R3: older compact summaries may contain a Coal+Bio-only Bio ratio.
  // Rehydrate Bio ratio from the already-saved full result; do not re-query or rewrite DB rows.
  function closedCoalBioRatio(result) {
    const direct = number(result?.fuelRatios?.bio) ?? number(result?.ratios?.bio);
    if (direct !== null) return direct;
    const bio = number(result?.heats?.bio);
    const total = number(result?.heats?.total);
    return bio !== null && total !== null && total > 0 ? bio / total * 100 : null;
  }

  function compatClosedUnitSummary(summary, result) {
    const value = summary && typeof summary === 'object' ? {...summary} : {};
    const totalHeatBioRatio = closedCoalBioRatio(result);
    if (totalHeatBioRatio !== null) value.bioRatio = totalHeatBioRatio;
    else if (value.bioRatio === undefined) value.bioRatio = null;
    if (value.organicGroupRatio === undefined) {
      value.organicGroupRatio =
        result?.fuelRatios?.organicGroup ??
        result?.ratios?.organic ??
        null;
    }
    if (value.totalRatio === undefined) {
      value.totalRatio =
        result?.fuelRatios?.total ??
        result?.ratios?.total ??
        null;
    }
    for (const fuel of ['coal', 'bio', 'organic', 'manure']) {
      if (value[fuel] === undefined) value[fuel] = result?.[fuel]?.quantity;
    }
    return value;
  }

  function compatClosedCombinedSummary(summary, result) {
    const value = summary && typeof summary === 'object' ? {...summary} : {};
    const totalHeatBioRatio = closedCoalBioRatio(result);
    if (totalHeatBioRatio !== null) value.bioRatio = totalHeatBioRatio;
    else if (value.bioRatio === undefined) value.bioRatio = null;
    if (value.organicGroupRatio === undefined) {
      value.organicGroupRatio =
        result?.fuelRatios?.organicGroup ??
        result?.ratios?.organic ??
        null;
    }
    if (value.totalRatio === undefined) {
      value.totalRatio =
        result?.fuelRatios?.total ??
        result?.ratios?.total ??
        null;
    }
    return value;
  }

  // MORNING_COFIRING_EFFECTIVE_SYNC_V1
  // A hydrated GET contains the server's latest exact-period apply/CLEAR state.
  // Rebuild ALL co-firing fields from that one result. Never fill adjusted fuel
  // quantities or ratios with an older compact summary, and never adjust twice.
  function closedEffectiveState(item, snapshot) {
    const hasEffective = Object.hasOwn(item, 'effectiveResult');
    const hasFlag = Object.hasOwn(item, 'adjustmentApplied');
    if (hasFlag && typeof item.adjustmentApplied !== 'boolean') {
      throw new Error('마감자료의 혼소 조정 상태를 확인하지 못했습니다.');
    }
    const clearedLegacy = !hasEffective && item.adjustmentApplied === false &&
      snapshot.result?.adjustment?.applied === true;
    const result = hasEffective ? item.effectiveResult :
      clearedLegacy ? snapshot.originalResult : snapshot.result;
    const adjustmentApplied = hasFlag ? item.adjustmentApplied : result?.adjustment?.applied === true;

    if (hasEffective || clearedLegacy) {
      if (!result || typeof result !== 'object' || Array.isArray(result) ||
          !result.units?.unit1 || !result.units?.unit2 || !result.combined) {
        throw new Error('조정·원복을 반영한 최종 마감자료가 없습니다. 다시 조회해 주세요.');
      }
      if (!['unit1', 'unit2'].every(unit =>
          ['coal', 'bio', 'organic', 'manure'].every(fuel => number(result.units[unit]?.[fuel]?.quantity) !== null))) {
        throw new Error('최종 마감자료의 연료 사용량이 올바르지 않습니다.');
      }
      for (const key of ['startLocal', 'endLocal']) {
        if (result.period?.[key] !== undefined && result.period[key] !== snapshot.period[key]) {
          throw new Error('최종 혼소 조정값의 조회 기간이 마감자료와 다릅니다.');
        }
      }
      if (!adjustmentApplied && result.adjustment?.applied === true) {
        throw new Error('혼소 조정 원복 결과를 확인하지 못했습니다. 다시 조회해 주세요.');
      }
      return {
        adjustmentApplied,
        adjustmentSource: String(item.adjustmentSource || 'closed_effective'),
        summary: {
          unit1: compatClosedUnitSummary(null, result.units.unit1),
          unit2: compatClosedUnitSummary(null, result.units.unit2),
          combined: compatClosedCombinedSummary(null, result.combined)
        }
      };
    }
    // Normalize a legacy close once against its own result. An effective result
    // above has already been normalized and must never be overlaid with the
    // original snapshot's ratios (which would mix adjusted tonnes with raw Bio%).
    return {summary: {
      unit1: compatClosedUnitSummary(item.summary?.unit1, result?.units?.unit1),
      unit2: compatClosedUnitSummary(item.summary?.unit2, result?.units?.unit2),
      combined: compatClosedCombinedSummary(item.summary?.combined, result?.combined)
    }, adjustmentApplied,
      adjustmentSource: String(item.adjustmentSource || 'closed_snapshot')};
  }

  function normalizeItem(item, date) {
    if (item === null) return null;
    const snapshot = item?.snapshot;
    if (!dateValid(date) || item?.targetDate !== date || snapshot?.targetDate !== date ||
        snapshot.schemaVersion !== 1 || !Number.isSafeInteger(item.revision) || item.revision < 1 ||
        !item.sourceRequestId || snapshot.sourceRequestId !== item.sourceRequestId) {
      throw new Error('선택일의 마감자료를 확인하지 못했습니다.');
    }
    const period = snapshot.period;
    const next = new Date(date + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    if (period?.startLocal !== date + 'T00:00' ||
        ![nextDate + 'T00:00', nextDate + 'T00:01'].includes(period?.endLocal)) {
      throw new Error('마감자료의 일별 조회 기간이 다릅니다.');
    }
    const ratios = value => {
      const result = {};
      for (const [key, source] of [['bioRatio', 'bioRatio'], ['organicRatio', 'organicGroupRatio'], ['totalRatio', 'totalRatio']]) {
        const ratio = value?.[source];
        if (ratio !== null && (number(ratio) === null || ratio > 100)) throw new Error('마감 혼소율 형식이 올바르지 않습니다.');
        result[key] = ratio;
      }
      return result;
    };
    const unit = value => {
      const result = ratios(value);
      for (const fuel of ['coal', 'bio', 'organic', 'manure']) {
        if (number(value?.[fuel]) === null) throw new Error('마감 연료 사용량 형식이 올바르지 않습니다.');
        result[fuel] = value[fuel];
      }
      return result;
    };
    const effective = closedEffectiveState(item, snapshot);
    const summary = effective.summary;
    const organic = emptyOrganic();
    organic.sludgeTotal = number(snapshot.manual?.receipts?.organic);
    organic.organicSiloTotal = number(snapshot.organicUsage?.endTotal);
    const inventory = Object.hasOwn(item, 'organicInventory') ? item.organicInventory : snapshot.organicInventory;
    const stockKeys = ['organicDaySilo', 'organicStorageSiloA', 'organicStorageSiloB'];
    let inventoryCorrected=false;
    if (inventory?.startLocal === period.startLocal && inventory?.endLocal === period.endLocal &&
        stockKeys.every(key => number(inventory.end?.[key]) !== null)) {
      const total = stockKeys.reduce((sum, key) => sum + inventory.end[key], 0);
      if (number(inventory.end.total) !== null && Math.abs(total - inventory.end.total) <= 0.000001 &&
          (organic.organicSiloTotal === null || Math.abs(total - organic.organicSiloTotal) <= 0.000001)) {
        for (const key of stockKeys) organic[key] = inventory.end[key];
        organic.organicSiloTotal = total;
        inventoryCorrected=inventory.basis==='operator_corrected_period_boundary';
      }
    }
    return { targetDate: date, revision: item.revision, updatedAt: String(item.updatedAt || ''),
      source: 'cofiring-closed-history', period: {startLocal: period.startLocal, endLocal: period.endLocal},
      adjustmentApplied: effective.adjustmentApplied, adjustmentSource: effective.adjustmentSource,
      receiptInputMode: snapshot.manual?.inputMode === 'manual' ? 'manual' : 'auto',
      ...(inventoryCorrected?{inventoryCorrected:true}:{}),
      unitOne: unit(summary?.unit1), unitTwo: unit(summary?.unit2), combined: ratios(summary?.combined),
      organic, receiptCountNote: '마감자료에는 입고 건수가 저장되어 있지 않습니다.' };
  }

  function matchingReceiptCount(payload, snapshot) {
    if (payload?.ok === false || payload?.source !== 'solid-fuel-unloading' ||
        payload?.basis !== 'completed-unloading-departure' ||
        payload?.receiptStart !== snapshot.period.startLocal || payload?.receiptEnd !== snapshot.period.endLocal ||
        number(payload.receipts?.organic) === null || snapshot.organic.sludgeTotal === null ||
        Math.abs(payload.receipts.organic - snapshot.organic.sludgeTotal) > 0.000001 ||
        !Number.isSafeInteger(payload.counts?.organic) || payload.counts.organic < 0) return null;
    return payload.counts.organic;
  }

// GS_MORNING_ORGANIC_RECEIPT_SILO_RECOVERY_V9_20261029
// Read-only recovery for every date and silo. Never creates Agent requests.
// The saved co-firing calculation accepts GOOD samples up to five minutes before
// the closing boundary. Keep the existing exclusive +1-minute padding limit.
const ORGANIC_END_LOOKBACK_MS = 5 * 60 * 1000;
const ORGANIC_END_PADDING_MS = 60 * 1000;
// Preserve V5's normal one-minute boundary window. Only V6's extended lookback
// substitutes an older observation for a missing recent boundary sample.
const ORGANIC_END_NORMAL_LOOKBACK_MS = 60 * 1000;
function recoveryNextDate(date) {
  if (!dateValid(date)) return '';
  const next = new Date(date + 'T00:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
function organicRecoveryDefinitions() {
  return {
    organicDaySilo: {label: 'Day Silo', tag: 'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT'},
    organicStorageSiloA: {label: 'Storage A', tag: 'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT'},
    organicStorageSiloB: {label: 'Storage B', tag: 'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'}
  };
}
function organicRecoveryReceipt(date, data) {
  const start = date + 'T00:00', end = recoveryNextDate(date) + 'T00:00';
  if (!dateValid(date) || data?.ok !== true || data?.source !== 'solid-fuel-unloading' ||
      data?.basis !== 'completed-unloading-departure' || data.receiptStart !== start || data.receiptEnd !== end ||
      number(data.receipts?.organic) === null || !Number.isSafeInteger(data.counts?.organic) || data.counts.organic < 0) return null;
  return {tons: data.receipts.organic, count: data.counts.organic};
}
function organicRecoverySource(date, response, expectedSourceId = '') {
  const start = date + 'T00:00', end = recoveryNextDate(date) + 'T00:00';
  const result = response?.result, saved = response?.saved, report = result?.report;
  if (!dateValid(date) || response?.ok !== true || response?.targetDate !== date ||
      saved?.status !== 'complete' || saved?.requestType !== 'cofiring_period' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(saved?.id || '') ||
      result?.requestId !== saved.id || (expectedSourceId && saved.id !== expectedSourceId) ||
      result?.kind !== 'cofiring_period_live_result' || result?.schemaVersion !== 1 ||
      result?.request?.startLocal !== start || result?.request?.endLocal !== end ||
      result?.request?.stepUnit !== 'minute' || result?.request?.stepValue !== 1 ||
      report?.startLocal !== start || report?.endLocal !== end) return null;
  return {id: saved.id, report};
}
function organicRecoverySamples(date, response, expectedSourceId = '') {
  const source = organicRecoverySource(date, response, expectedSourceId);
  if (!source) return null;
  const inventory = source.report.organicInventory;
  if (source.report.organicInventoryReady === true) {
    if (inventory?.basis !== 'dataparc_period_boundary' || inventory?.startLocal !== date + 'T00:00' ||
        inventory?.endLocal !== recoveryNextDate(date) + 'T00:00') return null;
    // A server-validated aggregate alone is not proof of a fresh midnight reading.
    return Array.isArray(inventory.samples) ? inventory.samples : null;
  }
  return Array.isArray(source.report.organicInventorySamples) ? source.report.organicInventorySamples : null;
}
function organicRecoverySilos(date, response, expectedSourceId = '') {
  const values = {}, samples = organicRecoverySamples(date, response, expectedSourceId);
  if (!samples) return values;
  const endMs = Date.parse(recoveryNextDate(date) + 'T00:00:00+09:00');
  for (const [key, definition] of Object.entries(organicRecoveryDefinitions())) {
    const matches = samples.filter(sample => sample?.key === key);
    if (matches.length !== 1) continue;
    const sample = matches[0], quality = String(sample.endQuality || '').replace(/\s+/g, '').toLowerCase();
    const time = String(sample.endTime || '');
    const at = /(?:Z|[+-]\d{2}:\d{2})$/i.test(time) ? Date.parse(time) : NaN;
    if (sample.tag !== definition.tag || !['good', 'raw,good', 'good,raw'].includes(quality) ||
        number(sample.endValue) === null || sample.endValue > 1e6 || !Number.isFinite(at) ||
        at < endMs - ORGANIC_END_LOOKBACK_MS || at >= endMs + ORGANIC_END_PADDING_MS) continue;
    values[key] = sample.endValue;
  }
  return values;
}
function organicRecoverySavedItem(date, response) {
  const item = response?.item;
  if (!dateValid(date) || response?.ok !== true || item?.targetDate !== date ||
      item?.recordKind !== 'hypothesis' || item?.verificationStatus !== 'unverified' || item?.officialClose !== false ||
      !Number.isSafeInteger(item.revision) || item.revision < 1 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(item.sourceRequestId || '')) return null;
  if (item.record !== undefined) {
    const record = item.record;
    if (!record || record.targetDate !== date || record.sourceRequestId !== item.sourceRequestId ||
        record.recordKind !== 'hypothesis' || record.verificationStatus !== 'unverified' || record.officialClose !== false ||
        record.period?.startLocal !== date + 'T00:00' || record.period?.endLocal !== recoveryNextDate(date) + 'T00:00' ||
        record.period?.stepUnit !== 'minute' || record.period?.stepValue !== 1) return null;
  }
  return item;
}
function organicRecoveryEstimatedSilos(date, response) {
  const values = {}, item = organicRecoverySavedItem(date, response);
  if (!item) return values;
  const end = recoveryNextDate(date) + 'T00:00';
  const boundaries = Array.isArray(item.estimation?.boundaries) ? item.estimation.boundaries :
    item.assumption ? [item.assumption] : [];
  for (const key of Object.keys(organicRecoveryDefinitions())) {
    const matches = boundaries.filter(row => row?.silo === key && row.boundaryLocal === end);
    if (matches.length !== 1) continue;
    const row = matches[0];
    if ((row.side !== undefined && row.side !== 'end') || number(row.tons) === null || row.tons > 1e6) continue;
    values[key] = row.tons;
  }
  return values;
}
function organicRecoveryEstimatedBoundary(date, response) {
  return number(organicRecoveryEstimatedSilos(date, response).organicStorageSiloB);
}
function organicRecoveryMissingReason(date, key, response) {
  const samples = organicRecoverySamples(date, response);
  if (!samples) return '해당 날짜의 하루 종료재고 원본을 확인하지 못했습니다.';
  const matches = samples.filter(sample => sample?.key === key);
  if (matches.length !== 1) return '해당 Silo의 고유한 종료 계측 기록이 없습니다.';
  const sample = matches[0], quality = String(sample.endQuality || '').replace(/\s+/g, '').toLowerCase();
  if (!['good', 'raw,good', 'good,raw'].includes(quality)) return '종료 계측 품질이 정상이 아니거나 확인되지 않았습니다.';
  if (number(sample.endValue) === null) return '종료 계측값이 없습니다.';
  return '종료 계측의 시각 또는 설비 식별 정보가 기준과 맞지 않습니다.';
}
async function recoverOrganicForDate(date, headers, closed, fetchJson) {
  if (!dateValid(date) || typeof fetchJson !== 'function') return null;
  const start = date + 'T00:00', end = recoveryNextDate(date) + 'T00:00';
  const sourceUrl = sourceRequestId => '/api/ois-data-requests?' + new URLSearchParams({
    action: 'cofiring_period_source', targetDate: date, ...(sourceRequestId ? {sourceRequestId} : {})
  });
  const read = url => Promise.resolve().then(() => fetchJson(url, headers)).catch(() => null);
  const responses = await Promise.all([
    read('/api/solid-fuel-trouble?' + new URLSearchParams({receiptStart: start, receiptEnd: end})),
    read(sourceUrl('')),
    read('/api/cofiring-provisional-v12?' + new URLSearchParams({targetDate: date}))
  ]);
  const definitions = organicRecoveryDefinitions(), stockKeys = Object.keys(definitions);
  const receipt = organicRecoveryReceipt(date, responses[0]);
  const organic = {...emptyOrganic(), ...(closed?.organic || {})};
  const fieldNotes = {}, estimatedKeys = [], boundaryApproximateKeys = [], sourceRefs = {};
  let hasIndependent = false;
  if (receipt) {
    if (closed?.receiptInputMode !== 'manual' || number(organic.sludgeTotal) === null) {
      organic.sludgeTotal = receipt.tons;
      fieldNotes.sludgeTotal = '완료된 하역기록 합계 · 해당 날짜 00:00부터 다음 날 00:00 미만';
    } else {
      fieldNotes.sludgeTotal = '공식 마감의 수동 입고량 유지 · 하역기록 입고량과 별도';
    }
    organic.sludgeTruckCount = receipt.count;
    fieldNotes.sludgeTruckCount = '완료된 하역기록 건수 · DataPARC 통신상태와 무관';
    hasIndependent = true;
  }
  const fillMeasured = (response, expectedId, sourceLabel) => {
    const measured = organicRecoverySilos(date, response, expectedId);
    const samples = organicRecoverySamples(date, response, expectedId);
    for (const key of stockKeys) if (number(organic[key]) === null && number(measured[key]) !== null) {
      organic[key] = measured[key];
      const sample = samples.find(row => row?.key === key);
      const sampledMs = Date.parse(sample.endTime);
      const sampledAt = new Date(sampledMs + 9 * 3600000).toISOString().slice(0, 19).replace('T', ' ');
      const approximate = sampledMs < Date.parse(end + ':00+09:00') - ORGANIC_END_NORMAL_LOOKBACK_MS;
      // A routine GOOD sample need not fall on the exact millisecond of midnight.
      // Mark only the extended recovery window, per silo; whole-day/start errors
      // do not make an otherwise normal ending sample approximate.
      if (approximate) boundaryApproximateKeys.push(key);
      fieldNotes[key] = end.replace('T', ' ') +
        (approximate ? ' 기준 근사 재고(≈) · 최근 1분 내 종료 계측 미확인 · ' : ' 기준 종료재고 · ') + sourceLabel +
        (approximate ? ' 이전 정상 계측값을 대체 사용 · 실제 계측 ' : ' 정상 계측값 · 실제 계측 ') + sampledAt + ' KST';
      sourceRefs[key] = response.saved.id;
      hasIndependent = true;
    }
  };
  fillMeasured(responses[1], '', '선택일 하루 저장 원본의');
  const saved = organicRecoverySavedItem(date, responses[2]);
  // Consult the exact original used by the saved calculation only when gaps remain.
  // One bounded GET; current GOOD values (including zero) are never replaced.
  if (saved && stockKeys.some(key => number(organic[key]) === null) &&
      saved.sourceRequestId !== organicRecoverySource(date, responses[1])?.id) {
    fillMeasured(await read(sourceUrl(saved.sourceRequestId)), saved.sourceRequestId, '저장된 혼소율 계산 원본의');
  }
  const estimates = organicRecoveryEstimatedSilos(date, responses[2]);
  for (const key of stockKeys) if (number(organic[key]) === null && number(estimates[key]) !== null) {
    organic[key] = estimates[key];
    estimatedKeys.push(key);
    sourceRefs[key] = saved.sourceRequestId;
    fieldNotes[key] = end.replace('T', ' ') + ' 종료재고 · 저장된 추정 근거 · 실제 계측값 아님 · 재확인 필요';
    hasIndependent = true;
  }
  const missingKeys = stockKeys.filter(key => number(organic[key]) === null);
  for (const key of missingKeys) fieldNotes[key] = end.replace('T', ' ') + ' · ' +
    organicRecoveryMissingReason(date, key, responses[1]) + ' 같은 종료시각의 저장 원본 또는 추정 근거가 필요합니다.';
  if (!missingKeys.length) {
    const sum = stockKeys.reduce((total, key) => total + organic[key], 0);
    if (number(organic.organicSiloTotal) === null) {
      organic.organicSiloTotal = sum;
      if (estimatedKeys.length || boundaryApproximateKeys.length) {
        if (estimatedKeys.length) estimatedKeys.push('organicSiloTotal');
        if (boundaryApproximateKeys.length) boundaryApproximateKeys.push('organicSiloTotal');
        fieldNotes.organicSiloTotal = '00:00 기준 Day Silo + Storage A + Storage B · 대체값 또는 저장 추정 포함(≈) · 재확인 필요';
      } else fieldNotes.organicSiloTotal = '동일 종료 기준 3개 Silo 정상 계측 재고 합계 · 실제 계측시각은 항목별 확인';
      hasIndependent = true;
    } else if (Math.abs(organic.organicSiloTotal - sum) > 0.01) {
      fieldNotes.organicSiloTotal = '마감 저장 재고 합계와 개별 Silo 합계가 다릅니다. 수치를 재확인하세요.';
    }
  } else if (number(organic.organicSiloTotal) === null) {
    fieldNotes.organicSiloTotal = missingKeys.map(key => definitions[key].label).join(', ') + ' 종료재고 미확인 · 합계 미산출';
  }
  if (!hasIndependent) return null;
  const approximateKeys = [...new Set([...estimatedKeys, ...boundaryApproximateKeys])];
  const note = end.replace('T', ' ') + ' 기준 · ' +
    (missingKeys.length ? missingKeys.map(key => definitions[key].label).join(', ') + ' 종료재고 미확인. ' : '') +
    (approximateKeys.length ? '00:00 기준 대체값 또는 저장 추정 포함(≈) · 실제 계측시각과 근거는 항목별 확인. ' : '') +
    '입고량·건수는 완료 하역기록, 재고는 같은 종료 기준의 저장 근거로 보완합니다.';
  return {targetDate: date, organic, fieldNotes, estimatedKeys, boundaryApproximateKeys, approximateKeys, missingKeys, sourceRefs, note};
}
if (typeof module === 'object' && module.exports) module.exports = {normalizeItem, matchingReceiptCount, organicRecoveryReceipt, organicRecoverySilos, organicRecoveryEstimatedBoundary, organicRecoveryEstimatedSilos, recoverOrganicForDate};
  if (!root?.document || root.morningMeetingClosedCofiring) return;
  const doc = root.document, cache = new Map(), pending = new Map(), generations = new Map(), blockedDates = new Set();
  let session = '', observedDate = '', timer = null;
  const byId = id => doc.getElementById(id);
  const setText = (element, value) => { if (element && element.textContent !== value) element.textContent = value; };
  const PANEL = 'efficiencyMorningMeetingWaterPanel';

  // MORNING_MEETING_ORGANIC_SAVED_FIRST_V2_R4
  // Existing saved Morning Meeting organic values remain authoritative until
  // the operator explicitly requests a requery. Background closed-data refresh
  // must not cover those values with a loading/missing/partial closing.
  const savedFirstOrganicDates = new Set();
  const explicitOrganicRequeryDates = new Set();

  function organicSavedText(element) {
    return String(element?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function hasExistingSavedOrganicCard(date) {
    if (!dateValid(date) || isBlocked(date)) return false;
    const dateText = organicSavedText(byId(PREFIX + 'SludgeDate'));
    const statusText = organicSavedText(byId(PREFIX + 'SludgeStatus'));
    const savedLabel = dateText.includes('기존 저장값') || statusText.includes('기존 저장값');
    if (!dateText.includes(date) || !savedLabel) return false;

    return Object.values(ORGANIC_IDS).some(id => {
      const value = organicSavedText(byId(id));
      return value !== '' && value !== '-' && value !== '—';
    });
  }

    // MORNING_MEETING_ORGANIC_SAVED_FIRST_V3_R3
  // Existing saved Morning Meeting organic data stays authoritative when a
  // historical co-firing close does not contain the complete organic payload.
  function hasCompleteClosedOrganic(item) {
    const organic = item?.organic;
    return [
      organic?.sludgeTotal,
      organic?.organicDaySilo,
      organic?.organicStorageSiloA,
      organic?.organicStorageSiloB,
      organic?.organicSiloTotal
    ].every(value => number(value) !== null);
  }

  function hasCompleteExistingOrganicValues(value) {
    const source = value && typeof value === 'object' ? value : {};
    return [
      source.sludgeTotal ?? source.organicReceivedAmount,
      source.organicDaySilo ?? source.organicDaySiloLevel,
      source.organicStorageSiloA ?? source.organicStorageSiloALevel,
      source.organicStorageSiloB ?? source.organicStorageSiloBLevel,
      source.organicSiloTotal
    ].every(item => number(item) !== null);
  }

  function shouldPreserveExistingOrganic(date) {
    if (!dateValid(date) || isBlocked(date)) {
      savedFirstOrganicDates.delete(date);
      return false;
    }

    if (hasExistingSavedOrganicCard(date)) {
      savedFirstOrganicDates.add(date);
    }

    if (!savedFirstOrganicDates.has(date)) {
      return false;
    }

    const closed = peek(date);

    // Loading / missing / failed / partial historical close:
    // never erase a valid existing saved Morning Meeting organic card.
    if (!hasCompleteClosedOrganic(closed)) {
      return true;
    }

    // Only a complete closing may replace the saved card after an explicit
    // organic mini refresh / 전체자료 action.
    return !explicitOrganicRequeryDates.has(date);
  }

  function beginExplicitOrganicRequery(date = targetDate()) {
    if (!dateValid(date)) return false;

    // Keep the saved-date latch. Explicit refresh is permission to replace
    // only when the fetched closing is complete.
    explicitOrganicRequeryDates.add(date);
    root.setTimeout(() => explicitOrganicRequeryDates.delete(date), 30000);
    return true;
  }

  // MORNING_MEETING_ORGANIC_MINI_REFRESH_EXPLICIT_V4_R4
  // User-facing organic refresh path. This explicitly asks the saved closing
  // provider for the selected date and grants replacement permission only for
  // this request. Saved-First V3 R3 still prevents an incomplete closing from
  // erasing a complete existing Morning Meeting organic card.
  async function refreshOrganicFromClosing(options = {}) {
    const date = targetDate();
    const allowBlockedRebuild = options.allowBlockedRebuild === true;
    if (!dateValid(date) || (isBlocked(date) && !allowBlockedRebuild)) return null;
    beginExplicitOrganicRequery(date);
    return refresh({...options, force: true, allowBlockedRebuild});
  }


  function targetDate() {
    const state = root.efficiencyMorningMeetingUploadState || {};
    const choices = [byId(PANEL)?.dataset.morningMeetingAutoBaseDate, state.shiftPart?.reportDate, state.shiftPart?.loadedDate];
    for (const id of ['efficiencyMorningMeetingAutoDailyPowerDate', 'efficiencyMorningMeetingAutoSteamDate', 'efficiencyMorningMeetingWaterDate']) {
      choices.push(String(byId(id)?.textContent || '').match(/20\d{2}-\d{2}-\d{2}/)?.[0]);
    }
    return choices.find(dateValid) || '';
  }

  function authHeaders() {
    const headers = new Headers(typeof root.getShiftLogAuthHeaders === 'function' ? root.getShiftLogAuthHeaders() : {});
    if (!headers.get('Authorization')) {
      const token = typeof getShiftLogSessionToken === 'function' ? getShiftLogSessionToken() : root.getShiftLogSessionToken?.();
      if (token) headers.set('Authorization', 'Bearer ' + token);
    }
    headers.set('Accept', 'application/json');
    return headers;
  }

  function checkSession() {
    const value = authHeaders().get('Authorization') || '';
    if (value !== session) {
      for (const date of new Set([...cache.keys(), ...pending.keys()])) invalidate(date);
      session = value;
    }
    return value;
  }

  function isBlocked(date) {
    return root.isMorningMeetingSelectedDateResetActive?.(date) === true ||
      root.morningMeetingQuerySources?.resetState?.(date)?.active === true;
  }

  function invalidate(date) {
    generations.set(date, (generations.get(date) || 0) + 1);
    cache.delete(date); pending.delete(date);
  }

  function state(date = targetDate()) {
    try { checkSession(); } catch { return {status: 'error', error: '로그인 상태를 확인해 주세요.'}; }
    return isBlocked(date) ? {status: 'idle'} : cache.get(date) || {status: 'idle'};
  }

  function peek(date = targetDate()) {
    if (date !== targetDate()) return null;
    const entry = state(date);
    return entry.status === 'complete' ? entry.item : null;
  }

  function notify(date) {
    renderOrganic();
    doc.dispatchEvent(new CustomEvent('morningMeetingClosedCofiringChanged', {detail: {targetDate: date}}));
  }

  async function getJson(url, headers) {
    const controller = new AbortController();
    const timeout = root.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await root.fetch(url, {method: 'GET', headers, cache: 'no-store', credentials: 'same-origin', signal: controller.signal});
      const payload = await response.json();
      if (!response.ok || payload?.ok === false) throw new Error(payload?.message || '마감자료를 불러오지 못했습니다.');
      return payload;
    } finally { root.clearTimeout(timeout); }
  }

  async function load(date = targetDate(), options = {}) {
    if (!dateValid(date)) return null;
    const allowBlockedRebuild = options.allowBlockedRebuild === true;
    let identity;
    try { identity = checkSession(); } catch { identity = ''; }
    if (!identity) {
      invalidate(date); cache.set(date, {status: 'error', error: '로그인이 필요합니다.'}); notify(date);
      throw new Error('로그인이 필요합니다.');
    }
    if (isBlocked(date) && !allowBlockedRebuild) { invalidate(date); return null; }
    if (pending.has(date)) return pending.get(date);
    if (options.force !== true && cache.has(date)) {
      const entry = cache.get(date);
      if (entry.status === 'error') throw new Error(entry.error);
      return entry.item || null;
    }
    const generation = generations.get(date) || 0;
    const current = () => generation === (generations.get(date) || 0) && checkSession() === identity && (allowBlockedRebuild || !isBlocked(date));
    cache.set(date, {status: 'loading'});
    const promise = (async () => {
      try {
        if (typeof root.morningMeetingQuerySources?.loadResetStatus === 'function') {
          const reset = await root.morningMeetingQuerySources.loadResetStatus(date);
          if (!reset) throw new Error('선택일의 초기화 상태를 확인하지 못했습니다.');
        }
        if (!current()) return null;
        const headers = authHeaders();
        const payload = await getJson(API + '?targetDate=' + encodeURIComponent(date), headers);
        const item = normalizeItem(payload.item, date);
        if (!current()) return null;
        if (item && item.organic.sludgeTotal !== null) {
          try {
            const url = '/api/solid-fuel-trouble?' + new URLSearchParams({receiptStart: item.period.startLocal, receiptEnd: item.period.endLocal});
            const receipts = await getJson(url, headers);
            const receiptTons = number(receipts?.receipts?.organic);
            const receiptCount =
              Number.isSafeInteger(receipts?.counts?.organic) &&
              receipts.counts.organic >= 0
                ? receipts.counts.organic
                : null;

            const samePeriod =
              receipts?.source === 'solid-fuel-unloading' &&
              receipts?.basis === 'completed-unloading-departure' &&
              receipts?.receiptStart === item.period.startLocal &&
              receipts?.receiptEnd === item.period.endLocal;

            if (
              item.receiptInputMode !== 'manual' &&
              samePeriod &&
              receiptTons !== null &&
              receiptCount !== null
            ) {
              item.organic.sludgeTotal = receiptTons;
              item.organic.sludgeTruckCount = receiptCount;
              item.receiptCountNote =
                '입고기록 기준 완료 하역 입고량·건수입니다. 자동입력 마감은 최신 완료 하역기록을 우선 표시합니다.';
            } else {
              item.organic.sludgeTruckCount =
                matchingReceiptCount(receipts, item);

              item.receiptCountNote =
                item.receiptInputMode === 'manual'
                  ? (
                      item.organic.sludgeTruckCount === null
                        ? '수동 입력 마감값을 유지합니다. 현재 입고기록과 입고량이 달라 건수는 표시하지 않습니다.'
                        : '수동 입력 마감값을 유지합니다. 입고 건수는 동일 입고량의 완료 하역기록 기준입니다.'
                    )
                  : (
                      item.organic.sludgeTruckCount === null
                        ? '현재 입고기록을 확인하지 못해 마감 입고량을 유지합니다.'
                        : '입고기록 기준 완료 하역 건수입니다. 조회 기간과 입고량이 마감자료와 일치합니다.'
                    );
            }
          } catch { item.receiptCountNote = '입고기록을 확인하지 못했습니다. 마감 입고량과 재고는 그대로 표시합니다.'; }
        }
        const organicRecovery = item && hasCompleteClosedOrganic(item) ? null :
  await recoverOrganicForDate(date, headers, item, getJson);
if (!current()) return null;
cache.set(date, {status: item ? 'complete' : 'missing', item, organicRecovery});
        return item;
      } catch (error) {
        if (current()) cache.set(date, {status: 'error', error: error.message || '마감자료 조회 실패'});
        throw error;
      } finally {
        if (pending.get(date) === promise) pending.delete(date);
        if (current()) notify(date);
      }
    })();
    pending.set(date, promise); notify(date);
    return promise;
  }

  // MORNING_HOLIDAY_COFIRING_SAVED_V1: read only persisted ratios without
  // refreshing organic receipts, changing the selected card, or queuing Agent work.
  async function loadSavedForWorkbook(date, options = {}) {
    if (!dateValid(date) || isBlocked(date)) return null;
    const identity = checkSession();
    if (!identity) throw new Error('로그인이 필요합니다.');
    const existing = cache.get(date);
    if (options.force !== true && existing?.status === 'complete') return existing.item;
    const generation = generations.get(date) || 0;
    if (typeof root.morningMeetingQuerySources?.loadResetStatus === 'function') {
      const reset = await root.morningMeetingQuerySources.loadResetStatus(date);
      if (!reset) throw new Error('선택일의 초기화 상태를 확인하지 못했습니다.');
    }
    if (isBlocked(date)) return null;
    if (checkSession() !== identity) throw new Error('로그인 상태가 바뀌었습니다. 다시 생성해 주세요.');
    const payload = await getJson(API + '?targetDate=' + encodeURIComponent(date), authHeaders());
    if (isBlocked(date)) return null;
    if (checkSession() !== identity) throw new Error('로그인 상태가 바뀌었습니다. 다시 생성해 주세요.');
    if (generation !== (generations.get(date) || 0)) throw new Error('혼소 조정값이 변경되었습니다. 다시 생성해 주세요.');
    return normalizeItem(payload.item, date);
  }

  function valuesForWorkbook(dailyData, options = {}) {
    const savedFirstV3Date = options.targetDate || targetDate();
    const savedFirstV3Closed =
      options.suppressClosedValues === true ||
      (options.targetDate && options.targetDate !== targetDate())
        ? null
        : peek(savedFirstV3Date);

    if (
      options.suppressClosedValues !== true &&
      hasCompleteExistingOrganicValues(dailyData) &&
      !hasCompleteClosedOrganic(savedFirstV3Closed)
    ) {
      return {...(dailyData && typeof dailyData === 'object' ? dailyData : {})};
    }

    const savedFirstDate = options.targetDate || targetDate();
    if (
      options.suppressClosedValues !== true &&
      (!options.targetDate || options.targetDate === targetDate()) &&
      shouldPreserveExistingOrganic(savedFirstDate)
    ) {
      return {...(dailyData && typeof dailyData === 'object' ? dailyData : {})};
    }

    const result = {...(dailyData && typeof dailyData === 'object' ? dailyData : {})};
    for (const key of [...Object.keys(ORGANIC_IDS), ...ALIASES]) delete result[key];
    const saved = options.suppressClosedValues === true ||
      (options.targetDate && options.targetDate !== targetDate()) ? null : peek();
    if (saved) {
      Object.assign(result, saved.organic);
      result.organicDaySiloLevel = saved.organic.organicDaySilo;
      result.organicStorageSiloALevel = saved.organic.organicStorageSiloA;
      result.organicStorageSiloBLevel = saved.organic.organicStorageSiloB;
    }
    return result;
  }

  function renderLegacySavedOrganic(date) {
    const fallback = root.morningMeetingLegacySavedDailyData;
    if (!date || !fallback || typeof fallback.peek !== 'function') return false;
    let saved = null;
    try { saved = fallback.peek(date); } catch { saved = null; }
    if (!saved) return false;
    try { fallback.render?.(date); return true; }
    catch (error) { console.warn('오전회의 유기성 기존 저장값 표시 실패:', error); return false; }
  }
  function syncOrganicEstimateHighlight() {
    // Follow the visible approximation marker, including restored/saved values.
    // Never change quantities or decide whether a sample should be approximate.
    for (const key of ['organicDaySilo', 'organicStorageSiloA', 'organicStorageSiloB', 'organicSiloTotal']) {
      const element = byId(ORGANIC_IDS[key]);
      if (!element) continue;
      if (/^\s*≈/.test(element.textContent || '')) {
        if (element.dataset.organicEstimateHighlight !== 'true') element.dataset.organicEstimateHighlight = 'true';
      } else if ('organicEstimateHighlight' in element.dataset) {
        delete element.dataset.organicEstimateHighlight;
      }
    }
  }
  function renderOrganic() {
    const savedFirstDate = targetDate();
    if (shouldPreserveExistingOrganic(savedFirstDate)) {
      syncOrganicEstimateHighlight();
      return;
    }

    const date = targetDate(), entry = state(date), saved = peek(date), recovery = entry.organicRecovery || null;
    if (!saved && !recovery && date && !isBlocked(date) && renderLegacySavedOrganic(date)) {
      syncOrganicEstimateHighlight();
      const fallbackButton = byId(PREFIX + 'SludgeRefreshButton');
      if (fallbackButton) {
        fallbackButton.disabled = !session || entry.status === 'loading';
        fallbackButton.title = '선택일의 혼소율 마감자료 다시 불러오기 · 기존 저장값 표시 유지';
        fallbackButton.setAttribute('aria-busy', entry.status === 'loading' ? 'true' : 'false');
      }
      return;
    }
    const data = recovery?.organic || saved?.organic || emptyOrganic();
    const approximateKeys = recovery?.approximateKeys || recovery?.estimatedKeys || [];
    const card = byId(PREFIX + 'SludgeCard');
    if (card) {
  card.dataset.source = saved ? 'cofiring-closed-history' : recovery ? 'organic-recovery-v2' : 'cofiring-closed-history';
  card.title = recovery?.note || (saved?.inventoryCorrected ? '선택일의 혼소율 마감자료 · 재고는 마감 당시 확인 보완값 포함 · 원본 계측값과 구분' : '선택일의 혼소율 마감자료 · 재고는 마감 계산의 종료값');
}
    setText(byId(PREFIX + 'SludgeDate'), date ? date + (saved?.inventoryCorrected ? ' · 마감자료 · 확인 보완' : saved ? ' · 마감자료' : recovery ? ' · 저장자료 복구' : ' · 마감자료') : '-');
    for (const [key, id] of Object.entries(ORGANIC_IDS)) {
      const value = data[key], element = byId(id);
      setText(element, value === null ? '-' : (approximateKeys.includes(key) ? '≈' : '') + value.toLocaleString('ko-KR', {
        minimumFractionDigits: key === 'sludgeTruckCount' ? 0 : recovery?.estimatedKeys?.includes(key) ? 3 : 2, maximumFractionDigits: key === 'sludgeTruckCount' ? 0 : recovery?.estimatedKeys?.includes(key) ? 3 : 2
      }) + (key === 'sludgeTruckCount' ? ' 건' : ' t'));
      if (element) element.title = recovery?.fieldNotes?.[key] || (key === 'sludgeTruckCount' ? saved?.receiptCountNote || '마감자료 없음' :
value === null ? '해당 시각의 확인된 계측값이 없습니다.' : date + ' 마감자료');
    }
    syncOrganicEstimateHighlight();
    const countLabel = byId(ORGANIC_IDS.sludgeTruckCount)?.parentElement?.querySelector('span');
    setText(countLabel, '입고 건수');
    const badge = byId(PREFIX + 'SludgeStatus');
    if (badge) {
      const status = entry.status;
      setText(badge, !date || isBlocked(date) ? '조회 대기' : status === 'loading' ? '조회 중' : status === 'error' ? '조회 실패' :
        recovery?.missingKeys?.length ? (approximateKeys.length ? '추정 포함 · 재고 확인' : '재고 확인 필요') :
        status === 'complete' ? (approximateKeys.length ? '추정 포함 · 재확인' : saved?.inventoryCorrected ? '마감값 · 확인 보완' : '마감값') :
        approximateKeys.length ? '추정 포함 · 재확인' : recovery ? '입고/재고 조회' : status === 'missing' ? '마감자료 없음' : '조회 대기');
      badge.className = 'efficiency-morning-meeting-auto-card__badge' +
        (['loading','error'].includes(status) ? ' is-' + status :
          recovery?.missingKeys?.length || approximateKeys.length ? '' : status === 'complete' ? ' is-complete' : '');
      badge.title = recovery?.note || entry.error || (saved ? (saved.inventoryCorrected?'마감 당시 확인한 재고 보완값을 포함합니다. 당시 근거는 혼소율 마감 상세에서 확인하세요. ':'')+'혼소율 메뉴의 저장된 마감값입니다. 입고 건수는 별도 입고기록 기준입니다.' : '혼소율 메뉴에서 해당 날짜를 계산하고 마감 저장해 주세요.');
    }
    const button = byId(PREFIX + 'SludgeRefreshButton');
    if (button) {
      button.disabled = !date || !session || isBlocked(date) || entry.status === 'loading';
      button.title = '선택일 완료 하역기록 · 저장된 DataPARC · 혼소율 추정 근거 다시 확인';
      button.setAttribute('aria-busy', entry.status === 'loading' ? 'true' : 'false');
    }
  }

  async function refresh(options = {}) {
    const date = targetDate();
    const explicit = explicitOrganicRequeryDates.has(date);

    if (!explicit && shouldPreserveExistingOrganic(date)) return null;

    try {
      return await load(date, options);
    } catch {
      return null;
    } finally {
      renderOrganic();
      if (explicit) explicitOrganicRequeryDates.delete(date);
    }
  }

  // MORNING_MEETING_DATE_NAV_SNAPSHOT_ONLY_V1
  // Passive date movement only repaints the selected date from already-restored
  // D1/display state. Current Closed / receipt APIs are loaded only by an
  // explicit user query path.
  function sync() {
    const date = targetDate();
    if (!dateValid(date)) return;
    if (date !== observedDate) observedDate = date;
    notify(date);
  }
  function scheduleSync() {
    if (timer !== null) return;
    timer = root.setTimeout(() => { timer = null; sync(); }, 0);
  }
  function onReset(event) {
    const date = event?.detail?.targetDate;
    if (!dateValid(date)) return;
    if (event.detail.active === true) {
      blockedDates.add(date); invalidate(date); notify(date);
    } else if (blockedDates.delete(date)) {
      invalidate(date); if (date === targetDate()) scheduleSync();
    }
  }
  function reloadChangedCofiringDate(date) {
    if (!dateValid(date)) return;
    // Invalidate even for a non-visible date, including a pending older request.
    // Organic saved-first is a rendering policy, not a co-firing refresh gate.
    invalidate(date);
    if (date === targetDate()) {
      if (isBlocked(date)) { notify(date); return; }
      void load(date, {force: true}).catch(() => {});
    }
  }
  function onClosedChange(event) {
    reloadChangedCofiringDate(event?.detail?.targetDate);
  }
  function onPeriodAdjustmentChange(event) {
    const start = event?.detail?.start, end = event?.detail?.end;
    const date = typeof start === 'string' ? start.slice(0, 10) : '';
    if (!dateValid(date) || start !== date + 'T00:00') return;
    const next = new Date(date + 'T00:00:00Z'); next.setUTCDate(next.getUTCDate() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    if (![nextDate + 'T00:00', nextDate + 'T00:01'].includes(end)) return;
    const savedPeriod = cache.get(date)?.item?.period;
    if (savedPeriod && (savedPeriod.startLocal !== start || savedPeriod.endLocal !== end)) return;
    reloadChangedCofiringDate(date);
  }
  function onAdjustmentStorage(event) {
    const prefix = 'gspo:cofiring-period-adjust:v56:';
    if (typeof event?.key !== 'string' || !event.key.startsWith(prefix)) return;
    try {
      const parts = decodeURIComponent(event.key.slice(prefix.length)).split('|');
      if (parts.length === 2) onPeriodAdjustmentChange({detail: {start: parts[0], end: parts[1]}});
    } catch { /* Ignore unrelated or malformed storage keys. */ }
  }
  function refreshCofiringOnActivation() {
    if (doc.hidden || (!byId('efficiencyMorningMeetingAutoCofiringCard') && !byId(PREFIX + 'SludgeCard'))) return;
    const date = targetDate();
    if (!dateValid(date) || isBlocked(date)) return;
    // Focus/visibility changes are display-only. Do not start a source request.
    // [전체자료] / card refresh still calls refreshOrganicFromClosing explicitly.
    notify(date);
  }
  function initialize() {
    doc.addEventListener('click', event => {
      const button = event.target?.closest?.('button');
      if (!button) return;

      const organicRefresh =
        button.id === PREFIX + 'SludgeRefreshButton';

      const allRefresh =
        button.closest?.('#efficiencyTeamModal') &&
        organicSavedText(button) === '전체자료';

      if (organicRefresh || allRefresh) {
        beginExplicitOrganicRequery(targetDate());
      }
    }, true);

    const relevant = [PANEL, PREFIX + 'SludgeCard', 'efficiencyMorningMeetingAutoCofiringCard'];
    const observer = new MutationObserver(mutations => {
      // Other saved-value renderers can replace text without calling renderOrganic.
      // Observe text changes only for styling; marker attributes are not observed.
      if (mutations.some(m => {
        const element = m.target?.nodeType === 3 ? m.target.parentElement : m.target;
        return element?.closest?.('#' + PREFIX + 'SludgeCard');
      })) syncOrganicEstimateHighlight();
      if (mutations.some(m => m.type === 'attributes' || [...m.addedNodes].some(node =>
        relevant.includes(node.id) || relevant.some(id => node.querySelector?.('#' + id))))) scheduleSync();
    });
    if (doc.body) observer.observe(doc.body, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-morning-meeting-auto-base-date']});
    doc.addEventListener('efficiencyMorningMeetingSteamStatusLoaded', scheduleSync);
    doc.addEventListener('morningMeetingSelectedDateResetStateChanged', onReset);
    doc.addEventListener('morningMeetingResetStateChanged', onReset);
    root.addEventListener('cofiring:closed-history-changed', onClosedChange);
    root.addEventListener('cofiring:period-adjustment-changed', onPeriodAdjustmentChange);
    root.addEventListener('storage', onAdjustmentStorage);
    root.addEventListener('focus', refreshCofiringOnActivation);
    doc.addEventListener('visibilitychange', refreshCofiringOnActivation);
    sync();
  }
  root.morningMeetingClosedCofiring = Object.freeze({version: '20261029-organic-readonly-recovery-v9', targetDate, isBlocked, load, loadSavedForWorkbook, peek, state, refresh, refreshOrganicFromClosing, renderOrganic, valuesForWorkbook});
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', initialize, {once: true}); else initialize();
})(typeof window !== 'undefined' ? window : null);
