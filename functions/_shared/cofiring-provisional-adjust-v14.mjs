// Audited WHAT-IF fuel reallocation only. Never writes measured or official-close data.
const UNITS=['unit1','unit2'], FUELS=['coal','bio','organic','manure'];
const good=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1000000;
const near=(a,b,tol=0.000001)=>typeof a==='number'&&typeof b==='number'&&Math.abs(a-b)<=tol;
const round6=x=>Math.round((x+Number.EPSILON)*1000000)/1000000;
const clone=x=>JSON.parse(JSON.stringify(x));
function err(msg){throw Object.assign(new Error(msg),{code:'PROVISIONAL_ADJUSTMENT_INVALID'})}
export function validateProvisionalAdjustment(base,settings,body){
  if(!body||typeof body!=='object'||Array.isArray(body)||
    !['max_auto','manual_transfer'].includes(body.mode)||
    Object.keys(body).some(k=>!['mode','finalBioUnit1','finalBioUnit2','fromUnit','bioTransferTons','maxBioTpd'].includes(k)))err('추정 조정 형식이 올바르지 않습니다.');
  if(!base?.units||!settings||!UNITS.every(u=>FUELS.every(f=>good(base.units[u]?.[f]?.quantity)&&typeof settings?.[u]?.[f]?.calorific==='number'&&Number.isFinite(settings[u][f].calorific)&&settings[u][f].calorific>0)))err('추정 계산의 원본 연료량 및 발열량이 확인되지 않습니다.');
  const b1=base.units.unit1.bio.quantity,b2=base.units.unit2.bio.quantity;
  const f1=body.finalBioUnit1,f2=body.finalBioUnit2;
  if(!good(f1)||!good(f2)||f1+f2>b1+b2+0.011)err('조정 Bio 합계가 원본 실제 Bio보다 큽니다.');
  if(body.mode==='manual_transfer'){
    const dir=body.fromUnit,t=body.bioTransferTons;
    if(![1,2].includes(dir)||!good(t)||t<=0||(dir===1?t>b1+1e-9:t>b2+1e-9)||
      !near(f1,dir===1?b1-t:b1+t,0.000001)||!near(f2,dir===1?b2+t:b2-t,0.000001)||
      body.maxBioTpd!==null)err('원본 Bio 사용량과 이동 방향·이동량이 일치하지 않습니다.');
  }else {
    if(body.fromUnit!==null&&body.fromUnit!==1&&body.fromUnit!==2)err('최대혼소 조정 방향을 확인해 주세요.');
    if(!good(body.bioTransferTons)||!good(body.maxBioTpd)||body.maxBioTpd<=0||body.maxBioTpd>2000)err('Bio 최대량을 확인해 주세요.');
    const hours=Number(base.period?.durationHours);
    if(!Number.isFinite(hours)||hours<=0||hours>24)err('조정 기간을 확인해 주세요.');
    const cap=body.maxBioTpd*hours/24;
    if(f1>cap+0.000001||f2>cap+0.000001||
      (b1<=cap&&b2<=cap)||body.bioTransferTons>b1+b2+0.011)err('Bio 최대혼소 허용량과 조정 결과가 맞지 않습니다.');
  }
  const projected=clone(base),duration=Number(base.period?.durationHours)||24;
  for(const [unit,finalBio] of [['unit1',f1],['unit2',f2]]){
    const raw=base.units[unit],u=projected.units[unit],s=settings[unit];
    const delta=raw.bio.quantity-finalBio;
    const coal=raw.coal.quantity+delta*s.bio.calorific/s.coal.calorific;
    if(!Number.isFinite(coal)||coal<0)err('Bio 조정 후 Coal 사용량이 음수입니다.');
    u.coal.quantity=round6(coal);u.bio.quantity=round6(finalBio);
    const heats={};
    for(const fuel of FUELS)heats[fuel]=u[fuel].quantity*s[fuel].calorific/1000;
    heats.total=FUELS.reduce((acc,f)=>acc+heats[f],0);
    if(!(heats.total>0))err('열량 합계가 0입니다.');
    u.heats=heats;
    u.fuelRatios={bio:heats.bio/heats.total*100,organic:heats.organic/heats.total*100,
      manure:heats.manure/heats.total*100,organicGroup:(heats.organic+heats.manure)/heats.total*100,
      total:(heats.bio+heats.organic+heats.manure)/heats.total*100};
    u.ratios={bio:u.fuelRatios.bio,organic:u.fuelRatios.organicGroup,total:u.fuelRatios.total};
    u.coal.averageTonPerHour=u.coal.quantity/duration;u.bio.averageTonPerHour=u.bio.quantity/duration;
  }
  const heats={};for(const f of [...FUELS,'total'])heats[f]=UNITS.reduce((sum,u)=>sum+projected.units[u].heats[f],0);
  const ratios={bio:heats.bio/heats.total*100,organic:heats.organic/heats.total*100,manure:heats.manure/heats.total*100,
    organicGroup:(heats.organic+heats.manure)/heats.total*100,
    total:(heats.bio+heats.organic+heats.manure)/heats.total*100};
  projected.combined={heats,ratios:{bio:ratios.bio,organic:ratios.organicGroup,total:ratios.total},fuelRatios:ratios};
  projected.adjustment={...body,applied:true,provisional:true};
  return projected;
}
export {near};
