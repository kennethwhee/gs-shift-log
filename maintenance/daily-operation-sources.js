/* Selected-day source adapter for Daily Operation. No Morning Meeting DOM/state
 * mutation, automatic Agent requests, source rewrites or inferred missing zeros. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GSDailyOperationSources = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const OIS = '/api/ois-data-requests';
  const text = value => String(value == null ? '' : value).trim();
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : null;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const dateValid = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
  const addDay = date => new Date(Date.parse(date + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const todayKst = () => new Date(Date.now() + 32400000).toISOString().slice(0, 10);
  const monthDates = date => Array.from({length: Number(date.slice(8, 10))}, (_, i) => date.slice(0, 8) + String(i + 1).padStart(2, '0'));
  // Source servers normally write ISO timestamps with Z. A timezone-less legacy
  // timestamp is ambiguous across browsers, so omit it from provenance.
  const isoTimestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const url = (path, params) => path + '?' + new URLSearchParams(params).toString();
  const STEAM = {steam_u1_daily: 'unitOneProduction', steam_u2_daily: 'unitTwoProduction', process_lp_daily: 'steamSalesLowPressure', process_hp_daily: 'steamSalesHighPressure'};
  const POWER = {power_generation_daily: 'generatorEcmsGen1', power_export_daily: 'epowerTransmission', power_import_daily: 'ismartReception', power_solar_daily: 'solarDailyGeneration'};
  const POWER_FACTORS = {power_generation_daily: 0.001, power_export_daily: 0.001, power_import_daily: 0.001, power_solar_daily: 1};
  const FUELS = {coal: 'coal', bio: 'bio', sludge: 'organic'};
  const ENGINE_FIELDS = ['water_demi_avg', 'water_condensate_avg', 'water_feed_u1_avg', 'water_feed_u2_avg', 'water_cbd_u1_avg', 'water_cbd_u2_avg', 'power_max_daily', 'bio_storage_level', 'coal_a_storage_level', 'coal_b_storage_level', 'coal_day_u1_a_end', 'coal_day_u1_b_end', 'coal_day_u2_a_end', 'coal_day_u2_b_end'];
  const MTD = {
    ng_main_mtd: ['ng_main_daily'], ng_aux_mtd: ['ng_aux1_daily', 'ng_aux2_daily'], ng_total_mtd: ['ng_total_daily'],
    coal_u1_mtd: ['coal_u1_daily'], coal_u2_mtd: ['coal_u2_daily'], bio_u1_mtd: ['bio_u1_daily'], bio_u2_mtd: ['bio_u2_daily'], sludge_u1_mtd: ['sludge_u1_daily'], sludge_u2_mtd: ['sludge_u2_daily'],
    power_generation_mtd: ['power_generation_daily'], power_export_mtd: ['power_export_daily'], power_import_mtd: ['power_import_daily'], power_internal_mtd: ['power_internal_daily'], power_hours_mtd: ['power_hours_daily'], power_uat_mtd: ['power_uat_daily'], power_solar_mtd: ['power_solar_daily'],
    process_lp_mtd: ['process_lp_daily'], process_hp_mtd: ['process_hp_daily'], process_lp_max: ['process_lp_daily'], process_hp_max: ['process_hp_daily'], process_lp_avg: ['process_lp_daily'], process_hp_avg: ['process_hp_daily']
  };
  const sum = values => values.every(value => numeric(value) !== null) ? values.reduce((total, value) => total + value, 0) : null;
  function bioSiloTonnes(height) {
    if (numeric(height) === null) return null;
    return (64 * Math.PI * height - Math.min(2, height) * (2.752 ** 2) / 4 * Math.PI) * 0.2;
  }
  function coalSiloTonnes(height) {
    if (numeric(height) === null) return null;
    let volume;
    if (height <= 8.8) volume = (9 * height / 8.8) ** 2 * Math.PI / 4 * (2 / 3) * height;
    else if (height <= 14.835) volume = 81 * Math.PI / 4 * (2 / 3) * 8.8 + (12.5 * (15.59 - 8.8 + height) / 21.65) ** 2 * Math.PI * (15.59 - 8.8 + height) / 3 - 81 * Math.PI * 15.59 / 3;
    else volume = 81 * Math.PI / 4 * (2 / 3) * 8.8 + (12.5 ** 2) * Math.PI * 21.65 / 3 - 81 * Math.PI * 15.59 / 3 + (12.5 ** 2) * Math.PI * (height - 14.835);
    return volume * 0.8;
  }
  function recalculate(values) {
    const result = {...values};
    for (const [target, source, fn] of [['bio_storage_tonnes', 'bio_storage_level', bioSiloTonnes], ['coal_a_storage_tonnes', 'coal_a_storage_level', coalSiloTonnes], ['coal_b_storage_tonnes', 'coal_b_storage_level', coalSiloTonnes]]) {
      result[target] = fn(numeric(values?.[source]));
    }
    return result;
  }
  function aborted(signal) {
    if (!signal?.aborted) return;
    const error = new Error('조회가 취소되었습니다.'); error.name = 'AbortError'; throw error;
  }
  async function delay(ms, signal) {
    aborted(signal);
    await new Promise((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', cancel); resolve(); };
      const timer = setTimeout(done, ms);
      const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); const error = new Error('조회가 취소되었습니다.'); error.name = 'AbortError'; reject(error); };
      signal?.addEventListener('abort', cancel, {once: true});
    });
  }
  async function bounded(tasks, concurrency = 4) {
    let index = 0;
    await Promise.all(Array.from({length: Math.min(concurrency, tasks.length)}, async () => {
      while (index < tasks.length) await tasks[index++]();
    }));
  }
  function sameItem(item, date, type) {
    if (!object(item) || item.targetDate !== date || item.status !== 'complete' || !object(item.result)) return false;
    if (type && (item.sourceRequestType || item.requestType) !== type) return false;
    const raw = item.result;
    return (!raw.targetDate || raw.targetDate === date) && (!raw.sourceDate || raw.sourceDate === date);
  }

  async function collect(date, options = {}) {
    if (!dateValid(date)) throw new Error('실적 기준일을 확인해 주세요.');
    if (typeof options.request !== 'function') throw new Error('인증된 자료 조회 연결이 필요합니다.');
    const signal = options.signal, warnings = [], records = new Map(), missing = new Set(options.missingFields || []), seenSavedTypes = new Set();
    const scopedFields = Array.isArray(options.missingFields);
    const invalidatedMonthly = new Set((Array.isArray(options.invalidatedMonthly) ? options.invalidatedMonthly : []).filter(key => Object.hasOwn(MTD, key)));
    const preservedBlanks = new Map([[date, new Set(Array.isArray(options.preservedBlankFields) ? options.preservedBlankFields : [])]]);
    const invalidateDependentMonthly = dailyKey => {
      for (const [monthlyKey, dependencies] of Object.entries(MTD)) if (dependencies.includes(dailyKey)) invalidatedMonthly.add(monthlyKey);
    };
    for (const key of preservedBlanks.get(date)) invalidateDependentMonthly(key);
    const existing = object(options.existingValues) ? options.existingValues : {};
    const wants = key => (!scopedFields || missing.has(key)) && !preservedBlanks.get(date)?.has(key) && numeric(existing[key]) === null;
    const warn = message => { if (!warnings.includes(message)) warnings.push(message); };
    const progress = message => { aborted(signal); if (typeof options.onProgress === 'function') options.onProgress(message); };
    function record(day) {
      if (!records.has(day)) records.set(day, {values: {}, sources: {}, ranks: {}});
      return records.get(day);
    }
    function put(day, key, value, source, label, rank = 20, meta = {}) {
      value = numeric(value);
      if (value === null || !dateValid(day) || day.slice(0, 7) !== date.slice(0, 7) || day > date) return;
      if (preservedBlanks.get(day)?.has(key)) return;
      // After a daily manual edit, a source-owned cumulative still describes
      // the old daily value. Only the current explicit input or a complete
      // daily-record recomputation may fill the invalidated monthly field.
      if (day === date && invalidatedMonthly.has(key) && !['current_report', 'month_daily_records'].includes(source)) return;
      const target = record(day);
      if (target.ranks[key] > rank) return;
      target.values[key] = value; target.ranks[key] = rank;
      target.sources[key] = {source, label, date, sourceDate: day, requestId: text(meta.requestId), note: text(meta.note),
        ...(isoTimestamp(meta.updatedAt) ? {updatedAt: isoTimestamp(meta.updatedAt)} : {})};
    }
    function map(day, data, mapping, source, label, rank, meta = {}, factors = {}) {
      for (const [key, field] of Object.entries(mapping)) {
        const value = numeric(data?.[field]);
        if (value !== null) put(day, key, value * (factors[key] || 1), source, label, rank, meta);
      }
    }
    function deriveDaily(day) {
      const r = record(day), v = r.values;
      if (numeric(v.power_generation_daily) !== null && numeric(v.power_export_daily) !== null) {
        put(day, 'power_internal_daily', v.power_generation_daily - v.power_export_daily, 'calculated', '생산량 − 송전량', 15);
      }
      put(day, 'ng_total_daily', sum(['ng_main_daily', 'ng_aux1_daily', 'ng_aux2_daily'].map(key => v[key])), 'calculated', '주·보조보일러 NG 합계', 15);
    }
    async function get(path, label, params = {}) {
      aborted(signal);
      try {
        const data = await options.request(path, {method: 'GET', cache: 'no-store', signal, ...params});
        aborted(signal);
        if (!object(data) || data.ok === false) throw new Error(data?.message || '서버 응답을 확인하지 못했습니다.');
        return data;
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        warn(label + ' 조회 실패: ' + text(error?.message || error));
        return null;
      }
    }
    function acceptHistory(payload) {
      if (!payload) return;
      const resetDates = new Set((payload.resets || []).filter(item => item?.active === true).map(item => item.targetDate));
      for (const item of payload.items || []) {
        const day = item?.targetDate;
        if (!dateValid(day) || resetDates.has(day) || !sameItem(item, day)) continue;
        const type = item.sourceRequestType || item.requestType;
        if (!['steam_status', 'daily_data_excel'].includes(type)) continue;
        if (day === date) seenSavedTypes.add(type);
        const meta = {requestId: item.id, updatedAt: item.completedAt || item.updatedAt};
        map(day, item.result, STEAM, type, type === 'steam_status' ? '저장된 OIS 증기 자료' : '기존 일일 DATA 저장값', type === 'steam_status' ? 30 : 10, meta);
        // Power ownership is TO. An old daily_data_excel row cannot restore it.
      }
      for (const item of payload.overrides || []) {
        const day = item?.targetDate || item?.recordDate;
        if (!dateValid(day) || resetDates.has(day) || item.resetActive === true) continue;
        const meta = {updatedAt: item.updatedAt};
        map(day, item.values, {smp_max: 'smpMaximum', smp_min: 'smpMinimum', smp_avg: 'smpWeightedAverage', limestone_u1_daily: 'limestoneUnitOneUsage', limestone_u2_daily: 'limestoneUnitTwoUsage'}, 'morning_auto_history', '오전회의 저장 수치', 40, meta);
      }
    }
    function acceptPower(payload, day) {
      const item = payload?.item;
      if (!item) return;
      if (payload.targetDate !== day || item.targetDate !== day || item.unit !== 'kWh') { warn(day + ' TO 전력 날짜 또는 단위가 달라 제외했습니다.'); return; }
      map(day, item.values, POWER, 'to_night_power', 'TO 전력 입력', 40, {updatedAt: item.updatedAt}, POWER_FACTORS);
      if (day === date) put(day, 'power_solar_mtd', payload.solarCumulative?.monthly, 'to_night_power', 'TO 태양광 당월 누계', 40, {updatedAt: item.updatedAt});
    }
    function acceptCards(payload, day) {
      if (!payload) return;
      if (payload.targetDate !== day) { warn(day + ' 오전회의 카드 수정값 날짜가 달라 제외했습니다.'); return; }
      if (payload.resetActive === true) return;
      for (const [cardKey, mapping, factors] of [['steam', STEAM, {}], ['power', POWER, POWER_FACTORS]]) {
        const card = payload.items?.[cardKey];
        if (card?.active !== true || card.staleByDelete === true) continue;
        const meta = {updatedAt: card.updatedAt};
        map(day, card.values, mapping, 'morning_card_override', '오전회의 카드 수정 저장값', 50, meta, factors);
        if (day === date && cardKey === 'power') put(day, 'power_solar_mtd', card.values?.solarMonthlyCumulative, 'morning_card_override', '오전회의 태양광 당월 누계', 50, meta);
      }
    }
    function acceptClosed(payload, day) {
      const item = payload?.item;
      if (!item) return;
      const snapshot = item.snapshot, period = snapshot?.period;
      if (item.targetDate !== day || snapshot?.targetDate !== day || snapshot.schemaVersion !== 1 ||
          !item.sourceRequestId || snapshot.sourceRequestId !== item.sourceRequestId ||
          period?.startLocal !== day + 'T00:00' || ![addDay(day) + 'T00:00', addDay(day) + 'T00:01'].includes(period?.endLocal)) {
        warn(day + ' 혼소율 마감자료의 날짜·기간이 달라 제외했습니다.'); return;
      }
      const cleared = item.adjustmentApplied === false && snapshot.result?.adjustment?.applied === true;
      const result = Object.hasOwn(item, 'effectiveResult') ? item.effectiveResult : cleared ? snapshot.originalResult : snapshot.result;
      if (!object(result) || !object(result.units) ||
          (result.period?.startLocal && result.period.startLocal !== period.startLocal) ||
          (result.period?.endLocal && result.period.endLocal !== period.endLocal) ||
          (item.adjustmentApplied === false && result.adjustment?.applied === true)) {
        warn(day + ' 최종 혼소율 조정·원복 결과를 확인하지 못했습니다.'); return;
      }
      const meta = {requestId: item.sourceRequestId, updatedAt: item.updatedAt, note: item.adjustmentApplied ? '최종 조정값 반영' : '마감 원본 또는 원복값'};
      for (const unit of [1, 2]) {
        for (const [fuel, key] of Object.entries(FUELS)) put(day, fuel + '_u' + unit + '_daily', result.units['unit' + unit]?.[key]?.quantity, 'cofiring_closed', '혼소율 마감 저장값', 50, meta);
        if (day !== date) continue;
        const coal = result.units['unit' + unit]?.coal, counters = coal?.counters;
        if (!Array.isArray(counters)) continue;
        const splits = [];
        for (const silo of ['A', 'B']) {
          const parts = [1, 2].map(n => counters.find(counter => counter.id === 'unit' + unit + 'Coal' + silo + n));
          const value = parts.every(part => part?.complete === true) ? sum(parts.map(part => part.quantity)) : null;
          splits.push(value);
          put(day, 'coal_u' + unit + '_' + silo.toLowerCase() + '_daily', value, 'cofiring_counter', '마감자료 Coal Feeder 원본 적산', 40,
            {...meta, note: '원본 Feeder ' + silo + '1 + ' + silo + '2. 호기별 조정량을 임의 배분하지 않음.'});
        }
        const rawTotal = sum(splits);
        if (rawTotal !== null && numeric(coal?.quantity) !== null && Math.abs(rawTotal - coal.quantity) > 0.001) warn(unit + '호기 Coal A/B는 원본 Feeder 적산이며, 위쪽 호기 사용량은 보정·조정값이므로 합계가 다를 수 있습니다.');
      }
    }
    function acceptEngine(payload) {
      const item = payload?.item;
      if (!item) return false;
      if (!sameItem(item, date, 'daily_operation_data')) { warn('운영정보 조회 결과의 날짜가 달라 제외했습니다.'); return false; }
      const raw = item.result;
      if (raw.schemaVersion !== 1 || raw.startLocal !== date + 'T00:00:00+09:00' || raw.endLocal !== addDay(date) + 'T00:00:00+09:00' || raw.cleanupVerified !== true) {
        warn('운영정보 조회 기간이 선택일 00:00~다음 날 00:00과 달라 제외했습니다.'); return false;
      }
      seenSavedTypes.add('daily_operation_data');
      for (const key of ENGINE_FIELDS) put(date, key, raw.values?.[key], 'daily_operation_data', '운영정보 일별 조회', 30,
        {requestId: item.id, updatedAt: raw.queriedAt || item.completedAt, note: '선택일 전체: 일평균 유량 / 최대전력 / 종료 재고'});
      for (const message of raw.warnings || []) {
        if (typeof message === 'string') warn(message);
        else if (typeof message?.message === 'string') warn(message.message);
      }
      return true;
    }
    function acceptMaterials(payload) {
      for (const item of payload?.items || []) {
        if (item?.recordDate !== date || ![1, 2].includes(item.unitNo)) continue;
        const meta = {requestId: item.oisRequestId, updatedAt: item.updatedAt || item.oisCollectedAt};
        put(date, 'limestone_u' + item.unitNo + '_daily', item.limestoneUsageTpd, 'materials_history', '저장된 부재료 사용량', 25, meta);
        put(date, 'lime_u' + item.unitNo + '_daily', item.limePowderTpd, 'materials_history', '저장된 Lime Powder 사용량', 30, meta);
        // ammoniaM3d is intentionally excluded: original tag is kg/hr.
      }
    }
    function acceptLimestone(payload) {
      if (!payload || payload.targetDate !== date) return;
      for (const item of payload.items || []) {
        if (item?.usageDate !== date || ![1, 2].includes(item.unitNo)) continue;
        const meta = {updatedAt: item.updatedAt};
        put(date, 'limestone_u' + item.unitNo + '_daily', item.usageQuantity, 'limestone_usage', '석회석 사용량 저장값', 30, meta);
        put(date, 'limestone_u' + item.unitNo + '_receipt', item.receiptQuantity, 'limestone_usage', '석회석 사용량 계산의 입고량', 25, meta);
      }
    }
    function acceptReceipts(payload, material) {
      if (!payload) return;
      if (material === 'limestone' && (payload.range?.startDate !== date || payload.range?.endDate !== date)) return;
      if (material === 'lime' && payload.month !== date.slice(0, 7)) return;
      const rows = (payload.items || []).filter(item => item.receiptDate === date);
      const units = material === 'limestone' ? [1, 2] : [0];
      for (const unit of units) {
        const filtered = rows.filter(item => unit === 0 || item.unitNo === unit);
        const values = filtered.map(item => numeric(item.quantityTon));
        if (values.some(value => value === null)) { warn('입고기록의 수량 형식을 확인해 주세요.'); continue; }
        // A successful exact-date ledger query has a defined zero-receipt total.
        put(date, material === 'limestone' ? 'limestone_u' + unit + '_receipt' : 'lime_receipt', values.reduce((a, b) => a + b, 0), material + '_receipts', '선택일 ' + (material === 'lime' ? 'Lime Powder' : '석회석') + ' 입고기록 합계', 30);
      }
    }
    function acceptBedAsh(payload) {
      const data = payload?.data;
      if (data?.range?.startDate !== date || data?.range?.endDate !== date || !Array.isArray(data.events)) return;
      for (const unit of [1, 2]) {
        const rows = data.events.filter(event => event.unitNo === unit && event.status === 'confirmed');
        const values = rows.map(row => numeric(row.confirmedTon));
        const coverage = data.unitCoverage?.[unit];
        const validCoverage = coverage?.hasMinuteSource === true && coverage.validMinuteSampleCount >= 1440 && coverage.hasGaps === false;
        if (values.some(value => value === null)) continue;
        // No confirmed rows is unknown without a complete observation day.
        if (rows.length || validCoverage) put(date, 'bedash_u' + unit + '_discharge', values.reduce((a, b) => a + b, 0), 'bedash_confirmed', 'Bed Ash 확정 반출기록 합계', 30, {note: '확정시각 기준. 미확정 감지량 제외.'});
      }
      if (data.summary?.pendingCount > 0) warn('Bed Ash 미확정 반출기록이 있어 확정된 반출량만 반영했습니다.');
    }

    const monthlyWanted = Object.keys(MTD).filter(wants), dates = monthlyWanted.length ? monthDates(date) : [date];
    for (const [key, value] of Object.entries(existing)) put(date, key, value, 'current_report', '현재 입력값', 100);
    progress('선택일 저장자료를 확인하고 있습니다.');
    const [history, savedReports] = await Promise.all([
      get(url(OIS, {action: 'completed_history', startDate: dates[0], endDate: date}), '오전회의 저장자료'),
      monthlyWanted.length ? get(url('/api/daily-operation-reports', {month: date.slice(0, 7), includeValues: '1'}), '당월 일일운전현황') : Promise.resolve(null)
    ]);
    for (const item of savedReports?.items || []) {
      if (!dateValid(item.workDate) || item.workDate >= date) continue;
      const blankFields = Object.keys(item.sources || {}).filter(key => item.sources[key]?.source === 'manual' &&
        (item.values?.[key] === null || item.values?.[key] === undefined || item.values?.[key] === ''));
      if (blankFields.length) preservedBlanks.set(item.workDate, new Set(blankFields));
      for (const key of Object.keys(item.sources || {})) if (item.sources[key]?.source === 'manual') invalidateDependentMonthly(key);
      for (const [key, value] of Object.entries(item.values || {})) put(item.workDate, key, value, 'daily_operation_report', '저장된 일일운전현황', 60, {updatedAt: item.updatedAt || item.modifiedAt});
    }
    acceptHistory(history);
    const requiredDaily = new Set(monthlyWanted.flatMap(key => MTD[key]));
    if (requiredDaily.has('power_internal_daily')) { requiredDaily.add('power_generation_daily'); requiredDaily.add('power_export_daily'); }
    const needOnDay = (day, keys) => keys.some(key => !preservedBlanks.get(day)?.has(key) && numeric(record(day).values[key]) === null && (day === date ? wants(key) || requiredDaily.has(key) : requiredDaily.has(key)));
    const dailyTasks = [];
    for (const day of dates) {
      const r = record(day), powerKeys = Object.keys(POWER), steamKeys = Object.keys(STEAM);
      // Always fetch contemporary source ownership for unsaved daily records,
      // even when a legacy workbook fallback happened to contain the value.
      const sourceNeeded = keys => keys.some(key => !preservedBlanks.get(day)?.has(key) && (day === date ? wants(key) || requiredDaily.has(key) : requiredDaily.has(key)) && (r.ranks[key] || 0) < 40);
      if (sourceNeeded(powerKeys)) dailyTasks.push(async () => acceptPower(await get(url('/api/to-night-power', {date: day}), day + ' TO 전력'), day));
      if (sourceNeeded([...powerKeys, ...steamKeys])) dailyTasks.push(async () => acceptCards(await get(url('/api/morning-meeting-card-overrides', {date: day}), day + ' 오전회의 수정값'), day));
      const fuelKeys = Object.keys(FUELS).flatMap(fuel => [1, 2].map(unit => fuel + '_u' + unit + '_daily'));
      if (sourceNeeded(fuelKeys) || day === date && ['coal_u1_a_daily', 'coal_u1_b_daily', 'coal_u2_a_daily', 'coal_u2_b_daily'].some(wants)) {
        dailyTasks.push(async () => acceptClosed(await get(url('/api/cofiring-closed-history', {targetDate: day}), day + ' 혼소율 마감자료'), day));
      }
    }
    const currentTasks = [];
    if (['limestone_u1_daily', 'limestone_u2_daily', 'limestone_u1_receipt', 'limestone_u2_receipt'].some(wants)) currentTasks.push(() => get(url(OIS, {action: 'usage_records', targetDate: date}), '석회석 사용량').then(acceptLimestone));
    if (['limestone_u1_daily', 'limestone_u2_daily', 'lime_u1_daily', 'lime_u2_daily'].some(wants)) currentTasks.push(() => get(url(OIS, {action: 'materials_history', startDate: date, endDate: date}), '부재료 저장자료').then(acceptMaterials));
    if (['limestone_u1_receipt', 'limestone_u2_receipt'].some(wants)) currentTasks.push(() => get(url('/api/limestone-receipts', {startDate: date, endDate: date}), '석회석 입고기록').then(data => acceptReceipts(data, 'limestone')));
    if (wants('lime_receipt')) currentTasks.push(() => get(url('/api/hydrated-lime-receipts', {month: date.slice(0, 7)}), 'Lime Powder 입고기록').then(data => acceptReceipts(data, 'lime')));
    if (['bedash_u1_discharge', 'bedash_u2_discharge'].some(wants)) currentTasks.push(() => get(url('/api/bed-ash-discharge', {startDate: date, endDate: date}), 'Bed Ash 확정 반출').then(acceptBedAsh));
    if ([...ENGINE_FIELDS, 'bio_storage_tonnes', 'coal_a_storage_tonnes', 'coal_b_storage_tonnes'].some(wants)) currentTasks.push(() => get(url(OIS, {action: 'daily_operation_data', targetDate: date}), '운영정보 저장자료').then(acceptEngine));
    await bounded([...currentTasks, ...dailyTasks]);
    aborted(signal);
    // SMP is an independent public selected-day lookup and needs no Agent.
    if (['smp_max', 'smp_min', 'smp_avg'].some(key => wants(key) && numeric(record(date).values[key]) === null)) {
      const smp = await get(url('/api/smp-price', {date}), '선택일 SMP');
      if (smp && smp.date === date) map(date, smp, {smp_max: 'max', smp_min: 'min', smp_avg: 'avg'}, 'smp_price', '선택일 SMP', 20);
    }

    async function query(type, label, accept) {
      progress(label + ' 조회 중입니다.');
      try {
        aborted(signal);
        const created = await options.request(OIS, {method: 'POST', cache: 'no-store', signal,
          headers: {'Content-Type': 'application/json'}, body: JSON.stringify({requestType: type, targetDate: date, forceRefresh: seenSavedTypes.has(type)})});
        if (!object(created) || created.ok === false) throw new Error(created?.message || '조회 요청을 만들지 못했습니다.');
        let item = created.item;
        const id = text(item?.id);
        if (!id || item.targetDate !== date || item.requestType !== type) throw new Error('조회 요청 ID·날짜·자료 종류를 확인하지 못했습니다.');
        const deadline = Date.now() + (options.maximumWaitMs || 300000);
        while (item.status !== 'complete') {
          aborted(signal);
          if (['failed', 'expired', 'cancelled'].includes(item.status)) throw new Error(item.errorMessage || '조회가 완료되지 않았습니다.');
          if (Date.now() >= deadline) throw new Error('조회 대기시간을 초과했습니다. 요청은 회사 PC 대기열에 남을 수 있습니다.');
          await delay(options.pollIntervalMs === undefined ? 1500 : options.pollIntervalMs, signal);
          const response = await options.request(url(OIS, {id}), {method: 'GET', cache: 'no-store', signal});
          if (response?.ok === false || !response?.item || response.item.id !== id || response.item.targetDate !== date || response.item.requestType !== type) throw new Error(response?.message || '조회 상태의 요청 식별정보가 다릅니다.');
          item = response.item;
        }
        if (!sameItem(item, date, type)) throw new Error('완료 결과의 날짜가 선택일과 다릅니다.');
        accept({ok: true, item});
        return true;
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error;
        warn(label + ' 조회 실패: ' + text(error?.message || error)); return false;
      }
    }
    if (options.queryMissing === true) {
      if (date >= todayKst()) warn('하루가 끝난 실적 기준일만 운영정보 전체 일별 조회를 할 수 있습니다.');
      else {
        if (needOnDay(date, Object.keys(STEAM))) await query('steam_status', '증기 생산·판매', payload => acceptHistory({items: [payload.item]}));
        if (['lime_u1_daily', 'lime_u2_daily', 'limestone_u1_daily', 'limestone_u2_daily'].some(key => wants(key) && numeric(record(date).values[key]) === null)) {
          if (await query('auxiliary_materials', '부재료', () => {})) {
            acceptMaterials(await get(url(OIS, {action: 'materials_history', startDate: date, endDate: date}), '새 부재료 자료'));
            acceptLimestone(await get(url(OIS, {action: 'usage_records', targetDate: date}), '새 석회석 사용량'));
          }
        }
        if (ENGINE_FIELDS.some(key => wants(key) && numeric(record(date).values[key]) === null)) await query('daily_operation_data', '운영정보', acceptEngine);
      }
    }
    for (const day of dates) deriveDaily(day);
    const target = record(date), incomplete = [];
    const siloValues = recalculate(target.values);
    for (const key of ['bio_storage_tonnes', 'coal_a_storage_tonnes', 'coal_b_storage_tonnes']) put(date, key, siloValues[key], 'workbook_formula', '원본 일일운전현황 Silo 환산식', 20);
    for (const key of monthlyWanted) {
      if (numeric(target.values[key]) !== null) continue;
      const daily = dates.map(day => sum(MTD[key].map(field => record(day).values[field])));
      const count = daily.filter(value => value === null).length;
      if (count) { incomplete.push({key, count}); continue; }
      const value = key.endsWith('_max') ? Math.max(...daily) : key.endsWith('_avg') ? sum(daily) / dates.length : sum(daily);
      put(date, key, value, 'month_daily_records', '당월 일별자료 집계', 20, {note: dates[0] + ' ~ ' + date + ' · ' + dates.length + '일 전체 자료 확인'});
    }
    if (incomplete.length) warn('당월 누계·최대·평균 ' + incomplete.length + '개 항목은 일별자료가 부족해 비워 두었습니다. 부족 일수: 최대 ' + Math.max(...incomplete.map(item => item.count)) + '일.');
    if (['ammonia_u1_daily', 'ammonia_u2_daily'].some(wants)) warn('SCR Ammonia는 원본 태그 kg/hr와 양식 m³ 단위가 달라 자동 변환하지 않습니다. 확인된 일일 사용량을 직접 입력해 주세요.');
    if (['power_uat_daily'].some(wants) && numeric(target.values.power_uat_daily) === null) warn('UAT는 원본 WATT 태그의 배율 확인이 필요합니다. 확인된 MWh 사용량을 직접 입력해 주세요.');
    const manual = ['steam_u1_hours', 'steam_u2_hours', 'steam_u3_hours', 'steam_u4_hours', 'power_hours_daily', 'steam_u3_daily', 'steam_u4_daily', 'ng_main_daily', 'ng_aux1_daily', 'ng_aux2_daily', 'coal_handling_daily', 'bio_handling_daily'];
    if (manual.some(key => wants(key) && numeric(target.values[key]) === null)) warn('운전시간·보조보일러 증기·NG·상탄량은 연결된 조회 태그가 없어 확인한 실적을 직접 입력해야 합니다.');
    const values = {}, sources = {};
    for (const [key, value] of Object.entries(target.values)) if (wants(key)) { values[key] = value; sources[key] = target.sources[key]; }
    progress('저장자료 확인을 마쳤습니다.');
    return {values, sources, warnings};
  }
  return Object.freeze({version: '20261018-v1', collect, dateValid, recalculate, bioSiloTonnes, coalSiloTonnes, engineFields: Object.freeze(ENGINE_FIELDS.slice())});
});
