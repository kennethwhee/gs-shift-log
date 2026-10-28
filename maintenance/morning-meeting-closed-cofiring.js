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

  // GS_MORNING_ORGANIC_RECEIPT_SILO_RECOVERY_V2_20261029
// Read-only: completed unloading logs + already-saved co-firing DataPARC +
// independently validated saved provisional midnight evidence. Never queries Agent.
function recoveryNextDate(date) {
  if (!dateValid(date)) return '';
  const next = new Date(date + 'T00:00:00Z');
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
function organicRecoveryReceipt(date, data) {
  const start = date + 'T00:00';
  const end = recoveryNextDate(date) + 'T00:00';
  if (!dateValid(date) || data?.ok !== true || data?.source !== 'solid-fuel-unloading' ||
      data?.basis !== 'completed-unloading-departure' ||
      data.receiptStart !== start || data.receiptEnd !== end ||
      number(data.receipts?.organic) === null ||
      !Number.isSafeInteger(data.counts?.organic) || data.counts.organic < 0) return null;
  return {tons: data.receipts.organic, count: data.counts.organic};
}
function organicRecoverySilos(date, response) {
  const empty = {};
  const end = recoveryNextDate(date) + 'T00:00';
  const start = date + 'T00:00';
  const result = response?.result, report = result?.report;
  if (!dateValid(date) || response?.ok !== true || response?.targetDate !== date ||
      response?.saved?.status !== 'complete' || result?.requestId !== response.saved.id ||
      result?.kind !== 'cofiring_period_live_result' ||
      result?.request?.startLocal !== start || result?.request?.endLocal !== end ||
      result?.request?.stepUnit !== 'minute' || result?.request?.stepValue !== 1 ||
      report?.startLocal !== start || report?.endLocal !== end) return empty;

  const keys = {
    organicDaySilo: 'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT',
    organicStorageSiloA: 'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT',
    organicStorageSiloB: 'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'
  };
  const inventory = report.organicInventory;
  if (report.organicInventoryReady === true && inventory?.startLocal === start &&
      inventory?.endLocal === end && inventory?.basis === 'dataparc_period_boundary') {
    for (const key of Object.keys(keys)) {
      const measured = number(inventory.end?.[key]);
      if (measured !== null) empty[key] = measured;
    }
    return empty;
  }
  // A single failed Storage B boundary must not suppress independently GOOD
  // Day Silo / Storage A / Storage B readings at the actual day-end boundary.
  if (!Array.isArray(report.organicInventorySamples)) return empty;
  const samples = report.organicInventorySamples;
  if (samples.length !== 3 || new Set(samples.map(s => s?.key)).size !== 3) return empty;
  const endMs = Date.parse(end + ':00+09:00');
  for (const [key, expectedTag] of Object.entries(keys)) {
    const s = samples.find(sample => sample?.key === key);
    const quality = String(s?.endQuality || '').replace(/\s+/g, '').toLowerCase();
    const observedTime = String(s?.endTime || '');
    const observedMs = /(?:Z|[+-]\d{2}:\d{2})$/i.test(observedTime) ? Date.parse(observedTime) : NaN;
    // A reading must have GOOD quality and be within one minute of the saved 00:00 boundary
    // window. An old value or a false '0' generated by an outage is never used.
    if (s?.tag !== expectedTag || !['good', 'raw,good', 'good,raw'].includes(quality) ||
        number(s?.endValue) === null || !Number.isFinite(observedMs) ||
        observedMs < endMs - 60000 || observedMs > endMs + 60000) continue;
    empty[key] = s.endValue;
  }
  return empty;
}
function organicRecoveryEstimatedBoundary(date, response) {
  const item = response?.item;
  const end = recoveryNextDate(date) + 'T00:00';
  if (response?.ok !== true || !dateValid(date) || item?.targetDate !== date ||
      item?.recordKind !== 'hypothesis' || item?.verificationStatus !== 'unverified' ||
      item?.officialClose !== false ||
      !Number.isSafeInteger(item?.revision) || item.revision < 1) return null;
  const boundaries = Array.isArray(item.estimation?.boundaries) ? item.estimation.boundaries :
    item.assumption ? [item.assumption] : [];
  const found = boundaries.find(row => row?.silo === 'organicStorageSiloB' && row.boundaryLocal === end);
  return number(found?.tons);
}
async function recoverOrganicForDate(date, headers, closed, fetchJson) {
  if (!dateValid(date) || typeof fetchJson !== 'function') return null;
  const start = date + 'T00:00', end = recoveryNextDate(date) + 'T00:00';
  // These are read-only saved-data endpoints. No request creation or polling.
  const urls = [
    '/api/solid-fuel-trouble?' + new URLSearchParams({receiptStart: start, receiptEnd: end}),
    '/api/ois-data-requests?' + new URLSearchParams({action: 'cofiring_period_latest', targetDate: date}),
    '/api/cofiring-provisional-v12?' + new URLSearchParams({targetDate: date})
  ];
  const responses = await Promise.all(urls.map(url =>
    Promise.resolve().then(() => fetchJson(url, headers)).catch(() => null)));
  const receipt = organicRecoveryReceipt(date, responses[0]);
  const measured = organicRecoverySilos(date, responses[1]);
  const estimatedB = organicRecoveryEstimatedBoundary(date, responses[2]);
  const organic = {...emptyOrganic(), ...(closed?.organic || {})};
  const fieldNotes = {}, estimatedKeys = [];
  let hasIndependent = false;
  if (receipt) {
    if (closed?.receiptInputMode !== 'manual' || organic.sludgeTotal === null) {
      organic.sludgeTotal = receipt.tons;
      fieldNotes.sludgeTotal = '완료된 하역기록 합계 · 해당 날짜 00:00부터 다음 날 00:00 미만';
    } else {
      fieldNotes.sludgeTotal = '공식 마감의 수동 입고량 유지 · 하역기록 입고량과 별도';
    }
    organic.sludgeTruckCount = receipt.count;
    fieldNotes.sludgeTruckCount = '완료된 하역기록 건수 · DataPARC 통신상태와 무관';
    hasIndependent = true;
  }
  for (const key of ['organicDaySilo', 'organicStorageSiloA', 'organicStorageSiloB']) {
    if (number(organic[key]) === null && number(measured[key]) !== null) {
      organic[key] = measured[key];
      fieldNotes[key] = end.replace('T', ' ') + ' 저장된 DataPARC 정상 계측값';
      hasIndependent = true;
    }
  }
  if (number(organic.organicStorageSiloB) === null && estimatedB !== null) {
    organic.organicStorageSiloB = estimatedB;
    estimatedKeys.push('organicStorageSiloB');
    fieldNotes.organicStorageSiloB = end.replace('T', ' ') +
      ' 통신오류 보완 · 저장된 혼소율 추정 근거 · 실제 계측값 아님 · 재확인 필요';
    hasIndependent = true;
  }
  const stockKeys = ['organicDaySilo', 'organicStorageSiloA', 'organicStorageSiloB'];
  if (stockKeys.every(key => number(organic[key]) !== null)) {
    const sum = stockKeys.reduce((total, key) => total + organic[key], 0);
    if (number(organic.organicSiloTotal) === null) {
      organic.organicSiloTotal = sum;
      if (estimatedKeys.length) {
        estimatedKeys.push('organicSiloTotal');
        fieldNotes.organicSiloTotal = 'Day Silo + Storage A + Storage B(추정 포함) · 실제 재고 확정 전 재확인 필요';
      } else {
        fieldNotes.organicSiloTotal = '동일 종료시각 3개 Silo 재고 합계';
      }
      hasIndependent = true;
    } else if (Math.abs(organic.organicSiloTotal - sum) > 0.01) {
      fieldNotes.organicSiloTotal = '마감 저장 재고 합계와 개별 Silo의 합계가 다릅니다. 수치를 재확인하세요.';
    }
  }
  if (!hasIndependent) return null;
  const note = estimatedKeys.length
    ? end.replace('T', ' ') + ' Storage B는 통신오류로 저장된 추정값을 사용했습니다. 정확한 값이 아닐 수 있으므로 재확인 필요.'
    : '입고량·건수는 완료 하역기록, Silo는 저장된 정상 DataPARC 또는 공식 마감자료를 사용합니다.';
  return {targetDate: date, organic, fieldNotes, estimatedKeys, note};
}
if (typeof module === 'object' && module.exports) module.exports = {normalizeItem, matchingReceiptCount, organicRecoveryReceipt, organicRecoverySilos, organicRecoveryEstimatedBoundary, recoverOrganicForDate};
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
  function renderOrganic() {
    const savedFirstDate = targetDate();
    if (shouldPreserveExistingOrganic(savedFirstDate)) return;

    const date = targetDate(), entry = state(date), saved = peek(date), recovery = entry.organicRecovery || null;
    if (!saved && !recovery && date && !isBlocked(date) && renderLegacySavedOrganic(date)) {
      const fallbackButton = byId(PREFIX + 'SludgeRefreshButton');
      if (fallbackButton) {
        fallbackButton.disabled = !session || entry.status === 'loading';
        fallbackButton.title = '선택일의 혼소율 마감자료 다시 불러오기 · 기존 저장값 표시 유지';
        fallbackButton.setAttribute('aria-busy', entry.status === 'loading' ? 'true' : 'false');
      }
      return;
    }
    const data = recovery?.organic || saved?.organic || emptyOrganic();
    const card = byId(PREFIX + 'SludgeCard');
    if (card) {
  card.dataset.source = saved ? 'cofiring-closed-history' : recovery ? 'organic-recovery-v2' : 'cofiring-closed-history';
  card.title = recovery?.note || (saved?.inventoryCorrected ? '선택일의 혼소율 마감자료 · 재고는 마감 당시 확인 보완값 포함 · 원본 계측값과 구분' : '선택일의 혼소율 마감자료 · 재고는 마감 계산의 종료값');
}
    setText(byId(PREFIX + 'SludgeDate'), date ? date + (saved?.inventoryCorrected ? ' · 마감자료 · 확인 보완' : saved ? ' · 마감자료' : recovery ? ' · 저장자료 복구' : ' · 마감자료') : '-');
    for (const [key, id] of Object.entries(ORGANIC_IDS)) {
      const value = data[key], element = byId(id);
      setText(element, value === null ? '-' : (recovery?.estimatedKeys?.includes(key) ? '≈' : '') + value.toLocaleString('ko-KR', {
        minimumFractionDigits: key === 'sludgeTruckCount' ? 0 : recovery?.estimatedKeys?.includes(key) ? 3 : 2, maximumFractionDigits: key === 'sludgeTruckCount' ? 0 : recovery?.estimatedKeys?.includes(key) ? 3 : 2
      }) + (key === 'sludgeTruckCount' ? ' 건' : ' t'));
      if (element) element.title = recovery?.fieldNotes?.[key] || (key === 'sludgeTruckCount' ? saved?.receiptCountNote || '마감자료 없음' :
value === null ? '해당 시각의 확인된 계측값이 없습니다.' : date + ' 마감자료');
    }
    const countLabel = byId(ORGANIC_IDS.sludgeTruckCount)?.parentElement?.querySelector('span');
    setText(countLabel, '입고 건수');
    const badge = byId(PREFIX + 'SludgeStatus');
    if (badge) {
      const status = entry.status;
      setText(badge, !date || isBlocked(date) ? '조회 대기' : status === 'loading' ? '조회 중' : status === 'error' ? '조회 실패' :
        status === 'complete' ? (recovery?.estimatedKeys?.length ? '추정 포함 · 재확인' : saved?.inventoryCorrected ? '마감값 · 확인 보완' : '마감값') :
recovery?.estimatedKeys?.length ? '추정 포함 · 재확인' : recovery ? '입고/재고 조회' : status === 'missing' ? '마감자료 없음' : '조회 대기');
      badge.className = 'efficiency-morning-meeting-auto-card__badge' + (['complete','loading','error'].includes(status) ? ' is-' + status : '');
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
      if (mutations.some(m => m.type === 'attributes' || [...m.addedNodes].some(node =>
        relevant.includes(node.id) || relevant.some(id => node.querySelector?.('#' + id))))) scheduleSync();
    });
    if (doc.body) observer.observe(doc.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-morning-meeting-auto-base-date']});
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
  root.morningMeetingClosedCofiring = Object.freeze({version: '20261029-organic-readonly-recovery-v2', targetDate, isBlocked, load, loadSavedForWorkbook, peek, state, refresh, refreshOrganicFromClosing, renderOrganic, valuesForWorkbook});
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', initialize, {once: true}); else initialize();
})(typeof window !== 'undefined' ? window : null);
