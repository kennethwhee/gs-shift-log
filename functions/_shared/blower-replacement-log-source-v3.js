/* Bounded, approved work-log sources for replacement reconciliation only.
 * Reading never writes a receipt. Operation receipts keep their original IDs. */
export const REPLACEMENT_ANALYSIS_VERSION = 'replacement-auto-v3';
export const REPLACEMENT_NORMALIZE_ANALYSIS_VERSION = 'replacement-normalize-v4';
export const REPLACEMENT_ROLE_PRIORITY_ANALYSIS_VERSION = 'replacement-normalize-v4-role-priority-v1';
export const REPLACEMENT_PAGE_MAX = 8;
const DAY = 86400000;
const TABLES = ['shift_logs', 'legacy_logs', 'blower_log_receipts_v1', 'legacy_log_suppressions'];
const id = value => '"' + String(value).replace(/"/g, '""') + '"';
const literal = value => "'" + String(value).replace(/'/g, "''") + "'";
const kstDay = value => new Date(value + 9 * 3600000).toISOString().slice(0, 10);
const approved = alias => `(${alias}.status='결재완료' OR upper(${alias}.status)='APPROVED')`;
const operationalRole = alias => `(upper(replace(replace(replace(trim(COALESCE(${alias}.role,'')),'_',''),'-',''),' ','')) NOT IN ('PARTLEADER','GROUPLEADER','SHIFTLEADER') AND instr(COALESCE(${alias}.role,''),'파트장')=0)`;
// Presence includes unchecked/stale markers: the controlled parser must see
// them so it can suppress a legacy text fallback for that exact entry.
const authorAnnotation = alias => `instr(${alias}.log_json, '"vBeltReplacement"') > 0`;
function analysisVersion(value = 3) {
  if (![3,4].includes(value)) fail('교체 원문 분석 버전이 올바르지 않습니다.', 'BLOWER_REPLACEMENT_ANALYSIS_VERSION_INVALID', 400);
  return value === 4 ? REPLACEMENT_NORMALIZE_ANALYSIS_VERSION : REPLACEMENT_ANALYSIS_VERSION;
}
function fail(message, code = 'BLOWER_REPLACEMENT_SOURCE_INVALID', status = 409) {
  const error = new Error(message); Object.assign(error, { code, status }); throw error;
}
function parseWindow(body, now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail('교체 원문 기준시각을 확인할 수 없습니다.');
  if (body?.phase !== undefined && body.phase !== 'replacement') fail('교체 원문 단계가 올바르지 않습니다.', 'BLOWER_LOG_PAGE_INVALID', 400);
  const limit = body?.limit === undefined ? 4 : body.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > REPLACEMENT_PAGE_MAX) fail('교체 원문은 요청당 1~8건으로 처리합니다.', 'BLOWER_LOG_PAGE_INVALID', 400);
  let window;
  if (body?.window == null) {
    if (body?.cursor != null) fail('교체 원문 조회기간 없이 이어서 처리할 수 없습니다.', 'BLOWER_LOG_PAGE_INVALID', 400);
    window = { fromDate: kstDay(now.getTime() - 365 * DAY), endDate: kstDay(now.getTime()), snapshotAt: now.toISOString() };
  } else {
    const raw = body.window, stamp = Date.parse(raw?.snapshotAt || '');
    if (!Number.isFinite(stamp) || stamp > now.getTime() + 60000 || now.getTime() - stamp > DAY ||
        raw.fromDate !== kstDay(stamp - 365 * DAY) || raw.endDate !== kstDay(stamp)) {
      fail('교체 원문 조회기간이 만료되었거나 올바르지 않습니다.', 'BLOWER_LOG_PAGE_INVALID', 400);
    }
    window = { fromDate: raw.fromDate, endDate: raw.endDate, snapshotAt: new Date(stamp).toISOString() };
  }
  if (body?.cursor != null) {
    const cursor = body.cursor;
    if (typeof cursor.workDate !== 'string' || cursor.workDate < window.fromDate || cursor.workDate > window.endDate ||
        typeof cursor.updatedAt !== 'string' || cursor.updatedAt.length > 64 ||
        typeof cursor.id !== 'string' || !/^[a-f0-9]{64}$/.test(cursor.id)) {
      fail('교체 원문 이어보기 위치가 올바르지 않습니다.', 'BLOWER_LOG_PAGE_INVALID', 400);
    }
  }
  return { window, limit };
}
function columns(ddl) {
  const result = new Set();
  for (const match of String(ddl || '').matchAll(/(?:\(|,)\s*["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?\s+/g)) result.add(match[1].toLowerCase());
  return result;
}
function leadingIndex(schema, table, column) {
  return schema.find(row => {
    if (row.type !== 'index' || row.tbl_name !== table || typeof row.sql !== 'string' || /\bWHERE\b/i.test(row.sql)) return false;
    const match = /\bON\s+[^()]+\(([^)]+)\)/i.exec(row.sql);
    return match?.[1]?.split(',')[0].trim().replace(/["`\[\]]/g, '').split(/\s+/)[0].toLowerCase() === column;
  })?.name || null;
}
function indexedColumn(schema, table, column) {
  if (leadingIndex(schema, table, column)) return true;
  const ddl = schema.find(row => row.type === 'table' && row.name === table)?.sql || '';
  return new RegExp('(?:\\(|,)\\s*["`\\[]?' + column + '["`\\]]?\\s+[^,)]*\\b(?:PRIMARY\\s+KEY|UNIQUE)\\b', 'i').test(ddl) ||
    new RegExp('(?:PRIMARY\\s+KEY|UNIQUE)\\s*\\(\\s*["`\\[]?' + column + '["`\\]]?(?:\\s|,|\\))', 'i').test(ddl);
}
const snapshotSql = (table, alias, version = REPLACEMENT_ANALYSIS_VERSION) => table === 'shift_logs'
  ? `json_array(${literal(version)},'shift_logs',${alias}.id,${alias}.work_date,${alias}.shift,${alias}.role,${alias}.author,${alias}.status,${alias}.log_json,${alias}.updated_at)`
  : `json_array(${literal(version)},'legacy_logs',${alias}.id,${alias}.legacy_diary_id,${alias}.work_date,${alias}.shift,${alias}.role,${alias}.author,${alias}.status,${alias}.entries_json,${alias}.original_json,${alias}.updated_at)`;
const receiptKeySql = (table, alias, version = REPLACEMENT_ANALYSIS_VERSION) => `${literal(version + ':' + table + ':')} || CAST(${alias}.id AS TEXT)`;
const diarySql = alias => `(CASE WHEN json_valid(${alias}.log_json) AND json_type(${alias}.log_json,'$.legacyDiaryId')='text' THEN json_extract(${alias}.log_json,'$.legacyDiaryId') WHEN ${alias}.id LIKE 'legacy-POCHEON#%' THEN substr(${alias}.id,8) WHEN ${alias}.id LIKE 'POCHEON#%' THEN ${alias}.id ELSE NULL END)`;
function unsuppressed(table, alias, present) {
  if (!present) return "NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_log_suppressions')";
  const diary = table === 'shift_logs' ? diarySql(alias) : `${alias}.legacy_diary_id`;
  return `NOT EXISTS (SELECT 1 FROM legacy_log_suppressions replacement_suppression WHERE replacement_suppression.legacy_diary_id=${diary} AND replacement_suppression.work_date=${alias}.work_date AND replacement_suppression.shift=${alias}.shift AND replacement_suppression.role=${alias}.role)`;
}
function sourceEligibility(table, alias, v4, suppression) {
  const eligibleRole = table === 'shift_logs' ? `(${operationalRole(alias)} OR ${authorAnnotation(alias)})` : operationalRole(alias);
  return v4 ? ` AND ${eligibleRole} AND ${unsuppressed(table, alias, suppression)}` : '';
}
function canonicalMirror(alias, legacyAlias, index, v4 = false, suppression = false) {
  return `EXISTS (SELECT 1 FROM shift_logs ${alias} INDEXED BY ${id(index)} WHERE ${alias}.work_date=${legacyAlias}.work_date AND ${approved(alias)}${sourceEligibility('shift_logs', alias, v4, suppression)} AND (${alias}.id='legacy-'||${legacyAlias}.legacy_diary_id OR ${alias}.id=${legacyAlias}.legacy_diary_id OR ${diarySql(alias)}=${legacyAlias}.legacy_diary_id))`;
}
function likelyWork(expression) {
  const lower = `lower(${expression})`;
  const belt = [`instr(${lower},'belt')>0`, `instr(${lower},'blet')>0`, `instr(${expression},'벨트')>0`].join(' OR ');
  const context = ['blower', 'fbhe', 'seal pot', 'sealpot', 'limestone', 'fly ash', 'flyash', 'hhl60', 'hhl10', 'sdf01an', 'lmdf01', 'etg30', 'eth03', 'hrj01']
    .map(word => `instr(${lower},${literal(word)})>0`)
    .concat(['블로워', '브로워', '송풍기', '유기성', '축분', '석회석'].map(word => `instr(${expression},${literal(word)})>0`)).join(' OR ');
  return `((${belt}) AND (${context}))`;
}
function aliases(values) { return [...new Set(values.filter(value => value !== null && value !== undefined && String(value).length).map(String))]; }
function parsedJson(raw, label) {
  if (typeof raw !== 'string' || raw.length > 1024 * 1024) fail(label + ' 원문 크기 또는 형식을 확인할 수 없습니다.');
  try { return JSON.parse(raw); } catch { fail(label + ' JSON 원문을 확인할 수 없습니다.'); }
}
// R5 receipts include the exact approved operational counterpart snapshots.
// A late approval, deletion or same-stamp edit invalidates both sides, even if
// their rows arrive on different pages. Existing date indexes bound all reads.
const priorityShiftSql = expression => `(CASE upper(trim(COALESCE(${expression},''))) WHEN 'DAY' THEN 'DS' WHEN '주간' THEN 'DS' WHEN 'NIGHT' THEN 'NS' WHEN '야간' THEN 'NS' ELSE upper(trim(COALESCE(${expression},''))) END)`;
function priorityContextSql(alias, version, config) {
  if (!config || typeof config.shiftIndex !== 'string' || !config.shiftIndex || !Number.isFinite(Date.parse(config.snapshotAt))) fail('보직 우선 원문 조회 근거가 없습니다.');
  const common = peer => `${peer}.work_date=${alias}.work_date AND ${priorityShiftSql(peer+'.shift')}=${priorityShiftSql(alias+'.shift')} AND ${approved(peer)}`;
  const canonical = `SELECT 'shift_logs' sourceTable,CAST(rps.id AS TEXT) sourceRowId,json_object('snapshot',${snapshotSql('shift_logs','rps',version)},'aliasLegacyId',${config.legacy ? `(SELECT rpa.id FROM legacy_logs rpa WHERE rpa.legacy_diary_id=${diarySql('rps')})` : 'NULL'},'aliasDiary',${config.legacy ? `(SELECT rpa.legacy_diary_id FROM legacy_logs rpa WHERE rpa.legacy_diary_id=${diarySql('rps')})` : 'NULL'}) snapshot FROM shift_logs rps INDEXED BY ${id(config.shiftIndex)} WHERE ${common('rps')}${sourceEligibility('shift_logs','rps',true,config.suppression)} AND (${likelyWork('rps.log_json')} OR ${authorAnnotation('rps')})`;
  const legacy = config.legacy ? ` UNION ALL SELECT 'legacy_logs' sourceTable,CAST(rph.id AS TEXT) sourceRowId,json_object('snapshot',${snapshotSql('legacy_logs','rph',version)}) snapshot FROM legacy_logs rph INDEXED BY ${id(config.legacyIndex)} WHERE ${common('rph')}${sourceEligibility('legacy_logs','rph',true,config.suppression)} AND ${likelyWork("COALESCE(rph.entries_json,'')||COALESCE(rph.original_json,'')")} AND NOT ${canonicalMirror('rpc','rph',config.shiftIndex,true,config.suppression)}` : '';
  return `(SELECT json_group_array(snapshot) FROM (${canonical}${legacy} ORDER BY sourceTable,sourceRowId LIMIT 65))`;
}
function sourceSnapshotSql(table, alias, version, priority) {
  const base = snapshotSql(table,alias,version);
  return priority ? `json_array((${base} || ''),(${priorityContextSql(alias,version,priority)} || ''))` : base;
}
function rawSnapshotRow(snapshot) {
  const values=parsedJson(snapshot,'보직 비교');
  if(!Array.isArray(values) || values[0]!==REPLACEMENT_ROLE_PRIORITY_ANALYSIS_VERSION) fail('보직 비교 원문 버전이 다릅니다.');
  if(values[1]==='shift_logs') {
    const [,sourceTable,id,work_date,shift,role,author,status,log_json,updated_at]=values;
    return {sourceTable,sourceRowId:id,id,work_date,shift,role,author,status,log_json,updated_at,aliasLegacyId:null,aliasDiary:null};
  }
  if(values[1]==='legacy_logs') {
    const [,sourceTable,id,legacy_diary_id,work_date,shift,role,author,status,entries_json,original_json,updated_at]=values;
    return {sourceTable,sourceRowId:id,id,legacy_diary_id,work_date,shift,role,author,status,entries_json,original_json,updated_at};
  }
  fail('보직 비교 원문 테이블이 다릅니다.');
}
export function replacementRoleContextRows(primaryRows) {
  const all=new Map();
  for(const primary of primaryRows || []) {
    if(primary._rolePriorityVersion!==1) { all.set(primary.receiptId,primary); continue; }
    const wrapper=parsedJson(primary.source_snapshot,'보직 의존성');
    if(!Array.isArray(wrapper) || wrapper.length!==2) fail('보직 의존성 원문 형식이 다릅니다.');
    const context=parsedJson(wrapper[1],'보직 비교 목록');
    if(!Array.isArray(context) || context.length>64) fail('같은 날짜·교대의 보직 비교 원문이 너무 많습니다.','BLOWER_ROLE_PRIORITY_CONTEXT_LIMIT');
    for(const snapshot of context) {
      const contextEntry=typeof snapshot === 'string' ? parsedJson(snapshot,'보직 비교 항목') : snapshot;
      if(!contextEntry || !Array.isArray(contextEntry.snapshot))fail('보직 비교 항목 형식이 다릅니다.');
      const baseSnapshot=JSON.stringify(contextEntry.snapshot);
      const raw=rawSnapshotRow(baseSnapshot);
      if(raw.sourceTable==='shift_logs')Object.assign(raw,{aliasLegacyId:contextEntry.aliasLegacyId??null,aliasDiary:contextEntry.aliasDiary??null});
      // Every peer shares the same date/shift context, so reconstructing
      // its wrapper preserves exactly the SQL dependency used by its guard.
      raw.source_snapshot=JSON.stringify([baseSnapshot,wrapper[1]]);
      const row=normalize(raw,primary._rolePriorityConfig.shiftIndex,REPLACEMENT_ROLE_PRIORITY_ANALYSIS_VERSION,primary._suppressionAvailable,primary._rolePriorityConfig);
      all.set(row.receiptId,row);
    }
    all.set(primary.receiptId,primary);
  }
  return [...all.values()];
}
export async function replacementSourceHashes(row) {
  const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  let raw=row.source_snapshot;
  if(row._rolePriorityVersion===1) raw=JSON.parse(raw)[0];
  const values=JSON.parse(raw);
  const history=[];
  for(const version of [REPLACEMENT_NORMALIZE_ANALYSIS_VERSION,REPLACEMENT_ANALYSIS_VERSION]) history.push(await digest(JSON.stringify([version,...values.slice(1)])));
  return {sourceSnapshotSha256:await digest(row.source_snapshot),sourceSnapshotHistorySha256:history};
}

function normalize(row, shiftIndex, version = REPLACEMENT_ANALYSIS_VERSION, suppression = false, priority = null) {
  const table = row.sourceTable, rawId = row.sourceRowId;
  const metadata = { sourceTable: table, sourceRowId: String(rawId),
    receiptId: version + ':' + table + ':' + rawId,
    source_snapshot: row.source_snapshot, _canonicalDateIndex: shiftIndex };
  if (version === REPLACEMENT_NORMALIZE_ANALYSIS_VERSION || version === REPLACEMENT_ROLE_PRIORITY_ANALYSIS_VERSION) Object.assign(metadata, {_analysisVersion:4, _suppressionAvailable:suppression});
  if (priority) Object.assign(metadata, {_rolePriorityVersion:1, _rolePriorityConfig:priority});
  if (table === 'shift_logs') {
    const parsed = parsedJson(row.log_json, '승인 업무일지');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('승인 업무일지 JSON 객체가 필요합니다.');
    const diary = row.aliasDiary || parsed.legacyDiaryId || (String(row.id).startsWith('legacy-POCHEON#') ? String(row.id).slice(7) : null);
    return { ...row, ...metadata, id: String(row.id), status: '결재완료', updated_at: String(row.updated_at || ''),
      sourceAliases: aliases([row.id, row.aliasLegacyId, diary, diary ? 'legacy-' + diary : null]),
      _aliasLegacyId: row.aliasLegacyId, _aliasDiary: row.aliasDiary };
  }
  const original = parsedJson(row.original_json || '{}', '승인 과거 업무일지');
  const originalBody = Array.isArray(original?.body) ? original.body : null;
  const savedEntries = originalBody || parsedJson(row.entries_json || '[]', '승인 과거 업무일지 항목');
  if (!Array.isArray(savedEntries)) fail('승인 과거 업무일지의 원문 항목이 배열이 아닙니다.');
  const sourceId = row.legacy_diary_id ? 'legacy-' + row.legacy_diary_id : 'legacy-record:' + rawId;
  const entries = savedEntries.filter(entry => entry && typeof entry === 'object' && typeof entry.content === 'string').map((entry, index) => ({
    ...entry, id: typeof entry.id === 'string' ? entry.id : `legacy-entry-${row.legacy_diary_id || rawId}-${entry.entry_id ?? entry.index ?? index}`,
    importedFromRole: entry.importedFromRole || row.role,
    importedFromLogId: entry.importedFromLogId || sourceId,
    legacyBodyIndex: entry.index ?? index,
    legacyEntryId: entry.entry_id ?? null,
    source: entry.source || 'legacy-approved-replacement-v3'
  }));
  const log = { id: sourceId, date: row.work_date, shift: row.shift, role: row.role, author: row.author,
    status: '결재완료', legacyDiaryId: row.legacy_diary_id, entries,
    legacyOriginalBody: originalBody, source: 'legacy-approved-replacement-v3' };
  return { ...row, ...metadata, id: sourceId, status: '결재완료', updated_at: String(row.updated_at || ''),
    log_json: JSON.stringify(log), sourceAliases: aliases([rawId, row.legacy_diary_id, sourceId]) };
}

export async function loadApprovedReplacementPage(database, body = {}, options = {}) {
  const baseVersion = analysisVersion(options.analysisVersion), v4 = baseVersion === REPLACEMENT_NORMALIZE_ANALYSIS_VERSION;
  const priorityEnabled = v4 && options.rolePriority === true;
  const version = priorityEnabled ? REPLACEMENT_ROLE_PRIORITY_ANALYSIS_VERSION : baseVersion;
  const { window, limit } = parseWindow(body, options.now || new Date());
  const schemaResult = await database.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master WHERE (type='table' AND name IN (${TABLES.map(literal).join(',')})) OR (type='index' AND tbl_name IN (${TABLES.map(literal).join(',')}))`).all();
  const schema = Array.isArray(schemaResult?.results) ? schemaResult.results : [];
  const tables = new Map(schema.filter(row => row.type === 'table').map(row => [row.name, columns(row.sql)]));
  const requireFields = (table, required) => required.every(column => tables.get(table)?.has(column));
  const shiftIndex = leadingIndex(schema, 'shift_logs', 'work_date');
  const legacy = tables.has('legacy_logs'), legacyIndex = leadingIndex(schema, 'legacy_logs', 'work_date');
  const suppression = tables.has('legacy_log_suppressions');
  if (!shiftIndex || !indexedColumn(schema, 'shift_logs', 'id') || !requireFields('shift_logs', ['id','work_date','shift','role','author','status','log_json','updated_at']) ||
      !indexedColumn(schema, 'blower_log_receipts_v1', 'log_id') || !requireFields('blower_log_receipts_v1', ['log_id','source_snapshot','replacement_done','operation_done','processed_at'])) {
    fail('교체 원문 또는 처리 확인용 기존 인덱스·스키마가 없습니다. 전체 테이블 스캔은 실행하지 않았습니다.', 'BLOWER_REPLACEMENT_SOURCE_INDEX_REQUIRED');
  }
  if (legacy && (!legacyIndex || !indexedColumn(schema, 'legacy_logs', 'id') || !indexedColumn(schema, 'legacy_logs', 'legacy_diary_id') ||
      !requireFields('legacy_logs', ['id','legacy_diary_id','work_date','shift','role','author','status','entries_json','original_json','updated_at']))) {
    fail('승인 과거 업무일지의 기존 날짜·원본 식별 인덱스를 확인할 수 없습니다.', 'BLOWER_REPLACEMENT_SOURCE_INDEX_REQUIRED');
  }
  if (v4 && suppression && (!indexedColumn(schema, 'legacy_log_suppressions', 'legacy_diary_id') || !requireFields('legacy_log_suppressions', ['legacy_diary_id','work_date','shift','role']))) {
    fail('삭제된 과거 업무일지 확인용 기존 인덱스·스키마가 없습니다. 전체 테이블 스캔은 실행하지 않았습니다.', 'BLOWER_REPLACEMENT_SOURCE_INDEX_REQUIRED');
  }
  const coverageIssues = legacy ? [] : ['legacy_logs is absent; historical legacy-only approvals were not scanned.'];
  if (v4 && !suppression) coverageIssues.push('legacy_log_suppressions is absent; deleted legacy diary suppression could not be verified.');
  const priority = priorityEnabled ? { shiftIndex, legacyIndex, legacy, suppression, snapshotAt:window.snapshotAt } : null;
  const shiftSnapshot = sourceSnapshotSql('shift_logs', 's', version, priority);
  const aliasSelect = legacy ? 'h.id AS aliasLegacyId,h.legacy_diary_id AS aliasDiary' : 'NULL AS aliasLegacyId,NULL AS aliasDiary';
  const aliasJoin = legacy ? `LEFT JOIN legacy_logs h ON h.legacy_diary_id=${diarySql('s')}` : '';
  const canonicalSql = `SELECT s.id,s.work_date,s.shift,s.role,s.author,s.status,s.log_json,s.updated_at,
    'shift_logs' AS sourceTable,s.id AS sourceRowId,${aliasSelect},${shiftSnapshot} AS source_snapshot
    FROM shift_logs s INDEXED BY ${id(shiftIndex)} ${aliasJoin}
    LEFT JOIN blower_log_receipts_v1 r ON r.log_id=${receiptKeySql('shift_logs', 's', version)}
    WHERE s.work_date>=? AND s.work_date<=? AND ${approved('s')}${sourceEligibility('shift_logs', 's', v4, suppression)}
      AND (julianday(s.updated_at) IS NULL OR julianday(s.updated_at)<=julianday(?))
      AND (${likelyWork('s.log_json')} OR ${authorAnnotation('s')})
      AND (r.log_id IS NULL OR r.replacement_done<>1 OR r.source_snapshot<>${shiftSnapshot})
    ORDER BY s.work_date,s.id LIMIT ?`;
  const canonical = await database.prepare(canonicalSql).bind(window.fromDate, window.endDate, window.snapshotAt, limit + 1).all();
  let legacyRows = [];
  if (legacy) {
    const legacySnapshot = sourceSnapshotSql('legacy_logs', 'h', version, priority);
    const sql = `SELECT h.id,h.legacy_diary_id,h.work_date,h.shift,h.role,h.author,h.status,h.entries_json,h.original_json,h.updated_at,
      'legacy_logs' AS sourceTable,h.id AS sourceRowId,${legacySnapshot} AS source_snapshot
      FROM legacy_logs h INDEXED BY ${id(legacyIndex)}
      LEFT JOIN blower_log_receipts_v1 r ON r.log_id=${receiptKeySql('legacy_logs', 'h', version)}
      WHERE h.work_date>=? AND h.work_date<=? AND ${approved('h')}${sourceEligibility('legacy_logs', 'h', v4, suppression)}
        AND (julianday(h.updated_at) IS NULL OR julianday(h.updated_at)<=julianday(?))
        AND ${likelyWork("COALESCE(h.entries_json,'')||COALESCE(h.original_json,'')")}
        AND NOT ${canonicalMirror('c', 'h', shiftIndex, v4, suppression)}
        AND (r.log_id IS NULL OR r.replacement_done<>1 OR r.source_snapshot<>${legacySnapshot})
      ORDER BY h.work_date,h.id LIMIT ?`;
    const result = await database.prepare(sql).bind(window.fromDate, window.endDate, window.snapshotAt, limit + 1).all();
    legacyRows = result.results || [];
  }
  const candidates = [...(canonical.results || []), ...legacyRows].sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)) ||
    String(a.sourceTable).localeCompare(String(b.sourceTable)) || String(a.sourceRowId).localeCompare(String(b.sourceRowId)));
  const logs = candidates.slice(0, limit).map(row => normalize(row, shiftIndex, version, suppression, priority));
  const done = candidates.length <= limit, last = logs.at(-1);
  const digest = last ? [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(last.source_snapshot)))].map(v => v.toString(16).padStart(2,'0')).join('') : '';
  return { logs, done, nextCursor: done ? null : { workDate: last.work_date, updatedAt: last.updated_at, id: digest }, window, limit, coverageIssues };
}

export function replacementSourceGuard(row) {
  const baseVersion = analysisVersion(row?._analysisVersion), v4 = baseVersion === REPLACEMENT_NORMALIZE_ANALYSIS_VERSION;
  const priority = row?._rolePriorityVersion === 1 ? row._rolePriorityConfig : null;
  const version = priority ? REPLACEMENT_ROLE_PRIORITY_ANALYSIS_VERSION : baseVersion;
  if (!row || !['shift_logs','legacy_logs'].includes(row.sourceTable) || typeof row.sourceRowId !== 'string' ||
      !row.sourceRowId || typeof row.source_snapshot !== 'string' ||
      row.receiptId !== version + ':' + row.sourceTable + ':' + row.sourceRowId || (v4 && typeof row._suppressionAvailable !== 'boolean')) fail('서버에서 읽은 교체 원문 근거가 필요합니다.');
  const table = row.sourceTable, alias = 'replacement_source';
  let sql = `EXISTS (SELECT 1 FROM ${table} ${alias} WHERE ${alias}.id=? AND ${approved(alias)}${sourceEligibility(table, alias, v4, row._suppressionAvailable)} AND ${sourceSnapshotSql(table, alias, version, priority)}=?)`;
  const values = [row.sourceRowId, row.source_snapshot];
  if (table === 'legacy_logs') {
    if (typeof row._canonicalDateIndex !== 'string' || !row._canonicalDateIndex) fail('원문 우선순위 인덱스 근거가 없습니다.');
    sql = `EXISTS (SELECT 1 FROM legacy_logs ${alias} WHERE ${alias}.id=? AND ${approved(alias)}${sourceEligibility(table, alias, v4, row._suppressionAvailable)} AND ${sourceSnapshotSql(table, alias, version, priority)}=? AND NOT ${canonicalMirror('replacement_canonical', alias, row._canonicalDateIndex, v4, row._suppressionAvailable)})`;
  } else if (row._aliasLegacyId !== null && row._aliasLegacyId !== undefined) {
    sql += ' AND EXISTS (SELECT 1 FROM legacy_logs replacement_alias WHERE replacement_alias.id=? AND replacement_alias.legacy_diary_id=?)';
    values.push(row._aliasLegacyId, row._aliasDiary);
  }
  return { sql, values };
}

export async function storeReplacementLogReceipts(database, rows, now = new Date()) {
  if (!Array.isArray(rows) || rows.length > REPLACEMENT_PAGE_MAX || !(now instanceof Date) || !Number.isFinite(now.getTime())) fail('교체 원문 처리 확인 정보를 확인할 수 없습니다.');
  if (!rows.length) return;
  const statements = rows.map(row => {
    const guard = replacementSourceGuard(row);
    return database.prepare(`INSERT INTO blower_log_receipts_v1(log_id,source_snapshot,replacement_done,operation_done,processed_at)
      SELECT ?,?,1,0,? WHERE ${guard.sql}
      ON CONFLICT(log_id) DO UPDATE SET source_snapshot=excluded.source_snapshot,replacement_done=1,processed_at=excluded.processed_at`)
      .bind(row.receiptId,row.source_snapshot,now.toISOString(),...guard.values);
  });
  const result = await database.batch(statements);
  if (!Array.isArray(result) || result.some(row => Number(row?.meta?.changes) !== 1)) fail('교체 원문이 처리 중 변경되었습니다. 새 원문은 다시 확인해야 합니다.', 'BLOWER_REPLACEMENT_SOURCE_CHANGED');
}
