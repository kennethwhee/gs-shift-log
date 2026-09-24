(function(root){
  'use strict';

  const API='/api/cofiring-closed-history';
  const MIN_DATE='2021-01-01';
  const core=root.CofiringCore||(typeof require==='function'?require('./cofiring-core.js'):null);

  function validDate(value){
    if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
    const d=new Date(value+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
  }

  function shiftDate(value,days){
    if(!validDate(value))return '';
    const d=new Date(value+'T00:00:00Z');
    d.setUTCDate(d.getUTCDate()+days);
    return d.toISOString().slice(0,10);
  }

  function koreanToday(){
    return new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
  }

  function clone(value){
    return value==null?value:JSON.parse(JSON.stringify(value));
  }

  function authHeaders(){
    try{
      return typeof root.getShiftLogAuthHeaders==='function'
        ? root.getShiftLogAuthHeaders()
        : {};
    }catch(_){
      return {};
    }
  }

  function change(element){
    element.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function number(value){
    if(value===null||value===undefined||typeof value==='boolean'||(typeof value==='string'&&!value.trim()))return null;
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  }

  function pct(value){
    const n=number(value);
    return n===null?'—':n.toFixed(2)+'%';
  }

  function tons(value){
    const n=number(value);
    return n===null?'—':n.toLocaleString('ko-KR',{
      minimumFractionDigits:2,
      maximumFractionDigits:2
    })+' t';
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,ch=>({
      '&':'&amp;',
      '<':'&lt;',
      '>':'&gt;',
      '"':'&quot;',
      "'":'&#39;'
    }[ch]));
  }

  function controller(){
    return root.__cofiringPeriodV5Controller||null;
  }

  function summaryFromResult(result){return core.summaryFromResult(result);}

  function expectedWrite(item){
    if(!item)return {expectedRevision:0,expectedVersion:null};
    if(!Number.isSafeInteger(item.revision)||item.revision<1||!/^[a-f0-9]{64}$/.test(item.version||'')){
      throw new Error('화면을 새로고침하고 최신 마감 자료를 확인해 주세요.');
    }
    return {expectedRevision:item.revision,expectedVersion:item.version};
  }
  function closeNotice(container,message,error=false){
    const label=container.querySelector('[data-cfv12-close-status]');
    if(label){label.hidden=!message;label.textContent=message;label.className=error?'cfv12-error':'';}
  }
  function changed(date){
    if(root.CustomEvent)root.dispatchEvent?.(new root.CustomEvent('cofiring:closed-history-changed',{detail:{targetDate:date}}));
  }
  function credential(){const h=authHeaders();return String(h.Authorization||h.authorization||'');}

  function buildSnapshot(container){
    const c=controller();

    if(!c){
      throw new Error('혼소율 계산 화면 연결을 확인해 주세요.');
    }

    const mode=container.querySelector('[data-cfv8-mode]')?.value;
    const date=container.querySelector('[data-cfv7-date]')?.value||'';

    if(mode!=='daily'){
      throw new Error('마감 저장은 일별 계산에서만 사용할 수 있습니다.');
    }

    if(!validDate(date)||date>=koreanToday()){
      throw new Error('오늘 이전의 날짜만 마감 저장할 수 있습니다.');
    }

    const result=c.getDisplayResult?.()||c.getResult?.();
    const spec=c.getSpec?.();
    const liveState=c.live?.state?.();

    if(!result||!spec){
      throw new Error('계산 완료된 결과가 없습니다.');
    }

    const expectedEnd=shiftDate(date,1)+'T00:00';

    if(
      spec.startLocal!==date+'T00:00'||
      spec.endLocal!==expectedEnd||
      spec.stepUnit!=='minute'||
      Number(spec.stepValue)!==1
    ){
      throw new Error('하루 전체 조회 결과만 마감 저장할 수 있습니다.');
    }

    const saved=liveState?.item?.saved;

    if(
      !saved||
      saved.status!=='complete'||
      liveState?.item?.active||
      liveState?.item?.loading||
      liveState?.item?.submitting
    ){
      throw new Error('DataPARC 조회가 완료된 뒤 마감 저장해 주세요.');
    }

    const settingsState=c.settings?.state?.();
    const manualState=c.manual?.state?.();

    if(
      !settingsState?.loaded||
      settingsState.loading||
      settingsState.saving||
      settingsState.error
    ){
      throw new Error('발열량·보정계수 저장 상태를 확인해 주세요.');
    }

    if(
      !manualState?.loaded||
      manualState.loading||
      manualState.saving||
      manualState.error
    ){
      throw new Error('유기성·축분 저장 상태를 확인해 주세요.');
    }

    const inputs=c.getSnapshotInputs?.();
    if(!inputs||inputs.sourceRequestId!==String(saved.id||'')){
      throw new Error('표시된 계산 결과의 조회 ID를 확인하지 못했습니다. 다시 계산해 주세요.');
    }
    const summary=summaryFromResult(result);

    return {
      targetDate:date,
      sourceRequestId:String(saved.id||''),
      summary,
      snapshot:{
        schemaVersion:1,
        targetDate:date,
        period:clone(spec),
        sourceRequestId:String(saved.id||''),
        result:clone(result),
        settings:clone(inputs.settings),
        manual:clone(inputs.manual),
        summary:clone(summary),
        capturedAt:new Date().toISOString()
      }
    };
  }

  async function api(path='',options={}){
    const response=await root.fetch(API+path,{
      credentials:'same-origin',
      cache:'no-store',
      ...options,
      headers:{
        ...authHeaders(),
        Accept:'application/json',
        ...(options.headers||{})
      }
    });

    let payload=null;

    try{payload=await response.json();}catch(_){}

    if(!response.ok||payload?.ok!==true){
      const error=new Error(payload?.message||'요청을 처리하지 못했습니다.');
      error.status=response.status;
      error.payload=payload;
      throw error;
    }

    return payload;
  }

  function mountDateNavigation(container){
    const field=container.querySelector('[data-cfv8-daily-fields]');
    const input=field?.querySelector('[data-cfv7-date]');

    if(!field||!input||field.dataset.cfv12Nav==='1')return;

    field.dataset.cfv12Nav='1';
    field.classList.add('cfv12-date-field');

    for(const node of Array.from(field.childNodes)){
      if(node!==input&&node.nodeType===3)node.remove();
    }

    const label=root.document.createElement('span');
    label.className='cfv12-date-label';
    label.textContent='혼소율 계산일';

    const nav=root.document.createElement('div');
    nav.className='cfv12-date-nav';

    const prev=root.document.createElement('button');
    prev.type='button';
    prev.className='cfv12-date-arrow';
    prev.textContent='‹';
    prev.setAttribute('aria-label','전날');

    const center=root.document.createElement('div');
    center.className='cfv12-date-center';

    const today=root.document.createElement('button');
    today.type='button';
    today.className='cfv12-date-today';
    today.textContent='오늘';

    const next=root.document.createElement('button');
    next.type='button';
    next.className='cfv12-date-arrow';
    next.textContent='›';
    next.setAttribute('aria-label','다음날');

    field.prepend(label);
    input.before(nav);

    nav.append(prev,center,next);
    center.append(input,today);

    function sync(){
      const value=input.value;
      const current=koreanToday();

      prev.disabled=!validDate(value)||value<=MIN_DATE;
      next.disabled=!validDate(value)||value>=current;
      today.disabled=value===current;
    }

    function setDate(value){
      if(!validDate(value))return;

      const current=koreanToday();

      if(value>current)value=current;
      if(value<MIN_DATE)value=MIN_DATE;

      if(input.value!==value){
        input.value=value;
        change(input);
      }

      sync();
    }

    prev.addEventListener('click',()=>setDate(shiftDate(input.value,-1)));
    next.addEventListener('click',()=>setDate(shiftDate(input.value,1)));
    today.addEventListener('click',()=>setDate(koreanToday()));
    input.addEventListener('change',sync);

    sync();
  }

  function listMarkup(items){
    if(!Array.isArray(items)||items.length===0){
      return `
        <div class="cfv12-empty">
          <strong>마감 저장된 데이터가 없습니다.</strong>
          <span>지난 날짜의 하루 전체 계산이 완료되면 [마감 저장]으로 보관할 수 있습니다.</span>
        </div>
      `;
    }

    return `
      <div class="cfv12-history-table-wrap">
        <table class="cfv12-history-table">
          <thead>
            <tr>
              <th>날짜</th>
              <th>1호기 Bio</th>
              <th>2호기 Bio</th>
              <th>종합 혼소율</th>
              <th>마감자</th>
              <th>마감 시각</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item=>`
              <tr>
                <td><strong>${escapeHtml(item.targetDate)}</strong></td>
                <td>${pct(item.summary?.unit1?.bioRatio)}</td>
                <td>${pct(item.summary?.unit2?.bioRatio)}</td>
                <td><strong>${pct(item.summary?.combined?.totalRatio)}</strong></td>
                <td>${escapeHtml(item.savedByName||'—')}</td>
                <td>${escapeHtml(
                  item.updatedAt
                    ? new Date(item.updatedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
                    : '—'
                )}</td>
                <td>
                  <div class="cfv12-row-actions">
                    <button type="button" data-cfv12-view="${escapeHtml(item.targetDate)}">보기</button>
                    <button type="button" class="danger" data-cfv12-delete="${escapeHtml(item.targetDate)}">삭제</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function detailMarkup(item){
    const s=item?.snapshot;
    const m=s?.summary;

    if(!s||!m)return '';

    const settings=s.settings||{};

    const settingsRows=['coal','bio','organic','manure'].map(fuel=>{
      const labels={
        coal:'Coal',
        bio:'Bio',
        organic:'유기성',
        manure:'축분'
      };

      return `
        <tr>
          <th>${labels[fuel]}</th>
          <td>${escapeHtml(settings?.unit1?.[fuel]?.calorific??'—')}</td>
          <td>${escapeHtml(settings?.unit1?.[fuel]?.coefficient??'—')}</td>
          <td>${escapeHtml(settings?.unit2?.[fuel]?.calorific??'—')}</td>
          <td>${escapeHtml(settings?.unit2?.[fuel]?.coefficient??'—')}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="cfv12-detail">
        <div class="cfv12-detail-head">
          <div>
            <strong>${escapeHtml(item.targetDate)} 마감 데이터</strong>
            <span>Revision ${escapeHtml(item.revision)} · ${escapeHtml(item.savedByName||'—')}</span>
          </div>
          <button type="button" data-cfv12-go="${escapeHtml(item.targetDate)}">계산일로 이동</button>
        </div>

        <div class="cfv12-detail-cards">
          <section>
            <strong>1호기</strong>
            <dl>
              <div><dt>Coal</dt><dd>${tons(m.unit1?.coal)}</dd></div>
              <div><dt>Bio</dt><dd>${tons(m.unit1?.bio)}</dd></div>
              <div><dt>유기성</dt><dd>${tons(m.unit1?.organic)}</dd></div>
              <div><dt>축분</dt><dd>${tons(m.unit1?.manure)}</dd></div>
              <div><dt>Bio 혼소율</dt><dd>${pct(m.unit1?.bioRatio)}</dd></div>
              <div><dt>종합 혼소율</dt><dd>${pct(m.unit1?.totalRatio)}</dd></div>
            </dl>
          </section>

          <section>
            <strong>2호기</strong>
            <dl>
              <div><dt>Coal</dt><dd>${tons(m.unit2?.coal)}</dd></div>
              <div><dt>Bio</dt><dd>${tons(m.unit2?.bio)}</dd></div>
              <div><dt>유기성</dt><dd>${tons(m.unit2?.organic)}</dd></div>
              <div><dt>축분</dt><dd>${tons(m.unit2?.manure)}</dd></div>
              <div><dt>Bio 혼소율</dt><dd>${pct(m.unit2?.bioRatio)}</dd></div>
              <div><dt>종합 혼소율</dt><dd>${pct(m.unit2?.totalRatio)}</dd></div>
            </dl>
          </section>

          <section class="overall">
            <strong>종합</strong>
            <div class="cfv12-total-ratio">${pct(m.combined?.totalRatio)}</div>
            <span>마감 시점 종합 혼소율</span>
          </section>
        </div>

        <details class="cfv12-basis">
          <summary>마감 시점 발열량 · 보정계수</summary>
          <table>
            <thead>
              <tr>
                <th>연료</th>
                <th>1호기 발열량</th>
                <th>1호기 보정</th>
                <th>2호기 발열량</th>
                <th>2호기 보정</th>
              </tr>
            </thead>
            <tbody>${settingsRows}</tbody>
          </table>
        </details>
      </div>
    `;
  }


  // COFIRING_AUTO_CLOSE_AFTER_CALC_V1
  // A completed past daily calculation is immediately persisted as the
  // authoritative closed snapshot for that calendar day.
  function bindAutoCloseAfterCalculation(container,refreshHistory){
    if(!container||container.dataset.cfv12AutoClose==='1')return;

    container.dataset.cfv12AutoClose='1';

    const calculateButton=container.querySelector('[data-cfv5-query]');
    const requeryButton=container.querySelector('[data-cfv5-requery]');
    const dateInput=container.querySelector('[data-cfv7-date]');
    const modeInput=container.querySelector('[data-cfv8-mode]');

    let generation=0;
    let saving=false;
    const waitMilliseconds=10*60*1000;
    const retryMilliseconds=250;

    function savedSourceId(){
      try{
        return String(
          controller()?.live?.state?.()?.item?.saved?.id||''
        );
      }catch(_){
        return '';
      }
    }

    function cancel(){
      generation+=1;
    }

    function schedule(
      token,
      targetDate,
      deadline,
      requireFreshSource,
      previousSourceId,
      baselinePromise,
      authKey
    ){
      root.setTimeout?.(
        ()=>{
          void attempt(
            token,
            targetDate,
            deadline,
            requireFreshSource,
            previousSourceId,
            baselinePromise,
            authKey
          );
        },
        retryMilliseconds
      );
    }

    async function attempt(
      token,
      targetDate,
      deadline,
      requireFreshSource,
      previousSourceId,
      baselinePromise,
      authKey
    ){
      if(token!==generation||credential()!==authKey)return;
      const baseline=await baselinePromise;
      if(token!==generation||credential()!==authKey)return;
      if(baseline.error){closeNotice(container,baseline.error.message,true);return;}

      if(
        modeInput?.value!=='daily'||
        dateInput?.value!==targetDate
      ){
        return;
      }

      let packed=null;

      try{
        packed=buildSnapshot(container);
      }catch(_){
        if(Date.now()<deadline){
          schedule(
            token,
            targetDate,
            deadline,
            requireFreshSource,
            previousSourceId,
            baselinePromise,
            authKey
          );
        }
        return;
      }

      if(
        token!==generation||
        packed.targetDate!==targetDate||
        !packed.sourceRequestId
      ){
        return;
      }

      // [재조회]는 기존 결과를 다시 저장하면 안 된다.
      // 실제 새 DataPARC 결과 ID가 도착한 뒤에만 마감 갱신한다.
      if(
        requireFreshSource&&
        previousSourceId&&
        packed.sourceRequestId===previousSourceId
      ){
        if(Date.now()<deadline){
          schedule(
            token,
            targetDate,
            deadline,
            requireFreshSource,
            previousSourceId,
            baselinePromise,
            authKey
          );
        }
        return;
      }

      if(saving){
        if(Date.now()<deadline)schedule(token,targetDate,deadline,requireFreshSource,previousSourceId,baselinePromise,authKey);
        return;
      }
      saving=true;

      try{
        await api('',{
          method:'POST',
          headers:{
            'Content-Type':'application/json'
          },
          body:JSON.stringify({
            ...packed,
            overwrite:baseline.expectedRevision>0,
            ...baseline
          })
        });

        if(token!==generation)return;

        closeNotice(container,'마감 저장 완료');
        changed(targetDate);

        try{
          if(typeof refreshHistory==='function'){
            await refreshHistory();
          }
        }catch(_){}

        root.console?.info?.(
          '[혼소율] 마감 데이터 자동 저장 완료',
          packed.targetDate,
          packed.sourceRequestId
        );

      }catch(error){
        if(token===generation&&credential()===authKey)closeNotice(container,'마감 저장 실패 · '+error.message,true);
        root.console?.error?.(
          '[혼소율] 마감 데이터 자동 저장 실패',
          error
        );

      }finally{
        saving=false;
      }
    }

    function arm(requireFreshSource){
      const targetDate=String(dateInput?.value||'');

      // 오늘은 아직 마감된 하루가 아니므로 저장하지 않는다.
      if(
        modeInput?.value!=='daily'||
        !validDate(targetDate)||
        targetDate>=koreanToday()
      ){
        return;
      }

      const previousSourceId=savedSourceId();
      const token=++generation;
      const deadline=Date.now()+waitMilliseconds;
      const authKey=credential();
      closeNotice(container,'');
      const baselinePromise=api('?targetDate='+encodeURIComponent(targetDate))
        .then(payload=>expectedWrite(payload.item)).catch(error=>({error}));

      // click handler의 기존 계산 로직이 먼저 진행될 시간을 준 뒤
      // 완료된 server result가 나타나는 즉시 저장한다.
      root.setTimeout?.(
        ()=>{
          void attempt(
            token,
            targetDate,
            deadline,
            requireFreshSource===true,
            previousSourceId,
            baselinePromise,
            authKey
          );
        },
        0
      );
    }

    calculateButton?.addEventListener(
      'click',
      ()=>arm(false)
    );

    requeryButton?.addEventListener(
      'click',
      ()=>arm(true)
    );

    dateInput?.addEventListener(
      'change',
      cancel
    );

    modeInput?.addEventListener(
      'change',
      cancel
    );
  }
  function mountTabs(container){
    const sheet=container.querySelector('.cfv5-sheet');

    if(!sheet||sheet.dataset.cfv12Tabs==='1')return;

    sheet.dataset.cfv12Tabs='1';

    const title=sheet.querySelector('.cfv5-title-row');
    if(!title)return;

    const toolbar=root.document.createElement('div');
    toolbar.className='cfv12-toolbar';

    const tabs=root.document.createElement('div');
    tabs.className='cfv12-tabs';

    const calc=root.document.createElement('button');
    calc.type='button';
    calc.className='cfv12-tab';
    calc.textContent='혼소율 계산';
    calc.setAttribute('aria-selected','true');

    const history=root.document.createElement('button');
    history.type='button';
    history.className='cfv12-tab';
    history.textContent='마감 데이터';
    history.setAttribute('aria-selected','false');

    const closeButton=root.document.createElement('button');
    closeButton.type='button';
    closeButton.className='cfv12-close-save';
    closeButton.textContent='마감 저장';

    tabs.append(calc,history);
    toolbar.append(tabs,closeButton);
    const closeStatus=root.document.createElement('div');
    closeStatus.setAttribute('data-cfv12-close-status','');
    closeStatus.setAttribute('role','status');
    closeStatus.setAttribute('aria-live','polite');
    closeStatus.hidden=true;

    const panel=root.document.createElement('section');
    panel.className='cfv12-history-panel';
    panel.hidden=true;

    panel.innerHTML=`
      <div class="cfv12-history-head">
        <div>
          <strong>마감 데이터</strong>
          <span>마감 당시 계산값과 기준값을 고정 저장합니다.</span>
        </div>
        <button type="button" data-cfv12-refresh>새로고침</button>
      </div>

      <div class="cfv12-history-body" data-cfv12-body>
        <div class="cfv12-loading">마감 데이터 확인 중...</div>
      </div>

      <div data-cfv12-detail></div>
    `;

    title.after(toolbar);
    toolbar.after(closeStatus,panel);

    const body=panel.querySelector('[data-cfv12-body]');
    const detail=panel.querySelector('[data-cfv12-detail]');
    const refresh=panel.querySelector('[data-cfv12-refresh]');

    function selectTab(name){
      const historyMode=name==='history';

      sheet.classList.toggle('cfv12-history-mode',historyMode);
      panel.hidden=!historyMode;
      closeButton.hidden=historyMode;

      calc.setAttribute('aria-selected',String(!historyMode));
      history.setAttribute('aria-selected',String(historyMode));

      if(historyMode)void loadList();
    }

    let listedItems=[];
    async function loadList(){
      body.innerHTML='<div class="cfv12-loading">마감 데이터 확인 중...</div>';
      detail.innerHTML='';

      try{
        const payload=await api('?limit=180');
        listedItems=payload.items||[];
        body.innerHTML=listMarkup(listedItems);
      }catch(error){
        body.innerHTML=`<div class="cfv12-error">${escapeHtml(error.message)}</div>`;
      }
    }

    async function viewDate(date){
      detail.innerHTML='<div class="cfv12-loading">마감 데이터 불러오는 중...</div>';

      try{
        const payload=await api('?targetDate='+encodeURIComponent(date));

        if(!payload.item){
          throw new Error('저장된 마감 데이터를 찾을 수 없습니다.');
        }

        detail.innerHTML=detailMarkup(payload.item);
        detail.scrollIntoView({behavior:'smooth',block:'nearest'});
      }catch(error){
        detail.innerHTML=`<div class="cfv12-error">${escapeHtml(error.message)}</div>`;
      }
    }

    async function saveClosed(){
      closeButton.disabled=true;closeButton.textContent='저장 중...';
      const authKey=credential();
      try{
        const packed=buildSnapshot(container);
        const save=expected=>api('',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...packed,...expected,overwrite:expected.expectedRevision>0})});
        let payload;
        try{payload=await save(expectedWrite(null));}
        catch(error){
          if(error.status!==409||error.payload?.code!=='ALREADY_CLOSED')throw error;
          if(credential()!==authKey)return;
          if(!root.confirm?.(packed.targetDate+'은 이미 마감 저장되어 있습니다.\n현재 계산값으로 갱신하시겠습니까?'))return;
          payload=await save(expectedWrite(error.payload.item));
        }
        changed(packed.targetDate);
        closeNotice(container,payload.message||'마감 저장했습니다.');
        root.alert?.(payload.message||'마감 저장했습니다.');
      }catch(error){closeNotice(container,error.message,true);root.alert?.(error.message);}
      finally{closeButton.disabled=false;closeButton.textContent='마감 저장';}
    }

    closeButton.addEventListener('click',()=>void saveClosed(false));
    calc.addEventListener('click',()=>selectTab('calc'));
    history.addEventListener('click',()=>selectTab('history'));
    refresh.addEventListener('click',()=>void loadList());

    bindAutoCloseAfterCalculation(
      container,
      loadList
    );

    panel.addEventListener('click',event=>{
      const view=event.target.closest?.('[data-cfv12-view]');
      const del=event.target.closest?.('[data-cfv12-delete]');
      const go=event.target.closest?.('[data-cfv12-go]');

      if(view){
        void viewDate(view.getAttribute('data-cfv12-view')||'');
        return;
      }

      if(del){
        const date=del.getAttribute('data-cfv12-delete')||'';

        if(!root.confirm?.(date+' 마감 데이터를 삭제하시겠습니까?'))return;

        void (async()=>{
          try{
            const expected=expectedWrite(listedItems.find(item=>item.targetDate===date));
            if(!expected.expectedRevision)throw new Error('마감 목록을 새로고침하고 다시 확인해 주세요.');
            const query=new URLSearchParams({targetDate:date,...expected});
            await api('?'+query.toString(),{method:'DELETE'});
            await loadList();
          }catch(error){
            root.alert?.(error.message);
          }
        })();

        return;
      }

      if(go){
        const date=go.getAttribute('data-cfv12-go')||'';
        const input=container.querySelector('[data-cfv7-date]');
        const mode=container.querySelector('[data-cfv8-mode]');

        if(mode)mode.value='daily';

        if(input&&validDate(date)){
          input.value=date;
          change(input);
        }

        selectTab('calc');
      }
    });
  }

  function mount(){
    const container=root.document?.querySelector?.('[data-cofiring-draft-root]');
    if(!container)return false;

    mountDateNavigation(container);
    mountTabs(container);

    return true;
  }

  function boot(){
    if(mount())return;

    if(!root.MutationObserver||!root.document?.body)return;

    const observer=new root.MutationObserver(()=>{
      if(mount())observer.disconnect();
    });

    observer.observe(root.document.body,{childList:true,subtree:true});
  }

  const exported={
    validDate,
    shiftDate,
    koreanToday,
    summaryFromResult
  };

  root.CofiringDateHistoryV1=exported;

  if(typeof module==='object'&&module.exports){
    module.exports=exported;
  }

  if(root.document){
    if(root.document.readyState==='loading'){
      root.document.addEventListener('DOMContentLoaded',boot,{once:true});
    }else{
      boot();
    }
  }

})(typeof globalThis==='object'?globalThis:this);
