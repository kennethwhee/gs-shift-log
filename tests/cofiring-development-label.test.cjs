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
class Element {
  constructor(attributes={}){this.attributes=attributes;this.dataset={};for(const [name,value]of Object.entries(attributes))if(name.startsWith('data-'))this.dataset[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;this.value=attributes.value||'';this.listeners={};this.disabled=false;this.hidden=false;this.textContent='';this.classList={add(){}};this._html='';this.children=[];}
  set innerHTML(value){this._html=value;this.children=[];for(const match of value.matchAll(/<[a-z][^>]*\bdata-cf-[^>]*>/g)){const attrs={};for(const attr of match[0].matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)")?/g))attrs[attr[1]]=attr[2]||'';this.children.push(new Element(attrs));}}
  get innerHTML(){return this._html;}
  querySelectorAll(selector){const match=/^\[([^=\]]+)(?:="([^\"]+)")?\]$/.exec(selector);return this.children.filter(child=>match&&Object.hasOwn(child.attributes,match[1])&&(match[2]===undefined||child.attributes[match[1]]===match[2]));}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  addEventListener(type,callback){(this.listeners[type] ||= []).push(callback);}
  async fire(type,event={target:this}){for(const fn of this.listeners[type]||[])await fn(event);}
  click(){return this.fire('click');}
}
function harness({reference,fetch}={}){
  let calls=0;const container=new Element();const context=vm.createContext({CofiringCore:core,console,fetch:async(...args)=>{calls++;if(fetch)return fetch(...args);return {ok:true,json:async()=>clone(original)};}});
  vm.runInContext(source,context);
  const controller=context.CofiringDraft.mount(container,{reference});
  return {container,controller,find:s=>container.querySelector(`[data-cf-${s}]`),all:s=>container.querySelectorAll(`[data-cf-${s}]`),get calls(){return calls;}};
}
function pilot(){const reference=clone(original);reference.source.kind='dataparc_hidden_excel';return {kind:'cofiring_dataparc_pilot',status:'PASS',cleanupVerified:true,databaseWritten:false,productionReady:false,reference};}


test('development title and a persistent notice are separate from transient results',async()=>{
 const h=harness({reference:clone(original)});const notice=h.find('development');
 assert.ok(notice);assert.notEqual(notice,h.find('status'));
 assert.match(h.container.innerHTML,/<h2>혼소율 \(개발중\)<\/h2>/);
 assert.match(h.container.innerHTML,/웹 자동조회는 아직 연결되지 않았습니다/);
 assert.match(h.container.innerHTML,/운영 확정값으로 사용하지 마세요/);
 await h.find('original').click();assert.equal(h.find('development'),notice);
 assert.match(h.find('results').innerHTML,/29\.03%/);
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
 assert.match(html,/cofiring-draft\.js\?v=20260909-development-label-v1/);
});
