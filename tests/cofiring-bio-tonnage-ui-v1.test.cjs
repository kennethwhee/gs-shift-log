'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const api=require('../maintenance/cofiring-bio-tonnage-v1.js');
const core=require('../maintenance/cofiring-bio-tonnage-core-v1.js');
const source=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-bio-tonnage-v1.js'),'utf8');
const now=Date.parse('2026-11-02T20:10:00+09:00');
const period=(end='2026-11-02T20:00')=>({startLocal:'2026-11-02T00:00',endLocal:end,startMs:Date.parse('2026-11-02T00:00+09:00'),endMs:Date.parse(end+':00+09:00'),durationHours:(Date.parse(end+':00+09:00')-Date.parse('2026-11-02T00:00+09:00'))/3600000});
const result=()=>({period:period(),units:{unit1:{bio:{complete:true,quantity:400,coefficient:1.5,measuredQuantity:400/1.5}},unit2:{bio:{complete:true,quantity:200,coefficient:2,measuredQuantity:100}}}});
const prefs=(mode='combined',plannedRate2='')=>({targets:['361.4','361.4'],mode,plannedRate2});
const plain=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}

class Element{
  constructor(tag,document){this.tagName=tag.toUpperCase();this.ownerDocument=document;this.children=[];this.parentNode=null;this.attributes={};this.className='';this._text='';this.value='';this.hidden=false;this.disabled=false;this.open=false;this.events={};this.selectionStart=null;this.selectionEnd=null;this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:name=>{if(!this.classList.contains(name))this.className=(this.className+' '+name).trim();},toggle:(name,on)=>{const set=new Set(this.className.split(/\s+/).filter(Boolean));if(on??!set.has(name))set.add(name);else set.delete(name);this.className=[...set].join(' ');}};}
  setAttribute(key,value){this.attributes[key]=String(value);if(key==='class')this.className=String(value);}
  getAttribute(key){return Object.hasOwn(this.attributes,key)?this.attributes[key]:null;}
  hasAttribute(key){return Object.hasOwn(this.attributes,key);}
  get textContent(){return this._text+this.children.map(child=>child.textContent).join('');}
  set textContent(text){this.replaceChildren();this._text=String(text);}
  get nextSibling(){if(!this.parentNode)return null;return this.parentNode.children[this.parentNode.children.indexOf(this)+1]||null;}
  matches(selector){return selector.split(',').some(part=>{part=part.trim();if(part.startsWith('.'))return this.classList.contains(part.slice(1));const m=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(part);return !!m&&this.hasAttribute(m[1])&&(m[2]===undefined||this.getAttribute(m[1])===m[2]);});}
  querySelectorAll(selector){const out=[];for(const child of this.children){if(child.matches(selector))out.push(child);out.push(...child.querySelectorAll(selector));}return out;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
  contains(target){for(let node=target;node;node=node.parentNode)if(node===this)return true;return false;}
  append(...children){for(const child of children)this.appendChild(child);}
  appendChild(child){return this.insertBefore(child,null);}
  insertBefore(child,before){if(child===before)return child;if(child.parentNode)child.parentNode.removeChild(child);const index=before?this.children.indexOf(before):this.children.length;if(index<0)throw new Error('not a child');this.children.splice(index,0,child);child.parentNode=this;return child;}
  removeChild(child){const index=this.children.indexOf(child);if(index<0)throw new Error('not a child');if(child.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=null;this.children.splice(index,1);child.parentNode=null;return child;}
  remove(){this.parentNode?.removeChild(this);}
  replaceChildren(...children){for(const child of [...this.children])this.removeChild(child);this._text='';this.append(...children);}
  set innerHTML(value){this.replaceChildren();this._text=String(value);}
  get innerHTML(){return this._text;}
  addEventListener(event,handler){(this.events[event]??=[]).push(handler);}
  removeEventListener(event,handler){this.events[event]=(this.events[event]||[]).filter(fn=>fn!==handler);}
  fire(event){for(let node=this;node;node=node.parentNode)for(const handler of node.events[event]||[])handler({target:this});}
  focus(){this.ownerDocument.activeElement=this;}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
}
function harness(){
  const doc={activeElement:null,createElement(tag){return new Element(tag,this);}},storage=new Map(),timers=new Map();let sequence=0;
  const context=vm.createContext({document:doc,CofiringBioTonnageCoreV1:core,localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},setTimeout:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(source,context);
  const guide=context.CofiringBioTonnageV1,container=doc.createElement('div'),grid=doc.createElement('div');container.setAttribute('data-cofiring-draft-root','');grid.setAttribute('data-cfv52-summary-grid','');container.append(grid);
  function cards(adjusted=false){grid.replaceChildren();for(const kind of adjusted?['original','adjusted']:['original'])for(const unit of ['unit1','unit2']){const card=doc.createElement('article');card.setAttribute('data-cfv52-unit',unit);if(adjusted)card.setAttribute('data-adjustment-kind',kind);if(kind==='adjusted')card.className='cfv-adjustment-card';const old=doc.createElement('section');old.setAttribute('data-cfv6-target','');old.textContent='Bio 25% existing';card.append(old);grid.append(card);}const total=doc.createElement('article');total.className='cfv52-card-total';grid.append(total);}
  cards();const r=result(),options={selectedPeriod:r.period,now};
  return {guide,container,grid,doc,storage,timers,cards,r,options,render:()=>guide.render(container,r,options),find:selector=>container.querySelector(selector),field:name=>container.querySelector('[data-bio-tonnage-field="'+name+'"]')?.textContent};
}

test('context uses corrected complete Bio only, without applying its coefficient a second time',()=>{
  const r=freeze(result()),before=JSON.stringify(r),model=api.viewModel(r,prefs(),{now,selectedPeriod:r.period});
  assert.equal(model.context.valid,true);assert.deepEqual(model.context.current,[400,200]);assert.equal(model.context.remainingHours,4);assert.equal(model.calculation.rates[0],0);assert.ok(Math.abs(model.calculation.rates[1]-30.7)<1e-9);assert.equal(JSON.stringify(r),before);
});
test('support requires an explicit manual planned rate and support is a subset of Unit 1 total',()=>{
  const r=result();assert.equal(api.viewModel(r,prefs('support'),{now,selectedPeriod:r.period}).calculation,null);
  const m=api.viewModel(r,prefs('support','20'),{now,selectedPeriod:r.period});assert.ok(Math.abs(m.calculation.need[0]-42.8)<1e-9);assert.ok(Math.abs(m.calculation.support-42.8)<1e-9);assert.ok(Math.abs(m.calculation.rates[0]-10.7)<1e-9);assert.equal(m.calculation.rates[1],20);assert.equal(m.calculation.rateKinds[1],'planned');
  const p=prefs('support','20');p.targets[0]='500';const changed=api.viewModel(r,p,{now,selectedPeriod:r.period}).calculation;assert.ok(Math.abs(changed.need[0]-181.4)<1e-9);assert.ok(Math.abs(changed.support-150.7)<1e-9);
});
test('empty, malformed and overflow inputs never become zero or a speculative plan',()=>{
  for(const value of ['',null,'  ','-1','Infinity','1e3','1,2','1.234'])assert.equal(api.parseQuantity(value),null,String(value));assert.equal(api.parseQuantity('0'),0);
  const r=result(),p=prefs();p.targets[0]='';const model=api.viewModel(r,p,{now,selectedPeriod:r.period});assert.equal(model.calculation,null);assert.equal(model.targetTotal,null);
});
test('rejects missing, incomplete, negative, inconsistent, future and changed-period sources',()=>{
  const r=result();for(const change of [x=>{x.units.unit2.bio.complete=false;},x=>{x.units.unit1.bio.quantity=null;},x=>{x.units.unit1.bio.quantity=-1;},x=>{x.period.endMs+=60000;},x=>{x.period.durationHours=19;},x=>{x.period.startLocal='2026-11-02T01:00';},x=>{x.period.endLocal='2026-11-03T01:00';delete x.period.endMs;delete x.period.durationHours;}]){const x=result();change(x);assert.equal(api.contextFor(x,{now,selectedPeriod:x.period}).valid,false);}
  assert.equal(api.contextFor(null,{now,selectedPeriod:r.period}).valid,false);assert.equal(api.contextFor(r,{now:Date.parse('2026-11-02T19:59:00+09:00'),selectedPeriod:r.period}).valid,false);assert.equal(api.contextFor(r,{now,selectedPeriod:period('2026-11-02T19:00')}).valid,false);
});
test('strict KST period aliases agree across UTC/local forms and calendar boundaries',()=>{
  const r=result();r.period.start='2026-11-01T15:00:00Z';r.period.end='2026-11-02T11:00:00.000Z';assert.equal(api.contextFor(r,{now,selectedPeriod:r.period}).valid,true);r.period.start='2026-11-02T00:00:00Z';assert.equal(api.contextFor(r,{now,selectedPeriod:r.period}).valid,false);
  r.period={startLocal:'2028-02-29T00:00',endLocal:'2028-02-29T20:00'};assert.equal(api.contextFor(r,{now:Date.parse('2028-02-29T20:10:00+09:00'),selectedPeriod:r.period}).valid,true);r.period.startLocal='2026-02-29T00:00';assert.equal(api.contextFor(r,{now,selectedPeriod:r.period}).valid,false);
});
test('closes t/h at actual 24:00, even with an older partial source; full day also closes',()=>{
  const r=result(),model=api.viewModel(r,prefs(),{now:Date.parse('2026-11-03T00:00:00+09:00'),selectedPeriod:r.period});assert.equal(model.context.status,'closed');assert.deepEqual(model.calculation.rates,[null,null]);assert.equal(model.calculation.finalTotal,null);
  r.period=period('2026-11-03T00:00');assert.equal(api.contextFor(r,{now:Date.parse('2026-11-03T00:00:00+09:00'),selectedPeriod:r.period}).status,'closed');
});
test('unrelated provisional organic flags do not discard verified Bio, but hypotheses are unavailable',()=>{
  const r=result();r.organicUsage={provisional:true,provisionalZero:true};assert.equal(api.contextFor(r,{now,selectedPeriod:r.period}).valid,true);for(const value of [{scenario:{}},{sharedScenarioPending:true}]){r.organicUsage=value;assert.equal(api.contextFor(r,{now,selectedPeriod:r.period}).valid,false);}delete r.organicUsage;r.hypothesisDisplay={kind:'pending'};assert.equal(api.contextFor(r,{now,selectedPeriod:r.period}).valid,false);
});
test('compact DOM mounts after existing percentage blocks, before combined card, and never on adjusted cards',()=>{
  const h=harness();h.cards(true);h.render();assert.equal(h.container.querySelectorAll('[data-bio-tonnage-card]').length,2);for(const unit of ['unit1','unit2']){const cards=h.grid.querySelectorAll('[data-cfv52-unit="'+unit+'"]');assert.equal(cards[0].querySelector('[data-cfv6-target]').nextSibling.getAttribute('data-bio-tonnage-card'),unit);assert.equal(cards[1].querySelector('[data-bio-tonnage-card]'),null);assert.equal(cards[0].querySelector('[data-cfv6-target]').textContent,'Bio 25% existing');}const shared=h.find('[data-bio-tonnage-shared]');assert.equal(shared.nextSibling.classList.contains('cfv52-card-total'),true);assert.equal(h.find('[data-bio-tonnage-settings]').open,false);assert.equal(h.field('rate1'),'30.70');assert.match(h.field('basis'),/20:00.*24:00.*4시간.*자료 지연 10.0분/);
});
test('support mode has an empty plan, explicit planned labels, and updates without replacing focused input',()=>{
  const h=harness();h.render();h.find('[data-bio-tonnage-mode="support"]').fire('click');const plan=h.find('[data-bio-tonnage-plan]');assert.equal(plan.value,'');assert.equal(h.field('rate1'),'—');assert.match(h.field('status'),/직접 입력/);assert.equal(h.field('rate-label1'),'예정');assert.equal(h.field('need-label1'),'예정 추가 ');plan.value='20';plan.focus();plan.setSelectionRange(1,1);plan.fire('input');assert.equal(h.field('rate0'),'10.70');assert.equal(h.field('rate1'),'20.00');assert.match(h.field('tail0'),/그중 지원 42.80 t/);assert.equal(h.doc.activeElement,plan);assert.equal(plan.selectionStart,1);
});
test('keeps draft text, focus/caret and settings open across summary replacement, with one delegated binding',()=>{
  const h=harness();h.render();h.find('[data-bio-tonnage-mode="individual"]').fire('click');const input=h.find('[data-bio-tonnage-target="unit1"]'),settings=h.find('[data-bio-tonnage-settings]');input.value='500.';input.fire('input');settings.open=true;input.focus();input.setSelectionRange(4,4);const restore=h.guide.retain(h.container);h.cards();h.render();restore();assert.equal(h.find('[data-bio-tonnage-target="unit1"]'),input);assert.equal(input.value,'500.');assert.equal(h.doc.activeElement,input);assert.equal(input.selectionStart,4);assert.equal(settings.open,true);assert.equal(h.container.events.input.length,1);assert.equal(h.container.events.click.length,1);
});
test('busy, failure, stale controls, null result and midnight clear planning; dispose clears timers and listeners',()=>{
  const h=harness();h.render();assert.equal(h.field('rate1'),'30.70');h.guide.setQueryState(h.container,{busy:true});assert.equal(h.field('rate1'),'—');h.guide.setQueryState(h.container,{failed:true});assert.equal(h.field('rate1'),'—');h.guide.setQueryState(h.container,{});assert.equal(h.field('rate1'),'30.70');
  const date=h.doc.createElement('input');date.setAttribute('data-cfv7-date','');date.value='2026-11-01';h.container.append(date);date.fire('input');assert.equal(h.field('rate1'),'—');date.value='2026-11-02';h.render();h.options.now=Date.parse('2026-11-03T00:00:00+09:00');h.render();assert.equal(h.field('rate1'),'—');assert.match(h.field('status'),/조회일 종료/);
  h.guide.render(h.container,null,{selectedPeriod:h.r.period,now});assert.equal(h.field('rate0'),'—');assert.equal(h.find('[data-bio-tonnage-target="unit1"]').disabled,true);h.guide.dispose(h.container);assert.equal(h.timers.size,0);assert.equal(h.container.events.input.length,0);
});
test('only local target/mode preferences persist; Unit 2 plan is not a fabricated or persisted rate',()=>{
  const h=harness();h.render();h.find('[data-bio-tonnage-mode="individual"]').fire('click');const goal=h.find('[data-bio-tonnage-target="unit1"]');goal.value='500';goal.fire('input');h.find('[data-bio-tonnage-mode="support"]').fire('click');const plan=h.find('[data-bio-tonnage-plan]');plan.value='20';plan.fire('input');const saved=JSON.parse([...h.storage.values()][0]);assert.deepEqual(saved,{targets:[500,361.4],combinedTarget:722.8,mode:'support'});assert.equal(Object.hasOwn(saved,'plannedRate2'),false);
  const tomorrow=result();tomorrow.period={startLocal:'2026-11-03T00:00',endLocal:'2026-11-03T20:00'};h.guide.render(h.container,tomorrow,{selectedPeriod:tomorrow.period,now:Date.parse('2026-11-03T20:10:00+09:00')});assert.equal(plan.value,'');assert.equal(h.field('rate1'),'—');
});
test('no-document environments fail closed and production module contains no demo defaults or remote writes',()=>{
  assert.equal(api.render({querySelector(){return null;}},result()),false);assert.doesNotMatch(source,/fetch\s*\(|XMLHttpRequest|sendBeacon|plannedRate2\s*:\s*20|value\s*=\s*['"]20['"]|data-scenario|예시/);
});

test('the local deadline timer clears rates at midnight without replacing source or making a query',()=>{
  const h=harness();let clock=now;h.options.now=()=>clock;h.render();assert.equal(h.field('rate1'),'30.70');const [id,tick]=[...h.timers.entries()][0];h.timers.delete(id);clock=Date.parse('2026-11-03T00:00:00+09:00');tick();assert.equal(h.field('rate1'),'—');assert.match(h.field('status'),/조회일 종료/);assert.equal(h.timers.size,0);assert.equal(h.r.units.unit1.bio.quantity,400);
});
test('modal suspension clears its local timer and rendering resumes with the same goal draft',()=>{
  const h=harness();h.render();h.find('[data-bio-tonnage-mode="individual"]').fire('click');const goal=h.find('[data-bio-tonnage-target="unit1"]');goal.value='500.';goal.fire('input');h.guide.suspend(h.container);assert.equal(h.timers.size,0);assert.equal(h.field('rate1'),'—');h.render();assert.equal(goal.value,'500.');assert.ok(h.timers.size>0);h.guide.dispose(h.container);assert.equal(h.timers.size,0);
});
test('existing summary hook passes the actual unprojected base object to the guide during adjustment comparison',()=>{
  const h=harness(),calls=[];let restored=0;const base=result(),adjusted=result(),projected=result();adjusted.units.unit1.bio.quantity=900;projected.units.unit1.bio.quantity=800;
  h.container.__cfvAdjustedComparisonState={active:true,base,adjusted};
  const mode=h.doc.createElement('select');mode.setAttribute('data-cfv8-mode','');mode.value='period';h.container.append(mode);for(const [attr,value]of[['data-cfv8-start',base.period.startLocal],['data-cfv8-end',base.period.endLocal]]){const input=h.doc.createElement('input');input.setAttribute(attr,'');input.value=value;h.container.append(input);}
  const context=vm.createContext({CofiringCore:require('../maintenance/cofiring-core.js'),CofiringPeriodAdjustmentV56:{},CofiringEstimateV1:{projection:()=>({result:projected})},CofiringBioTonnageV1:{retain:()=>()=>{restored++;},render:(container,value,options)=>calls.push({container,value,options})}});
  const original=fs.readFileSync(path.join(__dirname,'../maintenance/cofiring-period-ui-v5.js'),'utf8').replace('  root.CofiringPeriodV5={','  root.__renderSummaryForTest=renderSummary;\n  root.CofiringPeriodV5={');
  vm.runInContext(original,context);context.__renderSummaryForTest(h.container,adjusted,{});assert.equal(calls.length,1);assert.equal(calls[0].value,base);assert.notEqual(calls[0].value,projected);assert.equal(calls[0].options.selectedPeriod.endLocal,base.period.endLocal);assert.equal(restored,1);assert.equal(base.units.unit1.bio.quantity,400);
});

test('closed support day never asks for an empty disabled planned-rate input',()=>{
  const h=harness();h.render();h.find('[data-bio-tonnage-mode="support"]').fire('click');assert.equal(h.find('[data-bio-tonnage-plan]').value,'');h.options.now=Date.parse('2026-11-03T00:00:00+09:00');h.render();assert.equal(h.field('status'),'조회일 종료 · 추가 투입 계획을 표시하지 않습니다.');assert.match(h.field('basis'),/^조회일 종료 · 자료 2026-11-02 20:00 기준$/);assert.equal(h.field('rate0'),'—');assert.equal(h.field('rate1'),'—');assert.equal(h.find('[data-bio-tonnage-plan]').disabled,true);assert.equal(h.find('[data-bio-tonnage-plan]').getAttribute('aria-invalid'),'false');
});

test('compact card fields share one main row and shared non-support proof shares the mode row',()=>{
  const h=harness();h.render();const card=h.find('[data-bio-tonnage-card="unit1"]'),main=card.querySelector('.cfbt-main');assert.equal(card.querySelector('.cfbt-sub'),null);assert.equal(main.children.length,4);assert.equal(main.children[2].classList.contains('cfbt-additional'),true);assert.equal(main.children[3].classList.contains('cfbt-tail'),true);
  const controls=h.find('.cfbt-controls'),proof=h.find('[data-bio-tonnage-field="proof"]');assert.equal(proof.parentNode,controls);assert.match(proof.textContent,/예상 마감량 · 1호기/);assert.equal(h.container.querySelectorAll('[data-bio-tonnage-mode]').length,4);
  h.find('[data-bio-tonnage-mode="support"]').fire('click');assert.equal(proof.hidden,true);assert.equal(proof.textContent,'');assert.equal(h.find('[data-bio-tonnage-plan-row]').parentNode,controls);
  const plan=h.find('[data-bio-tonnage-plan]');plan.value='20';plan.fire('input');assert.equal(proof.hidden,false);assert.equal(proof.classList.contains('cfbt-support-proof'),true);assert.equal(proof.parentNode,h.find('.cfbt-settings-body'));
  h.find('[data-bio-tonnage-mode="combined"]').fire('click');assert.equal(proof.parentNode,controls);assert.equal(proof.classList.contains('cfbt-proof'),true);
});
test('reverse support labels Unit 1 as planned and Unit 2 as helper with symmetric subset math',()=>{
  const h=harness();h.r.units.unit1.bio.quantity=200;h.r.units.unit2.bio.quantity=400;h.render();h.find('[data-bio-tonnage-mode="support2"]').fire('click');const plan=h.find('[data-bio-tonnage-plan]');assert.equal(plan.value,'');assert.match(h.field('status'),/^1호기 예정/);assert.equal(plan.getAttribute('aria-label'),'1호기 예정 투입속도, 시간당 톤');assert.equal(h.field('plan-label'),'1호기 예정 투입속도');
  plan.value='20';plan.fire('input');assert.equal(h.field('rate-label0'),'예정');assert.equal(h.field('need-label0'),'예정 추가 ');assert.equal(h.field('rate-label1'),'필요');assert.equal(h.field('rate0'),'20.00');assert.equal(h.field('rate1'),'10.70');assert.equal(h.field('need0'),'80.00');assert.equal(h.field('need1'),'42.80');assert.equal(h.field('tail1'),'그중 지원 42.80 t');assert.match(h.field('proof'),/^현재 합계 600.00 t \+ 1호기 예정 80.00 t \+ 2호기 추가 42.80 t → 마감 예상 722.80 t/);assert.match(h.field('status'),/^2호기 지원/);
});
test('support direction keeps separate empty drafts and reuses the input with the matching label and caret',()=>{
  const h=harness();h.render();h.find('[data-bio-tonnage-mode="support"]').fire('click');const plan=h.find('[data-bio-tonnage-plan]');plan.value='20.50';plan.focus();plan.setSelectionRange(2,2);plan.fire('input');
  h.find('[data-bio-tonnage-mode="support2"]').fire('click');assert.equal(h.find('[data-bio-tonnage-plan]'),plan);assert.equal(plan.value,'');assert.equal(plan.getAttribute('aria-label'),'1호기 예정 투입속도, 시간당 톤');assert.equal(h.field('rate0'),'—');assert.equal(h.field('rate1'),'—');
  plan.value='7.25';plan.setSelectionRange(1,1);plan.fire('input');h.find('[data-bio-tonnage-mode="support"]').fire('click');assert.equal(plan.value,'20.50');assert.equal(plan.selectionStart,2);assert.equal(h.doc.activeElement,plan);assert.equal(plan.getAttribute('aria-label'),'2호기 예정 투입속도, 시간당 톤');h.find('[data-bio-tonnage-mode="support2"]').fire('click');assert.equal(plan.value,'7.25');assert.equal(plan.selectionStart,1);assert.equal(h.doc.activeElement,plan);
});
test('null render with a new UTC-selected day clears both planned drafts before an alias-only result arrives',()=>{
  const h=harness();h.render();h.find('[data-bio-tonnage-mode="support"]').fire('click');const plan=h.find('[data-bio-tonnage-plan]');plan.value='20';plan.fire('input');h.find('[data-bio-tonnage-mode="support2"]').fire('click');plan.value='7';plan.fire('input');
  const selected={start:'2026-11-02T15:00:00Z',end:'2026-11-03T11:00:00Z'},nextNow=Date.parse('2026-11-03T20:10:00+09:00');h.guide.render(h.container,null,{selectedPeriod:selected,now:nextNow});assert.equal(plan.value,'');
  const next=result();next.period={startMs:Date.parse(selected.start),endMs:Date.parse(selected.end),durationHours:20};h.guide.render(h.container,next,{selectedPeriod:selected,now:nextNow});assert.equal(plan.value,'');assert.equal(h.field('rate1'),'—');h.find('[data-bio-tonnage-mode="support"]').fire('click');assert.equal(plan.value,'');assert.equal(h.field('rate0'),'—');
});
test('neither planned draft is restored from browser preferences and support2 keeps all unavailable guards',()=>{
  const h=harness();h.storage.set('gs-shift-log.cofiring.bio-tonnage.v1',JSON.stringify({targets:[361.4,361.4],mode:'support2',plannedRate1:20,plannedRate2:10}));h.render();const plan=h.find('[data-bio-tonnage-plan]');assert.equal(plan.value,'');plan.value='20';plan.fire('input');assert.notEqual(h.field('rate1'),'—');h.guide.setQueryState(h.container,{busy:true});assert.equal(h.field('rate1'),'—');h.guide.setQueryState(h.container,{failed:true});assert.equal(h.field('rate0'),'—');h.guide.setQueryState(h.container,{});h.options.now=Date.parse('2026-11-03T00:00:00+09:00');h.render();assert.equal(h.field('rate0'),'—');assert.equal(h.field('rate1'),'—');assert.match(h.field('status'),/^조회일 종료/);
});

test('independent combined target stays unchanged when unit goals or modes change',()=>{
  const h=harness();h.render();const total=h.find('[data-bio-tonnage-combined-target]');assert.equal(total.value,'722.8');total.value='700';total.fire('input');assert.equal(h.field('need1'),'100.00');assert.equal(h.find('[data-bio-tonnage-target="unit1"]').value,'350');assert.equal(h.find('[data-bio-tonnage-target="unit2"]').value,'350');h.find('[data-bio-tonnage-mode="individual"]').fire('click');const goal=h.find('[data-bio-tonnage-target="unit1"]');goal.value='500';goal.fire('input');assert.equal(total.value,'700');assert.equal(h.find('[data-bio-tonnage-target="unit2"]').value,'361.4');assert.equal(h.find('[data-bio-tonnage-total-editor]').hidden,true);assert.equal(h.find('[data-bio-tonnage-unit-total]').hidden,false);assert.match(h.find('[data-bio-tonnage-unit-total]').textContent,/호기 목표 합계 861.40 t/);h.find('[data-bio-tonnage-mode="combined"]').fire('click');assert.equal(total.value,'700');assert.equal(goal.value,'350');assert.equal(h.field('final-total'),'700.00 t');
});
test('legacy preferences migrate their saved goal sum once and preserve it after later unit-goal edits',()=>{
  const h=harness();h.storage.set('gs-shift-log.cofiring.bio-tonnage.v1',JSON.stringify({targets:[300,350],mode:'combined'}));h.render();const total=h.find('[data-bio-tonnage-combined-target]');assert.equal(total.value,'650');let saved=JSON.parse([...h.storage.values()][0]);assert.equal(saved.combinedTarget,650);h.find('[data-bio-tonnage-mode="individual"]').fire('click');const goal=h.find('[data-bio-tonnage-target="unit1"]');goal.value='400';goal.fire('input');saved=JSON.parse([...h.storage.values()][0]);assert.equal(total.value,'650');assert.deepEqual(saved.targets,[400,350]);assert.equal(saved.combinedTarget,650);const next=harness();next.storage.set('gs-shift-log.cofiring.bio-tonnage.v1',JSON.stringify(saved));next.render();assert.equal(next.find('[data-bio-tonnage-combined-target]').value,'650');const cents=harness();cents.storage.set('gs-shift-log.cofiring.bio-tonnage.v1',JSON.stringify({targets:[0.1,0.2],mode:'combined'}));cents.render();assert.equal(cents.find('[data-bio-tonnage-combined-target]').value,'0.3');assert.equal(cents.find('[data-bio-tonnage-combined-target]').getAttribute('aria-invalid'),'false');assert.equal(JSON.parse([...cents.storage.values()][0]).combinedTarget,0.3);
});
test('explicit blank total holds global planning but individual mode still calculates and saves valid goals',()=>{
  const h=harness();h.render();const total=h.find('[data-bio-tonnage-combined-target]');total.value='700';total.fire('input');total.value='';total.fire('input');assert.equal(h.field('rate0'),'—');assert.equal(h.field('rate1'),'—');assert.match(h.field('status'),/합계 목표량.*입력/);h.find('[data-bio-tonnage-mode="individual"]').fire('click');assert.equal(h.field('rate1'),'40.35');assert.match(h.field('status'),/^호기별 목표 합계보다 38.60 t 초과 예상$/);const goal=h.find('[data-bio-tonnage-target="unit1"]');goal.value='500';goal.fire('input');const saved=JSON.parse([...h.storage.values()][0]);assert.equal(saved.mode,'individual');assert.deepEqual(saved.targets,[500,361.4]);assert.equal(saved.combinedTarget,700);assert.equal(total.value,'');h.find('[data-bio-tonnage-mode="combined"]').fire('click');assert.equal(total.value,'');assert.equal(h.field('rate1'),'—');
});
test('view model distinguishes missing API total from an explicit invalid total and explains equal fallback',()=>{
  const r=result(),p=prefs();let model=api.viewModel(r,p,{now,selectedPeriod:r.period});assert.equal(model.calculation.combinedTargetApplied,false);for(const invalid of ['',null,undefined,'-1','Infinity']){p.combinedTarget=invalid;model=api.viewModel(r,p,{now,selectedPeriod:r.period});assert.equal(model.calculation,null);assert.equal(model.combinedValid,false);p.mode='individual';model=api.viewModel(r,p,{now,selectedPeriod:r.period});assert.equal(model.calculation.valid,true);p.mode='combined';}p.combinedTarget='900';p.targets=['100','100'];model=api.viewModel(r,p,{now,selectedPeriod:r.period});assert.equal(model.calculation.total,900);assert.deepEqual(model.calculation.need,[50,250]);assert.deepEqual(model.calculation.final,[450,450]);assert.match(model.status,/절반씩/);
});
test('custom total support proof uses actual additions in both directions rather than a deficit-credit identity',()=>{
  for(const mode of ['support','support2']){const h=harness();if(mode==='support2'){h.r.units.unit1.bio.quantity=200;h.r.units.unit2.bio.quantity=400;}h.render();const total=h.find('[data-bio-tonnage-combined-target]');total.value='700';total.fire('input');h.find('[data-bio-tonnage-mode="'+mode+'"]').fire('click');const plan=h.find('[data-bio-tonnage-plan]');plan.value='20';plan.fire('input');assert.equal(h.field('final-total'),'700.00 t');assert.equal(h.field(mode==='support'?'rate0':'rate1'),'5.00');assert.equal(h.field('proof'),mode==='support'?'현재 합계 600.00 t + 1호기 추가 20.00 t + 2호기 예정 80.00 t → 마감 예상 700.00 t':'현재 합계 600.00 t + 1호기 예정 80.00 t + 2호기 추가 20.00 t → 마감 예상 700.00 t');}
});
test('retained total editor preserves its own draft and focus across summary rebuilds and state guards',()=>{
  const h=harness();h.render();const total=h.find('[data-bio-tonnage-combined-target]'),settings=h.find('[data-bio-tonnage-settings]');total.value='700.';total.fire('input');settings.open=true;total.focus();total.setSelectionRange(3,3);const restore=h.guide.retain(h.container);h.cards();h.render();restore();assert.equal(h.find('[data-bio-tonnage-combined-target]'),total);assert.equal(total.value,'700.');assert.equal(h.doc.activeElement,total);assert.equal(total.selectionStart,3);assert.equal(settings.open,true);assert.equal(h.find('[data-bio-tonnage-target="unit1"]').value,'350');h.guide.setQueryState(h.container,{failed:true});assert.equal(total.disabled,true);assert.equal(h.field('rate1'),'—');h.guide.setQueryState(h.container,{});assert.equal(total.value,'700.');assert.equal(h.field('final-total'),'700.00 t');h.options.now=Date.parse('2026-11-03T00:00:00+09:00');h.render();assert.equal(total.value,'700.');assert.equal(h.field('rate1'),'—');assert.match(h.field('status'),/^조회일 종료/);
});
test('individual excess wording cannot be mistaken for the independent combined target',()=>{
  const h=harness();h.render();const total=h.find('[data-bio-tonnage-combined-target]');total.value='500';total.fire('input');assert.match(h.field('status'),/^입력한 합계 목표보다 100.00 t 초과 예상$/);h.find('[data-bio-tonnage-mode="individual"]').fire('click');assert.match(h.field('status'),/^호기별 목표 합계보다 38.60 t 초과 예상$/);
});

test('global 737 target updates both readonly half goals and equal final levels for the user quantities',()=>{
  const h=harness();h.r.units.unit1.bio.quantity=16.91;h.r.units.unit2.bio.quantity=6.47;h.render();const total=h.find('[data-bio-tonnage-combined-target]');total.value='737';total.fire('input');for(const unit of ['unit1','unit2']){const input=h.find('[data-bio-tonnage-target="'+unit+'"]');assert.equal(input.value,'368.5');assert.equal(input.readOnly,true);assert.equal(input.title,'합계 목표의 절반 자동');}assert.equal(h.field('need0'),'351.59');assert.equal(h.field('need1'),'362.03');assert.equal(h.field('tail0'),'마감 예상 368.50 t');assert.equal(h.field('tail1'),'마감 예상 368.50 t');assert.match(h.field('proof'),/1호기 368.50 t \/ 2호기 368.50 t/);assert.equal(h.field('final-total'),'737.00 t');
});
test('global modes retain individual manual drafts and reject programmatic edits of readonly halves',()=>{
  const h=harness();h.storage.set('gs-shift-log.cofiring.bio-tonnage.v1',JSON.stringify({targets:[500,250],combinedTarget:737,mode:'combined'}));h.render();const one=h.find('[data-bio-tonnage-target="unit1"]'),two=h.find('[data-bio-tonnage-target="unit2"]');assert.equal(one.value,'368.5');one.value='999';one.fire('input');assert.equal(one.value,'368.5');h.find('[data-bio-tonnage-mode="individual"]').fire('click');assert.equal(one.value,'500');assert.equal(two.value,'250');assert.equal(one.readOnly,false);one.value='510.';one.fire('input');h.find('[data-bio-tonnage-mode="combined"]').fire('click');const total=h.find('[data-bio-tonnage-combined-target]');total.value='800';total.fire('input');for(const mode of ['support','support2','combined']){h.find('[data-bio-tonnage-mode="'+mode+'"]').fire('click');assert.equal(one.value,'400');assert.equal(two.value,'400');}const saved=JSON.parse([...h.storage.values()][0]);assert.deepEqual(saved.targets,[510,250]);assert.equal(saved.combinedTarget,800);h.find('[data-bio-tonnage-mode="individual"]').fire('click');assert.equal(one.value,'510.');assert.equal(two.value,'250');
});
test('global goals ignore a blank manual draft while storage uses only the last valid manual pair',()=>{
  const h=harness();h.render();h.find('[data-bio-tonnage-mode="individual"]').fire('click');const one=h.find('[data-bio-tonnage-target="unit1"]');one.value='';one.fire('input');assert.equal(h.field('rate1'),'—');h.find('[data-bio-tonnage-mode="combined"]').fire('click');const total=h.find('[data-bio-tonnage-combined-target]');total.value='737';total.fire('input');assert.equal(one.value,'368.5');assert.equal(one.getAttribute('aria-invalid'),'false');assert.equal(h.field('final-total'),'737.00 t');let saved=JSON.parse([...h.storage.values()][0]);assert.deepEqual(saved.targets,[361.4,361.4]);assert.equal(saved.combinedTarget,737);h.find('[data-bio-tonnage-mode="individual"]').fire('click');assert.equal(one.value,'');assert.equal(one.getAttribute('aria-invalid'),'true');assert.equal(h.field('rate1'),'—');
});
test('a blank global total leaves derived readonly fields empty and restores manual drafts only in individual mode',()=>{
  const h=harness();h.render();const total=h.find('[data-bio-tonnage-combined-target]');total.value='';total.fire('input');for(const unit of ['unit1','unit2']){const input=h.find('[data-bio-tonnage-target="'+unit+'"]');assert.equal(input.value,'');assert.equal(input.placeholder,'—');assert.equal(input.readOnly,true);}assert.equal(h.field('rate1'),'—');h.find('[data-bio-tonnage-mode="individual"]').fire('click');assert.equal(h.find('[data-bio-tonnage-target="unit1"]').value,'361.4');assert.equal(h.field('rate1'),'40.35');h.find('[data-bio-tonnage-mode="combined"]').fire('click');assert.equal(total.value,'');assert.equal(h.find('[data-bio-tonnage-target="unit1"]').value,'');
});
test('odd-cent global targets retain exact three-decimal halves and coherent amount displays',()=>{
  const h=harness();h.r.units.unit1.bio.quantity=16.91;h.r.units.unit2.bio.quantity=6.47;h.render();const total=h.find('[data-bio-tonnage-combined-target]');total.value='737.01';total.fire('input');assert.equal(api.parseQuantity('368.505'),null);for(const unit of ['unit1','unit2'])assert.equal(h.find('[data-bio-tonnage-target="'+unit+'"]').value,'368.505');assert.equal(h.field('need0'),'351.595');assert.equal(h.field('need1'),'362.035');assert.equal(h.field('tail0'),'마감 예상 368.505 t');assert.equal(h.field('tail1'),'마감 예상 368.505 t');assert.equal(h.field('final-total'),'737.010 t');assert.match(h.field('proof'),/1호기 368.505 t \/ 2호기 368.505 t/);assert.deepEqual(JSON.parse([...h.storage.values()][0]).targets,[361.4,361.4]);
});
test('readonly derived inputs preserve identity and focus through source refreshes and unavailable guards',()=>{
  const h=harness();h.render();const total=h.find('[data-bio-tonnage-combined-target]'),one=h.find('[data-bio-tonnage-target="unit1"]');one.focus();one.setSelectionRange(2,2);total.value='737.01';total.fire('input');assert.equal(h.doc.activeElement,one);assert.equal(one.selectionStart,2);assert.equal(one.value,'368.505');const restore=h.guide.retain(h.container);h.cards();h.render();restore();assert.equal(h.find('[data-bio-tonnage-target="unit1"]'),one);assert.equal(h.doc.activeElement,one);assert.equal(one.value,'368.505');h.guide.setQueryState(h.container,{busy:true});assert.equal(h.field('rate0'),'—');h.guide.setQueryState(h.container,{failed:true});assert.equal(h.field('rate1'),'—');h.guide.setQueryState(h.container,{});h.options.now=Date.parse('2026-11-03T00:00:00+09:00');h.render();assert.equal(one.value,'368.505');assert.equal(h.field('rate0'),'—');assert.match(h.field('status'),/^조회일 종료/);
});
test('malformed stored manual precision is never persisted as a null fallback target',()=>{
  const h=harness();h.storage.set('gs-shift-log.cofiring.bio-tonnage.v1',JSON.stringify({targets:[361.405,361.4],combinedTarget:737,mode:'combined'}));h.render();const total=h.find('[data-bio-tonnage-combined-target]');total.value='740';total.fire('input');const stored=JSON.parse([...h.storage.values()][0]);assert.ok(stored.targets.every(value=>typeof value==='number'));assert.equal(stored.targets.includes(null),false);assert.deepEqual(stored.targets,[361.4,361.4]);assert.equal(stored.combinedTarget,740);assert.equal(h.field('final-total'),'740.00 t');
});
