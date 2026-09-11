'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {makeHarness}=require('./helpers/cofiring-ui-harness.cjs');
const original=JSON.parse(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-draft-reference.json'),'utf8'));
const clone=value=>structuredClone(value);

test('development title and a persistent notice describe the connected daily workflow',async()=>{
  const h=makeHarness({reference:clone(original)}),notice=h.find('development');
  assert.ok(notice);assert.notEqual(notice,h.find('status'));
  assert.match(h.container.innerHTML,/<h2>혼소율 \(개발중\)<\/h2>/);
  assert.match(h.container.innerHTML,/숨김 Excel/);
  assert.match(h.container.innerHTML,/날짜 선택만으로는 조회하지 않습니다/);
  assert.match(h.container.innerHTML,/발열량 · 보정계수 설정/);
  assert.match(h.container.innerHTML,/축분/);
  await h.find('original').click();assert.equal(h.find('development'),notice);
  assert.doesNotMatch(h.find('results').innerHTML,/29\.03%/);assert.equal(h.all('organic')[0].value,'');
  h.find('date').value='2026-09-08';await h.find('date').fire('change');await h.controller.calculate();
  assert.equal(h.find('development'),notice);assert.match(h.container.innerHTML,/DataPARC 조회/);
});

test('changing a date explicitly explains that it does not start a live query',async()=>{
  const h=makeHarness();h.find('date').value='2026-09-08';await h.find('date').fire('input');
  assert.match(h.find('status').textContent,/날짜 선택만으로 DataPARC를 실행하지 않습니다/);
  assert.match(h.find('status').textContent,/선택일 기준 저장값/);assert.equal(h.calls,0);
  assert.match(h.find('query-range').textContent,/2026-09-08 00:00 ~ 2026-09-09 00:01/);
});

test('displayed query range is a read-only daily range and calculation stays one day',()=>{
  const h=makeHarness();assert.match(h.container.innerHTML,/DataPARC 시험 조회 범위/);
  assert.match(h.find('period').textContent,/24시간/);assert.match(h.find('period').textContent,/1,441/);
});

test('host navigation exposes the development label and loads V5 period worksheet assets',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const button=html.match(/<button[^>]+id="efficiencyCofiringDraftTab"[\s\S]*?<\/button>/)?.[0]||'';
  assert.match(button,/>혼소율 \(개발중\)<\/span>/);
  assert.match(button,/aria-label="혼소율 \(개발중\)"/);
  assert.match(button,/data-efficiency-tab="cofiring-draft"/);
  assert.match(html,/cofiring-core\.js\?v=20260911-period-excel-v5/);
  assert.match(html,/cofiring-period-manual-storage\.js\?v=20260911-period-excel-v5/);
  assert.match(html,/cofiring-settings-storage\.js\?v=20260911-period-excel-v5/);
  assert.match(html,/cofiring-live-contract\.js\?v=20260911-period-excel-v5/);
  assert.match(html,/cofiring-live\.js\?v=20260911-period-excel-v5/);
  assert.match(html,/cofiring-period-ui-v5\.js\?v=20260911-period-compact-v52/);
  assert.doesNotMatch(html,/cofiring-draft\.js\?v=20260911-calc-layout-v4/);
});
