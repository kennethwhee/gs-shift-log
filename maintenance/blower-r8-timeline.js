/* R8 manual time-slice RUN investigation, strictly read-only. No client-side
 * event timestamp inference: one bin only reports its bounded RUN sum/state.
 */
;(function(root){
  'use strict';
  const USER_KEY='gsShiftLog.currentUser',API='/api/ois-data-requests',PREFIX='r8_timeline_v1:';
  const ROOTS={
    fbhe_workday:{asset:'104HHL60AP621',signal:'GSPOGE.ABB_DCS.104HHL60AP621XB04',start:'2026-10-08T13:04:00+09:00',end:'2026-10-09T00:00:00+09:00',group:'fbhe'},
    fbhe_after:{asset:'104HHL60AP621',signal:'GSPOGE.ABB_DCS.104HHL60AP621XB04',start:'2026-10-09T00:00:00+09:00',end:'2026-11-07T14:00:00+09:00',group:'fbhe'},
    limestone_day:{asset:'203HRJ01AN601',signal:'GSPOGE.ABB_DCS.203HRJ01AN601XB04',start:'2026-09-19T00:00:00+09:00',end:'2026-09-20T00:00:00+09:00',group:'limestone'}
  };
  const groups={fbhe:['fbhe_workday','fbhe_after'],limestone:['limestone_day']};
  const state=new Map();let busy=false;const document=root.document;
  const el=id=>document.getElementById(id);
  const text=v=>String(v??'');
  const stamp=v=>typeof v==='string'?Date.parse(v):NaN;
  function kst(t){const d=new Date(t+9*3600000),p=n=>String(n).padStart(2,'0');return `${d.getUTCFullYear()}-${p(d.getUTCMonth()+1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+09:00`;}
  function plan(mode){const m=/^r8_timeline_v1:(fbhe_workday|fbhe_after|limestone_day):([01]{0,16})$/.exec(mode);
    if(!m)return null;let a=stamp(ROOTS[m[1]].start),b=stamp(ROOTS[m[1]].end);
    for(const bit of m[2]){if(b-a<120000)return null;/* Rounded binary split; server re-derives the same window. */
      const half=Math.floor(((a+b)/2)/60000)*60000;
      if(half<=a||half>=b)return null;
      if(bit==='0')b=half;else a=half;
    }
    return {mode,root:m[1],path:m[2],start:kst(a),end:kst(b),seconds:(b-a)/1000};
  }
  function user(){let d;try{d=JSON.parse(root.localStorage.getItem(USER_KEY)||'null')}catch{d=null}return d||{};}
  function actor(){const u=user();return text(u.employeeNo||u.employee_no||u.user?.employeeNo||'').trim();}
  function token(){const u=user(),v=text(u.sessionToken||u.session_token||'').trim();
    if(!v||v.length>8192)throw new Error('로그인한 회사 PC에서 실행해 주세요.');return v;}
  async function request(url,method='GET',body){const headers={Authorization:'Bearer '+token(),Accept:'application/json','X-GS-Client-Mode':'desktop'};
    if(body)headers['Content-Type']='application/json; charset=utf-8';
    const response=await root.fetch(url,{method,headers,cache:'no-store',credentials:'same-origin',...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok||data.ok!==true)throw new Error(text(data?.message||'조회 요청 실패').slice(0,240));return data;}
  function storeKey(){return 'gs-blower-r8-timeline:'+actor();}
  function save(){if(!actor())return;try{const rows=[...state.values()].filter(x=>x.id).map(x=>({mode:x.mode,id:x.id}));root.sessionStorage.setItem(storeKey(),JSON.stringify(rows.slice(-100)));}catch{}}
  function restore(){if(!actor())return;let rows=[];try{rows=JSON.parse(root.sessionStorage.getItem(storeKey())||'[]')}catch{}
    if(!Array.isArray(rows))return;for(const x of rows.slice(-100)){
      if(typeof x?.id==='string'&&/^[0-9a-f-]{36}$/i.test(x.id)&&plan(x.mode))state.set(x.mode,{mode:x.mode,id:x.id,status:'saved',proof:null});
    }}
  function status(message){if(el('blowerR8Status'))el('blowerR8Status').textContent=message;}
  function locked(value){busy=value;for(const id of ['blowerR8Fbhe','blowerR8Limestone','blowerR8Check'])if(el(id))el(id).disabled=value;}
  async function beginModes(modes){
    if(busy)return;locked(true);
    try{const assets=await request('/api/blower-history');
      if(assets.permissions?.isSuperAdmin!==true&&assets.user?.isSuperAdmin!==true)throw new Error('최고관리자 권한이 필요합니다.');
      for(const mode of modes){const p=plan(mode);if(!p)throw new Error('조회 기간 구성 오류');
        if(state.has(mode)){continue;}const r=ROOTS[p.root];
        const asset=(assets.assets||[]).find(a=>a.tagNumber===r.asset);
        if(!asset||!asset.cycleRuntimeRevision||!asset.cycleStartRevision)throw new Error(r.asset+' 현재 조회 기준을 확인할 수 없습니다.');
        const body={action:'create_blower_runtime_probe',r7EvidenceMode:mode,unifiedRefresh:true,
          incrementalRefresh:false,requireIncrementalAppend:false,assetTag:r.asset,dataParcTag:r.signal,
          confirmRunSignal:true,startAt:p.start,expectedLastReplacementAt:asset.lastReplacementAt,
          expectedCycleStartState:asset.cycleStartState||'legacy',expectedCycleStartedAt:asset.cycleStartedAt||'',
          expectedCycleStartRevision:asset.cycleStartRevision,expectedCycleRuntimeRevision:asset.cycleRuntimeRevision};
        const response=await request(API,'POST',body);
        const id=text(response.item?.id||response.items?.[0]?.id||response.requestId||'');
        if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error('R8 요청 ID가 없습니다.');
        state.set(mode,{mode,id,status:'pending',proof:null});save();render();
      }
      status('조회 요청 접수 완료. 기존 누적시간은 유지됩니다. 「결과 확인」으로 대기 요청을 확인하세요.');
    }catch(error){status('조회 요청 중단: '+text(error.message||error).slice(0,240)+' · 이미 접수한 요청은 유지');}
    finally{locked(false);render();}
  }
  function validResult(mode,item,id){const p=plan(mode),r=ROOTS[p?.root];if(!p||!r)return null;const x=item?.probe,v=item?.result;
    if(item?.id!==id||item?.status!=='complete'||item?.requestType!=='blower_runtime_probe'||!x||!v||
      x.requestId!==id||v.requestId!==id||v.schemaVersion!==1||v.ok!==true||v.readOnly!==true||
      v.requestType!=='blower_runtime_probe'||x.assetTag!==r.asset||v.assetTag!==r.asset||
      x.dataParcTag!==r.signal||v.dataParcTag!==r.signal||
      !text(x.expectedCycleRuntimeRevision).startsWith('r7-evidence-only-v1:')||
      x.expectedCycleRuntimeRevision!==v.expectedCycleRuntimeRevision||
      stamp(x.startAt)!==stamp(p.start)||stamp(v.startAt)!==stamp(p.start)||
      stamp(x.endAt)!==stamp(p.end)||stamp(v.endAt)!==stamp(p.end)||stamp(v.observedAt)!==stamp(p.end)||
      !Number.isSafeInteger(v.chunkCount)||v.chunkCount<1||v.chunkCount!==v.completedChunkCount||
      v.chunkCount!==x.chunkCount||!Array.isArray(v.chunks)||v.chunks.length!==v.chunkCount||
      !['running','stopped'].includes(v.startState)||!['running','stopped'].includes(v.endState))return null;
    let sum=0,end=stamp(p.start),s=v.startState;
    for(let i=0;i<v.chunks.length;i++){const c=v.chunks[i],finish=stamp(c?.endAt);
      if(c?.index!==i+1||stamp(c.startAt)!==end||!Number.isFinite(finish)||finish<=end||
        c.startState!==s||!['running','stopped'].includes(c.endState)||
        !Number.isSafeInteger(c.runningSeconds)||c.runningSeconds<0||c.runningSeconds>(finish-end)/1000+2||
        typeof c.totalRunningHours!=='number'||!Number.isFinite(c.totalRunningHours)||
        Math.abs(c.totalRunningHours*3600-c.runningSeconds)>2)return null;
      sum+=c.runningSeconds;end=finish;s=c.endState;
    }
    if(end!==stamp(p.end)||s!==v.endState||sum!==v.runningSeconds||
      typeof v.totalRunningHours!=='number'||!Number.isFinite(v.totalRunningHours)||
      Math.abs(v.totalRunningHours*3600-sum)>2)return null;
    return {startAt:p.start,endAt:p.end,runningSeconds:sum,startState:v.startState,endState:v.endState};
  }
  async function check(){if(busy)return;locked(true);
    try{let checked=0;for(const rec of state.values()){
      if(rec.proof||rec.status==='failed'||rec.status==='invalid')continue;
      const r=await request(API+'?id='+encodeURIComponent(rec.id)+'&_='+Date.now());const item=r.item;
      if(item?.id!==rec.id){rec.status='invalid';rec.error='요청 ID 불일치';continue;}
      if(item.status==='failed'){rec.status='failed';rec.error=text(item.errorMessage||'Agent 오류');continue;}
      if(item.status!=='complete'){rec.status=text(item.status||'pending');continue;}
      const proof=validResult(rec.mode,item,rec.id);if(!proof){rec.status='invalid';rec.error='요청 신호·기간·RUN 합계 검증 실패';continue;}
      rec.status='complete';rec.proof=proof;checked++;
    }status('결과 확인 완료 · 신규 검증 '+checked+'건. 혼재 구간은 「시간 구간 세분화」를 눌러 더 좁힐 수 있습니다.');
    }catch(error){status('결과 확인 중단: '+text(error.message||error).slice(0,200));}
    finally{locked(false);render();}
  }
  function fullOrZero(rec){const p=plan(rec.mode),v=rec.proof;if(!p||!v)return 'unknown';
    if(v.runningSeconds===0&&v.startState==='stopped'&&v.endState==='stopped')return 'off';
    if(Math.abs(v.runningSeconds-p.seconds)<=2&&v.startState==='running'&&v.endState==='running')return 'on';
    return 'mixed';}
  function parentCheck(rec){const p=plan(rec.mode);if(!p||!rec.proof)return '';
    const a=state.get(rec.mode+'0')?.proof,b=state.get(rec.mode+'1')?.proof;
    if(!a||!b)return '';
    const delta=a.runningSeconds+b.runningSeconds-rec.proof.runningSeconds;
    const contiguous=stamp(a.endAt)===stamp(b.startAt)&&stamp(a.startAt)===stamp(p.start)&&stamp(b.endAt)===stamp(p.end);
    if(!contiguous||a.endState!==b.startState||a.startState!==rec.proof.startState||b.endState!==rec.proof.endState||Math.abs(delta)>2)return '세분화 교차검증 불일치 · 근거 확정 금지 ('+delta+'초)';
    return '하위 구간 합계·경계 확인 통과 (차이 '+delta+'초)';
  }
  function drawRow(rec){const p=plan(rec.mode),div=document.createElement('div');div.className='blower-r8-row';
    const label=document.createElement('span');label.className='blower-r8-range';
    label.textContent=p.start.slice(0,16).replace('T',' ')+' ~ '+p.end.slice(0,16).replace('T',' ');div.appendChild(label);
    const output=document.createElement('span');output.className='blower-r8-value';
    if(rec.proof){const quality=fullOrZero(rec);output.textContent=rec.proof.runningSeconds+'초 RUN · '+
      (quality==='off'?'조회 구간 RUN 0초':quality==='on'?'조회 구간 대부분 RUN':'RUN/정지 혼재 · 시각 추가 확인');}
    else output.textContent=rec.status+(rec.error?' · '+rec.error:'');div.appendChild(output);
    const guard=parentCheck(rec);if(guard){const g=document.createElement('small');g.className='blower-r8-guard';g.textContent=guard;div.appendChild(g);}
    if(rec.proof&&fullOrZero(rec)==='mixed'&&p.seconds>120&&p.path.length<16&&
      !state.has(rec.mode+'0')&&!state.has(rec.mode+'1')){
      const b=document.createElement('button');b.type='button';b.textContent='시간 구간 세분화';b.disabled=busy;
      b.addEventListener('click',()=>beginModes([rec.mode+'0',rec.mode+'1']));div.appendChild(b);
    }
    return div;
  }
  function render(){for(const [group,container] of [['fbhe','blowerR8FbheRows'],['limestone','blowerR8LimestoneRows']]){
    const root=el(container);if(!root)continue;root.textContent='';
    const rows=[...state.values()].filter(rec=>ROOTS[plan(rec.mode)?.root]?.group===group)
      .sort((a,b)=>stamp(plan(a.mode).start)-stamp(plan(b.mode).start)||a.mode.length-b.mode.length);
    if(!rows.length){root.textContent='조회 요청 전 · 기존 R7 결과를 변경하지 않습니다.';continue;}
    const initialModes=groups[group].flatMap(key=>[PREFIX+key+':0',PREFIX+key+':1']);
    const originals=initialModes.map(mode=>state.get(mode)?.proof);
    const summary=document.createElement('p');summary.className='blower-r8-help';
    if(originals.every(Boolean)){
      const seconds=originals.reduce((total,r)=>total+r.runningSeconds,0);
      if(group==='limestone')summary.textContent=`R8 9월 19일 합계 ${seconds}초 · R7 50,494초 대비 ${seconds-50494}초 (${Math.abs(seconds-50494)<=2?'±2초 이내 대조 일치 · 교체시각 미확정':'합계 불일치 · 확정 금지'})`;
      else summary.textContent=`R8 고정 관측 범위 합계 ${seconds}초 · R7 최초 647초는 종료시각이 달라 자동 일치 판정하지 않습니다.`;
    }else summary.textContent='최초 구간 일부가 아직 미측정입니다. 전체 합계 확정 전 대기';
    root.appendChild(summary);
    for(const rec of rows)root.appendChild(drawRow(rec));
  }}
  function init(){if(!el('blowerR8Panel')||!actor()||!text(user().sessionToken||user().session_token))return;
    if(root.matchMedia?.('(max-width:700px), (max-width:1024px) and (hover:none) and (pointer:coarse)')?.matches)return;
    el('blowerR8Panel').hidden=false;restore();render();
    el('blowerR8Fbhe').addEventListener('click',()=>beginModes(['fbhe_workday','fbhe_after'].flatMap(key=>[PREFIX+key+':0',PREFIX+key+':1'])));
    el('blowerR8Limestone').addEventListener('click',()=>beginModes([PREFIX+'limestone_day:0',PREFIX+'limestone_day:1']));
    el('blowerR8Check').addEventListener('click',check);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window!=='undefined'?window:globalThis);
