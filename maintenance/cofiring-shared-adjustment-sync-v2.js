/* One exact-period adjustment history, shared by both desktop entry points.
 * No dailyDATA/OIS query, no copying adjusted quantities back into the raw close.
 */
(function (root) {
  'use strict';
  const VERSION = '20261002-bidirectional-v2';
  const CHANGE = 'cofiring:period-adjustment-changed';
  const STORAGE = 'gspo:cofiring-period-adjust:v56:';
  const CARD = 'efficiencyMorningMeetingAutoCofiringCard';
  const BUTTON = 'morningMeetingCofiringAdjustmentButton';
  const FUELS = ['coal', 'bio', 'organic', 'manure'];
  const UNITS = ['unit1', 'unit2'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const number = value => typeof value === 'number' && Number.isFinite(value);
  function validDate(value) {
    return /^20\d{2}-\d{2}-\d{2}$/.test(value || '') &&
      Number.isFinite(Date.parse(value + 'T00:00:00Z')) &&
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  }
  function samePeriod(a, b) {
    return !!a?.startLocal && !!a?.endLocal && a.startLocal === b?.startLocal && a.endLocal === b?.endLocal;
  }
  function headers() {
    const value = new Headers(root.getShiftLogAuthHeaders?.() || {});
    if (!value.get('Authorization')) {
      const token = root.getShiftLogSessionToken?.();
      if (token) value.set('Authorization', 'Bearer ' + token);
    }
    value.set('Accept', 'application/json');
    // The shared editor merges headers with object spread, so return an object.
    return Object.fromEntries(value.entries());
  }
  function identity(value) { return new Headers(value || {}).get('Authorization') || ''; }
  function mobile() {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(root.navigator?.userAgent || '') ||
      (root.navigator?.platform === 'MacIntel' && root.navigator?.maxTouchPoints > 1);
  }
  function publish(spec, source) {
    if (!spec?.startLocal || !spec?.endLocal || typeof root.CustomEvent !== 'function') return;
    root.dispatchEvent?.(new root.CustomEvent(CHANGE, {detail: {
      start: spec.startLocal, end: spec.endLocal, source: source || 'shared-adjustment'
    }}));
  }
  function storagePeriod(event) {
    if (typeof event?.key !== 'string' || !event.key.startsWith(STORAGE)) return null;
    try {
      const parts = decodeURIComponent(event.key.slice(STORAGE.length)).split('|');
      return parts.length === 2 ? {startLocal: parts[0], endLocal: parts[1]} : null;
    } catch { return null; }
  }

  function contextFromClosedItem(item, date) {
    const snapshot = item?.snapshot;
    if (!validDate(date) || item?.targetDate !== date || snapshot?.targetDate !== date ||
        snapshot?.schemaVersion !== 1 || !Number.isSafeInteger(item?.revision) || item.revision < 1 ||
        !item?.sourceRequestId || item.sourceRequestId !== snapshot.sourceRequestId) {
      throw new Error('선택일의 마감 원본자료를 확인하지 못했습니다. 혼소율 카드에서 다시 조회해 주세요.');
    }
    const period = snapshot.period;
    const next = new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    if (period?.startLocal !== date + 'T00:00' ||
        ![next + 'T00:00', next + 'T00:01'].includes(period?.endLocal)) {
      throw new Error('선택일과 마감자료의 조회 기간이 다릅니다.');
    }
    // Never use effectiveResult as the baseline: it may already be adjusted.
    const original = item.effectiveOriginalResult || snapshot.originalResult ||
      (snapshot.result?.adjustment?.applied === true ? null : snapshot.result);
    if (!original || original.adjustment?.applied === true ||
        !UNITS.every(unit => FUELS.every(fuel => number(original.units?.[unit]?.[fuel]?.quantity) &&
          original.units[unit][fuel].quantity >= 0))) {
      throw new Error('조정 전 원본 연료 사용량이 없어 이중 조정을 방지했습니다. 원본자료를 먼저 확인해 주세요.');
    }
    for (const key of ['startLocal', 'endLocal']) {
      if (original.period?.[key] !== undefined && original.period[key] !== period[key]) {
        throw new Error('원본 계산값과 마감자료의 조회 기간이 다릅니다.');
      }
    }
    if (!UNITS.every(unit => FUELS.every(fuel => number(snapshot.settings?.[unit]?.[fuel]?.calorific) &&
        snapshot.settings[unit][fuel].calorific > 0))) {
      throw new Error('마감 당시 호기별 발열량을 확인하지 못했습니다.');
    }
    const hours = (Date.parse(period.endLocal + ':00Z') - Date.parse(period.startLocal + ':00Z')) / 3600000;
    if (original.period?.durationHours !== undefined &&
        (!number(original.period.durationHours) || Math.abs(original.period.durationHours - hours) > 0.000001)) {
      throw new Error('마감자료의 기간 환산시간이 올바르지 않습니다.');
    }
    const result = clone(original);
    result.period = {...result.period, startLocal: period.startLocal, endLocal: period.endLocal, durationHours: hours};
    return {targetDate: date, revision: item.revision, sourceRequestId: item.sourceRequestId,
      result, settings: clone(snapshot.settings), spec: {startLocal: period.startLocal, endLocal: period.endLocal}};
  }

  // A server read updates the display/cache only. It never republishes a save
  // event or submits a new adjustment, preventing feedback/double-adjust loops.
  function createCalculatorSync(options) {
    let disposed = false, sequence = 0, pending = null, lastSignature = '', dirty = true;
    const getContext = () => { try { return options.getContext?.() || null; } catch { return null; } };
    const signature = ctx => JSON.stringify([ctx?.spec, ctx?.settings, ctx?.result?.units, ctx?.identity]);
    const visible = () => !disposed && !root.document?.hidden && options.isVisible?.() !== false;
    async function refresh({force = false, invalidate = false} = {}) {
      if (invalidate) { sequence++; dirty = true; pending = null; }
      const ctx = getContext();
      if (!visible() || !ctx?.result || !ctx?.settings || !ctx?.spec || !ctx?.identity) {
        dirty = true; return false;
      }
      if (ctx.suspended) {
        dirty = true;
        if (force) options.onDeferred?.();
        return false;
      }
      const key = signature(ctx);
      if (pending?.key === key && pending.result === ctx.result) return pending.promise;
      if (!force && !dirty && lastSignature === key) return true;
      const token = ++sequence;
      const current = () => {
        const now = getContext();
        return token === sequence && visible() && !!now && !now.suspended &&
          now.result === ctx.result && signature(now) === key;
      };
      const task = (async () => {
        try {
          const api = root.CofiringPeriodAdjustmentV56;
          if (typeof api?.resolveServer !== 'function') throw new Error('공용 혼소조정 기능을 새로고침해 주세요.');
          const value = await api.resolveServer(ctx.result, ctx.settings, ctx.spec, options.getHeaders, current);
          if (!current() || value?.stale) return false;
          if (!value?.loaded) throw new Error(value?.error || '공용 혼소조정 저장값을 확인하지 못했습니다.');
          options.onResult?.(value.result || ctx.result, {adjusted: value.adjusted === true});
          lastSignature = key; dirty = false;
          return true;
        } catch (error) {
          if (current()) { dirty = true; options.onError?.(error); }
          return false;
        } finally {
          if (pending?.token === token) pending = null;
        }
      })();
      pending = {key, result: ctx.result, token, promise: task};
      return task;
    }
    function changed(spec) {
      const ctx = getContext();
      if (samePeriod(ctx?.spec, spec)) void refresh({force: true, invalidate: true});
    }
    const onChange = event => changed({startLocal: event?.detail?.start, endLocal: event?.detail?.end});
    const onStorage = event => { const spec = storagePeriod(event); if (spec) changed(spec); };
    const activate = () => { if (visible()) void refresh({force: true}); };
    root.addEventListener?.(CHANGE, onChange);
    root.addEventListener?.('storage', onStorage);
    root.addEventListener?.('focus', activate);
    root.document?.addEventListener?.('visibilitychange', activate);
    return {refresh, dispose() {
      disposed = true; sequence++; pending = null;
      root.removeEventListener?.(CHANGE, onChange);
      root.removeEventListener?.('storage', onStorage);
      root.removeEventListener?.('focus', activate);
      root.document?.removeEventListener?.('visibilitychange', activate);
    }};
  }

  function createMorningEditor() {
    const doc = root.document;
    let context = null, contextIdentity = '', opening = false, epoch = 0, editor = null, disposed = false;
    let invalidated = false;
    const provider = () => root.morningMeetingClosedCofiring;
    const date = () => provider()?.targetDate?.() || '';
    const blocked = day => provider()?.isBlocked?.(day) === true ||
      root.isMorningMeetingSelectedDateResetActive?.(day) === true;
    const cardVisible = () => {
      const card = doc?.getElementById?.(CARD);
      return !!card && card.isConnected !== false && !doc.hidden && !card.closest?.('[hidden], [aria-hidden="true"]');
    };
    const allowed = day => !disposed && validDate(day) && !mobile() && !blocked(day) && !!identity(headers());
    function currentContext() {
      if (!context || invalidated || !allowed(context.targetDate) || !cardVisible() ||
          date() !== context.targetDate || identity(headers()) !== contextIdentity) return null;
      // A newer closing must not be silently adjusted using an older baseline.
      if ((provider()?.peek?.(context.targetDate)?.revision || 0) > context.revision) return null;
      return context;
    }
    function syncButton(button = doc?.getElementById?.(BUTTON)) {
      if (!button) return;
      const day = date(), ready = typeof root.CofiringPeriodAdjustmentV56?.create === 'function';
      button.disabled = opening || !ready || !allowed(day);
      const active = provider()?.peek?.(day)?.adjustmentApplied === true;
      if (button.classList?.contains?.('is-active') !== active) button.classList?.toggle?.('is-active', active);
      const title = opening ? '선택일의 마감 원본자료 확인 중' : mobile() ? '혼소 조정은 로그인한 PC 화면에서 가능합니다.' :
        '혼소율 계산과 같은 조정값을 사용합니다. 적용·원복하면 양쪽 화면에 반영됩니다.';
      if (button.title !== title) button.title = title;
    }
    function saved() {
      // The context is intentionally retained even if the operator changed date
      // while the write was in flight. Notify the SAVED period, never the new one.
      if (!context) return;
      publish(context.spec, 'morning-meeting-card');
      syncButton();
      if (date() === context.targetDate && cardVisible()) {
        root.showToast?.('공용 혼소조정 저장 완료 · 오전회의와 혼소율 계산에 반영합니다.');
      }
    }
    function ensureEditor() {
      if (editor) return editor;
      const container = doc.getElementById(CARD);
      editor = root.CofiringPeriodAdjustmentV56.create({container, getHeaders: headers,
        getContext: currentContext, onApply: saved, onReset: saved,
        onMessage: message => root.alert?.(message)});
      if (!editor) throw new Error('공용 혼소조정 창을 열지 못했습니다.');
      return editor;
    }
    async function open() {
      if (opening || disposed || editor?.isBusy?.() || editor?.isOpen?.()) return false;
      const day = date();
      if (!allowed(day) || !cardVisible()) return false;
      opening = true; syncButton();
      const token = ++epoch, auth = headers(), session = identity(auth);
      const current = () => token === epoch && allowed(day) && cardVisible() && date() === day && identity(headers()) === session;
      const controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
      const timer = root.setTimeout?.(() => controller?.abort(), 12000);
      try {
        if (!root.CofiringPeriodAdjustmentV56?.create) throw new Error('공용 혼소조정 기능을 새로고침해 주세요.');
        const response = await root.fetch('/api/cofiring-closed-history?targetDate=' + encodeURIComponent(day), {
          method: 'GET', headers: auth, cache: 'no-store', credentials: 'same-origin',
          ...(controller ? {signal: controller.signal} : {})
        });
        const payload = await response.json();
        if (!current()) return false;
        if (!response.ok || payload?.ok !== true) throw new Error(payload?.message || '마감 원본자료 조회에 실패했습니다.');
        context = contextFromClosedItem(payload.item, day); contextIdentity = session; invalidated = false;
        await ensureEditor().open();
        return true;
      } catch (error) {
        if (current()) root.alert?.(error?.name === 'AbortError' ? '원본자료 조회 시간이 초과됐습니다. 다시 시도해 주세요.' :
          error?.message || '공용 혼소조정 창을 열지 못했습니다.');
        return false;
      } finally {
        root.clearTimeout?.(timer);
        if (token === epoch) { opening = false; syncButton(); }
      }
    }
    const onClosed = event => {
      if (context && event?.detail?.targetDate === context.targetDate) invalidated = true;
      syncButton();
    };
    const onReset = event => {
      if (context && event?.detail?.targetDate === context.targetDate && event?.detail?.active === true) invalidated = true;
      syncButton();
    };
    doc?.addEventListener?.('morningMeetingClosedCofiringChanged', syncButtonEvent);
    doc?.addEventListener?.('morningMeetingSelectedDateResetStateChanged', onReset);
    doc?.addEventListener?.('morningMeetingResetStateChanged', onReset);
    root.addEventListener?.('cofiring:closed-history-changed', onClosed);
    root.addEventListener?.('focus', syncButtonEvent);
    function syncButtonEvent() { syncButton(); }
    return {open, syncButton, dispose() {
      disposed = true; epoch++; editor?.dispose?.();
      doc?.removeEventListener?.('morningMeetingClosedCofiringChanged', syncButtonEvent);
      doc?.removeEventListener?.('morningMeetingSelectedDateResetStateChanged', onReset);
      doc?.removeEventListener?.('morningMeetingResetStateChanged', onReset);
      root.removeEventListener?.('cofiring:closed-history-changed', onClosed);
      root.removeEventListener?.('focus', syncButtonEvent);
    }};
  }
  const api = {version: VERSION, samePeriod, contextFromClosedItem, createCalculatorSync, createMorningEditor, publish};
  if (!root.CofiringSharedAdjustmentSyncV2) {
    root.CofiringSharedAdjustmentSyncV2 = api;
    if (root.document) api.morning = createMorningEditor();
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis === 'object' ? globalThis : this);
