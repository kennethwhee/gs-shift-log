(function(root){
  'use strict';
  const API='/api/cofiring-period-manual-usage';
  const BLANK=()=>({unit1:{organic:null,manure:null},unit2:{organic:null,manure:null}});
  const clone=value=>JSON.parse(JSON.stringify(value));
  function localMinute(value){
    if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))return null;
    const [date,time]=value.split('T'),[y,m,d]=date.split('-').map(Number),[hh,mm]=time.split(':').map(Number),utc=Date.UTC(y,m-1,d,hh-9,mm),check=new Date(utc+9*3600000).toISOString().slice(0,16);return check===value?utc:null;
  }
  function validPeriod(start,end){const a=localMinute(start),b=localMinute(end);return a!==null&&b!==null&&b>a&&(b-a)/60000<=44640;}
  function parseValue(value){const raw=String(value??'').trim();if(raw==='')return null;if(!/^\d+(?:\.\d{1,6})?$/.test(raw))throw new Error('0 이상, 소수점 6자리 이하의 사용량(ton)을 입력해 주세요.');const n=Number(raw);if(!Number.isFinite(n)||n<0||n>1000000)throw new Error('사용량 범위를 확인해 주세요.');return n;}
  function validValues(values){try{return ['unit1','unit2'].every(unit=>['organic','manure'].every(fuel=>{const v=values?.[unit]?.[fuel];return v===null||(typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1000000);}));}catch(_){return false;}}
  function create(options={}){
    let start='',end='',identity='',generation=0,disposed=false;
    let current={loaded:false,loading:false,saving:false,error:'',revision:0,values:BLANK(),updatedByName:'',updatedAt:'',pending:null};
    const emit=()=>{if(!disposed&&typeof options.onChange==='function')options.onChange();};
    function headers(){try{return options.getHeaders?options.getHeaders():{};}catch(_){return {};}}
    function credential(){const h=headers();return String(h.Authorization||h.authorization||'').trim();}
    function authenticated(){const key=credential();if(key!==identity){identity=key;generation++;}return /^Bearer\s+\S+/i.test(identity);}
    function canEdit(){return authenticated()&&(typeof options.canEdit==='function'?options.canEdit():true);}
    function state(){return {start,end,authenticated:authenticated(),canEdit:canEdit(),...current,values:clone(current.values)};}
    function requestId(){if(root.crypto?.randomUUID)return root.crypto.randomUUID();if(root.crypto?.getRandomValues){const a=new Uint8Array(16);root.crypto.getRandomValues(a);return [...a].map(b=>b.toString(16).padStart(2,'0')).join('');}throw new Error('저장 요청 ID를 만들 수 없습니다.');}
    async function request(url,init){const response=await (options.fetch||root.fetch)(url,{...init,credentials:'same-origin',cache:'no-store'});let payload;try{payload=await response.json();}catch(_){throw new Error('서버 응답을 확인하지 못했습니다.');}if(!response.ok||payload?.ok!==true){const e=new Error(payload?.message||'기간 수기값 요청을 처리하지 못했습니다.');e.status=response.status;e.payload=payload;throw e;}return payload;}
    function select(nextStart,nextEnd){start=validPeriod(nextStart,nextEnd)?nextStart:'';end=start?nextEnd:'';generation++;current={loaded:false,loading:false,saving:false,error:'',revision:0,values:BLANK(),updatedByName:'',updatedAt:'',pending:null};emit();}
    async function load({force=false}={}){
      if(!validPeriod(start,end)){emit();return false;}if(!authenticated()){current.loaded=true;current.error='';emit();return true;}if(current.pending)return current.pending;if(current.loaded&&!force){emit();return true;}
      const s=start,e=end,epoch=generation,key=identity;current.loading=true;current.error='';emit();
      const pending=(async()=>{try{const payload=await request(`${API}?start=${encodeURIComponent(s)}&end=${encodeURIComponent(e)}`,{method:'GET',headers:{...headers(),Accept:'application/json'}});if(disposed||epoch!==generation||key!==credential()||s!==start||e!==end)return false;if(payload.start!==s||payload.end!==e||!validValues(payload.values))throw new Error('서버 수기값이 요청 기간과 다릅니다.');current.values=clone(payload.values);current.revision=Number(payload.revision)||0;current.updatedByName=String(payload.entry?.updatedByName||'');current.updatedAt=String(payload.entry?.updatedAt||'');current.loaded=true;current.error='';return true;}catch(err){if(!disposed&&epoch===generation){current.loaded=true;current.error=err.message||'기간 수기값을 불러오지 못했습니다.';}return false;}finally{if(!disposed&&epoch===generation){current.loading=false;current.pending=null;emit();}}})();current.pending=pending;return pending;
    }
    async function save(values){
      if(!validPeriod(start,end)||!canEdit()||!validValues(values)||current.saving)return false;const s=start,e=end,epoch=generation,key=identity;current.saving=true;current.error='';emit();
      try{const payload=await request(API,{method:'POST',headers:{...headers(),Accept:'application/json','Content-Type':'application/json','X-ShiftLog-Client':'desktop'},body:JSON.stringify({start:s,end:e,values:clone(values),expectedRevision:current.revision,requestId:requestId()})});if(disposed||epoch!==generation||key!==credential()||s!==start||e!==end)return false;if(!payload.entry||payload.entry.start!==s||payload.entry.end!==e||!validValues(payload.entry.values))throw new Error('서버 저장 확인값이 요청과 다릅니다.');current.values=clone(payload.entry.values);current.revision=Number(payload.entry.revision)||current.revision+1;current.updatedByName=String(payload.entry.updatedByName||'');current.updatedAt=String(payload.entry.updatedAt||'');current.loaded=true;return true;}catch(err){if(!disposed&&epoch===generation){current.error=err.message||'기간 수기값을 저장하지 못했습니다.';if(err.status===409&&err.payload?.current&&validValues(err.payload.current.values)){current.values=clone(err.payload.current.values);current.revision=Number(err.payload.current.revision)||current.revision;}}return false;}finally{if(!disposed&&epoch===generation){current.saving=false;emit();}}
    }
    function dispose(){disposed=true;generation++;}
    return {state,select,load,save,dispose,parseValue,blank:BLANK};
  }
  root.CofiringPeriodManualStorage={create,parseValue,validPeriod,validValues,blank:BLANK};
  if(typeof module==='object'&&module.exports)module.exports=root.CofiringPeriodManualStorage;
})(typeof globalThis==='object'?globalThis:this);
