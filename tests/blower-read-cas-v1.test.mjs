import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture, browserCreate } from './helpers/blower-incremental-fixture.mjs';

// Frozen SELECT form of the pre-optimization CAS at 1a6a00a. Compare the
// production SQL below against this independent historical reference.
const OLD_CAS_SELECT = String.raw`/* BLOWER_RUNTIME_BATCH_RETIRE_GROUP_CAS_V1 */
        WITH plans AS (
          SELECT json_extract(value,'$.assetTag') asset_tag,
                 json_extract(value,'$.reuseKey') reuse_key,
                 json_extract(value,'$.staleRequestId') stale_request_id,
                 CAST(json_extract(value,'$.createNew') AS INTEGER) create_new
          FROM json_each(?)
        ), initial_retire_ids AS (
          SELECT intent.request_id
          FROM blower_runtime_probe_intents_v5 AS intent
          JOIN ois_data_requests AS request ON request.id=intent.request_id
          JOIN plans ON plans.asset_tag=intent.asset_tag
          WHERE request.request_type=? AND request.requested_by_id=?
            AND (request.status IN ('pending','processing')
              OR (request.status='complete' AND plans.create_new=1))
            AND (COALESCE(intent.reuse_key,'')<>plans.reuse_key
              OR intent.request_id=plans.stale_request_id)
        ), retire_groups AS (
          SELECT DISTINCT
            substr(request.id,1,45) group_id,
            request.requested_by_id requested_by_id
          FROM ois_data_requests AS request
          WHERE request.id IN (SELECT request_id FROM initial_retire_ids)
            AND length(request.id)=47
                AND (
    length(request.id) = 47
    AND substr(request.id, 1, 5) = 'brb1_'
    AND substr(request.id, 14, 1) = '-'
    AND substr(request.id, 19, 1) = '-'
    AND substr(request.id, 24, 1) = '-'
    AND substr(request.id, 29, 1) = '-'
    AND substr(request.id, 42, 1) = '_'
    AND substr(request.id, 45, 1) = '_'
    AND substr(request.id, 6, 8) NOT GLOB '*[^0-9A-Fa-f]*'
    AND substr(request.id, 15, 4) NOT GLOB '*[^0-9A-Fa-f]*'
    AND substr(request.id, 20, 4) NOT GLOB '*[^0-9A-Fa-f]*'
    AND substr(request.id, 25, 4) NOT GLOB '*[^0-9A-Fa-f]*'
    AND substr(request.id, 30, 12) NOT GLOB '*[^0-9A-Fa-f]*'
    AND substr(request.id, 43, 2) GLOB '[0-9][0-9]'
    AND substr(request.id, 46, 2) GLOB '[0-9][0-9]'
    AND CAST(substr(request.id, 43, 2) AS INTEGER) BETWEEN 1 AND 27
    AND CAST(substr(request.id, 46, 2) AS INTEGER) < CAST(substr(request.id, 43, 2) AS INTEGER)
  )
        ), processing_conflicts AS (
          SELECT 'request:' || request.id conflict_id
          FROM ois_data_requests AS request
          WHERE request.id IN (SELECT request_id FROM initial_retire_ids)
            AND request.status='processing'
          UNION
          SELECT 'group:' || retire_group.group_id conflict_id
          FROM retire_groups AS retire_group
          WHERE EXISTS (SELECT 1 FROM ois_data_requests AS active_group
              WHERE active_group.request_type=?
                AND active_group.requested_by_id=retire_group.requested_by_id
                AND length(active_group.id)=47
                  AND (
    length(active_group.id) = 47
    AND substr(active_group.id, 1, 5) = 'brb1_'
    AND substr(active_group.id, 14, 1) = '-'
    AND substr(active_group.id, 19, 1) = '-'
    AND substr(active_group.id, 24, 1) = '-'
    AND substr(active_group.id, 29, 1) = '-'
    AND substr(active_group.id, 42, 1) = '_'
    AND substr(active_group.id, 45, 1) = '_'
    AND substr(active_group.id, 6, 8) NOT GLOB '*[^0-9A-Fa-f]*'
    AND substr(active_group.id, 15, 4) NOT GLOB '*[^0-9A-Fa-f]*'
    AND substr(active_group.id, 20, 4) NOT GLOB '*[^0-9A-Fa-f]*'
    AND substr(active_group.id, 25, 4) NOT GLOB '*[^0-9A-Fa-f]*'
    AND substr(active_group.id, 30, 12) NOT GLOB '*[^0-9A-Fa-f]*'
    AND substr(active_group.id, 43, 2) GLOB '[0-9][0-9]'
    AND substr(active_group.id, 46, 2) GLOB '[0-9][0-9]'
    AND CAST(substr(active_group.id, 43, 2) AS INTEGER) BETWEEN 1 AND 27
    AND CAST(substr(active_group.id, 46, 2) AS INTEGER) < CAST(substr(active_group.id, 43, 2) AS INTEGER)
  )
                AND substr(active_group.id,1,45)=
                  retire_group.group_id
                AND active_group.status='processing')
        )
 SELECT conflict_id FROM processing_conflicts`;

async function captureProductionCas() {
  const f = await fixture('104ETH03AN601', true);
  try {
    const prepare = f.database.prepare.bind(f.database);
    let captured;
    f.database.prepare = sql => {
      const statement = prepare(sql);
      if (sql.startsWith('/* BLOWER_RUNTIME_BATCH_RETIRE_GROUP_CAS_V1 */')) captured = statement;
      return statement;
    };
    const asset = f.sqlite.prepare('SELECT * FROM blower_history_assets WHERE tag_number=?').get('104ETH03AN601');
    const created = await browserCreate(f.database, {
      action: 'create_blower_runtime_probe_batch',
      requests: [{
        action: 'create_blower_runtime_probe', unifiedRefresh: true,
        incrementalRefresh: true, requireIncrementalAppend: false,
        assetTag: asset.tag_number,
        dataParcTag: 'GSPOGE.ABB_DCS.TEST_ONLY_BINARY_104ETH03AN601',
        confirmRunSignal: true,
        startAt: asset.cycle_started_at || asset.last_replacement_at,
        expectedLastReplacementAt: asset.last_replacement_at,
        expectedCycleStartState: asset.cycle_start_state || 'legacy',
        expectedCycleStartedAt: asset.cycle_started_at || '',
        expectedCycleStartRevision: asset.cycle_start_revision || '',
        expectedCycleRuntimeRevision: asset.cycle_runtime_revision || ''
      }]
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.ok(captured, 'capture the SQL built and executed by the real browser batch API');
    return {sql: captured.sql, bindings: [...captured.bindings]};
  } finally {
    f.database.close();
  }
}

const cas = await captureProductionCas();
const insertStart = cas.sql.indexOf('INSERT INTO blower_runtime_probe_intents_v5');
assert.ok(insertStart > 0);
const NEW_CAS_SELECT = cas.sql.slice(0, insertStart) + 'SELECT conflict_id FROM processing_conflicts';
const requestType = 'blower_runtime_probe';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE ois_data_requests (
    id TEXT PRIMARY KEY NOT NULL, request_type TEXT NOT NULL,
    requested_by_id TEXT NOT NULL, status TEXT NOT NULL,
    requested_at TEXT, expires_at TEXT);
    CREATE INDEX idx_ois_data_requests_status_requested_v1
      ON ois_data_requests(status,requested_at,request_type,id);
    CREATE INDEX idx_ois_data_requests_status_expires_v1
      ON ois_data_requests(status,expires_at,id);
    CREATE INDEX idx_ois_data_requests_type_status_requested_v1
      ON ois_data_requests(request_type,status,requested_at,id);
    CREATE TABLE blower_runtime_probe_intents_v5 (
      request_id TEXT PRIMARY KEY NOT NULL,reuse_key TEXT UNIQUE,
      schema_version INTEGER,asset_tag TEXT NOT NULL,dataparc_tag TEXT,
      window_start TEXT,window_end TEXT,chunk_days INTEGER,chunk_count INTEGER,
      expected_last_replacement_at TEXT,expected_cycle_start_state TEXT,
      expected_cycle_started_at TEXT,expected_cycle_start_revision TEXT,
      expected_cycle_runtime_revision TEXT,created_at TEXT,updated_at TEXT);
    CREATE INDEX idx_blower_runtime_probe_intents_v5_asset_revision
      ON blower_runtime_probe_intents_v5(asset_tag,expected_cycle_start_revision,
        expected_cycle_runtime_revision,created_at DESC);`);
  return db;
}

const id = (group, total, index) =>
  `brb1_00000000-0000-0000-0000-${group.toString(16).padStart(12, '0')}_${String(total).padStart(2, '0')}_${String(index).padStart(2, '0')}`;
const plan = (overrides = {}) => ({assetTag:'A',reuseKey:'new',staleRequestId:'',createNew:1,...overrides});
function put(db, {
  id: requestId, status = 'complete', owner = 'owner', type = requestType,
  asset = 'A', reuse = null, intent = true
}) {
  db.prepare('INSERT INTO ois_data_requests VALUES(?,?,?,?,?,?)')
    .run(requestId,type,owner,status,'2026-01-01','2026-01-01');
  if (intent) db.prepare('INSERT INTO blower_runtime_probe_intents_v5(request_id,reuse_key,asset_tag) VALUES(?,?,?)')
    .run(requestId,reuse,asset);
}
function conflicts(db, sql, plans, owner = 'owner') {
  return db.prepare(sql).all(JSON.stringify(plans),requestType,owner,requestType)
    .map(row => row.conflict_id).sort();
}

const scenarios = [
  ['changed legacy processing request', [{id:'legacy',status:'processing'}], [plan()], ['request:legacy']],
  ['matching legacy key remains reusable', [{id:'legacy',status:'processing',reuse:'new'}], [plan()], []],
  ['stale legacy ID overrides matching key', [{id:'legacy',status:'processing',reuse:'new'}],
    [plan({staleRequestId:'legacy'})], ['request:legacy']],
  ['NULL reuse equals an empty requested key', [{id:'legacy',status:'processing'}], [plan({reuseKey:''})], []],
  ['complete seed protects an unselected processing sibling without an intent',
    [{id:id(1,2,0)}, {id:id(1,2,1),status:'processing',asset:'B',intent:false}],
    [plan()], ['group:'+id(1,2,0).slice(0,45)]],
  ['a NUL-suffixed complete seed retains the old TEXT canonical semantics',
    [{id:id(1,2,0)+'\0seed-tail'}, {id:id(1,2,1),status:'processing',asset:'B'}],
    [plan()], ['group:'+id(1,2,0).slice(0,45)]],
  ['a NUL-suffixed processing sibling still protects its normal complete seed',
    [{id:id(1,2,0)}, {id:id(1,2,1)+'\0processing-tail',status:'processing',asset:'B'}],
    [plan()], ['group:'+id(1,2,0).slice(0,45)]],
  ['NUL-suffixed seed and processing sibling remain in the same durable group',
    [{id:id(1,27,26)+'\0\u0001seed-tail'},
     {id:id(1,27,0)+'\0processing-tail',status:'processing',asset:'B',intent:false}],
    [plan()], ['group:'+id(1,27,0).slice(0,45)]],
  ['multiple NUL-suffixed seeds in one slot are all considered',
    [{id:id(1,2,0),reuse:'new'}, {id:id(1,2,0)+'\0a',reuse:'also-new'},
     {id:id(1,2,0)+'\0b',reuse:null}, {id:id(1,2,1),status:'processing',asset:'B'}],
    [plan()], ['group:'+id(1,2,0).slice(0,45)]],
  ['a control-one suffix remains noncanonical and cannot seed a group',
    [{id:id(1,2,0)+'\u0001tail'}, {id:id(1,2,1),status:'processing',asset:'B'}], [plan()], []],
  ['NUL before the 47th character remains noncanonical',
    [{id:id(1,2,0).slice(0,46)+'\0tail'}, {id:id(1,2,1),status:'processing',asset:'B'}], [plan()], []],
  ['complete seed remains excluded when createNew is false',
    [{id:id(1,2,0)}, {id:id(1,2,1),status:'processing',asset:'B'}],
    [plan({createNew:0})], []],
  ['pending seed also protects its processing sibling',
    [{id:id(1,2,0),status:'pending'}, {id:id(1,2,1),status:'processing',asset:'B'}],
    [plan({createNew:0})], ['group:'+id(1,2,0).slice(0,45)]],
  ['another owner does not create a group conflict',
    [{id:id(1,2,0)}, {id:id(1,2,1),status:'processing',asset:'B',owner:'other'}], [plan()], []],
  ['another request type does not create a group conflict',
    [{id:id(1,2,0)}, {id:id(1,2,1),status:'processing',asset:'B',type:'other'}], [plan()], []],
  ['a seed belonging to another owner remains excluded',
    [{id:id(1,2,0),owner:'other'}, {id:id(1,2,1),status:'processing',asset:'B'}], [plan()], []],
  ['a seed belonging to another request type remains excluded',
    [{id:id(1,2,0),type:'other'}, {id:id(1,2,1),status:'processing',asset:'B'}], [plan()], []],
  ['the total-count portion remains part of the exact group identity',
    [{id:id(1,2,0)}, {id:id(1,3,1),status:'processing',asset:'B'}], [plan()], []],
  ['noncanonical processing suffix cannot form a group',
    [{id:id(1,2,0)}, {id:id(1,2,26),status:'processing',asset:'B'}], [plan()], []],
  ['noncanonical complete suffix cannot seed a group',
    [{id:id(1,2,26)}, {id:id(1,2,0),status:'processing',asset:'B'}], [plan()], []],
  ['a zero-count group remains noncanonical',
    [{id:id(1,0,0)}, {id:id(1,0,1),status:'processing',asset:'B'}], [plan()], []],
  ['a group above the 27-member limit remains noncanonical',
    [{id:id(1,28,0)}, {id:id(1,28,1),status:'processing',asset:'B'}], [plan()], []],
  ['the final member of a 27-member group remains protected',
    [{id:id(1,27,26)}, {id:id(1,27,0),status:'processing',asset:'B'}],
    [plan()], ['group:'+id(1,27,0).slice(0,45)]],
  ['a one-member group keeps both direct and group guards',
    [{id:id(1,1,0),status:'processing'}], [plan()],
    ['group:'+id(1,1,0).slice(0,45),'request:'+id(1,1,0)]],
  ['uppercase canonical UUIDs retain their exact group identity',
    [{id:id(10,2,0).toUpperCase().replace('BRB1_','brb1_')},
     {id:id(10,2,1).toUpperCase().replace('BRB1_','brb1_'),status:'processing',asset:'B'}],
    [plan()], ['group:'+id(10,2,0).toUpperCase().replace('BRB1_','brb1_').slice(0,45)]]
];
for (const [title, rows, plans, expected] of scenarios) {
  test('read CAS: '+title, () => {
    const db = database();
    try {
      rows.forEach(row => put(db,row));
      assert.deepEqual(conflicts(db,OLD_CAS_SELECT,plans),expected);
      assert.deepEqual(conflicts(db,NEW_CAS_SELECT,plans),expected);
    } finally { db.close(); }
  });
}

test('read CAS: production SQL matches the old CAS for randomized histories and plans', () => {
  const db = database();
  try {
    let state = 1003;
    const random = max => {
      state = (Math.imul(state,1664525)+1013904223)>>>0;
      return Math.floor(state / 0x100000000 * max);
    };
    const ids = [];
    for (let group=1;group<=60;group++) {
      const total = 1+random(27);
      for (let index=0;index<total;index++) ids.push(id(group,total,index));
    }
    ids.push('legacy-processing','brb1_bad_02_00',id(100,2,99));
    for (let index=0;index<ids.length;index++) {
      if (index%13===0) ids[index]+='\0tail-'+index;
      else if (index%17===0) ids[index]+='\u0001tail-'+index;
    }
    ids.forEach((requestId,index) => put(db,{
      id:requestId,status:['pending','processing','complete','failed'][random(4)],
      owner:['owner','other'][random(2)],type:random(10)?requestType:'other',
      asset:['A','B','C'][random(3)],reuse:index%3?'key-'+index:null,intent:index%19!==0
    }));
    for (let iteration=0;iteration<200;iteration++) {
      const first = random(3), count = 1+random(3);
      const plans = Array.from({length:count},(_,index) => plan({
        assetTag:['A','B','C'][(first+index)%3],reuseKey:['new','','key-'+random(ids.length)][random(3)],
        staleRequestId:ids[random(ids.length)],createNew:random(2)
      }));
      const owner = ['owner','other'][random(2)];
      assert.deepEqual(conflicts(db,NEW_CAS_SELECT,plans,owner),
        conflicts(db,OLD_CAS_SELECT,plans,owner),'plan iteration '+iteration);
    }
  } finally { db.close(); }
});

test('read CAS: existing indexes seek processing rows and every sibling uses its primary-key range', () => {
  const db = database();
  try {
    for (let group=1;group<=1000;group++) {
      put(db,{id:id(group,2,0)});
      put(db,{id:id(group,2,1),asset:'B'});
    }
    put(db,{id:id(1001,2,0),status:'processing',asset:'B'});
    put(db,{id:id(1001,2,1)});
    db.exec('ANALYZE');
    const details = db.prepare('EXPLAIN QUERY PLAN '+NEW_CAS_SELECT)
      .all(JSON.stringify([plan()]),requestType,'owner',requestType).map(row => row.detail);
    assert.ok(details.some(detail => /SEARCH request USING (?:COVERING )?INDEX idx_ois_data_requests_(?:type_status_requested|status_requested|status_expires)_v1\b/.test(detail)
      && detail.includes('status=?')),details.join('\n'));
    assert.ok(details.some(detail => /SEARCH seed USING INDEX sqlite_autoindex_ois_data_requests_1 \(id>\? AND id<\?\)/.test(detail)),details.join('\n'));
    assert.ok(!details.some(detail => /^SCAN (request|seed|intent)\b/.test(detail)),details.join('\n'));
    assert.deepEqual(conflicts(db,NEW_CAS_SELECT,[plan()]),conflicts(db,OLD_CAS_SELECT,[plan()]));
  } finally { db.close(); }
});

test('read CAS: the real guard INSERT aborts and rolls back its surrounding transaction', () => {
  const db = database();
  try {
    put(db,{id:id(1,27,26),reuse:'preserved-key'});
    put(db,{id:id(1,27,0),status:'processing',asset:'B',intent:false});
    db.exec('CREATE TABLE marker(value TEXT); INSERT INTO marker VALUES(\'before\'); BEGIN IMMEDIATE; UPDATE marker SET value=\'after\';');
    assert.throws(() => db.prepare(cas.sql).run(
      JSON.stringify([plan()]),requestType,'owner',requestType,...cas.bindings.slice(4)
    ), /NOT NULL constraint failed: blower_runtime_probe_intents_v5\.asset_tag/);
    db.exec('ROLLBACK');
    assert.equal(db.prepare('SELECT value FROM marker').get().value,'before');
    assert.equal(db.prepare('SELECT reuse_key FROM blower_runtime_probe_intents_v5 WHERE request_id=?').get(id(1,27,26)).reuse_key,'preserved-key');
    assert.deepEqual(db.prepare('SELECT status FROM ois_data_requests ORDER BY id').all().map(row => row.status),['processing','complete']);
  } finally { db.close(); }
});
