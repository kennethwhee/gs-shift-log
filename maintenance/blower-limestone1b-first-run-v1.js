/* Limestone 1B: review an existing R9 witness, explicitly measure again, then apply.
 * Completion day is known. The physical completion minute remains unknown. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlowerLimestone1bFirstRun = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const TAG = '103HRJ01AN602', KEY = 'gsShiftLog.limestone1bFirstRun.v1', API = '/api/blower-history';
  const HISTORY_KEY = KEY + '.history';
  const DAY = '2026-09-22', START = Date.parse(DAY + 'T00:00:00+09:00');
  const FIRST = Date.parse(DAY + 'T09:50:26+09:00'), STOP = Date.parse(DAY + 'T09:29:26+09:00');
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
      'ALREADY_ACTIVE', 'BASELINE_CHANGED', 'BASELINE_INVALID', 'MEASUREMENT_INVALID', 'MEASUREMENT_MISMATCH',
      'SOURCE_CONFLICT', 'SOURCE_REVIEW_REQUIRED', 'WITNESS_INVALID', 'WITNESS_NOT_FOUND',
      'ATTESTATION_REQUIRED', 'DERIVATION_INVALID', 'STORAGE_FAILED'].map(value => 'LIME1B_FIRST_RUN_' + value)]);
  const fail = code => Object.assign(new Error(code), { code });
  const safeCode = value => CODES.has(value) ? value : 'REQUEST_UNCERTAIN';
  const RENEWABLE_COMPLETED_CODES = new Set(['BASELINE_CHANGED', 'SOURCE_CHANGED', 'SOURCE_CONFLICT',
    'SOURCE_COVERAGE', 'SOURCE_REQUIRED', 'SOURCE_EXCLUDED', 'SOURCE_REVIEW_REQUIRED', 'OWNER_CHANGED',
    'COMPETING_OWNER', 'CURRENT_PROOF_CHANGED'].map(value => 'LIME1B_FIRST_RUN_' + value));
  function normalizeView(value) {
    if (!value || value.ok !== true || value.assetTag !== TAG || typeof value.eligible !== 'boolean' ||
        value.completionDay !== DAY || value.completionClockKnown !== false || !hash(value.proofHash)) throw fail('INVALID_RESPONSE');
    const applied = value.applied === true || value.replayed === true, w = value.witness, window = value.measurementWindow;
    const saved = value.saved, preview = value.preview, request = value.request;
    if (!w || !id(w.id) || w.status !== 'complete' || !Number.isFinite(time(w.oldRunStoppedAt)) ||
        Math.floor(time(w.oldRunStoppedAt) / 1000) !== STOP / 1000 || Math.floor(time(w.firstRunAt) / 1000) !== FIRST / 1000 ||
        value.firstPostReplacementRunAt !== w.firstRunAt || !seconds(w.excludedDurationMilliseconds) ||
        w.excludedDurationMilliseconds !== time(w.oldRunStoppedAt) - START ||
        w.excludedPreReplacementSeconds !== Math.round(w.excludedDurationMilliseconds / 1000) ||
        ![34166, 34167].includes(w.excludedPreReplacementSeconds) || !seconds(w.postRunningSeconds) ||
        w.dailyRunningSeconds !== 85140 || Math.abs(w.excludedPreReplacementSeconds + w.postRunningSeconds - 85140) > 2 ||
        time(window?.startAt) !== FIRST || !(time(window?.endAt) > FIRST) || !Number.isSafeInteger(window?.chunkCount) ||
        window.chunkCount < 1 || window.chunkCount > 512 || !seconds(saved?.runningSeconds) ||
        saved.runningSeconds < w.excludedPreReplacementSeconds || time(saved.observedAt) !== time(window.endAt)) throw fail('INVALID_RESPONSE');
    if (request && (!id(request.id) || !['pending', 'processing', 'complete', 'failed'].includes(request.status))) throw fail('INVALID_RESPONSE');
    if (preview && (!request || request.status !== 'complete' || !seconds(preview.measuredRunningSeconds) ||
        preview.previousRunningSeconds !== saved.runningSeconds || preview.excludedPreReplacementSeconds !== w.excludedPreReplacementSeconds ||
        preview.expectedRunningSeconds !== saved.runningSeconds - w.excludedPreReplacementSeconds ||
        !Number.isSafeInteger(preview.differenceSeconds) || preview.differenceSeconds !== preview.measuredRunningSeconds - preview.expectedRunningSeconds ||
        !Number.isSafeInteger(preview.toleranceSeconds) || preview.toleranceSeconds < 2 || preview.toleranceSeconds > 10000 ||
        (value.eligible || applied) && Math.abs(preview.differenceSeconds) > preview.toleranceSeconds || !seconds(preview.appendedRunningSeconds ?? 0) ||
        !seconds(preview.totalRunningSeconds) || preview.totalRunningSeconds !== preview.measuredRunningSeconds + (preview.appendedRunningSeconds ?? 0) ||
        (applied ? time(preview.observedAt) < time(saved.observedAt) : time(preview.observedAt) !== time(saved.observedAt)) ||
        !Number.isFinite(time(preview.observedAt)) || !applied && (preview.appendedRunningSeconds ?? 0) !== 0)) throw fail('INVALID_RESPONSE');
    if (applied && (!request || !preview)) throw fail('INVALID_RESPONSE');
    return { eligible: value.eligible, applied, proofHash: value.proofHash, completionDay: DAY, completionClockKnown: false,
      firstPostReplacementRunAt: w.firstRunAt,
      witness: { id: w.id, status: w.status, oldRunStoppedAt: w.oldRunStoppedAt, firstRunAt: w.firstRunAt,
        excludedPreReplacementSeconds: w.excludedPreReplacementSeconds, excludedDurationMilliseconds: w.excludedDurationMilliseconds,
        postRunningSeconds: w.postRunningSeconds, dailyRunningSeconds: w.dailyRunningSeconds },
      measurementWindow: { startAt: window.startAt, endAt: window.endAt, chunkCount: window.chunkCount },
      saved: { runningSeconds: saved.runningSeconds, observedAt: saved.observedAt },
      request: request ? { id: request.id, status: request.status } : null,
      preview: preview ? { measuredRunningSeconds: preview.measuredRunningSeconds, previousRunningSeconds: preview.previousRunningSeconds,
        excludedPreReplacementSeconds: preview.excludedPreReplacementSeconds, expectedRunningSeconds: preview.expectedRunningSeconds,
        differenceSeconds: preview.differenceSeconds, toleranceSeconds: preview.toleranceSeconds,
        appendedRunningSeconds: preview.appendedRunningSeconds ?? 0, totalRunningSeconds: preview.totalRunningSeconds,
        observedAt: preview.observedAt } : null, attestationRequired: value.attestationRequired === true,
      code: CODES.has(value.code) ? value.code : '' };
  }
  function attestation(view) {
    return { version: 1, completionDay: DAY, oldRunStoppedAt: view.witness.oldRunStoppedAt, firstRunAt: view.witness.firstRunAt,
      completedDuringStoppedWindow: true, priorRunBelongsToPreviousBelt: true, noEarlierPostReplacementRun: true,
      statementCode: 'BELT_COMPLETED_DURING_OBSERVED_STOP_BEFORE_FIRST_RUN' };
  }
  function normalizeRecord(value) {
    if (!value || value.version !== 1 || typeof value.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value.nonce) || !id(value.witnessRequestId) || !hash(value.proofHash) ||
        value.requestId && !id(value.requestId) || typeof value.pending !== 'boolean') throw fail('SAVED_STATE_UNREADABLE');
    const a = value.attestation;
    if (!a || a.version !== 1 || a.completionDay !== DAY || Math.floor(time(a.firstRunAt) / 1000) !== FIRST / 1000 ||
        Math.floor(time(a.oldRunStoppedAt) / 1000) !== STOP / 1000 || a.completedDuringStoppedWindow !== true ||
        a.priorRunBelongsToPreviousBelt !== true || a.noEarlierPostReplacementRun !== true ||
        a.statementCode !== 'BELT_COMPLETED_DURING_OBSERVED_STOP_BEFORE_FIRST_RUN') throw fail('SAVED_STATE_UNREADABLE');
    return { version: 1, nonce: value.nonce, requestId: value.requestId || '', witnessRequestId: value.witnessRequestId,
      proofHash: value.proofHash, pending: value.pending, attestation: { version: 1, completionDay: DAY,
        oldRunStoppedAt: a.oldRunStoppedAt, firstRunAt: a.firstRunAt, completedDuringStoppedWindow: true,
        priorRunBelongsToPreviousBelt: true, noEarlierPostReplacementRun: true, statementCode: a.statementCode } };
  }
  function verified(asset) {
    const api = typeof module === 'object' && module.exports ? require('./blower-unified-refresh.js') : root.BlowerUnifiedRefresh;
    return api?.verifiedLimestone1bFirstRun?.(asset) || null;
  }
  function verifyReadback(asset, view) {
    const proof = verified(asset), basis = asset?.dataParcRuntimeBasis;
    return Boolean(proof && view?.request && view.preview && proof.freshRequestId === view.request.id && proof.r9RequestId === view.witness?.id &&
      proof.rawFirstRunAt === view.firstPostReplacementRunAt && basis.runningSeconds >= view.preview.totalRunningSeconds &&
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
      try { await operation(); return true; }
      catch (error) {
        state.httpStatus = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : null;
        state.error = CODES.has(error?.code) ? error.code : [401, 403].includes(state.httpStatus) ? 'AUTH_REQUIRED'
          : state.httpStatus === 409 ? 'PROOF_CHANGED' : 'REQUEST_UNCERTAIN';
        if (uncertain && record?.pending && !state.nonceMissing && state.error !== 'READBACK_UNCONFIRMED') state.phase = 'resume';
        if (state.httpStatus === 409) { state.phase = 'unavailable'; state.attested = false; }
        return false;
      } finally { state.busy = false; deps.setBusy(false); emit(); }
    }
    async function refresh() {
      return run(async () => {
        const suffix = record?.requestId ? '&requestId=' + encodeURIComponent(record.requestId)
          : record ? '&nonce=' + encodeURIComponent(record.nonce) : '';
        let raw;
        try { raw = await deps.api({ url: API + '?action=limestone1b_first_run_status' + suffix, timeoutMs: 30000 }); }
        catch (error) {
          ensureSession();
          if (record && !record.requestId && error?.status === 404 && error.code === 'LIME1B_FIRST_RUN_REQUEST_NOT_FOUND') {
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
        const raw = await deps.api({ method: 'POST', timeoutMs: 30000, body: { action: 'start_limestone1b_first_run',
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
        const raw = await deps.api({ method: 'POST', timeoutMs: 30000, body: { action: 'apply_limestone1b_first_run',
          requestId: record.requestId, expectedProofHash: record.proofHash, confirmation: 'LIMESTONE_1B_FIRST_RUN_20260922',
          attestation: record.attestation } });
        ensureSession(); const view = accept(raw); if (!view.applied) throw fail('INVALID_RESPONSE'); await readback(view);
      }, true);
    }
    function canRenew() { return Boolean(record && (state.nonceMissing && !record.requestId && state.phase === 'unavailable' ||
      record.requestId && state.view?.request?.id === record.requestId && ['unavailable', 'failed'].includes(state.phase) &&
      (state.view.request.status === 'failed' || state.view.request.status === 'complete' && RENEWABLE_COMPLETED_CODES.has(state.view.code)))); }
    async function renew() {
      return run(async () => {
        if (!canRenew()) throw fail('INVALID_RESPONSE');
        if (!record.requestId) {
          let missing = false;
          try {
            const existing = await deps.api({ url: API + '?action=limestone1b_first_run_status&nonce=' + encodeURIComponent(record.nonce), timeoutMs: 30000 });
            ensureSession(); accept(existing);
          } catch (error) {
            ensureSession();
            if (error?.status === 404 && error.code === 'LIME1B_FIRST_RUN_REQUEST_NOT_FOUND') missing = true;
            else throw error;
          }
          if (!missing) throw fail('INVALID_RESPONSE');
        }
        const raw = await deps.api({ url: API + '?action=limestone1b_first_run_status&witnessRequestId=' + encodeURIComponent(record.witnessRequestId), timeoutMs: 30000 });
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
    const section = doc.createElement('section'); section.className = 'limestone1b-first-run';
    section.setAttribute('aria-label', 'Limestone 1B 교체 후 최초 기동 확인');
    const title = doc.createElement('strong'); title.textContent = '#1 Limestone #B · 교체 후 RUN 다시 측정';
    const intro = doc.createElement('p'); intro.textContent = '기존 9/22 운전구간 원본과 현재 저장 기준을 확인한 뒤, 교체 후 최초 기동부터 저장된 조회 종료까지 RUN을 새로 측정합니다. 조회와 반영은 별도 버튼으로 실행합니다.';
    const facts = doc.createElement('dl'), note = doc.createElement('p'), status = doc.createElement('p');
    note.textContent = '교체 완료일은 2026-09-22이며 실제 완료시각은 미기록으로 유지합니다. 09:50:26은 교체 후 최초 기동시각입니다. 새 실측값만 저장하며 기존값 차감은 비교용입니다. 개별 샘플의 GOOD 품질 인증을 뜻하지 않습니다.';
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const label = doc.createElement('label'), checkbox = doc.createElement('input'), statement = doc.createElement('span');
    checkbox.type = 'checkbox'; checkbox.checked = false;
    statement.textContent = '9/22 당일 09:29:26 정지 후 09:50:26 기동 전에 전체 V-belt 교체를 완료했습니다. 앞선 운전은 이전 벨트의 운전이며, 09:50:26이 교체 후 최초 기동입니다.';
    label.appendChild(checkbox); label.appendChild(statement); checkbox.addEventListener('change', () => controller.setAttested(checkbox.checked));
    const actions = doc.createElement('div'), check = doc.createElement('button'), start = doc.createElement('button'), apply = doc.createElement('button'), renew = doc.createElement('button');
    actions.className = 'limestone1b-first-run-actions';
    for (const button of [check, start, apply, renew]) { button.type = 'button'; button.className = 'button secondary'; actions.appendChild(button); }
    apply.className = 'button primary'; check.textContent = '기존 RUN 근거 확인 (읽기 전용)';
    start.textContent = '교체 후 RUN 다시 측정'; apply.textContent = '확인한 교체 후 누적 반영'; renew.textContent = '새 기준 확인 (읽기 전용)';
    check.addEventListener('click', () => { void controller.refresh(); }); start.addEventListener('click', () => { void controller.start(); });
    apply.addEventListener('click', () => { void controller.apply(); }); renew.addEventListener('click', () => { void controller.renew(); });
    for (const element of [title, intro, facts, note, label, status, actions]) section.appendChild(element); options.container.appendChild(section);
    controller.subscribe(state => {
      facts.replaceChildren(); const row = (name, value) => { const term = doc.createElement('dt'), detail = doc.createElement('dd'); term.textContent = name; detail.textContent = value; facts.appendChild(term); facts.appendChild(detail); };
      if (state.view) {
        row('교체 작업이 확인된 정지 구간', formatTime(state.view.witness.oldRunStoppedAt) + ' → ' + formatTime(state.view.witness.firstRunAt));
        row('교체 전 RUN · 원본에서 구분', duration(state.view.witness.excludedPreReplacementSeconds));
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
      const errors = { ATTESTATION_REQUIRED: '교체 작업과 최초 기동 사실을 먼저 확인해 주세요.', STORAGE_UNAVAILABLE: '브라우저에 접수 정보를 보관할 수 없어 요청을 중단했습니다.',
        ARCHIVE_FULL: '이전 접수 10건을 보존 중이어서 새 조회 준비를 중단했습니다.', SESSION_CHANGED: '로그인이 바뀌었습니다. 이력을 다시 열어 확인해 주세요.',
        LIME1B_FIRST_RUN_MEASUREMENT_MISMATCH: '새 실측값과 기존값 대조가 허용범위를 벗어났습니다. 비교 결과만 표시하며 반영하지 않았습니다.',
        LIME1B_FIRST_RUN_BASELINE_CHANGED: '측정 대기 중 저장 기준이 바뀌었습니다. 기존 값과 접수는 보존하며 새 조회는 자동 실행하지 않습니다.',
        LIME1B_FIRST_RUN_WITNESS_NOT_FOUND: '이 사용자의 완료된 9/22 운전구간 조회를 찾지 못했습니다. 새 조회는 자동 실행하지 않습니다.',
        LIME1B_FIRST_RUN_ALREADY_ACTIVE: '같은 기준으로 접수된 재측정이 있습니다. 기존 접수의 결과를 먼저 확인해 주세요.',
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
