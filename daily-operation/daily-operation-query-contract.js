(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DailyOperationQueryContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TYPE = 'daily_operation_data';
  // Source: 26.10-일일DATA관리.xlsx / Data Normalize metadata. No client-supplied TAGs.
  const definitions = Object.freeze([
    ['water_demi_avg','순수 생산량','t/h','AO','000GHC30CF201XQ01/PLOT','TimeAvg'],
    ['water_condensate_avg','복수량','t/h','AP','000LCA30CF901XQ01/PLOT','TimeAvg'],
    ['water_feed_u1_avg','1호기 급수량','t/h','AQ','106LAB60CF901XQ01-CAL/PLOT','TimeAvg'],
    ['water_feed_u2_avg','2호기 급수량','t/h','AR','206LAB60CF901XQ01-CAL/PLOT','TimeAvg'],
    ['water_cbd_u1_avg','1호기 CBD량','t/h','AS','104LCQ01CF201XQ01','TimeAvg'],
    ['water_cbd_u2_avg','2호기 CBD량','t/h','AT','204LCQ01CF201XQ01','TimeAvg'],
    ['coal_a_storage_level','Coal Storage A Level','m','AF','003EBF01CL201XQ01_F/PLOT','End'],
    ['coal_b_storage_level','Coal Storage B Level','m','AG','003EBF02CL201XQ01_F/PLOT','End'],
    ['bio_storage_level','BIO Storage Level','m','AL','003EBF20CL201XQ01_F/PLOT','End'],
    ['coal_day_u1_a_end','1호기 Coal Day Silo A','Ton','AH','104HHE10CW201XQ01/PLOT','End'],
    ['coal_day_u1_b_end','1호기 Coal Day Silo B','Ton','AI','104HHE20CW201XQ01/PLOT','End'],
    ['coal_day_u2_a_end','2호기 Coal Day Silo A','Ton','AJ','204HHE10CW201XQ01/PLOT','End'],
    ['coal_day_u2_b_end','2호기 Coal Day Silo B','Ton','AK','204HHE20CW201XQ01/PLOT','End'],
    ['power_max_daily','최대전력','MW','AY','CJD01FE006XJ41/PLOT','Max']
  ].map(([key,label,unit,column,tag,statistic]) => Object.freeze({key,label,unit,column,tag:'GSPOGE.ABB_DCS.'+tag,statistic})));
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const good = value => typeof value === 'string' && /^(?:good|raw\s*,\s*good|good\s*,\s*raw)$/i.test(value.trim());
  function interval(targetDate) {
    if (typeof targetDate !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(targetDate)) throw new Error('일일운전 조회일 형식이 올바르지 않습니다.');
    const day = new Date(targetDate+'T00:00:00Z');
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0,10) !== targetDate || targetDate < '2021-01-01') throw new Error('일일운전 조회일을 확인해 주세요.');
    const next = new Date(day.getTime()+86400000).toISOString().slice(0,10);
    return {startLocal:targetDate+'T00:00:00+09:00',endLocal:next+'T00:00:00+09:00'};
  }
  function completedDay(targetDate, now = Date.now()) {
    interval(targetDate);
    if (targetDate >= new Date(now+9*3600000).toISOString().slice(0,10)) throw new Error('일일운전 운영정보는 하루가 완료된 전일까지 조회할 수 있습니다.');
    return targetDate;
  }
  function normalize(raw, targetDate) {
    const fail = message => { throw new Error('일일운전 운영정보 결과: '+message); };
    const range = interval(targetDate);
    if (!object(raw) || raw.requestType !== TYPE || raw.schemaVersion !== 1 || raw.targetDate !== targetDate || raw.source !== 'dataparc_hidden_excel' || raw.step !== '1D' || raw.startLocal !== range.startLocal || raw.endLocal !== range.endLocal || raw.cleanupVerified !== true) fail('조회일·구간·출처 또는 정리 확인이 일치하지 않습니다.');
    if (!Array.isArray(raw.samples) || raw.samples.length !== definitions.length) fail('고정 TAG 표본이 누락되거나 중복되었습니다.');
    const values = {}, warnings = [], samples = [];
    const start = Date.parse(range.startLocal), end = Date.parse(range.endLocal);
    for (const definition of definitions) {
      const matches = raw.samples.filter(sample => object(sample) && sample.key === definition.key);
      if (matches.length !== 1) fail(definition.label+' 표본 누락/중복');
      const sample = matches[0];
      if (sample.tag !== definition.tag || sample.statistic !== definition.statistic || sample.unit !== definition.unit || sample.date !== targetDate || sample.periodStartKst !== range.startLocal.replace('T',' ') || sample.periodEndKst !== range.endLocal.replace('T',' ')) fail(definition.label+' TAG·단위·집계·기간 불일치');
      const time = sample.returnedTimeText;
      const stamp = typeof time === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time) ? Date.parse(time.replace(' ','T')+'+09:00') : NaN;
      const timeValid = Number.isFinite(stamp) && stamp >= start && stamp <= end && new Date(stamp+9*3600000).toISOString().slice(0,19).replace('T',' ') === time;
      const valid = number(sample.value) && good(sample.qualityText) && timeValid;
      const value = valid ? sample.value : null;
      values[definition.key] = value;
      if (!valid) warnings.push({field:definition.key,message:definition.label+' 값·품질·반환 시각을 확인하지 못했습니다.'});
      samples.push({...definition,date:targetDate,value,qualityText:typeof sample.qualityText==='string'?sample.qualityText.slice(0,100):'',returnedTimeText:typeof time==='string'?time.slice(0,40):'',periodStartKst:range.startLocal.replace('T',' '),periodEndKst:range.endLocal.replace('T',' '),valid});
    }
    if (object(raw.values) && Object.keys(values).some(key => raw.values[key] !== values[key])) fail('전달된 값과 검증된 표본이 일치하지 않습니다.');
    return {requestType:TYPE,schemaVersion:1,targetDate,source:'dataparc_hidden_excel',step:'1D',...range,cleanupVerified:true,values,samples,warnings};
  }
  return Object.freeze({TYPE,definitions,interval,completedDay,normalize,good});
}));
