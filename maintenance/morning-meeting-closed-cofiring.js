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
  function closedCoalBioRatio(result) {
    const coal = number(result?.heats?.coal);
    const bio = number(result?.heats?.bio);
    return coal !== null && bio !== null && coal + bio > 0
      ? bio / (coal + bio) * 100
      : null;
  }

  function compatClosedUnitSummary(summary, result) {
    const value = summary && typeof summary === 'object' ? {...summary} : {};
    if (value.bioRatio === undefined) value.bioRatio = closedCoalBioRatio(result);
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
    if (value.bioRatio === undefined) value.bioRatio = closedCoalBioRatio(result);
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

  function normalizeItem(item, date) {
    if (item === null) return null;
    const snapshot = item?.snapshot, summary = item?.summary;
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
    const organic = emptyOrganic();
    organic.sludgeTotal = number(snapshot.manual?.receipts?.organic);
    organic.organicSiloTotal = number(snapshot.organicUsage?.endTotal);
    const inventory = Object.hasOwn(item, 'organicInventory') ? item.organicInventory : snapshot.organicInventory;
    const stockKeys = ['organicDaySilo', 'organicStorageSiloA', 'organicStorageSiloB'];
    if (inventory?.startLocal === period.startLocal && inventory?.endLocal === period.endLocal &&
        stockKeys.every(key => number(inventory.end?.[key]) !== null)) {
      const total = stockKeys.reduce((sum, key) => sum + inventory.end[key], 0);
      if (number(inventory.end.total) !== null && Math.abs(total - inventory.end.total) <= 0.000001 &&
          (organic.organicSiloTotal === null || Math.abs(total - organic.organicSiloTotal) <= 0.000001)) {
        for (const key of stockKeys) organic[key] = inventory.end[key];
        organic.organicSiloTotal = total;
      }
    }
    return { targetDate: date, revision: item.revision, updatedAt: String(item.updatedAt || ''),
      source: 'cofiring-closed-history', period: {startLocal: period.startLocal, endLocal: period.endLocal},
      unitOne: unit(compatClosedUnitSummary(summary?.unit1, snapshot?.result?.units?.unit1)), unitTwo: unit(compatClosedUnitSummary(summary?.unit2, snapshot?.result?.units?.unit2)), combined: ratios(compatClosedCombinedSummary(summary?.combined, snapshot?.result?.combined)),
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

  if (typeof module === 'object' && module.exports) module.exports = {normalizeItem, matchingReceiptCount};
  if (!root?.document || root.morningMeetingClosedCofiring) return;
  const doc = root.document, cache = new Map(), pending = new Map(), generations = new Map(), blockedDates = new Set();
  let session = '', observedDate = '', timer = null;
  const byId = id => doc.getElementById(id);
  const setText = (element, value) => { if (element && element.textContent !== value) element.textContent = value; };
  const PANEL = 'efficiencyMorningMeetingWaterPanel';

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
    let identity;
    try { identity = checkSession(); } catch { identity = ''; }
    if (!identity) {
      invalidate(date); cache.set(date, {status: 'error', error: '로그인이 필요합니다.'}); notify(date);
      throw new Error('로그인이 필요합니다.');
    }
    if (isBlocked(date)) { invalidate(date); return null; }
    if (pending.has(date)) return pending.get(date);
    if (options.force !== true && cache.has(date)) {
      const entry = cache.get(date);
      if (entry.status === 'error') throw new Error(entry.error);
      return entry.item || null;
    }
    const generation = generations.get(date) || 0;
    const current = () => generation === (generations.get(date) || 0) && checkSession() === identity && !isBlocked(date);
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
            item.organic.sludgeTruckCount = matchingReceiptCount(receipts, item);
            item.receiptCountNote = item.organic.sludgeTruckCount === null
              ? '현재 입고기록과 마감 입고량이 달라 입고 건수를 표시하지 않습니다.'
              : '입고기록 기준 완료 하역 건수입니다. 조회 기간과 입고량이 마감자료와 일치합니다.';
          } catch { item.receiptCountNote = '입고기록을 확인하지 못했습니다. 마감 입고량과 재고는 그대로 표시합니다.'; }
        }
        if (!current()) return null;
        cache.set(date, {status: item ? 'complete' : 'missing', item});
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

  function valuesForWorkbook(dailyData, options = {}) {
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
    const date = targetDate(), entry = state(date), saved = peek(date);
    if (!saved && date && !isBlocked(date) && renderLegacySavedOrganic(date)) {
      const fallbackButton = byId(PREFIX + 'SludgeRefreshButton');
      if (fallbackButton) {
        fallbackButton.disabled = !session || entry.status === 'loading';
        fallbackButton.title = '선택일의 혼소율 마감자료 다시 불러오기 · 기존 저장값 표시 유지';
        fallbackButton.setAttribute('aria-busy', entry.status === 'loading' ? 'true' : 'false');
      }
      return;
    }
    const data = saved?.organic || emptyOrganic();
    const card = byId(PREFIX + 'SludgeCard');
    if (card) { card.dataset.source = 'cofiring-closed-history'; card.title = '선택일의 혼소율 마감자료 · 재고는 마감 계산의 종료값'; }
    setText(byId(PREFIX + 'SludgeDate'), date ? date + ' · 마감자료' : '-');
    for (const [key, id] of Object.entries(ORGANIC_IDS)) {
      const value = data[key], element = byId(id);
      setText(element, value === null ? '-' : value.toLocaleString('ko-KR', {
        minimumFractionDigits: key === 'sludgeTruckCount' ? 0 : 2, maximumFractionDigits: key === 'sludgeTruckCount' ? 0 : 2
      }) + (key === 'sludgeTruckCount' ? ' 건' : ' t'));
      if (element) element.title = key === 'sludgeTruckCount' ? saved?.receiptCountNote || '마감자료 없음' :
        value === null ? '마감자료에 해당 값이 없습니다.' : date + ' 마감자료';
    }
    const countLabel = byId(ORGANIC_IDS.sludgeTruckCount)?.parentElement?.querySelector('span');
    setText(countLabel, '입고 건수');
    const badge = byId(PREFIX + 'SludgeStatus');
    if (badge) {
      const status = entry.status;
      setText(badge, !date || isBlocked(date) ? '조회 대기' : status === 'loading' ? '조회 중' : status === 'error' ? '조회 실패' :
        status === 'complete' ? '마감값' : status === 'missing' ? '마감자료 없음' : '조회 대기');
      badge.className = 'efficiency-morning-meeting-auto-card__badge' + (['complete','loading','error'].includes(status) ? ' is-' + status : '');
      badge.title = entry.error || (saved ? '혼소율 메뉴의 저장된 마감값입니다. 입고 건수는 별도 입고기록 기준입니다.' : '혼소율 메뉴에서 해당 날짜를 계산하고 마감 저장해 주세요.');
    }
    const button = byId(PREFIX + 'SludgeRefreshButton');
    if (button) {
      button.disabled = !date || !session || isBlocked(date) || entry.status === 'loading';
      button.title = '선택일의 혼소율 마감자료 다시 불러오기';
      button.setAttribute('aria-busy', entry.status === 'loading' ? 'true' : 'false');
    }
  }

  async function refresh(options = {}) {
    const date = targetDate();
    try { return await load(date, options); }
    catch { return null; }
    finally { renderOrganic(); }
  }

  function sync() {
    const date = targetDate();
    if (date !== observedDate) { observedDate = date; notify(date); }
    void refresh();
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
  function onClosedChange(event) {
    const date = event?.detail?.targetDate;
    if (!dateValid(date)) return;
    invalidate(date); if (date === targetDate()) { renderOrganic(); void refresh({force: true}); }
  }
  function initialize() {
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
    root.addEventListener('focus', () => { if (byId(PREFIX + 'SludgeCard')) void refresh({force: true}); });
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden && byId(PREFIX + 'SludgeCard')) void refresh({force: true}); });
    sync();
  }
  root.morningMeetingClosedCofiring = Object.freeze({targetDate, isBlocked, load, peek, state, refresh, renderOrganic, valuesForWorkbook});
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', initialize, {once: true}); else initialize();
})(typeof window !== 'undefined' ? window : null);
