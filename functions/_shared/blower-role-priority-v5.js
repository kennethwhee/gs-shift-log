/* Operational duty hierarchy, intentionally not the UI's display order.
 * Selection compares approved, parser-resolved facts for one physical job.
 * It never changes an author's text or manufactures a missing completion time.
 */
const text=value=>String(value??'').trim();
export const BLOWER_DUTY_SUPERIOR=Object.freeze({BO1:'BCO1',BO2:'BCO2',TO:'TGO'});
export const roleKey=value=>text(value).toUpperCase().replace(/[^A-Z0-9]/g,'');
export const shiftKey=value=>({DAY:'DS','주간':'DS',NIGHT:'NS','야간':'NS'}[text(value).toUpperCase()]||text(value).toUpperCase());
const groupKey=(row,fact)=>[text(row.work_date).slice(0,10),shiftKey(row.shift),fact.tagNumber].join('|');
const sourceKey=fact=>text(fact.sourceKey);
function repeatedJob(fact){return /(?:재\s*교체|재\s*교환|재차|다시\s*(?:교체|교환)|[2-9]\s*차\s*(?:교체|교환)|(?:두|세)\s*번째|별도\s*(?:작업|교체)|\brepeat(?:ed)?\b|\bagain\b)/i.test([fact.sourceText,...(fact.candidateTexts||[])].join(' '));}
function normalizedJobText(value){
  return text(value).normalize('NFKC').toUpperCase()
    .replace(/(?:[01]?\d|2[0-3]):[0-5]\d/g,'')
    .replace(/V\s*[-/]?\s*B(?:EL|LE)T|VBELT|V\s*벨트|벨트/g,'BELT')
    .replace(/교체\s*(?:작업\s*)?(?:완료|종료|실시|시행)/g,'교체')
    .replace(/(?:_?TM\s*작업|자체\s*작업)/g,'')
    .replace(/[\s\p{P}\p{S}]+/gu,'');
}
function explicitWorkIds(fact){
  return [...new Set([...text(fact.sourceText).toUpperCase().matchAll(/(?:작업\s*(?:지시\s*)?번호\s*[:#-]?\s*|\bWO\s*[-:#]?\s*|\bWORK\s*ORDER\s*[-:#]?\s*)([A-Z]*\d[A-Z0-9-]*)/g)].map(match=>match[1]))].sort();
}
function workEntryClock(item){
  let log;try{log=JSON.parse(item.row.log_json);}catch{return text(item.fact.sourceWorkEntryClock);}
  let key;try{key=JSON.parse(item.fact.sourceKey)?.[2];}catch{}
  const entryId=text(item.fact.sourceEntryId||key);
  for(const name of ['entries','tmEntries','handoverEntries','remarkEntries']){
    const entries=Array.isArray(log?.[name])?log[name]:[];
    const indexed=new RegExp('^'+name+':(\\d+)$').exec(entryId);
    const entry=entries.find(value=>text(value?.id)===entryId)||(indexed?entries[Number(indexed[1])]:null);
    if(entry&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(text(entry.time)))return text(entry.time);
  }
  return '';
}
function sameJob(lower,higher){
  if(lower.fact.recordDate!==higher.fact.recordDate || repeatedJob(lower.fact)||repeatedJob(higher.fact))return false;
  const lowerIds=explicitWorkIds(lower.fact),higherIds=explicitWorkIds(higher.fact);
  if(lowerIds.length && higherIds.length && JSON.stringify(lowerIds)!==JSON.stringify(higherIds))return false;
  // A shared original work-entry clock identifies the job, independently from
  // differing reported completion clocks. Clock proximity alone is no proof.
  const a=workEntryClock(lower),b=workEntryClock(higher);
  if(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(a)&&a===b)return true;
  // Equivalent equipment-specific work evidence can establish the same job
  // even when completion clocks disagree widely. Additional work identifiers
  // remain in the normalized text, so two distinct jobs are not collapsed.
  const left=[lower.fact.sourceText,...(lower.fact.candidateTexts||[])].map(normalizedJobText).filter(Boolean);
  const right=[higher.fact.sourceText,...(higher.fact.candidateTexts||[])].map(normalizedJobText).filter(Boolean);
  return left.some(value=>value.length>=12&&right.includes(value));
}
function factMeta(item){
  const {row,fact,hashes}=item;
  return {tagNumber:fact.tagNumber,sourceKey:sourceKey(fact),sourceRole:roleKey(fact.sourceRole||row.role),sourceLogId:row.id,
    sourceAliases:[...new Set([row.id,...(row.sourceAliases||[])])],...hashes,
    workDate:text(row.work_date).slice(0,10),shift:shiftKey(row.shift),eventDate:fact.eventDate,timePrecision:fact.timePrecision};
}
export function planBlowerRolePriority(records){
  const groups=new Map(),byRow=new Map(records.map(record=>[record.row.receiptId,{...record,selections:[],suppressions:[]}])) ;
  for(const record of records)for(const fact of record.facts){
    const role=roleKey(fact.sourceRole||record.row.role);
    if(!Object.hasOwn(BLOWER_DUTY_SUPERIOR,role)&&!Object.values(BLOWER_DUTY_SUPERIOR).includes(role))continue;
    const family=value=>Object.entries(BLOWER_DUTY_SUPERIOR).find(([low,high])=>[low,high].includes(value))?.[0]||value;
    if(family(role)!==family(roleKey(record.row.role)))continue;
    const key=groupKey(record.row,fact);if(!groups.has(key))groups.set(key,new Map());
    const roles=groups.get(key);if(!roles.has(role))roles.set(role,[]);roles.get(role).push({...record,fact});
  }
  const selections=[];
  for(const roles of groups.values())for(const [lowerRole,higherRole]of Object.entries(BLOWER_DUTY_SUPERIOR)){
    if(Object.values(BLOWER_DUTY_SUPERIOR).filter(role=>(roles.get(role)||[]).length).length>1)continue;
    const lower=roles.get(lowerRole)||[],higher=roles.get(higherRole)||[];
    // More than one entry/source on either side can represent separate jobs or
    // same-rank disagreement. Do not choose by arrival order or lexical ID.
    if(lower.length!==1||higher.length!==1||!sameJob(lower[0],higher[0]))continue;
    if(lower[0].row.id===higher[0].row.id)continue;
    const selected={...factMeta(higher[0]),suppressedSources:[factMeta(lower[0])]};
    selections.push(selected);
    byRow.get(higher[0].row.receiptId).selections.push(selected);
    byRow.get(lower[0].row.receiptId).suppressions.push({...factMeta(lower[0]),selection:selected});
  }
  const priority=record=>record.selections.length?0:record.suppressions.length?2:1;
  return {selections,records:[...byRow.values()].sort((a,b)=>priority(a)-priority(b)||text(a.row.receiptId).localeCompare(text(b.row.receiptId)))};
}
