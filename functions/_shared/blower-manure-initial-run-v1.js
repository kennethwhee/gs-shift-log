/* Explicit operator-confirmed commissioning basis; never a V-Belt replacement.
 * The legacy last_replacement_at column carries the query/CAS cycle baseline.
 * An immutable startup event distinguishes that internal anchor from a genuine
 * replacement. GET requests only project this evidence; they never initialize it.
 */
export const MANURE_INITIAL_RUN_CONFIG = Object.freeze({
  version: 1,
  tagNumber: '204LMDF01AN001',
  dataParcTag: 'GSPOGE.ABB_DCS.204LMDF01AN001XB04',
  originalDisplayTag: 'GSPOGE.ABB_DCS.204LMDF01AN001XB04/PLOT',
  initialStartupAt: '2026-09-11T04:27:00.000Z',
  eventId: 'initial-startup:manure-run-v1:204LMDF01AN001',
  sourceType: 'initial_startup_confirmed'
});
const config = MANURE_INITIAL_RUN_CONFIG;
const auditId = config.eventId + ':audit';
const actionType = '최초 기동 기준 등록';
const text = value => String(value ?? '').trim();
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
const sameInstant = (left, right) => Number.isFinite(instant(left)) && instant(left) === instant(right);
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const conflict = () => json({ ok: false, code: 'MANURE_INITIAL_RUN_CONFLICT',
  message: '축분 Blower의 기존 이력 또는 운전 기준이 있어 최초 기동 기준을 자동으로 덮어쓰지 않았습니다. 기존 이력을 확인해 주세요.' }, 409);

export function configuredManureRunSignal(asset) {
  return (asset?.tag_number || asset?.tagNumber) === config.tagNumber ? config.dataParcTag : '';
}
export function isProtectedManureInitialEvent(event) {
  return event?.id === config.eventId || (event?.source_type || event?.sourceType) === config.sourceType;
}
function initialEvidence(row) {
  if (!row || row.id !== config.eventId || row.tag_number !== config.tagNumber || row.event_type !== 'startup' ||
      row.source_type !== config.sourceType || row.action_type !== actionType || text(row.source_log_id) ||
      !sameInstant(row.event_date, config.initialStartupAt) || row.runtime_hours !== 0 ||
      !Number.isFinite(instant(row.created_at)) || row.updated_at !== row.created_at) return null;
  let source; try { source = JSON.parse(row.source_text); } catch { return null; }
  if (!source || typeof source !== 'object' || Array.isArray(source) || source.version !== config.version ||
      source.kind !== 'initial_startup' || source.operatorConfirmed !== true ||
      source.assetTag !== config.tagNumber || source.dataParcTag !== config.dataParcTag ||
      source.originalDisplayTag !== config.originalDisplayTag || source.initialStartupAt !== config.initialStartupAt ||
      source.actualReplacementRecorded !== false || typeof source.cycleStartRevision !== 'string' || !source.cycleStartRevision) return null;
  return source;
}
export function manureInitialRunBasis(asset, rows) {
  if (asset?.tag_number !== config.tagNumber) return null;
  const row = (rows || []).find(item => item.id === config.eventId);
  const source = initialEvidence(row);
  if (!source || asset.cycle_start_state !== 'started' || asset.cycle_start_revision !== source.cycleStartRevision ||
      !sameInstant(asset.last_replacement_at, config.initialStartupAt) ||
      !sameInstant(asset.cycle_started_at, config.initialStartupAt)) return null;
  return { cycleBasisKind: 'initial_startup', initialStartedAt: config.initialStartupAt, actualLastReplacementAt: '' };
}
export async function loadManureInitialAudit(database) {
  return database.prepare('SELECT id, action_type, tag_number, after_json FROM blower_history_asset_history WHERE id = ? AND tag_number = ?')
    .bind(auditId, config.tagNumber).first();
}
export function manureInitialRunProjection(asset, rows, audit) {
  const basis = manureInitialRunBasis(asset, rows);
  if (basis) return { ...basis, initialStartupEvidenceValid: true };
  if (!audit || audit.id !== auditId || audit.tag_number !== config.tagNumber || audit.action_type !== 'initialize_manure_run') return null;
  let archived; try { archived = JSON.parse(audit.after_json); } catch { return null; }
  const archivedBasis = manureInitialRunBasis(asset, [archived?.event]);
  // The immutable audit can preserve an honest label when primary evidence was
  // damaged. This is not initialization, measured RUN evidence, or permission to
  // recreate the event. The explicit initializer rejects this integrity state.
  return archivedBasis ? { ...archivedBasis, initialStartupEvidenceValid: false } : null;
}
function success(disposition, asset, rows) {
  const basis = manureInitialRunBasis(asset, rows);
  return json({ ok: true, disposition, initialized: disposition === 'initialized', tagNumber: config.tagNumber,
    cycleBasisKind: basis?.cycleBasisKind || (text(asset?.last_replacement_at) ? 'replacement' : 'uninitialized'),
    initialStartedAt: basis?.initialStartedAt || '',
    message: disposition === 'initialized' ? '축분 Blower의 확인된 최초 기동 기준을 등록했습니다. V-Belt 교체 이력은 만들지 않았으며 RUN 조회가 필요합니다.'
      : disposition === 'already_initialized' ? '이미 등록된 최초 기동 기준과 기존 조회값을 유지합니다.'
        : '기존 축분 Blower Cycle과 이력을 유지합니다.' });
}
async function readState(database) {
  const asset = await database.prepare('SELECT * FROM blower_history_assets WHERE tag_number = ?').bind(config.tagNumber).first();
  const result = await database.prepare('SELECT * FROM blower_history_events WHERE tag_number = ? ORDER BY id').bind(config.tagNumber).all();
  const audit = await database.prepare('SELECT id FROM blower_history_asset_history WHERE tag_number = ? LIMIT 1').bind(config.tagNumber).first();
  const initialAudit = await loadManureInitialAudit(database);
  return { asset, rows: result.results || [], audit, initialAudit };
}
function existingResult(state) {
  const { asset, rows } = state;
  if (!asset || Number(asset.enabled) !== 1 || asset.blower_type !== 'organic_fuel' || asset.asset_group !== 'manure' || String(asset.unit_no) !== '2') return conflict();
  if (manureInitialRunBasis(asset, rows)) return success('already_initialized', asset, rows);
  if (manureInitialRunProjection(asset, rows, state.initialAudit)) return conflict();
  // A changed/deleted commissioning record must never silently become a fresh
  // initialization, or be described as a genuine replacement at the same anchor.
  if (rows.some(isProtectedManureInitialEvent) && sameInstant(asset.last_replacement_at, config.initialStartupAt)) return conflict();
  if (text(asset.last_replacement_at)) return success('existing_cycle', asset, rows);
  return null;
}
function pristine({ asset, rows, audit }) {
  return !rows.length && !audit && !text(asset.last_replacement_at) && !text(asset.cycle_started_at) &&
    asset.cycle_start_state === 'pending' && !text(asset.cycle_start_revision) &&
    asset.cycle_runtime_hours === 0 && asset.runtime_hours === 0 &&
    !text(asset.cycle_runtime_anchor_at) && !text(asset.runtime_anchor_at) &&
    asset.cycle_runtime_state === 'unknown' && Number(asset.is_running) === 0 &&
    typeof asset.cycle_runtime_revision === 'string' && Boolean(asset.cycle_runtime_revision.trim()) &&
    !text(asset.last_modified_by_id) && !text(asset.last_modified_by_name);
}

export async function initializeManureInitialRun(database, user, body, options = {}) {
  if (!user?.employeeNo) return json({ ok: false, message: '로그인이 필요합니다.' }, 401);
  if (body?.unifiedRefresh !== true) return json({ ok: false, code: 'MANURE_INITIAL_RUN_EXPLICIT_REFRESH_REQUIRED',
    message: '데스크톱의 명시적인 통합 최신화에서만 최초 기동 기준을 등록할 수 있습니다.' }, 400);
  if ((body.tagNumber !== undefined && body.tagNumber !== config.tagNumber) ||
      (body.configVersion !== undefined && body.configVersion !== config.version)) return conflict();
  const state = await readState(database);
  const existing = existingResult(state);
  if (existing) return existing;
  if (!pristine(state)) return conflict();
  const now = options.now instanceof Date ? options.now : new Date();
  if (!Number.isFinite(now.getTime()) || now.getTime() < Date.parse(config.initialStartupAt)) return conflict();
  const at = now.toISOString(), startRevision = crypto.randomUUID(), runtimeRevision = crypto.randomUUID();
  const { asset } = state;
  const patch = {
    last_replacement_at: config.initialStartupAt, cycle_started_at: config.initialStartupAt,
    cycle_start_state: 'started', cycle_start_revision: startRevision,
    cycle_runtime_hours: 0, cycle_runtime_anchor_at: config.initialStartupAt, cycle_runtime_state: 'unknown',
    cycle_runtime_revision: runtimeRevision, runtime_hours: 0, runtime_anchor_at: null, is_running: 0,
    last_modified_by_id: user.employeeNo, last_modified_by_name: text(user.name), updated_at: at
  };
  const after = { ...asset, ...patch };
  const evidence = { version: config.version, kind: 'initial_startup', operatorConfirmed: true,
    assetTag: config.tagNumber, dataParcTag: config.dataParcTag, originalDisplayTag: config.originalDisplayTag,
    initialStartupAt: config.initialStartupAt, suppliedLocalStart: '9/11 13:27', interpretedYear: 2026,
    timeZone: 'Asia/Seoul', yearAssumedFromContext: true, actualReplacementRecorded: false,
    cycleStartRevision: startRevision };
  const event = { id: config.eventId, tag_number: config.tagNumber, event_type: 'startup',
    event_date: config.initialStartupAt, runtime_hours: 0, issue_type: '최초 기동', action_type: actionType,
    note: '사용자가 확인한 최초 기동 기준입니다. V-Belt 교체 기록 또는 RUN 측정값이 아닙니다.',
    source_type: config.sourceType, source_log_id: '', source_text: JSON.stringify(evidence),
    created_by_id: user.employeeNo, created_by_name: text(user.name), created_at: at, updated_at: at };
  const audit = { id: auditId, action_type: 'initialize_manure_run', tag_number: config.tagNumber,
    before_json: JSON.stringify(asset), after_json: JSON.stringify({ asset: after, event }),
    change_note: '확인된 최초 기동 기준 등록; 실제 V-Belt 교체 이력 없음; RUN 조회 전 누적 미확정',
    changed_by_id: user.employeeNo, changed_by_name: text(user.name), changed_at: at };
  const column = name => '"' + name.replace(/"/g, '""') + '"';
  const condition = row => Object.keys(row).map(key => `${column(key)} IS ?`).join(' AND ');
  const exists = (table, row) => ({ sql: `EXISTS (SELECT 1 FROM ${table} WHERE ${condition(row)})`, values: Object.values(row) });
  const insert = (table, row) => database.prepare(`INSERT INTO ${table} (${Object.keys(row).map(column).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row));
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const guard = (id, checks) => database.prepare(`INSERT INTO blower_history_atomic_guard(id,valid)
    VALUES (?,CASE WHEN ${checks.map(check => '(' + check.sql + ')').join(' AND ')} THEN 1 ELSE 0 END)`).bind(id, ...checks.flatMap(check => check.values));
  const noHistory = { sql: 'NOT EXISTS (SELECT 1 FROM blower_history_events WHERE tag_number = ?) AND NOT EXISTS (SELECT 1 FROM blower_history_asset_history WHERE tag_number = ?)', values: [config.tagNumber, config.tagNumber] };
  const statements = [guard(ids[0], [exists('blower_history_assets', asset), noHistory]),
    database.prepare(`UPDATE blower_history_assets SET ${Object.keys(patch).map(key => `${column(key)} = ?`).join(',')}
      WHERE ${condition(asset)}`).bind(...Object.values(patch), ...Object.values(asset)),
    insert('blower_history_events', event), insert('blower_history_asset_history', audit),
    guard(ids[1], [exists('blower_history_assets', after), exists('blower_history_events', event), exists('blower_history_asset_history', audit),
      { sql: '(SELECT COUNT(*) FROM blower_history_events WHERE tag_number = ?) = 1', values: [config.tagNumber] }]),
    database.prepare('DELETE FROM blower_history_atomic_guard WHERE id IN (?,?)').bind(...ids)];
  try { await database.batch(statements); }
  catch (error) {
    const current = await readState(database);
    if (manureInitialRunBasis(current.asset, current.rows)) return success('already_initialized', current.asset, current.rows);
    if (/CHECK constraint failed|UNIQUE constraint failed/i.test(String(error?.message || error))) return conflict();
    throw error;
  }
  return success('initialized', after, [event]);
}
