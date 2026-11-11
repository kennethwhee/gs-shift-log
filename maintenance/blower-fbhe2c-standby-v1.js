/* FBHE 2C: reuse a completed historical R9 receipt; never create a query.
 * Completion day is known. The physical completion minute remains unknown. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlowerFbhe2cStandby = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const TAG = '204HHL60AP631', KEY = 'gsShiftLog.fbhe2cStandby.v1', API = '/api/blower-history';
  const DAY = '2026-09-16', START = Date.parse(DAY + 'T00:00:00+09:00');
  const SEAM = Date.parse('2026-09-17T00:00:00+09:00'), MEASURED_START = Date.parse(DAY + 'T09:30:00+09:00'), STOP = Date.parse(DAY + 'T09:28:25+09:00');
  const controllers = new Map();
  const time = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
  const seconds = value => Number.isSafeInteger(value) && value >= 0;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const CODES = new Set(['INVALID_RESPONSE', 'AUTH_REQUIRED', 'SESSION_CHANGED', 'READ_ONLY_MOBILE', 'BUSY',
    'STORAGE_UNAVAILABLE', 'SAVED_STATE_UNREADABLE', 'REQUEST_ID_CHANGED', 'ATTESTATION_REQUIRED',
    'PROOF_CHANGED', 'REQUEST_UNCERTAIN', 'READBACK_UNCONFIRMED', ...[
      'FORBIDDEN', 'SOURCE_COVERAGE', 'SOURCE_REQUIRED', 'SOURCE_CHANGED', 'SOURCE_EXCLUDED', 'PREFIX_INVALID',
      'REQUEST_INVALID', 'REQUEST_NOT_FOUND', 'NOT_ELIGIBLE', 'HISTORY_LIMIT', 'OWNER_CHANGED', 'COMPETING_OWNER',
      'TAIL_INVALID', 'TAIL_REQUEST_INVALID', 'EVIDENCE_LIMIT', 'CONFLICT', 'CURRENT_PROOF_CHANGED',
      'SOURCE_CONFLICT', 'RUN_OBSERVED', 'WITNESS_INVALID',
      'ATTESTATION_REQUIRED', 'DERIVATION_INVALID', 'STORAGE_FAILED'].map(value => 'FBHE2C_STANDBY_' + value)]);
  const fail = code => Object.assign(new Error(code), { code });
  const safeCode = value => CODES.has(value) ? value : 'REQUEST_UNCERTAIN';
  function normalizeView(value) {
    if (!value || value.ok !== true || value.assetTag !== TAG || typeof value.eligible !== 'boolean' ||
        value.completionDay !== DAY || value.completionClockKnown !== false || value.quality?.sampleGoodCertified !== false ||
        typeof value.attestationRequired !== 'boolean' ||
        value.applied !== undefined && typeof value.applied !== 'boolean' ||
        value.replayed !== undefined && typeof value.replayed !== 'boolean') throw fail('INVALID_RESPONSE');
    const applied = value.applied === true || value.replayed === true, request = value.request, preview = value.preview;
    if (applied && value.eligible || value.replayed === true && value.applied !== true || value.attestationRequired !== !applied) throw fail('INVALID_RESPONSE');
    const witness = value.witness, tail = value.tail;
    if ((value.eligible || applied || preview || request) && (!hash(value.proofHash) || !request || !id(request.id) || request.status !== 'complete' ||
        Math.floor(time(witness?.lastRunStoppedAt) / 1000) !== STOP / 1000 || witness?.dailyRunningSeconds !== 34105 ||
        time(witness?.zeroWindowEndAt) !== SEAM || time(tail?.startAt) !== MEASURED_START || !(time(tail?.observedAt) >= SEAM) ||
        time(tail?.observedAt) === SEAM && tail?.runningSeconds !== 0 ||
        !seconds(tail?.runningSeconds) || !preview || preview.prefixRunningSeconds !== 0 ||
        preview.tailRunningSeconds !== tail.runningSeconds || preview.totalRunningSeconds !== tail.runningSeconds ||
        !seconds(preview.totalRunningSeconds) || time(preview.observedAt) !== time(tail.observedAt))) throw fail('INVALID_RESPONSE');
    return { eligible: value.eligible, applied, proofHash: hash(value.proofHash) ? value.proofHash : '', completionDay: DAY,
      completionClockKnown: false, request: request ? { id: request.id, status: request.status } : null,
      witness: witness ? { lastRunStoppedAt: witness.lastRunStoppedAt, dailyRunningSeconds: witness.dailyRunningSeconds,
        zeroWindowEndAt: witness.zeroWindowEndAt } : null,
      tail: tail ? { startAt: tail.startAt, observedAt: tail.observedAt, runningSeconds: tail.runningSeconds } : null,
      preview: preview ? { prefixRunningSeconds: 0, tailRunningSeconds: preview.tailRunningSeconds,
        totalRunningSeconds: preview.totalRunningSeconds, observedAt: preview.observedAt } : null,
      attestationRequired: value.attestationRequired === true, code: CODES.has(value.code) ? value.code : '' };
  }
  function attestation(view) { return { version: 1, completionDay: DAY, lastRunStoppedAt: view.witness.lastRunStoppedAt,
    replacementCompletedAfterStop: true, noRestartThroughWindowEnd: true, zeroWindowEndAt: view.witness.zeroWindowEndAt,
    statementCode: 'BELT_COMPLETED_AFTER_LAST_STOP_AND_REMAINED_STANDBY_THROUGH_WINDOW_END' }; }
  function normalizeRecord(value) {
    if (!value || value.version !== 1 || !id(value.requestId) || !hash(value.proofHash) || typeof value.pending !== 'boolean') throw fail('SAVED_STATE_UNREADABLE');
    const a = value.attestation;
    if (a && (a.version !== 1 || a.completionDay !== DAY || Math.floor(time(a.lastRunStoppedAt) / 1000) !== STOP / 1000 ||
        a.replacementCompletedAfterStop !== true || a.noRestartThroughWindowEnd !== true || time(a.zeroWindowEndAt) !== SEAM ||
        a.statementCode !== 'BELT_COMPLETED_AFTER_LAST_STOP_AND_REMAINED_STANDBY_THROUGH_WINDOW_END')) throw fail('SAVED_STATE_UNREADABLE');
    return { version: 1, requestId: value.requestId, proofHash: value.proofHash, pending: value.pending,
      attestation: a ? { version: 1, completionDay: DAY, lastRunStoppedAt: a.lastRunStoppedAt,
        replacementCompletedAfterStop: true, noRestartThroughWindowEnd: true, zeroWindowEndAt: a.zeroWindowEndAt,
        statementCode: 'BELT_COMPLETED_AFTER_LAST_STOP_AND_REMAINED_STANDBY_THROUGH_WINDOW_END' } : null };
  }
  function verified(asset) {
    const api = typeof module === 'object' && module.exports ? require('./blower-unified-refresh.js') : root.BlowerUnifiedRefresh;
    return api?.verifiedFbhe2cStandby?.(asset) || null;
  }
  function verifyReadback(asset, view) {
    const proof = verified(asset), basis = asset?.dataParcRuntimeBasis;
    return Boolean(proof && view?.request && view.preview && proof.r9RequestId === view.request.id &&
      proof.lastRunStoppedAt === view.witness?.lastRunStoppedAt && basis.runningSeconds >= view.preview.totalRunningSeconds &&
      time(basis.observedAt) >= time(view.preview.observedAt));
  }
  function createController(deps) {
    const session = deps.session();
    let record = null, listener = null;
    const state = { phase: 'idle', busy: false, view: null, attested: false, error: '', httpStatus: null,
      readbackVerified: false };
    try { const raw = deps.storage?.getItem(KEY); if (raw) record = normalizeRecord(JSON.parse(raw)); }
    catch { state.phase = 'stopped'; state.error = 'SAVED_STATE_UNREADABLE'; }
    if (record) state.phase = 'resume';
    function emit() { listener?.({ ...state }); }
    function guard() {
      if (state.phase === 'stopped') throw fail('SAVED_STATE_UNREADABLE');
      if (state.busy || deps.isBusy()) throw fail('BUSY');
      ensureSession();
      const asset = deps.getAsset();
      if (asset?.tagNumber !== TAG || asset.enabled === false || asset.enabled === 0) throw fail('INVALID_RESPONSE');
    }
    function ensureSession() {
      if (deps.isMobile()) throw fail('READ_ONLY_MOBILE');
      if (!deps.canWrite() || !session || deps.session() !== session) throw fail('SESSION_CHANGED');
    }
    function save(value) {
      const normalized = normalizeRecord(value), serialized = JSON.stringify(normalized);
      try { deps.storage.setItem(KEY, serialized); if (deps.storage.getItem(KEY) !== serialized) throw Error(); }
      catch { throw fail('STORAGE_UNAVAILABLE'); }
      record = normalized;
    }
    function accept(raw) {
      const view = normalizeView(raw);
      if (record?.requestId && view.request && record.requestId !== view.request.id) throw fail('REQUEST_ID_CHANGED');
      if (view.request && hash(view.proofHash)) save({ version: 1, requestId: view.request.id,
        proofHash: view.proofHash, pending: false, attestation: record?.attestation || null });
      state.view = view; state.attested = false;
      state.phase = view.applied ? 'applied' : view.eligible && view.preview ? 'ready' : 'unavailable';
      return view;
    }
    async function readback(view) {
      state.readbackVerified = await deps.reload(view);
      ensureSession();
      if (!state.readbackVerified) throw fail('READBACK_UNCONFIRMED');
    }
    async function run(operation, uncertain) {
      try { guard(); } catch (error) { state.error = safeCode(error.code); emit(); return false; }
      state.busy = true; state.error = ''; state.httpStatus = null; deps.setBusy(true); emit();
      try { await operation(); return true; }
      catch (error) {
        state.attested = false;
        state.httpStatus = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : null;
        state.error = CODES.has(error?.code) ? error.code : [401, 403].includes(state.httpStatus) ? 'AUTH_REQUIRED'
          : state.httpStatus === 409 ? 'PROOF_CHANGED' : 'REQUEST_UNCERTAIN';
        if (uncertain && record?.pending && state.error !== 'READBACK_UNCONFIRMED') state.phase = 'resume';
        if (['PROOF_CHANGED', 'REQUEST_ID_CHANGED', 'INVALID_RESPONSE'].includes(state.error) || state.httpStatus === 409) state.phase = 'unavailable';
        return false;
      } finally { state.busy = false; deps.setBusy(false); emit(); }
    }
    async function refresh() {
      return run(async () => {
        const suffix = record ? '&requestId=' + encodeURIComponent(record.requestId) : '';
        const raw = await deps.api({ url: API + '?action=fbhe2c_standby_status' + suffix, timeoutMs: 30000 });
        ensureSession(); const view = accept(raw); if (view.applied) await readback(view);
      }, false);
    }
    async function apply() {
      return run(async () => {
        if (!state.attested) throw fail('ATTESTATION_REQUIRED');
        if (record?.pending || state.phase !== 'ready' || !state.view?.eligible || !state.view.preview ||
            !state.view.request || state.view.request.id !== record?.requestId || state.view.proofHash !== record.proofHash)
          throw fail('INVALID_RESPONSE');
        save({ ...record, pending: true, attestation: attestation(state.view) });
        ensureSession();
        const raw = await deps.api({ method: 'POST', timeoutMs: 30000, body: {
          action: 'apply_fbhe2c_standby', requestId: record.requestId, expectedProofHash: record.proofHash,
          confirmation: 'FBHE_2C_STANDBY_20260916', attestation: record.attestation } });
        ensureSession(); const view = accept(raw); if (!view.applied) throw fail('INVALID_RESPONSE'); await readback(view);
      }, true);
    }
    return { refresh, apply, snapshot: () => ({ ...state }), subscribe(fn) { listener = fn; emit(); },
      setAttested(value) { state.attested = value === true && state.phase === 'ready' && !state.busy && !record?.pending; emit(); } };
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
    const section = doc.createElement('section'); section.className = 'fbhe2c-standby';
    section.setAttribute('aria-label', 'FBHE 2C 교체 후 정지 구간 확인');
    const title = doc.createElement('strong'); title.textContent = '#2 FBHE #C · 교체 후 정지 구간 확인';
    const intro = doc.createElement('p'); intro.textContent = '이미 완료된 9/16 RUN 원본의 마지막 정지와 이후 정지 구간을 대조합니다. 새 조회를 만들거나 누적값을 바꾸지 않고 교체 후 누적 근거를 확인합니다.';
    const facts = doc.createElement('dl'), note = doc.createElement('p'), status = doc.createElement('p');
    note.textContent = '교체 완료일은 2026-09-16이며 실제 완료시각은 미기록으로 유지합니다. 09:28:25은 마지막 RUN 정지시각이며 교체 완료시각이 아닙니다. 09:30도 기존 조회 시작이며 완료시각으로 확정하지 않습니다. 개별 샘플의 GOOD 품질 인증을 뜻하지 않습니다.';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const label = doc.createElement('label'), checkbox = doc.createElement('input'), statement = doc.createElement('span');
    checkbox.type = 'checkbox'; checkbox.checked = false;
    statement.textContent = '9/16 09:28:25 정지 이후, 9/17 자정 전에 전체 V-belt 교체를 완료했습니다. 교체 완료 후 9/16 당일, 9/17 자정까지 재기동하지 않고 대기 상태로 두었습니다.';
    label.appendChild(checkbox); label.appendChild(statement); checkbox.addEventListener('change', () => controller.setAttested(checkbox.checked));
    const actions = doc.createElement('div'), check = doc.createElement('button'), apply = doc.createElement('button'); actions.className = 'fbhe2c-standby-actions';
    check.type = apply.type = 'button'; check.className = 'button secondary'; apply.className = 'button primary';
    check.textContent = '기존 RUN 근거 확인 (읽기 전용)'; apply.textContent = '교체 후 누적 근거 반영';
    check.addEventListener('click', () => { void controller.refresh(); }); apply.addEventListener('click', () => { void controller.apply(); });
    actions.appendChild(check); actions.appendChild(apply);
    for (const element of [title, intro, facts, note, label, status, actions]) section.appendChild(element); options.container.appendChild(section);
    controller.subscribe(state => {
      facts.replaceChildren(); const row = (name, value) => { const term = doc.createElement('dt'), detail = doc.createElement('dd'); term.textContent = name; detail.textContent = value; facts.appendChild(term); facts.appendChild(detail); };
      if (state.view?.tail) {
        row('교체 전 마지막 RUN 정지', formatTime(state.view.witness.lastRunStoppedAt) + ' KST');
        row('정지 확인 구간 종료', formatTime(state.view.witness.zeroWindowEndAt) + ' KST');
        row('교체 후 정지 구간 RUN', '0초');
        row('기존 측정 구간 · 그대로 보존', formatTime(state.view.tail.startAt) + ' → ' + formatTime(state.view.tail.observedAt));
        row('기존 RUN 누적 · 값 변경 없음', duration(state.view.preview.totalRunningSeconds));
      }
      const messages = { idle: '먼저 기존 RUN 근거를 확인해 주세요. 조회 생성과 저장은 없습니다.',
        ready: '정지 구간과 기존 누적값을 확인했습니다. 작업 사실을 확인한 뒤 근거만 명시적으로 반영해 주세요.',
        resume: '반영 응답을 확인해야 합니다. 같은 기록의 반영 상태를 읽기 전용으로 확인해 주세요.',
        unavailable: '현재 근거를 확인할 수 없어 반영하지 않았습니다. 기존 누적값은 유지됩니다.', stopped: '보관된 반영 정보를 확인할 수 없어 중단했습니다.',
        applied: state.readbackVerified ? '교체 후 누적 근거 반영과 최신 값 대조를 완료했습니다. 누적값과 완료시각 미기록 상태는 유지합니다.' : '반영 기록을 확인했습니다. 최신 값 대조가 필요합니다.' };
      const errors = { ATTESTATION_REQUIRED: '정지 이후의 교체 완료와 대기 사실을 먼저 확인해 주세요.',
        PROOF_CHANGED: '승인 근거나 누적값이 바뀌었습니다. 같은 기록의 현재 근거를 다시 확인해 주세요.',
        STORAGE_UNAVAILABLE: '브라우저에 반영 정보를 보관할 수 없어 저장을 중단했습니다.', SESSION_CHANGED: '로그인이 바뀌었습니다. 이력을 다시 열어 확인해 주세요.',
        READBACK_UNCONFIRMED: '반영 응답 이후 최신 값 대조를 끝내지 못했습니다. 같은 기록의 결과를 확인해 주세요.' };
      status.textContent = state.busy ? '확인 중입니다.' : errors[state.error] || messages[state.phase];
      if (state.error) status.textContent += ' [' + safeCode(state.error) + (state.httpStatus ? ' · HTTP ' + state.httpStatus : '') + ']';
      if (state.view?.code) status.textContent += ' [' + state.view.code + ']';
      check.textContent = state.phase === 'idle' ? '기존 RUN 근거 확인 (읽기 전용)' : '반영 결과 확인 (읽기 전용)'; check.disabled = state.busy;
      checkbox.checked = state.attested; checkbox.disabled = state.busy || state.phase !== 'ready'; label.hidden = state.phase !== 'ready';
      apply.hidden = state.phase !== 'ready'; apply.disabled = state.busy || !state.attested;
    }); return controller;
  }
  return { TAG, KEY, normalizeView, createController, verifyReadback, mount, formatTime, duration };
});
