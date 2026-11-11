/* Limestone 2A: reuse an existing historical R9 receipt; never create a query.
 * Completion day is known. The physical completion minute remains unknown. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlowerLimestone2aFirstRun = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const TAG = '203HRJ01AN601', KEY = 'gsShiftLog.limestone2aFirstRun.v1', API = '/api/blower-history';
  const DAY = '2026-09-19', START = Date.parse(DAY + 'T00:00:00+09:00');
  const SEAM = Date.parse('2026-09-20T00:00:00+09:00'), FIRST = Date.parse(DAY + 'T09:58:26+09:00');
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
      'ATTESTATION_REQUIRED', 'DERIVATION_INVALID', 'STORAGE_FAILED'].map(value => 'LIME2A_FIRST_RUN_' + value)]);
  const fail = code => Object.assign(new Error(code), { code });
  const safeCode = value => CODES.has(value) ? value : 'REQUEST_UNCERTAIN';
  function normalizeView(value) {
    if (!value || value.ok !== true || value.assetTag !== TAG || typeof value.eligible !== 'boolean' ||
        value.completionDay !== DAY || value.completionClockKnown !== false) throw fail('INVALID_RESPONSE');
    const applied = value.applied === true || value.replayed === true;
    const request = value.request, preview = value.preview;
    if ((value.eligible || applied) && (!hash(value.proofHash) || !request || !id(request.id) || request.status !== 'complete' ||
        !Number.isFinite(time(value.firstPostReplacementRunAt)) || Math.floor(time(value.firstPostReplacementRunAt) / 1000) !== FIRST / 1000 ||
        time(value.prefix?.startAt) !== START || time(value.prefix?.endAt) !== SEAM ||
        value.prefix?.runningSeconds !== 50494 || value.prefix?.zeroPrefixRunningSeconds !== 0 ||
        time(value.tail?.startAt) !== SEAM || !(time(value.tail?.observedAt) > SEAM) || !seconds(value.tail?.runningSeconds) ||
        !preview || preview.prefixRunningSeconds !== 50494 || preview.tailRunningSeconds !== value.tail.runningSeconds ||
        !seconds(preview.totalRunningSeconds) || preview.totalRunningSeconds !== 50494 + preview.tailRunningSeconds ||
        time(preview.observedAt) !== time(value.tail.observedAt))) throw fail('INVALID_RESPONSE');
    if (request && (!id(request.id) || request.status !== 'complete')) throw fail('INVALID_RESPONSE');
    return { eligible: value.eligible, applied, proofHash: hash(value.proofHash) ? value.proofHash : '',
      completionDay: DAY, completionClockKnown: false, firstPostReplacementRunAt: value.firstPostReplacementRunAt,
      prefix: value.prefix ? { startAt: value.prefix.startAt, endAt: value.prefix.endAt,
        runningSeconds: value.prefix.runningSeconds, zeroPrefixRunningSeconds: value.prefix.zeroPrefixRunningSeconds } : null,
      tail: value.tail ? { startAt: value.tail.startAt, observedAt: value.tail.observedAt, runningSeconds: value.tail.runningSeconds } : null,
      request: request ? { id: request.id, status: request.status } : null,
      preview: preview ? { prefixRunningSeconds: preview.prefixRunningSeconds, tailRunningSeconds: preview.tailRunningSeconds,
        totalRunningSeconds: preview.totalRunningSeconds, observedAt: preview.observedAt } : null,
      attestationRequired: value.attestationRequired === true, quality: false,
      code: CODES.has(value.code) ? value.code : '' };
  }
  function attestation(view) {
    return { version: 1, completionDay: DAY, firstRunAt: view.firstPostReplacementRunAt,
      completionBeforeFirstRun: true, noEarlierPostReplacementRun: true, statementCode: 'BELT_COMPLETED_BEFORE_FIRST_RUN' };
  }
  function normalizeRecord(value) {
    if (!value || value.version !== 1 || !id(value.requestId) || !hash(value.proofHash) || typeof value.pending !== 'boolean')
      throw fail('SAVED_STATE_UNREADABLE');
    const a = value.attestation;
    if (a && (a.version !== 1 || a.completionDay !== DAY || Math.floor(time(a.firstRunAt) / 1000) !== FIRST / 1000 ||
        a.completionBeforeFirstRun !== true || a.noEarlierPostReplacementRun !== true || a.statementCode !== 'BELT_COMPLETED_BEFORE_FIRST_RUN'))
      throw fail('SAVED_STATE_UNREADABLE');
    return { version: 1, requestId: value.requestId, proofHash: value.proofHash, pending: value.pending,
      attestation: a ? { version: 1, completionDay: DAY, firstRunAt: a.firstRunAt, completionBeforeFirstRun: true,
        noEarlierPostReplacementRun: true, statementCode: 'BELT_COMPLETED_BEFORE_FIRST_RUN' } : null };
  }
  function verified(asset) {
    const api = typeof module === 'object' && module.exports ? require('./blower-unified-refresh.js') : root.BlowerUnifiedRefresh;
    return api?.verifiedLimestone2aFirstRun?.(asset) || null;
  }
  function verifyReadback(asset, view) {
    const proof = verified(asset), basis = asset?.dataParcRuntimeBasis;
    return Boolean(proof && view?.request && view.preview && proof.prefixRequestId === view.request.id &&
      proof.firstRunAt === view.firstPostReplacementRunAt && basis.runningSeconds >= view.preview.totalRunningSeconds &&
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
        state.httpStatus = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : null;
        state.error = CODES.has(error?.code) ? error.code : [401, 403].includes(state.httpStatus) ? 'AUTH_REQUIRED'
          : state.httpStatus === 409 ? 'PROOF_CHANGED' : 'REQUEST_UNCERTAIN';
        if (uncertain && record?.pending && state.error !== 'READBACK_UNCONFIRMED') state.phase = 'resume';
        if (state.error === 'PROOF_CHANGED' || state.httpStatus === 409) { state.phase = 'unavailable'; state.attested = false; }
        return false;
      } finally { state.busy = false; deps.setBusy(false); emit(); }
    }
    async function refresh() {
      return run(async () => {
        const suffix = record ? '&requestId=' + encodeURIComponent(record.requestId) : '';
        const raw = await deps.api({ url: API + '?action=limestone2a_first_run_status' + suffix, timeoutMs: 30000 });
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
          action: 'apply_limestone2a_first_run', requestId: record.requestId, expectedProofHash: record.proofHash,
          confirmation: 'LIMESTONE_2A_FIRST_RUN_20260919', attestation: record.attestation } });
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
    if (!entry || entry.session !== options.session()) {
      entry = { session: options.session(), controller: createController(options) }; controllers.set(TAG, entry);
    }
    const controller = entry.controller, doc = options.document;
    const section = doc.createElement('section'); section.className = 'limestone2a-first-run';
    section.setAttribute('aria-label', 'Limestone 2A 교체 후 최초 기동 확인');
    const title = doc.createElement('strong'); title.textContent = '#2 Limestone #A · 교체 후 RUN 누적 보완';
    const intro = doc.createElement('p'); intro.textContent = '이미 조회한 9/19 RUN 원본과 9/20 이후의 저장 구간을 대조합니다. 새 DataPARC 조회를 만들지 않습니다.';
    const facts = doc.createElement('dl'), note = doc.createElement('p'), status = doc.createElement('p');
    note.textContent = '교체 완료일은 2026-09-19이며 실제 완료시각은 미기록으로 유지합니다. 09:58:26은 교체 후 최초 기동시각이며 완료시각이 아닙니다. 개별 샘플의 GOOD 품질 인증을 뜻하지 않습니다.';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const label = doc.createElement('label'), checkbox = doc.createElement('input'), statement = doc.createElement('span');
    checkbox.type = 'checkbox'; checkbox.checked = false;
    statement.textContent = '9/19 당일 전체 V-belt 교체 완료 후 09:58:26에 최초 기동했으며, 그 전에 교체 후 운전은 없었습니다.';
    label.appendChild(checkbox); label.appendChild(statement);
    checkbox.addEventListener('change', () => controller.setAttested(checkbox.checked));
    const actions = doc.createElement('div'), check = doc.createElement('button'), apply = doc.createElement('button');
    actions.className = 'limestone2a-first-run-actions';
    check.type = apply.type = 'button'; check.className = 'button secondary'; apply.className = 'button primary';
    check.textContent = '기존 RUN 근거 확인 (읽기 전용)'; apply.textContent = '확인한 교체 후 누적 반영';
    check.addEventListener('click', () => { void controller.refresh(); }); apply.addEventListener('click', () => { void controller.apply(); });
    actions.appendChild(check); actions.appendChild(apply);
    for (const element of [title, intro, facts, note, label, status, actions]) section.appendChild(element);
    options.container.appendChild(section);
    controller.subscribe(state => {
      facts.replaceChildren();
      const row = (name, value) => { const term = doc.createElement('dt'), detail = doc.createElement('dd'); term.textContent = name; detail.textContent = value; facts.appendChild(term); facts.appendChild(detail); };
      if (state.view?.preview) {
        row('교체 후 최초 기동', formatTime(state.view.firstPostReplacementRunAt) + ' KST');
        row('9/19 확인된 RUN', duration(state.view.preview.prefixRunningSeconds));
        row('보존할 이후 구간', formatTime(state.view.tail.startAt) + ' → ' + formatTime(state.view.tail.observedAt));
        row('보존할 이후 RUN', duration(state.view.preview.tailRunningSeconds)); row('반영할 교체 후 전체 RUN', duration(state.view.preview.totalRunningSeconds));
      }
      const messages = { idle: '먼저 기존 RUN 근거를 확인해 주세요. 기존 누적값은 유지됩니다.',
        ready: '앞 구간과 보존 구간을 확인했습니다. 작업 사실을 확인한 뒤 명시적으로 반영해 주세요.',
        resume: '저장 응답이 불확실합니다. 같은 요청의 반영 상태를 읽기 전용으로 확인해 주세요.',
        unavailable: '현재 근거를 확인할 수 없어 반영하지 않았습니다. 기존 누적값은 유지됩니다.',
        stopped: '보관된 반영 정보를 확인할 수 없어 중단했습니다.',
        applied: state.readbackVerified ? '교체 후 누적 반영과 최신 값 대조를 완료했습니다. 완료시각은 미기록으로 유지합니다.' : '반영 기록을 확인했습니다. 최신 값 대조가 필요합니다.' };
      const errors = { ATTESTATION_REQUIRED: '교체 완료 후 최초 기동 사실을 먼저 확인해 주세요.',
        PROOF_CHANGED: '승인 근거나 누적값이 바뀌었습니다. 같은 요청의 현재 근거를 다시 확인해 주세요.',
        STORAGE_UNAVAILABLE: '브라우저에 반영 정보를 보관할 수 없어 저장을 중단했습니다.',
        SESSION_CHANGED: '로그인이 바뀌었습니다. 이력을 다시 열어 확인해 주세요.', READ_ONLY_MOBILE: 'PC 화면에서 확인해 주세요.',
        AUTH_REQUIRED: '최고관리자 권한을 확인해 주세요.', READBACK_UNCONFIRMED: '반영 응답 이후 최신 값 대조를 완료하지 못했습니다. 기존 요청의 결과를 확인해 주세요.' };
      status.textContent = state.busy ? '확인 중입니다.' : errors[state.error] || messages[state.phase];
      if (state.error) status.textContent += ' [' + safeCode(state.error) + (state.httpStatus ? ' · HTTP ' + state.httpStatus : '') + ']';
      if (state.view?.code) status.textContent += ' [' + state.view.code + ']';
      check.textContent = state.phase === 'idle' ? '기존 RUN 근거 확인 (읽기 전용)' : '반영 결과 확인 (읽기 전용)';
      check.disabled = state.busy; checkbox.checked = state.attested; checkbox.disabled = state.busy || state.phase !== 'ready';
      label.hidden = state.phase !== 'ready'; apply.hidden = state.phase !== 'ready'; apply.disabled = state.busy || !state.attested;
    });
    return controller;
  }
  return { TAG, KEY, normalizeView, createController, verifyReadback, mount, formatTime, duration };
});
