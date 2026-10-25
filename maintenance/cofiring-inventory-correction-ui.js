(function(root){
  'use strict';
  const model=root.CofiringInventoryCorrection||(typeof require==='function'?require('./cofiring-inventory-correction.js'):null);
  const API='/api/cofiring-inventory-corrections';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const evidenceIdentity=refs=>JSON.stringify(refs.map(({id,version})=>({id,version})).sort((a,b)=>a.id.localeCompare(b.id)));
  const key=entry=>`${entry.silo}|${entry.boundaryLocal}`;
  const label={organicDaySilo:'Day Silo',organicStorageSiloA:'Storage A',organicStorageSiloB:'Storage B'};
  const validPeriod=spec=>model?.localMinute(spec?.startLocal)!==null&&model?.localMinute(spec?.endLocal)!==null&&model.localMinute(spec.endLocal)>model.localMinute(spec.startLocal);
  function parseTons(value){const raw=String(value??'').trim();if(!/^\d+(?:\.\d{1,6})?$/.test(raw))throw Error('재고를 0 이상, 소수점 6자리 이하의 ton 값으로 입력해 주세요.');const n=Number(raw);if(!Number.isFinite(n)||n>1000000)throw Error('재고 범위를 확인해 주세요.');return n;}
  function createStore(options={}){
    let spec=null,identity='',generation=0,disposed=false,pending=null,evidenceRequests=new Map();
    let current={loaded:false,loading:false,saving:false,error:'',entries:[],history:[],historyTruncated:false,evidence:{}};
    const headers=()=>options.getHeaders?.()||{};
    const credential=()=>String(headers().Authorization||headers().authorization||'').trim();
    const authenticated=()=>/^Bearer\s+\S+/i.test(identity);
    function changed(){if(!disposed)options.onChange?.();}
    function reset(){generation++;pending=null;evidenceRequests.clear();current={loaded:false,loading:false,saving:false,error:'',entries:[],history:[],historyTruncated:false,evidence:{}};}
    function syncIdentity(){const next=credential();if(identity!==next){identity=next;reset();}}
    function state(){syncIdentity();return {...clone(current),spec:spec?{...spec}:null,authenticated:authenticated(),canEdit:authenticated()&&options.canEdit?.()!==false};}
    function select(next){syncIdentity();const value=validPeriod(next)?{startLocal:next.startLocal,endLocal:next.endLocal}:null;if(JSON.stringify(value)!==JSON.stringify(spec)){spec=value;reset();}return state();}
    const still=(epoch,auth,period)=>!disposed&&epoch===generation&&auth===credential()&&JSON.stringify(spec)===period;
    async function request(url,init={}){const res=await (options.fetch||root.fetch)(url,{...init,credentials:'same-origin',cache:'no-store'});let payload;try{payload=await res.json();}catch(_){throw Error('재고 보완 서버 응답을 확인하지 못했습니다.');}if(!res.ok||payload?.ok!==true){const err=Error(payload?.message||'재고 보완 요청을 처리하지 못했습니다.');err.status=res.status;err.payload=payload;throw err;}return payload;}
    function validateEntries(entries){if(!Array.isArray(entries)||entries.length>6)throw Error('재고 보완 응답을 확인해 주세요.');const seen=new Set();for(const entry of entries){if(!model.validCorrection(entry)||![spec.startLocal,spec.endLocal].includes(entry.boundaryLocal)||seen.has(key(entry)))throw Error('재고 보완값의 기간·이력을 확인해 주세요.');seen.add(key(entry));}return clone(entries);}
    async function load({force=false}={}){
      syncIdentity();if(!spec||!authenticated()){reset();changed();return false;}if(current.saving)return false;if(pending)return pending;if(current.loaded&&!force)return true;
      const epoch=generation,auth=identity,period=JSON.stringify(spec),selected={...spec};current.loading=true;current.loaded=false;current.error='';current.entries=[];changed();
      const task=(async()=>{try{const payload=await request(`${API}?start=${encodeURIComponent(selected.startLocal)}&end=${encodeURIComponent(selected.endLocal)}`,{headers:{...headers(),Accept:'application/json'}});if(!still(epoch,auth,period))return false;if(payload.start!==selected.startLocal||payload.end!==selected.endLocal)throw Error('다른 기간의 재고 보완 응답입니다.');current.entries=validateEntries(payload.entries);current.history=Array.isArray(payload.history)?payload.history.filter(model.validCorrection):[];current.historyTruncated=payload.historyTruncated===true;current.loaded=true;return true;}catch(err){if(still(epoch,auth,period)){current.error=err.message;current.entries=[];current.loaded=false;}return false;}finally{if(still(epoch,auth,period)){current.loading=false;pending=null;changed();}}})();pending=task;return task;
    }
    async function evidence(boundaryLocal,{force=false}={}){
      syncIdentity();if(!spec||!authenticated()||![spec.startLocal,spec.endLocal].includes(boundaryLocal))return false;
      if(!force&&['loading','ready'].includes(current.evidence[boundaryLocal]?.status))return true;
      const epoch=generation,auth=identity,period=JSON.stringify(spec),token=Symbol(boundaryLocal);evidenceRequests.set(boundaryLocal,token);const currentRequest=()=>still(epoch,auth,period)&&evidenceRequests.get(boundaryLocal)===token;current.evidence[boundaryLocal]={status:'loading',records:[],error:''};changed();
      try{const payload=await request(`/api/solid-fuel-trouble?inventoryBoundary=${encodeURIComponent(boundaryLocal)}`,{headers:{...headers(),Accept:'application/json'}});if(!currentRequest())return false;if(payload.boundaryLocal!==boundaryLocal||payload.source!=='solid-fuel-unloading'||payload.basis!=='completed-unloading-departure'||!Array.isArray(payload.records)||payload.records.length>1000)throw Error('입고·하역 근거의 조회 범위를 확인해 주세요.');const seen=new Set();for(const row of payload.records){if(typeof row.id!=='string'||!row.id||!Number.isSafeInteger(row.version)||row.version<1||seen.has(row.id))throw Error('입고·하역 근거의 이력을 확인해 주세요.');seen.add(row.id);}current.evidence[boundaryLocal]={status:'ready',records:clone(payload.records),truncated:payload.truncated===true,error:''};return true;}catch(err){if(currentRequest())current.evidence[boundaryLocal]={status:'error',records:[],error:err.message};return false;}finally{if(currentRequest())changed();}
    }
    function requestId(){if(root.crypto?.randomUUID)return root.crypto.randomUUID();throw Error('저장 요청 ID를 만들 수 없습니다. 화면을 새로고침해 주세요.');}
    async function save(input){
      syncIdentity();if(!spec||!authenticated()||options.canEdit?.()===false||!current.loaded||current.loading||current.saving)return false;
      if(!label[input?.silo]||![spec.startLocal,spec.endLocal].includes(input.boundaryLocal))throw Error('보완할 재고 시각을 확인해 주세요.');
      const tons=parseTons(input.tons),method=input.method,reason=String(input.reason||'').trim();if(!['confirmed','estimated'].includes(method)||reason.length<5||reason.length>1000)throw Error('확정값·추정값을 선택하고 근거를 5~1,000자로 적어 주세요.');
      const evidenceRefs=Array.isArray(input.evidence)?input.evidence:[];if(evidenceRefs.length>32)throw Error('근거 기록을 32개 이하로 선택해 주세요.');
      const selectedEvidence=current.evidence[input.boundaryLocal];for(const ref of evidenceRefs){const retained=current.entries.find(entry=>key(entry)===key(input))?.evidence?.some(row=>row.id===ref.id&&row.version===ref.version);if(selectedEvidence?.status==='ready'?!selectedEvidence.records.some(row=>row.id===ref.id&&row.version===ref.version):!retained)throw Error('선택한 입고·하역 기록을 다시 불러와 주세요.');}
      const previous=current.entries.find(entry=>key(entry)===key(input)),epoch=generation,auth=identity,period=JSON.stringify(spec);
      const body={silo:input.silo,boundaryLocal:input.boundaryLocal,tons,method,reason,evidence:clone(evidenceRefs),expectedRevision:previous?.revision||0,requestId:requestId()};current.saving=true;current.error='';changed();
      try{const payload=await request(API,{method:'POST',headers:{...headers(),Accept:'application/json','Content-Type':'application/json','X-ShiftLog-Client':'desktop'},body:JSON.stringify(body)});if(!still(epoch,auth,period))return false;const entry=payload.entry;if(!model.validCorrection(entry)||key(entry)!==key(body)||entry.revision!==body.expectedRevision+1||entry.tons!==tons||entry.method!==method||entry.reason!==reason||evidenceIdentity(entry.evidence)!==evidenceIdentity(body.evidence))throw Error('재고 보완 저장 확인값이 요청과 다릅니다. 다시 불러와 주세요.');current.entries=current.entries.filter(item=>key(item)!==key(entry)).concat(clone(entry));current.history=[clone(entry),...current.history];return true;}catch(err){if(still(epoch,auth,period)){current.error=err.status===409?'다른 화면의 수정 또는 입고기록 변경이 있습니다. 입력한 내용은 유지됩니다. 최신 기록을 다시 불러온 뒤 확인해 주세요.':(err.message||'재고 보완 저장 완료를 확인하지 못했습니다.')+' 입력한 내용은 유지됩니다. 최신 기록을 다시 불러와 저장 결과를 확인해 주세요.';current.loaded=false;current.entries=[];}return false;}finally{if(still(epoch,auth,period)){current.saving=false;changed();}}
    }
    function dispose(){disposed=true;reset();}
    return {select,state,load,evidence,save,dispose};
  }
  const evidenceFlags={'arrival-time-unknown':'입차 시각 미확인','departure-time-unknown':'하역 완료 시각 미확인','duration-unknown':'하역 시간 미확인','receipt-tons-unknown':'입고량 미기록','fuel-type-unknown':'연료 구분 미확인','silo-allocation-unknown':'Silo별 배분량 미확인','crosses-boundary':'경계 시각에 하역 중','cross-midnight':'자정을 넘긴 하역','missing-time':'시각 미기록','unknown-duration':'하역 시간 미확인','missing-weight':'입고량 미기록','unknown-destination':'하역 경로 미확인','multiple-destinations':'여러 Silo 하역','incomplete-times':'시각 미기록','boundary-in-progress':'경계 시각에 하역 중'};
  function evidenceMarkup(value,index){
    if(!value||value.status==='loading')return '<p>고형연료 관리의 입고·하역 기록을 확인 중입니다.</p>';
    if(value.status==='error')return `<p role="alert">${esc(value.error)}</p>`;
    const rows=value.records.map((row,n)=>`<tr><td><input type="checkbox" data-cfv-inventory-evidence="${index}:${n}" aria-label="${esc(row.vehicleNo||row.companyName||'입고 기록')} 근거 선택"></td><td>${esc(row.arrivalLocal||row.arrivalTime||'시각 미기록')}</td><td>${esc(row.departureLocal||row.departureTime||'하역 완료 미기록')}</td><td>${esc(row.companyName)}<br>${esc(row.vehicleNo)}</td><td>${esc(({organic:'유기성',manure:'축분'})[row.fuelType]||'연료 미기록')}</td><td>${typeof row.receiptTons==='number'&&Number.isFinite(row.receiptTons)?esc(row.receiptTons):'수량 미기록'}</td><td>${esc(row.siloRoute||'경로 미기록')}</td><td>${esc(row.note||'')}${Array.isArray(row.flags)?'<br>'+esc(row.flags.map(flag=>evidenceFlags[flag]||'기록 추가 확인 필요').join(' · ')):''}</td></tr>`).join('');
    return `<p>해당 경계 전후 입고·하역 기록${value.truncated?' · 일부 기록만 표시됨':''}</p>${rows?`<div class="cfv-inventory-table-wrap"><table><thead><tr><th>근거</th><th>입차</th><th>하역 완료</th><th>업체·차량</th><th>연료</th><th>입고량(t)</th><th>하역 경로</th><th>비고</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p>조회 범위에 기록이 없습니다. 무입고·무이송을 뜻하지 않습니다.</p>'}`;
  }
  function historyMarkup(entries,entry,truncated){
    const list=entries.length?entries:entry?[entry]:[];if(!list.length)return '';
    return '<details class="cfv-inventory-history"><summary>보완 이력 · '+list.length+'건'+(truncated?' (최근 이력)':'')+'</summary><ol>'+list.map(item=>'<li><strong>v'+item.revision+' · '+esc(item.tons)+' t · '+(item.method==='estimated'?'추정':'확정')+'</strong><span> · '+esc(item.updatedByName||item.updatedById)+' · '+esc(item.updatedAt)+'</span><p>'+esc(item.reason)+'</p><p>저장 당시 근거: '+(item.evidence.length?item.evidence.map(ref=>{const snapshot=item.evidenceSnapshots?.find(row=>row.id===ref.id&&row.version===ref.version);return esc([snapshot?.companyName,snapshot?.vehicleNo,snapshot?.arrivalLocal,snapshot?.departureLocal,snapshot?.siloRoute].filter(Boolean).join(' · '))+' (기록 '+esc(ref.id)+' · v'+ref.version+')';}).join('<br>'):'연결된 입고기록 없음 · 위 사유 참조')+'</p></li>').join('')+'</ol></details>';
  }
  function create(options={}){
    const host=options.host;let reference=null,spec=null,disposed=false,scheduled=false,lastRender='',drafts=new Map(),openBoundaries=new Set(),contextKey='';
    const store=createStore({...options,onChange:()=>{render();if(!scheduled){scheduled=true;Promise.resolve().then(()=>{scheduled=false;if(!disposed)options.onChange?.();});}}});
    const entries=()=>{const s=store.state();return s.loaded&&!s.loading?s.entries:[];};
    const resolution=()=>reference&&spec?model.resolve(reference,entries(),spec):null;
    function setContext(nextSpec,nextReference){
      const auth=String(options.getHeaders?.().Authorization||options.getHeaders?.().authorization||''),nextKey=JSON.stringify([nextSpec?.startLocal,nextSpec?.endLocal,auth]);
      if(nextKey!==contextKey){contextKey=nextKey;drafts=new Map();openBoundaries=new Set();lastRender='';}
      const changed=reference!==nextReference;spec=nextSpec;reference=nextReference;store.select(spec);
      const missing=reference&&spec?model.resolve(reference,[],spec).missing||[]:[];
      if(changed||nextKey!==lastRender)render();
      const state=store.state();if(missing.length&&!state.loaded&&!state.loading&&!state.error&&state.authenticated)void store.load();
    }
    function render(){
      if(!host)return;const result=resolution(),missing=result?.missing||[],state=store.state();
      host.hidden=!reference||!missing.length;if(host.hidden){host.innerHTML='';return;}
      const context=JSON.stringify([contextKey,missing,state.entries,state.history,state.historyTruncated,state.loaded,state.loading,state.saving,state.error,state.evidence]);if(context===lastRender)return;lastRender=context;
      host.innerHTML=`<div class="cfv-inventory-heading"><strong>통신 오류 재고 보완</strong><button type="button" data-cfv-inventory-reload ${state.loading||state.saving?'disabled':''}>최신 기록 다시 확인</button></div><p>정상 Coal·Bio 사용량은 그대로 표시합니다. 확인되지 않은 재고만 보완하며, 같은 시각의 재고는 전날 종료와 다음 날 시작에 함께 사용합니다.</p><p class="cfv-inventory-caution">입고·하역 기록은 외부 반입 근거입니다. 입고가 없어도 Storage → Day Silo 이송은 있을 수 있습니다. 하역 전후 재고와 운전기록으로 경계 시각의 재고를 확인하세요. 추정값은 임시 계산에만 사용하며, 사용량 저장·마감은 확정 후 가능합니다.</p>${state.error?`<p role="alert">${esc(state.error)}</p>`:state.loading?'<p role="status">저장된 보완 이력 확인 중</p>':''}${missing.map((item,index)=>{
        const entry=state.entries.find(row=>key(row)===key(item)),draft=drafts.get(key(item))||{tons:entry?.tons??'',method:entry?.method||'estimated',reason:entry?.reason||'',evidence:entry?.evidence||[]};
        const disabled=!state.canEdit||!state.loaded||state.loading||state.saving;
        return `<section class="cfv-inventory-boundary"><h4>${esc(item.label||label[item.silo])} · ${esc(item.boundaryLocal?.replace('T',' '))} <small>${item.side==='start'?'시작':'종료'} 재고</small></h4><p>원본: ${esc(item.quality||'품질 미확인')} · ${esc(item.returnedTime||'시각 미확인')} · ${esc(item.reason||'유효한 경계 재고 없음')}</p>${entry?`<p class="cfv-inventory-audit">적용 이력 v${entry.revision} · ${entry.method==='confirmed'?'확정':'추정'} ${esc(entry.tons)} t · ${esc(entry.updatedByName||entry.updatedById)} · ${esc(entry.updatedAt)}<br>근거: ${esc(entry.reason)}</p>`:''}<div class="cfv-inventory-fields"><label>보완 재고(t)<input type="text" inputmode="decimal" data-cfv-inventory-tons="${index}" value="${esc(draft.tons)}" ${disabled?'disabled':''}></label><label>값 구분<select data-cfv-inventory-method="${index}" ${disabled?'disabled':''}><option value="estimated" ${draft.method==='estimated'?'selected':''}>추정값 · 임시 계산</option><option value="confirmed" ${draft.method==='confirmed'?'selected':''}>확정값 · 근거 확인 완료</option></select></label><label class="cfv-inventory-reason">재고 확인 근거<textarea data-cfv-inventory-reason="${index}" rows="2" maxlength="1000" placeholder="확인한 재고·시각, 운전기록 또는 추정 방법을 적어 주세요." ${disabled?'disabled':''}>${esc(draft.reason)}</textarea></label></div><details data-cfv-inventory-details="${index}" ${openBoundaries.has(key(item))?'open':''}><summary>고형연료 관리 입고·하역 근거 보기</summary>${evidenceMarkup(state.evidence[item.boundaryLocal],index)}</details>${historyMarkup(state.history.filter(row=>key(row)===key(item)),entry,state.historyTruncated)}<button type="button" data-cfv-inventory-save="${index}" ${disabled?'disabled':''}>재고 보완 이력 저장·적용</button><p data-cfv-inventory-message="${index}" role="status"></p></section>`;
      }).join('')}<p class="cfv-inventory-foot">원본 계측값과 기존 마감 내역은 변경하지 않습니다. 확정 보완값을 반영한 마감은 계산 내용을 확인한 뒤 별도로 저장하세요.</p>`;
      function draftFor(item,index){const evidenceState=state.evidence[item.boundaryLocal],records=evidenceState?.records||[],previous=drafts.get(key(item))||state.entries.find(row=>key(row)===key(item));const selected=evidenceState?.status==='ready'?[]:clone(previous?.evidence||[]);for(const [n,row] of records.entries()){if(host.querySelector(`[data-cfv-inventory-evidence="${index}:${n}"]`)?.checked)selected.push({id:row.id,version:row.version});}return {tons:host.querySelector(`[data-cfv-inventory-tons="${index}"]`)?.value??'',method:host.querySelector(`[data-cfv-inventory-method="${index}"]`)?.value||'estimated',reason:host.querySelector(`[data-cfv-inventory-reason="${index}"]`)?.value||'',evidence:selected};}
      for(const [index,item] of missing.entries()){
        const draft=drafts.get(key(item))||state.entries.find(row=>key(row)===key(item));
        const detail=host.querySelector(`[data-cfv-inventory-details="${index}"]`);if(detail)detail.open=openBoundaries.has(key(item));
        if(draft){const method=host.querySelector(`[data-cfv-inventory-method="${index}"]`);if(method)method.value=draft.method;const reason=host.querySelector(`[data-cfv-inventory-reason="${index}"]`);if(reason)reason.value=draft.reason;for(const [n,row] of (state.evidence[item.boundaryLocal]?.records||[]).entries()){const input=host.querySelector(`[data-cfv-inventory-evidence="${index}:${n}"]`);if(input)input.checked=draft.evidence?.some(e=>e.id===row.id&&e.version===row.version)||false;}}
        for(const attr of ['tons','method','reason']){const el=host.querySelector(`[data-cfv-inventory-${attr}="${index}"]`);el?.addEventListener('input',()=>drafts.set(key(item),draftFor(item,index)));el?.addEventListener('change',()=>drafts.set(key(item),draftFor(item,index)));}
        for(const [n] of (state.evidence[item.boundaryLocal]?.records||[]).entries())host.querySelector(`[data-cfv-inventory-evidence="${index}:${n}"]`)?.addEventListener('change',()=>drafts.set(key(item),draftFor(item,index)));
        host.querySelector(`[data-cfv-inventory-details="${index}"]`)?.addEventListener('toggle',event=>{if(event.target.open){openBoundaries.add(key(item));void store.evidence(item.boundaryLocal);}else openBoundaries.delete(key(item));});
        host.querySelector(`[data-cfv-inventory-save="${index}"]`)?.addEventListener('click',async()=>{const value=draftFor(item,index);drafts.set(key(item),value);try{if(await store.save({...item,...value})){drafts.delete(key(item));lastRender='';render();}}catch(err){const message=host.querySelector(`[data-cfv-inventory-message="${index}"]`);if(message)message.textContent=err.message;}});
      }
      host.querySelector('[data-cfv-inventory-reload]')?.addEventListener('click',()=>{void refresh({force:true});});
    }
    async function refresh({force=false}={}){if(!reference||!(resolution()?.missing||[]).length)return true;const loaded=await store.load({force});if(force){for(const boundary of [...new Set((resolution()?.missing||[]).map(item=>item.boundaryLocal))])await store.evidence(boundary,{force:true});}return loaded;}
    function usage(receipt,options){return model.usage(reference,receipt,spec,entries(),options);}
    function dispose(){disposed=true;store.dispose();if(host)host.innerHTML='';}
    return {setContext,refresh,usage,state:store.state,dispose};
  }
  root.CofiringInventoryCorrectionUI={create,createStore,parseTons,evidenceMarkup,historyMarkup};
  if(typeof module==='object'&&module.exports)module.exports=root.CofiringInventoryCorrectionUI;
})(typeof globalThis==='object'?globalThis:this);
