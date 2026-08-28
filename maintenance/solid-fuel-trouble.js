"use strict";
/* SOLID-FUEL-TROUBLE-V3.1.3 · simple time entry + current Silo choices + legacy route preservation */
(function(){
  const API="/api/solid-fuel-trouble",AUTH="gsShiftLog.currentUser";
  const SILO_OPTIONS=[["","선택 안 함"],["#A","Storage #A"],["#B","Storage #B"],["Day","Day Silo"]];
  const state={troubles:[],unloads:[],companies:[],filterCompanies:[],companyDirectory:[],permissions:{canCreate:false,canEdit:false,canDelete:false,canUploadPhoto:false,canManageUnloading:false,canManageCompanies:false},loading:false,saving:false,mode:"month",tab:"trouble",photoScale:1};
  const $=id=>document.getElementById(id);
  const e={
    refresh:$("refreshBtn"),createRecord:$("createRecordBtn"),companyManage:$("companyManageBtn"),
    mode:$("queryMode"),form:$("filterForm"),monthBox:$("monthFilterBox"),rangeBox:$("rangeFilterBox"),month:$("filterMonth"),from:$("filterFrom"),to:$("filterTo"),company:$("filterCompany"),vehicle:$("filterVehicle"),search:$("filterSearch"),sort:$("filterSort"),reset:$("resetBtn"),
    troubleKpi:$("troubleKpi"),unloadKpi:$("unloadKpi"),averageKpi:$("averageKpi"),averageUnit:$("averageKpiUnit"),abnormalKpi:$("abnormalKpi"),maxKpi:$("maxKpi"),maxUnit:$("maxKpiUnit"),
    companyStats:$("companyStats"),siloStats:$("siloStats"),analyticsStatus:$("analyticsStatus"),
    tabs:document.querySelector(".tabs"),troublePanel:$("troublePanel"),unloadPanel:$("unloadPanel"),troubleTabCount:$("troubleTabCount"),unloadTabCount:$("unloadTabCount"),
    status:$("statusText"),unloadStatus:$("unloadStatusText"),troubleBody:$("troubleBody"),unloadBody:$("unloadBody"),
    rModal:$("recordModal"),rClose:$("recordClose"),rCancel:$("recordCancel"),rForm:$("recordForm"),rDate:$("recordDate"),rCompany:$("recordCompany"),rVehicle:$("recordVehicle"),rArrival:$("recordArrival"),rDeparture:$("recordDeparture"),rDuration:$("recordDurationPreview"),rSilo:$("recordSilo"),rNote:$("recordNote"),rTroubleFields:$("recordTroubleFields"),rEquipment:$("recordEquipment"),rFiles:$("recordFiles"),rStatus:$("recordEditorStatus"),rSave:$("recordSave"),
    tModal:$("troubleModal"),tTitle:$("troubleEditorTitle"),tClose:$("troubleClose"),tCancel:$("troubleCancel"),tForm:$("troubleForm"),tId:$("troubleId"),tVersion:$("troubleVersion"),tDate:$("troubleDate"),tCompany:$("troubleCompany"),tVehicle:$("troubleVehicle"),tEquipment:$("troubleEquipment"),tNote:$("troubleNote"),tFiles:$("troubleFiles"),existing:$("existingPhotos"),tStatus:$("troubleEditorStatus"),tSave:$("troubleSave"),
    uModal:$("unloadModal"),uTitle:$("unloadEditorTitle"),uClose:$("unloadClose"),uCancel:$("unloadCancel"),uForm:$("unloadForm"),uId:$("unloadId"),uVersion:$("unloadVersion"),uDate:$("unloadDate"),uArrival:$("unloadArrival"),uDeparture:$("unloadDeparture"),uDuration:$("unloadDurationPreview"),uCompany:$("unloadCompany"),uVehicle:$("unloadVehicle"),uSilo:$("unloadSilo"),uNote:$("unloadNote"),uStatus:$("unloadEditorStatus"),uSave:$("unloadSave"),
    companyModal:$("companyModal"),companyClose:$("companyClose"),companyCancel:$("companyCancel"),companyAddForm:$("companyAddForm"),companyNameInput:$("companyNameInput"),companyAddButton:$("companyAddButton"),companyManagerList:$("companyManagerList"),companyManagerStatus:$("companyManagerStatus"),
    photoModal:$("photoModal"),photo:$("photoImage"),photoClose:$("photoClose"),photoStage:$("photoStage"),zoomOut:$("zoomOut"),zoomIn:$("zoomIn"),zoomFit:$("zoomFit"),zoomRange:$("zoomRange"),zoomText:$("zoomText")
  };
  function current(){try{return JSON.parse(localStorage.getItem(AUTH)||"null")}catch{return null}}
  function token(){const u=current();return String(u?.sessionToken||u?.session_token||u?.accessToken||u?.access_token||u?.token||u?.session?.token||"").trim()}
  function headers(extra={}){const t=token();return {Accept:"application/json",...(t?{Authorization:`Bearer ${t}`}:{ }),...extra}}
  async function readResponse(r){const txt=await r.text();let o={};if(txt.trim()){try{o=JSON.parse(txt)}catch{throw new Error(`서버 응답 형식 오류 (HTTP ${r.status})`)}}if(r.status===401)setTimeout(()=>location.assign("/"),500);if(!r.ok||o.ok===false){const x=new Error(o.message||`요청 실패 (HTTP ${r.status})`);x.status=r.status;throw x}return o}
  async function api(url,opt={}){return readResponse(await fetch(url,{cache:"no-store",...opt}))}
  function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
  function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
  function currentMonth(){return today().slice(0,7)}
  function monthBounds(month){if(!/^\d{4}-\d{2}$/.test(month))return {from:"",to:""};const [y,m]=month.split("-").map(Number),last=new Date(y,m,0).getDate();return {from:`${month}-01`,to:`${month}-${String(last).padStart(2,"0")}`}}
  function durationText(mins){if(mins===null||mins===undefined||mins==="")return "-";const n=Number(mins);if(!Number.isFinite(n))return "-";const h=Math.floor(n/60),m=n%60;return h?`${h}시간 ${m?`${m}분`:""}`.trim():`${m}분`}
  function durationShort(mins){if(mins===null||mins===undefined||mins==="")return "-";const n=Number(mins);if(!Number.isFinite(n))return "-";return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`}
  function normalizeTimeValue(value){
    const raw=String(value??"").trim();
    if(!raw)return {valid:true,value:""};
    let hour="",minute="";
    if(/^\d{3,4}$/.test(raw)){
      const digits=raw.padStart(4,"0");
      hour=digits.slice(0,2);minute=digits.slice(2)
    }else{
      const parts=raw.match(/^(\d{1,2}):(\d{2})$/);
      if(!parts)return {valid:false,value:""};
      hour=parts[1].padStart(2,"0");minute=parts[2]
    }
    const h=Number(hour),m=Number(minute);
    if(h<0||h>23||m<0||m>59)return {valid:false,value:""};
    return {valid:true,value:`${hour}:${minute}`}
  }
  function durationBetween(a,b){
    const start=normalizeTimeValue(a),end=normalizeTimeValue(b);
    if(!start.valid||!end.valid||!start.value||!end.value)return null;
    const [ah,am]=start.value.split(":").map(Number),[bh,bm]=end.value.split(":").map(Number);
    return ((bh*60+bm)-(ah*60+am)+1440)%1440
  }
  function durationValue(x){if(x?.durationKnown===false||x?.durationMinutes===null||x?.durationMinutes===undefined||x?.durationMinutes==="")return null;const n=Number(x.durationMinutes);return Number.isFinite(n)?n:null}
  function abnormal(x){return Boolean(x?.abnormal)||/Trouble|막힘|문제발생|문제 발생|불량|덩어리/i.test(String(x?.note||""))}
  function troubleById(id){return state.troubles.find(x=>x.id===id)||null}
  function unloadById(id){return state.unloads.find(x=>x.id===id)||null}
  function setText(el,v){if(el)el.textContent=String(v??"")}
  function setEditorStatus(el,msg,show=true){if(!el)return;delete el.dataset.timeError;el.textContent=msg||"";el.hidden=!show}
  function setBusy(){const b=state.loading||state.saving;[e.refresh,e.createRecord,e.companyManage,e.rSave,e.tSave,e.uSave,e.companyAddButton].forEach(x=>{if(x)x.disabled=b})}
  function option(select,value,label){
    const o=document.createElement("option");o.value=value;o.textContent=label??value;select.append(o);return o
  }
  function ensureOption(select,value){
    const v=String(value||"").trim();if(!select||!v)return;
    if(![...select.options].some(o=>o.value===v))option(select,v,v)
  }
  function populateSiloSelect(select,currentValue="",preserveLegacy=false){
    if(!select)return;
    const current=String(currentValue??"");
    select.replaceChildren();
    SILO_OPTIONS.forEach(([value,label])=>option(select,value,label));
    if(preserveLegacy&&current.trim()&&!SILO_OPTIONS.some(([value])=>value===current)){
      option(select,current,`기존 기록 · ${current}`)
    }
    select.value=[...select.options].some(item=>item.value===current)?current:""
  }
  function populateCompanySelect(select,items,emptyLabel,currentValue=""){
    if(!select)return;
    const before=currentValue||select.value||"";
    select.replaceChildren();
    option(select,"",emptyLabel);
    [...new Set((items||[]).map(v=>String(v||"").trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,"ko"))
      .forEach(v=>option(select,v,v));
    ensureOption(select,before);
    select.value=before
  }
  function companyLists(){
    const active=state.companyDirectory.filter(x=>x.isActive).map(x=>x.name);
    populateCompanySelect(e.company,state.filterCompanies.length?state.filterCompanies:state.companies,"전체");
    populateCompanySelect(e.rCompany,active,"선택 안 함");
    populateCompanySelect(e.tCompany,active,"선택 안 함",e.tCompany?.value||"");
    populateCompanySelect(e.uCompany,active,"선택 안 함",e.uCompany?.value||"")
  }

  /* SOLID-FUEL-TROUBLE-V3.1.3 · 숫자형 시간 입력 검증/정규화 */
  function clearTimeInvalid(input,status){
    input.classList.remove("is-invalid");
    input.removeAttribute("aria-invalid");
    if(status?.dataset.timeError==="true")setEditorStatus(status,"",false)
  }
  function normalizeTimeInput(input){
    const result=normalizeTimeValue(input.value);
    if(result.valid){input.value=result.value;input.classList.remove("is-invalid");input.removeAttribute("aria-invalid")}
    else{input.classList.add("is-invalid");input.setAttribute("aria-invalid","true")}
    return result
  }
  function validatedEditorTimes(arrival,departure,status){
    const fields=[[arrival,"입고","arrivalTime"],[departure,"출고","departureTime"]],values={};
    for(const [input,label,key] of fields){
      const result=normalizeTimeInput(input);
      if(!result.valid){
        setEditorStatus(status,`${label} 시간을 확인해 주세요. 예: 0847`);
        status.dataset.timeError="true";
        input.focus();input.select();
        return null
      }
      values[key]=result.value
    }
    return values
  }
  function bindSimpleTimeInput(input,status,updateDuration){
    input.addEventListener("input",()=>{clearTimeInvalid(input,status);updateDuration()});
    input.addEventListener("blur",()=>{normalizeTimeInput(input);updateDuration()})
  }

  function setMode(mode){state.mode=mode;document.querySelectorAll("[data-query-mode]").forEach(b=>b.classList.toggle("is-active",b.dataset.queryMode===mode));e.monthBox.hidden=mode!=="month";e.rangeBox.hidden=mode!=="range";if(mode==="range"&&!e.from.value&&!e.to.value){const b=monthBounds(e.month.value||currentMonth());e.from.value=b.from;e.to.value=b.to}}
  function buildUrl(){
    const u=new URL(API,location.origin);
    let from="",to="";
    if(state.mode==="month"){const b=monthBounds(e.month.value||currentMonth());from=b.from;to=b.to}
    if(state.mode==="range"){from=e.from.value;to=e.to.value}
    const v={from,to,company:e.company.value.trim(),vehicle:e.vehicle.value.trim(),search:e.search.value.trim(),sort:e.sort.value||"desc"};
    Object.entries(v).forEach(([k,x])=>{if(x)u.searchParams.set(k,x)});u.searchParams.set("_",Date.now());return u.toString()
  }

  function summary(){
    const d=state.unloads.map(durationValue).filter(Number.isFinite),avg=d.length?Math.round(d.reduce((a,b)=>a+b,0)/d.length):null,max=d.length?Math.max(...d):null,ab=state.unloads.filter(abnormal).length;
    setText(e.troubleKpi,state.troubles.length);setText(e.unloadKpi,state.unloads.length);setText(e.abnormalKpi,ab);
    setText(e.averageKpi,avg==null?"-":durationShort(avg));setText(e.averageUnit,avg==null?"":"평균");setText(e.maxKpi,max==null?"-":durationShort(max));setText(e.maxUnit,max==null?"":"최장");
    setText(e.troubleTabCount,state.troubles.length);setText(e.unloadTabCount,state.unloads.length)
  }
  function groupStats(){
    const company=new Map(),silo=new Map();
    state.unloads.forEach(x=>{
      const c=x.companyName||"미입력",r=x.siloRoute||"미지정",m=durationValue(x);
      if(Number.isFinite(m)){
        const a=company.get(c)||[];a.push(x);company.set(c,a);
        const b=silo.get(r)||[];b.push(x);silo.set(r,b)
      }
    });

    const companyRows=[...company].map(([name,items])=>{
      const ds=items.map(durationValue).filter(Number.isFinite),sum=ds.reduce((a,b)=>a+b,0);
      return {name,count:items.length,avg:Math.round(sum/ds.length),min:Math.min(...ds),max:Math.max(...ds),abnormal:items.filter(abnormal).length}
    }).sort((a,b)=>a.name.localeCompare(b.name,"ko"));

    if(!companyRows.length){
      e.companyStats.innerHTML=`<div class="analytics-empty">조회 조건의 하역시간 데이터가 없습니다.</div>`;
    }else{
      e.companyStats.innerHTML=`
        <div class="analytics-table-wrap">
          <table class="analytics-table">
            <thead>
              <tr><th>업체</th><th>건수</th><th>평균</th><th>최단</th><th>최장</th><th>이상</th></tr>
            </thead>
            <tbody>
              ${companyRows.map(x=>`
                <tr>
                  <td>${esc(x.name)}</td>
                  <td>${x.count}</td>
                  <td class="metric">${esc(durationShort(x.avg))}</td>
                  <td>${esc(durationShort(x.min))}</td>
                  <td>${esc(durationShort(x.max))}</td>
                  <td class="${x.abnormal?"warn":""}">${x.abnormal||"-"}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    }

    const siloRows=[...silo].map(([name,items])=>{
      const ds=items.map(durationValue).filter(Number.isFinite);
      return {name,count:items.length,avg:Math.round(ds.reduce((a,b)=>a+b,0)/ds.length)}
    }).sort((a,b)=>b.count-a.count);

    if(!siloRows.length){
      e.siloStats.innerHTML=`<div class="analytics-empty">Silo 데이터가 없습니다.</div>`;
    }else{
      e.siloStats.innerHTML=`
        <div class="silo-summary">
          ${siloRows.slice(0,7).map(x=>`
            <div class="silo-summary__row">
              <span>${esc(x.name)}</span>
              <strong>${esc(durationShort(x.avg))}</strong>
              <small>${x.count}건</small>
            </div>
          `).join("")}
        </div>
      `;
    }

    setText(e.analyticsStatus,`${state.unloads.length}건 하역 기준`)
  }

  function photoHtml(x){const p=Array.isArray(x.photos)?x.photos:[];if(!p.length)return `<span class="photo-empty">-</span>`;let h=p.slice(0,2).map(v=>`<button class="thumb" type="button" data-action="photo" data-url="${esc(v.url)}"><img src="${esc(v.url)}" alt="샘플 사진" loading="lazy"></button>`);if(p.length>2)h.push(`<span class="more">+${p.length-2}</span>`);return `<div class="photo-list">${h.join("")}</div>`}
  function troubleTable(){
    e.troubleBody.replaceChildren();if(!state.troubles.length){e.troubleBody.innerHTML=`<tr><td colspan="8" class="empty">조회 조건에 해당하는 Trouble 내역이 없습니다.</td></tr>`;return}
    state.troubles.forEach((x,i)=>{const tr=document.createElement("tr");tr.innerHTML=`<td class="no">${i+1}</td><td class="date">${esc(String(x.occurrenceDate||"").replace(/-/g,"."))}</td><td class="company">${esc(x.companyName||"-")}</td><td class="vehicle">${esc(x.vehicleNo||"-")}</td><td class="equipment">${esc(x.equipment||"-")}</td><td class="photo">${photoHtml(x)}</td><td class="note">${esc(x.note||"-")}</td><td class="actions"><div class="row-actions"><button class="btn ghost" type="button" data-action="edit-trouble" data-id="${esc(x.id)}">수정</button>${state.permissions.canDelete?`<button class="btn danger" type="button" data-action="delete-trouble" data-id="${esc(x.id)}">삭제</button>`:""}</div></td>`;e.troubleBody.append(tr)})
  }
  function unloadTable(){
    e.unloadBody.replaceChildren();if(!state.unloads.length){e.unloadBody.innerHTML=`<tr><td colspan="10" class="empty">조회 조건에 해당하는 하역시간 내역이 없습니다.</td></tr>`;return}
    state.unloads.forEach((x,i)=>{const tr=document.createElement("tr"),m=durationValue(x),cls=Number.isFinite(m)?(m>=180?"is-very-long":m>=120?"is-long":""):"";if(abnormal(x))tr.classList.add("abnormal-row");tr.innerHTML=`<td class="no">${i+1}</td><td class="date">${esc(String(x.unloadingDate||"").replace(/-/g,".")||"-")}</td><td class="clock">${esc(x.arrivalTime||"-")}</td><td class="clock">${esc(x.departureTime||"-")}</td><td class="duration"><span class="duration-badge ${cls}">${esc(durationShort(m))}</span></td><td class="company">${esc(x.companyName||"-")}</td><td class="vehicle">${esc(x.vehicleNo||"-")}</td><td class="silo"><span class="silo-pill">${esc(x.siloRoute||"-")}</span></td><td class="unload-note">${esc(x.note||"-")}</td><td class="actions"><div class="row-actions"><button class="btn ghost" type="button" data-action="edit-unload" data-id="${esc(x.id)}">수정</button>${state.permissions.canDelete?`<button class="btn danger" type="button" data-action="delete-unload" data-id="${esc(x.id)}">삭제</button>`:""}</div></td>`;e.unloadBody.append(tr)})
  }
  function render(){companyLists();summary();groupStats();troubleTable();unloadTable();setText(e.status,`${state.troubles.length}건 조회 완료`);setText(e.unloadStatus,`${state.unloads.length}건 조회 완료`);renderCompanyManager()}

  async function load(){if(state.loading)return;state.loading=true;setBusy();setText(e.status,"조회 중...");setText(e.unloadStatus,"조회 중...");try{const r=await api(buildUrl(),{headers:headers()});state.troubles=Array.isArray(r.items)?r.items:[];state.unloads=Array.isArray(r.unloadingLogs)?r.unloadingLogs:[];state.companies=Array.isArray(r.companies)?r.companies:[];state.filterCompanies=Array.isArray(r.filterCompanies)?r.filterCompanies:state.companies;state.companyDirectory=Array.isArray(r.companyDirectory)?r.companyDirectory:state.companies.map(name=>({name,isActive:true}));state.permissions=r.permissions||state.permissions;render()}catch(err){console.error(err);state.troubles=[];state.unloads=[];render();setText(e.status,"조회 실패");setText(e.unloadStatus,"조회 실패");e.troubleBody.innerHTML=`<tr><td colspan="8" class="empty">${esc(err.message||"조회 실패")}</td></tr>`;e.unloadBody.innerHTML=`<tr><td colspan="10" class="empty">${esc(err.message||"조회 실패")}</td></tr>`}finally{state.loading=false;setBusy()}}
  function switchTab(tab){state.tab=tab;document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("is-active",b.dataset.tab===tab));document.querySelectorAll("[data-tab-panel]").forEach(p=>{const active=p.dataset.tabPanel===tab;p.classList.toggle("is-active",active);p.hidden=!active})}


  function recordKind(){
    return document.querySelector('input[name="recordKind"]:checked')?.value||"unloading"
  }
  function syncRecordKind(){
    const trouble=recordKind()==="trouble";
    e.rTroubleFields.hidden=!trouble;
    e.rEquipment.required=false;
    e.rFiles.disabled=!trouble;
    setText(e.rSave,trouble?"Trouble 기록 저장":"하역 기록 저장")
  }
  function updateRecordDuration(){
    const m=durationBetween(e.rArrival.value,e.rDeparture.value);
    e.rDuration.value=m==null?"미입력":durationText(m)
  }
  function openRecord(){
    e.rForm.reset();
    populateSiloSelect(e.rSilo);
    clearTimeInvalid(e.rArrival,e.rStatus);clearTimeInvalid(e.rDeparture,e.rStatus);
    const defaultKind=document.querySelector('input[name="recordKind"][value="unloading"]');
    if(defaultKind)defaultKind.checked=true;
    e.rDate.value=today();
    companyLists();
    e.rCompany.value="";
    e.rDuration.value="미입력";
    e.rEquipment.value="";
    e.rFiles.value="";
    setEditorStatus(e.rStatus,"",false);
    syncRecordKind();
    e.rModal.hidden=false;
    document.body.style.overflow="hidden";
    setTimeout(()=>e.rDate.focus(),0)
  }
  function closeRecord(){
    e.rModal.hidden=true;
    if(e.photoModal.hidden&&e.tModal.hidden&&e.uModal.hidden&&e.companyModal.hidden)document.body.style.overflow="";
    setEditorStatus(e.rStatus,"",false)
  }
  async function saveRecord(ev){
    ev.preventDefault();
    if(state.saving)return;
    const kind=recordKind();
    const times=validatedEditorTimes(e.rArrival,e.rDeparture,e.rStatus);
    if(!times)return updateRecordDuration();
    const common={
      unloadingDate:e.rDate.value,
      arrivalTime:times.arrivalTime,
      departureTime:times.departureTime,
      companyName:e.rCompany.value.trim(),
      vehicleNo:e.rVehicle.value.trim(),
      siloRoute:e.rSilo.value,
      note:e.rNote.value.trim()
    };
    const payload={entity:kind==="trouble"?"combined":"unloading",...common};
    if(kind==="trouble"){
      payload.occurrenceDate=common.unloadingDate;
      payload.equipment=e.rEquipment.value.trim()
    }
    state.saving=true;setBusy();
    setEditorStatus(e.rStatus,kind==="trouble"?"하역시간과 Trouble을 함께 저장하는 중입니다.":"하역 기록을 저장하는 중입니다.");
    try{
      const r=await api(API,{method:"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify(payload)});
      if(kind==="trouble"&&e.rFiles.files.length){
        const troubleId=r.troubleId||r.recordId||r.id;
        if(!troubleId)throw new Error("Trouble 사진 연결 ID를 확인하지 못했습니다.");
        setEditorStatus(e.rStatus,"기록 저장 완료 · 샘플 사진 업로드 중...");
        await upload(troubleId,e.rFiles.files)
      }
      closeRecord();
      switchTab(kind==="trouble"?"trouble":"unload");
      await load()
    }catch(err){
      console.error("통합 기록 저장 실패:",err);
      setEditorStatus(e.rStatus,err.message||"저장 실패")
    }finally{
      state.saving=false;setBusy()
    }
  }

  function existingPhotos(x){const p=Array.isArray(x?.photos)?x.photos:[];e.existing.replaceChildren();e.existing.hidden=!p.length;p.forEach(v=>{const d=document.createElement("div");d.className="existing-photo";d.innerHTML=`<button class="thumb" style="width:100%;height:90px;border:0;border-radius:0" type="button" data-action="photo" data-url="${esc(v.url)}"><img src="${esc(v.url)}" alt="샘플 사진"></button><div class="existing-meta"><span>${esc(v.name||"샘플 사진")}</span>${v.legacy?`<span>원본</span>`:`<button class="photo-delete" type="button" data-action="delete-photo" data-photo-id="${esc(v.id)}">삭제</button>`}</div>`;e.existing.append(d)})}
  function openTrouble(x=null){e.tTitle.textContent="Trouble 수정";e.tId.value=x?.id||"";e.tVersion.value=x?.version||"";e.tDate.value=x?.occurrenceDate||today();companyLists();ensureOption(e.tCompany,x?.companyName||"");e.tCompany.value=x?.companyName||"";e.tVehicle.value=x?.vehicleNo||"";e.tEquipment.value=x?.equipment||"";e.tNote.value=x?.note||"";e.tFiles.value="";existingPhotos(x);setEditorStatus(e.tStatus,"",false);e.tModal.hidden=false;document.body.style.overflow="hidden";setTimeout(()=>e.tDate.focus(),0)}
  function closeTrouble(){e.tModal.hidden=true;if(e.photoModal.hidden&&e.uModal.hidden&&e.rModal.hidden&&e.companyModal.hidden)document.body.style.overflow="";setEditorStatus(e.tStatus,"",false)}
  async function upload(id,files){const a=[...(files||[])];if(!a.length)return;const f=new FormData();f.set("recordId",id);a.forEach(x=>f.append("files",x));await api(API,{method:"POST",headers:headers(),body:f})}
  async function saveTrouble(ev){ev.preventDefault();if(state.saving)return;const id=e.tId.value.trim(),editing=!!id,p={entity:"trouble",occurrenceDate:e.tDate.value,companyName:e.tCompany.value.trim(),vehicleNo:e.tVehicle.value.trim(),equipment:e.tEquipment.value.trim(),note:e.tNote.value.trim()};if(editing){p.id=id;p.version=Number(e.tVersion.value||0)}state.saving=true;setBusy();setEditorStatus(e.tStatus,editing?"수정 내용을 저장하는 중입니다.":"Trouble 기록을 저장하는 중입니다.");try{const r=await api(API,{method:editing?"PUT":"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify(p)});const saved=editing?id:(r.recordId||r.id);if(e.tFiles.files.length){setEditorStatus(e.tStatus,"기록 저장 완료 · 샘플 사진 업로드 중...");await upload(saved,e.tFiles.files)}closeTrouble();await load()}catch(err){setEditorStatus(e.tStatus,err.message||"저장 실패");if(err.status===409)await load()}finally{state.saving=false;setBusy()}}

  function updateUnloadDuration(){const m=durationBetween(e.uArrival.value,e.uDeparture.value);e.uDuration.value=m==null?"미입력":durationText(m)}
  function openUnload(x=null){
    e.uTitle.textContent="하역시간 수정";
    e.uId.value=x?.id||"";
    e.uVersion.value=x?.version||"";
    e.uDate.value=x?.unloadingDate||today();
    e.uArrival.value=x?.arrivalTime||"";
    e.uDeparture.value=x?.departureTime||"";
    normalizeTimeInput(e.uArrival);normalizeTimeInput(e.uDeparture);
    companyLists();ensureOption(e.uCompany,x?.companyName||"");e.uCompany.value=x?.companyName||"";
    e.uVehicle.value=x?.vehicleNo||"";
    populateSiloSelect(e.uSilo,x?.siloRoute||"",true);
    e.uNote.value=x?.note||"";
    updateUnloadDuration();setEditorStatus(e.uStatus,"",false);
    e.uModal.hidden=false;document.body.style.overflow="hidden";setTimeout(()=>e.uDate.focus(),0)
  }
  function closeUnload(){e.uModal.hidden=true;if(e.photoModal.hidden&&e.tModal.hidden&&e.rModal.hidden&&e.companyModal.hidden)document.body.style.overflow="";setEditorStatus(e.uStatus,"",false)}
  async function saveUnload(ev){
    ev.preventDefault();
    if(state.saving)return;
    const times=validatedEditorTimes(e.uArrival,e.uDeparture,e.uStatus);
    if(!times)return updateUnloadDuration();
    const id=e.uId.value.trim(),editing=!!id,p={
      entity:"unloading",
      unloadingDate:e.uDate.value,
      arrivalTime:times.arrivalTime,
      departureTime:times.departureTime,
      companyName:e.uCompany.value.trim(),
      vehicleNo:e.uVehicle.value.trim(),
      siloRoute:e.uSilo.value,
      note:e.uNote.value.trim()
    };
    if(editing){p.id=id;p.version=Number(e.uVersion.value||0)}
    state.saving=true;setBusy();setEditorStatus(e.uStatus,editing?"하역시간 수정 중...":"하역시간 저장 중...");
    try{
      await api(API,{method:editing?"PUT":"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify(p)});
      closeUnload();await load()
    }catch(err){
      setEditorStatus(e.uStatus,err.message||"저장 실패");if(err.status===409)await load()
    }finally{
      state.saving=false;setBusy()
    }
  }


  function renderCompanyManager(){
    if(!e.companyManagerList)return;
    const rows=[...(state.companyDirectory||[])].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""),"ko"));
    e.companyManagerList.replaceChildren();
    setText(e.companyManagerStatus,`${rows.length}개 업체`);
    if(!rows.length){
      e.companyManagerList.innerHTML=`<div class="company-manager__empty">등록된 업체가 없습니다.</div>`;
      return
    }
    rows.forEach(item=>{
      const row=document.createElement("div");
      row.className="company-manager__row";
      row.innerHTML=`
        <strong>${esc(item.name||"-")}</strong>
        <span class="company-status ${item.isActive?"":"is-inactive"}">${item.isActive?"사용중":"사용중지"}</span>
        <button class="btn ${item.isActive?"ghost":"secondary"}" type="button" data-company-action="toggle" data-company-name="${esc(item.name||"")}" data-next-active="${item.isActive?"0":"1"}">
          ${item.isActive?"사용중지":"다시사용"}
        </button>
      `;
      e.companyManagerList.append(row)
    })
  }

  function openCompanyManager(){
    if(!state.permissions.canManageCompanies){
      alert("업체 관리 권한이 없습니다.");
      return
    }
    renderCompanyManager();
    if(e.companyNameInput)e.companyNameInput.value="";
    e.companyModal.hidden=false;
    document.body.style.overflow="hidden";
    setTimeout(()=>e.companyNameInput?.focus(),0)
  }

  function closeCompanyManager(){
    e.companyModal.hidden=true;
    if(e.photoModal.hidden&&e.tModal.hidden&&e.uModal.hidden&&e.rModal.hidden)document.body.style.overflow=""
  }

  async function addCompany(ev){
    ev.preventDefault();
    if(state.saving)return;
    const name=String(e.companyNameInput?.value||"").trim();
    if(!name){
      setText(e.companyManagerStatus,"업체명을 입력해 주세요.");
      return e.companyNameInput?.focus()
    }
    state.saving=true;setBusy();setText(e.companyManagerStatus,"업체 추가 중...");
    try{
      await api(API,{method:"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify({entity:"company",companyName:name})});
      e.companyNameInput.value="";
      await load();
      renderCompanyManager()
    }catch(err){
      setText(e.companyManagerStatus,err.message||"업체 추가 실패")
    }finally{
      state.saving=false;setBusy()
    }
  }

  async function toggleCompany(name,isActive){
    if(state.saving||!name)return;
    state.saving=true;setBusy();setText(e.companyManagerStatus,"업체 상태 변경 중...");
    try{
      await api(API,{method:"PUT",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify({entity:"company",companyName:name,isActive})});
      await load();
      renderCompanyManager()
    }catch(err){
      setText(e.companyManagerStatus,err.message||"업체 상태 변경 실패")
    }finally{
      state.saving=false;setBusy()
    }
  }

  async function delRecord(entity,x){if(!x||!state.permissions.canDelete)return;if(!confirm(`${entity==="unloading"?"하역시간":"Trouble"} 기록을 삭제할까요?`))return;try{const u=new URL(API,location.origin);u.searchParams.set("id",x.id);u.searchParams.set("entity",entity);await api(u,{method:"DELETE",headers:headers()});await load()}catch(err){alert(err.message||"삭제 실패")}}
  async function delPhoto(id){if(!id||!confirm("이 샘플 사진을 삭제할까요?"))return;try{const u=new URL(API,location.origin);u.searchParams.set("photoId",id);await api(u,{method:"DELETE",headers:headers()});const rid=e.tId.value.trim();await load();const x=troubleById(rid);if(x){e.tVersion.value=x.version;existingPhotos(x)}}catch(err){setEditorStatus(e.tStatus,err.message||"사진 삭제 실패")}}

  function applyZoom(scale){const s=Math.min(4,Math.max(.25,Number(scale)||1));state.photoScale=s;e.zoomRange.value=String(Math.round(s*100));setText(e.zoomText,`${Math.round(s*100)}%`);if(e.photo.naturalWidth)e.photo.style.width=`${Math.max(1,Math.round(e.photo.naturalWidth*s))}px`}
  function fitPhoto(){if(!e.photo.naturalWidth||!e.photoStage.clientWidth)return;const sx=(e.photoStage.clientWidth-36)/e.photo.naturalWidth,sy=(e.photoStage.clientHeight-36)/e.photo.naturalHeight;applyZoom(Math.min(sx,sy))}
  function showPhoto(src){if(!src)return;e.photoModal.hidden=false;document.body.style.overflow="hidden";e.photo.onload=()=>{fitPhoto();e.photoStage.scrollTo(0,0)};e.photo.src=src}
  function closePhoto(){e.photoModal.hidden=true;e.photo.removeAttribute("src");e.photo.style.removeProperty("width");if(e.tModal.hidden&&e.uModal.hidden&&e.rModal.hidden&&e.companyModal.hidden)document.body.style.overflow=""}

  function bind(){
    e.refresh.addEventListener("click",load);
    e.createRecord.addEventListener("click",openRecord);
    e.companyManage.addEventListener("click",openCompanyManager);
    e.companyAddForm.addEventListener("submit",addCompany);
    e.companyClose.addEventListener("click",closeCompanyManager);
    e.companyCancel.addEventListener("click",closeCompanyManager);
    e.companyModal.addEventListener("click",ev=>{
      const t=ev.target.closest("[data-company-action]");
      if(t?.dataset.companyAction==="toggle")return toggleCompany(t.dataset.companyName,t.dataset.nextActive==="1");
      if(ev.target===e.companyModal)closeCompanyManager()
    });

    e.mode.addEventListener("click",ev=>{
      const b=ev.target.closest("[data-query-mode]");
      if(b)setMode(b.dataset.queryMode)
    });
    e.form.addEventListener("submit",ev=>{ev.preventDefault();load()});
    e.reset.addEventListener("click",()=>{
      e.form.reset();e.month.value=currentMonth();e.sort.value="desc";setMode("month");load()
    });
    e.tabs.addEventListener("click",ev=>{
      const b=ev.target.closest("[data-tab]");
      if(b)switchTab(b.dataset.tab)
    });

    document.querySelectorAll('input[name="recordKind"]').forEach(x=>x.addEventListener("change",syncRecordKind));
    [e.rArrival,e.rDeparture].forEach(x=>bindSimpleTimeInput(x,e.rStatus,updateRecordDuration));
    e.rForm.addEventListener("submit",saveRecord);
    e.rClose.addEventListener("click",closeRecord);
    e.rCancel.addEventListener("click",closeRecord);
    e.rModal.addEventListener("click",ev=>{if(ev.target===e.rModal)closeRecord()});

    e.troubleBody.addEventListener("click",ev=>{
      const t=ev.target.closest("[data-action]");if(!t)return;
      const a=t.dataset.action;
      if(a==="photo")return showPhoto(t.dataset.url);
      const x=troubleById(t.dataset.id);
      if(a==="edit-trouble")openTrouble(x);
      if(a==="delete-trouble")delRecord("trouble",x)
    });
    e.unloadBody.addEventListener("click",ev=>{
      const t=ev.target.closest("[data-action]");if(!t)return;
      const x=unloadById(t.dataset.id);
      if(t.dataset.action==="edit-unload")openUnload(x);
      if(t.dataset.action==="delete-unload")delRecord("unloading",x)
    });

    e.tForm.addEventListener("submit",saveTrouble);
    e.tClose.addEventListener("click",closeTrouble);
    e.tCancel.addEventListener("click",closeTrouble);
    e.tModal.addEventListener("click",ev=>{
      const t=ev.target.closest("[data-action]");
      if(t){
        if(t.dataset.action==="photo")return showPhoto(t.dataset.url);
        if(t.dataset.action==="delete-photo")return delPhoto(t.dataset.photoId)
      }
      if(ev.target===e.tModal)closeTrouble()
    });

    e.uForm.addEventListener("submit",saveUnload);
    e.uClose.addEventListener("click",closeUnload);
    e.uCancel.addEventListener("click",closeUnload);
    [e.uArrival,e.uDeparture].forEach(x=>bindSimpleTimeInput(x,e.uStatus,updateUnloadDuration));
    e.uModal.addEventListener("click",ev=>{if(ev.target===e.uModal)closeUnload()});

    e.photoClose.addEventListener("click",closePhoto);
    e.zoomIn.addEventListener("click",()=>applyZoom(state.photoScale+.25));
    e.zoomOut.addEventListener("click",()=>applyZoom(state.photoScale-.25));
    e.zoomFit.addEventListener("click",fitPhoto);
    e.zoomRange.addEventListener("input",()=>applyZoom(Number(e.zoomRange.value)/100));
    e.photoStage.addEventListener("wheel",ev=>{
      ev.preventDefault();applyZoom(state.photoScale+(ev.deltaY<0?.15:-.15))
    },{passive:false});
    e.photoModal.addEventListener("click",ev=>{if(ev.target===e.photoModal)closePhoto()});

    document.addEventListener("keydown",ev=>{
      if(ev.key!=="Escape")return;
      if(!e.photoModal.hidden)return closePhoto();
      if(!e.rModal.hidden)return closeRecord();
      if(!e.tModal.hidden)return closeTrouble();
      if(!e.uModal.hidden)return closeUnload();
      if(!e.companyModal.hidden)closeCompanyManager()
    })
  }
  async function init(){if(!token()){setText(e.status,"로그인이 필요합니다.");return setTimeout(()=>location.assign("/"),1000)}e.month.value=currentMonth();setMode("month");bind();await load()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
