/* BLOWER_SCHEDULE_V1 — authenticated, server-clocked, one-slot browser scheduling. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlowerScheduleV1 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 'blower-schedule-v1';
  const DEVICE_KEY = 'gsShiftLog.blowerSchedule.device.v1';
  const RECEIPT_KEY = 'gsShiftLog.blowerSchedule.receipt.v1';
  const LOCK_NAME = 'gsShiftLog.blower-unified-refresh';
  const FOUR_HOURS = 4 * 3600000, KST = 9 * 3600000;
  const STATUS_INTERVAL = 5 * 60000, MAX_TICK_GAP = 90000;
  const SLOT_WINDOW = 120000, RUN_LIMIT = 10 * 60000;
  const HEX = /^[a-f0-9]{64}$/;
  const TERMINAL = new Set(['complete', 'partial', 'failed', 'interrupted']);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
  const iso = value => new Date(value).toISOString();
  function fail(code, message, status = 400) {
    const error = new Error(message); error.code = code; error.status = status; return error;
  }
  function slotAt(now) {
    return finite(now) ? Math.floor((now + KST) / FOUR_HOURS) * FOUR_HOURS - KST : NaN;
  }
  function validSlot(value) {
    const parsed = time(value);
    return Number.isFinite(parsed) && iso(parsed) === value && slotAt(parsed) === parsed;
  }
  function readReceipt(raw) {
    if (!raw) return null;
    try {
      const item = JSON.parse(raw);
      const fields = ['version', 'slotKey', 'runToken', 'employeeNo', 'claimedAt'];
      if (!item || Object.keys(item).length !== fields.length || fields.some(key => !own(item, key)) ||
          item.version !== 1 || !validSlot(item.slotKey) || !HEX.test(item.runToken) ||
          typeof item.employeeNo !== 'string' || !item.employeeNo || item.employeeNo.length > 100 ||
          !Number.isFinite(time(item.claimedAt))) return null;
      return item;
    } catch (_) { return null; }
  }
  function validateBatchReceipt(value) {
    if (!value || value.version !== 1 || !Number.isInteger(value.requestedCount) ||
        value.requestedCount < 0 || value.requestedCount > 24 ||
        !Array.isArray(value.items) || !Array.isArray(value.upToDateTags) ||
        value.items.length + value.upToDateTags.length !== value.requestedCount) {
      throw fail('SCHEDULE_RECEIPT_INVALID', '자동조회 요청 기록을 확인할 수 없습니다.');
    }
    const tags = new Set(), ids = new Set();
    const acceptTag = tag => typeof tag === 'string' && /^[A-Z0-9]{1,40}$/.test(tag) && !tags.has(tag);
    for (const item of value.items) {
      if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9:_-]{1,200}$/.test(item.id) ||
          ids.has(item.id) || !acceptTag(item.assetTag)) {
        throw fail('SCHEDULE_RECEIPT_INVALID', '자동조회 요청 식별자가 올바르지 않습니다.');
      }
      ids.add(item.id); tags.add(item.assetTag);
    }
    for (const tag of value.upToDateTags) {
      if (!acceptTag(tag)) throw fail('SCHEDULE_RECEIPT_INVALID', '자동조회 설비 기록이 중복되었습니다.');
      tags.add(tag);
    }
    return value;
  }

  function createController(options) {
    const o = options || {}, core = o.core, storage = o.storage, locks = o.locks;
    if (!core || typeof o.api !== 'function' || typeof o.identity !== 'function' || !storage) {
      throw new Error('Blower schedule dependencies are missing.');
    }
    const clock = o.clock || Date.now;
    const monotonicNow = o.monotonicNow || (() => performance.now());
    const sleep = o.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const onState = typeof o.onState === 'function' ? o.onState : () => {};
    let stopped = false, generation = 0, rememberedIdentity = '', lastTick = null;
    let anchor = null, lastStatusMono = -Infinity, lastRecoveryMono = -Infinity;
    let status = null, phase = 'idle', busy = false, managing = false, message = '', errorCode = '';
    let active = null;

    function identity() {
      const value = o.identity();
      if (!value || typeof value.token !== 'string' || !value.token ||
          !['string', 'number'].includes(typeof value.employeeNo) || !String(value.employeeNo)) return null;
      return { token: value.token, employeeNo: String(value.employeeNo) };
    }
    function identityKey(value) { return value ? `${value.employeeNo}\n${value.token}` : ''; }
    function getDevice() {
      const key = storage.getItem(DEVICE_KEY);
      return typeof key === 'string' && HEX.test(key) ? key : '';
    }
    function receiptKey(employeeNo) { return `${RECEIPT_KEY}.${encodeURIComponent(employeeNo)}`; }
    function receiptOwners() {
      const raw = storage.getItem(`${RECEIPT_KEY}.owners`);
      if (!raw) return [];
      let list;
      try { list = JSON.parse(raw); } catch (_) {}
      if (!Array.isArray(list) || list.length > 12 || new Set(list).size !== list.length ||
          list.some(value => typeof value !== 'string' || !value || value.length > 100)) {
        throw fail('SCHEDULE_RECEIPT_INVALID', '자동조회 사용자 기록을 확인할 수 없습니다.');
      }
      return list;
    }
    function getReceipt(employeeNo) {
      const raw = storage.getItem(receiptKey(employeeNo)), item = readReceipt(raw);
      if (raw && !item) throw fail('SCHEDULE_RECEIPT_INVALID', '저장된 자동조회 기록을 확인할 수 없습니다.');
      if (item && item.employeeNo !== employeeNo) throw fail('SCHEDULE_RECEIPT_INVALID', '자동조회 사용자 기록이 일치하지 않습니다.');
      return item;
    }
    function saveReceipt(item) {
      const owners = receiptOwners();
      if (!owners.includes(item.employeeNo)) {
        if (owners.length >= 12) throw fail('SCHEDULE_RECEIPT_LIMIT', '이전 자동조회 기록을 먼저 확인해 주세요.');
        owners.push(item.employeeNo);
        storage.setItem(`${RECEIPT_KEY}.owners`, JSON.stringify(owners));
      }
      storage.setItem(receiptKey(item.employeeNo), JSON.stringify(item));
      if (storage.getItem(receiptKey(item.employeeNo)) !== JSON.stringify(item)) throw fail('SCHEDULE_STORAGE_UNAVAILABLE', '자동조회 기록을 저장할 수 없습니다.');
    }
    function clearReceipt(item) {
      const current = getReceipt(item.employeeNo);
      if (current && current.runToken === item.runToken && current.slotKey === item.slotKey &&
          current.employeeNo === item.employeeNo) {
        storage.removeItem(receiptKey(item.employeeNo));
        const owners = receiptOwners().filter(owner => owner !== item.employeeNo);
        storage.setItem(`${RECEIPT_KEY}.owners`, JSON.stringify(owners));
      }
    }
    function snapshot() {
      let configured = false;
      try { configured = Boolean(getDevice()); } catch (_) {}
      return { version: VERSION, phase, busy: busy || managing, message, error: errorCode, configured,
        status: status ? { ...status } : null };
    }
    function emit(nextPhase, text = '', code = '') {
      if (nextPhase) phase = nextPhase;
      message = text; errorCode = code;
      try { onState(snapshot()); } catch (_) {}
    }
    function scope(pin, deadline = Infinity) {
      const epoch = generation;
      return {
        pin,
        assert() {
          if (stopped || identityKey(identity()) !== identityKey(pin)) {
            throw fail('WRITE_ACCESS_CHANGED', '로그인 상태가 변경되어 자동조회를 중단했습니다.', 401);
          }
          if (epoch !== generation) throw fail('SCHEDULE_SETTINGS_CHANGED', '자동조회 설정이 변경되었습니다.', 409);
          const now = monotonicNow();
          if (!finite(now) || now > deadline) throw fail('SCHEDULE_RUN_EXPIRED', '자동조회 대기시간을 초과했습니다.', 403);
        }
      };
    }
    async function request(ctx, config) {
      ctx.assert();
      const response = await o.api({ url: '/api/blower-history', ...config }, ctx.pin.token);
      ctx.assert();
      return response;
    }
    async function schedule(ctx, operation, extra = {}) {
      const deviceKey = getDevice();
      const data = await request(ctx, { method: 'POST', body: {
        action: 'scheduled_refresh', operation, ...(deviceKey ? { deviceKey } : {}), ...extra
      } });
      if (data?.ok !== true || data.version !== VERSION) {
        throw fail('SCHEDULE_RESPONSE_INVALID', '자동조회 설정 응답을 확인할 수 없습니다.');
      }
      return data;
    }
    function updateStatus(data) {
      const server = time(data.serverNow), mono = monotonicNow();
      if (!Number.isFinite(server) || !finite(mono) || typeof data.enabled !== 'boolean' ||
          typeof data.thisDevice !== 'boolean' || !Number.isInteger(data.revision) || data.revision < 0 ||
          (data.nextSlotAt && !validSlot(data.nextSlotAt))) {
        throw fail('SCHEDULE_STATUS_INVALID', '자동조회 기준시각 또는 설정을 확인할 수 없습니다.');
      }
      // No response bodies or authentication fields are exposed to the adapter.
      status = { version: VERSION, serverNow: data.serverNow, enabled: data.enabled,
        thisDevice: data.thisDevice, revision: data.revision, nextSlotAt: data.nextSlotAt || '',
        latestSlot: data.latestSlot || null };
      anchor = { server, mono }; lastStatusMono = mono;
      return status;
    }
    function serverNow() {
      if (!anchor) return NaN;
      const delta = monotonicNow() - anchor.mono;
      return finite(delta) && delta >= 0 && delta <= STATUS_INTERVAL + MAX_TICK_GAP ? anchor.server + delta : NaN;
    }
    async function statusFor(ctx) {
      const data = await schedule(ctx, 'status');
      updateStatus(data);
      return snapshot();
    }
    async function refreshStatus() {
      const pin = identity();
      if (stopped || !pin) { status = null; anchor = null; emit('signed_out'); return snapshot(); }
      const ctx = scope(pin);
      try { await statusFor(ctx); emit(status.enabled && status.thisDevice ? 'ready' : 'disabled'); }
      catch (error) { emit('error', error.message, error.code || 'SCHEDULE_STATUS_FAILED'); }
      return snapshot();
    }
    function newKey() {
      const value = o.randomKey?.();
      if (typeof value !== 'string' || !HEX.test(value)) throw fail('SCHEDULE_RANDOM_UNAVAILABLE', '자동조회 PC 식별자를 만들 수 없습니다.');
      return value;
    }
    async function register(confirmation = {}) {
      if (busy || managing || stopped) return snapshot();
      if (confirmation.confirmedPhysicalBco1 !== true) throw fail('SCHEDULE_PC_CONFIRMATION_REQUIRED', 'BCO1 컴퓨터에서 등록해 주세요.');
      const pin = identity();
      if (!pin) throw fail('WRITE_ACCESS_CHANGED', '로그인 후 등록해 주세요.', 401);
      if (!locks?.request) throw fail('SCHEDULE_LOCK_UNAVAILABLE', '이 브라우저에서는 자동조회를 사용할 수 없습니다.');
      generation += 1; managing = true;
      emit('settings', '자동조회 PC 설정을 저장합니다.');
      const ctx = scope(pin);
      try {
        await statusFor(ctx);
        if (!getDevice()) {
          const key = newKey(); storage.setItem(DEVICE_KEY, key);
          if (getDevice() !== key) throw fail('SCHEDULE_STORAGE_UNAVAILABLE', '자동조회 PC 설정을 저장할 수 없습니다.');
        }
        const data = await schedule(ctx, 'register', { expectedRevision: status.revision, confirmedPhysicalBco1: true });
        updateStatus(data);
        rememberedIdentity = identityKey(pin);
        lastTick = { mono: monotonicNow(), wall: clock(), server: serverNow() };
        emit('ready', '다음 예약시각부터 자동조회합니다.');
      } finally {
        managing = false;
        try { onState(snapshot()); } catch (_) {}
      }
      return snapshot();
    }
    async function disable() {
      if (busy || managing || stopped) return snapshot();
      const pin = identity();
      if (!pin) throw fail('WRITE_ACCESS_CHANGED', '로그인 후 설정을 변경해 주세요.', 401);
      generation += 1; managing = true;
      emit('settings', '자동조회를 해제합니다.');
      const ctx = scope(pin);
      try {
        await statusFor(ctx);
        const data = await schedule(ctx, 'disable', { expectedRevision: status.revision });
        updateStatus(data);
        lastTick = null;
        emit('disabled');
      } finally {
        managing = false;
        try { onState(snapshot()); } catch (_) {}
      }
      return snapshot();
    }
    function receiptBody(item) { return { slotKey: item.slotKey, runToken: item.runToken }; }
    function validateCheck(data, item, purpose) {
      if (data.allowed !== true || data.slotKey !== item.slotKey || data.purpose !== purpose ||
          !['running', ...TERMINAL].includes(data.state) || !Number.isFinite(time(data.claimedAt))) {
        throw fail('SCHEDULE_CHECK_INVALID', '자동조회 실행 권한을 확인할 수 없습니다.', 403);
      }
      return data;
    }
    async function check(ctx, item, purpose) {
      return validateCheck(await schedule(ctx, 'check', { ...receiptBody(item), purpose }), item, purpose);
    }
    async function finish(ctx, item, result) {
      const data = await schedule(ctx, 'finish', { ...receiptBody(item), ...result });
      if (data.slotKey !== item.slotKey || !TERMINAL.has(data.state)) {
        throw fail('SCHEDULE_FINISH_INVALID', '자동조회 완료 기록을 확인할 수 없습니다.');
      }
      clearReceipt(item);
      // Completion is already durable. A status-refresh outage cannot turn it
      // into a failed run or trigger result application again.
      try { await statusFor(ctx); } catch (_) {}
      emit(data.state, data.state === 'complete' ? '자동조회가 완료되었습니다.' : '자동조회 결과를 확인해 주세요.');
      return data;
    }
    function statusItems(data, ids) {
      if (data?.ok !== true || !Array.isArray(data.items) || data.items.length !== ids.length ||
          new Set(data.items.map(item => String(item?.id || ''))).size !== ids.length ||
          data.items.some(item => !ids.includes(String(item?.id || '')) || item.requestType !== 'blower_runtime_probe' ||
            !['pending', 'processing', 'complete', 'failed'].includes(item.status))) {
        throw fail('SCHEDULE_REQUEST_MISMATCH', '자동조회 요청 상태가 등록 기록과 일치하지 않습니다.');
      }
    }
    function ioFor(ctx, item, tracking) {
      return {
        clock: monotonicNow, sleep,
        assertWritable: () => ctx.assert(),
        progress: text => { ctx.assert(); emit('running', text); },
        api: async config => {
          ctx.assert();
          let next = config || {};
          if (next.body?.action === 'create_blower_runtime_probe_batch') {
            if (tracking.createAttempted) throw fail('SCHEDULE_CREATE_REPLAY', '같은 자동조회를 다시 등록하지 않습니다.');
            tracking.createAttempted = true;
            next = { ...next, body: { ...next.body, scheduledRefresh: { ...receiptBody(item), deviceKey: getDevice() } } };
          }
          const data = await request(ctx, next);
          if (/^\/api\/ois-data-requests\?action=status_batch(?:&|$)/.test(next.url || '')) {
            const parsed = new URL(next.url, 'https://schedule.invalid');
            const ids = (parsed.searchParams.get('ids') || '').split(',');
            statusItems(data, ids);
          }
          return data;
        }
      };
    }
    async function applyReceipt(ctx, item, receipt) {
      const validated = validateBatchReceipt(receipt), io = ioFor(ctx, item, { createAttempted: true });
      const pending = validated.items.map(entry => ({ id: entry.id, requestType: 'blower_runtime_probe', status: 'pending' }));
      const settled = pending.length ? await core.waitRequests(pending, io, {
        settleFailures: true, sleep, clock: monotonicNow, timeoutMs: RUN_LIMIT, pendingTimeoutMs: 180000
      }) : [];
      const byId = new Map(settled.map(entry => [String(entry.id), entry]));
      let completedCount = validated.upToDateTags.length, failedCount = 0;
      let cursor = 0, fatal = null;
      const verified = [];
      // Verify details for these exact receipt IDs; no broad reads or query creation.
      const worker = async () => {
        while (!fatal && cursor < validated.items.length) {
          const expected = validated.items[cursor++];
          ctx.assert();
          const entry = byId.get(expected.id);
          if (!entry || entry.requestType !== 'blower_runtime_probe') throw fail('SCHEDULE_REQUEST_MISMATCH', '자동조회 요청 종류가 일치하지 않습니다.');
          if (entry.status === 'failed') { failedCount += 1; continue; }
          if (entry.status !== 'complete') throw fail('SCHEDULE_REQUEST_MISMATCH', '완료되지 않은 자동조회 결과입니다.');
          const data = await request(ctx, { url: `/api/ois-data-requests?id=${encodeURIComponent(expected.id)}` });
          const actual = data?.item;
          if (data?.ok !== true || actual?.id !== expected.id || actual.requestType !== 'blower_runtime_probe' ||
              actual.status !== 'complete' || actual.probe?.requestId !== expected.id || actual.probe?.assetTag !== expected.assetTag) {
            throw fail('SCHEDULE_REQUEST_MISMATCH', '자동조회 결과의 설비가 등록 기록과 일치하지 않습니다.');
          }
          verified.push(expected);
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, validated.items.length) }, () => worker().catch(error => { fatal ||= error; })));
      if (fatal) throw fatal;
      // Complete identity validation before any recovered result is applied.
      cursor = 0;
      const applyWorker = async () => {
        while (!fatal && cursor < verified.length) {
          const expected = verified[cursor++];
          try {
            const applied = await request(ctx, { method: 'POST', body: { action: 'dataparc_runtime_sync', requestId: expected.id } });
            if (applied?.ok !== true) throw fail('SCHEDULE_APPLY_INVALID', '자동조회 결과 저장을 확인할 수 없습니다.');
            completedCount += 1;
          } catch (cause) {
            if (cause.code === 'WRITE_ACCESS_CHANGED' || [401, 403].includes(Number(cause.status))) { fatal ||= cause; return; }
            failedCount += 1;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, verified.length) }, applyWorker));
      if (fatal) throw fatal;
      await request(ctx, {});
      return finish(ctx, item, { status: failedCount ? (completedCount ? 'partial' : 'failed') : 'complete',
        targetCount: validated.requestedCount, completedCount, failedCount });
    }
    async function recover(ctx, item) {
      emit('recovering', '이전 자동조회 결과를 확인합니다.');
      const started = monotonicNow();
      let lastError = null, confirmedAbsent = false;
      // A timed-out create may still commit. Re-read its server receipt; never POST create again.
      while (monotonicNow() - started <= 30000) {
        ctx.assert();
        let data;
        try { data = await check(ctx, item, 'resume'); }
        catch (error) {
          if (error.code === 'WRITE_ACCESS_CHANGED' || error.code === 'SCHEDULE_RUN_EXPIRED') throw error;
          // This server code is returned only after owner/device/nonce checks.
          // Its resume window has expired; the old slot can never create again.
          if (Number(error.status) === 409 && error.code === 'run_expired') {
            clearReceipt(item); emit('interrupted', '복구 기한이 지난 자동조회 기록을 정리했습니다.'); return;
          }
          lastError = error;
          confirmedAbsent = Number(error.status) === 404 && error.code === 'run_not_found';
        }
        if (data) {
          if (TERMINAL.has(data.state)) {
            clearReceipt(item);
            try { await statusFor(ctx); } catch (_) {}
            emit(data.state); return data;
          }
          if (data.batchReceipt) return applyReceipt(ctx, item, data.batchReceipt);
          lastError = null;
          confirmedAbsent = false;
        }
        if (monotonicNow() - started >= 30000) break;
        await sleep(Math.min(2000, 30000 - (monotonicNow() - started)));
      }
      if (lastError) {
        if (confirmedAbsent) { clearReceipt(item); emit('interrupted', '서버에 등록되지 않은 자동조회 시작 기록을 정리했습니다.'); return; }
        throw lastError;
      }
      return finish(ctx, item, { status: 'interrupted', targetCount: 0, completedCount: 0, failedCount: 0 });
    }
    async function run(ctx, slotKey) {
      const item = { version: 1, slotKey, runToken: newKey(), employeeNo: ctx.pin.employeeNo, claimedAt: iso(serverNow()) };
      saveReceipt(item); // Synchronous durable intent precedes the only claim request.
      const tracking = { createAttempted: false };
      let acquired = false;
      try {
        const claimed = await schedule(ctx, 'claim', receiptBody(item));
        if (claimed.acquired === false) { clearReceipt(item); emit('ready', '이번 예약은 이미 처리되었거나 다른 조회가 진행 중입니다.'); return; }
        if (claimed.acquired !== true || !Number.isFinite(time(claimed.claimedAt))) {
          throw fail('SCHEDULE_CLAIM_INVALID', '자동조회 시작 기록을 확인할 수 없습니다.');
        }
        acquired = true;
        item.claimedAt = claimed.claimedAt; saveReceipt(item);
        const verified = await check(ctx, item, 'create');
        if (verified.state !== 'running' || verified.batchReceipt) return recover(ctx, item);
        const io = ioFor(ctx, item, tracking);
        const logs = await core.refreshLogsForRuntime(io, { sleep });
        const data = await io.api({});
        if (!Array.isArray(data?.assets) || !Number.isFinite(time(data.generatedAt))) {
          throw fail('SCHEDULE_ASSETS_INVALID', 'Blower 조회 기준을 확인할 수 없습니다.');
        }
        const plan = core.plan(data.assets, new Date(data.generatedAt));
        const results = await core.executeDataParcBatch(plan.tasks, io);
        await io.api({});
        const all = [...results, ...plan.skipped];
        const completedCount = all.filter(entry => entry.status === 'complete').length;
        const failedCount = all.filter(entry => entry.status === 'failed').length;
        const result = completedCount === plan.targetCount && logs.complete !== false ? 'complete' :
          failedCount === plan.targetCount && plan.targetCount ? 'failed' : 'partial';
        return await finish(ctx, item, { status: result, targetCount: plan.targetCount, completedCount, failedCount });
      } catch (error) {
        ctx.assert();
        if (!acquired && ['blower_busy', 'outside_slot_window', 'configuration_changed', 'device_not_designated'].includes(error.code)) {
          clearReceipt(item); emit('ready', '이번 예약은 다른 조회 또는 설정 변경으로 건너뜁니다.'); return;
        }
        if (tracking.createAttempted || !acquired) return recover(ctx, item);
        await finish(ctx, item, { status: 'failed', targetCount: 0, completedCount: 0, failedCount: 0 });
        throw error;
      }
    }
    async function withLock(pin, operation) {
      if (!locks?.request) { emit('error', '이 브라우저에서는 자동조회를 사용할 수 없습니다.', 'SCHEDULE_LOCK_UNAVAILABLE'); return; }
      return locks.request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) { emit('waiting', '다른 탭의 Blower 조회가 진행 중입니다.'); return; }
        const ctx = scope(pin, monotonicNow() + RUN_LIMIT);
        ctx.assert(); busy = true; emit('running');
        try { return await operation(ctx); }
        finally { busy = false; try { onState(snapshot()); } catch (_) {} }
      });
    }
    async function tickOnce() {
      if (stopped || managing) return snapshot();
      const pin = identity(), key = identityKey(pin);
      const mono = monotonicNow(), wall = clock();
      if (!pin) {
        if (rememberedIdentity) generation += 1;
        rememberedIdentity = ''; lastTick = null; anchor = null; status = null;
        emit('signed_out'); return snapshot();
      }
      if (!finite(mono) || !finite(wall)) { lastTick = null; emit('error', '시각을 확인할 수 없습니다.', 'SCHEDULE_CLOCK_INVALID'); return snapshot(); }
      let refreshed = false;
      if (key !== rememberedIdentity) {
        generation += 1; rememberedIdentity = key; lastTick = null; anchor = null;
        await statusFor(scope(pin));
        refreshed = true;
      }
      const previous = lastTick;
      const continuous = previous && mono >= previous.mono && mono - previous.mono <= MAX_TICK_GAP &&
        Math.abs((wall - previous.wall) - (mono - previous.mono)) <= 2000;
      // Capture due-crossing on the old trusted anchor before a lightweight refresh.
      const beforeRefresh = serverNow();
      let due = continuous && finite(previous.server) && finite(beforeRefresh) && slotAt(beforeRefresh) > previous.server &&
        beforeRefresh - slotAt(beforeRefresh) < SLOT_WINDOW ? iso(slotAt(beforeRefresh)) : '';
      if (!refreshed && (!continuous || mono - lastStatusMono >= STATUS_INTERVAL || !finite(beforeRefresh))) {
        await statusFor(scope(pin));
        const updated = serverNow();
        if (!continuous || !finite(beforeRefresh) || Math.abs(updated - beforeRefresh) > 2000) due = '';
      }
      // Re-check after network awaits as well: a suspended response must not
      // revive a boundary that was observed before the page froze.
      if (due && (!previous || monotonicNow() - previous.mono > MAX_TICK_GAP ||
          !finite(serverNow()) || serverNow() - Date.parse(due) >= SLOT_WINDOW)) due = '';
      lastTick = { mono: monotonicNow(), wall: clock(), server: serverNow() };
      const receipt = getReceipt(pin.employeeNo);
      if (receipt) {
        if (monotonicNow() - lastRecoveryMono >= 30000) {
          lastRecoveryMono = monotonicNow();
          await withLock(pin, ctx => recover(ctx, receipt));
        }
        return snapshot();
      }
      if (!getDevice() || !status?.enabled || status.thisDevice !== true) { emit('disabled'); return snapshot(); }
      if (due) await withLock(pin, ctx => run(ctx, due));
      else emit('ready');
      return snapshot();
    }
    function tick() {
      if (active) return active;
      active = tickOnce().catch(error => {
        if (error.code === 'SCHEDULE_SETTINGS_CHANGED') return snapshot();
        emit(error.code === 'WRITE_ACCESS_CHANGED' ? 'signed_out' : 'error', error.message, error.code || 'SCHEDULE_FAILED');
        return snapshot();
      }).finally(() => { active = null; });
      return active;
    }
    function stop() {
      stopped = true; generation += 1; lastTick = null; anchor = null;
      emit('stopped');
    }
    return { tick, refreshStatus, register, disable, snapshot, stop };
  }
  return { VERSION, DEVICE_KEY, RECEIPT_KEY, LOCK_NAME, slotAt, readReceipt, validateBatchReceipt, createController };
});
