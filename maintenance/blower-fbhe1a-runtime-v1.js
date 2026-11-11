/* FBHE 1A: review a historical stop, explicitly measure again from Sep 5, then apply.
 * Completion day is known. The physical completion minute remains unknown. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlowerFbhe1aRuntime = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const TAG = '104HHL60AP611', KEY = 'gsShiftLog.fbhe1aRuntime.v1', API = '/api/blower-history';
  const HISTORY_KEY = KEY + '.history';
  const DAY = '2026-09-04', START = Date.parse(DAY + 'T00:00:00+09:00');
  const MEASURED_START = Date.parse('2026-09-05T00:00:00+09:00'), OLD_START = Date.parse(DAY + 'T10:50:00+09:00'), STOP = Date.parse(DAY + 'T10:50:39+09:00');
  const controllers = new Map();
  const time = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
  const seconds = value => Number.isSafeInteger(value) && value >= 0;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const CODES = new Set(['INVALID_RESPONSE', 'AUTH_REQUIRED', 'SESSION_CHANGED', 'READ_ONLY_MOBILE', 'BUSY',
    'STORAGE_UNAVAILABLE', 'ARCHIVE_FULL', 'SAVED_STATE_UNREADABLE', 'REQUEST_ID_CHANGED', 'ATTESTATION_REQUIRED',
    'PROOF_CHANGED', 'REQUEST_UNCERTAIN', 'READBACK_UNCONFIRMED', ...[
      'FORBIDDEN', 'SOURCE_COVERAGE', 'SOURCE_REQUIRED', 'SOURCE_CHANGED', 'SOURCE_EXCLUDED', 'PREFIX_INVALID',
      'REQUEST_INVALID', 'REQUEST_NOT_FOUND', 'NOT_ELIGIBLE', 'HISTORY_LIMIT', 'OWNER_CHANGED', 'COMPETING_OWNER',
      'TAIL_INVALID', 'TAIL_REQUEST_INVALID', 'EVIDENCE_LIMIT', 'CONFLICT', 'CURRENT_PROOF_CHANGED',
      'ALREADY_ACTIVE', 'REQUEST_EXPIRED', 'BASELINE_CHANGED', 'BASELINE_INVALID', 'MEASUREMENT_INVALID', 'MEASUREMENT_MISMATCH',
      'SOURCE_CONFLICT', 'SOURCE_REVIEW_REQUIRED', 'WITNESS_INVALID', 'WITNESS_NOT_FOUND',
      'ATTESTATION_REQUIRED', 'DERIVATION_INVALID', 'STORAGE_FAILED'].map(value => 'FBHE1A_RUNTIME_' + value)]);
  const fail = code => Object.assign(new Error(code), { code });
  const safeCode = value => CODES.has(value) ? value : 'REQUEST_UNCERTAIN';
  const RENEWABLE_COMPLETED_CODES = new Set(['BASELINE_CHANGED', 'SOURCE_CHANGED', 'SOURCE_CONFLICT',
    'SOURCE_COVERAGE', 'SOURCE_REQUIRED', 'SOURCE_EXCLUDED', 'SOURCE_REVIEW_REQUIRED', 'OWNER_CHANGED',
    'COMPETING_OWNER', 'CURRENT_PROOF_CHANGED'].map(value => 'FBHE1A_RUNTIME_' + value));
  function normalizeView(value) {
    if (!value || value.ok !== true || value.assetTag !== TAG || typeof value.eligible !== 'boolean' ||
        value.completionDay !== DAY || value.completionClockKnown !== false || !hash(value.proofHash) ||
        value.quality?.sampleGoodCertified !== false || typeof value.attestationRequired !== 'boolean' ||
        value.applied !== undefined && typeof value.applied !== 'boolean' ||
        value.replayed !== undefined && typeof value.replayed !== 'boolean') throw fail('INVALID_RESPONSE');
    const applied = value.applied === true || value.replayed === true, w = value.witness, window = value.measurementWindow;
    const saved = value.saved, preview = value.preview, request = value.request;
    if (applied && value.eligible || value.replayed === true && value.applied !== true || value.attestationRequired !== !applied ||
        value.operatorReportedRestartDay !== undefined && value.operatorReportedRestartDay !== '2026-10-08') throw fail('INVALID_RESPONSE');
    if (!w || !id(w.id) || w.status !== 'complete' || Math.floor(time(w.lastRunStoppedAt) / 1000) !== STOP / 1000 ||
        w.dailyRunningSeconds !== 39040 || time(w.zeroWindowEndAt) !== MEASURED_START ||
        time(saved?.startAt) !== OLD_START || !seconds(w.excludedDurationMilliseconds) || w.excludedDurationMilliseconds <= 0 ||
        w.excludedDurationMilliseconds !== time(w.lastRunStoppedAt) - OLD_START ||
        w.excludedPreReplacementSeconds !== Math.round(w.excludedDurationMilliseconds / 1000) ||
        time(window?.startAt) !== MEASURED_START || !(time(window?.endAt) > MEASURED_START) ||
        !Number.isSafeInteger(window?.chunkCount) || window.chunkCount < 1 || window.chunkCount > 512 ||
        !seconds(saved?.runningSeconds) || saved.runningSeconds < w.excludedPreReplacementSeconds ||
        time(saved.observedAt) !== time(window.endAt)) throw fail('INVALID_RESPONSE');
    if (request && (!id(request.id) || !['pending', 'processing', 'complete', 'failed'].includes(request.status))) throw fail('INVALID_RESPONSE');
    if (value.code === 'FBHE1A_RUNTIME_REQUEST_EXPIRED' && (value.eligible || applied || !request || !['pending', 'processing'].includes(request.status) || preview)) throw fail('INVALID_RESPONSE');
    if (preview && (!request || request.status !== 'complete' || !seconds(preview.measuredRunningSeconds) ||
        preview.previousRunningSeconds !== saved.runningSeconds || preview.excludedPreReplacementSeconds !== w.excludedPreReplacementSeconds ||
        preview.expectedRunningSeconds !== saved.runningSeconds - w.excludedPreReplacementSeconds ||
        !Number.isSafeInteger(preview.differenceSeconds) || preview.differenceSeconds !== preview.measuredRunningSeconds - preview.expectedRunningSeconds ||
        !Number.isSafeInteger(preview.toleranceSeconds) || preview.toleranceSeconds < 2 || preview.toleranceSeconds > 10000 ||
        (value.eligible || applied) && Math.abs(preview.differenceSeconds) > preview.toleranceSeconds || !seconds(preview.appendedRunningSeconds ?? 0) ||
        !seconds(preview.totalRunningSeconds) || preview.totalRunningSeconds !== preview.measuredRunningSeconds + (preview.appendedRunningSeconds ?? 0) ||
        !Number.isFinite(time(preview.observedAt)) ||
        (applied ? time(preview.observedAt) < time(saved.observedAt) : time(preview.observedAt) !== time(saved.observedAt)) ||
        !applied && (preview.appendedRunningSeconds ?? 0) !== 0)) throw fail('INVALID_RESPONSE');
    if (applied && (!request || !preview)) throw fail('INVALID_RESPONSE');
    return { eligible: value.eligible, applied, proofHash: value.proofHash, completionDay: DAY, completionClockKnown: false,
      witness: { id: w.id, status: w.status, lastRunStoppedAt: w.lastRunStoppedAt, dailyRunningSeconds: w.dailyRunningSeconds,
        zeroWindowEndAt: w.zeroWindowEndAt, excludedDurationMilliseconds: w.excludedDurationMilliseconds,
        excludedPreReplacementSeconds: w.excludedPreReplacementSeconds },
      measurementWindow: { startAt: window.startAt, endAt: window.endAt, chunkCount: window.chunkCount },
      saved: { startAt: saved.startAt, runningSeconds: saved.runningSeconds, observedAt: saved.observedAt },
      request: request ? { id: request.id, status: request.status } : null,
      preview: preview ? { measuredRunningSeconds: preview.measuredRunningSeconds, previousRunningSeconds: preview.previousRunningSeconds,
        excludedPreReplacementSeconds: preview.excludedPreReplacementSeconds, expectedRunningSeconds: preview.expectedRunningSeconds,
        differenceSeconds: preview.differenceSeconds, toleranceSeconds: preview.toleranceSeconds,
        appendedRunningSeconds: preview.appendedRunningSeconds ?? 0, totalRunningSeconds: preview.totalRunningSeconds, observedAt: preview.observedAt } : null,
      operatorReportedRestartDay: value.operatorReportedRestartDay || '', attestationRequired: value.attestationRequired,
      code: CODES.has(value.code) ? value.code : '' };
  }
  function attestation(view) { return { version: 1, completionDay: DAY, lastRunStoppedAt: view.witness.lastRunStoppedAt,
    replacementCompletedAfterStop: true, noRestartThroughWindowEnd: true, zeroWindowEndAt: view.witness.zeroWindowEndAt,
    statementCode: 'BELT_COMPLETED_AFTER_LAST_STOP_AND_REMAINED_STANDBY_THROUGH_WINDOW_END', operatorReportedRestartDay: '2026-10-08' }; }
  function normalizeRecord(value) {
    if (!value || value.version !== 1 || typeof value.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value.nonce) ||
        !id(value.witnessRequestId) || !hash(value.proofHash) || value.requestId && !id(value.requestId) || typeof value.pending !== 'boolean') throw fail('SAVED_STATE_UNREADABLE');
    const a = value.attestation;
    if (!a || a.version !== 1 || a.completionDay !== DAY || Math.floor(time(a.lastRunStoppedAt) / 1000) !== STOP / 1000 ||
        a.replacementCompletedAfterStop !== true || a.noRestartThroughWindowEnd !== true || time(a.zeroWindowEndAt) !== MEASURED_START ||
        a.statementCode !== 'BELT_COMPLETED_AFTER_LAST_STOP_AND_REMAINED_STANDBY_THROUGH_WINDOW_END' ||
        a.operatorReportedRestartDay !== undefined && a.operatorReportedRestartDay !== '2026-10-08') throw fail('SAVED_STATE_UNREADABLE');
    return { version: 1, nonce: value.nonce, requestId: value.requestId || '', witnessRequestId: value.witnessRequestId,
      proofHash: value.proofHash, pending: value.pending, attestation: { version: 1, completionDay: DAY,
        lastRunStoppedAt: a.lastRunStoppedAt, replacementCompletedAfterStop: true, noRestartThroughWindowEnd: true,
        zeroWindowEndAt: a.zeroWindowEndAt, statementCode: a.statementCode,
        ...(a.operatorReportedRestartDay ? { operatorReportedRestartDay: a.operatorReportedRestartDay } : {}) } };
  }
  function verified(asset) {
    const api = typeof module === 'object' && module.exports ? require('./blower-unified-refresh.js') : root.BlowerUnifiedRefresh;
    return api?.verifiedFbhe1aRuntime?.(asset) || null;
  }
  function verifyReadback(asset, view) {
    const proof = verified(asset), basis = asset?.dataParcRuntimeBasis;
    return Boolean(proof && view?.request && view.preview && proof.freshRequestId === view.request.id && proof.witnessRequestId === view.witness?.id &&
      proof.lastRunStoppedAt === view.witness?.lastRunStoppedAt && basis.runningSeconds >= view.preview.totalRunningSeconds &&
      time(basis.observedAt) >= time(view.preview.observedAt));
  }
  function createController(deps) {
    const session = deps.session(); let record = null, listener = null;
    const state = { phase: 'idle', busy: false, view: null, attested: false, error: '', httpStatus: null, readbackVerified: false, nonceMissing: false };
    try { const raw = JSON.parse(deps.storage?.getItem(KEY) || 'null'); if (raw) record = normalizeRecord(raw); }
    catch { state.phase = 'stopped'; state.error = 'SAVED_STATE_UNREADABLE'; }
    if (record) state.phase = 'resume';
    function emit() { listener?.({ ...state }); }
    function ensureSession() {
      if (deps.isMobile()) throw fail('READ_ONLY_MOBILE');
      if (!deps.canWrite() || !session || deps.session() !== session) throw fail('SESSION_CHANGED');
    }
    function guard() {
      if (state.phase === 'stopped') throw fail('SAVED_STATE_UNREADABLE');
      if (state.busy || deps.isBusy()) throw fail('BUSY'); ensureSession();
      const asset = deps.getAsset(); if (asset?.tagNumber !== TAG || asset.enabled === false || asset.enabled === 0) throw fail('INVALID_RESPONSE');
    }
    function write(key, value) {
      const text = JSON.stringify(value);
      try { deps.storage.setItem(key, text); if (deps.storage.getItem(key) !== text) throw Error(); }
      catch { throw fail('STORAGE_UNAVAILABLE'); }
    }
    function save(value) { const normalized = normalizeRecord(value); write(KEY, normalized); record = normalized; }
    function accept(raw) {
      const view = normalizeView(raw);
      if (record && view.witness.id !== record.witnessRequestId || record?.requestId && view.request?.id !== record.requestId)
        throw fail('REQUEST_ID_CHANGED');
      if (record && view.request) save({ ...record, requestId: view.request.id,
        proofHash: view.eligible || view.applied ? view.proofHash : record.proofHash, pending: false });
      state.view = view; state.attested = false; state.nonceMissing = false;
      state.phase = view.applied ? 'applied' : !view.eligible ? 'unavailable' : view.request?.status === 'failed' ? 'failed'
        : view.request?.status === 'complete' && view.preview ? 'ready' : view.request ? 'queued' : record ? 'resume' : 'verified';
      return view;
    }
    async function readback(view) { state.readbackVerified = await deps.reload(view); ensureSession(); if (!state.readbackVerified) throw fail('READBACK_UNCONFIRMED'); }
    async function run(operation, uncertain) {
      try { guard(); } catch (error) { state.error = safeCode(error.code); emit(); return false; }
      state.busy = true; state.error = ''; state.httpStatus = null; deps.setBusy(true); emit();
      try { return await operation() !== false; }
      catch (error) {
        state.attested = false;
        state.httpStatus = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : null;
        state.error = CODES.has(error?.code) ? error.code : [401, 403].includes(state.httpStatus) ? 'AUTH_REQUIRED'
          : state.httpStatus === 409 ? 'PROOF_CHANGED' : 'REQUEST_UNCERTAIN';
        if (uncertain && record?.pending && !state.nonceMissing && state.error !== 'READBACK_UNCONFIRMED') state.phase = 'resume';
        if (state.httpStatus === 409 || ['REQUEST_ID_CHANGED', 'INVALID_RESPONSE'].includes(state.error) || !uncertain && state.phase === 'ready') state.phase = 'unavailable';
        return false;
      } finally { state.busy = false; deps.setBusy(false); emit(); }
    }
    async function refresh() {
      return run(async () => {
        const suffix = record?.requestId ? '&requestId=' + encodeURIComponent(record.requestId)
          : record ? '&nonce=' + encodeURIComponent(record.nonce) : '';
        let raw;
        try { raw = await deps.api({ url: API + '?action=fbhe1a_runtime_status' + suffix, timeoutMs: 30000 }); }
        catch (error) {
          ensureSession();
          if (record && !record.requestId && error?.status === 404 && error.code === 'FBHE1A_RUNTIME_REQUEST_NOT_FOUND') {
            state.nonceMissing = true; state.phase = 'unavailable';
          }
          throw error;
        }
        ensureSession(); const view = accept(raw); if (view.applied) await readback(view);
      }, false);
    }
    async function start() {
      return run(async () => {
        if (state.nonceMissing) throw fail('INVALID_RESPONSE');
        if (record?.requestId) throw fail('REQUEST_ID_CHANGED');
        if (!record) {
          if (!state.attested) throw fail('ATTESTATION_REQUIRED');
          if (state.phase !== 'verified' || !state.view?.eligible || state.view.request) throw fail('INVALID_RESPONSE');
          save({ version: 1, nonce: deps.nonce(), witnessRequestId: state.view.witness.id, requestId: '',
            proofHash: state.view.proofHash, attestation: attestation(state.view), pending: true });
        } else save({ ...record, pending: true });
        ensureSession();
        const raw = await deps.api({ method: 'POST', timeoutMs: 30000, body: { action: 'start_fbhe1a_runtime',
          nonce: record.nonce, expectedProofHash: record.proofHash, witnessRequestId: record.witnessRequestId, attestation: record.attestation } });
        ensureSession(); accept(raw);
      }, true);
    }
    async function apply() {
      return run(async () => {
        if (!state.attested) throw fail('ATTESTATION_REQUIRED');
        if (record?.pending || state.phase !== 'ready' || !state.view?.eligible || !state.view.preview ||
            state.view.request?.id !== record?.requestId || state.view.proofHash !== record.proofHash) throw fail('INVALID_RESPONSE');
        save({ ...record, pending: true }); ensureSession();
        const raw = await deps.api({ method: 'POST', timeoutMs: 30000, body: { action: 'apply_fbhe1a_runtime',
          requestId: record.requestId, expectedProofHash: record.proofHash, confirmation: 'FBHE_1A_RUNTIME_20260904',
          attestation: record.attestation } });
        ensureSession(); const view = accept(raw); if (!view.applied) throw fail('INVALID_RESPONSE'); await readback(view);
      }, true);
    }
    function canRenew() { return Boolean(record && (state.nonceMissing && !record.requestId && state.phase === 'unavailable' ||
      record.requestId && state.view?.request?.id === record.requestId && ['unavailable', 'failed'].includes(state.phase) &&
      (state.view.request.status === 'failed' || state.view.request.status === 'complete' && RENEWABLE_COMPLETED_CODES.has(state.view.code) ||
        ['pending', 'processing'].includes(state.view.request.status) && state.view.code === 'FBHE1A_RUNTIME_REQUEST_EXPIRED'))); }
    async function renew() {
      return run(async () => {
        if (!canRenew()) throw fail('INVALID_RESPONSE');
        if (record.requestId && state.view?.code === 'FBHE1A_RUNTIME_REQUEST_EXPIRED') {
          const latest = await deps.api({ url: API + '?action=fbhe1a_runtime_status&requestId=' + encodeURIComponent(record.requestId), timeoutMs: 30000 });
          ensureSession(); const existing = accept(latest);
          if (existing.applied) { await readback(existing); return false; }
          if (existing.code !== 'FBHE1A_RUNTIME_REQUEST_EXPIRED' || existing.eligible || !['pending', 'processing'].includes(existing.request?.status)) return false;
        }
        if (!record.requestId) {
          let missing = false;
          try {
            const existing = await deps.api({ url: API + '?action=fbhe1a_runtime_status&nonce=' + encodeURIComponent(record.nonce), timeoutMs: 30000 });
            ensureSession(); accept(existing);
          } catch (error) {
            ensureSession();
            if (error?.status === 404 && error.code === 'FBHE1A_RUNTIME_REQUEST_NOT_FOUND') missing = true;
            else throw error;
          }
          if (!missing) return false;
        }
        const raw = await deps.api({ url: API + '?action=fbhe1a_runtime_status&witnessRequestId=' + encodeURIComponent(record.witnessRequestId), timeoutMs: 30000 });
        ensureSession(); const view = normalizeView(raw);
        if (!view.eligible || view.applied || view.request || view.witness.id !== record.witnessRequestId) throw fail('INVALID_RESPONSE');
        let history; try { history = JSON.parse(deps.storage.getItem(HISTORY_KEY) || '[]'); if (!Array.isArray(history)) throw Error(); history = history.map(normalizeRecord); }
        catch { throw fail('SAVED_STATE_UNREADABLE'); }
        const alreadyArchived = history.some(item => JSON.stringify(item) === JSON.stringify(record));
        if (!alreadyArchived && history.length >= 10) throw fail('ARCHIVE_FULL');
        if (!alreadyArchived) write(HISTORY_KEY, [...history, record]);
        write(KEY, null); record = null;
        state.view = view; state.attested = false; state.readbackVerified = false; state.nonceMissing = false; state.phase = 'verified';
      }, false);
    }
    return { refresh, start, apply, renew, canRenew, snapshot: () => ({ ...state }), subscribe(fn) { listener = fn; emit(); },
      hasPendingNonce: () => Boolean(record && !record.requestId),
      setAttested(value) { state.attested = value === true && ['verified', 'ready'].includes(state.phase) && !state.busy && !record?.pending; emit(); } };
  }
  function formatTime(value) { return Number.isFinite(time(value)) ? new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date(value)) : '미확인'; }
  function duration(value) { return seconds(value) ? value.toLocaleString('ko-KR') + '초 (' + (value / 3600).toLocaleString('ko-KR', { maximumFractionDigits: 4 }) + '시간)' : '미확인'; }
  function mount(options) {
    if (!options.container || options.asset?.tagNumber !== TAG || !options.canWrite() || options.isMobile()) return null;
    let entry = controllers.get(TAG);
    if (!entry || entry.session !== options.session()) { entry = { session: options.session(), controller: createController(options) }; controllers.set(TAG, entry); }
    const controller = entry.controller, doc = options.document;
    const section = doc.createElement('section'); section.className = 'fbhe1a-runtime';
    section.setAttribute('aria-label', 'FBHE 1A 교체 후 RUN 다시 측정');
    const title = doc.createElement('strong'); title.textContent = '#1 FBHE #A · 교체 후 RUN 다시 측정';
    const intro = doc.createElement('p'); intro.textContent = '기존 9/4 운전구간 원본과 현재 저장 기준을 확인한 뒤, 9/5 자정부터 저장된 조회 종료까지 RUN을 새로 측정합니다. 조회와 반영은 별도 버튼으로 실행합니다.';
    const facts = doc.createElement('dl'), note = doc.createElement('p'), status = doc.createElement('p');
    note.textContent = '교체 완료일은 2026-09-04이며 실제 완료시각은 미기록으로 유지합니다. 10:50:39은 마지막 RUN 정지시각입니다. 담당자가 확인한 재기동 날짜는 10/8이며 정확한 기동시각을 확정하지 않습니다. 새 실측값만 저장하고 기존값 차감은 비교용입니다. 개별 샘플의 GOOD 품질 인증을 뜻하지 않습니다.';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const label = doc.createElement('label'), checkbox = doc.createElement('input'), statement = doc.createElement('span');
    checkbox.type = 'checkbox'; checkbox.checked = false;
    statement.textContent = '9/4 10:50:39 정지 이후 9/5 자정 전에 전체 V-belt 교체를 완료했고, 9/5 자정까지 재기동하지 않고 대기 상태로 두었습니다. 재기동 날짜는 10/8로 확인했으며 시각은 미확인입니다.';
    label.appendChild(checkbox); label.appendChild(statement); checkbox.addEventListener('change', () => controller.setAttested(checkbox.checked));
    const actions = doc.createElement('div'), check = doc.createElement('button'), start = doc.createElement('button'), apply = doc.createElement('button'), renew = doc.createElement('button');
    actions.className = 'fbhe1a-runtime-actions';
    for (const button of [check, start, apply, renew]) { button.type = 'button'; button.className = 'button secondary'; actions.appendChild(button); }
    apply.className = 'button primary'; check.textContent = '기존 RUN 근거 확인 (읽기 전용)';
    start.textContent = '교체 후 RUN 다시 측정'; apply.textContent = '확인한 교체 후 누적 반영'; renew.textContent = '새 기준 확인 (읽기 전용)';
    check.addEventListener('click', () => { void controller.refresh(); }); start.addEventListener('click', () => { void controller.start(); });
    apply.addEventListener('click', () => { void controller.apply(); }); renew.addEventListener('click', () => { void controller.renew(); });
    for (const element of [title, intro, facts, note, label, status, actions]) section.appendChild(element); options.container.appendChild(section);
    controller.subscribe(state => {
      facts.replaceChildren(); const row = (name, value) => { const term = doc.createElement('dt'), detail = doc.createElement('dd'); term.textContent = name; detail.textContent = value; facts.appendChild(term); facts.appendChild(detail); };
      if (state.view) {
        row('교체 후 정지 확인 구간', formatTime(state.view.witness.lastRunStoppedAt) + ' → ' + formatTime(state.view.witness.zeroWindowEndAt));
        row('기존 조회 시작 · 완료시각 아님', formatTime(state.view.saved.startAt));
        row('기존 조회의 교체 전 RUN · 비교용', duration(state.view.witness.excludedPreReplacementSeconds));
        row('현재 저장된 RUN', duration(state.view.saved.runningSeconds));
        row('새로 측정할 구간', formatTime(state.view.measurementWindow.startAt) + ' → ' + formatTime(state.view.measurementWindow.endAt));
      }
      if (state.view?.preview) {
        const p = state.view.preview;
        row('새로 측정한 교체 후 RUN', duration(p.measuredRunningSeconds));
        row('기존값 − 교체 전 RUN · 비교용', duration(p.expectedRunningSeconds));
        row('원본의 초 단위 반올림 비교', '차이 ' + p.differenceSeconds + '초 · 검증 허용범위 ' + p.toleranceSeconds + '초');
        if (p.appendedRunningSeconds) row('반영 후 이어서 측정된 RUN', duration(p.appendedRunningSeconds));
        row(state.view.applied ? '현재 검증된 교체 후 누적' : '반영할 교체 후 누적', duration(p.totalRunningSeconds));
      }
      const messages = { idle: '먼저 기존 RUN 근거를 확인해 주세요. 조회를 시작하거나 저장하지 않습니다.',
        verified: '현재 기준을 확인했습니다. 작업 사실을 체크한 뒤 새 RUN 측정을 명시적으로 시작해 주세요.',
        queued: '기존 접수로 RUN을 측정 중입니다. 같은 접수의 결과를 확인해 주세요.',
        ready: '새 측정값과 비교 결과를 확인했습니다. 작업 사실을 다시 확인한 뒤 별도로 반영해 주세요.',
        resume: '요청 응답이 불확실합니다. 같은 접수의 처리 결과를 먼저 확인해 주세요.',
        unavailable: '현재 근거나 저장 기준이 바뀌어 반영할 수 없습니다. 기존 값과 접수는 보존됩니다.',
        failed: '새 RUN 측정이 실패했습니다. 기존 저장값과 접수 기록은 유지합니다.', stopped: '보관된 접수 정보를 확인할 수 없어 중단했습니다.',
        applied: state.readbackVerified ? '새 실측 누적 반영과 최신 값 대조를 완료했습니다. 완료시각은 미기록으로 유지합니다.' : '반영 기록을 확인했습니다. 최신 값 대조가 필요합니다.' };
      const errors = { ATTESTATION_REQUIRED: '정지 이후의 교체 완료와 대기 사실을 먼저 확인해 주세요.', STORAGE_UNAVAILABLE: '브라우저에 접수 정보를 보관할 수 없어 요청을 중단했습니다.',
        ARCHIVE_FULL: '이전 접수 10건을 보존 중이어서 새 조회 준비를 중단했습니다.', SESSION_CHANGED: '로그인이 바뀌었습니다. 이력을 다시 열어 확인해 주세요.',
        FBHE1A_RUNTIME_MEASUREMENT_MISMATCH: '새 실측값과 기존값 대조가 허용범위를 벗어났습니다. 비교 결과만 표시하며 반영하지 않았습니다.',
        FBHE1A_RUNTIME_BASELINE_CHANGED: '측정 대기 중 저장 기준이 바뀌었습니다. 기존 값과 접수는 보존하며 새 조회는 자동 실행하지 않습니다.',
        FBHE1A_RUNTIME_WITNESS_NOT_FOUND: '이 사용자의 완료된 9/4 운전구간 조회를 찾지 못했습니다. 새 조회는 자동 실행하지 않습니다.',
        FBHE1A_RUNTIME_ALREADY_ACTIVE: '같은 기준으로 접수된 재측정이 있습니다. 기존 접수의 결과를 먼저 확인해 주세요.',
        FBHE1A_RUNTIME_REQUEST_EXPIRED: '기존 재측정 접수의 처리 기한이 지났습니다. 접수를 보존한 채 새 기준을 읽기 전용으로 확인할 수 있습니다. 새 측정은 별도 확인 후에만 시작합니다.',
        READBACK_UNCONFIRMED: '반영 응답 후 최신 값 대조를 끝내지 못했습니다. 같은 접수의 결과를 확인해 주세요.' };
      status.textContent = state.busy ? '확인 중입니다.' : errors[state.error] || errors[state.view?.code] || messages[state.phase];
      if (state.error) status.textContent += ' [' + safeCode(state.error) + (state.httpStatus ? ' · HTTP ' + state.httpStatus : '') + ']';
      if (state.view?.code) status.textContent += ' [' + state.view.code + ']';
      check.textContent = state.phase === 'idle' ? '기존 RUN 근거 확인 (읽기 전용)' : '기존 접수 결과 확인 (읽기 전용)'; check.disabled = state.busy;
      checkbox.checked = state.attested; checkbox.disabled = state.busy || !['verified', 'ready'].includes(state.phase); label.hidden = !['verified', 'ready'].includes(state.phase);
      start.hidden = state.nonceMissing || state.phase !== 'verified' && !controller.hasPendingNonce(); start.disabled = state.busy || !controller.hasPendingNonce() && !state.attested;
      start.textContent = controller.hasPendingNonce() ? '같은 접수 다시 확인' : '교체 후 RUN 다시 측정';
      apply.hidden = state.phase !== 'ready'; apply.disabled = state.busy || !state.attested;
      renew.hidden = !controller.canRenew(); renew.disabled = state.busy;
    }); return controller;
  }
  return { TAG, KEY, HISTORY_KEY, normalizeView, createController, verifyReadback, mount, formatTime, duration };
});
