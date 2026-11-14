'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const warning=require('../maintenance/cofiring-communication-warning-v2.js');
const startLocal='2026-11-12T00:00',endLocal='2026-11-13T00:00';
const item=(unit,fuel,seconds=34.5)=>({unit,fuel,durationBadSeconds:seconds,dataComplete:false,
  startQuality:'Raw, Good',endQuality:'Raw, Good',startBoundaryRecovered:false,endBoundaryRecovered:false});
const reference=rows=>({startLocal,endLocal,summaries:rows});
const four=()=>reference(['unit1','unit2'].flatMap(unit=>['coal','bio'].map(fuel=>item(unit,fuel))));
const plainHost=()=>({hidden:false,dataset:{},title:'',textContent:''});
class Element{
  constructor(tag,document){this.tagName=tag;this.ownerDocument=document;this.dataset={};this.children=[];this._text='';this.className='';}
  appendChild(child){this.children.push(child);return child;}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  querySelector(selector){if(selector==='details.cfv-quality-gap-notice')return this.children.find(child=>child.tagName==='details'&&child.className==='cfv-quality-gap-notice')||null;return null;}
}
function domHost(){const document={createElement(tag){return new Element(tag,document);}};return new Element('div',document);}
const summaryText=host=>host.children[0].children[0].children[0].textContent;

test('four recurring fuel warnings become one maximum-duration summary, preserving diagnostics and source',()=>{
  const ref=four(),usage={ok:true,missing:[]},before=JSON.stringify({ref,usage}),host=plainHost();
  const detailed=warning.messages(ref,usage),returned=warning.render(host,ref,usage);
  assert.deepEqual(returned,detailed);assert.equal(returned.length,4);
  assert.equal(host.textContent,'⚠ 1·2호기 Coal·Bio · 품질 공백 최대 34.5초 · 원본 확인 필요 · 상세 확인');
  assert.equal(host.title,detailed.join(' / '));assert.equal(host.dataset.tone,'warning');assert.equal(host.hidden,false);
  assert.doesNotMatch(host.textContent,/138|계산 완료|누적계 기준 계산|추정/);
  assert.equal(JSON.stringify({ref,usage}),before);
});
test('unmatched affected fuels keep their exact unit mapping rather than asserting a Cartesian set',()=>{
  const host=plainHost();warning.render(host,reference([item('unit1','coal',25.2),item('unit2','bio',35.3)]),{});
  assert.match(host.textContent,/1호기 Coal \/ 2호기 Bio/);
  assert.match(host.textContent,/최대 35\.3초/);assert.doesNotMatch(host.textContent,/1·2호기 Coal·Bio/);
});
test('maximum uses all affected counters rather than adding durations or taking first counter',()=>{
  const host=plainHost(),ref=reference([item('unit1','coal',3),item('unit1','coal',72),item('unit2','bio',17)]);
  warning.render(host,ref,{});assert.match(host.textContent,/최대 72\.0초/);assert.doesNotMatch(host.textContent,/92\.0초/);
});
test('unknown duration and unknown boundary warnings remain fully visible',()=>{
  const a=plainHost(),unknown=reference([item('unit1','coal'),item('unit2','bio',null)]);
  warning.render(a,unknown,{});assert.match(a.textContent,/조회 기간 중 계측 품질 공백 34\.5초/);
  assert.match(a.textContent,/2호기 Bio · 조회 기간 중 계측 품질 공백이/);assert.doesNotMatch(a.textContent,/품질 공백 최대/);
  const b=plainHost(),ref=four();ref.summaries[0].startQuality='Raw, Bad';
  warning.render(b,ref,{});assert.match(b.textContent,/원본 누적 경계값의 품질 또는 복원 근거/);
  assert.match(b.textContent,/2호기 Bio/);assert.doesNotMatch(b.textContent,/품질 공백 최대/);
});
test('mixed organic inventory warning never becomes a quality-gap-only banner',()=>{
  const host=plainHost(),usage={missing:[{silo:'organicStorageSiloA',boundaryLocal:endLocal}],ok:false};
  warning.render(host,four(),usage);assert.match(host.textContent,/Storage A.*재조회 및 재확인/);
  assert.match(host.textContent,/1호기 Coal/);assert.match(host.textContent,/2호기 Bio/);
  assert.doesNotMatch(host.textContent,/품질 공백 최대/);
});
test('single gap keeps existing detailed warning wording',()=>{
  const host=plainHost();warning.render(host,reference([item('unit1','coal')]),{});
  assert.match(host.textContent,/조회 기간 중 계측 품질 공백 34\.5초이 확인/);
  assert.doesNotMatch(host.textContent,/품질 공백 최대/);
});
test('native details is keyboard/tap reachable and expands full text without HTML injection',()=>{
  const host=domHost(),ref=four();warning.render(host,ref,{});
  const details=host.children[0],summary=details.children[0],list=details.children[1];
  assert.equal(details.tagName,'details');assert.equal(summary.tagName,'summary');assert.equal(details.open,false);
  assert.match(summaryText(host),/1·2호기 Coal·Bio.*최대 34\.5초/);
  assert.equal(summary.children[1].textContent,'상세');assert.equal(list.tagName,'ul');assert.equal(list.children.length,4);
  assert.deepEqual(list.children.map(row=>row.textContent),warning.messages(ref,{}));
  assert.ok(list.children.every(row=>row.tagName==='li'));
});
test('same warning rerender preserves expanded state, changed summary resets it, clean rerender removes old details',()=>{
  const host=domHost(),ref=four();warning.render(host,ref,{});host.children[0].open=true;
  warning.render(host,ref,{});assert.equal(host.children[0].open,true);
  ref.summaries[0].durationBadSeconds=50;warning.render(host,ref,{});assert.equal(host.children[0].open,false);
  warning.render(host,reference([]),{});assert.equal(host.hidden,true);assert.equal(host.textContent,'');
  assert.equal(host.title,'');assert.equal(host.children.length,0);
});
