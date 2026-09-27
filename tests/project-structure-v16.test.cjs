'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const modulePath='maintenance/limestone-usage-calculator.js';
const source=fs.readFileSync(path.join(root,modulePath),'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
const main=fs.readFileSync(path.join(root,'script.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const oldHash='ca5a50985126aaf7f1d86479934338bd8ef2d3136b69bbe5c741f9b81489f5bd';
const call='(0, window.GSLimestoneUsageCalculator.install)();';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const response=(value,status=200)=>({ok:status>=200&&status<300,status,text:async()=>typeof value==='string'?value:JSON.stringify(value)});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
class Element{
  constructor(id){this.id=id;this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.dataset={};this.attributes={};this.listeners=new Map();this.children=new Map();this.insertions=[];this.classes=new Set();this.classList={toggle:(k,on)=>{on?this.classes.add(k):this.classes.delete(k);return !!on;},contains:k=>this.classes.has(k)};}
  addEventListener(type,fn){const a=this.listeners.get(type)||[];a.push(fn);this.listeners.set(type,a);}
  setAttribute(k,v){this.attributes[k]=String(v);}
  getAttribute(k){return this.attributes[k]??null;}
  querySelector(s){return this.children.get(s)||null;}
  insertAdjacentHTML(position,html){this.insertions.push({position,html});if(this.onInsert)this.onInsert(html);}
  fire(type){return Promise.all((this.listeners.get(type)||[]).map(fn=>fn.call(this,{type,target:this,currentTarget:this})));}
}
function harness({ready='complete',mobile=false,fetcher,missing=[],generated=false,date='2026-09-26',restore}={}){
  const ids=['efficiencyLimestoneView','limestoneDashboard','limestoneSubviewMenu','limestoneUsageCalculatorView','limestoneUsagePreviousDateButton','limestoneUsageNextDateButton','limestoneUsageTodayButton','limestoneUsageDate','refreshLimestoneUsageReceiptButton','loadLimestoneUsageOisButton','limestoneUsageStatus','limestoneUsageStatusTitle','limestoneUsageStatusDescription','limestoneUsageTotalSummary','limestoneStartDate','refreshLimestoneReceiptsButton','openLimestoneSlipCaptureButton','openLimestoneSlipLibraryButton','openLimestoneReceiptEditorButton'];
  for(const unit of ['One','Two'])for(const name of ['StartStock','Receipt','EndStock','Usage','Summary'])ids.push('limestoneUsageUnit'+unit+name);
  const elements=new Map(ids.map(id=>[id,new Element(id)]));
  const heading=new Element('heading'),eyebrow=new Element('eyebrow'),title=new Element('title'),description=new Element('description'),actions=new Element('actions'),headerActions=new Element('usageHeaderActions'),cameraGuide=new Element('cameraGuide');
  const rows=[new Element('row1'),new Element('row2')];
  const buttons=['receipt','usage'].map(type=>{const b=new Element(type);b.dataset.limestoneSubview=type;return b;});
  actions.children.set('.limestone-slip-camera-guide',cameraGuide);
  for(const id of ['refreshLimestoneReceiptsButton','openLimestoneSlipCaptureButton','openLimestoneSlipLibraryButton','openLimestoneReceiptEditorButton'])actions.children.set('#'+id,elements.get(id));
  elements.get('limestoneUsageCalculatorView').children.set('.limestone-usage-calculator__header-actions',headerActions);
  elements.get('limestoneStartDate').value=date;
  const events=[],requests=[],warnings=[];let reads=0;
  const doc={readyState:ready,getElementById(id){reads++;return elements.get(id)||null;},querySelector(selector){
    reads++;const s=selector.replace(/\s+/g,' ').trim();
    if(s==='[data-limestone-usage-unit="1"]')return rows[0];if(s==='[data-limestone-usage-unit="2"]')return rows[1];
    if(s.endsWith('.limestone-view-heading'))return missing.includes('heading')?null:heading;
    if(s.endsWith('> span'))return eyebrow;if(s.endsWith(' h3'))return title;
    if(s.endsWith('.limestone-view-description'))return description;if(s.endsWith('.limestone-heading-actions'))return actions;
    return null;
  },querySelectorAll(selector){reads++;return selector==='[data-limestone-subview]'&&elements.has('limestoneSubviewMenu')?buttons:[];},addEventListener(...a){events.push(a);}};
  for(const id of missing)elements.delete(id);
  if(generated){
    elements.delete('limestoneSubviewMenu');elements.delete('limestoneUsageCalculatorView');
    const make=html=>{for(const m of html.matchAll(/\bid="([^"]+)"/g))if(!elements.has(m[1]))elements.set(m[1],new Element(m[1]));if(elements.has('limestoneUsageCalculatorView'))elements.get('limestoneUsageCalculatorView').children.set('.limestone-usage-calculator__header-actions',headerActions);};
    heading.onInsert=make;elements.get('limestoneDashboard').onInsert=make;
  }
  const context=vm.createContext({document:doc,Headers,URL,console:{warn:(...x)=>warnings.push(x),error:(...x)=>warnings.push(x)},location:{origin:'https://example.invalid'},
    isLimestoneUsageMobileMonitorMode:()=>mobile,getShiftLogAuthHeaders:()=>({Authorization:'Bearer synthetic-only'}),
    fetch:async(url,options)=>{requests.push({url,options});if(fetcher)return fetcher(url,options,requests.length);throw Error('Unexpected network action');}});
  context.window=context;if(restore)context.loadSavedLimestoneUsageRecords=restore;
  const load=()=>vm.runInContext(source,context,{filename:modulePath});
  const install=()=>vm.runInContext(call,context);
  const get=id=>elements.get(id);
  return {context,doc,elements,events,requests,warnings,load,install,get,heading,buttons,rows,title,actions,headerActions,cameraGuide,get reads(){return reads;}};
}
function boot(options){const h=harness(options);h.load();h.install();return h;}
function fill(h,{start1='',end1='',start2='',end2='',receipts={1:0,2:0}}){
  const date=h.get('limestoneUsageDate').value;
  assert.equal(h.context.setLimestoneUsageSavedReceiptQuantities(date,receipts),true);
  for(const [suffix,value]of Object.entries({OneStartStock:start1,OneEndStock:end1,TwoStartStock:start2,TwoEndStock:end2}))h.get('limestoneUsageUnit'+suffix).value=value;
  return h.get('limestoneUsageUnitOneStartStock').fire('input');
}
test('V16 installer function retains the exact reviewed V15 R2 source hash',()=>{
  const h=harness();h.load();const body=vm.runInContext('GSLimestoneUsageCalculator.install.toString()',h.context);
  assert.equal(hash(body),oldHash);assert.ok(Object.isFrozen(h.context.GSLimestoneUsageCalculator));
});
test('definition alone has no DOM reads, listeners, initialization or requests',()=>{
  const h=harness();h.load();assert.equal(h.reads,0);assert.equal(h.events.length,0);assert.equal(h.requests.length,0);assert.equal(h.context.__limestoneUsageCalculatorFeatureInstalled,undefined);assert.equal(h.context.switchLimestoneSubview,undefined);
});
test('main has one indirect invocation, retains mobile helper, and removes only the private original declaration',()=>{
  assert.equal(main.split(call).length-1,1);assert.doesNotMatch(main,/function installLimestoneUsageCalculatorFeature\(/);
  assert.ok(main.indexOf('function isLimestoneUsageMobileMonitorMode()')<main.indexOf(call));
  assert.ok(main.indexOf(call)<main.indexOf('(0, window.GSEfficiencyDailyWorkExpandedMode.install)();'));
});
test('PC loader chain retains V14/V15 URLs and closedcards and adds the V16 definition before them',()=>{
  const loaders=[...index.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/g)];
  const locate=p=>loaders.map((v,i)=>[v,i]).filter(([v])=>v[1].split('?')[0]===p);
  const a=locate(modulePath),b=locate('maintenance/efficiency-daily-work-expanded-mode.js'),c=locate('maintenance/shift-log-search-matched-items.js'),d=locate('script.js');
  for(const group of [a,b,c,d]){assert.equal(group.length,1);assert.match(group[0][0][0],/\sdefer(?:\s|>)/);assert.doesNotMatch(group[0][0][0],/\s(?:async|type)=?/);}
  assert.equal(a[0][1]+1,b[0][1]);assert.equal(b[0][1]+1,c[0][1]);assert.equal(c[0][1]+1,d[0][1]);
  assert.equal(a[0][0][1],modulePath+'?v=20260927-structure-v16');
  const u=new URL(d[0][0][1].replaceAll('&amp;','&'),'https://fixture.invalid/');
  for(const[k,v]of Object.entries({v:'20260927-structure-v15',limestone:'20260925-v1',closedcards:'20260927-v1',structure16:'20260927-v1'}))assert.deepEqual(u.searchParams.getAll(k),[v]);
});
test('mobile entry does not acquire the PC-only extracted definition',()=>{
  for(const rel of ['mobile-app/index.html','mobile/index.html','mobile-login.html']){const f=path.join(root,rel);if(fs.existsSync(f))assert.ok(!fs.readFileSync(f,'utf8').includes(modulePath));}
});
test('loading document registers one DOMContentLoaded callback, installs public functions immediately',()=>{
  const h=boot({ready:'loading'});assert.equal(h.events.length,1);assert.equal(h.events[0][0],'DOMContentLoaded');assert.equal(h.events[0][2].once,true);
  assert.equal(typeof h.context.switchLimestoneSubview,'function');assert.equal(h.get('limestoneUsageDate').value,'');h.events[0][1]();assert.equal(h.get('limestoneUsageDate').value,'2026-09-26');assert.equal(h.requests.length,0);
});
test('complete document binds existing controls once without a receipt read or write',()=>{
  const h=boot();assert.equal(h.events.length,0);assert.equal(h.get('limestoneUsageDate').value,'2026-09-26');assert.equal(h.get('limestoneSubviewMenu').dataset.limestoneUsageBound,'true');assert.equal(h.requests.length,0);
});
test('reloading definition and repeating install preserve one listener and existing closure state',async()=>{
  const h=boot();await fill(h,{start1:'20',end1:'10',start2:'0',end2:'0',receipts:{1:5,2:0}});
  const setter=h.context.setLimestoneUsageSavedReceiptQuantities;h.load();h.install();
  assert.equal(h.context.setLimestoneUsageSavedReceiptQuantities,setter);assert.equal(h.get('refreshLimestoneUsageReceiptButton').listeners.get('click').length,1);
  await h.get('limestoneUsageUnitOneStartStock').fire('input');assert.equal(h.get('limestoneUsageUnitOneUsage').textContent,'15.00 ton');
});
test('later main exception cannot undo early public registration; earlier exception cannot install',()=>{
  const a=harness({ready:'loading'});a.load();assert.throws(()=>vm.runInContext(call+'throw Error("later");',a.context));assert.equal(a.events.length,1);
  const b=harness();b.load();assert.throws(()=>vm.runInContext('throw Error("earlier");'+call,b.context));assert.equal(b.events.length,0);assert.equal(b.context.switchLimestoneSubview,undefined);
});
test('installation precedes microtasks queued by main',async()=>{
  const h=harness({ready:'loading'});h.load();vm.runInContext('Promise.resolve().then(()=>window.observedInstalled=!!window.switchLimestoneSubview);'+call,h.context);await settle();assert.equal(h.context.observedInstalled,true);
});
for(const missing of ['efficiencyLimestoneView','limestoneDashboard','heading'])test('missing required '+missing+' keeps installer harmless and still exposes original hooks',()=>{
  const h=boot({missing:[missing]});assert.equal(h.requests.length,0);assert.equal(typeof h.context.loadLimestoneUsageReceiptQuantities,'function');assert.equal(h.heading.insertions.length,0);
});
test('missing calculator markup is generated once with original TAGs and accessible tabs',()=>{
  const h=boot({generated:true});assert.equal(h.heading.insertions.length,1);assert.equal(h.get('limestoneDashboard').insertions.length,1);
  const html=h.heading.insertions[0].html+h.get('limestoneDashboard').insertions[0].html;
  assert.match(html,/role="tablist"/);assert.match(html,/103HRJ01CW201XQ01/);assert.match(html,/203HRJ01CW201XQ01/);h.install();assert.equal(h.heading.insertions.length,1);
});
const numericCases=[
 ['normal',{start1:'100',end1:'30',start2:'40',end2:'5',receipts:{1:10,2:3}},'80.00 ton','38.00 ton','118.00',false],
 ['all explicit zero',{start1:'0',end1:'0',start2:'0',end2:'0'},'0.00 ton','0.00 ton','0.00',false],
 ['blank start',{start1:'',end1:'0',start2:'0',end2:'0'},'-','0.00 ton','-',false],
 ['blank end',{start1:'1',end1:' ',start2:'0',end2:'0'},'-','0.00 ton','-',false],
 ['invalid text',{start1:'abc',end1:'0',start2:'0',end2:'0'},'-','0.00 ton','-',false],
 ['nonfinite',{start1:'Infinity',end1:'0',start2:'0',end2:'0'},'-','0.00 ton','-',false],
 ['comma stock',{start1:' 1,000 ',end1:'100',start2:'0',end2:'0'},'900.00 ton','0.00 ton','900.00',false],
 ['truncation',{start1:'331.179',end1:'0',start2:'0',end2:'0'},'331.17 ton','0.00 ton','331.17',false],
 ['negative use',{start1:'0',end1:'10',start2:'0',end2:'0'},'-10.00 ton','0.00 ton','-10.00',true],
 ['one incomplete unit',{start1:'10',end1:'0',start2:'0',end2:''},'10.00 ton','-','-',false],
 ['independent receipts',{start1:'0',end1:'0',start2:'0',end2:'0',receipts:{1:1.25,2:2.5}},'1.25 ton','2.50 ton','3.75',false],
 ['legacy floating-point truncation',{start1:'10.12',end1:'0',start2:'0',end2:'0'},'10.11 ton','0.00 ton','10.11',false],
 ['negative truncation',{start1:'-1.239',end1:'0',start2:'0',end2:'0'},'-1.23 ton','0.00 ton','-1.23',true]
];
for(const [name,input,one,two,total,negative]of numericCases)test('original numeric/display behavior: '+name,async()=>{
  const h=boot();await fill(h,input);assert.equal(h.get('limestoneUsageUnitOneUsage').textContent,one);assert.equal(h.get('limestoneUsageUnitTwoUsage').textContent,two);assert.equal(h.get('limestoneUsageTotalSummary').textContent,total);assert.equal(h.rows[0].classes.has('is-negative'),negative);
});
test('saved receipt setter rejects another date without overwriting current receipts',async()=>{
  const h=boot();await fill(h,{start1:'0',end1:'0',start2:'0',end2:'0',receipts:{1:3,2:5}});assert.equal(h.context.setLimestoneUsageSavedReceiptQuantities('2026-09-25',{1:999,2:999}),false);await h.get('limestoneUsageUnitOneStartStock').fire('change');assert.equal(h.get('limestoneUsageTotalSummary').textContent,'8.00');
});
for(const [date,button,wanted]of [['2026-09-30','Next','2026-10-01'],['2026-01-01','Previous','2025-12-31'],['2024-02-28','Next','2024-02-29'],['2024-03-01','Previous','2024-02-29']])test('date navigation '+date+' '+button+' does not enqueue or save',async()=>{
  const h=boot({date});await h.get('limestoneUsage'+button+'DateButton').fire('click');await settle();assert.equal(h.get('limestoneUsageDate').value,wanted);assert.equal(h.requests.length,0);
});
test('changing date clears old input before restoring the selected saved record',async()=>{
  const calls=[];const h=boot({restore:async(d,o)=>{calls.push({d,o});assert.equal(h.get('limestoneUsageUnitOneStartStock').value,'');return false;}});
  await fill(h,{start1:'1',end1:'0',start2:'0',end2:'0'});h.get('limestoneUsageDate').value='2026-09-25';await h.get('limestoneUsageDate').fire('change');await settle();
  assert.equal(calls.length,1);assert.equal(calls[0].d,'2026-09-25');assert.equal(calls[0].o.requireActiveUsageDate,true);assert.equal(calls[0].o.isCurrentUsageRequest(),true);assert.equal(h.requests.length,0);assert.equal(h.get('limestoneUsageTotalSummary').textContent,'-');
});
test('late saved-date responses lose the original date guard and cannot report an obsolete failure',async()=>{
  const pending=deferred(),calls=[];const h=boot({restore:(d,o)=>{calls.push({d,o});return d==='2026-09-25'?pending.promise:Promise.resolve(false);}});
  h.get('limestoneUsageDate').value='2026-09-25';await h.get('limestoneUsageDate').fire('change');await settle();
  h.get('limestoneUsageDate').value='2026-09-24';await h.get('limestoneUsageDate').fire('change');await settle();assert.equal(calls[0].o.isCurrentUsageRequest(),false);
  pending.reject(Error('old date failed'));await settle();assert.equal(h.get('limestoneUsageCalculatorView').dataset.limestoneUsageStatus,'idle');assert.doesNotMatch(h.get('limestoneUsageStatusDescription').textContent,/old date/);
});
for(const mobile of [false,true])test('usage navigation retains original '+(mobile?'mobile monitoring':'desktop')+' visibility and tab state',async()=>{
  const h=boot({mobile});h.context.switchLimestoneSubview('usage');await settle();assert.equal(h.get('limestoneDashboard').hidden,true);assert.equal(h.get('limestoneUsageCalculatorView').hidden,false);
  assert.equal(h.get('refreshLimestoneUsageReceiptButton').hidden,mobile);assert.equal(h.get('loadLimestoneUsageOisButton').hidden,mobile);assert.equal(h.headerActions.hidden,mobile);assert.equal(h.buttons[1].attributes['aria-selected'],'true');assert.equal(h.buttons[1].tabIndex,0);
  h.context.switchLimestoneSubview('receipt');assert.equal(h.get('limestoneDashboard').hidden,false);assert.equal(h.get('limestoneUsageCalculatorView').hidden,true);assert.equal(h.requests.length,0);
});
test('one explicit receipt refresh uses selected-day authenticated GET then one unchanged sync_usage POST',async()=>{
  const h=boot({fetcher:async(u,o)=>o.method==='GET'?response({items:[{receiptDate:'2026-09-26',unitNo:1,quantityTon:10.12},{receipt_date:'2026-09-26',unit_no:2,quantity_ton:5.25},{receiptDate:'2026-09-25',unitNo:1,quantityTon:999},{receiptDate:'2026-09-26',unitNo:3,quantityTon:999}]}):response({ok:true,updatedCount:2})});
  await h.context.loadLimestoneUsageReceiptQuantities();assert.equal(h.requests.length,2);
  const [get,post]=h.requests;const url=new URL(get.url);assert.equal(url.pathname,'/api/limestone-receipts');assert.equal(url.searchParams.get('startDate'),'2026-09-26');assert.equal(url.searchParams.get('endDate'),'2026-09-26');assert.equal(get.options.headers.Authorization,'Bearer synthetic-only');
  assert.equal(post.url,'/api/limestone-receipts');assert.equal(post.options.method,'POST');assert.deepEqual(JSON.parse(post.options.body),{action:'sync_usage',usageDate:'2026-09-26'});assert.equal(post.options.headers.get('Authorization'),'Bearer synthetic-only');
  assert.equal(h.get('limestoneUsageUnitOneReceipt').textContent,'10.11 ton' /* existing floating-point truncation, not a V16 correction */);assert.equal(h.get('limestoneUsageUnitTwoReceipt').textContent,'5.25 ton');assert.match(h.get('limestoneUsageStatusDescription').textContent,/2건 저장 완료/);assert.equal(h.get('refreshLimestoneUsageReceiptButton').disabled,false);
});
for(const [name,result,status]of [['HTTP failure',{message:'denied'},403],['malformed JSON','<html>',200],['explicit service failure',{success:false},200]])test('receipt '+name+' retains the original failure state without POST',async()=>{
  const h=boot({fetcher:async()=>response(result,status)});await h.context.loadLimestoneUsageReceiptQuantities();assert.equal(h.requests.length,1);assert.equal(h.get('limestoneUsageCalculatorView').dataset.limestoneUsageStatus,'error');assert.equal(h.get('refreshLimestoneUsageReceiptButton').disabled,false);
});
test('failed sync_usage is visible without discarding fetched receipts or retrying POST',async()=>{
  const h=boot({fetcher:async(u,o)=>o.method==='GET'?response({data:{items:[{receiptDate:'2026-09-26',unitNo:1,quantityTon:12}]}}):response({ok:false,message:'write failed'},503)});await h.context.loadLimestoneUsageReceiptQuantities();assert.equal(h.requests.length,2);assert.equal(h.get('limestoneUsageUnitOneReceipt').textContent,'12.00 ton');assert.match(h.get('limestoneUsageStatusDescription').textContent,/사용량 저장 실패: write failed/);
});
test('manual protected sync result retains its existing operator message',async()=>{
  const h=boot({fetcher:async(u,o)=>o.method==='GET'?response({items:[]}):response({ok:true,manualProtectedCount:1})});await h.context.loadLimestoneUsageReceiptQuantities();assert.match(h.get('limestoneUsageStatusDescription').textContent,/수동 보정값 보호/);
});
test('receipt response arriving after date change cannot update the new day or issue sync_usage',async()=>{
  const pending=deferred();const h=boot({fetcher:()=>pending.promise});const run=h.context.loadLimestoneUsageReceiptQuantities();h.get('limestoneUsageDate').value='2026-09-25';await h.get('limestoneUsageDate').fire('change');await settle();pending.resolve(response({items:[{receiptDate:'2026-09-26',unitNo:1,quantityTon:999}]}));await run;
  assert.equal(h.requests.length,1);assert.equal(h.get('limestoneUsageDate').value,'2026-09-25');assert.equal(h.get('limestoneUsageUnitOneReceipt').textContent,'0.00 ton');
});
test('superseded receipt request cannot unlock or replace the newer request',async()=>{
  const first=deferred(),second=deferred();let gets=0;const h=boot({fetcher:(u,o)=>o.method==='POST'?response({ok:true}):(++gets===1?first.promise:second.promise)});
  const a=h.context.loadLimestoneUsageReceiptQuantities(),b=h.context.loadLimestoneUsageReceiptQuantities();first.resolve(response({items:[]}));await a;assert.equal(h.get('refreshLimestoneUsageReceiptButton').disabled,true);assert.equal(h.requests.length,2);
  second.resolve(response({items:[]}));await b;assert.equal(h.get('refreshLimestoneUsageReceiptButton').disabled,false);assert.equal(h.requests.length,3);
});
test('blank selected date with no fallback is rejected by the original public setter and never overwrites receipts',()=>{
  const h=boot();assert.equal(h.context.setLimestoneUsageSavedReceiptQuantities('',{1:9,2:9}),false);assert.equal(h.requests.length,0);
});

test('extracted installer resolves a function declared later in the same main execution',async()=>{
  const h=harness({fetcher:async()=>response({items:[]})});h.load();
  vm.runInContext(call+'function getShiftLogAuthHeaders(){return {Authorization:"Bearer later-main-synthetic"};}',h.context);
  await h.context.loadLimestoneUsageReceiptQuantities();
  assert.equal(h.requests.length,2);assert.equal(h.requests[0].options.headers.Authorization,'Bearer later-main-synthetic');
  assert.equal(h.requests[1].options.headers.get('Authorization'),'Bearer later-main-synthetic');
});
