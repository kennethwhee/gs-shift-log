import test from 'node:test';
import assert from 'node:assert/strict';
import { boundaryTotalAgreement } from '../functions/_shared/blower-boundary-recovery-v1.js';

const previous = 4_149_360, delta = 3_000, expected = previous + delta;
const check = (full, gap=0, elapsed=10_000_000) => boundaryTotalAgreement(previous,delta,full,gap,elapsed);

test('R5 preserves the existing two-second lower and measured upper limits',()=>{
  assert.equal(check(expected).valid,true);
  assert.equal(check(expected-2).valid,true);
  assert.equal(check(expected+2).valid,true);
  assert.equal(check(expected-3).valid,false);
  assert.equal(check(expected+3).valid,false);
  assert.equal(check(expected+10,8).valid,true);
  assert.equal(check(expected+11,8).valid,false);
});

test('R5 rejects impossible drift and historical total rather than auto-rebasing',()=>{
  assert.equal(check(expected,901).valid,false);
  assert.equal(check(expected,-1).valid,false);
  assert.equal(check(expected,NaN).valid,false);
  assert.equal(check(expected,0,100).valid,false);
  assert.equal(check(previous-3,0).valid,false);
  assert.equal(boundaryTotalAgreement(Number.MAX_SAFE_INTEGER,4,9,0,999).valid,false);
});

test('R5 error shows measured previous/delta/full discrepancy, not credentials or raw rows',()=>{
  const a=check(expected-8);
  assert.equal(a.reason,'new_full_below_expected');
  assert.equal(a.differenceSeconds,-8);
  assert.match(a.message,/전체 1153\.431h/);
  assert.match(a.message,/저장 1152\.600h/);
  assert.match(a.message,/새 구간 0\.833h/);
  assert.match(a.message,/차이 -8초/);
  assert.match(a.message,/기존 값 유지/);
  assert.doesNotMatch(a.message,/204SDF01AN002|request|token|employee/i);
});

test('R5 labels positive drift over upper bound without changing recovery acceptance',()=>{
  const r=check(expected+62,59);
  assert.equal(r.valid,false);
  assert.equal(r.reason,'new_full_above_expected');
  assert.match(r.message,/허용 -2~\+61초/);
});
