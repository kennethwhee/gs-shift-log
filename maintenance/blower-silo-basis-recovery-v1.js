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
  const FAILURE_KEY = KEY + '.lastFailure.v2';
  const HISTORY_KEY = KEY + '.history.v3';
  const API = '/api/blower-history';
  const controllers = new Map();
  const time = value => typeof value === 'string' ? Date.parse(value) : NaN;
  const seconds = value => Number.isSafeInteger(value) && value >= 0;
  const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const STAGES = new Set(['UNKNOWN', 'LOOKUP', 'EXISTING_REQUEST', 'PREFIX_INTEGRITY', 'PREFIX_FRESHNESS',
    'LOAD_PROOF', 'COMPATIBILITY', 'VALIDATE_PREFIX', 'BUILD_CERTIFICATE', 'DERIVE_APPEND_BASE',
    'BEFORE_GUARDS', 'ATOMIC_BATCH', 'REPLAY_CHECK', 'READBACK']);
  const REASONS = new Set(['UNKNOWN', 'D1_CONSTRAINT', 'D1_QUERY_LIMIT', 'D1_QUERY_INVALID',
    'D1_REQUEST_LIMIT', 'D1_CAPACITY_LIMIT', 'D1_TIMEOUT', 'D1_BUSY', 'D1_UNAVAILABLE']);
  const CODES = new Set(['UNKNOWN', 'HTTP_ERROR', 'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'INVALID_RESPONSE',
    'CLOUDFLARE_1101', 'CLOUDFLARE_1102', 'CLOUDFLARE_1015',
    'READBACK_UNCONFIRMED', 'SESSION_CHANGED', 'AUTH_REQUIRED', 'STORAGE_UNAVAILABLE', 'ARCHIVE_FULL', 'REQUEST_ID_CHANGED',
    'READ_ONLY_MOBILE', 'SAVED_STATE_UNREADABLE', 'SILO_BASIS_STORAGE_FAILED', 'SILO_BASIS_COMPETING_OWNER',
    'SILO_BASIS_CONFIRM_REQUIRED', 'SILO_BASIS_CONFLICT', 'SILO_BASIS_DERIVATION_INVALID', 'SILO_BASIS_EVIDENCE_LIMIT',
    'SILO_BASIS_FORBIDDEN', 'SILO_BASIS_HISTORY_LIMIT', 'SILO_BASIS_NONCE_INVALID', 'SILO_BASIS_NOT_ELIGIBLE',
    'SILO_BASIS_OWNER_CHANGED', 'SILO_BASIS_REQUEST_INVALID', 'SILO_BASIS_REQUEST_NOT_FOUND',
    'SILO_BASIS_SOURCE_CONFLICT', 'SILO_BASIS_SOURCE_COVERAGE', 'SILO_BASIS_SOURCE_EXCLUDED',
    'SILO_BASIS_SOURCE_REQUIRED', 'SILO_BASIS_SOURCE_OWNER', 'SILO_BASIS_TAIL_INVALID',
    'SILO_BASIS_TAIL_REQUEST_INVALID', 'SILO_BASIS_TAIL_REQUEST_MISSING', 'SILO_PREFIX_ALREADY_ACTIVE',
    'SILO_PREFIX_PROOF_INVALID', 'SILO_PREFIX_SEAM_INVALID', 'SILO_PREFIX_STALE', 'SILO_PREFIX_SUM_INVALID', 'SILO_DIAGNOSTIC_REQUEST_REQUIRED']);
  const safeEnum = (value, allowed, fallback = 'UNKNOWN') => allowed.has(value) ? value : fallback;
  const safeCode = value => safeEnum(value, CODES);
  const safeCount = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000000 ? value : 0;
  function safeFailure(value) {
    if (!value || !['STATUS', 'START', 'APPLY', 'READBACK', 'DIAGNOSTICS', 'RENEW'].includes(value.action)) return null;
    return { action: value.action,
      httpStatus: Number.isInteger(value.httpStatus) && value.httpStatus >= 0 && value.httpStatus <= 599 ? value.httpStatus : null,
      code: safeCode(value.code), stage: safeEnum(value.stage, STAGES),
      reason: REASONS.has(value.reason) ? value.reason : CODES.has(value.reason) ? value.reason : 'UNKNOWN',
      responseKind: ['JSON', 'HTML', 'text', 'empty'].includes(value.responseKind) ? value.responseKind : 'unknown',
      elapsedMs: Number.isInteger(value.elapsedMs) && value.elapsedMs >= 0 && value.elapsedMs <= 3600000 ? value.elapsedMs : null,
      atUtc: typeof value.atUtc === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.atUtc) &&
        Number.isFinite(time(value.atUtc)) ? value.atUtc : null };
  }
  function normalizeDiagnostics(value) {
    if (!value || value.ok !== true || ![2, 3].includes(value.diagnosticVersion) || value.readOnly !== true || value.applyAllowed !== false ||
        !Array.isArray(value.stages) || value.stages.length > 32 || !Array.isArray(value.guards?.checks) || value.guards.checks.length > 64)
      throw fail('INVALID_RESPONSE');
    const outcome = value => ['pass', 'fail', 'skip'].includes(value) ? value : 'unknown';
    return { diagnosticVersion: value.diagnosticVersion, readOnly: true, applyAllowed: false,
      dimensionsScope: value.dimensionsScope === 'precondition_diagnostic' ? 'precondition_diagnostic' : 'unknown',
      requestState: ['pending', 'processing', 'complete', 'failed', 'applied', 'missing'].includes(value.requestState) ? value.requestState : 'unknown',
      stages: value.stages.map(item => ({ stage: safeEnum(item?.stage, STAGES), outcome: outcome(item?.outcome),
        reason: REASONS.has(item?.reason) || CODES.has(item?.reason) ? item.reason : 'UNKNOWN' })),
      prefix: { integrity: ['pass', 'fail', 'skip'].includes(value.prefix?.integrity) ? value.prefix.integrity : 'unknown',
        freshness: ['fresh', 'expired', 'invalid', 'skip'].includes(value.prefix?.freshness) ? value.prefix.freshness : 'invalid' },
      proof: { compatible: typeof value.proof?.compatible === 'boolean' ? value.proof.compatible : null },
      derivation: { valid: typeof value.derivation?.valid === 'boolean' ? value.derivation.valid : null },
      guards: { total: safeCount(value.guards.total), passed: safeCount(value.guards.passed), failed: safeCount(value.guards.failed),
        strategy: value.guards.strategy === 'individual_atomic_v3' ? 'individual_atomic_v3' : 'unknown',
        combined: { outcome: outcome(value.guards.combined?.outcome),
          reason: REASONS.has(value.guards.combined?.reason) || CODES.has(value.guards.combined?.reason) ? value.guards.combined.reason : 'UNKNOWN' },
        checks: value.guards.checks.map(item => ({ index: safeCount(item?.index), outcome: outcome(item?.outcome),
          reason: REASONS.has(item?.reason) || CODES.has(item?.reason) ? item.reason : 'UNKNOWN' })) },
      applyGuardPlan: { strategy: value.applyGuardPlan?.strategy === 'individual_atomic_v3' ? 'individual_atomic_v3' : 'unknown',
        beforeChecks: safeCount(value.applyGuardPlan?.beforeChecks), afterChecks: safeCount(value.applyGuardPlan?.afterChecks),
        sameBatch: value.applyGuardPlan?.sameBatch === true },
      dimensions: Object.fromEntries(['maxSqlBytes', 'maxBindings', 'maxBoundValueBytes', 'serializedBytes']
        .map(key => [key, safeCount(value.dimensions?.[key])])) };
  }
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
      quality: value.quality?.sampleGoodCertified === true,
      code: safeCode(value.code)
    };
  }
  function loadRecord(storage) {
    let record;
    try { record = JSON.parse(storage?.getItem(KEY) || 'null'); } catch { throw fail('SAVED_STATE_UNREADABLE'); }
    if (!record) return null;
    return normalizeRecord(record);
  }
  function normalizeRecord(record) {
    if (record.version !== 1 || !id(record.nonce) || !hash(record.proofHash) || record.requestId && !id(record.requestId)) throw fail('SAVED_STATE_UNREADABLE');
    return { version: 1, nonce: record.nonce, proofHash: record.proofHash, requestId: record.requestId || '' };
  }
  function renewalPlanReady(diagnostic) {
    if (!diagnostic || !Array.isArray(diagnostic.stages) || diagnostic.diagnosticVersion !== 3 || diagnostic.readOnly !== true || diagnostic.applyAllowed !== false ||
        diagnostic.requestState !== 'complete' || diagnostic.prefix?.integrity !== 'pass' || diagnostic.prefix.freshness !== 'expired' ||
        diagnostic.proof?.compatible !== true || diagnostic.derivation?.valid !== true ||
        diagnostic.guards?.strategy !== 'individual_atomic_v3' || diagnostic.guards.total !== 11 ||
        diagnostic.guards.passed !== 11 || diagnostic.guards.failed !== 0 || diagnostic.guards.combined?.outcome !== 'skip' ||
        diagnostic.applyGuardPlan?.strategy !== 'individual_atomic_v3' || diagnostic.applyGuardPlan.beforeChecks !== 11 ||
        diagnostic.applyGuardPlan.afterChecks !== 3 || diagnostic.applyGuardPlan.sameBatch !== true) return false;
    const required = ['EXISTING_REQUEST', 'PREFIX_INTEGRITY', 'LOAD_PROOF', 'COMPATIBILITY', 'BUILD_CERTIFICATE', 'DERIVE_APPEND_BASE', 'BEFORE_GUARDS'];
    if (!required.every(stage => diagnostic.stages.filter(item => item.stage === stage).length === 1 &&
      diagnostic.stages.find(item => item.stage === stage).outcome === 'pass')) return false;
    const checks = diagnostic.guards.checks;
    return Array.isArray(checks) && checks.length === 11 && new Set(checks.map(item => item.index)).size === 11 &&
      checks.every(item => item.outcome === 'pass' && Number.isInteger(item.index) && item.index >= 1 && item.index <= 11);
  }
  function expiredView(view, requestId) {
    return Boolean(view && !view.applied && view.eligible === false && view.code === 'SILO_PREFIX_STALE' &&
      view.request?.id === requestId && view.request.status === 'complete' && hash(view.proofHash) &&
      time(view.approvedCompletionAt) === START && time(view.prefix?.startAt) === START && time(view.prefix?.endAt) === END &&
      time(view.tail?.startAt) === END && time(view.tail?.observedAt) > END && seconds(view.tail?.runningSeconds));
  }
  function createController(deps) {
    let record = null, savedError = false, listener = () => {}, session = '', diagnosticRequestId = '';
    try { record = loadRecord(deps.storage); } catch { savedError = true; }
    let previousFailure = null;
    try { previousFailure = safeFailure(JSON.parse(deps.storage?.getItem(FAILURE_KEY) || 'null')); } catch { /* Optional history cannot block the existing request. */ }
    const state = { phase: savedError ? 'stopped' : record ? 'resume' : 'idle', view: null, busy: false,
      error: savedError ? 'SAVED_STATE_UNREADABLE' : '', readbackVerified: false, lastFailure: previousFailure, diagnostics: null };
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
    function archiveCurrent() {
      let entries;
      try {
        entries = JSON.parse(deps.storage.getItem(HISTORY_KEY) || '[]');
        if (!Array.isArray(entries) || entries.length > 10) throw fail('STORAGE_UNAVAILABLE');
        entries = entries.map(item => {
          const old = normalizeRecord(item);
          if (!old.requestId) throw fail('STORAGE_UNAVAILABLE');
          return old;
        });
        const old = normalizeRecord(record);
        const existing = entries.some(item => item.nonce === old.nonce && item.requestId === old.requestId);
        if (entries.length === 10 && !existing) throw fail('ARCHIVE_FULL');
        const next = [...entries.filter(item => item.nonce !== old.nonce || item.requestId !== old.requestId), old];
        const encoded = JSON.stringify(next);
        deps.storage.setItem(HISTORY_KEY, encoded);
        if (deps.storage.getItem(HISTORY_KEY) !== encoded) throw fail('STORAGE_UNAVAILABLE');
        return next;
      } catch (error) { if (error?.code === 'ARCHIVE_FULL') throw error; throw fail('STORAGE_UNAVAILABLE'); }
    }
    function canRenew() {
      return Boolean(record?.requestId && diagnosticRequestId === record.requestId && renewalPlanReady(state.diagnostics) &&
        (!state.view || expiredView(state.view, record.requestId)));
    }
    function ensureSession() {
      if (!deps.canWrite() || !deps.session() || session !== deps.session() || deps.isMobile()) throw fail('SESSION_CHANGED');
    }
    function rememberFailure(error, action, started) {
      const failure = safeFailure({ action, httpStatus: error?.status, code: error?.code,
        stage: action === 'READBACK' ? 'READBACK' : error?.diagnostic?.stage,
        reason: error?.diagnostic?.reason, responseKind: error?.responseKind,
        elapsedMs: Math.min(3600000, Math.max(0, Date.now() - started)), atUtc: new Date().toISOString() });
      if (!failure) return;
      // Keep the original apply failure when a subsequent read also fails.
      if (['APPLY', 'READBACK'].includes(state.lastFailure?.action) && !['APPLY', 'READBACK'].includes(action)) return;
      state.lastFailure = failure;
      try { deps.storage?.setItem(FAILURE_KEY, JSON.stringify(failure)); } catch { /* In-memory summary remains available. */ }
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
    async function run(action, operation, uncertain) {
      try { guard(); } catch (error) { state.error = error.code; emit(); return false; }
      state.busy = true; state.error = ''; deps.setBusy(true); emit();
      let currentAction = action;
      const started = Date.now();
      try {
        await operation(value => { currentAction = value; });
        return true;
      } catch (error) {
        rememberFailure(error, currentAction, started);
        state.error = ['AUTH_REQUIRED', 'READ_ONLY_MOBILE', 'SESSION_CHANGED', 'STORAGE_UNAVAILABLE', 'ARCHIVE_FULL', 'INVALID_RESPONSE',
          'REQUEST_ID_CHANGED', 'SAVED_STATE_UNREADABLE'].includes(error?.code) ? error.code
          : [401, 403].includes(Number(error?.status)) ? 'AUTH_REQUIRED'
          : error?.code === 'SILO_PREFIX_STALE' ? 'PREFIX_EXPIRED'
          : Number(error?.status) === 409 ? 'PROOF_CHANGED' : 'REQUEST_UNCERTAIN';
        if (state.error === 'PREFIX_EXPIRED' && state.view) state.view = { ...state.view, eligible: false, code: 'SILO_PREFIX_STALE' };
        if (state.error === 'PROOF_CHANGED' || state.error === 'PREFIX_EXPIRED') state.phase = 'stale';
        else if (uncertain && record) state.phase = 'resume';
        return false;
      } finally { state.busy = false; deps.setBusy(false); emit(); }
    }
    async function refresh() {
      return run('STATUS', async step => {
        const params = record?.requestId ? '&requestId=' + encodeURIComponent(record.requestId)
          : record ? '&nonce=' + encodeURIComponent(record.nonce) : '';
        const raw = await deps.api({ url: API + '?action=silo_basis_recovery_status' + params, timeoutMs: 30000 });
        ensureSession();
        const view = accept(raw);
        if (view.applied) {
          step('READBACK');
          state.readbackVerified = await deps.reload(view);
          if (!state.readbackVerified) { state.error = 'READBACK_UNCONFIRMED'; rememberFailure(fail(state.error), 'READBACK', Date.now()); }
        }
      }, false);
    }
    async function start() {
      return run('START', async () => {
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
    async function renew() {
      return run('RENEW', async () => {
        if (!canRenew()) throw fail('INVALID_RESPONSE');
        const oldId = record.requestId, oldNonce = record.nonce;
        const raw = await deps.api({ url: API + '?action=silo_basis_recovery_status&requestId=' + encodeURIComponent(oldId), timeoutMs: 30000 });
        ensureSession();
        const current = normalizeView(raw);
        if (!expiredView(current, oldId)) {
          state.view = current; state.diagnostics = null; diagnosticRequestId = '';
          throw fail('INVALID_RESPONSE');
        }
        const archived = archiveCurrent();
        const nonce = deps.nonce();
        if (!id(nonce) || nonce === oldNonce || archived.some(item => item.nonce === nonce)) throw fail('STORAGE_UNAVAILABLE');
        save({ version: 1, nonce, proofHash: current.proofHash, requestId: '' });
        state.view = null; state.diagnostics = null; diagnosticRequestId = ''; state.phase = 'resume'; state.readbackVerified = false;
        const accepted = await deps.api({ method: 'POST', timeoutMs: 30000,
          body: { action: 'start_silo_basis_recovery', expectedProofHash: record.proofHash, nonce: record.nonce } });
        ensureSession();
        if (accepted?.request?.id === oldId) throw fail('REQUEST_ID_CHANGED');
        accept(accepted);
      }, true);
    }
    async function apply() {
      return run('APPLY', async step => {
        if (state.phase !== 'ready' || !state.view?.eligible || !state.view.preview || !record?.requestId ||
            state.view.request?.id !== record.requestId || state.view.proofHash !== record.proofHash) throw fail('INVALID_RESPONSE');
        const raw = await deps.api({ method: 'POST', timeoutMs: 30000,
          body: { action: 'apply_silo_basis_recovery', requestId: record.requestId,
            expectedProofHash: record.proofHash, confirmation: 'SILO_PREFIX_STITCH' } });
        ensureSession();
        const view = accept(raw);
        if (!view.applied) throw fail('INVALID_RESPONSE');
        step('READBACK');
        state.readbackVerified = await deps.reload(view);
        if (!state.readbackVerified) { state.error = 'READBACK_UNCONFIRMED'; rememberFailure(fail(state.error), 'READBACK', Date.now()); }
      }, true);
    }
    async function diagnose() {
      return run('DIAGNOSTICS', async () => {
        if (!record?.requestId) throw fail('INVALID_RESPONSE');
        const raw = await deps.api({ url: API + '?action=silo_basis_recovery_diagnostics&requestId=' + encodeURIComponent(record.requestId), timeoutMs: 30000 });
        ensureSession();
        state.diagnostics = normalizeDiagnostics(raw);
        diagnosticRequestId = record.requestId;
        if (state.diagnostics.prefix.freshness === 'expired' && state.view) {
          state.view = { ...state.view, eligible: false, code: 'SILO_PREFIX_STALE' }; state.phase = 'stale';
        }
      }, false);
    }
    return { subscribe(fn) { listener = fn; emit(); }, refresh, start, apply, diagnose, renew, canRenew,
      snapshot: () => ({ ...state }), hasPendingNonce: () => Boolean(record && !record.requestId), hasRequest: () => Boolean(record?.requestId) };
  }
  function errorText(code) {
    return ({ AUTH_REQUIRED: '쓰기 권한으로 다시 로그인한 뒤 결과를 확인해 주세요.',
      READ_ONLY_MOBILE: 'PC 화면에서 확인하고 실행해 주세요.', SESSION_CHANGED: '로그인이 바뀌었습니다. 이력을 다시 열어 결과를 확인해 주세요.',
      BUSY: '진행 중인 조회가 끝난 뒤 확인해 주세요.', PROOF_CHANGED: '교체 근거나 누적값이 바뀌었습니다. 기존 값은 유지하며 접수 결과를 다시 확인해 주세요.',
      STORAGE_UNAVAILABLE: '이 브라우저에서 접수 정보를 보관할 수 없어 새 조회를 중단했습니다.',
      ARCHIVE_FULL: '보관된 이전 접수가 10건이어서 새 조회를 중단했습니다. 기존 접수 기록은 모두 유지합니다.',
      SAVED_STATE_UNREADABLE: '보관된 접수 정보를 확인할 수 없습니다. 새 조회를 시작하지 않았습니다.',
      INVALID_RESPONSE: '응답의 설비·구간·합계를 확인하지 못했습니다. 접수 결과를 다시 확인해 주세요.',
      REQUEST_ID_CHANGED: '기존 접수와 다른 결과여서 중단했습니다. 접수 결과를 다시 확인해 주세요.',
      READBACK_UNCONFIRMED: '반영 응답을 받았지만 최신 화면 대조가 끝나지 않았습니다. 읽기 전용 점검을 사용할 수 있습니다.',
      PREFIX_EXPIRED: '수집 결과의 15분 유효기간이 만료되어 반영할 수 없습니다. 저장 오류 점검은 계속 사용할 수 있습니다.',
      REQUEST_UNCERTAIN: '요청 결과를 확인하지 못했습니다. 아래 오류 기록과 읽기 전용 점검을 확인해 주세요.' })[code] || '';
  }
  function failureSummary(value) {
    const failure = safeFailure(value);
    if (!failure) return '직전 오류 기록: 없음 · 이전 오류의 HTTP 상태는 저장되지 않았습니다.';
    return ['직전 오류', failure.action, failure.httpStatus === null ? 'HTTP 기록 없음' : 'HTTP ' + failure.httpStatus,
      failure.code, failure.stage, failure.reason,
      failure.responseKind !== 'unknown' ? failure.responseKind : '',
      failure.elapsedMs === null ? '' : failure.elapsedMs + 'ms', failure.atUtc || ''].filter(Boolean).join(' · ');
  }
  function diagnosticSummary(state, includeDimensions = true) {
    const lines = ['Silo #B 저장 오류 점검 · 읽기 전용', failureSummary(state.lastFailure)];
    if (state.view) lines.push('현재 반영 상태: ' + (state.view.eligible === true ? '검증 통과' : '반영 불가') +
      (safeCode(state.view.code) !== 'UNKNOWN' ? ' · ' + safeCode(state.view.code) : ''));
    if (state.diagnostics) {
      const diagnostic = normalizeDiagnostics({ ...state.diagnostics, ok: true });
      const outcomes = { pass: '통과', fail: '실패', skip: '미실행', unknown: '미확인' };
      const stages = { EXISTING_REQUEST: '기존 접수', PREFIX_INTEGRITY: '앞 구간 원본', PREFIX_FRESHNESS: '수집 유효기간',
        LOAD_PROOF: '승인 원문·보존 구간', COMPATIBILITY: '기존 근거와 연결', BUILD_CERTIFICATE: '결합 근거 구성',
        DERIVE_APPEND_BASE: '누적 합계 검증', BEFORE_GUARDS: '저장 전 비교', REPLAY_CHECK: '기반영 확인' };
      lines.push('diagnosticVersion=' + diagnostic.diagnosticVersion + ' · readOnly=true · applyAllowed=false');
      lines.push('조회 생성·DB 변경: 없음');
      lines.push('앞 구간 원본: ' + outcomes[diagnostic.prefix.integrity] + ' · 유효기간: ' +
        ({ fresh: '유효', expired: '만료', invalid: '미확인', skip: '미실행' })[diagnostic.prefix.freshness]);
      for (const item of diagnostic.stages) lines.push((stages[item.stage] || '기타 점검') + ': ' + outcomes[item.outcome] +
        ' [' + item.stage + (item.reason !== 'UNKNOWN' ? '/' + item.reason : '') + ']');
      lines.push('저장 전 비교: 전체 ' + diagnostic.guards.total + ' · 통과 ' + diagnostic.guards.passed + ' · 실패 ' + diagnostic.guards.failed);
      if (diagnostic.guards.strategy === 'individual_atomic_v3') {
        const plan = diagnostic.applyGuardPlan;
        lines.push('개별 비교 반영 계획: 저장 전 ' + plan.beforeChecks + '개 · 저장 후 ' + plan.afterChecks + '개 · ' +
          (plan.sameBatch ? '하나의 트랜잭션에서 검사' : '계획 미확인'));
        lines.push('위 결과는 읽기 전용 점검이며 실제 반영은 별도입니다.');
      } else lines.push('저장 전 통합 비교: ' + outcomes[diagnostic.guards.combined.outcome] +
        (diagnostic.guards.combined.reason !== 'UNKNOWN' ? ' [' + diagnostic.guards.combined.reason + ']' : ''));
      const d = diagnostic.dimensions;
      if (includeDimensions) lines.push('진단 사전점검 크기 [' + diagnostic.dimensionsScope + ']: SQL ' + d.maxSqlBytes + 'B · bind ' + d.maxBindings +
        ' · 최대 값 ' + d.maxBoundValueBytes + 'B · 직렬화 ' + d.serializedBytes + 'B');
      if (diagnostic.prefix.freshness === 'expired') lines.push('유효기간 만료 상태를 유지합니다. 이 점검은 반영하거나 새로 수집하지 않습니다.');
    }
    return lines.join('\n');
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
    const failure = doc.createElement('p'); failure.className = 'silo-basis-recovery-failure';
    const diagnostic = doc.createElement('pre'); diagnostic.className = 'silo-basis-recovery-diagnostic';
    const actions = doc.createElement('div'); actions.className = 'silo-basis-recovery-actions';
    const check = doc.createElement('button'), start = doc.createElement('button'), apply = doc.createElement('button');
    const diagnose = doc.createElement('button'), copy = doc.createElement('button'), renew = doc.createElement('button');
    const clipboard = options.clipboard || (typeof navigator !== 'undefined' ? navigator.clipboard : null);
    for (const button of [check, start, apply, diagnose, copy, renew]) { button.type = 'button'; button.className = 'button secondary'; actions.appendChild(button); }
    apply.className = 'button primary';
    check.addEventListener('click', () => { void controller.refresh(); });
    start.addEventListener('click', () => { void controller.start(); });
    apply.addEventListener('click', () => { void controller.apply(); });
    diagnose.addEventListener('click', () => { void controller.diagnose(); });
    renew.addEventListener('click', () => { void controller.renew(); });
    copy.addEventListener('click', async () => {
      if (!clipboard?.writeText) return;
      try { await clipboard.writeText(diagnosticSummary(controller.snapshot())); copy.textContent = '복사 완료'; }
      catch { copy.textContent = '복사할 수 없음'; }
    });
    for (const item of [title, intro, facts, note, status, failure, diagnostic, actions]) section.appendChild(item);
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
        stale: state.view?.code === 'SILO_PREFIX_STALE'
          ? '수집 결과의 15분 유효기간이 만료되어 반영할 수 없습니다. 현재 만료 상태와 직전 저장 오류를 따로 표시합니다.'
          : '현재 근거나 누적값을 확인할 수 없어 반영할 수 없습니다. 읽기 전용 점검을 사용할 수 있습니다.',
        failed: '누락 구간 조회가 실패했습니다. 기존 교체 기준과 측정값은 유지합니다.',
        stopped: '접수 정보를 확인할 수 없어 중단했습니다.' };
      status.textContent = state.busy ? '확인 중입니다. 창을 닫아도 기존 접수 정보는 유지됩니다.' : errorText(state.error) || messages[state.phase];
      if (!state.busy && state.view?.code !== 'UNKNOWN' && state.view?.code) status.textContent += ' [' + state.view.code + ']';
      failure.hidden = !state.lastFailure && !controller.hasRequest();
      failure.textContent = failureSummary(state.lastFailure);
      diagnostic.hidden = !state.diagnostics;
      diagnostic.textContent = state.diagnostics ? diagnosticSummary(state, false) : '';
      check.textContent = state.phase === 'idle' ? '승인 근거 확인' : '조회 결과 확인';
      check.disabled = state.busy;
      start.hidden = !(state.phase === 'verified' || controller.hasPendingNonce());
      start.textContent = controller.hasPendingNonce() ? '기존 접수 다시 확인' : '누락 구간 RUN 조회';
      start.disabled = state.busy || state.phase === 'stale' || state.phase === 'stopped';
      apply.textContent = '교체 기준과 누적시간 함께 반영';
      apply.hidden = state.phase !== 'ready';
      apply.disabled = state.busy || ['AUTH_REQUIRED', 'SESSION_CHANGED', 'READ_ONLY_MOBILE'].includes(state.error);
      diagnose.textContent = '저장 오류 점검 (읽기 전용)';
      diagnose.hidden = !controller.hasRequest(); diagnose.disabled = state.busy;
      copy.textContent = '진단 결과 복사'; copy.hidden = !clipboard?.writeText || !state.diagnostics; copy.disabled = state.busy;
      renew.textContent = '누락 구간 다시 조회'; renew.hidden = !controller.canRenew(); renew.disabled = state.busy;
      renew.title = '이전 요청을 보존하고 같은 누락 구간을 새로 측정합니다. 기존 누적값은 반영 전까지 유지합니다.';
    });
    return controller;
  }
  return { TAG, KEY, FAILURE_KEY, HISTORY_KEY, normalizeView, normalizeDiagnostics, renewalPlanReady, safeFailure, failureSummary, diagnosticSummary,
    createController, mount, verifyReadback, formatTime, hours };
});
