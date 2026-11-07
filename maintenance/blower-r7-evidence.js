/* R7 opt-in, read-only closure evidence. This UI never calls an asset update. */
;(function(root){
  'use strict';
  const KEY='gsShiftLog.currentUser',URL='/api/ois-data-requests',TAG={
    fbhe1b_zero:{tag:'104HHL60AP621',signal:'GSPOGE.ABB_DCS.104HHL60AP621XB04',start:'2026-10-08T13:04:00+09:00'},
    limestone2a_leading:{tag:'203HRJ01AN601',signal:'GSPOGE.ABB_DCS.203HRJ01AN601XB04',start:'2026-09-19T00:00:00+09:00',end:'2026-09-20T00:00:00+09:00'}
  };
  const ids={fbhe1b_zero:{start:'blowerR7FbheStart',check:'blowerR7FbheCheck',status:'blowerR7FbheStatus'},
    limestone2a_leading:{start:'blowerR7LimestoneStart',check:'blowerR7LimestoneCheck',status:'blowerR7LimestoneStatus'}};
  const local={fbhe1b_zero:null,limestone2a_leading:null};let busy=false;
  const el=id=>root.document.getElementById(id);
  function auth(){let data;try{data=JSON.parse(root.localStorage.getItem(KEY)||'null')}catch{data=null}
    const token=String(data?.sessionToken||data?.session_token||'').trim();
    if(!token||token.length>8192)throw new Error('로그인된 제어실 PC에서 진행해 주세요.');return token;}
  async function request(url,method='GET',body){const h={Authorization:'Bearer '+auth(),Accept:'application/json','X-GS-Client-Mode':'desktop'};
    if(body)h['Content-Type']='application/json; charset=utf-8';
    const res=await root.fetch(url,{method,headers:h,cache:'no-store',credentials:'same-origin',...(body?{body:JSON.stringify(body)}:{})});
    const response=await res.json();if(!res.ok||response.ok!==true)throw new Error(String(response?.message||'조회 요청 실패').slice(0,200));return response;}
  function setStatus(kind,message){el(ids[kind].status).textContent=message;}
  function setBusy(value){busy=value;for(const item of Object.values(ids)){el(item.start).disabled=value;el(item.check).disabled=value;}}
  function storageKey(kind,actor){return 'gs-blower-r7:'+kind+':'+actor;}
  function actor(){let state;try{state=JSON.parse(root.localStorage.getItem(KEY)||'null')}catch{state=null};
    return String(state?.employeeNo||state?.employee_no||state?.user?.employeeNo||'');}
  function setRequestId(kind,id){local[kind]=id;
    if(id&&actor())try{root.sessionStorage.setItem(storageKey(kind,actor()),id)}catch{}}
  function getRequestId(kind){if(local[kind])return local[kind];
    if(actor())try{return root.sessionStorage.getItem(storageKey(kind,actor()))||''}catch{}return '';}
  async function start(kind){
    if(busy)return;setBusy(true);const plan=TAG[kind];try{
      const state=await request('/api/blower-history');
      if(state.permissions?.isSuperAdmin!==true && state.user?.isSuperAdmin!==true)throw new Error('최고관리자 권한이 필요합니다.');
      const asset=(state.assets||[]).find(item=>item.tagNumber===plan.tag);
      if(!asset||!asset.cycleRuntimeRevision||!asset.cycleStartRevision)throw new Error('현재 Blower 저장 기준을 읽을 수 없습니다.');
      const body={action:'create_blower_runtime_probe',r7EvidenceMode:kind,unifiedRefresh:true,
        incrementalRefresh:false,requireIncrementalAppend:false,assetTag:plan.tag,dataParcTag:plan.signal,
        confirmRunSignal:true,startAt:plan.start,expectedLastReplacementAt:asset.lastReplacementAt,
        expectedCycleStartState:asset.cycleStartState||'legacy',expectedCycleStartedAt:asset.cycleStartedAt||'',
        expectedCycleStartRevision:asset.cycleStartRevision,expectedCycleRuntimeRevision:asset.cycleRuntimeRevision};
      const result=await request(URL,'POST',body);
      const id=String(result.item?.id||result.items?.[0]?.id||result.requestId||'');
      if(!id)throw new Error('읽기 전용 조회 요청 ID가 없습니다.');
      setRequestId(kind,id);setStatus(kind,'요청 접수: '+id+' · 결과 확인 버튼으로 조회하세요. 기존 누적시간은 변경되지 않습니다.');
    }catch(error){setStatus(kind,'요청 중단: '+String(error.message||error).slice(0,240)+' · 저장값 유지');}
    finally{setBusy(false)}
  }
  function validate(kind,item,id){
    const p=TAG[kind],v=item?.result,x=item?.probe;
    const stamp=value=>typeof value==='string'?Date.parse(value):NaN;
    const invalid=msg=>({valid:false,message:msg});
    if(item?.status!=='complete'||item.requestType!=='blower_runtime_probe'||item.id!==id||
      !x||!v||x.requestId!==id||v.requestId!==id||v.ok!==true||v.readOnly!==true||v.schemaVersion!==1||
      v.requestType!=='blower_runtime_probe'||x.assetTag!==p.tag||v.assetTag!==p.tag||
      x.dataParcTag!==p.signal||v.dataParcTag!==p.signal||
      stamp(v.startAt)!==stamp(x.startAt)||stamp(v.startAt)!==stamp(p.start)||
      stamp(v.endAt)!==stamp(x.endAt)||stamp(v.observedAt)!==stamp(v.endAt)||
      (p.end&&stamp(v.endAt)!==stamp(p.end))||
      !String(x.expectedCycleRuntimeRevision||'').startsWith('r7-evidence-only-v1:')||
      v.expectedCycleRuntimeRevision!==x.expectedCycleRuntimeRevision)
      return invalid('요청 TAG·신호·기간·조회 결과가 일치하지 않습니다.');
    if(!Array.isArray(v.chunks)||v.chunks.length!==v.chunkCount||v.chunkCount!==v.completedChunkCount||
      v.chunkCount!==x.chunkCount||!v.chunkCount||!['stopped','running'].includes(v.startState)||!['stopped','running'].includes(v.endState))
      return invalid('분할 조회가 누락됐거나 상태가 확인되지 않았습니다.');
    let sum=0,end=stamp(v.startAt),state=v.startState;
    for(let i=0;i<v.chunks.length;i++){
      const c=v.chunks[i];if(c?.index!==i+1||stamp(c.startAt)!==end||!(stamp(c.endAt)>end)||c.startState!==state||
        !['stopped','running'].includes(c.endState)||!Number.isSafeInteger(c.runningSeconds)||c.runningSeconds<0||
        c.runningSeconds>(stamp(c.endAt)-end)/1000+2||typeof c.totalRunningHours!=='number'||
        Math.abs(c.totalRunningHours*3600-c.runningSeconds)>2)return invalid('중간 RUN 상태·측정 구간이 일치하지 않습니다.');
      sum+=c.runningSeconds;end=stamp(c.endAt);state=c.endState;
    }
    if(end!==stamp(v.endAt)||state!==v.endState||sum!==v.runningSeconds||
      typeof v.totalRunningHours!=='number'||Math.abs(v.totalRunningHours*3600-sum)>2)
      return invalid('전체 RUN 합계가 분할 결과와 다릅니다.');
    return {valid:true,seconds:sum,startAt:v.startAt,endAt:v.endAt,zero:sum===0&&v.startState==='stopped'&&v.endState==='stopped'};
  }
  async function check(kind){if(busy)return;const id=getRequestId(kind);
    if(!id){setStatus(kind,'접수된 조회가 없습니다. 먼저 조회 요청을 실행하세요.');return;}
    setBusy(true);try{
      const r=await request(URL+'?id='+encodeURIComponent(id)+'&_='+Date.now());
      const item=r.item?.id===id?r.item:null;
      if(!item)throw new Error('요청을 찾지 못했습니다.');
      if(item.status==='failed'){setStatus(kind,'조회 실패: '+String(item.errorMessage||'Agent 조회 실패')+' · 저장값 유지');return;}
      if(item.status!=='complete'){setStatus(kind,'진행 중: '+item.status+' · 이미 접수된 요청을 계속 확인하세요.');return;}
      const result=validate(kind,item,id);
      if(!result.valid){setStatus(kind,'증거 검증 실패: '+result.message+' · 저장값 유지');return;}
      const tail=kind==='fbhe1b_zero'?(result.zero?
        '연속 정지의 측정 후보입니다. 승인 원문·수집 품질 검토 후에만 종결 가능합니다.':'RUN이 확인되어 교체 완료시각 확인이 필요합니다.'):
        '9/19 RUN의 교체 전후 구분을 위해 실제 완료시각 확인이 필요합니다.';
      setStatus(kind,'측정 완료 · '+result.seconds+'초 ('+(result.seconds/3600).toFixed(3)+'시간) · '+tail+' 요청: '+id);
    }catch(error){setStatus(kind,'확인 중단: '+String(error.message||error).slice(0,240)+' · 저장값 유지');}
    finally{setBusy(false)}
  }
  function init(){const panel=el('blowerR7Panel');if(!panel)return;
    let data;try{data=JSON.parse(root.localStorage.getItem(KEY)||'null')}catch{data=null}
    if(!data?.sessionToken&&!data?.session_token)return;
    if(root.matchMedia?.('(max-width:700px), (max-width:1024px) and (hover:none) and (pointer:coarse)')?.matches)return;
    panel.hidden=false;
    for(const [kind,items] of Object.entries(ids)){
      el(items.start).addEventListener('click',()=>start(kind));el(items.check).addEventListener('click',()=>check(kind));
      if(getRequestId(kind))setStatus(kind,'접수된 이전 요청이 있습니다. 결과 확인을 눌러주세요.');
    }
  }
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(typeof window!=='undefined'?window:globalThis);
