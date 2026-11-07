/* R6 operator-initiated evidence collection and explicit admin approval.
 * No query or mutation happens during page initialization. Polling is read-only.
 */
;(function (root){
  'use strict';
  const URL='/api/blower-r6-rebaseline',TAG='204SDF01AN002',KEY='gsShiftLog.currentUser';
  let current=null,busy=false,continuing=false;
  const el=id=>root.document.getElementById(id);
  const stages=['fullA','fullB','prefix','suffix'];
  const labels={fullA:'전체 조회 A',fullB:'전체 조회 B',prefix:'경계 이전',suffix:'경계 이후'};
  const states={not_requested:'대기',pending:'접수',processing:'조회중',complete:'완료',failed:'실패'};
  const sleep=ms=>new Promise(resolve=>root.setTimeout(resolve,ms));
  function auth(){
    let state;try{state=JSON.parse(root.localStorage?.getItem(KEY)||'null')}catch{state=null}
    const token=String(state?.sessionToken||state?.session_token||'').trim();
    if(!token||token.length>8192)throw new Error('로그인된 제어실 PC에서 진행해 주세요.');
    return token;
  }
  async function req(method,body,id){
    const h={Authorization:'Bearer '+auth(),Accept:'application/json','X-GS-Client-Mode':'desktop'};
    if(body)h['Content-Type']='application/json; charset=utf-8';
    const url=URL+(id?'?id='+encodeURIComponent(id):'');
    const response=await root.fetch(url,{method,headers:h,cache:'no-store',credentials:'same-origin',...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    if(!response.ok||data.ok!==true)throw new Error(data?.message||'R6 서버 오류');
    return data;
  }
  function show(s){
    current=s;
    const c=s?.case,p=s?.proposal;
    el('blowerR6Status').textContent=!c?'검증을 실행하지 않았습니다. 기존 누적값은 유지됩니다.' :
      c.status==='applied'?'승인 후 누적시간과 감사이력이 함께 저장됐습니다. 전체 최신화를 실행해 주세요.' :
      c.status==='ready'?'독립 조회 4회 검증 완료 · 관리자 승인 대기' :
      c.status==='no_change'?'독립 조회 결과가 기존 누적값과 일치해 정정이 필요 없습니다.' :
      c.status==='cancelled'?'사용자가 검증을 취소했습니다. 누적값은 변경되지 않았습니다.' :
      `검증 진행 중 · 기존 ${(c.previousHours||0).toFixed(3)}시간 보호`;
    el('blowerR6Stages').replaceChildren(...(s?.stage||[]).map(v=>{
      const span=root.document.createElement('span');span.textContent=labels[v.role]+': '+(states[v.status]||v.status);return span;
    }));
    const active=!!c&&['collecting','ready'].includes(c.status);
    el('blowerR6Start').hidden=active;
    el('blowerR6Continue').hidden=!c||c.status!=='collecting';
    el('blowerR6Cancel').hidden=!active;
    el('blowerR6Proposal').hidden=c?.status!=='ready'||p?.status!=='requires_authorized_review';
    if(p?.status==='requires_authorized_review'){
      el('blowerR6Comparison').textContent=`변경 전 ${(p.previousSeconds/3600).toFixed(3)}h / 재검증 ${(p.proposedSeconds/3600).toFixed(3)}h / 전체 차이 ${p.totalDifferenceSeconds}초 / 경계 이전 ${p.historicalDifferenceSeconds}초 / 이후 ${p.suffixDifferenceSeconds}초 · 승인 전 저장 없음`;
    }
  }
  function setBusy(b){
    busy=b;
    for(const id of ['blowerR6Start','blowerR6Continue','blowerR6Cancel','blowerR6Approve'])el(id).disabled=b;
  }
  async function advanceOnce(){
    if(!current?.case||current.case.status!=='collecting')return;
    show(await req('POST',{action:'advance',id:current.case.id}));
  }
  async function collect(){
    if(busy)return;setBusy(true);continuing=true;
    try{
      for(let i=0;i<180&&continuing;i++){
        if(!current?.case||current.case.status!=='collecting')break;
        await advanceOnce();
        if(current.case.status!=='collecting')break;
        if((current.stage||[]).some(x=>x.status==='failed'))throw new Error('개별 DataPARC 조회가 실패했습니다. 현재 누적값을 유지합니다.');
        await sleep(3500);
        show(await req('GET',null,current.case.id));
      }
    }catch(e){el('blowerR6Status').textContent='R6 중단: '+String(e?.message||e).slice(0,400)+' · 기존 값 유지';}
    finally{continuing=false;setBusy(false)}
  }
  async function click(fn){
    if(busy)return;setBusy(true);
    try{show(await fn())}catch(e){el('blowerR6Status').textContent='R6 확인: '+String(e?.message||e).slice(0,400)+' · 기존 값 유지'}
    finally{setBusy(false)}
  }
  function init(){
    const panel=el('blowerR6Panel');if(!panel)return;
    let user;try{user=JSON.parse(root.localStorage?.getItem(KEY)||'null')}catch{user=null}
    if(!user?.sessionToken&&!user?.session_token)return;
    const mobile=root.matchMedia?.('(max-width:700px), (max-width:1024px) and (hover:none) and (pointer:coarse)')?.matches;
    if(mobile)return;
    panel.hidden=false;
    el('blowerR6Start').addEventListener('click',async()=>{
      await click(()=>req('POST',{action:'begin'}));
      if(current?.case?.status==='collecting')collect();
    });
    el('blowerR6Continue').addEventListener('click',collect);
    el('blowerR6Cancel').addEventListener('click',()=>{
      if(!root.confirm('R6 독립 실측 검증을 취소할까요? 누적시간은 변경되지 않습니다.'))return;
      continuing=false;click(()=>req('POST',{action:'cancel',id:current.case.id}));
    });
    el('blowerR6Approve').addEventListener('click',()=>{
      if(!current?.case||current.case.status!=='ready')return;
      const confirmation=el('blowerR6Confirmation').value.trim(),note=el('blowerR6Note').value.trim();
      if(confirmation!==TAG||note.length<10){el('blowerR6Status').textContent='대상 TAG 정확히 입력하고 정정 사유를 10자 이상 작성해 주세요.';return;}
      if(!root.confirm('검증된 전체 RUN으로 누적시간을 정정하고 변경 전·후를 이력에 저장할까요?'))return;
      click(()=>req('POST',{action:'approve',id:current.case.id,confirmation,note}));
    });
    click(()=>req('GET'));
  }
  if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})(typeof window!=='undefined'?window:globalThis);
