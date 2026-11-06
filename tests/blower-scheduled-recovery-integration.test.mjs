import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet, __oisDataRequestsTest as ois } from '../functions/api/ois-data-requests.js';
import { fixture, callApi, agent, BROWSER_TOKEN, BROWSER_EMPLOYEE_NO } from './helpers/blower-incremental-fixture.mjs';

const END = '2026-11-07T00:01:00+09:00';
const ROLE = 'role-priority-recovery-v1:', COVERAGE = 'coverage-recovery-v1:';
const CASES = [
  { mode:'role_priority', tag:'103HRJ01AN601', signal:'GSPOGE.ABB_DCS.103HRJ01AN601XB04',
    prefix:ROLE, start:'2026-09-18T14:24:00+09:00', owner:'2026-09-18T14:20:00+09:00', signalOnly:true },
  { mode:'confirmed_gap', tag:'104ETG30AN602', signal:'GSPOGE.ABB_DCS.103ETG30AN602XJ04',
    prefix:COVERAGE, start:'2026-09-25T14:40:00+09:00', started:'2026-10-18T08:04:00+09:00' },
  ...['204HHL10AN611','204HHL10AN631'].map(tag => ({ mode:'seal_first_run', tag,
    signal:`GSPOGE.ABB_DCS.${tag}XB04`, prefix:COVERAGE, start:'2026-05-11T00:00:00+09:00' }))
];

async function setup(t) {
  const f = await fixture('103HRJ01AN601',true);
  t.after(() => f.database.close());
  await ois.ensureBlowerRuntimeProbeSchema(f.database);
  let sequence = 0;
  f.save = (spec, patch = {}) => {
    const index = ++sequence, id = `stored-recovery-${index}`;
    const now = new Date(Math.floor(Date.now()/1000)*1000).toISOString();
    const row = {
      request_id:id, reuse_key:spec.prefix + (spec.prefix === COVERAGE ? spec.mode + ':' : '') +
        (spec.signalOnly ? 'signal-only-v1:' : '') + index.toString(16).padStart(64,'0'),
      schema_version:1, asset_tag:spec.tag, dataparc_tag:spec.signal, window_start:spec.start, window_end:END,
      chunk_days:31, chunk_count:Math.ceil((Date.parse(END)-Date.parse(spec.start))/(31*86400000)),
      expected_last_replacement_at:spec.owner || spec.start,
      expected_cycle_start_state:spec.started ? 'started' : 'legacy', expected_cycle_started_at:spec.started || '',
      expected_cycle_start_revision:(spec.signalOnly ? 'signal-only-v1:' : '') + 'accepted-owner-start',
      expected_cycle_runtime_revision:spec.prefix + 'accepted-owner-runtime', created_at:now, updated_at:now,
      ...patch
    };
    const keys = Object.keys(row);
    f.sqlite.prepare(`INSERT INTO blower_runtime_probe_intents_v5 (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...keys.map(key => row[key]));
    f.sqlite.prepare(`INSERT INTO ois_data_requests
      (id,request_type,target_date,status,requested_by_id,requested_by_name,requested_at,completed_at,result_json,expires_at,updated_at)
      VALUES (?,'blower_runtime_probe',?,'complete',?,'검증 사용자',?,?,?, ?,?)`)
      .run(id,`v1|${row.asset_tag}|${row.window_start}|${row.window_end}`,BROWSER_EMPLOYEE_NO,now,now,
        JSON.stringify({ runtimeRecovery:{version:1,mode:'client-supplied',requestId:'foreign'},collectedAt:now }),
        new Date(Date.now()+3600000).toISOString(),now);
    return row;
  };
  f.detail = (id,token=BROWSER_TOKEN) => callApi(onRequestGet,f.database,
    new Request(`https://example.test/api/ois-data-requests?id=${encodeURIComponent(id)}`,
      {headers:token ? {Authorization:`Bearer ${token}`} : {}}));
  return f;
}

test('authenticated request details reconstruct all four R2 repair routes from saved intent and retain the existing Agent contract',async t => {
  const f = await setup(t);
  const before = f.sqlite.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all();
  for (const spec of CASES) {
    const row = f.save(spec), response = await f.detail(row.request_id);
    assert.equal(response.status,200,JSON.stringify(response.body));
    const item = response.body.item;
    assert.deepEqual(item.probe.runtimeRecovery,{version:1,mode:spec.mode,requestId:row.request_id,
      assetTag:row.asset_tag,dataParcTag:row.dataparc_tag,startAt:row.window_start,endAt:row.window_end});
    assert.equal(item.probe.expectedCycleRuntimeRevision,row.expected_cycle_runtime_revision);
    assert.equal(item.probe.expectedCycleStartRevision,row.expected_cycle_start_revision);
    assert.equal(item.probe.expectedCycleStartState,row.expected_cycle_start_state);
    assert.equal(item.result.runtimeRecovery.mode,'client-supplied','result data does not supply the routing descriptor');
    const parsed = agent.parseClaim(item);
    assert.equal(parsed.expectedCycleRuntimeRevision,row.expected_cycle_runtime_revision);
    assert.equal(parsed.expectedCycleStartRevision,row.expected_cycle_start_revision);
    assert.equal(parsed.assetTag,spec.tag);
    assert.equal(parsed.dataParcTag,spec.signal);
  }
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM blower_history_assets ORDER BY tag_number').all(),before);
});

test('old ordinary requests keep their route while incomplete or unknown repair intents cannot become an ordinary sync',async t => {
  const f = await setup(t), spec = CASES[0];
  const ordinary = f.save(spec,{reuse_key:'append-v1:' + 'a'.repeat(64),
    expected_cycle_start_revision:'',expected_cycle_runtime_revision:'append-v1:accepted-owner-runtime'});
  const oldDetail = await f.detail(ordinary.request_id);
  assert.equal(oldDetail.status,200);
  assert.equal(Object.hasOwn(oldDetail.body.item.probe,'runtimeRecovery'),false);
  for (const patch of [
    {reuse_key:'b'.repeat(64)},
    {expected_cycle_runtime_revision:'accepted-owner-runtime'},
    {reuse_key:'role-priority-recovery-v99:'+'c'.repeat(64),expected_cycle_runtime_revision:'role-priority-recovery-v99:owner'},
    {dataparc_tag:'GSPOGE.ABB_DCS.203HRJ01AN601XB04'},
    {expected_cycle_start_revision:'accepted-owner-start'}
  ]) {
    const row = f.save(spec,patch), response = await f.detail(row.request_id);
    assert.equal(response.status,200,JSON.stringify(response.body));
    if (patch.dataparc_tag) {
      assert.equal(response.body.item.probe,null,'the API rejects an equipment/signal mismatch before mode routing');
      assert.throws(() => agent.parseClaim(response.body.item));
    } else {
      assert.equal(response.body.item.probe.runtimeRecovery.mode,'invalid');
      assert.equal(response.body.item.probe.runtimeRecovery.requestId,row.request_id);
    }
  }
});

test('saved repair metadata remains behind authenticated request details',async t => {
  const f = await setup(t), row = f.save(CASES[0]);
  for (const token of [null,'expired-or-invalid-token']) {
    const response = await f.detail(row.request_id,token);
    assert.equal(response.status,401);
    assert.equal(response.body.ok,false);
    assert.equal(response.body.item,undefined);
  }
  assert.equal((await f.detail(row.request_id)).status,200);
});
