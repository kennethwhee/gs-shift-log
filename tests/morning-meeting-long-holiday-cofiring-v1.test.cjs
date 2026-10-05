'use strict';
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const repo=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const read=rel=>fs.readFileSync(path.join(repo,rel),'utf8').replace(/\r\n/g,'\n');
const script=read('script.js');
const finalExcel=read('maintenance/morning-meeting-cofiring-final-excel.js');
const index=read('index.html');
function count(text,needle){return text.split(needle).length-1;}
assert.ok(count(script,'MORNING MEETING LONG HOLIDAY COFIRING V1')>=3,'long-holiday marker missing from script.js');
assert.equal(count(finalExcel,'MORNING MEETING LONG HOLIDAY COFIRING V1'),1,'final Excel marker count');
assert.ok(script.includes('holidayCount >=\n      4'),'4-day threshold missing');
assert.ok(script.includes('일반 주말/공휴일 보조표는 1~3일 범위'),'short weekend contract missing');
assert.ok(!script.includes('manualInputRanges.push('),'automatically filled holiday tables must not receive manual-yellow fill');
assert.ok(script.includes('weekdayLayoutResult\n          ?.templateRowDelta'),'collapsed long-holiday print-area delta missing');
assert.ok(script.includes('applyMorningMeetingLongHolidayCofiringExcelValues'),'long-holiday Excel hook missing');
assert.ok(finalExcel.includes('await provider.load('),'closed-history date loader missing');
assert.ok(index.includes('longHolidayCofiring=20260928-v1'),'cache bust missing');

function extractFunction(sourceText,name){
  const needle='function '+name+'('; const start=sourceText.indexOf(needle); if(start<0)throw new Error('missing '+name);
  let brace=sourceText.indexOf('{',start),depth=0,inStr=null,escape=false,line=false,block=false;
  for(let i=brace;i<sourceText.length;i++){
    const c=sourceText[i],n=sourceText[i+1];
    if(line){if(c==='\n')line=false;continue;}
    if(block){if(c==='*'&&n==='/'){block=false;i++;}continue;}
    if(inStr){if(escape){escape=false;continue;}if(c==='\\'){escape=true;continue;}if(c===inStr)inStr=null;continue;}
    if(c==='/'&&n==='/'){line=true;i++;continue;}
    if(c==='/'&&n==='*'){block=true;i++;continue;}
    if(c==='"'||c==="'"||c==='`'){inStr=c;continue;}
    if(c==='{')depth++;
    else if(c==='}'){depth--;if(depth===0)return sourceText.slice(start,i+1);}
  }
  throw new Error('unclosed '+name);
}
class E{
  constructor(name){this.tagName=name;this.attrs=new Map();this.children=[];this.parentNode=null;this.value='';this.textContent='';this.namespaceURI='urn:x';}
  get firstChild(){return this.children[0]||null;}
  appendChild(x){if(x.parentNode)x.remove();this.children.push(x);x.parentNode=this;return x;}
  insertBefore(x,before){if(x.parentNode)x.remove();const i=before?this.children.indexOf(before):-1;if(i<0)this.children.push(x);else this.children.splice(i,0,x);x.parentNode=this;return x;}
  removeChild(x){const i=this.children.indexOf(x);if(i>=0){this.children.splice(i,1);x.parentNode=null;}return x;}
  remove(){this.parentNode?.removeChild(this);}
  setAttribute(k,v){this.attrs.set(k,String(v));}
  getAttribute(k){return this.attrs.get(k)||null;}
  removeAttribute(k){this.attrs.delete(k);}
}
class Worksheet{
  constructor(){
    this.documentElement={namespaceURI:'urn:x'};
    this.sheetData=new E('sheetData');
    this.mergeCells=new E('mergeCells');
    this.dimension=new E('dimension');this.dimension.setAttribute('ref','A1:AQ100');
    this.rowBreaks=new E('rowBreaks');const br=new E('brk');br.setAttribute('id','62');this.rowBreaks.appendChild(br);
  }
  createElementNS(ns,name){const e=new E(name);e.namespaceURI=ns;return e;}
  getElementsByTagNameNS(ns,name){
    if(name==='sheetData')return[this.sheetData];if(name==='mergeCells')return[this.mergeCells];
    if(name==='dimension')return[this.dimension];if(name==='rowBreaks')return[this.rowBreaks];
    if(name==='row')return this.sheetData.children.filter(x=>x.tagName==='row');
    if(name==='c')return this.sheetData.children.flatMap(r=>r.children.filter(x=>x.tagName==='c'));
    return[];
  }
  getElementsByTagName(name){return this.getElementsByTagNameNS('urn:x',name);}
}
const colNum=name=>{let n=0;for(const ch of String(name||'').toUpperCase())n=n*26+ch.charCodeAt(0)-64;return n;};
const cellCol=addr=>String(addr||'').match(/^[A-Z]+/i)?.[0]?.toUpperCase()||'';
const direct=(p,n)=>p.children.filter(x=>x.tagName===n);
const rowNo=r=>Number(r.getAttribute('r')||0);
function shiftRow(r,d){const nr=rowNo(r)+d;r.setAttribute('r',nr);direct(r,'c').forEach(c=>c.setAttribute('r',cellCol(c.getAttribute('r'))+nr));}
function parseMerge(ref){const m=String(ref||'').match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);return m?{startColumn:m[1].toUpperCase(),startRow:+m[2],endColumn:m[3].toUpperCase(),endRow:+m[4]}:null;}
const fmtMerge=r=>`${r.startColumn}${r.startRow}:${r.endColumn}${r.endRow}`;
const addDays=(d,days)=>{const x=new Date(d.getTime());x.setUTCDate(x.getUTCDate()+days);return x;};
function parseDate(t){if(!/^\d{4}-\d{2}-\d{2}$/.test(t||''))return null;const d=new Date(t+'T00:00:00Z');return d.toISOString().slice(0,10)===t?d:null;}
const findCell=(doc,a)=>doc.getElementsByTagNameNS('urn:x','c').find(c=>c.getAttribute('r')===a)||null;
const setText=(doc,c,v)=>{c.value=String(v??'');};
function updateDim(doc,bound,d){const ref=doc.dimension.getAttribute('ref');doc.dimension.setAttribute('ref',ref.replace(/([A-Z]+)(\d+)$/i,(m,c,r)=>+r>=bound?c+(+r+d):m));}
function updateBreak(doc,bound,d){direct(doc.rowBreaks,'brk').forEach(b=>{const r=+b.getAttribute('id');if(r>=bound)b.setAttribute('id',r+d);});}
function actualDim(doc){const max=Math.max(...doc.getElementsByTagNameNS('urn:x','row').map(rowNo));doc.dimension.setAttribute('ref',doc.dimension.getAttribute('ref').replace(/([A-Z]+)(\d+)$/i,(m,c)=>c+max));}
const structureSandbox={MAIN_XML_NAMESPACE:'urn:x',getMorningMeetingDirectXmlChildren:direct,getMorningMeetingRowNumber:rowNo,shiftMorningMeetingExistingRow:shiftRow,parseMorningMeetingMergeReference:parseMerge,formatMorningMeetingMergeReference:fmtMerge,updateMorningMeetingRowsDimensionAfter:updateDim,updateMorningMeetingRowBreaksAfter:updateBreak,updateMorningMeetingWorksheetActualDimension:actualDim,parseMorningMeetingReportDate:parseDate,addMorningMeetingDateDays:addDays,findMorningMeetingWorksheetCellByAddress:findCell,getMorningMeetingColumnNumber:colNum,getMorningMeetingCellColumn:cellCol,setMorningMeetingDynamicCellText:setText,console,Date,Number,String,Math,Object,Array,Error};
vm.createContext(structureSandbox);
for(const name of ['shiftMorningMeetingWorksheetRowsForLongHoliday','collapseMorningMeetingLongHolidayLayout','applyMorningMeetingLongHolidaySupplementTables'])vm.runInContext(extractFunction(script,name),structureSandbox);
function makeWorksheet(){
  const doc=new Worksheet();
  const mkRow=n=>{const r=new E('row');r.setAttribute('r',n);doc.sheetData.appendChild(r);return r;};
  const mkCell=(row,addr,style='1',value='')=>{const c=new E('c');c.setAttribute('r',addr);c.setAttribute('s',style);c.value=value;row.appendChild(c);return c;};
  for(const n of [19,20,22])mkRow(n);
  for(const [a,st] of [['B19','10'],['C19','11'],['AD19','12'],['X20','20'],['Y20','21'],['AA20','22'],['AD20','23'],['B20','30'],['C20','31'],['E20','32'],['W20','33'],['B22','40'],['C22','41'],['E22','42'],['W22','43']]){const r=doc.sheetData.children.find(x=>rowNo(x)===+a.match(/\d+/)[0]);mkCell(r,a,st);}
  for(let n=23;n<=100;n++){let r=doc.sheetData.children.find(x=>rowNo(x)===n);if(!r)r=mkRow(n);mkCell(r,'B'+n,'30',n===24?'1. 설비 운영팀':'row'+n);if(n>=24){const m=new E('mergeCell');m.setAttribute('ref',`B${n}:AO${n}`);doc.mergeCells.appendChild(m);}}
  doc.mergeCells.setAttribute('count',String(doc.mergeCells.children.length));
  return doc;
}
let ws=makeWorksheet();
let structure=structureSandbox.applyMorningMeetingLongHolidaySupplementTables(ws,'2025-10-02','2025-10-09');
assert.equal(structure.holidayCount,7);assert.equal(structure.rowDelta,6);assert.equal(structure.longHoliday,true);
assert.equal(JSON.stringify(structure.cofiringDates),JSON.stringify(['2025-10-02','2025-10-03','2025-10-04','2025-10-05','2025-10-06','2025-10-07','2025-10-08']));
assert.equal(JSON.stringify(structure.cofiringValueCells.map(x=>x.unitOne)),JSON.stringify(['G26','K26','O26','S26','V26','Y26','AB26']));
assert.equal(structure.powerMaximumColumn,'AH');assert.equal(structure.powerMinimumColumn,'AK');assert.equal(structure.powerAverageColumn,'AN');assert.equal(structure.powerLastBodyRow,38);
assert.equal(findCell(ws,'B24').value,'Bio / 유기성 고형연료 혼소율(%)');assert.equal(findCell(ws,'B30').value,'1. 설비 운영팀');
assert.ok(ws.mergeCells.children.some(m=>m.getAttribute('ref')==='B30:AD30'));assert.ok(ws.mergeCells.children.some(m=>m.getAttribute('ref')==='AE30:AO30'));
assert.equal(findCell(ws,'AE32').value,'10/03');assert.equal(ws.rowBreaks.children[0].getAttribute('id'),'68');assert.equal(ws.dimension.getAttribute('ref'),'A1:AQ106');
assert.equal(structureSandbox.collapseMorningMeetingLongHolidayLayout(ws,24,6),true);assert.equal(findCell(ws,'B24').value,'1. 설비 운영팀');assert.equal(ws.rowBreaks.children[0].getAttribute('id'),'62');assert.equal(ws.dimension.getAttribute('ref'),'A1:AQ100');
ws=makeWorksheet();structure=structureSandbox.applyMorningMeetingLongHolidaySupplementTables(ws,'2025-10-02','2025-10-06');
assert.equal(structure.holidayCount,4);assert.equal(JSON.stringify(structure.cofiringValueCells.map(x=>x.unitOne)),JSON.stringify(['G26','M26','S26','Y26']));assert.equal(structure.powerLastBodyRow,35);

class ValueDoc{
  constructor(addresses){this.documentElement={namespaceURI:'urn:x'};this.cells=addresses.map(a=>{const e=new E('c');e.setAttribute('r',a);return e;});}
  getElementsByTagNameNS(ns,name){return name==='c'?this.cells:[];}
  getElementsByTagName(name){return name==='c'?this.cells:[];}
  createElementNS(ns,name){const e=new E(name);e.namespaceURI=ns;return e;}
}
const loads=[];
const saved={
 '2025-10-02':{unitOne:{bioRatio:25.75,organicRatio:1.13,totalRatio:26.88},unitTwo:{bioRatio:25.38,organicRatio:1.08,totalRatio:26.46}},
 '2025-10-03':{unitOne:{bioRatio:25.82,organicRatio:0.94,totalRatio:26.76},unitTwo:{bioRatio:25.64,organicRatio:0.94,totalRatio:26.58}},
 '2025-10-04':null,
 '2025-10-05':{unitOne:{bioRatio:24.85,organicRatio:0.95,totalRatio:25.80},unitTwo:{bioRatio:24.32,organicRatio:0.93,totalRatio:25.25}}
};
const fakeWindow={document:{getElementById(){return null;}},applyMorningMeetingDailyDataValues(){return {};},morningMeetingClosedCofiring:{async load(date){loads.push(date);return saved[date]??null;}},setInterval(){throw new Error('unexpected interval');},clearInterval(){}};
const valueSandbox={window:fakeWindow,document:fakeWindow.document,console,setTimeout,clearTimeout,Promise,Number,String,Math,Array,Object,Error};
vm.createContext(valueSandbox);vm.runInContext(finalExcel,valueSandbox);
const maps=[{date:'2025-10-02',unitOne:'G26',unitTwo:'G27',average:'G28',total:'G29'},{date:'2025-10-03',unitOne:'K26',unitTwo:'K27',average:'K28',total:'K29'},{date:'2025-10-04',unitOne:'O26',unitTwo:'O27',average:'O28',total:'O29'},{date:'2025-10-05',unitOne:'S26',unitTwo:'S27',average:'S28',total:'S29'}];
const valueDoc=new ValueDoc(maps.flatMap(x=>[x.unitOne,x.unitTwo,x.average,x.total]));
const valueAt=addr=>{const c=valueDoc.cells.find(x=>x.getAttribute('r')===addr);return c.children.find(x=>x.tagName==='is')?.children?.[0]?.textContent||'';};
(async()=>{
 const result=await fakeWindow.applyMorningMeetingLongHolidayCofiringExcelValues(valueDoc,{longHoliday:true,cofiringValueCells:maps});
 assert.equal(JSON.stringify(loads),JSON.stringify(maps.map(x=>x.date)));assert.equal(valueAt('G26'),'25.75 / 1.13');assert.equal(valueAt('G29'),'26.67');assert.equal(valueAt('O26'),'');assert.equal(result.appliedCount,3);assert.equal(JSON.stringify(result.missingDates),JSON.stringify(['2025-10-04']));
 console.log('PASS: long-holiday 4+ layout, collapse, print-area metadata and closed co-firing value writer.');
})().catch(error=>{console.error(error);process.exit(1);});
