(function(root){
  'use strict';
  const API='/api/cofiring-calculation-settings';
  const UNITS=['unit1','unit2'],FUELS=['coal','bio','organic','manure'];
  const DEFAULTS={
    unit1:{coal:{calorific:5868,coefficient:1},bio:{calorific:3237,coefficient:1},organic:{calorific:3487,coefficient:1},manure:{calorific:3487,coefficient:1}},
    unit2:{coal:{calorific:5868,coefficient:1},bio:{calorific:3237,coefficient:1},organic:{calorific:3487,coefficient:1},manure:{calorific:3487,coefficient:1}}
  };
  const clone=value=>JSON.parse(JSON.stringify(value));
  function validDate(value){if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
  function validSettings(value){
    if(!value||typeof value!=='object'||Array.isArray(value))return false;
    return UNITS.every(unit=>value[unit]&&FUELS.every(fuel=>{
      const s=value[unit][fuel];return s&&typeof s.calorific==='number'&&Number.isFinite(s.calorific)&&s.calorific>0&&s.calorific<=50000&&
        typeof s.coefficient==='number'&&Number.isFinite(s.coefficient)&&s.coefficient>0&&s.coefficient<=100;
    }));
  }
  function create(options){
    const opts=options||{};let selected='',identity='',generation=0,disposed=false;
    let current={loaded:false,loading:false,saving:false,error:'',source:'default',effectiveDate:null,settings:clone(DEFAULTS),updatedByName:'',updatedById:'',updatedAt:'',pending:null};
    const emit=()=>{if(!disposed&&typeof opts.onChange==='function')opts.onChange();};
    function headers(){try{return opts.getHeaders?opts.getHeaders():{};}catch(_){return {};}}
    function credential(){const h=headers();return String(h.Authorization||h.authorization||'').trim();}
    function authenticated(){const key=credential();if(key!==identity){identity=key;generation++;}return /^Bearer\s+\S+/i.test(identity);}
    function canEdit(){return authenticated()&&(typeof opts.canEdit==='function'?opts.canEdit():true);}
    function state(){return {targetDate:selected,authenticated:authenticated(),canEdit:canEdit(),...current,settings:clone(current.settings)};}
    function requestId(){if(opts.requestId)return opts.requestId();if(root.crypto?.randomUUID)return root.crypto.randomUUID();if(root.crypto?.getRandomValues){const a=new Uint8Array(16);root.crypto.getRandomValues(a);return [...a].map(b=>b.toString(16).padStart(2,'0')).join('');}throw new Error('저장 요청 ID를 만들 수 없습니다. 보안 연결(HTTPS)에서 다시 열어 주세요.');}
    async function request(url,init){
      const response=await (opts.fetch||root.fetch)(url,{...init,credentials:'same-origin',cache:'no-store'});let payload;
      try{payload=await response.json();}catch(_){throw new Error('서버 응답을 확인하지 못했습니다.');}
      if(!response.ok||payload?.ok!==true){const e=new Error(payload?.message||'설정 요청을 처리하지 못했습니다.');e.status=response.status;e.payload=payload;throw e;}return payload;
    }
    function select(date){selected=validDate(date)?date:'';generation++;current={loaded:false,loading:false,saving:false,error:'',source:'default',effectiveDate:null,settings:clone(DEFAULTS),updatedByName:'',updatedById:'',updatedAt:'',pending:null};emit();}
    async function load({force=false}={}){
      if(!validDate(selected)){emit();return false;}
      if(!authenticated()){current.loaded=true;current.source='default';current.error='';emit();return true;}
      if(current.pending)return current.pending;if(current.loaded&&!force){emit();return true;}
      const date=selected,epoch=generation,key=identity;current.loading=true;current.error='';emit();
      const pending=(async()=>{try{
        const payload=await request(API+'?targetDate='+encodeURIComponent(date),{method:'GET',headers:{...headers(),Accept:'application/json'}});
        if(disposed||epoch!==generation||key!==credential()||date!==selected)return false;
        if(payload.targetDate!==date||!validSettings(payload.settings))throw new Error('서버 설정값이 요청한 계산일과 다릅니다.');
        current.settings=clone(payload.settings);current.source=payload.source==='saved'?'saved':'default';current.effectiveDate=payload.effectiveDate||null;
        current.updatedByName=String(payload.updatedByName||'');current.updatedById=String(payload.updatedById||'');current.updatedAt=String(payload.updatedAt||'');current.loaded=true;current.error='';return true;
      }catch(e){if(!disposed&&epoch===generation){current.loaded=true;current.error=e.message||'설정값을 불러오지 못했습니다.';}return false;}
      finally{if(!disposed&&epoch===generation){current.loading=false;current.pending=null;emit();}}})();
      current.pending=pending;return pending;
    }
    async function save(settings){
      if(!validDate(selected)||!canEdit()||!validSettings(settings)||current.saving)return false;
      const date=selected,epoch=generation,key=identity;current.saving=true;current.error='';emit();
      try{
        const payload=await request(API,{method:'POST',headers:{...headers(),Accept:'application/json','Content-Type':'application/json','X-ShiftLog-Client':'desktop'},body:JSON.stringify({effectiveDate:date,settings:clone(settings),requestId:requestId()})});
        if(disposed||epoch!==generation||key!==credential()||date!==selected)return false;
        if(!payload.entry||payload.entry.effectiveDate!==date||!validSettings(payload.entry.settings))throw new Error('서버 저장 확인값이 요청과 다릅니다.');
        current.settings=clone(payload.entry.settings);current.source='saved';current.effectiveDate=payload.entry.effectiveDate;current.updatedByName=String(payload.entry.updatedByName||'');current.updatedById=String(payload.entry.updatedById||'');current.updatedAt=String(payload.entry.updatedAt||'');current.loaded=true;return true;
      }catch(e){if(!disposed&&epoch===generation)current.error=e.message||'설정값을 저장하지 못했습니다.';return false;}
      finally{if(!disposed&&epoch===generation){current.saving=false;emit();}}
    }
    function dispose(){disposed=true;generation++;}
    return {state,select,load,save,dispose,defaults:()=>clone(DEFAULTS)};
  }
  root.CofiringCalculationSettingsStorage={create,validDate,validSettings,defaults:()=>clone(DEFAULTS)};
  if(typeof module==='object'&&module.exports)module.exports=root.CofiringCalculationSettingsStorage;
})(typeof globalThis==='object'?globalThis:this);
