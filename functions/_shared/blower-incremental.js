/* BLOWER_INCREMENTAL_REFRESH_V1
 * Server-owned append receipts. The Agent still reads a fixed [start,end] RUN
 * interval; only this server may attach that interval to a verified predecessor.
 * A request CAS revision and the existing atomic history guard prevent double-adds.
 */
const instant = v => typeof v === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
const number = v => v !== null && v !== undefined && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v)) ? Number(v) : NaN;
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.000001;
export function incrementalEvidence(source) {
  const x = source?.incremental;
  if (!x) return null;
  const from = instant(x.coverageStartAt), baseAt = instant(x.baseObservedAt), end = instant(source.observedAt || source.endAt);
  if (x.version !== 1 || typeof x.baseEventId !== 'string' || !x.baseEventId.startsWith('dataparc_runtime:') ||
      !Number.isFinite(from) || !Number.isFinite(baseAt) || !Number.isFinite(end) || from >= baseAt || baseAt !== instant(source.startAt) || end <= baseAt ||
      !Number.isSafeInteger(x.baseRunningSeconds) || x.baseRunningSeconds < 0 ||
      !Number.isSafeInteger(x.deltaRunningSeconds) || x.deltaRunningSeconds < 0 ||
      x.deltaRunningSeconds !== source.runningSeconds || !Number.isSafeInteger(x.totalRunningSeconds) ||
      x.totalRunningSeconds !== x.baseRunningSeconds + x.deltaRunningSeconds) return null;
  return x;
}
function strictVerifiedAppendBase(asset, rows, dataParcTag) {
  if (!asset?.last_replacement_at) return null;
  const assetTag = String(asset.tag_number || '').trim().toUpperCase();
  const fbheSealBinaryRun = /^(?:104|204)HHL(?:60AP|10AN)(?:611|621|631)$/.test(assetTag);
  if (asset.cycle_start_state === 'pending' && !fbheSealBinaryRun) return null;
  const stored = number(asset.cycle_runtime_hours), anchor = instant(asset.cycle_runtime_anchor_at);
  if (!Number.isFinite(stored) || stored < 0 || !Number.isFinite(anchor)) return null;
  // Latest timestamp-owned event, not just ANY historical row with equal hours.
  const matching = (rows || []).filter(r => r.tag_number === asset.tag_number &&
    ['runtime_correction','startup','operation_start','operation_stop'].includes(r.event_type) &&
    instant(r.event_date) === anchor && near(number(r.runtime_hours), stored))
    .sort((a,b) => (instant(b.updated_at || b.created_at || b.event_date) - instant(a.updated_at || a.created_at || a.event_date)) ||
      String(b.created_at || '').localeCompare(String(a.created_at || '')) || String(b.id).localeCompare(String(a.id)));
  const row = matching[0];
  if (!row || row.source_type !== 'dataparc_runtime' || row.event_type !== 'runtime_correction') return null;
  let s; try { s = JSON.parse(row.source_text); } catch { return null; }
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const actualCycleStartState = asset.cycle_start_state || 'legacy';
  const signalOnlyPending = fbheSealBinaryRun && actualCycleStartState === 'pending' &&
    s.expectedCycleStartState === 'legacy' && s.signalOnlyCycle === true && !String(s.expectedCycleStartedAt || '');
  if (s.schemaVersion !== 1 || s.assetTag !== asset.tag_number || s.dataParcTag !== dataParcTag ||
      s.requestType !== 'blower_runtime_probe' || s.requestId !== row.source_log_id || row.id !== `dataparc_runtime:${s.requestId}` ||
      instant(s.expectedLastReplacementAt) !== instant(asset.last_replacement_at) ||
      (s.expectedCycleStartState !== actualCycleStartState && !signalOnlyPending) ||
      String(s.expectedCycleStartRevision || '') !== String(asset.cycle_start_revision || '') ||
      (actualCycleStartState === 'started' && instant(s.expectedCycleStartedAt) !== instant(asset.cycle_started_at)) ||
      instant(s.observedAt || s.endAt) !== anchor || s.endState !== asset.cycle_runtime_state ||
      !['running','stopped'].includes(s.endState)) return null;
  const x = incrementalEvidence(s);
  if (s.incremental && !x) return null;
  const seconds = x ? x.totalRunningSeconds : s.runningSeconds;
  const startAt = x ? x.coverageStartAt : s.startAt;
  const start = instant(startAt);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isFinite(start) || start < instant(asset.last_replacement_at) || start >= anchor ||
      // Compare raw stored hours, retaining exact integer seconds across appends.
      !near(seconds / 3600, stored)) return null;
  return { eventId: row.id, requestId: s.requestId, startAt, observedAt: s.observedAt || s.endAt,
    dataParcTag: s.dataParcTag, runningSeconds: seconds, runtimeHours: stored,
    state: s.endState, cycleRuntimeRevision: asset.cycle_runtime_revision };
}

function eventOrder(a, b) {
  return (instant(b.updated_at || b.created_at || b.event_date) - instant(a.updated_at || a.created_at || a.event_date)) ||
    String(b.created_at || '').localeCompare(String(a.created_at || '')) ||
    String(b.id || '').localeCompare(String(a.id || ''));
}

const sameManualRuntime = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.000001;

function manualRuntimeOverlayState(row) {
  if (row?.event_type === 'operation_start') return 'running';
  if (row?.event_type === 'operation_stop') return 'stopped';
  if (row?.event_type !== 'runtime_correction' || row?.source_type !== 'manual') return '';
  const action = String(row.action_type || '').trim().toLowerCase();
  if (action === '운전중' || action === 'running') return 'running';
  if (action === '정지' || action === 'stopped') return 'stopped';
  return '';
}

/* BLOWER_INCREMENTAL_MANUAL_BOUNDARY_V2
 * A measured Blower may have a manual operation_start/operation_stop, or an
 * exact-state manual runtime_correction that leaves the cumulative value
 * unchanged, after the last successful DataPARC sample. Those boundaries change
 * the asset runtime revision/anchor but not the verified RUN seconds. Resume from
 * the last DataPARC observedAt only when every intervening runtime overlay is a
 * parseable manual boundary with the same cumulative value. A changed total,
 * startup, pending cycle, non-manual/unknown overlay, or cycle change fails closed.
 */
function verifiedManualBoundaryAppendBase(asset, rows, dataParcTag) {
  if (!asset?.last_replacement_at || asset.cycle_start_state === 'pending') return null;
  const replacement = instant(asset.last_replacement_at);
  const currentAnchor = instant(asset.cycle_runtime_anchor_at);
  const currentHours = number(asset.cycle_runtime_hours);
  if (!Number.isFinite(replacement) || !Number.isFinite(currentAnchor) ||
      !Number.isFinite(currentHours) || currentHours < 0 ||
      !['running','stopped'].includes(String(asset.cycle_runtime_state || ''))) return null;

  const relevant = (rows || []).filter(r => r.tag_number === asset.tag_number &&
    ['runtime_correction','startup','operation_start','operation_stop'].includes(r.event_type));
  const currentOwner = relevant.filter(r => instant(r.event_date) === currentAnchor && sameManualRuntime(number(r.runtime_hours), currentHours))
    .sort(eventOrder)[0];
  const ownerState = manualRuntimeOverlayState(currentOwner);
  if (!currentOwner || currentOwner.source_type !== 'manual' || !ownerState || ownerState !== asset.cycle_runtime_state) return null;

  const candidates = relevant.filter(r => r.source_type === 'dataparc_runtime' && r.event_type === 'runtime_correction')
    .map(row => {
      let source; try { source = JSON.parse(row.source_text); } catch { return null; }
      const observedAt = source?.observedAt || source?.endAt || '';
      return { row, source, observed: instant(observedAt), observedAt };
    })
    .filter(Boolean)
    .sort((a, b) => b.observed - a.observed || eventOrder(a.row, b.row));

  for (const candidate of candidates) {
    if (!Number.isFinite(candidate.observed) || candidate.observed < replacement || candidate.observed >= currentAnchor) continue;
    const shadow = { ...asset,
      cycle_runtime_hours: candidate.row.runtime_hours,
      cycle_runtime_anchor_at: candidate.observedAt,
      cycle_runtime_state: candidate.source?.endState || ''
    };
    const base = strictVerifiedAppendBase(shadow, [candidate.row], dataParcTag);
    if (!base || !sameManualRuntime(base.runtimeHours, currentHours)) continue;

    const overlays = relevant.filter(r => {
      const at = instant(r.event_date);
      return Number.isFinite(at) && at > candidate.observed && at <= currentAnchor;
    });
    if (!overlays.some(r => r.id === currentOwner.id)) continue;
    const manualOnly = overlays.every(r => r.source_type === 'manual' &&
      Boolean(manualRuntimeOverlayState(r)) && sameManualRuntime(number(r.runtime_hours), currentHours));
    if (!manualOnly) continue;

    return { ...base, cycleRuntimeRevision: asset.cycle_runtime_revision };
  }
  return null;
}

export function verifiedAppendBase(asset, rows, dataParcTag) {
  return strictVerifiedAppendBase(asset, rows, dataParcTag) ||
    verifiedManualBoundaryAppendBase(asset, rows, dataParcTag);
}

export async function loadAppendBase(database, asset, dataParcTag) {
  // Read the current Cycle beyond its runtime anchor: a manual boundary can sit
  // after the last DataPARC success while preserving its RUN total. Older Cycles
  // are unrelated and can make this hot-path history scan grow without bound.
  const result = await database.prepare(`SELECT * FROM blower_history_events
    WHERE tag_number = ? AND event_type IN ('runtime_correction','startup','operation_start','operation_stop')
      AND datetime(event_date) >= datetime(?)
    ORDER BY event_date DESC, updated_at DESC, created_at DESC, id DESC`)
    .bind(asset.tag_number, asset.last_replacement_at).all();
  return verifiedAppendBase(asset, result.results || [], dataParcTag);
}
export async function ensureAppendSchema(database) {
  await database.prepare(`CREATE TABLE IF NOT EXISTS blower_runtime_append_v1 (
    request_id TEXT PRIMARY KEY, base_event_id TEXT NOT NULL, base_revision TEXT NOT NULL,
    base_observed_at TEXT NOT NULL, coverage_start_at TEXT NOT NULL,
    base_running_seconds INTEGER NOT NULL CHECK(base_running_seconds >= 0), created_at TEXT NOT NULL
  )`).run();
}
export function appendIntentStatement(database, requestId, base, createdAt) {
  return database.prepare(`INSERT INTO blower_runtime_append_v1
    (request_id, base_event_id, base_revision, base_observed_at, coverage_start_at, base_running_seconds, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(requestId, base.eventId, base.cycleRuntimeRevision, base.observedAt, base.startAt, base.runningSeconds, createdAt);
}
export async function loadAppendIntent(database, requestId) {
  try { return await database.prepare('SELECT * FROM blower_runtime_append_v1 WHERE request_id = ? LIMIT 1').bind(requestId).first(); }
  catch (e) { if (/no such table:.*blower_runtime_append_v1/i.test(String(e?.message || e))) return null; throw e; }
}
export function combineAppendProbe(probe, receipt) {
  if (!receipt) return { ...probe };
  const seconds = number(receipt.base_running_seconds);
  const from = instant(receipt.coverage_start_at), base = instant(receipt.base_observed_at);
  if (receipt.request_id !== probe.requestId || receipt.base_revision !== probe.expectedCycleRuntimeRevision ||
      base !== instant(probe.startAt) || !Number.isFinite(from) || from < instant(probe.expectedLastReplacementAt) || from >= base ||
      !Number.isSafeInteger(seconds) || seconds < 0 || !Number.isSafeInteger(seconds + probe.runningSeconds)) {
    throw Object.assign(new Error('증분 조회의 마지막 성공 시각·누적 기준이 일치하지 않습니다. 기존 값은 유지합니다.'), {code:'DATAPARC_APPEND_INTENT_CONFLICT'});
  }
  const total = seconds + probe.runningSeconds;
  return { ...probe, runtimeHours: total / 3600,
    incremental: { version: 1, baseEventId: receipt.base_event_id, baseObservedAt: receipt.base_observed_at,
      coverageStartAt: receipt.coverage_start_at, baseRunningSeconds: seconds,
      deltaRunningSeconds: probe.runningSeconds, totalRunningSeconds: total } };
}
