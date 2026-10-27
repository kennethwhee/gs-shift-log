/* GS co-firing save notice V1: presentation only, below the result cards. */
(function(root){
'use strict';
if(root.GSCofiringSaveNoticeCompactV1)return;
const MARKER='[data-cfv-save-notice-v1]';
const OLD='[data-gs-v14-save-status],[data-v14-save-status]';
const watched=new WeakSet();
let nextId=0;
function setText(node,value){if(node.textContent!==value)node.textContent=value;}
function style(){
 const doc=root.document;if(!doc||doc.getElementById('gs-cfv-save-notice-compact-v1-css'))return;
 const el=doc.createElement('style');el.id='gs-cfv-save-notice-compact-v1-css';
 el.textContent=`
.cofiring-period-v5 .gs-cfv-save-notice{display:block;box-sizing:border-box;width:100%;max-width:100%;min-width:0;margin:7px 0 0;padding:0 2px;border:0;border-radius:0;background:transparent;color:#64748b;font-size:12px;font-weight:400;line-height:1.5;white-space:normal;overflow-wrap:anywhere}
.cofiring-period-v5 .gs-cfv-save-notice[data-tone=error]{background:transparent;border:0;color:#a33b27}
.cofiring-period-v5 .gs-cfv-save-notice[data-tone=success]{background:transparent;border:0;color:#087765}
.cofiring-period-v5 .gs-cfv-save-notice[data-tone=warn]{color:#96620d}
.cofiring-period-v5 .gs-cfv-save-notice-head{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap;min-width:0}
.cofiring-period-v5 .gs-cfv-save-notice-text{font:inherit;color:inherit;min-width:0}
.cofiring-period-v5 .gs-cfv-save-notice-toggle{display:inline-block;flex:0 0 auto;min-width:0;min-height:0;width:auto;height:auto;margin:0;padding:0 2px;border:0;border-radius:0;background:transparent;color:#526a80;font:inherit;line-height:inherit;text-decoration:underline;text-underline-offset:2px;box-shadow:none;cursor:pointer}
.cofiring-period-v5 .gs-cfv-save-notice-toggle:focus-visible{outline:2px solid #157a70;outline-offset:3px}
.cofiring-period-v5 .gs-cfv-save-notice-detail{margin:4px 0 0;padding:0;font:inherit;color:#64748b;white-space:pre-wrap;overflow-wrap:anywhere}
.cofiring-period-v5 .gs-cfv-save-notice [hidden]{display:none!important}
`;
 doc.head.append(el);
}
function presentation(message,tone){
 const original=String(message||'').trim();
 let label=original,detail='',kind=tone||'info';
 if(kind==='error'){
  label='⚠ 가정 계산이 저장되지 않았습니다.';
  detail=original.replace(/^가정 (?:기록|계산|조정) 저장 실패\s*[·:]?\s*/,'').trim();
  if(/^(?:가정 계산 저장을 완료하지 못했습니다\.?|가정 계산이 저장되지\s*않았습니다\.?|재조회 필요|다시 확인 필요)?$/.test(detail))detail='';
 }else if(kind==='success')label='가정 계산 저장 완료 · 미확정';
 else if(kind==='working')label='가정 계산 저장 중…';
 else if(kind==='warn'){
  label='가정 계산 저장 대기';
  detail=original.replace(/^가정 (?:계산 )?저장 대기\s*[·:]?\s*/,'').trim();
 }
 if(detail===label)detail='';
 return {label,detail,kind};
}
function watchDate(shell){
 if(watched.has(shell))return;watched.add(shell);
 const clear=event=>{
  if(event.target?.matches?.('[data-cfv7-date],[data-cfv8-mode]')){
   shell.querySelectorAll(MARKER).forEach(node=>node.remove());
  }
 };
 shell.addEventListener('change',clear,true);shell.addEventListener('input',clear,true);
}
function show(shell,message,tone=''){
 if(!shell||!root.document)return;
 const results=shell.querySelector('.cfv-results-dark');
 const grid=results?.querySelector('[data-cfv52-summary-grid]');
 if(!results||!grid)return;
 style();watchDate(shell);
 const text=String(message||'').trim();
 if(!text){shell.querySelectorAll(MARKER).forEach(node=>node.remove());return;}
 const date=shell.querySelector('[data-cfv7-date]')?.value||'';
 let row=results.querySelector(MARKER);
 if(row&&row.dataset.gsV14Date!==date){row.remove();row=null;}
 if(!row){
  row=root.document.createElement('div');row.className='gs-cfv-save-notice';
  row.dataset.cfvSaveNoticeV1='';row.dataset.gsV14SaveStatus='';row.dataset.v14SaveStatus='';
  row.dataset.gsV14Date=date;row.dataset.v14Date=date;
  const head=root.document.createElement('div');head.className='gs-cfv-save-notice-head';
  const label=root.document.createElement('span');label.className='gs-cfv-save-notice-text';
  label.setAttribute('role','status');label.setAttribute('aria-live','polite');label.setAttribute('aria-atomic','true');
  const toggle=root.document.createElement('button');toggle.type='button';toggle.className='gs-cfv-save-notice-toggle';
  toggle.textContent='자세히';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','가정 계산 저장 안내 자세히');
  const detail=root.document.createElement('p');detail.className='gs-cfv-save-notice-detail';detail.hidden=true;
  detail.id='gs-cfv-save-detail-v1-'+(++nextId);toggle.setAttribute('aria-controls',detail.id);
  toggle.addEventListener('click',()=>{
   detail.hidden=!detail.hidden;toggle.setAttribute('aria-expanded',String(!detail.hidden));
   setText(toggle,detail.hidden?'자세히':'닫기');
  });
  head.append(label,toggle);row.append(head,detail);
  // Keep this outside the summary grid: the existing renderer replaces its cards.
  // The established layout owns total/usage-panel ordering; do not fight its observer.
  const feedback=results.querySelector('[data-cfv-target-feedback]');
  if(feedback?.parentElement===results)results.insertBefore(row,feedback);
  else results.append(row);
 }
 for(const old of shell.querySelectorAll(OLD)){if(old!==row)old.remove();}
 const p=presentation(text,tone),label=row.querySelector('.gs-cfv-save-notice-text');
 const toggle=row.querySelector('button'),detail=row.querySelector('.gs-cfv-save-notice-detail');
 const changed=label.textContent!==p.label||detail.textContent!==p.detail||row.dataset.tone!==p.kind;
 if(row.dataset.tone!==p.kind)row.dataset.tone=p.kind;
 setText(label,p.label);setText(detail,p.detail);toggle.hidden=!p.detail;
 if(changed){
  detail.hidden=true;toggle.setAttribute('aria-expanded','false');setText(toggle,'자세히');
 }
}
root.GSCofiringSaveNoticeCompactV1=Object.freeze({show});
})(typeof globalThis==='object'?globalThis:this);
