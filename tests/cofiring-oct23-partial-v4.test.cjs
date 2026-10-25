// OCT23_PARTIAL_RESULT_V4: incomplete silo cannot erase verified Coal/Bio.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base=path.join(__dirname,'../maintenance');
const defs=[{key:'organicDaySilo',label:'Day Silo',tag:'GSPOGE.ABB_DCS.104SDF01CW001XQ01/PLOT'},
 {key:'organicStorageSiloA',label:'Storage Silo A',tag:'GSPOGE.ABB_DCS.003SDF01CW001XQ01/PLOT'},
 {key:'organicStorageSiloB',label:'Storage Silo B',tag:'GSPOGE.ABB_DCS.003SDF02CW001XQ01/PLOT'}];
const spec={startLocal:'2026-10-23T00:00',endLocal:'2026-10-24T00:00',stepUnit:'minute',stepValue:1};
const c={good:q=>q==='Raw, Good',period:s=>({startLocal:s.startLocal,endLocal:s.endLocal,startMs:Date.parse(s.startLocal+':00+09:00'),endMs:Date.parse(s.endLocal+':00+09:00'),durationMinutes:1440}),validateOrganicInventory:raw=>raw};
const ctx=vm.createContext({CofiringCore:{organicInventoryUsage:()=>{throw Error('should not run without inventory');}},CofiringLiveContract:c,Number,Math,Map,Set,RegExp,Object,Array,String,Date,JSON});
vm.runInContext(fs.readFileSync(path.join(base,'cofiring-inventory-correction.js'),'utf8'),ctx);
const model=ctx.CofiringInventoryCorrection;
function ref(){let data=[
 {startValue:7.813262939453125,endValue:15.709686279296875,startQuality:'Raw, Good',endQuality:'Raw, Good',startTime:'2026-10-22T23:59:19+09:00',endTime:'2026-10-23T23:59:52+09:00',min:5.61981201171875,max:20.211029052734375,delta:7.877349853515625,durationGoodSeconds:86386.375,durationBadSeconds:13.625,boundaryValid:true,dataComplete:true},
 {startValue:56.435546875,endValue:43.8623046875,startQuality:'Raw, Good',endQuality:'Raw, Good',startTime:'2026-10-22T23:59:20+09:00',endTime:'2026-10-23T23:59:43+09:00',min:-0.02197265625,max:105.56884765625,delta:-12.6953125,durationGoodSeconds:86365.336,durationBadSeconds:34.664,boundaryValid:true,dataComplete:true},
 {startValue:58.6328125,endValue:null,startQuality:'Raw, Good',endQuality:'Raw, Bad',startTime:'2026-10-22T23:56:41+09:00',endTime:'2026-10-23T23:10:18+09:00',min:19.14306640625,max:58.9990234375,delta:null,durationGoodSeconds:83280.352,durationBadSeconds:3119.648,boundaryValid:false,dataComplete:false}];
 return {...spec,kind:'cofiring_period_summary_v1',schemaVersion:1,organicInventoryReady:false,organicInventory:null,organicInventorySamples:data.map((x,i)=>({...defs[i],...x,durationCoverageValid:true})),summaries:[{unit:'unit2',fuel:'bio',usageTon:11.6953125,startQuality:'No Data, Bad',endQuality:'Raw, Good'}]};
}
test('2026-10-23 actual sample: Delta is absent, therefore no credible midnight inventory estimate',()=>{
 const x=ref(),original=JSON.stringify(x),out=model.usage(x,89.62,spec,[],{enableAutoEstimate:true});
 assert.equal(out.ok,false);assert.equal(out.code,'ORGANIC_BOUNDARY_CORRECTION_REQUIRED');
 assert.equal(out.usage,null);assert.equal(out.autoEstimates.length,0);
 assert.equal(out.missing.length,1);assert.equal(out.missing[0].silo,'organicStorageSiloB');
 assert.equal(out.missing[0].boundaryLocal,'2026-10-24T00:00');
 assert.equal(JSON.stringify(x),original,'immutable source');
 assert.equal(x.summaries[0].usageTon,11.6953125,'Bio source is not zeroed');
});
test('real UI releases only complete Coal and Bio counters while aggregate remains gated',()=>{
 const ui=fs.readFileSync(path.join(base,'cofiring-period-ui-v5.js'),'utf8');
 assert.match(ui,/organicUsageState\?\.code==='ORGANIC_BOUNDARY_CORRECTION_REQUIRED'.*?organicUsageState\?\.ok!==true/s);
 assert.match(ui,/if\(organicUsageState\?\.code==='ORGANIC_BOUNDARY_CORRECTION_REQUIRED'&&organicUsageState\?\.ok!==true\)\s*\{\s*return true;/);
 assert.match(ui,/cfvSummaryLayoutMaybeReveal\(result,adjusted\)/,'release occurs only after the summary is rendered');
 assert.match(ui,/Coal·Bio 완료 · 유기성 미확인/);
 assert.match(ui,/종합혼소율은 확정할 수 없습니다/);
 assert.match(ui,/b\.disabled=!lastResult\|\|mobile\|\|organicUsageState\?\.ok!==true/);
 assert.match(ui,/if\(adjuster&&organicUsageState\?\.ok===true\)/);
 assert.match(ui,/void adjustmentSync\?\.refresh\(\); \/\/ even partial inventory must preserve the shared sync lifecycle/);
 assert.match(ui,/suspended:disposed\|\|settingsDirty\|\|manualTouched\|\|!!usageEditSnapshot\}\)/);
 assert.doesNotMatch(ui,/suspended:disposed\|\|settingsDirty\|\|manualTouched\|\|!!usageEditSnapshot\|\|organicUsageState\?\.ok!==true/);
 assert.match(ui,/if\(organicUsageState\?\.ok!==true\|\|organicUsageState\?\.provisional===true\|\|organicUsageState\?\.provisionalZero===true\)return;/);
 assert.match(ui,/onError:e=>\{if\(organicUsageState\?\.ok!==true\|\|organicUsageState\?\.provisional===true\|\|organicUsageState\?\.provisionalZero===true\)return;/);
 assert.match(ui,/onDeferred:\(\)=>\{if\(organicUsageState\?\.ok!==true\|\|organicUsageState\?\.provisional===true\|\|organicUsageState\?\.provisionalZero===true\)return;/);
 assert.match(ui,/if\(organicUsageState\?\.ok!==true\|\|organicUsageState\?\.provisional===true\|\|organicUsageState\?\.provisionalZero===true\)return; \/\/ never apply adjusted total/);
 assert.match(ui,/values\.unit1\.organic=total\.allocation\.unit1/,'save guard remains');
});
test('operator editor is optional and hidden by default but still usable when manually requested',()=>{
 const ui=fs.readFileSync(path.join(base,'cofiring-period-ui-v5.js'),'utf8');
 const editor=fs.readFileSync(path.join(base,'cofiring-inventory-correction-ui.js'),'utf8');
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.match(ui,/<details class="cfv-inventory-optional" data-cfv-inventory-optional hidden>/);
 assert.match(ui,/data-cfv-inventory-correction aria-label="미확인 재고 상세 및 보완" hidden/);
 assert.match(editor,/if\(wrapper\)wrapper\.hidden=host\.hidden/);
 assert.match(editor,/function usage\(receipt,options\)/);
 assert.match(html,/cofiring-inventory-correction-ui\.js\?v=20261026-oct23-v4/);
 assert.match(html,/partialResult=20261026-v4-r4/);
});
test('calculation input and original persisted report are not changed by this patch',()=>{
 const ui=fs.readFileSync(path.join(base,'cofiring-period-ui-v5.js'),'utf8');
 assert.match(ui,/mv\[u\]\.organic=organicUsageState\?\.ok\?organicUsageState\.allocation\[u\]:null/);
 assert.match(ui,/if\(!total\?\.ok\)throw new Error\(total\?\.message/);
 assert.match(ui,/if\(total\.provisional\)throw new Error/);
 assert.match(ui,/renderDisplay\(shown,\{adjusted\}\)/);
 const modelSource=fs.readFileSync(path.join(base,'cofiring-inventory-correction.js'),'utf8');
 assert.match(modelSource,/!finite\(delta\)/,'no filling a missing Delta');
 assert.match(modelSource,/const auto=options.enableAutoEstimate===true\?estimateBoundary/,'only guarded approximation');
});

// Regression from the 2026-10-26 screenshot: the status and summary were
// already produced, while the centered loading pane remained indefinitely.
// Execute the production release functions, not a copied imitation.
function readUiFunction(source,name){
 const mark='    function '+name+'(';
 const begin=source.indexOf(mark);
 assert.ok(begin>=0,name+' found');
 const open=source.indexOf('{',begin);
 let depth=0;
 for(let i=open;i<source.length;i++){
   if(source[i]==='{')depth++;
   else if(source[i]==='}'&&--depth===0)return source.slice(begin,i+1);
 }
 throw Error(name+' closing brace missing');
}
test('October 23 rendered partial result releases centered spinner without confirming organic quantities',()=>{
 const source=fs.readFileSync(path.join(base,'cofiring-period-ui-v5.js'),'utf8');
 const names=['cfvSummaryLayoutPending','cfvSummaryLayoutFinalReady','cfvSummaryLayoutMaybeReveal'];
 const originals=names.map(name=>readUiFunction(source,name)).join('\n');
 function scenario({organic,result,adjusted=false,initialPending=true,mobile=false}){
   const classes=new Set(initialPending?['cfv-summary-final-layout-pending']:[]);
   const panel={hidden:!initialPending};
   const container={classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)}};
   const context={mobile,container,organicUsageState:organic,UNITS:['unit1','unit2'],
     updateSummaryLoading:()=>{panel.hidden=!classes.has('cfv-summary-final-layout-pending');},
     coalBioRatio:u=>u?.coal?.complete===true&&u?.bio?.complete===true?25:null,
     Number};
   vm.runInNewContext(originals+'\nthis.ready=cfvSummaryLayoutFinalReady;this.reveal=cfvSummaryLayoutMaybeReveal;',context);
   context.reveal(result,adjusted);
   return {visible:!classes.has('cfv-summary-final-layout-pending'),panelHidden:panel.hidden,
     actuallyReady:context.ready(result,adjusted)};
 }
 const good={coal:{complete:true,quantity:42},bio:{complete:true,quantity:11.6953125},organic:{quantity:null},manure:{quantity:0},fuelRatios:{organicGroup:null,total:null}};
 const degraded={...good,bio:{complete:false,quantity:null}};
 const unresolved={code:'ORGANIC_BOUNDARY_CORRECTION_REQUIRED',ok:false};
 const result={units:{unit1:good,unit2:degraded}};
 assert.deepEqual(scenario({organic:unresolved,result}),{visible:true,panelHidden:true,actuallyReady:true},
   'the already-rendered result must end loading even when one fuel value is unavailable');
 assert.deepEqual(scenario({organic:unresolved,result:{units:{unit1:good,unit2:good}}}),
   {visible:true,panelHidden:true,actuallyReady:true});
 assert.equal(scenario({organic:unresolved,result:null}).visible,false,
   'no result received: real loading must remain');
 assert.equal(scenario({organic:{code:'OTHER',ok:true},result}).visible,false,
   'unrelated incomplete valid-result guard must not be bypassed');
 const complete={coal:{complete:true,quantity:42},bio:{complete:true,quantity:4},
   organic:{quantity:12},manure:{quantity:0},fuelRatios:{organicGroup:3,total:5}};
 assert.equal(scenario({organic:{ok:true},result:{units:{unit1:complete,unit2:complete}}}).visible,true,
   'fully verified daily result remains normal');
 assert.equal(scenario({organic:{ok:true},result,adjusted:true}).visible,true,
   'saved-adjustment release remains possible');
 assert.equal(scenario({organic:unresolved,result,mobile:true}).visible,false,
   'existing mobile layout behavior remains unchanged');
 assert.match(source,/summaryMetric\('바이오 혼소율',coalBioRatio\(u\)/,
   'unavailable Bio remains guarded by the normal card renderer');
 assert.match(source,/if\(adjuster&&organicUsageState\?\.ok===true\)/,
   'unconfirmed inventory cannot apply stored adjustment');
 assert.match(source,/if\(organicUsageState\?\.ok!==true\)throw new Error/,
   'unconfirmed inventory still cannot be saved through adjustment context');
});
