"use strict";
(function(){
  const API="/api/solid-fuel-trouble",AUTH="gsShiftLog.currentUser";
  const state={items:[],companies:[],permissions:{canCreate:false,canEdit:false,canDelete:false,canUploadPhoto:false},loading:false,saving:false};
  const $=id=>document.getElementById(id);
  const e={total:$("totalKpi"),month:$("monthKpi"),a:$("aKpi"),b:$("bKpi"),refresh:$("refreshBtn"),create:$("createBtn"),
    form:$("filterForm"),from:$("filterFrom"),to:$("filterTo"),company:$("filterCompany"),vehicle:$("filterVehicle"),search:$("filterSearch"),sort:$("filterSort"),reset:$("resetBtn"),companies:$("companyList"),
    status:$("statusText"),body:$("tableBody"),modal:$("editorModal"),title:$("editorTitle"),close:$("editorClose"),cancel:$("editorCancel"),editForm:$("editorForm"),
    id:$("editorId"),version:$("editorVersion"),date:$("editorDate"),editCompany:$("editorCompany"),editVehicle:$("editorVehicle"),equipment:$("editorEquipment"),note:$("editorNote"),
    files:$("editorFiles"),existing:$("existingPhotos"),editStatus:$("editorStatus"),save:$("editorSave"),photoModal:$("photoModal"),photo:$("photoImage"),photoClose:$("photoClose")};
  function current(){try{return JSON.parse(localStorage.getItem(AUTH)||"null")}catch{return null}}
  function token(){const u=current();return String(u?.sessionToken||u?.session_token||u?.accessToken||u?.access_token||u?.token||u?.session?.token||"").trim()}
  function headers(extra={}){const t=token();return {Accept:"application/json",...(t?{Authorization:`Bearer ${t}`}:{}),...extra}}
  async function response(r){const txt=await r.text();let o={};if(txt.trim()){try{o=JSON.parse(txt)}catch{throw new Error(`서버 응답 형식 오류 (HTTP ${r.status})`)}}if(r.status===401)setTimeout(()=>location.assign("/"),400);if(!r.ok||o.ok===false){const x=new Error(o.message||`요청 실패 (HTTP ${r.status})`);x.status=r.status;throw x}return o}
  async function api(url,opt={}){return response(await fetch(url,{cache:"no-store",...opt}))}
  function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
  function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
  function item(id){return state.items.find(x=>x.id===id)||null}
  function busy(){const b=state.loading||state.saving;e.refresh.disabled=b;e.create.disabled=b||!state.permissions.canCreate;e.save.disabled=state.saving}
  function setStatus(s){e.status.textContent=s}
  function editorStatus(s,show=true){e.editStatus.textContent=s||"";e.editStatus.hidden=!show}
  function summary(){
    const m=today().slice(0,7);
    e.total.textContent=state.items.length;
    e.month.textContent=state.items.filter(x=>String(x.occurrenceDate).startsWith(m)).length;
    e.a.textContent=state.items.filter(x=>/(?:#A\b|Silo\s*A\b|Storage\s*A\b)/i.test(x.equipment||"")).length;
    e.b.textContent=state.items.filter(x=>/(?:#B\b|Silo\s*B\b|Storage\s*B\b)/i.test(x.equipment||"")).length;
  }
  function companyList(){e.companies.replaceChildren();state.companies.forEach(v=>{const o=document.createElement("option");o.value=v;e.companies.append(o)})}
  function photoHtml(x){
    const p=Array.isArray(x.photos)?x.photos:[]; if(!p.length)return `<span class="more">-</span>`;
    let h=p.slice(0,2).map(v=>`<button class="thumb" type="button" data-action="photo" data-url="${esc(v.url)}"><img src="${esc(v.url)}" alt="샘플 사진" loading="lazy"></button>`);
    if(p.length>2)h.push(`<span class="more">+${p.length-2}</span>`);
    return `<div class="photo-list">${h.join("")}</div>`;
  }
  function table(){
    e.body.replaceChildren();
    if(!state.items.length){e.body.innerHTML=`<tr><td colspan="8" class="empty">조회 조건에 해당하는 Trouble 내역이 없습니다.</td></tr>`;return}
    state.items.forEach((x,i)=>{const tr=document.createElement("tr");tr.innerHTML=`
      <td class="no">${i+1}</td><td class="date">${esc(String(x.occurrenceDate||"").replace(/-/g,"."))}</td>
      <td class="company">${esc(x.companyName||"-")}</td><td class="vehicle">${esc(x.vehicleNo||"-")}</td>
      <td class="equipment">${esc(x.equipment||"-")}</td><td class="photo">${photoHtml(x)}</td><td class="note">${esc(x.note||"-")}</td>
      <td class="actions"><div class="row-actions"><button class="btn ghost" type="button" data-action="edit" data-id="${esc(x.id)}">수정</button>
      ${state.permissions.canDelete?`<button class="btn danger" type="button" data-action="delete" data-id="${esc(x.id)}">삭제</button>`:""}</div></td>`;e.body.append(tr)})
  }
  function url(){
    const u=new URL(API,location.origin),v={from:e.from.value,to:e.to.value,company:e.company.value.trim(),vehicle:e.vehicle.value.trim(),search:e.search.value.trim(),sort:e.sort.value||"asc"};
    Object.entries(v).forEach(([k,x])=>{if(x)u.searchParams.set(k,x)});u.searchParams.set("_",Date.now());return u.toString()
  }
  async function load(){
    if(state.loading)return;state.loading=true;busy();setStatus("조회 중...");
    try{const r=await api(url(),{headers:headers()});state.items=Array.isArray(r.items)?r.items:[];state.companies=Array.isArray(r.companies)?r.companies:[];state.permissions=r.permissions||state.permissions;companyList();summary();table();setStatus(`${state.items.length}건 조회 완료`)}
    catch(err){console.error(err);state.items=[];summary();e.body.innerHTML=`<tr><td colspan="8" class="empty">${esc(err.message||"조회 실패")}</td></tr>`;setStatus("조회 실패")}
    finally{state.loading=false;busy()}
  }
  function existing(x){
    const p=Array.isArray(x?.photos)?x.photos:[];e.existing.replaceChildren();e.existing.hidden=!p.length;
    p.forEach(v=>{const d=document.createElement("div");d.className="existing-photo";d.innerHTML=`<button class="thumb" style="width:100%;height:82px;border:0;border-radius:0" type="button" data-action="photo" data-url="${esc(v.url)}"><img src="${esc(v.url)}" alt="샘플 사진"></button>
      <div class="existing-meta"><span>${esc(v.name||"샘플 사진")}</span>${v.legacy?`<span>원본</span>`:`<button class="photo-delete" type="button" data-action="delete-photo" data-photo-id="${esc(v.id)}">삭제</button>`}</div>`;e.existing.append(d)})
  }
  function open(x=null){
    e.title.textContent=x?"Trouble 수정":"Trouble 등록";e.id.value=x?.id||"";e.version.value=x?.version||"";e.date.value=x?.occurrenceDate||today();e.editCompany.value=x?.companyName||"";e.editVehicle.value=x?.vehicleNo||"";e.equipment.value=x?.equipment||"";e.note.value=x?.note||"";e.files.value="";existing(x);editorStatus("",false);e.modal.hidden=false;document.body.style.overflow="hidden";setTimeout(()=>e.date.focus(),0)
  }
  function close(){e.modal.hidden=true;document.body.style.overflow="";editorStatus("",false)}
  async function upload(id,files){const a=[...(files||[])];if(!a.length)return;const f=new FormData();f.set("recordId",id);a.forEach(x=>f.append("files",x));await api(API,{method:"POST",headers:headers(),body:f})}
  async function save(ev){
    ev.preventDefault();if(state.saving)return;const id=e.id.value.trim(),editing=!!id,p={occurrenceDate:e.date.value,companyName:e.editCompany.value.trim(),vehicleNo:e.editVehicle.value.trim(),equipment:e.equipment.value.trim(),note:e.note.value.trim()};
    if(!p.occurrenceDate){editorStatus("발생 날짜를 선택해 주세요.");return e.date.focus()}if(!p.equipment){editorStatus("발생 설비 또는 Trouble 내용을 입력해 주세요.");return e.equipment.focus()}
    if(editing){p.id=id;p.version=Number(e.version.value||0)}state.saving=true;busy();editorStatus(editing?"수정 내용을 저장하는 중입니다.":"Trouble 기록을 저장하는 중입니다.");
    try{const r=await api(API,{method:editing?"PUT":"POST",headers:headers({"Content-Type":"application/json"}),body:JSON.stringify(p)});const saved=editing?id:(r.recordId||r.id);if(e.files.files.length){editorStatus("기록 저장 완료 · 샘플 사진 업로드 중...");await upload(saved,e.files.files)}close();await load()}
    catch(err){console.error(err);editorStatus(err.message||"저장 실패");if(err.status===409)await load()}finally{state.saving=false;busy()}
  }
  async function del(x){if(!x||!state.permissions.canDelete)return;if(!confirm(`${x.occurrenceDate} Trouble 기록을 삭제할까요?\n\n삭제된 기록은 화면에서 숨겨집니다.`))return;try{const u=new URL(API,location.origin);u.searchParams.set("id",x.id);await api(u,{method:"DELETE",headers:headers()});await load()}catch(err){alert(err.message||"삭제 실패")}}
  async function delPhoto(id){if(!id||!confirm("이 샘플 사진을 삭제할까요?"))return;try{const u=new URL(API,location.origin);u.searchParams.set("photoId",id);await api(u,{method:"DELETE",headers:headers()});const rid=e.id.value.trim();await load();const x=item(rid);if(x){e.version.value=x.version;existing(x)}}catch(err){editorStatus(err.message||"사진 삭제 실패")}}
  function showPhoto(src){if(!src)return;e.photo.src=src;e.photoModal.hidden=false;document.body.style.overflow="hidden"}
  function closePhoto(){e.photoModal.hidden=true;e.photo.removeAttribute("src");if(e.modal.hidden)document.body.style.overflow=""}
  function bind(){
    e.refresh.addEventListener("click",load);e.create.addEventListener("click",()=>open());e.form.addEventListener("submit",x=>{x.preventDefault();load()});e.reset.addEventListener("click",()=>{e.form.reset();e.sort.value="asc";load()});
    e.body.addEventListener("click",ev=>{const t=ev.target.closest("[data-action]");if(!t)return;if(t.dataset.action==="photo")return showPhoto(t.dataset.url);const x=item(t.dataset.id);if(t.dataset.action==="edit")open(x);if(t.dataset.action==="delete")del(x)});
    e.editForm.addEventListener("submit",save);e.close.addEventListener("click",close);e.cancel.addEventListener("click",close);e.modal.addEventListener("click",ev=>{const t=ev.target.closest("[data-action]");if(t){if(t.dataset.action==="photo")return showPhoto(t.dataset.url);if(t.dataset.action==="delete-photo")return delPhoto(t.dataset.photoId)}if(ev.target===e.modal)close()});
    e.photoClose.addEventListener("click",closePhoto);e.photoModal.addEventListener("click",ev=>{if(ev.target===e.photoModal)closePhoto()});document.addEventListener("keydown",ev=>{if(ev.key!=="Escape")return;if(!e.photoModal.hidden)return closePhoto();if(!e.modal.hidden)close()})
  }
  async function init(){if(!token()){setStatus("로그인이 필요합니다.");e.body.innerHTML=`<tr><td colspan="8" class="empty">로그인 정보가 없습니다. 업무일지로 이동합니다.</td></tr>`;return setTimeout(()=>location.assign("/"),1000)}bind();await load()}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
