'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const coordinator = read('maintenance/morning-meeting-query-sources.js');
const steamProvider = read('maintenance/morning-meeting-steam-ois-probe-v1.js');
const mainScript = read('script.js');
const DATE = '2026-10-01';
const ALL = 'morningMeetingAllQueryButton';
const STEAM_BUTTON = 'efficiencyMorningMeetingAutoSteamRefreshButton';
const STEAM_BADGE = 'morningMeetingQuerySourceStatus-steam';
const tick = () => new Promise(resolve => setImmediate(resolve));
const plain = v => JSON.parse(JSON.stringify(v));
function deferred() { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise,resolve,reject}; }
async function until(check) { for(let i=0;i<50;i++){if(check()) return; await tick();} assert.ok(check(), 'expected async stage was not reached'); }
function operationsResult() { return ['water','limestone','gear-pinion','silo-level','smp-price','weather'].map(key => ({status:'fulfilled',value:{key,status:'fulfilled',result:{value:0}}})); }
function completedSteam(overrides={}) { return {sourceDate:DATE,targetDate:DATE,requestType:'steam_status',requestId:'steam-fixture-1',
  unitOneProduction:6488.069,unitTwoProduction:6435.695,totalProduction:12923.764,
  steamSalesLowPressure:null,steamSalesHighPressure:null,steamSales:null,
  productionComplete:true,salesComplete:false,complete:false,...overrides}; }

class Element {
  constructor(tag='div') {
    this.tagName=tag.toUpperCase(); this.id=''; this.className=''; this.dataset={}; this.children=[]; this.parentElement=null;
    this.attributes=new Map(); this.listeners=new Map(); this.style={}; this._text=''; this.hidden=false; this.value=''; this.title='';
    if(['BUTTON','INPUT'].includes(this.tagName)) this.disabled=false;
    const update=(value,force)=>{ const names=new Set(this.className.split(/\s+/).filter(Boolean));
      const use=force===undefined?!names.has(value):force; if(use) names.add(value); else names.delete(value); this.className=[...names].join(' '); return use; };
    this.classList={contains:v=>this.className.split(/\s+/).includes(v), toggle:update,
      add:(...v)=>v.forEach(x=>update(x,true)),remove:(...v)=>v.forEach(x=>update(x,false))};
  }
  get textContent(){return this._text+this.children.map(x=>x.textContent).join('');}
  set textContent(v){this._text=String(v); for(const x of this.children)x.parentElement=null; this.children=[];}
  get firstChild(){return this.children[0]||null;}
  get nextSibling(){return this.parentElement?.children[this.parentElement.children.indexOf(this)+1]||null;}
  get isConnected(){return this.tagName==='BODY'||Boolean(this.parentElement?.isConnected);}
  append(...nodes){for(const n of nodes)this.insertBefore(n,null);}
  appendChild(n){return this.insertBefore(n,null);}
  insertBefore(n,b){if(n.parentElement)n.parentElement.children.splice(n.parentElement.children.indexOf(n),1); n.parentElement=this;
    const i=b?this.children.indexOf(b):-1; if(i>=0)this.children.splice(i,0,n);else this.children.push(n);return n;}
  matches(s){ if(s.includes(','))return s.split(',').some(p=>this.matches(p.trim()));
    if(s[0]==='#')return this.id===s.slice(1); if(s[0]==='.')return this.classList.contains(s.slice(1));
    if(s[0]==='[')return this.attributes.has(s.slice(1,-1)); return this.tagName.toLowerCase()===s; }
  querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  closest(s){return this.matches(s)?this:this.parentElement?.closest(s)||null;}
  setAttribute(k,v){this.attributes.set(k,String(v));}
  getAttribute(k){return this.attributes.get(k)??null;}
  removeAttribute(k){this.attributes.delete(k);}
  addEventListener(k,fn,options){const a=this.listeners.get(k)||[]; a.push({fn,capture:options===true||options?.capture===true});this.listeners.set(k,a);}
  removeEventListener(k,fn){this.listeners.set(k,(this.listeners.get(k)||[]).filter(x=>x.fn!==fn));}
  dispatchEvent(e){if(!e.target)e.target=this; for(const {fn} of this.listeners.get(e.type)||[])fn(e); return true;}
  click(){if(this.disabled||this.hidden)return; const e={type:'click',target:this,stopped:false,immediate:false,
    preventDefault(){},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.immediate=true;this.stopped=true;}};
    let doc=this;while(doc.parentElement)doc=doc.parentElement;
    for(const {fn,capture} of doc.listeners.get('click')||[]){if(capture)fn(e);if(e.immediate)return;}
    for(const {fn} of this.listeners.get('click')||[]){fn(e);if(e.immediate)return;}
    if(!e.stopped)for(const {fn,capture} of doc.listeners.get('click')||[])if(!capture)fn(e);
  }
}

async function harness(t, {realProvider=false, realOperations=false, resetActive=false}={}) {
  const document=new Element('body'); document.readyState='complete'; document.documentElement=document; document.body=document;
  document.createElement=tag=>new Element(tag); document.getElementById=id=>document.querySelector('#'+id);
  const make=(id,tag='div',parent=document,cls='')=>{const n=new Element(tag);n.id=id;n.className=cls;parent.append(n);return n;};
  const panel=make('efficiencyMorningMeetingWaterPanel');panel.dataset.morningMeetingAutoBaseDate=DATE;
  const preview=make('efficiencyMorningMeetingAutoPreview','div',panel);
  const grid=make('grid','div',preview,'efficiency-morning-meeting-auto-preview__grid');
  make('dateBar','div',grid,'efficiency-morning-meeting-auto-common-date');
  for(const id of ['efficiencyMorningMeetingAutoDailyPowerCard','efficiencyMorningMeetingAutoSteamCard','efficiencyMorningMeetingAutoCofiringCard','efficiencyMorningMeetingAutoDailySludgeCard'])make(id,'div',grid);
  const steamCard=document.getElementById('efficiencyMorningMeetingAutoSteamCard');
  for(const id of ['efficiencyMorningMeetingAutoSteamDate','efficiencyMorningMeetingAutoSteamStatus',
    'efficiencyMorningMeetingAutoDailySteamSalesLowPressure','efficiencyMorningMeetingAutoDailySteamSalesHighPressure','efficiencyMorningMeetingAutoSteamSales',
    'efficiencyMorningMeetingAutoSteamProductionUnitOne','efficiencyMorningMeetingAutoSteamProductionUnitTwo','efficiencyMorningMeetingAutoSteamProductionTotal'])make(id,'span',steamCard);
  make(STEAM_BUTTON,'button',steamCard);
  for(const id of ['loadEfficiencyMorningMeetingWaterButton','efficiencyMorningMeetingAutoRetry-water','efficiencyMorningMeetingAutoRetry-limestone',
    'efficiencyMorningMeetingAutoRetry-gear-pinion','efficiencyMorningMeetingAutoRetry-silo-level','efficiencyMorningMeetingAutoSmpRefreshButton',
    'efficiencyMorningMeetingAutoWeatherRefreshButton','efficiencyMorningMeetingAutoDailyPowerRefreshButton','resetEfficiencyMorningMeetingButton',
    'efficiencyMorningMeetingWorkDatePreviousButton','efficiencyMorningMeetingWorkDateNextButton','efficiencyMorningMeetingWorkDateTodayButton'])make(id,'button',preview);
  make('efficiencyMorningMeetingAutoDatePicker','input',preview).value=DATE;
  make('efficiencyMorningMeetingAutoPreviewStatus','span',preview);
  for(const id of ['efficiencyMorningMeetingAutoWaterStatus','efficiencyMorningMeetingAutoLimestoneStatus','efficiencyMorningMeetingAutoGearPinionStatus','efficiencyMorningMeetingAutoSiloStatus']) {
    const row=make(id+'-row','div',preview,'efficiency-morning-meeting-auto-card__status-actions'); make(id,'span',row);
  }
  const timers=new Set(), calls=[],messages=[],logs=[],net=[],behavior={};let token='test-only',mobile=false;
  const later=(fn,ms=0)=>{const id=setTimeout(()=>{timers.delete(id);fn();},ms===1500?1:ms);timers.add(id);return id;};
  const window={navigator:{userAgent:'Windows',platform:'Win32',maxTouchPoints:0},location:{origin:'https://example.invalid'},
    matchMedia:()=>({matches:mobile}),setTimeout:later,clearTimeout:id=>{clearTimeout(id);timers.delete(id);},addEventListener(){},
    efficiencyMorningMeetingUploadState:{},showToast:m=>messages.push(m),alert:m=>messages.push(m),getShiftLogAuthHeaders:()=>({Authorization:'Bearer test-only'}),
    persistEfficiencyMorningMeetingFreshSmpAfterReset:async()=>true,refreshEfficiencyMorningMeetingAutoHistory:async()=>true};
  const response=p=>({ok:true,status:200,text:async()=>JSON.stringify(p),json:async()=>p});
  const fetch=async(raw,options={})=>{
    const url=new URL(raw,window.location.origin), body=options.body?JSON.parse(options.body):null;
    net.push({path:url.pathname,query:Object.fromEntries(url.searchParams),method:options.method||'GET',body});
    if(url.searchParams.get('action')==='morning_meeting_auto_history_reset_status')
      return response({ok:true,item:{targetDate:url.searchParams.get('targetDate'),active:resetActive,revision:1}});
    if(body?.action==='release_morning_meeting_auto_history_reset'){
      resetActive=false;return response({ok:true,item:{targetDate:body.targetDate,active:false,revision:2}});
    }
    if(body?.requestType==='steam_status'){
      calls.push('steam-post'); if(behavior.create)await behavior.create(body);
      return response({ok:true,item:{id:'steam-fixture-1',requestType:'steam_status'}});
    }
    if(url.searchParams.get('id')){
      calls.push('steam-poll');if(behavior.poll)return response(await behavior.poll());
      return response({ok:true,item:{id:'steam-fixture-1',targetDate:DATE,status:'complete',result:completedSteam()}});
    }
    throw Error('Unexpected fixture request: '+url.href);
  };
  window.fetch=fetch;
  window.runEfficiencyMorningMeetingBulkLookup=options=>{calls.push('operations');return behavior.operations?behavior.operations(options):Promise.resolve(operationsResult());};
  window.toNightPower={refreshMeeting:()=>{calls.push('power');return behavior.power?behavior.power():Promise.resolve({ok:true});}};
  window.morningMeetingClosedCofiring={refreshOrganicFromClosing:()=>{calls.push('closed');return behavior.closed?behavior.closed():Promise.resolve({ok:true});}};
  window.loadEfficiencyMorningMeetingSteamOis=options=>{calls.push('steam');return behavior.steam?behavior.steam(options):Promise.resolve(completedSteam());};
  const consoleMock={info:(...v)=>logs.push(v),log:(...v)=>logs.push(v),warn:(...v)=>logs.push(v),error:(...v)=>logs.push(v)};
  const ctx=vm.createContext({window,document,fetch,Element,URL,URLSearchParams,Date,Map,Set,Promise,console:consoleMock,
    CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail;}},
    MutationObserver:class{constructor(fn){this.fn=fn;}observe(){}disconnect(){}},getShiftLogSessionToken:()=>token});
  if(realOperations){
    const names={water:'loadEfficiencyMorningMeetingWaterTreatment',limestone:'loadLimestoneOisStock',
      'gear-pinion':'loadEfficiencyMorningMeetingGearPinion','silo-level':'loadEfficiencyMorningMeetingSiloLevel',
      'smp-price':'loadEfficiencyMorningMeetingSmpPrice',weather:'loadEfficiencyMorningMeetingWeather'};
    for(const [key,name] of Object.entries(names))window[name]=async opts=>{calls.push(key);if(behavior[key])return behavior[key](opts);return {targetDate:DATE,sourceDate:DATE,value:0};};
    const a=mainScript.indexOf('(function installMorningMeetingAutoRetryButtons()');
    const b=mainScript.indexOf('\n})();',a);assert.ok(a>=0&&b>a);
    vm.runInContext(mainScript.slice(a,b+7),ctx,{filename:'actual-bulk-module.js'});
  }
  if(realProvider)vm.runInContext(steamProvider,ctx,{filename:'actual-steam-provider.js'});
  vm.runInContext(coordinator,ctx,{filename:'actual-query-controller.js'});
  await window.morningMeetingQuerySources.loadResetStatus(DATE);
  await tick();
  t.after(()=>{for(const id of timers)clearTimeout(id);});
  return {window,document,panel,behavior,calls,net,messages,logs,ctx,byId:document.getElementById,
    api:window.morningMeetingQuerySources,signedIn:v=>{token=v;},mobile:v=>{mobile=v;}};
}

test('toolbar click starts steam exactly once after operations and awaits its actual completion',async t=>{
  const h=await harness(t), ops=deferred(), steam=deferred();
  h.behavior.operations=()=>ops.promise;h.behavior.steam=opts=>{assert.equal(opts.targetDate,DATE);return steam.promise;};
  h.byId(ALL).click();await tick();
  assert.equal(h.api.isBusy(),true);assert.equal(h.calls.filter(x=>x==='steam').length,0);
  assert.equal(h.byId(STEAM_BADGE).textContent,'순서 대기');
  assert.ok(h.calls.includes('power')&&h.calls.includes('closed'));
  ops.resolve(operationsResult());await until(()=>h.calls.includes('steam'));
  assert.equal(h.byId(ALL).textContent,'증기 조회 중…');
  assert.equal(h.byId(ALL).disabled,true);assert.equal(h.byId(STEAM_BADGE).textContent,'조회 중');
  assert.equal(await h.api.query('all',{userInitiated:true}),null);
  steam.resolve(completedSteam());await until(()=>!h.api.isBusy());
  assert.equal(h.calls.filter(x=>x==='steam').length,1);assert.equal(h.byId(STEAM_BADGE).textContent,'조회 완료');
  assert.equal(h.byId(ALL).textContent,'전체자료');assert.equal(h.byId(ALL).disabled,false);
});

test('missing steam function cannot resolve as successful undefined',async t=>{
  const h=await harness(t);delete h.window.loadEfficiencyMorningMeetingSteamOis;
  const result=await h.api.query('all',{userInitiated:true});
  assert.equal(result.find(r=>r.source==='steam').status,'rejected');
  assert.equal(h.byId(STEAM_BADGE).textContent,'조회 실패');
  assert.ok(h.messages.some(m=>m.includes('로드되지')));
});

for(const value of [undefined,null,false])test('empty steam completion is rejected: '+String(value),async t=>{
  const h=await harness(t);h.behavior.steam=()=>Promise.resolve(value);
  const result=await h.api.query('all',{userInitiated:true});assert.equal(result.find(r=>r.source==='steam').status,'rejected');
  assert.equal(h.byId(STEAM_BADGE).textContent,'조회 실패');
});

test('fire-and-forget/non-promise loader cannot be mistaken for waited completion',async t=>{
  const h=await harness(t);h.behavior.steam=()=>completedSteam();
  const result=await h.api.query('all',{userInitiated:true});assert.equal(result.find(r=>r.source==='steam').status,'rejected');
});

test('operations-only mode never starts the steam, power or closing providers',async t=>{
  const h=await harness(t);const value=await h.api.query('operations',{userInitiated:true});
  assert.equal(value.length,6);assert.deepEqual(h.calls,['operations']);assert.equal(h.byId(STEAM_BADGE).textContent,'조회 전');
});

test('an operations rejection still permits the awaited steam stage',async t=>{
  const h=await harness(t);h.behavior.operations=()=>{throw Error('operations fixture error');};
  const result=await h.api.query('all',{userInitiated:true});
  assert.equal(result.find(r=>r.source==='operations').status,'rejected');assert.equal(result.find(r=>r.source==='steam').status,'fulfilled');
  assert.equal(h.calls.filter(x=>x==='steam').length,1);
});

test('steam rejection ends with visible failure instead of success and releases the all-button lock',async t=>{
  const h=await harness(t);h.behavior.steam=()=>Promise.reject(Error('steam request fixture error'));
  const result=await h.api.query('all',{userInitiated:true});assert.equal(result.find(r=>r.source==='steam').status,'rejected');
  assert.equal(h.api.isBusy(),false);assert.equal(h.byId(STEAM_BADGE).textContent,'조회 실패');assert.equal(h.byId(ALL).disabled,false);
});

test('source-date change during operations never starts steam for another day',async t=>{
  const h=await harness(t),ops=deferred();h.behavior.operations=()=>ops.promise;
  const pending=h.api.query('all',{userInitiated:true});h.panel.dataset.morningMeetingAutoBaseDate='2026-10-02';
  ops.resolve(operationsResult());const results=await pending;
  assert.equal(h.calls.includes('steam'),false);assert.equal(results.find(x=>x.source==='steam').status,'rejected');
  assert.equal(h.byId(STEAM_BADGE).textContent,'조회 전');
});

test('completion for wrong date or wrong request type is not accepted',async t=>{
  for(const change of [{sourceDate:'2026-09-30'},{requestType:'other'},{requestId:''}]){
    const h=await harness(t);h.behavior.steam=()=>Promise.resolve(completedSteam(change));
    const results=await h.api.query('all',{userInitiated:true});assert.equal(results.find(x=>x.source==='steam').status,'rejected');
  }
});

test('blank upstream sales remain null and are accepted as finished query without retry',async t=>{
  const h=await harness(t,{realProvider:true}),poll=deferred();h.behavior.poll=()=>poll.promise;
  const pending=h.api.query('all',{userInitiated:true});await until(()=>h.calls.includes('steam-poll'));
  assert.equal(h.api.isBusy(),true);assert.equal(h.byId(STEAM_BADGE).textContent,'조회 중');
  poll.resolve({ok:true,item:{id:'steam-fixture-1',targetDate:DATE,status:'complete',result:completedSteam()}});
  const results=await pending;const value=results.find(r=>r.source==='steam').value;
  assert.equal(value.steamSales,null);assert.equal(value.complete,false);assert.equal(value.totalProduction,12923.764);
  assert.equal(h.byId('efficiencyMorningMeetingAutoSteamSales').textContent,'-');
  assert.equal(h.byId('efficiencyMorningMeetingAutoSteamStatus').textContent,'OIS 일부 완료');
  assert.equal(h.byId(STEAM_BADGE).textContent,'조회 완료');
  assert.equal(h.net.filter(x=>x.body?.requestType==='steam_status').length,1);
  assert.equal(h.net.some(x=>x.body?.requestType==='daily_data_excel'),false);
});

test('all mode and direct individual refresh share the actual steam provider in-flight request',async t=>{
  const h=await harness(t,{realProvider:true}),ops=deferred(),poll=deferred();
  h.behavior.operations=()=>ops.promise;h.behavior.poll=()=>poll.promise;
  const pending=h.api.query('all',{userInitiated:true});
  // Simulate an existing individual query finishing while the operating lane settles.
  const individual=h.window.loadEfficiencyMorningMeetingSteamOis({userInitiated:true});
  await until(()=>h.calls.includes('steam-poll'));ops.resolve(operationsResult());await tick();
  poll.resolve({ok:true,item:{id:'steam-fixture-1',targetDate:DATE,status:'complete',result:completedSteam()}});
  await Promise.all([pending,individual]);assert.equal(h.net.filter(x=>x.body?.requestType==='steam_status').length,1);
});

test('full actual operating module precedes the actual steam POST',async t=>{
  const h=await harness(t,{realProvider:true,realOperations:true});
  const result=await h.api.query('all',{userInitiated:true});
  assert.equal(result.find(x=>x.source==='operations').status,'fulfilled');
  assert.equal(result.find(x=>x.source==='steam').status,'fulfilled');
  for(const key of ['water','limestone','gear-pinion','silo-level']){
    assert.ok(h.calls.includes(key),key+' ran');assert.ok(h.calls.indexOf(key)<h.calls.indexOf('steam-post'),key+' before steam');
  }
  assert.equal(h.net.filter(x=>x.body?.requestType==='steam_status').length,1);
});

test('original all-zero readings remain valid completed results',async t=>{
  const h=await harness(t,{realProvider:true});h.behavior.poll=async()=>({ok:true,item:{id:'steam-fixture-1',targetDate:DATE,status:'complete',result:completedSteam({
    unitOneProduction:0,unitTwoProduction:0,totalProduction:0,steamSalesLowPressure:0,steamSalesHighPressure:0,steamSales:0,salesComplete:true,complete:true})}});
  const results=await h.api.query('all',{userInitiated:true});assert.equal(results.find(r=>r.source==='steam').value.steamSales,0);
  assert.equal(h.byId('efficiencyMorningMeetingAutoSteamSales').textContent,'0 ton');
});

test('missing steam prevents release of reset while legitimate partial steam permits release',async t=>{
  for(const missing of [true,false]){
    const h=await harness(t,{resetActive:true});if(missing)delete h.window.loadEfficiencyMorningMeetingSteamOis;
    await h.api.query('all',{userInitiated:true});
    assert.equal(h.net.some(x=>x.body?.action==='release_morning_meeting_auto_history_reset'),!missing);
  }
});

test('repeated fresh all clicks make exactly one steam request per completed run',async t=>{
  const h=await harness(t,{realProvider:true});const first=await h.api.query('all',{userInitiated:true});const second=await h.api.query('all',{userInitiated:true});
  assert.equal(first.find(x=>x.source==='steam').status,'fulfilled');assert.equal(second.find(x=>x.source==='steam').status,'fulfilled');
  assert.equal(h.net.filter(x=>x.body?.requestType==='steam_status').length,2);
});

test('automatic, logged-out and mobile entry points cannot start all queries',async t=>{
  const h=await harness(t);assert.equal(await h.api.query('all'),null);
  h.signedIn('');assert.equal(await h.api.query('all',{userInitiated:true}),null);
  h.signedIn('test-only');h.mobile(true);assert.equal(await h.api.query('all',{userInitiated:true}),null);assert.deepEqual(h.calls,[]);
});

test('trace records actual request completion before all-settled without measurement data',async t=>{
  const h=await harness(t);await h.api.query('all',{userInitiated:true});const trace=plain(h.window.__morningMeetingAllSteamLastRun);
  const names=trace.events.map(x=>x.event);assert.ok(names.indexOf('steam-complete')<names.indexOf('all-settled'));
  assert.equal(trace.events.find(x=>x.event==='steam-complete').requestId,'steam-fixture-1');
  assert.equal(JSON.stringify(trace).includes('Authorization'),false);assert.equal(JSON.stringify(trace).includes('12923'),false);
});

// V2 reset compatibility cases. A missing required provider must remain an
// error; the two operation-isolation fixtures must not weaken this contract.
const RELEASE = 'release_morning_meeting_auto_history_reset';
const releases = h => h.net.filter(x => x.body?.action === RELEASE);

test('active reset waits for delayed steam even after every operation has completed', async t => {
  const h = await harness(t, { resetActive: true });
  const steam = deferred();
  h.behavior.steam = () => steam.promise;
  const pending = h.api.query('all', { userInitiated: true });
  await until(() => h.calls.includes('steam'));
  assert.equal(releases(h).length, 0);
  assert.equal(h.api.resetState(DATE).active, true);
  assert.equal(h.api.isBusy(), true);
  steam.resolve(completedSteam());
  await pending;
  assert.equal(releases(h).length, 1);
  assert.equal(h.api.resetState(DATE).active, false);
});

for (const key of ['water', 'limestone', 'gear-pinion', 'silo-level']) {
  test(`valid completed steam cannot release reset after unverified ${key} completion`, async t => {
    const h = await harness(t, { resetActive: true });
    h.behavior.operations = async () => {
      const values = operationsResult();
      values.find(x => x.value.key === key).value.result = undefined;
      return values;
    };
    const results = await h.api.query('all', { userInitiated: true });
    assert.equal(results.find(x => x.source === 'steam').status, 'fulfilled');
    assert.equal(releases(h).length, 0);
    assert.equal(h.api.resetState(DATE).active, true);
  });
}

for (const [name, loader] of [
  ['undefined result', async () => undefined],
  ['null result', async () => null],
  ['wrong date', async () => completedSteam({sourceDate: '2026-09-30'})],
  ['missing request id', async () => completedSteam({requestId: ''})],
  ['rejected request', async () => {throw Error('fixture-steam-request-failed');}]
]) {
  test(`verified operations cannot release reset after ${name}`, async t => {
    const h = await harness(t, {resetActive: true});
    h.behavior.steam = loader;
    const results = await h.api.query('all', {userInitiated: true});
    assert.equal(results.find(x => x.source === 'steam').status, 'rejected');
    assert.equal(releases(h).length, 0);
    assert.equal(h.api.resetState(DATE).active, true);
  });
}

test('actual operating lane and actual steam provider release reset after partial-but-finished response', async t => {
  const h = await harness(t, {resetActive: true, realOperations: true, realProvider: true});
  const result = await h.api.query('all', {userInitiated: true});
  const value = result.find(x => x.source === 'steam').value;
  assert.equal(value.steamSales, null);
  assert.equal(value.complete, false);
  assert.equal(h.byId('efficiencyMorningMeetingAutoSteamSales').textContent, '-');
  assert.equal(h.net.filter(x => x.body?.requestType === 'steam_status').length, 1);
  assert.equal(releases(h).length, 1);
  const pollIndex = h.net.findIndex(x => x.query?.id === 'steam-fixture-1');
  const releaseIndex = h.net.findIndex(x => x.body?.action === RELEASE);
  assert.ok(pollIndex >= 0 && releaseIndex > pollIndex);
});

test('reset regression fixture supplies steam only to the two operation-isolation cases', () => {
  const text = read('tests/morning-meeting-selected-date-reset-v1.test.mjs');
  assert.equal((text.match(/function installCompletedSteamForOperationResetTest\(/g) || []).length, 1);
  const names = ['successful', 'incomplete', 'completeHarness', 'failedHarness'];
  for (const name of names) {
    assert.ok(text.includes(`const ${name}SteamCalls = installCompletedSteamForOperationResetTest(${name});`));
    assert.ok(text.includes(`assert.equal(${name}SteamCalls.length, 1, "the required steam dependency is exercised once");`));
  }
  assert.equal((text.match(/= installCompletedSteamForOperationResetTest\(/g) || []).length, 4);
  assert.ok(text.includes('"the reset must remain active until every forced operation has a verified success result"'));
  assert.ok(text.includes('"null or undefined without a current complete status must fail the forced operation"'));
});
