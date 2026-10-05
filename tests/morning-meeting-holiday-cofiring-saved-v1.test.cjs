'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const repo = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
// Reuse the project's existing XML/API fixtures, without running their tests.
function harness(file, exports) {
  const source = read('tests/' + file);
  const sandbox = {require, __dirname: path.join(repo,'tests'), console, process, structuredClone,
    Headers, AbortController, URLSearchParams, URL, setImmediate, setTimeout, clearTimeout};
  vm.runInNewContext(source.slice(0, source.indexOf('\ntest(')) + '\nglobalThis.fixtureExports = {' + exports + '};', sandbox);
  return sandbox.fixtureExports;
}
const xml = harness('morning-meeting-final-history-alignment-v10.test.cjs', 'Document,addInlineCell,addMerge,findCell,textOf,mergeRefs,createWorksheet,NS');
const api = harness('morning-meeting-cofiring-effective-sync-v1.test.cjs', 'browser,fixture');
const labels = ['#1 BLR','#2 BLR','Average','Total'];
function col(n) { let s=''; while(n>0){const x=(n-1)%26;s=String.fromCharCode(65+x)+s;n=Math.floor((n-1)/26);}return s; }
function docFor(dates, {row=24, first=1, step=1, titleSpan=1}={}) {
  const doc=new xml.Document();
  for(const tag of ['sheetData','mergeCells']) doc.documentElement.appendChild(doc.createElementNS(xml.NS,tag));
  const cols=dates.map((_,i)=>col(first+1+i*step));
  xml.addInlineCell(doc,row,col(first),'Bio / 유기성 고형연료 혼소율(%)');
  xml.addMerge(doc,`${col(first)}${row}:${cols.at(-1)}${row+titleSpan-1}`);
  dates.forEach((date,i)=>xml.addInlineCell(doc,row+titleSpan,cols[i],date.slice(5,7)+'월 '+date.slice(8)+'일'));
  labels.forEach((label,i)=>{xml.addInlineCell(doc,row+titleSpan+1+i,col(first),label);
    cols.forEach(c=>xml.addInlineCell(doc,row+titleSpan+1+i,c,'OLD','73'));});
  xml.addInlineCell(doc,7,'X','TOP');
  xml.addInlineCell(doc,100,'B','업무내용');
  return {doc, cols, firstRow:row+titleSpan+1};
}
function saved(date,bio=25.80) { return {targetDate:date, unitOne:{bioRatio:bio,organicRatio:4.76,totalRatio:bio+4.76},
  unitTwo:{bioRatio:23.18,organicRatio:4.76,totalRatio:27.94},combined:{bioRatio:24.49,organicRatio:4.76,totalRatio:29.25}}; }
function setup({items={}, visible={}, selected='2026-10-02', load, blocked=new Set()}={}) {
  const calls=[];
  const root={document:{getElementById:id=>visible[id]||null},isMorningMeetingSelectedDateResetActive:date=>blocked.has(date),
    morningMeetingClosedCofiring:{targetDate:()=>selected,isBlocked:date=>blocked.has(date),
      state:date=>items[date]?{status:'complete',item:items[date]}:{status:'idle'},peek:date=>date===selected?items[date]:null,
      loadSavedForWorkbook:async date=>{calls.push(date);return load?load(date):null;}}};
  vm.runInNewContext(read('maintenance/morning-meeting-holiday-cofiring-saved-v1.js'),{window:root,console});
  return {root, writer:root.morningMeetingHolidayCofiringSavedV1,calls};
}
function values(f,i) { return labels.map((_,r)=>xml.textOf(xml.findCell(f.doc,f.cols[i]+(f.firstRow+r)))); }
const day=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
for(const count of [1,2,3,4,5,7,24]) test(`${count}-day holiday fills date-keyed cached values and preserves layout`,async()=>{
  const dates=Array.from({length:count},(_,i)=>day('2026-09-30',i));
  const items=Object.fromEntries(dates.map((d,i)=>[d,saved(d,20+i)]));
  const f=docFor(dates,{row:count>3?33:24,titleSpan:count>5?count-4:1});
  const before=JSON.stringify(xml.mergeRefs(f.doc));
  const h=setup({items,selected:dates.at(-1)});
  const result=await h.writer.apply(f.doc,[],{enabled:true,referenceDate:dates.at(-1),captured:h.writer.capture({startDate:dates[0],endDate:dates.at(-1)})});
  assert.equal(result.appliedDates.length,count);assert.equal(h.calls.length,0);
  dates.forEach((_,i)=>{assert.deepEqual(values(f,i),[(20+i).toFixed(2)+' / 4.76','23.18 / 4.76','24.49 / 4.76','29.25']);
    assert.equal(xml.findCell(f.doc,f.cols[i]+f.firstRow).getAttribute('s'),'73');});
  assert.equal(JSON.stringify(xml.mergeRefs(f.doc)),before);
  assert.equal(xml.textOf(xml.findCell(f.doc,'X7')),'TOP');assert.equal(xml.textOf(xml.findCell(f.doc,'B100')),'업무내용');
});
test('screenshot three-day fields are filled from their own saved rows',async()=>{
 const dates=['2026-09-30','2026-10-01','2026-10-02'];
 const items=Object.fromEntries(dates.map(d=>[d,saved(d)]));
 items[dates[0]].unitOne={bioRatio:26.51,organicRatio:4.68,totalRatio:31.19};items[dates[0]].unitTwo={bioRatio:19.83,organicRatio:4.65,totalRatio:24.48};
 items[dates[1]].unitOne={bioRatio:29.42,organicRatio:7.76,totalRatio:37.18};items[dates[1]].unitTwo={bioRatio:23.99,organicRatio:7.73,totalRatio:31.73};
 const f=docFor(dates,{first:30,step:3}),h=setup({items});
 await h.writer.apply(f.doc,[],{enabled:true,referenceDate:dates[2]});
 assert.deepEqual(dates.map((_,i)=>values(f,i).slice(0,2)),[['26.51 / 4.68','19.83 / 4.65'],['29.42 / 7.76','23.99 / 7.73'],['25.80 / 4.76','23.18 / 4.76']]);
});
test('captured visible values survive later missing caches without a saved-record request',async()=>{
 const date='2026-10-02',visible={efficiencyMorningMeetingCofiringDate:{textContent:date+' · 저장값'}};
 for(const [index,bio] of [[1,25.80],[2,23.18]]) for(const [key,value] of Object.entries({BioRatio:bio,OrganicRatio:4.76,TotalRatio:bio+4.76})) visible[`efficiencyMorningMeetingCofiringUnit${index}${key}`]={textContent:value.toFixed(2)+'%'};
 const h=setup({visible,load:()=>{throw Error('must not read');}}),f=docFor([date]);const captured=h.writer.capture();
 for(const element of Object.values(visible)) element.textContent='-';
 await h.writer.apply(f.doc,[],{enabled:true,referenceDate:date,captured});
 assert.deepEqual(values(f,0),['25.80 / 4.76','23.18 / 4.76','24.49 / 4.76','29.25']);assert.equal(h.calls.length,0);
});
test('rounded card values retain saved aggregate and full precision',async()=>{
 const date='2026-10-02',item=saved(date,25.804);item.combined.totalRatio=29.254;
 const h=setup({items:{[date]:item},visible:{efficiencyMorningMeetingCofiringDate:{textContent:date},efficiencyMorningMeetingCofiringUnit1BioRatio:{textContent:'25.80%'}}});
 const capture=h.writer.capture({startDate:date,endDate:date});
 assert.equal(capture.items[date].unitOne.bioRatio,25.804);assert.equal(capture.items[date].combined.totalRatio,29.254);
});
test('missing dates use stored-record reads and errors do not erase other dates',async()=>{
 const dates=['2026-09-30','2026-10-01','2026-10-02'],f=docFor(dates);
 const h=setup({load:date=>{if(date===dates[1])throw Error('offline');return saved(date);}});
 const result=await h.writer.apply(f.doc,[],{enabled:true,referenceDate:dates[2]});
 assert.deepEqual(Array.from(result.missingDates),[dates[1]]);assert.equal(result.appliedDates.length,2);
 assert.deepEqual(values(f,1),['','','','']);assert.equal(values(f,0)[0],'25.80 / 4.76');
 assert.deepEqual(h.calls.sort(),dates);
});
test('zero is valid, a wrong date is rejected, and reset dates stay empty',async()=>{
 const dates=['2026-09-30','2026-10-01','2026-10-02'],zero=saved(dates[0],0);
 for(const unit of ['unitOne','unitTwo','combined'])for(const key of ['bioRatio','organicRatio','totalRatio'])zero[unit][key]=0;
 const h=setup({items:{[dates[0]]:zero,[dates[2]]:saved(dates[2])},blocked:new Set([dates[2]]),load:()=>saved('2026-09-29')});const f=docFor(dates);
 const r=await h.writer.apply(f.doc,[],{enabled:true,referenceDate:dates[2]});
 assert.deepEqual(values(f,0),['0.00 / 0.00','0.00 / 0.00','0.00 / 0.00','0.00']);
 assert.deepEqual(values(f,1),['','','','']);assert.deepEqual(values(f,2),['','','','']);assert.deepEqual(h.calls,[dates[1]]);assert.equal(r.appliedDates.length,1);
});
test('year boundary uses exact date keys and shared string headers',async()=>{
 const dates=['2026-12-31','2027-01-01'],f=docFor(dates),shared=['12월 31일','01월 01일'];
 f.cols.forEach((c,i)=>{const cell=xml.findCell(f.doc,c+25);while(cell.firstChild)cell.removeChild(cell.firstChild);cell.setAttribute('t','s');const v=f.doc.createElementNS(xml.NS,'v');v.textContent=String(i);cell.appendChild(v);});
 const h=setup({load:d=>saved(d)});await h.writer.apply(f.doc,shared,{enabled:true,referenceDate:dates[1]});assert.deepEqual(h.calls,dates);
});
test('five-day layout moves once, then final values follow the final date headings',async()=>{
 const {document,bioColumns}=xml.createWorksheet(),h=setup({load:d=>saved(d,Number(d.slice(-2)))});
 h.root.morningMeetingClosedCofiring.load=()=>{throw Error('old layout must not read records');};
 vm.runInNewContext(read('maintenance/morning-meeting-final-history-alignment-v10.js'),{window:h.root,console});
 const layout=await h.root.applyMorningMeetingFinalHistoryAlignmentV10(document,[],{savedValuesHandledAfterLayout:true});
 assert.equal(layout.rowDelta,1);
 const r=await h.writer.apply(document,[],{enabled:true,referenceDate:'2026-09-21'});
 assert.equal(r.appliedDates.length,5);assert.deepEqual(h.calls.sort(),['2026-09-17','2026-09-18','2026-09-19','2026-09-20','2026-09-21']);
 assert.equal(xml.textOf(xml.findCell(document,bioColumns[0]+'28')),'17.00 / 4.76');
 assert.equal(xml.textOf(xml.findCell(document,'B32')),'1. 설비 운영팀');
});
test('read-only provider requests only the saved closing and does not repaint or load receipts',async()=>{
 const h=api.browser({installCard:false}),before=h.text('efficiencyMorningMeetingCofiringDate');
 const item=await h.provider.loadSavedForWorkbook('2026-09-30');
 assert.equal(item.targetDate,'2026-09-30');assert.equal(h.requests.length,1);
 assert.equal(h.requests[0].options.method,'GET');assert.ok(h.requests[0].url.startsWith('/api/cofiring-closed-history'));
 assert.equal(h.text('efficiencyMorningMeetingCofiringDate'),before);
 h.block(true);assert.equal(await h.provider.loadSavedForWorkbook('2026-09-30'),null);assert.equal(h.requests.length,1);
});
test('final hook executes after layout and before XML serialization; no weekday change',async()=>{
 const source=read('script.js'),start=source.indexOf('async function createMorningMeetingWorkbook()'),part=source.slice(start);
 const hook=part.indexOf('await window.morningMeetingHolidayCofiringSavedV1.apply');
 assert.ok(hook>part.indexOf('await window.applyMorningMeetingFinalHistoryAlignmentV10'));
 assert.ok(hook<part.indexOf('new XMLSerializer()',hook));
 assert.match(part,/if \(isWeekendMode\) \{[\s\S]*?holidayCofiringResult/);
 const h=setup(),f=docFor(['2026-10-02']);const r=await h.writer.apply(f.doc,[],{enabled:false});assert.equal(r.enabled,false);assert.equal(values(f,0)[0],'OLD');assert.equal(h.calls.length,0);
 assert.equal((read('index.html').match(/morning-meeting-holiday-cofiring-saved-v1\.js/g)||[]).length,1);
});
for(const first of ['AI','AJ']) test(`restored two-day template uses its ${first}/AM merged anchors`,async()=>{
 const helper=read('tests/morning-meeting-long-holiday-cofiring-v1.test.cjs');const extract={};
 vm.runInNewContext(helper.slice(helper.indexOf('function extractFunction'),helper.indexOf('class E'))+';globalThis.extractFunction=extractFunction;',extract);
 const f=docFor(['2026-09-12','2026-09-13'],{first:33,step:3});
 const doc=f.doc;
 // Restore requires all physical cells, as in the uploaded reference workbook.
 for(let r=24;r<=33;r++)for(let c=33;c<=41;c++)if(!xml.findCell(doc,col(c)+r))xml.addInlineCell(doc,r,col(c),'','73');
 const Element=doc.documentElement.constructor;
 Element.prototype.cloneNode=function(deep){const e=new Element(this.tagName,this.namespaceURI);for(const [k,v]of this.attributes)e.setAttribute(k,v);e._text=this._text;if(deep)for(const child of this.children)e.appendChild(child.cloneNode(true));return e;};
 const text=(d,c,v)=>{while(c.firstChild)c.removeChild(c.firstChild);c.removeAttribute('t');if(v==='')return;c.setAttribute('t','inlineStr');const i=d.createElementNS(xml.NS,'is'),t=d.createElementNS(xml.NS,'t');t.textContent=v;i.appendChild(t);c.appendChild(i);};
 const mergeRefs=['AG24:AO24'];
 for(let r=25;r<=29;r++)mergeRefs.push(`AG${r}:${first==='AI'?'AH':'AI'}${r}`,`${first}${r}:AL${r}`,`AM${r}:AO${r}`);
 mergeRefs.push('AG30:AO30',`AG31:${first==='AI'?'AH':'AI'}31`,`${first}31:AK31`,'AL31:AM31','AN31:AO31');
 // Start with only the valid date anchors and label anchors.
 for(let r=25;r<=29;r++)for(let c=34;c<=41;c++)text(doc,xml.findCell(doc,col(c)+r),'');
 const cells=doc.getElementsByTagNameNS(xml.NS,'c').filter(c=>{const m=c.getAttribute('r').match(/^([A-Z]+)(\d+)$/);return +m[2]>=24&&+m[2]<=33&&m[1]>='AG';}).map(c=>c.cloneNode(true));
 const parse=r=>{const m=r.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);return m?{startColumn:m[1],startRow:+m[2],endColumn:m[3],endRow:+m[4]}:null;};
 const context={MAIN_XML_NAMESPACE:xml.NS,getMorningMeetingDirectXmlChildren:(p,n)=>p.children.filter(c=>c.tagName===n),getMorningMeetingRowNumber:r=>+r.getAttribute('r'),getMorningMeetingCellColumn:a=>a.match(/^[A-Z]+/)[0],getMorningMeetingColumnNumber:c=>[...c].reduce((n,x)=>n*26+x.charCodeAt(0)-64,0),findMorningMeetingWorksheetCellByAddress:xml.findCell,parseMorningMeetingMergeReference:parse,formatMorningMeetingMergeReference:r=>`${r.startColumn}${r.startRow}:${r.endColumn}${r.endRow}`,parseMorningMeetingReportDate:d=>new Date(d+'T00:00:00Z'),addMorningMeetingDateDays:(d,n)=>new Date(d.getTime()+n*86400000),setMorningMeetingDynamicCellText:text};
 vm.createContext(context);vm.runInContext(extract.extractFunction(read('script.js'),'restoreMorningMeetingWeekendReferenceLayout'),context);
 const result=context.restoreMorningMeetingWeekendReferenceLayout(doc,{cells,mergeReferences:mergeRefs,startRow:24,endRow:33,startColumnNumber:33,endColumnNumber:41},'2026-09-30','2026-10-02');
 assert.equal(result.restored,true);assert.equal(xml.textOf(xml.findCell(doc,first+'25')),'10월 01일');assert.equal(xml.textOf(xml.findCell(doc,'AM25')),'10월 02일');
 const h=setup({load:d=>saved(d)});const r=await h.writer.apply(doc,[],{enabled:true,referenceDate:'2026-10-02'});assert.equal(r.appliedDates.length,2);
 assert.equal(xml.textOf(xml.findCell(doc,first+'26')),'25.80 / 4.76');assert.equal(xml.textOf(xml.findCell(doc,'AM29')),'29.25');
});
