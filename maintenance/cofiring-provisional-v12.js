/* Separate, labelled provisional snapshot UI. Does not change official close or original measurements. */
(function(root){
'use strict';
if(root.CofiringProvisionalV12Installed)return;
root.CofiringProvisionalV12Installed=true;
const API='/api/cofiring-provisional-v12';
const ID='data-gs-v12-provisional';
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const q=n=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ko-KR',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const pc=n=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(2)+'%':'—';
const day=x=>/^20\d{2}-\d{2}-\d{2}$/.test(String(x||''));
const token=()=>String((root.getShiftLogAuthHeaders?.()||{}).Authorization||'');
const headers=()=>({...root.getShiftLogAuthHeaders?.(),Accept:'application/json'});
let latestSummary=null,savedKey='',saving=false,morningLoaded='',morningRequest=0;
async function request(suffix='',opts={}){
 const res=await root.fetch(API+suffix,{cache:'no-store',credentials:'same-origin',...opts,headers:{...headers(),...(opts.headers||{})}});
 let data;try{data=await res.json()}catch{throw Error('가정 계산 서버 응답을 확인하지 못했습니다.')}if(!res.ok||data?.ok!==true)throw Error(data?.message||'가정 계산 조회에 실패했습니다.');return data;
}
function specNow(){const shell=root.document?.querySelector('.cofiring-period-v5');const ctrl=root.__cofiringPeriodV5Controller;
 const spec=ctrl?.getSpec?.(),date=shell?.querySelector('[data-cfv7-date]')?.value,mode=shell?.querySelector('[data-cfv8-mode]')?.value;
 return {shell,ctrl,spec,date,mode};}
function currentProjection(){const {shell,ctrl,spec,date,mode}=specNow(),scenarioApi=root.CofiringSharedScenarioV7;
 if(!shell||mode!=='daily'||!day(date)||!spec||spec.startLocal!==date+'T00:00'||!scenarioApi)return null;
 const raw=ctrl?.getResult?.(),projection=raw&&scenarioApi.project?.(raw);
 const scenario=projection?.hypothesisDisplay;
 if(!scenarioApi.isScenario?.(scenario))return null;
 const saved=ctrl?.live?.state?.()?.item?.saved;
 if(!saved||saved.status!=='complete'||ctrl.live.state().item.active)return null;
 return {shell,ctrl,spec,date,raw,result:projection,scenario,saved};
}
function buildPayload(){const t=currentProjection();if(!t)throw Error('가정 계산이 완료된 일별 자료를 확인해 주세요.');
 const module=root.CofiringPeriodV5,settings=module.readSettings(t.shell),manual=module.readManual(t.shell);
 const preview={units:{},combined:{}};
 for(const u of ['unit1','unit2']){
   const src=t.result.units[u];preview.units[u]={ratios:{}};
   for(const fuel of ['coal','bio','organic','manure'])preview.units[u][fuel]=src?.[fuel]?.quantity;
   for(const key of ['bio','organicGroup','total'])preview.units[u].ratios[key]=src?.fuelRatios?.[key];
 }
 for(const key of ['bio','organicGroup','total'])preview.combined[key]=t.result?.combined?.fuelRatios?.[key];
 return {targetDate:t.date,sourceRequestId:String(t.saved.id),receiptTons:t.scenario.receipt,unitTons:t.scenario.unitTons,
  settings,manure:{unit1:manual?.unit1?.manure??0,unit2:manual?.unit2?.manure??0},preview,
  acknowledgeUnverified:true};
}
const style=`
.gs-v12-badge{display:inline-block;font-size:11px;line-height:1.5;padding:2px 7px;border-radius:7px;background:#fff0df;color:#9b5400;font-weight:700;border:1px solid #ecc48b}
.gs-v12-button{border:1px solid #c3833e;color:#8f5005;background:#fff9ee;border-radius:7px;padding:7px 11px;font-weight:700;font-size:12px;cursor:pointer}
.gs-v12-button:disabled{opacity:.55;cursor:not-allowed}
.gs-v12-status{font-size:12px;color:#715327}
.gs-v12-banner{margin-top:6px;color:#81520a;font-size:11px}
.gs-v12-panel{border:1px solid #e7c69a;background:#fffaf1;border-radius:9px;margin:10px 0;padding:10px;font-size:12px}
.gs-v12-panel strong{font-size:12px}.gs-v12-panel p{margin:5px 0;color:#5f564a}
.gs-v12-panel table{width:100%;border-collapse:collapse;font-size:12px}.gs-v12-panel th,.gs-v12-panel td{padding:5px;border-bottom:1px solid #ecd7b8;text-align:left}
.gs-v12-panel details{margin:8px 0}.gs-v12-panel summary{cursor:pointer;color:#895e20;font-weight:650}
.gs-v12-rows{display:flex;gap:10px;flex-wrap:wrap}.gs-v12-rows>span{flex:1;min-width:105px}
.gs-v12-panel [data-gs-v12-warning]{color:#944500}
`;
function paintStatus(el,msg){if(el&&el.textContent!==msg)el.textContent=msg;}
async function save(){if(saving)return;const bar=root.document.querySelector('[data-gs-v12-save-status]');const button=root.document.querySelector('[data-gs-v12-save]');
 let data;try{data=buildPayload()}catch(e){paintStatus(bar,e.message);return;}
 const question=`${data.targetDate}의 가정 계산값을 ‘미확정 자료’로 별도 저장합니다.\n실제 계측값/확정 마감이 아니며 오전회의와 마감 데이터에도 ‘가정’으로 표시됩니다. 계속할까요?`;
 if(!root.confirm?.(question))return;
 saving=true;if(button)button.disabled=true;paintStatus(bar,'가정 계산 기록 저장 중…');const expectedDate=data.targetDate,expectedAuth=token();
 try{const before=await request('?targetDate='+encodeURIComponent(expectedDate));
  if(token()!==expectedAuth||specNow().date!==expectedDate)throw Error('로그인 상태 또는 선택 날짜가 변경됐습니다.');
  const result=await request('',{method:'POST',headers:{'Content-Type':'application/json','X-ShiftLog-Client':'desktop'},body:JSON.stringify({...data,expectedRevision:before.item?.revision||0,requestId:root.crypto?.randomUUID?.()})});
  if(token()!==expectedAuth)return;
  paintStatus(bar,`가정 계산 기록 v${result.item?.revision||1} 저장 완료 · 미확정 · 공식 마감 아님`);latestSummary=result.item;savedKey=expectedDate;
  root.dispatchEvent?.(new root.CustomEvent('cofiring:provisional-saved',{detail:{targetDate:expectedDate}}));
 }catch(e){paintStatus(bar,e.message)}finally{saving=false;if(button)button.disabled=!currentProjection();}
}
function mountCalc(){const {shell,date}=specNow();if(!shell)return;
 const toolbar=shell.querySelector('.cfv12-toolbar');if(!toolbar)return;
 let button=toolbar.querySelector('[data-gs-v12-save]');
 if(!button){button=root.document.createElement('button');button.type='button';button.className='gs-v12-button';button.dataset.gsV12Save='';button.textContent='가정 계산 저장';
 toolbar.append(button);button.addEventListener('click',()=>void save());
 const status=root.document.createElement('div');status.dataset.gsV12SaveStatus='';status.className='gs-v12-status';toolbar.after(status);
 }
 const ready=!!currentProjection();button.hidden=!ready;button.disabled=!ready||saving;
 if(savedKey!==date){savedKey=date||'';paintStatus(shell.querySelector('[data-gs-v12-save-status]'),ready?'가정 계산 · 미확정 별도 저장 가능 (공식 마감 제외)':'');}
}
function compactItem(item){const u=item?.summary||{},a=item?.assumption||{};
 return `<div class="gs-v12-rows"><span>1호기: 유기성(가정) ≈${q(u.unit1?.organic)}t · 종합 ${pc(u.unit1?.totalRatio)}</span><span>2호기: 유기성(가정) ≈${q(u.unit2?.organic)}t · 종합 ${pc(u.unit2?.totalRatio)}</span></div><p>Storage B ${esc(q(a.tons))}t 가정 · ${esc(a.boundaryLocal||'')} · 미확정</p>`;
}
function monthTable(items){return `<strong>가정 계산 별도 저장 이력</strong> <span class="gs-v12-badge">확정 마감 아님</span>
 <p>원본 DataPARC 마감 기록과 분리 보관됩니다. 공식 마감표에는 포함되지 않습니다.</p>
 ${items.length?`<table><thead><tr><th>날짜</th><th>가정 유기성(호기당)</th><th>종합 혼소율</th><th>상태</th><th>저장</th></tr></thead><tbody>${items.map(x=>`<tr><td>${esc(x.targetDate)}</td><td>≈${q(x.summary?.unit1?.organic)}t</td><td>${pc(x.summary?.combined?.totalRatio)}</td><td><span class="gs-v12-badge">가정·미확정</span></td><td>${esc(x.savedByName)}</td></tr>`).join('')}</tbody></table>`:'<p>저장된 가정 계산 자료가 없습니다.</p>'}`;}
let historyLoadedAt=0;
async function loadHistory(){const panel=root.document.querySelector('.cfv12-history-panel');const host=panel?.querySelector('[data-gs-v12-history]');if(!host||panel.hidden)return;
 const auth=token();paintStatus(host,'가정 계산 기록 조회 중…');
 try{const items=(await request('?limit=180')).items||[];if(auth!==token()||!host.isConnected||panel.hidden)return;host.innerHTML=monthTable(items);historyLoadedAt=Date.now();}
 catch(e){if(auth===token()&&host.isConnected)paintStatus(host,e.message)}
}
function mountHistory(){const panel=root.document.querySelector('.cfv12-history-panel');if(!panel)return;
 let host=panel.querySelector('[data-gs-v12-history]');if(!host){host=root.document.createElement('section');host.dataset.gsV12History='';host.className='gs-v12-panel';
 panel.querySelector('.cfv12-history-head')?.after(host);const b=root.document.createElement('button');b.type='button';b.className='gs-v12-button';b.textContent='가정 기록 새로고침';b.addEventListener('click',()=>void loadHistory());host.before(b);
 }
 if(!panel.hidden&&Date.now()-historyLoadedAt>45000){historyLoadedAt=Date.now();void loadHistory();}
}
function morningDate(){const morning=root.morningMeetingClosedCofiring;try{return morning?.targetDate?.()||''}catch{return ''}}
function mountMorning(){const card=root.document.getElementById('efficiencyMorningMeetingAutoCofiringCard');if(!card)return;
 let box=card.querySelector('[data-gs-v12-morning]');if(box)return;
 box=root.document.createElement('section');box.className='gs-v12-panel';box.dataset.gsV12Morning='';box.innerHTML='<strong>가정 계산 별도 기록</strong> <span class="gs-v12-badge">미확정</span><div data-gs-v12-morning-body>저장된 가정 계산값은 실측 마감자료와 구분해 조회합니다.</div>';
 const button=root.document.createElement('button');button.type='button';button.className='gs-v12-button';button.textContent='가정자료 조회';button.addEventListener('click',()=>void loadMorning());box.append(button);card.append(box);
}
async function loadMorning(){const box=root.document.querySelector('[data-gs-v12-morning]'),body=box?.querySelector('[data-gs-v12-morning-body]');if(!body)return;
 const date=morningDate(),seq=++morningRequest,auth=token(),original=root.morningMeetingClosedCofiring;
 if(!day(date)||original?.isBlocked?.(date)){paintStatus(body,'선택일이 없거나 초기화 중입니다.');return;}
 if(original?.peek?.(date)){paintStatus(body,'확정 마감자료가 존재합니다. 가정 계산은 공식 값에 덮어쓰지 않습니다.');return;}
 paintStatus(body,`${date} 가정 기록 확인 중…`);
 try{const {item}=await request('?targetDate='+encodeURIComponent(date));if(seq!==morningRequest||auth!==token()||morningDate()!==date||!body.isConnected)return;
  if(original?.peek?.(date)){paintStatus(body,'확정 마감자료가 우선 적용됩니다.');return;}
  if(!item){paintStatus(body,`${date} 저장된 가정 계산 기록 없음`);return;}
  body.innerHTML=`<p><strong>${esc(date)} · 가정 계산 · 미확정</strong> (공식 마감자료 아님)</p>${compactItem(item)}<p>Coal·Bio 원본 사용량: 1호기 ${q(item.summary?.unit1?.coal)}/${q(item.summary?.unit1?.bio)}t · 2호기 ${q(item.summary?.unit2?.coal)}/${q(item.summary?.unit2?.bio)}t</p>`;
  morningLoaded=date;
 }catch(e){if(seq===morningRequest&&auth===token())paintStatus(body,e.message)}
}
// Capture explicit operator choices, not passive date changes, to preserve Morning Meeting D1 snapshots.
function clickHook(event){const button=event.target.closest?.('button');if(!button)return;
 const label=String(button.textContent||'').replace(/\s+/g,' ').trim();
 if(label==='마감 데이터'||label==='새로고침'&&button.hasAttribute('data-cfv12-refresh')){root.setTimeout(()=>{historyLoadedAt=0;mountHistory();},30);}
 if(label.includes('오전회의자료')||label==='전체자료'||label==='새로 조회'){root.setTimeout(()=>{mountMorning();void loadMorning();},200);}
}
let timer=null;function schedule(){if(timer!==null)return;timer=root.setTimeout(()=>{timer=null;mountCalc();mountHistory();mountMorning();},60)}
function boot(){if(!root.document)return;
 if(!root.document.getElementById('gs-v12-style')){const css=root.document.createElement('style');css.id='gs-v12-style';css.textContent=style;root.document.head.append(css);}
 root.document.addEventListener('click',clickHook,true);schedule();
 const observer=new root.MutationObserver(()=>schedule());observer.observe(root.document.body,{childList:true,subtree:true});
 root.addEventListener('cofiring:provisional-saved',()=>{historyLoadedAt=0;void loadHistory();if(morningLoaded===morningDate())void loadMorning();});
}
if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();}
root.CofiringProvisionalV12={buildPayload,request};
})(typeof globalThis==='object'?globalThis:this);
