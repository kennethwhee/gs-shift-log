'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const PhotoFile=globalThis.File||require('node:buffer').File;
const source=fs.readFileSync(path.join(__dirname,'../maintenance/solid-fuel-trouble.js'),'utf8');

function harness({postFailure=false,photoFailure=false}={}){
  const elements=new Map(),requests=[],events=[];
  const element=id=>{
    if(!elements.has(id))elements.set(id,{
      id,value:'',textContent:'',hidden:true,disabled:false,checked:false,files:[],dataset:{},children:[],
      focus(){events.push(['focus',id])},setAttribute(name,value){this[name]=value},removeAttribute(name){delete this[name]},
      setCustomValidity(value){this.validityMessage=value},
      replaceChildren(){this.children=[];this.innerHTML=''},append(child){this.children.push(child)},
      classList:{add(){},remove(){},toggle(){}},style:{},closest(){return null},contains(){return false}
    });
    return elements.get(id);
  };
  const document={getElementById:element,querySelector:()=>element('tabs'),createElement:tag=>({tag,dataset:{},classList:{add(){}},innerHTML:''})};
  const window={};window.parent=window;
  const context=vm.createContext({document,window,URL,FormData,console:{error(){}},setTimeout:fn=>fn(),
    localStorage:{getItem:()=>null},location:{origin:'https://example.test'},
    alert:message=>events.push(['alert',message]),confirm:()=>true,
    fetch:async(url,options)=>{
      requests.push({url:String(url),...options});
      const isPhoto=options.body instanceof FormData;
      if(!options.method&&String(url).includes('recordId='))return {ok:true,status:200,text:async()=>JSON.stringify({ok:true,item:{id:'trouble-new',version:1,occurrenceDate:'2026-11-07',equipment:'막힘',photos:[]}})};
      if((isPhoto&&photoFailure)||(!isPhoto&&postFailure))return {ok:false,status:500,text:async()=>JSON.stringify({ok:false,message:'fixture failure'})};
      return {ok:true,status:201,text:async()=>JSON.stringify({ok:true,id:'unload-new',troubleId:'trouble-new',version:2})};
    },__events:events
  });
  const beforeInit=source.indexOf('  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,');
  assert.ok(beforeInit>0);
  vm.runInContext(source.slice(0,beforeInit)+`
    setBusy=()=>{};
    closeRecord=()=>__events.push(['close-record']);
    closeTrouble=()=>__events.push(['close-trouble']);
    load=async()=>__events.push(['load']);
    openTrouble=x=>__events.push(['open-trouble',x.id]);
    switchTab=tab=>__events.push(['tab',tab]);
    globalThis.h={state,e,recordKind,hasTroubleDraft,syncRecordKind,saveRecord,saveTrouble,
      issueTextParts,issueActionsHtml,troubleTable,summary,unloadById,troubleById,delPhoto};
  })();`,context);
  const h=context.h;
  h.state.user={name:'fixture'};
  h.state.permissions={canCreate:true,canEdit:true,canDelete:true,canUploadPhoto:true,canManageUnloading:true};
  for(const [id,value] of Object.entries({recordDate:'2026-11-07',recordFuelType:'organic',recordReceiptTons:'28.78',recordArrival:'2321',recordDeparture:'0047',recordCompany:'수도권',recordVehicle:'4202',recordSilo:'#A'}))element(id).value=value;
  return {...h,element,requests,events,document,submit:()=>h.saveRecord({preventDefault(){}})};
}

test('unchecked creation saves one ordinary receipt with remarks and stays on unloading view',async()=>{
  const h=harness();h.e.rNote.value='#B하역중 막힘으로 #A 나머지 이송';
  await h.submit();
  assert.equal(h.requests.length,1);
  const payload=JSON.parse(h.requests[0].body);
  assert.equal(payload.entity,'unloading');
  assert.equal(payload.note,h.e.rNote.value);
  assert.equal(payload.arrivalTime,'23:21');assert.equal(payload.departureTime,'00:47');
  assert.equal(payload.receiptTons,28.78);
  assert.equal(JSON.stringify(h.events.filter(x=>x[0]==='tab')),JSON.stringify([['tab','unload']]));
});

test('checkbox uses the existing atomic combined save with separate issue text and remarks',async()=>{
  const h=harness();h.e.rTrouble.checked=true;h.e.rEquipment.value='Storage #B 막힘';h.e.rNote.value='#A로 이송';
  h.syncRecordKind();assert.equal(h.e.rTroubleFields.hidden,false);assert.equal(h.e.rSave.textContent,'하역 기록 저장');
  await h.submit();
  assert.equal(h.requests.length,1);
  const payload=JSON.parse(h.requests[0].body);
  assert.equal(payload.entity,'combined');assert.equal(payload.equipment,'Storage #B 막힘');assert.equal(payload.note,'#A로 이송');
});

test('checked remark-only issue is allowed without an artificial equipment requirement',async()=>{
  const h=harness();h.e.rTrouble.checked=true;h.e.rNote.value='역가압 후 해소';
  await h.submit();
  assert.equal(JSON.parse(h.requests[0].body).equipment,'');
  assert.equal(JSON.parse(h.requests[0].body).entity,'combined');
});

test('toggling off keeps a filled draft and prevents silently discarding it during save',async()=>{
  const h=harness();h.e.rTrouble.checked=true;h.e.rEquipment.value='작성 중인 이슈';h.e.rNote.value='조치 중';
  h.syncRecordKind();h.e.rTrouble.checked=false;h.syncRecordKind();
  assert.equal(h.e.rEquipment.value,'작성 중인 이슈');assert.equal(h.e.rNote.value,'조치 중');
  assert.equal(h.e.rTroubleFields.hidden,false);
  await h.submit();assert.equal(h.requests.length,0);assert.match(h.e.rStatus.textContent,/Trouble을 체크/);
  h.e.rTrouble.checked=true;await h.submit();assert.equal(h.requests.length,1);
});

test('unchecked empty detail panel closes without hiding ordinary remarks',()=>{
  const h=harness();h.e.rNote.value='일반 비고';h.syncRecordKind();
  assert.equal(h.e.rTroubleFields.hidden,true);assert.equal(h.e.rNote.value,'일반 비고');
  assert.equal(h.e.rTrouble['aria-expanded'],'false');
});

test('invalid photo selection is rejected before a receipt is created',async()=>{
  const h=harness();h.e.rTrouble.checked=true;h.e.rFiles.files=[{name:'document.exe',size:100}];
  await h.submit();assert.equal(h.requests.length,0);assert.match(h.e.rStatus.textContent,/형식과 용량/);
});

test('photo failure after saving opens the saved issue rather than allowing another creation POST',async()=>{
  const h=harness({photoFailure:true});h.e.rTrouble.checked=true;h.e.rEquipment.value='막힘';
  h.e.rFiles.files=[new PhotoFile([new Uint8Array([1,2,3])],'sample.png',{type:'image/png'})];
  h.state.troubles=[{id:'trouble-new',version:1}];
  await h.submit();
  assert.equal(h.requests.length,2);assert.equal(h.requests[0].method,'POST');
  assert.ok(h.events.some(x=>x[0]==='close-record'));
  assert.ok(h.events.some(x=>x[0]==='open-trouble'&&x[1]==='trouble-new'));
  assert.match(h.e.tStatus.textContent,/하역 기록은 저장/);
  assert.equal(h.state.saving,false);
});


test('photo recovery reads the saved issue by ID when active filters exclude the new record',async()=>{
  const h=harness({photoFailure:true});h.e.rTrouble.checked=true;h.e.rEquipment.value='막힘';
  h.e.rFiles.files=[new PhotoFile([new Uint8Array([1,2,3])],'sample.png',{type:'image/png'})];
  h.e.month.value='2026-10';h.e.search.value='다른 이슈';
  await h.submit();
  assert.equal(h.requests.length,3);
  assert.match(h.requests[2].url,/recordId=trouble-new$/);
  assert.ok(h.events.some(x=>x[0]==='open-trouble'&&x[1]==='trouble-new'));
  assert.equal(h.e.month.value,'2026-10');assert.equal(h.e.search.value,'다른 이슈');
});

test('existing issue photo retry uses the returned version after its text save succeeded',async()=>{
  const h=harness({photoFailure:true});
  h.e.tId.value='trouble-new';h.e.tVersion.value='1';h.e.tDate.value='2026-11-07';
  h.e.tFiles.files=[new PhotoFile([new Uint8Array([1,2,3])],'sample.png',{type:'image/png'})];
  await h.saveTrouble({preventDefault(){}});
  assert.equal(h.e.tVersion.value,'2');
  await h.saveTrouble({preventDefault(){}});
  const puts=h.requests.filter(x=>x.method==='PUT').map(x=>JSON.parse(x.body));
  assert.equal(puts.length,2);assert.equal(puts[1].version,2);
});

test('failed creation preserves the draft in the current form without a second request',async()=>{
  const h=harness({postFailure:true});h.e.rNote.value='유지할 비고';
  await h.submit();assert.equal(h.requests.length,1);assert.equal(h.e.rNote.value,'유지할 비고');
  assert.equal(h.events.some(x=>x[0]==='close-record'),false);assert.equal(h.state.saving,false);
});

test('issue rendering moves a remark-only record into issue detail and escapes user text',()=>{
  const h=harness();h.state.issues=[{id:'unload-old',sourceEntity:'unloading',occurrenceDate:'2026-11-02',note:'#B 막힘 <script>alert(1)</script>',photos:[]}];
  h.troubleTable();const html=h.e.troubleBody.children[0].innerHTML;
  assert.match(html,/하역 비고/);assert.match(html,/#B 막힘 &lt;script&gt;/);
  assert.equal(html.includes('<script>'),false);
  assert.equal((html.match(/#B 막힘/g)||[]).length,1);
  assert.match(html,/data-action="edit-unload"/);assert.equal(html.includes('delete-'),false);
});

test('distinct issue and note text both display while identical text is displayed once',()=>{
  const h=harness();
  assert.equal(h.issueTextParts({equipment:'막힘',note:'막힘',unloadingNote:'막힘'}).notes.length,0);
  const parts=h.issueTextParts({equipment:'막힘',note:'역가압',unloadingNote:'나머지 #A 이송'});
  assert.equal(parts.detail,'막힘');assert.equal(parts.notes.length,2);
  assert.equal(parts.notes[0].text,'역가압');assert.equal(parts.notes[1].text,'나머지 #A 이송');
});

test('remark issue edit uses unloading permissions and resolves its source outside the list window',()=>{
  const h=harness(),record={id:'old-unload',note:'이전 비고',version:3};
  h.state.issues=[{id:record.id,sourceEntity:'unloading',sourceRecord:record}];
  assert.equal(h.unloadById(record.id).version,3);
  h.state.permissions.canManageUnloading=false;
  assert.equal(h.issueActionsHtml(h.state.issues[0]),'');
  h.state.permissions.canManageUnloading=true;
  assert.match(h.issueActionsHtml(h.state.issues[0]),/edit-unload/);
  h.state.user=null;assert.equal(h.issueActionsHtml(h.state.issues[0]),'');
});

test('issue counters reflect the unified view without changing receipt statistics',()=>{
  const h=harness();h.state.troubles=[{id:'trouble'}];h.state.issues=[{id:'trouble'},{id:'remark'}];
  h.state.unloads=[{durationMinutes:90},{durationMinutes:120}];h.summary();
  assert.equal(h.e.troubleKpi.textContent,'2');assert.equal(h.e.troubleTabCount.textContent,'2');
  assert.equal(h.e.unloadKpi.textContent,'2');assert.equal(h.e.averageKpi.textContent,'1:45');
});


test('photo removal refreshes an out-of-filter editor through the authenticated detail lookup',async()=>{
  const h=harness();h.e.tId.value='trouble-new';h.e.existing.children=[{id:'photo-old'}];
  await h.delPhoto('photo-old');
  assert.equal(h.requests[0].method,'DELETE');assert.match(h.requests[0].url,/photoId=photo-old/);
  assert.match(h.requests[1].url,/recordId=trouble-new$/);
  assert.equal(h.e.existing.children.length,0);assert.equal(h.e.existing.hidden,true);
});


test('hiding a cleared issue control returns keyboard focus to the Trouble checkbox',()=>{
  const h=harness();h.document.activeElement=h.e.rEquipment;
  h.e.rTroubleFields.contains=node=>node===h.e.rEquipment;
  h.syncRecordKind();assert.ok(h.events.some(x=>x[0]==='focus'&&x[1]==='recordTrouble'));
  h.events.length=0;h.e.rTrouble.checked=true;h.document.activeElement=h.e.rFilesClear;
  h.syncRecordKind();assert.ok(h.events.some(x=>x[0]==='focus'&&x[1]==='recordTrouble'));
});
