(function(root){
  'use strict';
  const API='/api/cofiring-organic-usage';
  const UNITS=['unit1','unit2'];
  function parseTons(value){
    if(typeof value!=='string' && typeof value!=='number')throw new Error('유기성 사용량을 입력해 주세요.');
    const raw=String(value).trim();
    if(!raw)throw new Error('미입력은 0이 아닙니다. 사용하지 않은 날은 0을 입력해 주세요.');
    const n=Number(raw);
    if(!/^\d+(?:\.\d{1,6})?$/.test(raw)||!Number.isFinite(n)||n<0||n>1000000)throw new Error('0 이상, 소수점 6자리 이하의 사용량(ton)을 입력해 주세요.');
    return n;
  }
  function validDate(value){
    if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
    const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
  }
  function validRecord(entry,date,unit){
    return entry===null||(entry && entry.targetDate===date && entry.unit===unit && entry.source==='manual' &&
      Number.isSafeInteger(entry.revision)&&entry.revision>0 && (entry.tons===null ||
      (typeof entry.tons==='number'&&Number.isFinite(entry.tons)&&entry.tons>=0&&entry.tons<=1000000)) &&
      typeof entry.updatedByName==='string'&&typeof entry.updatedById==='string'&&
      typeof entry.updatedAt==='string'&&/Z$/.test(entry.updatedAt)&&Number.isFinite(Date.parse(entry.updatedAt)));
  }
  function freshUnit(){return {record:null,draft:'',editing:false,saving:false,dirty:false,error:'',conflict:null,hasConflict:false,operation:null};}
  function create(options){
    const opts=options||{}, cache=new Map();let selected='',identity='',generation=0,disposed=false;
    const emit=()=>{if(!disposed&&typeof opts.onChange==='function')opts.onChange();};
    function headers(){try{return opts.getHeaders?opts.getHeaders():{};}catch(_){return {};}}
    function credential(){const h=headers();return String(h.Authorization||h.authorization||'').trim();}
    function syncIdentity(){const key=credential();if(key!==identity){identity=key;generation++;cache.clear();}return !!/^Bearer\s+\S+/i.test(identity);}
    function writable(){return syncIdentity() && (typeof opts.canEdit==='function'?opts.canEdit():true);}
    function day(date=selected){if(!validDate(date))return null;if(!cache.has(date))cache.set(date,{loaded:false,loading:false,error:'',pending:null,units:{unit1:freshUnit(),unit2:freshUnit()}});return cache.get(date);}
    function state(){const authenticated=syncIdentity(),d=day();return {targetDate:selected,authenticated,canEdit:authenticated&&(typeof opts.canEdit==='function'?opts.canEdit():true),day:d};}
    function current(date,d,epoch,key){return !disposed&&epoch===generation&&credential()===key&&cache.get(date)===d;}
    function requestId(){
      if(opts.requestId)return opts.requestId();
      if(root.crypto?.randomUUID)return root.crypto.randomUUID();
      if(root.crypto?.getRandomValues){const a=new Uint8Array(16);root.crypto.getRandomValues(a);return [...a].map(b=>b.toString(16).padStart(2,'0')).join('');}
      throw new Error('저장 요청 ID를 만들 수 없습니다. 보안 연결(HTTPS)에서 다시 열어 주세요.');
    }
    async function request(url,init){
      const controller=typeof root.AbortController==='function'?new root.AbortController():null;
      const timer=controller&&root.setTimeout?root.setTimeout(()=>controller.abort(),20000):null;
      try{
        const response=await (opts.fetch||root.fetch)(url,{...init,credentials:'same-origin',cache:'no-store',...(controller?{signal:controller.signal}:{})});
        let payload;try{payload=await response.json();}catch(_){throw new Error('서버 응답을 확인하지 못했습니다. 배포 완료 후 다시 시도해 주세요.');}
        if(!response.ok||payload?.ok!==true){const e=new Error(payload?.message||'유기성 저장 요청을 처리하지 못했습니다.');e.status=response.status;e.payload=payload;throw e;}
        return payload;
      }catch(e){if(e?.name==='AbortError')throw new Error('서버 응답 시간이 초과됐습니다. 입력값을 유지했습니다. 최신 저장값을 확인해 주세요.');throw e;}
      finally{if(timer!==null)root.clearTimeout(timer);}
    }
    function adopt(u,record){u.record=record;u.draft=record?.tons===null||record===null?'':String(record.tons);u.editing=record?.tons===null||record===null;u.dirty=false;u.error='';u.conflict=null;u.hasConflict=false;u.operation=null;}
    function select(date){syncIdentity();selected=validDate(date)?date:'';emit();}
    async function load({force=false}={}){
      if(!syncIdentity()||!validDate(selected)) {emit();return false;}
      const date=selected,d=day();if(d.pending)return d.pending;if(d.loaded&&!force){emit();return true;}
      const epoch=generation,key=identity;
      d.loading=true;d.error='';emit();
      const pending=(async()=>{
        try{
          const payload=await request(API+'?targetDate='+encodeURIComponent(date),{method:'GET',headers:{...headers(),Accept:'application/json'}});
          if(!current(date,d,epoch,key))return false;
          if(payload.targetDate!==date||!payload.entries||!UNITS.every(unit=>Object.hasOwn(payload.entries,unit)&&validRecord(payload.entries[unit],date,unit)))throw new Error('서버의 날짜·호기 저장값이 요청과 다릅니다.');
          for(const unit of UNITS){const u=d.units[unit],record=payload.entries[unit];
            if(u.saving || (u.record?.revision||0)>(record?.revision||0))continue;
            if(u.dirty){if((record?.revision||0)!==(u.record?.revision||0)){u.conflict=record;u.hasConflict=true;u.error='다른 저장값이 있습니다. 최신값 확인 후 수정해 주세요.';}}
            else adopt(u,record);
          }
          d.loaded=true;d.error='';return true;
        }catch(e){if(current(date,d,epoch,key)){d.error=e.message||'저장값을 불러오지 못했습니다.';}return false;}
        finally{if(current(date,d,epoch,key)){d.loading=false;d.pending=null;emit();}}
      })();
      d.pending=pending;return pending;
    }
    function edit(unit){const d=day();if(!UNITS.includes(unit)||!writable()||!d?.loaded||d.loading||d.units[unit].saving)return false;d.units[unit].editing=true;d.units[unit].error='';emit();return true;}
    function setDraft(unit,value){const d=day();if(!UNITS.includes(unit)||!writable()||!d?.loaded||d.loading)return false;const u=d.units[unit];if(u.saving||!u.editing)return false;u.draft=String(value);u.dirty=true;u.error='';u.operation=null;emit();return true;}
    function cancel(unit){const d=day();if(!UNITS.includes(unit)||!d||d.units[unit].saving)return false;adopt(d.units[unit],d.units[unit].record);emit();return true;}
    function useLatest(unit){const d=day();if(!UNITS.includes(unit)||!d||d.units[unit].saving||!d.units[unit].hasConflict)return false;adopt(d.units[unit],d.units[unit].conflict);emit();return true;}
    async function save(unit,{clear=false}={}){
      if(!writable()||!UNITS.includes(unit))return false;
      const date=selected,d=day();if(!d?.loaded||d.loading)return false;const u=d.units[unit];
      if(u.saving)return false;if(u.hasConflict){u.error='최신 저장값을 먼저 확인해 주세요.';emit();return false;}
      let tons;
      try{tons=clear?null:parseTons(u.draft);}catch(e){u.error=e.message;emit();return false;}
      if(!clear&&!u.editing)return false;
      if(clear && (!u.record || u.record.tons===null))return false;
      const revision=u.record?.revision||0;
      try{
        const intent={targetDate:date,unit,action:clear?'clear':'save',tons,expectedRevision:revision};
        const signature=JSON.stringify(intent);
        if(!u.operation||u.operation.signature!==signature)u.operation={signature,body:{...intent,requestId:requestId()}};
      }catch(e){u.error=e.message;emit();return false;}
      const operation=u.operation,epoch=generation,key=identity;
      u.saving=true;u.error='';emit();
      try{
        const payload=await request(API,{method:'POST',headers:{...headers(),Accept:'application/json','Content-Type':'application/json','X-ShiftLog-Client':'desktop'},body:JSON.stringify(operation.body)});
        if(!current(date,d,epoch,key))return false;
        if(payload.targetDate!==date||payload.unit!==unit||!payload.entry||!validRecord(payload.entry,date,unit)||payload.entry.tons!==tons||payload.entry.revision!==revision+1)throw new Error('서버 저장 확인값이 요청과 다릅니다. 최신 저장값을 확인해 주세요.');
        adopt(u,payload.entry);return true;
      }catch(e){if(current(date,d,epoch,key)){
        u.error=e.message||'저장하지 못했습니다. 입력값을 유지했습니다.';
        if(e.status===409&&e.payload?.code==='REVISION_CONFLICT'&&validRecord(e.payload.current,date,unit)) {u.conflict=e.payload.current;u.hasConflict=true;u.operation=null;}
      }return false;}
      finally{if(current(date,d,epoch,key)){u.saving=false;emit();}}
    }
    function values(){const s=state(),d=s.day;return {unit1:d?.loaded?d.units.unit1.record?.tons??null:null,unit2:d?.loaded?d.units.unit2.record?.tons??null:null};}
    function dispose(){disposed=true;generation++;cache.clear();}
    return {state,select,load,edit,setDraft,cancel,useLatest,save,values,dispose};
  }
  root.CofiringOrganicStorage={create,parseTons,validDate,validRecord};
  if(typeof module==='object'&&module.exports)module.exports=root.CofiringOrganicStorage;
})(typeof globalThis==='object'?globalThis:this);
