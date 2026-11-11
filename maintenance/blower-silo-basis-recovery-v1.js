/* Silo B only: explicit source check, historical prefix query, then atomic apply.
 * Opening a page/history never starts a query or applies a recovery. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BlowerSiloBasisRecovery = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const TAG = '104ETH03AN602';
  const START = Date.parse('2025-10-23T09:17:00+09:00');
  const END = Date.parse('2026-05-10T00:00:00+09:00');
  const KEY = 'gsShiftLog.siloBasisRecovery.v1';
  const API = '/api/blower-history';
  const controllers = new Map();
  const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
  const seconds = value => Number.isSafeInteger(value) && value >= 0;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  function fail(code) { return Object.assign(new Error(code), { code }); }
  function formatTime(value) {
    if (!Number.isFinite(time(value))) return '확인 중';
    return new Date(time(value) + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
  }
  function hours(value) {
    return seconds(value) ? (value / 3600).toLocaleString('ko-KR', { maximumFractionDigits: 4 }) + '시간' : '미확정';
  }
  function verifyReadback(asset, view) {
    const basis = asset?.dataParcRuntimeBasis, evidence = asset?.runtimeCoverageEvidence;
    const owned = basis?.siloBasis, verified = evidence?.siloBasis;
    const requestId = view?.request?.id, preview = view?.preview;
    // A normal append can advance the composite after apply. Its currently
    // verified certificate must still be the one this recovery created.
    return Boolean(asset?.tagNumber === TAG && id(requestId) && preview &&
      time(asset.lastReplacementAt) === START && !asset.cycleSourceReview &&
      basis?.composite === true && basis.coverageComplete === true && basis.appendReady === true &&
      basis.dataParcTag === 'GSPOGE.ABB_DCS.003ETH03AN602XB04' && time(basis.startAt) === START &&
      seconds(basis.runningSeconds) && seconds(preview.totalRunningSeconds) &&
      basis.runningSeconds >= preview.totalRunningSeconds && Number.isFinite(time(preview.observedAt)) &&
      time(basis.observedAt) >= time(preview.observedAt) &&
      owned?.version === 1 && owned.prefixRequestId === requestId &&
      owned.certificateEventId === 'dataparc_silo_basis:' + requestId && time(owned.approvedCompletionAt) === START &&
      evidence?.source === 'dataparc' && evidence.measurementVerified === true && evidence.wholeCycleVerified === true &&
      evidence.cycleBasisConfirmed === true && evidence.composite === true &&
      verified?.version === 1 && verified.prefixRequestId === requestId &&
      verified.certificateEventId === owned.certificateEventId && time(verified.approvedCompletionAt) === START);
  }
  function normalizeView(value) {
    if (!value || value.ok !== true || value.assetTag !== TAG || typeof value.eligible !== 'boolean') throw fail('INVALID_RESPONSE');
    const hasProof = hash(value.proofHash);
    if (value.eligible && (!hasProof || time(value.approvedCompletionAt) !== START ||
        time(value.prefix?.startAt) !== START || time(value.prefix?.endAt) !== END ||
        time(value.tail?.startAt) !== END || !(time(value.tail?.observedAt) > END) ||
        !seconds(value.tail?.runningSeconds))) throw fail('INVALID_RESPONSE');
    const request = value.request;
    if (request && (!id(request.id) || !['pending', 'processing', 'complete', 'failed'].includes(request.status))) throw fail('INVALID_RESPONSE');
    const preview = value.preview;
    if (preview && (!request || request.status !== 'complete' || !seconds(preview.prefixRunningSeconds) ||
        preview.prefixRunningSeconds > (END - START) / 1000 || !seconds(preview.tailRunningSeconds) ||
        !seconds(preview.totalRunningSeconds) || preview.totalRunningSeconds !== preview.prefixRunningSeconds + preview.tailRunningSeconds ||
        !Number.isFinite(time(preview.observedAt)) || value.eligible &&
        (preview.tailRunningSeconds !== value.tail.runningSeconds || time(preview.observedAt) !== time(value.tail.observedAt)))) throw fail('INVALID_RESPONSE');
    if (value.applied === true || value.replayed === true) {
      if (!request) throw fail('INVALID_RESPONSE');
    }
    return {
      eligible: value.eligible, proofHash: hasProof ? value.proofHash : '',
      approvedCompletionAt: value.approvedCompletionAt, prefix: value.prefix || null, tail: value.tail || null,
      request: request ? { id: request.id, status: request.status } : null,
      preview: preview ? { prefixRunningSeconds: preview.prefixRunningSeconds, tailRunningSeconds: preview.tailRunningSeconds,
        totalRunningSeconds: preview.totalRunningSeconds, observedAt: preview.observedAt } : null,
      applied: value.applied === true || value.replayed === true,
      quality: value.quality?.sampleGoodCertified === true
    };
  }
  function loadRecord(storage) {
    let record;
    try { record = JSON.parse(storage?.getItem(KEY) || 'null'); } catch { throw fail('SAVED_STATE_UNREADABLE'); }
    if (!record) return null;
    if (record.version !== 1 || !id(record.nonce) || !hash(record.proofHash) || record.requestId && !id(record.requestId)) throw fail('SAVED_STATE_UNREADABLE');
    return { version: 1, nonce: record.nonce, proofHash: record.proofHash, requestId: record.requestId || '' };
  }
  function createController(deps) {
    let record = null, savedError = false, listener = () => {}, session = '';
    try { record = loadRecord(deps.storage); } catch { savedError = true; }
    const state = { phase: savedError ? 'stopped' : record ? 'resume' : 'idle', view: null, busy: false,
      error: savedError ? 'SAVED_STATE_UNREADABLE' : '', readbackVerified: false };
    function emit() { listener({ ...state }); }
    function guard() {
      if (deps.getAsset()?.tagNumber !== TAG || deps.getAsset()?.enabled === false || deps.getAsset()?.enabled === 0) throw fail('WRONG_ASSET');
      if (deps.isMobile()) throw fail('READ_ONLY_MOBILE');
      if (!deps.canWrite() || !deps.session()) throw fail('AUTH_REQUIRED');
      if (session && session !== deps.session()) throw fail('SESSION_CHANGED');
      if (state.busy || deps.isBusy()) throw fail('BUSY');
      if (savedError) throw fail('SAVED_STATE_UNREADABLE');
      session = deps.session();
    }
    function save(next) {
      try {
        deps.storage.setItem(KEY, JSON.stringify(next));
        if (deps.storage.getItem(KEY) !== JSON.stringify(next)) throw fail('STORAGE_UNAVAILABLE');
      } catch { throw fail('STORAGE_UNAVAILABLE'); }
      record = next;
    }
    function ensureSession() {
      if (!deps.canWrite() || !deps.session() || session !== deps.session() || deps.isMobile()) throw fail('SESSION_CHANGED');
    }
    function accept(raw) {
      const view = normalizeView(raw);
      if (view.request && record && view.request.id !== record.requestId) {
        if (record.requestId) throw fail('REQUEST_ID_CHANGED');
        save({ ...record, requestId: view.request.id });
      }
      // The server may prove that a newer measured tail descends from the
      // pinned tail. Its signed-in status response supplies the fresh proof and
      // preview; the operator must still explicitly apply that reviewed sum.
      if (view.eligible && view.request && record && view.request.id === record.requestId &&
          view.proofHash !== record.proofHash) save({ ...record, proofHash: view.proofHash });
      state.view = view;
      state.phase = view.applied ? 'applied' : !view.eligible ? 'stale' : view.request?.status === 'failed' ? 'failed'
        : view.request?.status === 'complete' && view.preview ? 'ready' : view.request ? 'queued' : 'verified';
      return view;
    }
    async function run(operation, uncertain) {
      try { guard(); } catch (error) { state.error = error.code; emit(); return false; }
      state.busy = true; state.error = ''; deps.setBusy(true); emit();
      try {
        await operation();
        return true;
      } catch (error) {
        state.error = ['AUTH_REQUIRED', 'READ_ONLY_MOBILE', 'SESSION_CHANGED', 'STORAGE_UNAVAILABLE', 'INVALID_RESPONSE',
          'REQUEST_ID_CHANGED', 'SAVED_STATE_UNREADABLE'].includes(error?.code) ? error.code
          : [401, 403].includes(Number(error?.status)) ? 'AUTH_REQUIRED'
          : Number(error?.status) === 409 ? 'PROOF_CHANGED' : 'REQUEST_UNCERTAIN';
        if (state.error === 'PROOF_CHANGED') state.phase = 'stale';
        else if (uncertain && record) state.phase = 'resume';
        return false;
      } finally { state.busy = false; deps.setBusy(false); emit(); }
    }
    async function refresh() {
      return run(async () => {
        const params = record?.requestId ? '&requestId=' + encodeURIComponent(record.requestId)
          : record ? '&nonce=' + encodeURIComponent(record.nonce) : '';
        const raw = await deps.api({ url: API + '?action=silo_basis_recovery_status' + params, timeoutMs: 30000 });
        ensureSession();
        const view = accept(raw);
        if (view.applied) {
          state.readbackVerified = await deps.reload(view);
          if (!state.readbackVerified) state.error = 'READBACK_UNCONFIRMED';
        }
      }, false);
    }
    async function start() {
      return run(async () => {
        if (!record) {
          if (state.phase !== 'verified' || !state.view?.eligible || !hash(state.view.proofHash)) throw fail('INVALID_RESPONSE');
          const nonce = deps.nonce();
          if (!id(nonce)) throw fail('STORAGE_UNAVAILABLE');
          save({ version: 1, nonce, proofHash: state.view.proofHash, requestId: '' });
        } else if (record.requestId) throw fail('REQUEST_ID_CHANGED');
        const raw = await deps.api({ method: 'POST', timeoutMs: 30000,
          body: { action: 'start_silo_basis_recovery', expectedProofHash: record.proofHash, nonce: record.nonce } });
        ensureSession();
        accept(raw);
      }, true);
    }
    async function apply() {
      return run(async () => {
        if (state.phase !== 'ready' || !state.view?.eligible || !state.view.preview || !record?.requestId ||
            state.view.request?.id !== record.requestId || state.view.proofHash !== record.proofHash) throw fail('INVALID_RESPONSE');
        const raw = await deps.api({ method: 'POST', timeoutMs: 30000,
          body: { action: 'apply_silo_basis_recovery', requestId: record.requestId,
            expectedProofHash: record.proofHash, confirmation: 'SILO_PREFIX_STITCH' } });
        ensureSession();
        const view = accept(raw);
        if (!view.applied) throw fail('INVALID_RESPONSE');
        state.readbackVerified = await deps.reload(view);
        if (!state.readbackVerified) state.error = 'READBACK_UNCONFIRMED';
      }, true);
    }
    return { subscribe(fn) { listener = fn; emit(); }, refresh, start, apply,
      snapshot: () => ({ ...state }), hasPendingNonce: () => Boolean(record && !record.requestId) };
  }
  function errorText(code) {
    return ({ AUTH_REQUIRED: '쓰기 권한으로 다시 로그인한 뒤 결과를 확인해 주세요.',
      READ_ONLY_MOBILE: 'PC 화면에서 확인하고 실행해 주세요.', SESSION_CHANGED: '로그인이 바뀌었습니다. 이력을 다시 열어 결과를 확인해 주세요.',
      BUSY: '진행 중인 조회가 끝난 뒤 확인해 주세요.', PROOF_CHANGED: '교체 근거나 누적값이 바뀌었습니다. 기존 값은 유지하며 접수 결과를 다시 확인해 주세요.',
      STORAGE_UNAVAILABLE: '이 브라우저에서 접수 정보를 보관할 수 없어 새 조회를 중단했습니다.',
      SAVED_STATE_UNREADABLE: '보관된 접수 정보를 확인할 수 없습니다. 새 조회를 시작하지 않았습니다.',
      INVALID_RESPONSE: '응답의 설비·구간·합계를 확인하지 못했습니다. 접수 결과를 다시 확인해 주세요.',
      REQUEST_ID_CHANGED: '기존 접수와 다른 결과여서 중단했습니다. 접수 결과를 다시 확인해 주세요.',
      READBACK_UNCONFIRMED: '반영 응답을 받았지만 최신 화면 대조가 끝나지 않았습니다. 결과를 다시 확인해 주세요.',
      REQUEST_UNCERTAIN: '서버 응답을 확인하지 못했습니다. 새 조회를 만들지 않고 기존 접수 결과를 확인합니다.' })[code] || '';
  }
  function mount(options) {
    const { container, asset, document: doc } = options;
    if (!container || asset?.tagNumber !== TAG || !options.canWrite() || options.isMobile()) return null;
    let entry = controllers.get(TAG);
    if (!entry || entry.session !== options.session()) {
      entry = { controller: createController(options), session: options.session() }; controllers.set(TAG, entry);
    }
    const controller = entry.controller;
    const section = doc.createElement('section');
    section.className = 'silo-basis-recovery'; section.setAttribute('aria-label', 'Silo B 교체 기준 복구');
    const title = doc.createElement('strong'); title.textContent = 'Silo #B 교체 기준 복구';
    const intro = doc.createElement('p');
    intro.textContent = '승인된 2025-10-23 09:17 교체 완료부터 빠진 RUN 구간을 확인합니다. 기존 측정값은 반영 전까지 유지합니다.';
    const facts = doc.createElement('dl');
    const note = doc.createElement('p'); note.className = 'silo-basis-recovery-note';
    note.textContent = '누락 구간은 RUN 신호를 새로 측정하고, 이후 구간은 저장된 측정값을 보존해 합칩니다. 개별 샘플의 GOOD 품질 인증을 뜻하지 않습니다.';
    const status = doc.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const actions = doc.createElement('div'); actions.className = 'silo-basis-recovery-actions';
    const check = doc.createElement('button'), start = doc.createElement('button'), apply = doc.createElement('button');
    for (const button of [check, start, apply]) { button.type = 'button'; button.className = 'button secondary'; actions.appendChild(button); }
    apply.className = 'button primary';
    check.addEventListener('click', () => { void controller.refresh(); });
    start.addEventListener('click', () => { void controller.start(); });
    apply.addEventListener('click', () => { void controller.apply(); });
    for (const item of [title, intro, facts, note, status, actions]) section.appendChild(item);
    container.appendChild(section);
    controller.subscribe(state => {
      facts.replaceChildren();
      function row(label, value) {
        const term = doc.createElement('dt'), detail = doc.createElement('dd');
        term.textContent = label; detail.textContent = value; facts.appendChild(term); facts.appendChild(detail);
      }
      if (state.view?.tail) {
        row('승인 교체 완료', formatTime(state.view.approvedCompletionAt) + ' KST');
        row('새로 확인할 누락 구간', formatTime(state.view.prefix?.startAt) + ' → ' + formatTime(state.view.prefix?.endAt));
        row('보존할 측정 구간', formatTime(state.view.tail.startAt) + ' → ' + formatTime(state.view.tail.observedAt));
        row('보존할 RUN 누적', hours(state.view.tail.runningSeconds));
      }
      if (state.view?.preview) {
        row('새로 측정한 앞 구간', hours(state.view.preview.prefixRunningSeconds));
        row('보존한 이후 구간', hours(state.view.preview.tailRunningSeconds));
        row('반영할 전체 누적', hours(state.view.preview.totalRunningSeconds));
      }
      const messages = { idle: '먼저 승인 근거와 현재 측정 구간을 확인해 주세요.', verified: '승인 근거와 보존할 구간을 확인했습니다. 누락 구간 조회를 시작할 수 있습니다.',
        resume: '보관된 접수가 있습니다. 같은 접수의 처리 결과를 확인해 주세요.', queued: state.view?.request?.status === 'processing' ? '회사 PC에서 누락 구간 RUN을 계산 중입니다.' : '누락 구간 RUN 조회가 접수되었습니다.',
        ready: '앞 구간과 보존 구간의 합계를 검토한 뒤 반영해 주세요. 아직 저장값은 바뀌지 않았습니다.',
        applied: state.readbackVerified ? '교체 기준과 누적시간 반영 및 최신 값 대조를 완료했습니다. 이후에는 상단 최신화를 사용하세요.' : '반영 완료를 확인했습니다. 최신 값 대조를 위해 결과를 다시 확인해 주세요.',
        stale: '현재 근거나 누적값이 달라 반영할 수 없습니다. 기존 측정값은 유지합니다.', failed: '누락 구간 조회가 실패했습니다. 기존 교체 기준과 측정값은 유지합니다.',
        stopped: '접수 정보를 확인할 수 없어 중단했습니다.' };
      status.textContent = state.busy ? '확인 중입니다. 창을 닫아도 기존 접수 정보는 유지됩니다.' : errorText(state.error) || messages[state.phase];
      check.textContent = state.phase === 'idle' ? '승인 근거 확인' : '조회 결과 확인';
      check.disabled = state.busy;
      start.hidden = !(state.phase === 'verified' || controller.hasPendingNonce());
      start.textContent = controller.hasPendingNonce() ? '기존 접수 다시 확인' : '누락 구간 RUN 조회';
      start.disabled = state.busy || state.phase === 'stale' || state.phase === 'stopped';
      apply.textContent = '교체 기준과 누적시간 함께 반영';
      apply.hidden = state.phase !== 'ready';
      apply.disabled = state.busy || ['AUTH_REQUIRED', 'SESSION_CHANGED', 'READ_ONLY_MOBILE'].includes(state.error);
    });
    return controller;
  }
  return { TAG, KEY, normalizeView, createController, mount, verifyReadback, formatTime, hours };
});
