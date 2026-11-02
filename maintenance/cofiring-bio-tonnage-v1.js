(function(root,factory){
  'use strict';
  const api=factory(root,root.CofiringBioTonnageCoreV1||(typeof module==='object'&&module.exports?require('./cofiring-bio-tonnage-core-v1.js'):null));
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CofiringBioTonnageV1=api;
})(typeof globalThis==='object'?globalThis:this,function(root,core){
  'use strict';
  const MINUTE=60000,HOUR=3600000,DAY=24*HOUR,KST=9*HOUR;
  const KEY='gs-shift-log.cofiring.bio-tonnage.v1';
  const MODES=['individual','combined','support','support2'];
  const states=new WeakMap();
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const nonnegative=n=>finite(n)&&n>=0;
  const number=(n,digits=2)=>finite(n)?n.toLocaleString('ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits}):'—';
  function parseQuantity(value){
    const text=String(value??'').trim();
    if(!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text))return null;
    const n=Number(text);return nonnegative(n)?n:null;
  }
  function timestamp(text,local){
    if(typeof text!=='string')return NaN;
    const m=(local?/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/:/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00(?:\.000)?(Z|[+-]\d{2}:\d{2})$/).exec(text);
    if(!m)return NaN;
    const [year,month,day,hour,minute]=m.slice(1,6).map(Number),wall=new Date(Date.UTC(year,month-1,day,hour,minute));
    if(year<2000||year>9998||month<1||month>12||day<1||hour>23||minute>59||wall.getUTCFullYear()!==year||wall.getUTCMonth()!==month-1||wall.getUTCDate()!==day)return NaN;
    let offset=KST;
    if(!local){offset=0;if(m[6]!=='Z'){const h=Number(m[6].slice(1,3)),n=Number(m[6].slice(4,6));if(h>14||n>59||(h===14&&n!==0))return NaN;offset=(h*60+n)*MINUTE*(m[6][0]==='-'?-1:1);}}
    return wall.getTime()-offset;
  }
  function periodInstant(period,key){
    if(!period||typeof period!=='object')return NaN;
    const values=[];
    if(period[key+'Local']!=null)values.push(timestamp(period[key+'Local'],true));
    if(period[key]!=null)values.push(timestamp(period[key],false));
    if(period[key+'Ms']!=null)values.push(period[key+'Ms']);
    if(!values.length||values.some(v=>!finite(v)||v%MINUTE!==0)||values.some(v=>v!==values[0]))return NaN;
    return values[0];
  }
  function contextFor(result,options={}){
    const stop=(status,message)=>({valid:false,status,message,current:null,remainingHours:null,deadlineMs:null});
    if(options.blocked)return stop('blocked',options.reason||'조회가 완료된 뒤 목표량 안내를 표시합니다.');
    if(options.targetError)return stop('invalid_input','계산 입력값을 확인한 뒤 목표량 안내를 표시합니다.');
    if(!result)return stop('no_result','당일 누적 조회 후 표시합니다.');
    if(result.hypothesisDisplay||result.organicUsage?.scenario||result.organicUsage?.sharedScenarioPending)return stop('hypothesis','추정 화면에서는 목표량 안내를 보류합니다.');
    const p=result.period,start=periodInstant(p,'start'),end=periodInstant(p,'end');
    if(!finite(start)||!finite(end)||end<=start||end-start>DAY)return stop('invalid_period','자료의 조회 기간을 확인해 주세요.');
    const local=new Date(start+KST).toISOString().slice(0,16),date=local.slice(0,10);
    if(date<'2021-01-01'||!local.endsWith('T00:00')||(p.targetDate!=null&&p.targetDate!==date))return stop('unsupported_period','해당일 00:00부터 조회한 누적 자료가 필요합니다.');
    if((p.durationHours!=null&&(!finite(p.durationHours)||Math.abs(p.durationHours-(end-start)/HOUR)>1e-9))||(p.durationMinutes!=null&&(!finite(p.durationMinutes)||p.durationMinutes!==(end-start)/MINUTE)))return stop('invalid_period','조회 기간과 누적 시간이 일치하지 않습니다.');
    const selected=options.selectedPeriod;
    if(!selected||periodInstant(selected,'start')!==start||periodInstant(selected,'end')!==end)return stop('changed_selection','선택한 기간과 일치하는 조회 결과가 필요합니다.');
    const now=Object.hasOwn(options,'now')?options.now:Date.now(),deadline=start+DAY;
    if(!finite(now)||!finite(new Date(now).getTime()))return stop('invalid_now','현재 시각을 확인할 수 없습니다.');
    if(end>now)return stop('future_data','현재 시각 이후의 자료로 안내할 수 없습니다.');
    const current=['unit1','unit2'].map(unit=>result.units?.[unit]?.bio);
    if(current.some(bio=>bio?.complete!==true||!nonnegative(bio.quantity)))return stop('incomplete_bio','두 호기의 Bio 누적 실사용량 확인이 필요합니다.');
    return {valid:true,status:now>=deadline||end===deadline?'closed':'active',message:'',current:current.map(bio=>bio.quantity),targetDate:date,startMs:start,endMs:end,deadlineMs:deadline,dataAsOfLocal:new Date(end+KST).toISOString().slice(0,16),remainingHours:now>=deadline?0:(deadline-end)/HOUR,lagMinutes:(now-end)/MINUTE};
  }
  function viewModel(result,preferences,options={}){
    const context=contextFor(result,options);
    const manualTargets=(preferences?.targets||[]).map(parseQuantity),mode=MODES.includes(preferences?.mode)?preferences.mode:'combined';
    const individual=mode==='individual',manualValid=manualTargets.length===2&&manualTargets.every(nonnegative)&&finite(manualTargets[0]+manualTargets[1]);
    const unitTargetTotal=manualValid?manualTargets[0]+manualTargets[1]:null;
    const plannedRate1=parseQuantity(preferences?.plannedRate1),plannedRate2=parseQuantity(preferences?.plannedRate2);
    const helperIndex=mode==='support'?0:mode==='support2'?1:null,plannedIndex=helperIndex===null?null:1-helperIndex;
    const plannedValid=plannedIndex===null||(plannedIndex===0?plannedRate1:plannedRate2)!==null;
    const hasCombinedTarget=!!(preferences&&Object.hasOwn(preferences,'combinedTarget'));
    const combinedTarget=hasCombinedTarget?parseQuantity(preferences.combinedTarget):unitTargetTotal;
    const combinedValid=individual||nonnegative(combinedTarget),goalsValid=individual?manualValid:true;
    // Derived global goals can contain a third decimal. They are numeric core
    // inputs, never parsed as a two-decimal manual draft or saved over one.
    const effectiveTargets=individual?manualTargets:combinedValid?[combinedTarget/2,combinedTarget/2]:[null,null];
    const targets=effectiveTargets;
    const precision=!individual&&nonnegative(combinedTarget)&&Math.abs(combinedTarget/2-Math.round(combinedTarget/2*100)/100)>1e-9?3:2;
    let calculation=null;
    if(context.valid&&goalsValid&&combinedValid&&plannedValid&&typeof core?.calculate==='function')calculation=core.calculate({targets,current:context.current,remainingHours:context.remainingHours,mode,plannedRate1,plannedRate2,...(hasCombinedTarget?{combinedTarget}:{})});
    let status=context.message;
    if(context.valid){
      if(context.status==='closed')status='조회일 종료 · 추가 투입 계획을 표시하지 않습니다.';
      else if(!goalsValid)status='목표량을 0 이상의 숫자로 입력해 주세요.';
      else if(!combinedValid)status='합계 목표량을 0 이상의 숫자로 입력해 주세요.';
      else if(!plannedValid)status=(plannedIndex+1)+'호기 예정 투입속도를 직접 입력해 주세요.';
      else if(!calculation?.valid)status='입력값 범위를 확인해 주세요.';
      else if(calculation.excess>1e-8)status=(mode==='individual'?'호기별 목표 합계보다 ':'입력한 합계 목표보다 ')+number(calculation.excess)+' t 초과 예상';
      else status=helperIndex!==null?(helperIndex+1)+'호기 지원 · 합계 목표의 절반씩 기준':mode==='combined'?'합계 목표의 절반씩 · 이미 초과한 양은 반대 호기에 반영':'각 호기의 목표량 기준';
    }
    return {context,calculation,mode,helperIndex,plannedIndex,goalsValid,combinedValid,plannedValid,manualValid,effectiveTargets,precision,unitTargetTotal,targetTotal:mode==='individual'?unitTargetTotal:combinedTarget,status};
  }
  function readPreferences(){
    const preferences={targets:['361.4','361.4'],combinedTarget:'722.8',mode:'combined',plannedRate1:'',plannedRate2:''};
    try{
      const value=JSON.parse(root.localStorage?.getItem(KEY)||'null');
      if(value&&Array.isArray(value.targets)&&value.targets.length===2&&value.targets.every(target=>nonnegative(target)&&parseQuantity(target)!==null)&&finite(value.targets[0]+value.targets[1]))preferences.targets=value.targets.map(String);
      if(MODES.includes(value?.mode))preferences.mode=value.mode;
      if(value&&typeof value==='object'&&!Array.isArray(value)){
        if(Object.hasOwn(value,'combinedTarget'))preferences.combinedTarget=value.combinedTarget==null?'':String(value.combinedTarget);
        else{
          preferences.combinedTarget=String(Number((Number(preferences.targets[0])+Number(preferences.targets[1])).toFixed(2)));
          // One migration, before a later unit-goal edit can change its basis.
          root.localStorage?.setItem(KEY,JSON.stringify({targets:preferences.targets.map(Number),combinedTarget:Number(preferences.combinedTarget),mode:preferences.mode}));
        }
      }
    }catch(_){}
    return preferences;
  }
  function savePreferences(state){
    const targets=state.preferences.targets.map(parseQuantity),combined=parseQuantity(state.preferences.combinedTarget);
    if(combined!==null)state.lastValidCombinedTarget=combined;
    if(targets.length===2&&targets.every(target=>nonnegative(target)&&parseQuantity(target)!==null)&&finite(targets[0]+targets[1]))state.lastValidManualTargets=targets.slice();
    // Last valid values are storage receipts only. Current manual/total drafts
    // stay untouched, and an invalid individual draft never gets a fallback.
    const storedCombined=combined??state.lastValidCombinedTarget,storedTargets=state.lastValidManualTargets;
    if(!nonnegative(storedCombined)||!Array.isArray(storedTargets)||storedTargets.length!==2||!storedTargets.every(target=>nonnegative(target)&&parseQuantity(target)!==null)||!finite(storedTargets[0]+storedTargets[1]))return;
    try{root.localStorage?.setItem(KEY,JSON.stringify({targets:storedTargets,combinedTarget:storedCombined,mode:state.preferences.mode}));}catch(_){}
  }
  function node(tag,className,text){const el=root.document.createElement(tag);if(className)el.className=className;if(text!=null)el.textContent=text;return el;}
  function attribute(el,key,value){el.setAttribute(key,String(value));return el;}
  function field(tag,name,className,text){return attribute(node(tag,className,text),'data-bio-tonnage-field',name);}
  function createUnit(unit,index,state){
    const section=attribute(node('section','cfbt-card'),'data-bio-tonnage-card',unit);section.setAttribute('aria-label',(index+1)+'호기 Bio 목표량 안내');
    const main=node('div','cfbt-main'),goal=node('label','cfbt-goal','Bio 목표량 '),input=attribute(node('input'),'data-bio-tonnage-target',unit);
    input.type='text';input.inputMode='decimal';input.autocomplete='off';input.spellcheck=false;input.value=state.preferences.targets[index];input.setAttribute('aria-label',(index+1)+'호기 Bio 목표량, 톤');
    goal.append(input,node('span','','t'));
    const rate=node('span','cfbt-rate');rate.append(field('span','rate-label'+index,'','필요'),field('strong','rate'+index,'','—'),node('small','','t/h'));
    const need=node('span','cfbt-additional');need.append(field('span','need-label'+index,'','추가 '),field('strong','need'+index,'','—'),node('span','',' t'));
    main.append(goal,rate,need,field('span','tail'+index,'cfbt-tail','마감 예상 —'));section.append(main);return section;
  }
  function createShared(state){
    const wrapper=attribute(node('div','cfbt-shared'),'data-bio-tonnage-shared','');
    const details=attribute(node('details','cfbt-settings'),'data-bio-tonnage-settings',''),summary=node('summary'),totals=node('span','cfbt-totals');
    const total=attribute(node('span','cfbt-unit-total','호기 목표 합계 '),'data-bio-tonnage-unit-total',''),editor=attribute(node('label','cfbt-total-edit'),'data-bio-tonnage-total-editor',''),inputTotal=attribute(node('input'),'data-bio-tonnage-combined-target',''),final=node('span','','마감 예상 ');
    inputTotal.type='text';inputTotal.inputMode='decimal';inputTotal.autocomplete='off';inputTotal.spellcheck=false;inputTotal.value=state.preferences.combinedTarget;inputTotal.setAttribute('aria-label','오늘 합계 Bio 목표량, 톤');
    editor.append(node('span','','합계 목표량'),inputTotal,node('span','','t'));
    // Editing a field inside native summary must not activate the disclosure.
    editor.addEventListener('click',event=>event.stopPropagation?.());editor.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')event.stopPropagation?.();});
    total.append(field('strong','target-total','','—'));final.append(field('strong','final-total','','—'));totals.append(editor,total,final);
    summary.append(totals,node('span','cfbt-settings-label','목표·지원 설정 ⌄'));
    const body=node('div','cfbt-settings-body'),controls=node('div','cfbt-controls'),modes=attribute(node('div','cfbt-modes'),'role','group');modes.setAttribute('aria-label','목표량 계산 방식');
    for(const [mode,label]of[['individual','호기별 목표'],['combined','합계 목표 조정'],['support','1호기 지원'],['support2','2호기 지원']]){const button=attribute(node('button','',label),'data-bio-tonnage-mode',mode);button.type='button';modes.append(button);}
    const plan=attribute(node('label','cfbt-plan'),'data-bio-tonnage-plan-row',''),input=attribute(node('input'),'data-bio-tonnage-plan','');
    input.type='text';input.inputMode='decimal';input.autocomplete='off';input.spellcheck=false;input.value='';input.placeholder='직접 입력';input.setAttribute('aria-label','2호기 예정 투입속도, 시간당 톤');
    plan.append(field('span','plan-label','','2호기 예정 투입속도'),input,node('span','','t/h · 마감까지 유지 추정'));
    const proof=field('span','proof','cfbt-proof','');proof.hidden=true;controls.append(modes,plan,proof);body.append(controls);details.append(summary,body);
    wrapper.append(details,field('p','basis','cfbt-basis','당일 누적 조회 후 표시합니다.'),field('p','status','cfbt-status',''));return wrapper;
  }
  function stateFor(container){
    let state=states.get(container);if(state)return state;
    const preferences=readPreferences();
    state={container,preferences,lastValidCombinedTarget:parseQuantity(preferences.combinedTarget),lastValidManualTargets:preferences.targets.map(parseQuantity),result:null,options:{},query:{},invalidSelection:false,day:null,timer:null,planInputIndex:null,planCarets:[null,null],units:[],shared:null,handlers:[]};
    state.units=['unit1','unit2'].map((unit,index)=>createUnit(unit,index,state));state.shared=createShared(state);states.set(container,state);
    const input=event=>{
      const el=event.target;
      if(el?.hasAttribute?.('data-bio-tonnage-target')){if(state.preferences.mode!=='individual'||el.readOnly){paint(state);return;}const index=el.getAttribute('data-bio-tonnage-target')==='unit1'?0:1;state.preferences.targets[index]=el.value;savePreferences(state);paint(state);}
      else if(el?.hasAttribute?.('data-bio-tonnage-combined-target')){state.preferences.combinedTarget=el.value;savePreferences(state);paint(state);}
      else if(el?.hasAttribute?.('data-bio-tonnage-plan')){const index=state.preferences.mode==='support2'?0:1;state.preferences['plannedRate'+(index+1)]=el.value;state.planCarets[index]=[el.selectionStart,el.selectionEnd];paint(state);}
      else if(el?.matches?.('[data-cfv7-date],[data-cfv8-start],[data-cfv8-end],[data-cfv8-mode]')){state.invalidSelection=true;paint(state);}
    };
    const click=event=>{const button=event.target?.closest?.('[data-bio-tonnage-mode]');if(!button||!container.contains(button)||button.disabled)return;const mode=button.getAttribute('data-bio-tonnage-mode');if(!MODES.includes(mode))return;state.preferences.mode=mode;savePreferences(state);paint(state);};
    for(const [name,handler]of[['input',input],['change',input],['click',click]]){container.addEventListener(name,handler);state.handlers.push([name,handler]);}
    return state;
  }
  function nowFor(state){return typeof state.options.now==='function'?state.options.now():Object.hasOwn(state.options,'now')?state.options.now:Date.now();}
  function matchesVisibleSelection(state){
    const {container,result}=state,p=result?.period;if(!p)return true;
    const startMs=periodInstant(p,'start');if(!finite(startMs))return false;
    const mode=container.querySelector('[data-cfv8-mode]')?.value;
    if(mode==='period'){const start=container.querySelector('[data-cfv8-start]'),end=container.querySelector('[data-cfv8-end]');if(start&&timestamp(start.value,true)!==periodInstant(p,'start'))return false;if(end&&timestamp(end.value,true)!==periodInstant(p,'end'))return false;}
    else{const date=container.querySelector('[data-cfv7-date]');if(date&&date.value!==new Date(startMs+KST).toISOString().slice(0,10))return false;}
    return true;
  }
  function paint(state){
    if(state.timer!==null){root.clearTimeout?.(state.timer);state.timer=null;}
    const query=state.query||{},blocked=!!(query.busy||query.failed||query.authenticated===false||state.suspended||state.invalidSelection||!matchesVisibleSelection(state));
    const reason=state.suspended?'화면을 다시 열면 목표량 안내를 갱신합니다.':query.reason|| (query.failed?'최근 조회가 실패해 목표량 안내를 보류합니다.':query.authenticated===false?'로그인 후 조회 결과를 확인해 주세요.':state.invalidSelection?'선택한 기간의 조회 결과를 기다리고 있습니다.':'조회가 완료된 뒤 목표량 안내를 표시합니다.');
    const model=viewModel(state.result,state.preferences,{...state.options,now:nowFor(state),blocked,reason});
    const all=[...state.units,state.shared],put=(name,text)=>{for(const host of all){const el=host.querySelector('[data-bio-tonnage-field="'+name+'"]');if(el)el.textContent=text;}};
    const calculation=model.calculation,active=!!(model.context.valid&&calculation?.valid&&calculation.projectionAvailable&&model.context.status==='active');
    for(let index=0;index<2;index++){
      const input=state.units[index].querySelector('[data-bio-tonnage-target]'),individual=model.mode==='individual';
      const goal=individual?state.preferences.targets[index]:nonnegative(model.effectiveTargets[index])?String(Number(model.effectiveTargets[index].toFixed(3))):'';
      if(input.value!==goal){const focused=root.document.activeElement===input,start=input.selectionStart,end=input.selectionEnd;input.value=goal;if(focused&&Number.isInteger(start)&&Number.isInteger(end))try{input.setSelectionRange(Math.min(start,goal.length),Math.min(end,goal.length));}catch(_){}}
      input.readOnly=!individual;input.disabled=!model.context.valid;input.placeholder=individual?'':'—';input.title=individual?'호기별 목표 직접 입력':'합계 목표의 절반 자동';input.setAttribute('aria-readonly',String(!individual));input.setAttribute('aria-label',(index+1)+'호기 Bio 목표량, '+(individual?'직접 입력':'합계 목표의 절반 자동')+', 톤');input.setAttribute('aria-invalid',String(individual?parseQuantity(state.preferences.targets[index])===null:!model.combinedValid));
      const planned=index===model.plannedIndex;put('rate-label'+index,planned?'예정':'필요');put('need-label'+index,planned?'예정 추가 ':'추가 ');
      put('rate'+index,active?number(calculation.rates[index]):'—');put('need'+index,active?number(calculation.need[index],model.precision):'—');
      put('tail'+index,active?(index===model.helperIndex&&calculation.support>1e-8?'그중 지원 '+number(calculation.support,model.precision)+' t':'마감 예상 '+number(calculation.final[index],model.precision)+' t'):'마감 예상 —');
    }
    put('target-total',finite(model.unitTargetTotal)?number(model.unitTargetTotal)+' t':'—');put('final-total',active?number(calculation.finalTotal,model.precision)+' t':'—');
    const totalEditor=state.shared.querySelector('[data-bio-tonnage-total-editor]'),unitTotal=state.shared.querySelector('[data-bio-tonnage-unit-total]'),totalInput=state.shared.querySelector('[data-bio-tonnage-combined-target]');
    totalEditor.hidden=model.mode==='individual';unitTotal.hidden=model.mode!=='individual';totalInput.disabled=!model.context.valid||model.mode==='individual';totalInput.setAttribute('aria-invalid',String(model.mode!=='individual'&&!model.combinedValid));
    for(const button of state.shared.querySelectorAll('[data-bio-tonnage-mode]')){button.disabled=!model.context.valid;button.setAttribute('aria-pressed',String(button.getAttribute('data-bio-tonnage-mode')===model.mode));}
    const planRow=state.shared.querySelector('[data-bio-tonnage-plan-row]'),planInput=state.shared.querySelector('[data-bio-tonnage-plan]');
    const plannedIndex=model.plannedIndex??state.planInputIndex??1,isSupport=model.helperIndex!==null;
    if(state.planInputIndex!==plannedIndex){
      const focused=root.document.activeElement===planInput;
      if(focused&&state.planInputIndex!==null)state.planCarets[state.planInputIndex]=[planInput.selectionStart,planInput.selectionEnd];
      planInput.value=state.preferences['plannedRate'+(plannedIndex+1)];state.planInputIndex=plannedIndex;
      if(focused){const caret=state.planCarets[plannedIndex];try{planInput.setSelectionRange(caret?.[0]??planInput.value.length,caret?.[1]??planInput.value.length);}catch(_){}}
    }else if(planInput.value!==state.preferences['plannedRate'+(plannedIndex+1)])planInput.value=state.preferences['plannedRate'+(plannedIndex+1)];
    put('plan-label',(plannedIndex+1)+'호기 예정 투입속도');planInput.setAttribute('aria-label',(plannedIndex+1)+'호기 예정 투입속도, 시간당 톤');
    planRow.hidden=!isSupport;planInput.disabled=!model.context.valid||model.context.status!=='active';planInput.setAttribute('aria-invalid',String(model.context.status==='active'&&isSupport&&!model.plannedValid));
    const proof=state.shared.querySelector('[data-bio-tonnage-field="proof"]'),controls=state.shared.querySelector('.cfbt-controls'),body=state.shared.querySelector('.cfbt-settings-body');
    proof.hidden=!active;proof.className=isSupport?'cfbt-support-proof':'cfbt-proof';
    if(isSupport){if(proof.parentNode!==body)body.appendChild(proof);}else if(proof.parentNode!==controls)controls.appendChild(proof);
    put('proof',active?(isSupport?'현재 합계 '+number(calculation.current,model.precision)+' t + 1호기 '+(model.plannedIndex===0?'예정 ':'추가 ')+number(calculation.need[0],model.precision)+' t + 2호기 '+(model.plannedIndex===1?'예정 ':'추가 ')+number(calculation.need[1],model.precision)+' t → 마감 예상 '+number(calculation.finalTotal,model.precision)+' t':'예상 마감량 · 1호기 '+number(calculation.final[0],model.precision)+' t / 2호기 '+number(calculation.final[1],model.precision)+' t'):'');
    const context=model.context;
    let basis=context.message;
    if(context.valid){const minutes=Math.max(0,Math.round(context.remainingHours*60)),remaining=minutes>=60?Math.floor(minutes/60)+'시간'+(minutes%60?' '+minutes%60+'분':''):minutes+'분';basis=context.status==='closed'?'조회일 종료 · 자료 '+context.dataAsOfLocal.replace('T',' ')+' 기준':'자료 '+context.dataAsOfLocal.slice(11)+' 기준 → 마감 24:00 · '+remaining+' 기준 · 자료 지연 '+number(context.lagMinutes,1)+'분';}
    put('basis',basis);put('status',model.status);const status=state.shared.querySelector('[data-bio-tonnage-field="status"]');status.classList.toggle('is-warning',!model.context.valid||(model.context.status==='active'&&(!model.goalsValid||!model.combinedValid||!model.plannedValid||!!(active&&calculation.excess>1e-8))));
    if(context.valid&&context.status==='active'&&root.setTimeout){state.timer=root.setTimeout(()=>{state.timer=null;paint(state);},Math.min(60000,Math.max(20,context.deadlineMs-nowFor(state)+10)));state.timer?.unref?.();}
    return model;
  }
  function retain(container){
    const state=states.get(container),active=root.document?.activeElement;
    if(!state||!active||![...state.units,state.shared].some(node=>node.contains(active)))return ()=>{};
    const start=active.selectionStart,end=active.selectionEnd;
    return ()=>{if(!container.contains(active))return;active.focus?.({preventScroll:true});if(Number.isInteger(start)&&Number.isInteger(end))try{active.setSelectionRange(start,end);}catch(_){}};
  }
  function render(container,result,options={}){
    if(!root.document?.createElement||!container?.querySelector||!container?.addEventListener)return false;
    const host=container.querySelector('[data-cfv52-summary-grid]');if(!host?.insertBefore)return false;
    try{
    const state=stateFor(container);state.result=result||null;state.options=options;state.invalidSelection=false;state.suspended=false;
    const selectedStart=periodInstant(options.selectedPeriod||result?.period,'start'),date=finite(selectedStart)?new Date(selectedStart+KST).toISOString().slice(0,10):null;if(date&&state.day&&state.day!==date){state.preferences.plannedRate1='';state.preferences.plannedRate2='';state.planCarets=[null,null];state.shared.querySelector('[data-bio-tonnage-plan]').value='';}if(date)state.day=date;
    for(const [index,unit]of['unit1','unit2'].entries()){
      const card=[...host.querySelectorAll('[data-cfv52-unit="'+unit+'"]')].find(el=>el.getAttribute('data-adjustment-kind')!=='adjusted'&&!el.classList.contains('cfv-adjustment-card'));
      const target=card?.querySelector('[data-cfv6-target]');if(target?.parentNode)target.parentNode.insertBefore(state.units[index],target.nextSibling);else state.units[index].remove?.();
    }
    const total=[...host.children].find(el=>el.classList.contains('cfv52-card-total'));if(total)host.insertBefore(state.shared,total);else host.appendChild(state.shared);
    return paint(state);
    }catch(_){const state=states.get(container);if(state){if(state.timer!==null)root.clearTimeout?.(state.timer);state.timer=null;for(const own of [...state.units,state.shared])own?.remove?.();}return false;}
  }
  function setQueryState(container,query){const state=states.get(container);if(!state)return false;state.query={...query};return paint(state);}
  function suspend(container){const state=states.get(container);if(!state)return;state.suspended=true;return paint(state);}
  function dispose(container){const state=states.get(container);if(!state)return;if(state.timer!==null)root.clearTimeout?.(state.timer);for(const [event,handler]of state.handlers)container.removeEventListener?.(event,handler);for(const own of [...state.units,state.shared])own.remove?.();states.delete(container);}
  return Object.freeze({render,retain,setQueryState,suspend,dispose,contextFor,viewModel,parseQuantity});
});
