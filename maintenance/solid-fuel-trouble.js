"use strict";
(function(){
  const API="/api/solid-fuel-trouble",AUTH="gsShiftLog.currentUser";
  const state={troubles:[],unloads:[],companies:[],permissions:{canCreate:false,canEdit:false,canDelete:false,canUploadPhoto:false,canManageUnloading:false},loading:false,saving:false,mode:"month",tab:"trouble",photoScale:1};
  const $=id=>document.getElementById(id);
  const e={
    refresh:$("refreshBtn"),createTrouble:$("createTroubleBtn"),createUnload:$("createUnloadBtn"),
    mode:$("queryMode"),form:$("filterForm"),monthBox:$("monthFilterBox"),rangeBox:$("rangeFilterBox"),month:$("filterMonth"),from:$("filterFrom"),to:$("filterTo"),company:$("filterCompany"),vehicle:$("filterVehicle"),search:$("filterSearch"),sort:$("filterSort"),reset:$("resetBtn"),companies:$("companyList"),
    troubleKpi:$("troubleKpi"),unloadKpi:$("unloadKpi"),averageKpi:$("averageKpi"),averageUnit:$("averageKpiUnit"),abnormalKpi:$("abnormalKpi"),maxKpi:$("maxKpi"),maxUnit:$("maxKpiUnit"),
    companyStats:$("companyStats"),siloStats:$("siloStats"),analyticsStatus:$("analyticsStatus"),
    tabs:document.querySelector(".tabs"),troublePanel:$("troublePanel"),unloadPanel:$("unloadPanel"),troubleTabCount:$("troubleTabCount"),unloadTabCount:$("unloadTabCount"),
    status:$("statusText"),unloadStatus:$("unloadStatusText"),troubleBody:$("troubleBody"),unloadBody:$("unloadBody"),
    tModal:$("troubleModal"),tTitle:$("troubleEditorTitle"),tClose:$("troubleClose"),tCancel:$("troubleCancel"),tForm:$("troubleForm"),tId:$("troubleId"),tVersion:$("troubleVersion"),tDate:$("troubleDate"),tCompany:$("troubleCompany"),tVehicle:$("troubleVehicle"),tEquipment:$("troubleEquipment"),tNote:$("troubleNote"),tFiles:$("troubleFiles"),existing:$("existingPhotos"),tStatus:$("troubleEditorStatus"),tSave:$("troubleSave"),
    uModal:$("unloadModal"),uTitle:$("unloadEditorTitle"),uClose:$("unloadClose"),uCancel:$("unloadCancel"),uForm:$("unloadForm"),uId:$("unloadId"),uVersion:$("unloadVersion"),uDate:$("unloadDate"),uArrival:$("unloadArrival"),uDeparture:$("unloadDeparture"),uDuration:$("unloadDurationPreview"),uCompany:$("unloadCompany"),uVehicle:$("unloadVehicle"),uSilo:$("unloadSilo"),uNote:$("unloadNote"),uStatus:$("unloadEditorStatus"),uSave:$("unloadSave"),
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
  function durationText(mins){const n=Number(mins);if(!Number.isFinite(n))return "-";const h=Math.floor(n/60),m=n%60;return h?`${h}시간 ${m?`${m}분`:""}`.trim():`${m}분`}
  function durationShort(mins){const n=Number(mins);if(!Number.isFinite(n))return "-";return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`}
  function durationBetween(a,b){if(!/^\d{2}:\d{2}$/.test(a||"")||!/^\d{2}:\d{2}$/.test(b||""))return null;const [ah,am]=a.split(":").map(Number),[bh,bm]=b.split(":").map(Number);return ((bh*60+bm)-(ah*60+am)+1440)%1440}
  function abnormal(x){return Boolean(x?.abnormal)||/막힘|문제발생|문제 발생|불량|덩어리/i.test(String(x?.note||""))}
  function troubleById(id){return state.troubles.find(x=>x.id===id)||null}
  function unloadById(id){return state.unloads.find(x=>x.id===id)||null}
  function setText(el,v){if(el)el.textContent=String(v??"")}
  function setEditorStatus(el,msg,show=true){if(!el)return;el.textContent=msg||"";el.hidden=!show}
  function setBusy(){const b=state.loading||state.saving;[e.refresh,e.createTrouble,e.createUnload,e.tSave,e.uSave].forEach(x=>{if(x)x.disabled=b})}
  function companyList(){e.companies.replaceChildren();state.companies.forEach(v=>{const o=document.createElement("option");o.value=v;e.companies.append(o)})}

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
    const d=state.unloads.map(x=>Number(x.durationMinutes)).filter(Number.isFinite),avg=d.length?Math.round(d.reduce((a,b)=>a+b,0)/d.length):null,max=d.length?Math.max(...d):null,ab=state.unloads.filter(abnormal).length;
    setText(e.troubleKpi,state.troubles.length);setText(e.unloadKpi,state.unloads.length);setText(e.abnormalKpi,ab);
    setText(e.averageKpi,avg==null?"-":durationShort(avg));setText(e.averageUnit,avg==null?"":"평균");setText(e.maxKpi,max==null?"-":durationShort(max));setText(e.maxUnit,max==null?"":"최장");
    setText(e.troubleTabCount,state.troubles.length);setText(e.unloadTabCount,state.unloads.length)
  }
  function groupStats(){
    const company=new Map(),silo=new Map();
    state.unloads.forEach(x=>{
      const c=x.companyName||"미입력",r=x.siloRoute||"미지정",m=Number(x.durationMinutes);
      if(Number.isFinite(m)){const a=company.get(c)||[];a.push(x);company.set(c,a);const b=silo.get(r)||[];b.push(x);silo.set(r,b)}
    });
    const companyRows=[...company].map(([name,items])=>{const ds=items.map(x=>Number(x.durationMinutes)),sum=ds.reduce((a,b)=>a+b,0);return {name,count:items.length,avg:Math.round(sum/ds.length),min:Math.min(...ds),max:Math.max(...ds),abnormal:items.filter(abnormal).length}}).sort((a,b)=>a.name.localeCompare(b.name,"ko"));
    const maxAvg=Math.max(1,...companyRows.map(x=>x.avg));e.companyStats.replaceChildren();
    if(!companyRows.length)e.companyStats.innerHTML=`<div class="analytics-empty">조회 조건의 하역시간 데이터가 없습니다.</div>`;
    companyRows.forEach(x=>{const d=document.createElement("article");d.className="company-card";d.innerHTML=`<div class="company-card__top"><strong>${esc(x.name)}</strong><b>${esc(durationShort(x.avg))}</b></div><small>${x.count}건 · 최단 ${esc(durationShort(x.min))} · 최장 ${esc(durationShort(x.max))}${x.abnormal?` · 이상 ${x.abnormal}건`:""}</small><div class="company-card__bar"><i style="width:${Math.max(8,Math.round(x.avg/maxAvg*100))}%"></i></div>`;e.companyStats.append(d)});
    const siloRows=[...silo].map(([name,items])=>{const ds=items.map(x=>Number(x.durationMinutes));return {name,count:items.length,avg:Math.round(ds.reduce((a,b)=>a+b,0)/ds.length)}}).sort((a,b)=>b.count-a.count);
    e.siloStats.replaceChildren();if(!siloRows.length)e.siloStats.innerHTML=`<div class="analytics-empty">Silo 데이터가 없습니다.</div>`;
    siloRows.slice(0,7).forEach(x=>{const d=document.createElement("div");d.className="silo-card";d.innerHTML=`<span>${esc(x.name)}</span><div><strong>${esc(durationShort(x.avg))}</strong> <small>${x.count}건</small></div>`;e.siloStats.append(d)});
    setText(e.analyticsStatus,`${state.unloads.length}건 하역 기준`)
  }

  function photoHtml(x){const p=Array.isArray(x.photos)?x.photos:[];if(!p.length)return `<span class="more">-</span>`;let h=p.slice(0,2).map(v=>`<button class="thumb" type="button" data-action="photo" data-url="${esc(v.url)}"><img src="${esc(v.url)}" alt="샘플 사진" loading="lazy"></button>`);if(p.length>2)h.push(`<span class="more">+${p.length-2}</span>`);return `<div class="photo-list">${h.join("")}</div>`}
  function troubleTable(){
    e.troubleBody.replaceChildren();if(!state.troubles.length){e.troubleBody.innerHTML=`<tr><td colspan="8" class="empty">조회 조건에 해당하는 Trouble 내역이 없습니다.</td></tr>`;return}
    state.troubles.forEach((x,i)=>{const tr=document.createElement("tr");tr.innerHTML=`<td class="no">${i+1}</td><td class="date">${esc(String(x.occurrenceDate||"").replace(/-/g,"."))}</td><td class="company">${esc(x.companyName||"-")}</td><td class="vehicle">${esc(x.vehicleNo||"-")}</td><td class="equipment">${esc(x.equipment||"-")}</td><td class="photo">${photoHtml(x)}</td><td class="note">${esc(x.note||"-")}</td><td class="actions"><div class="row-actions"><button class="btn ghost" type="button" data-action="edit-trouble" data-id="${esc(x.id)}">수정</button>${state.permissions.canDelete?`<button class="btn danger" type="button" data-action="delete-trouble" data-id="${esc(x.id)}">삭제</button>`:""}</div></td>`;e.troubleBody.append(tr)})
  }
  function unloadTable(){
    e.unloadBody.replaceChildren();if(!state.unloads.length){e.unloadBody.innerHTML=`<tr><td colspan="10" class="empty">조회 조건에 해당하는 하역시간 내역이 없습니다.</td></tr>`;return}
    state.unloads.forEach((x,i)=>{const tr=document.createElement("tr"),m=Number(x.durationMinutes),cls=m>=180?"is-very-long":m>=120?"is-long":"";if(abnormal(x))tr.classList.add("abnormal-row");tr.innerHTML=`<td class="no">${i+1}</td><td class="date">${esc(String(x.unloadingDate||"").replace(/-/g,"."))}</td><td class="clock">${esc(x.arrivalTime||"-")}</td><td class="clock">${esc(x.departureTime||"-")}</td><td class="duration"><span class="duration-badge ${cls}">${esc(durationShort(m))}</span></td><td class="company">${esc(x.companyName||"-")}</td><td class="vehicle">${esc(x.vehicleNo||"-")}</td><td class="silo"><span class="silo-pill">${esc(x.siloRoute||"-")}</span></td><td class="unload-note">${esc(x.note||"-")}</td><td class="actions"><div class="row-actions"><button class="btn ghost" type="button" data-action="edit-unload" data-id="${esc(x.id)}">수정</button>${state.permissions.canDelete?`<button class="btn danger" type="button" data-action="delete-unload" data-id="${esc(x.id)}">삭제</button>`:""}</div></td>`;e.unloadBody.append(tr)})
  }
  function render(){companyList();summary();groupStats();troubleTable();unloadTable();setText(e.status,`${state.troubles.length}건 조회 완료`);setText(e.unloadStatus,`${state.unloads.length}건 조회 완료`)}

  async function load(){if(state.loading)return;state.loading=true;setBusy();setText(e.status,"조회 중...");setText(e.unloadStatus,"조회 중...");try{const r=await api(buildUrl(),{headers:headers()});state.troubles=Array.isArray(r.items)?r.items:[];state.unloads=Array.isArray(r.unloadingLogs)?r.unloadingLogs:[];state.companies=Array.isArray(r.companies)?r.companies:[];state.permissions=r.permissions||state.permissions;render()}catch(err){console.error(err);state.troubles=[];state.unloads=[];render();setText(e.status,"조회 실패");setText(e.unloadStatus,"조회 실패");e.troubleBody.innerHTML=`<tr><td colspan="8" class="empty">${esc(err.message||"조회 실패")}</td></tr>`;e.unloadBody.innerHTML=`<tr><td colspan="10" class="empty">${esc(err.message||"조회 실패")}</td></tr>`}finally{state.loading=false;setBusy()}}
  function switchTab(tab){state.tab=tab;document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("is-active",b.dataset.tab===tab));document.querySelectorAll("[data-tab-panel]").forEach(p=>{const active=p.dataset.tabPanel===tab;p.classList.toggle("is-active",active);p.hidden=!active})}

  function existingPhotos(x){const p=Array.isArray(x?.photos)?x.photos:[];e.existing.replaceChildren();e.existing.hidden=!p.length;p.forEach(v=>{const d=document.createElement("div");d.className="existing-photo";d.innerHTML=`<button class="thumb" style="width:100%;height:90px;border:0;border-radius:0" type="button" data-action="photo" data-url="${esc(v.url)}"><img src="${esc(v.url)}" alt="샘플 사진"></button><div class="existing-meta"><span>${esc(v.name||"샘플 사진")}</span>${v.legacy?`<span>원본</span>`:`<button class="photo-delete" type="button" data-action="delete-photo" data-photo-id="${esc(v.id)}">삭제</button>`}</div>`;e.existing.append(d)})}
  function openTrouble(x=null){e.tTitle.textContent=x?"Trouble 수정":"Trouble 등록";e.tId.value=x?.id||"";e.tVersion.value=x?.version||"";e.tDate.value=x?.occurrenceDate||today();e.tCompany.value=x?.companyName||"";e.tVehicle.value=x?.vehicleNo||"";e.tEquipment.value=x?.equipment||"";e.tNote.value=x?.note||"";e.tFiles.value="";existingPhotos(x);setEditorStatus(e.tStatus,"",false);e.tModal.hidden=false;document.body.style.overflow="hidden";setTimeout(()=>e.tDate.focus(),0)}
  function closeTrouble(){e.tModal.hidden=true;if(e.photoModal.hidden&&e.uModal.hidden)document.body.style.overflow="";setEditorStatus(e.tStatus,"",false)}
  async function upload(id,files){const a=[...(files||[])];if(!a.length)return;const f=new FormData();f.set("recordId",id);a.forEach(x=>f.append("files",x));await api(API,{method:"POST",headers:headers(),body:f})}
  async function saveTrouble(ev){ev.preventDefault();if(state.saving)return;const id=e.tId.value.trim(),editing=!!id,p={entity:"trouble",occurrenceDate:e.tDate.value,companyName:e.tCompany.value.trim(),vehicleNo:e.tVehicle.value.trim(),equipment:e.tEquipment.value.trim(),note:e.tNote.value.trim()};if(!p.occurrenceDate){setEditorStatus(e.tStatus,"발생 날짜를 선택해 주세요.");return e.tDate.focus()}if(!p.equipment){setEditorStatus(e.tStatus,"발생 설비 또는 Trouble 내용을 입력해 주세요.");return e.tEquipment.focus()}if(editing){p.id=id;p.version=Number(e.tVersion.value||0)}state.saving=true;setBusy();setEditorStatus(e.tStatus,editing?"수정 내용을 저장하는 중입니다.":"Trouble 기록을 저장하는 중입니다.");try{const r=await api(API,{method:editing?"PUT":"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify(p)});const saved=editing?id:(r.recordId||r.id);if(e.tFiles.files.length){setEditorStatus(e.tStatus,"기록 저장 완료 · 샘플 사진 업로드 중...");await upload(saved,e.tFiles.files)}closeTrouble();await load()}catch(err){setEditorStatus(e.tStatus,err.message||"저장 실패");if(err.status===409)await load()}finally{state.saving=false;setBusy()}}

  function updateUnloadDuration(){const m=durationBetween(e.uArrival.value,e.uDeparture.value);e.uDuration.value=m==null?"":durationText(m)}
  function openUnload(x=null){e.uTitle.textContent=x?"하역시간 수정":"하역시간 등록";e.uId.value=x?.id||"";e.uVersion.value=x?.version||"";e.uDate.value=x?.unloadingDate||today();e.uArrival.value=x?.arrivalTime||"";e.uDeparture.value=x?.departureTime||"";e.uCompany.value=x?.companyName||"";e.uVehicle.value=x?.vehicleNo||"";e.uSilo.value=x?.siloRoute||"";e.uNote.value=x?.note||"";updateUnloadDuration();setEditorStatus(e.uStatus,"",false);e.uModal.hidden=false;document.body.style.overflow="hidden";setTimeout(()=>e.uDate.focus(),0)}
  function closeUnload(){e.uModal.hidden=true;if(e.photoModal.hidden&&e.tModal.hidden)document.body.style.overflow="";setEditorStatus(e.uStatus,"",false)}
  async function saveUnload(ev){ev.preventDefault();if(state.saving)return;const id=e.uId.value.trim(),editing=!!id,p={entity:"unloading",unloadingDate:e.uDate.value,arrivalTime:e.uArrival.value,departureTime:e.uDeparture.value,companyName:e.uCompany.value.trim(),vehicleNo:e.uVehicle.value.trim(),siloRoute:e.uSilo.value,note:e.uNote.value.trim()};if(!p.unloadingDate||!p.arrivalTime||!p.departureTime){setEditorStatus(e.uStatus,"일자와 입고/출고 시간을 입력해 주세요.");return}if(editing){p.id=id;p.version=Number(e.uVersion.value||0)}state.saving=true;setBusy();setEditorStatus(e.uStatus,editing?"하역시간 수정 중...":"하역시간 저장 중...");try{await api(API,{method:editing?"PUT":"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify(p)});closeUnload();await load()}catch(err){setEditorStatus(e.uStatus,err.message||"저장 실패");if(err.status===409)await load()}finally{state.saving=false;setBusy()}}

  async function delRecord(entity,x){if(!x||!state.permissions.canDelete)return;if(!confirm(`${entity==="unloading"?"하역시간":"Trouble"} 기록을 삭제할까요?`))return;try{const u=new URL(API,location.origin);u.searchParams.set("id",x.id);u.searchParams.set("entity",entity);await api(u,{method:"DELETE",headers:headers()});await load()}catch(err){alert(err.message||"삭제 실패")}}
  async function delPhoto(id){if(!id||!confirm("이 샘플 사진을 삭제할까요?"))return;try{const u=new URL(API,location.origin);u.searchParams.set("photoId",id);await api(u,{method:"DELETE",headers:headers()});const rid=e.tId.value.trim();await load();const x=troubleById(rid);if(x){e.tVersion.value=x.version;existingPhotos(x)}}catch(err){setEditorStatus(e.tStatus,err.message||"사진 삭제 실패")}}

  function applyZoom(scale){const s=Math.min(4,Math.max(.25,Number(scale)||1));state.photoScale=s;e.zoomRange.value=String(Math.round(s*100));setText(e.zoomText,`${Math.round(s*100)}%`);if(e.photo.naturalWidth)e.photo.style.width=`${Math.max(1,Math.round(e.photo.naturalWidth*s))}px`}
  function fitPhoto(){if(!e.photo.naturalWidth||!e.photoStage.clientWidth)return;const sx=(e.photoStage.clientWidth-36)/e.photo.naturalWidth,sy=(e.photoStage.clientHeight-36)/e.photo.naturalHeight;applyZoom(Math.min(sx,sy))}
  function showPhoto(src){if(!src)return;e.photoModal.hidden=false;document.body.style.overflow="hidden";e.photo.onload=()=>{fitPhoto();e.photoStage.scrollTo(0,0)};e.photo.src=src}
  function closePhoto(){e.photoModal.hidden=true;e.photo.removeAttribute("src");e.photo.style.removeProperty("width");if(e.tModal.hidden&&e.uModal.hidden)document.body.style.overflow=""}

  function bind(){
    e.refresh.addEventListener("click",load);e.createTrouble.addEventListener("click",()=>openTrouble());e.createUnload.addEventListener("click",()=>{switchTab("unload");openUnload()});
    e.mode.addEventListener("click",ev=>{const b=ev.target.closest("[data-query-mode]");if(b)setMode(b.dataset.queryMode)});
    e.form.addEventListener("submit",ev=>{ev.preventDefault();load()});e.reset.addEventListener("click",()=>{e.form.reset();e.month.value=currentMonth();e.sort.value="desc";setMode("month");load()});
    e.tabs.addEventListener("click",ev=>{const b=ev.target.closest("[data-tab]");if(b)switchTab(b.dataset.tab)});
    e.troubleBody.addEventListener("click",ev=>{const t=ev.target.closest("[data-action]");if(!t)return;const a=t.dataset.action;if(a==="photo")return showPhoto(t.dataset.url);const x=troubleById(t.dataset.id);if(a==="edit-trouble")openTrouble(x);if(a==="delete-trouble")delRecord("trouble",x)});
    e.unloadBody.addEventListener("click",ev=>{const t=ev.target.closest("[data-action]");if(!t)return;const x=unloadById(t.dataset.id);if(t.dataset.action==="edit-unload")openUnload(x);if(t.dataset.action==="delete-unload")delRecord("unloading",x)});
    e.tForm.addEventListener("submit",saveTrouble);e.tClose.addEventListener("click",closeTrouble);e.tCancel.addEventListener("click",closeTrouble);e.tModal.addEventListener("click",ev=>{const t=ev.target.closest("[data-action]");if(t){if(t.dataset.action==="photo")return showPhoto(t.dataset.url);if(t.dataset.action==="delete-photo")return delPhoto(t.dataset.photoId)}if(ev.target===e.tModal)closeTrouble()});
    e.uForm.addEventListener("submit",saveUnload);e.uClose.addEventListener("click",closeUnload);e.uCancel.addEventListener("click",closeUnload);[e.uArrival,e.uDeparture].forEach(x=>x.addEventListener("input",updateUnloadDuration));e.uModal.addEventListener("click",ev=>{if(ev.target===e.uModal)closeUnload()});
    e.photoClose.addEventListener("click",closePhoto);e.zoomIn.addEventListener("click",()=>applyZoom(state.photoScale+.25));e.zoomOut.addEventListener("click",()=>applyZoom(state.photoScale-.25));e.zoomFit.addEventListener("click",fitPhoto);e.zoomRange.addEventListener("input",()=>applyZoom(Number(e.zoomRange.value)/100));e.photoStage.addEventListener("wheel",ev=>{ev.preventDefault();applyZoom(state.photoScale+(ev.deltaY<0?.15:-.15))},{passive:false});e.photoModal.addEventListener("click",ev=>{if(ev.target===e.photoModal)closePhoto()});
    document.addEventListener("keydown",ev=>{if(ev.key!=="Escape")return;if(!e.photoModal.hidden)return closePhoto();if(!e.tModal.hidden)return closeTrouble();if(!e.uModal.hidden)closeUnload()})
  }
  async function init(){if(!token()){setText(e.status,"로그인이 필요합니다.");return setTimeout(()=>location.assign("/"),1000)}e.month.value=currentMonth();setMode("month");bind();await load()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();