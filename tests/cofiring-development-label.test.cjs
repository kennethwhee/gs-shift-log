'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=require('../maintenance/cofiring-core.js');
const api=require('../maintenance/cofiring-draft.js');
const source=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-draft.js'),'utf8');
const original=JSON.parse(fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-draft-reference.json'),'utf8'));
const clone=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const {makeHarness:harness}=require('./helpers/cofiring-ui-harness.cjs');
function pilot(){const reference=clone(original);reference.source.kind='dataparc_hidden_excel';return {kind:'cofiring_dataparc_pilot',status:'PASS',cleanupVerified:true,databaseWritten:false,productionReady:false,reference};}


test('development title and a persistent notice are separate from transient results',async()=>{
 const h=harness({reference:clone(original)});const notice=h.find('development');
 assert.ok(notice);assert.notEqual(notice,h.find('status'));
 assert.match(h.container.innerHTML,/<h2>혼소율 \(개발중\)<\/h2>/);
 assert.match(h.container.innerHTML,/웹 자동조회는 아직 연결되지 않았습니다/);
 assert.match(h.container.innerHTML,/운영 확정값으로 사용하지 마세요/);
 await h.find('original').click();assert.equal(h.find('development'),notice);
 assert.doesNotMatch(h.find('results').innerHTML,/29\.03%/);assert.equal(h.all('organic')[0].value,'');
 h.find('date').value='2026-09-08';await h.find('date').fire('change');await h.controller.calculate();
 assert.equal(h.find('development'),notice);assert.doesNotMatch(h.find('results').innerHTML,/598\.630/);
});
test('changing a date explicitly explains that it does not start a live query',async()=>{
 const h=harness();h.find('date').value='2026-09-08';await h.find('date').fire('input');
 assert.match(h.find('status').textContent,/날짜 변경만으로 자동조회하지 않습니다/);
 assert.match(h.find('status').textContent,/선택일의 시험 결과/);assert.equal(h.calls,0);
 assert.match(h.find('query-range').textContent,/2026-09-08 00:00 ~ 2026-09-09 00:01/);
});
test('displayed query range is labelled a test, not an already-connected automatic query',()=>{
 const h=harness();assert.match(h.container.innerHTML,/>DataPARC 시험 조회 범위</);
 assert.doesNotMatch(h.container.innerHTML,/>DataPARC 자동 조회 범위</);
 assert.match(h.container.innerHTML,/첨부자료로 계산/);assert.match(h.container.innerHTML,/시험 결과 열기/);
});
test('host navigation exposes the development label and keeps the same view target',{
 skip:!fs.existsSync(path.join(__dirname,'../index.html'))?'Full host repository is not included in the supplied package':false
},()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const buttons=[...html.matchAll(/<button\b[^>]*\bid="efficiencyCofiringDraftTab"[^>]*>[\s\S]*?<\/button>/g)];
 assert.equal(buttons.length,1);const button=buttons[0][0];
 assert.match(button,/>혼소율 \(개발중\)<\/span>/);
 assert.match(button,/aria-label="혼소율 \(개발중\)"/);
 assert.match(button,/data-efficiency-tab="cofiring-draft"/);
 assert.match(html,/cofiring-draft\.js\?v=20260909-organic-manual-v1/);
});
