(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CofiringCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MINUTE = 60000;
  const UNIT_IDS = ['unit1', 'unit2'];
  const FUELS = ['coal', 'bio', 'organic', 'manure'];
  const REQUIRED_SERIES = Object.freeze(UNIT_IDS.flatMap(function (unit, index) {
    return ['A-1', 'A-2', 'B-1', 'B-2'].map(function (feeder) {
      const queryTag = 'GSPOGE.ABB_DCS.BLR' + (index + 1) + ' COAL FEEDER ' + feeder + ' REFERENSE';
      return Object.freeze({ id: unit + 'Coal' + feeder.replace('-', ''), unit: unit, fuel: 'coal', queryTag: queryTag, tag: queryTag + '/PLOT' });
    }).concat([Object.freeze({ id: unit + 'Bio', unit: unit, fuel: 'bio', queryTag: 'GSPOGE.ABB_DCS.BLR' + (index + 1) + ' BIO SRF REFERENCE', tag: 'GSPOGE.ABB_DCS.BLR' + (index + 1) + ' BIO SRF REFERENCE/PLOT' })]);
  }));

  function instant(value) {
    if (typeof value !== 'string') throw new Error('시작·끝 시각을 시간대가 포함된 날짜로 지정해 주세요.');
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!m) throw new Error('시각은 초가 00인 분 단위이며 시간대가 있어야 합니다.');
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]), hour = Number(m[4]), minute = Number(m[5]);
    const wall = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (year < 2000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day) {
      throw new Error('유효한 날짜와 시각을 지정해 주세요.');
    }
    const zone = m[6];
    let offset = 0;
    if (zone !== 'Z') {
      const oh = Number(zone.slice(1, 3)), om = Number(zone.slice(4, 6));
      if (oh > 14 || om > 59 || (oh === 14 && om !== 0)) throw new Error('시간대가 올바르지 않습니다.');
      offset = (oh * 60 + om) * (zone[0] === '-' ? -1 : 1);
    }
    return wall.getTime() - offset * MINUTE;
  }

  function validateRange(start, end) {
    const startMs = instant(start), endMs = instant(end);
    const durationMinutes = (endMs - startMs) / MINUTE;
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 1440) {
      throw new Error('조회 기간은 1분 이상, 24시간 이내로 지정해 주세요.');
    }
    return { start: start, end: end, startMs: startMs, endMs: endMs, durationMinutes: durationMinutes, durationHours: durationMinutes / 60, boundaryCount: durationMinutes + 1 };
  }

  // Calendar dates and wall-clock times are always Asia/Seoul, regardless of browser timezone.
  // DataPARC's one-minute, Start-based buckets exclude queryEnd. Padding once to 00:01
  // exposes the next midnight boundary; it does not make the accounting day 24h 1m.
  function dailyRange(targetDate) {
    if (typeof targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) throw new Error('계산일을 YYYY-MM-DD 형식의 날짜 하나로 선택해 주세요.');
    const start = targetDate + 'T00:00:00+09:00';
    const startMs = instant(start);
    const nextDate = new Date(startMs + (24 * 60 + 9 * 60) * MINUTE).toISOString().slice(0, 10);
    const end = nextDate + 'T00:00:00+09:00';
    const range = validateRange(start, end);
    return Object.assign(range, { mode: 'daily', targetDate: targetDate, timeZone: 'Asia/Seoul',
      queryStart: start, queryEnd: nextDate + 'T00:01:00+09:00', queryDurationMinutes: 1441, stepSeconds: 60 });
  }

  function validateDailySource(reference) {
    const source = validateSource(reference);
    const date = new Date(source.range.startMs + 9 * 60 * MINUTE).toISOString().slice(0, 10);
    const day = dailyRange(date);
    if (source.range.startMs !== day.startMs || source.range.endMs !== day.endMs) {
      throw new Error('하루 전체 자료만 열 수 있습니다. 해당일 00:00부터 다음 날 00:00 경계값까지 필요합니다. 5분 연결 시험은 일별 계산 자료가 아닙니다.');
    }
    if ((reference.targetDate != null && reference.targetDate !== day.targetDate) ||
        (reference.queryStart != null && instant(reference.queryStart) !== day.startMs) ||
        (reference.queryEnd != null && instant(reference.queryEnd) !== instant(day.queryEnd))) {
      throw new Error('자료의 계산일 또는 DataPARC 조회 범위가 일별 기준과 다릅니다. 다음 날 00:01까지 한 번만 확장해야 합니다.');
    }
    return day;
  }

  function analyzeDay(reference, options) {
    options = options || {};
    const sourceDay = validateDailySource(reference);
    const day = dailyRange(options.targetDate || sourceDay.targetDate);
    if ((options.start != null && instant(options.start) !== day.startMs) ||
        (options.end != null && instant(options.end) !== day.endMs)) {
      throw new Error('혼소율은 하루 단위로만 계산합니다. 조회 종료 00:01은 계산 종료에 더하지 않습니다.');
    }
    if (day.targetDate !== sourceDay.targetDate) {
      throw new Error('선택일 ' + day.targetDate + '의 자료가 없습니다. 현재 자료는 ' + sourceDay.targetDate + ' 하루입니다. 선택일의 하루 조회 결과를 열어 주세요.');
    }
    const result = analyze(reference, Object.assign({}, options, { start: day.start, end: day.end }));
    result.period = day;
    return result;
  }

  function qualityGood(value) {
    if (typeof value !== 'string') return false;
    const parts = value.trim().toLowerCase().split(',').map(function (part) { return part.trim(); });
    return (parts.length === 1 && parts[0] === 'good') || (parts.length === 2 && ((parts[0] === 'raw' && parts[1] === 'good') || (parts[0] === 'good' && parts[1] === 'raw')));
  }

  function validateSource(reference) {
    if (!reference || !Array.isArray(reference.timestamps) || !Array.isArray(reference.series)) throw new Error('분별 원본 데이터 형식이 올바르지 않습니다.');
    const range = validateRange(reference.start, reference.end);
    if (reference.stepSeconds !== 60 || reference.timestamps.length !== range.boundaryCount) throw new Error('원본 시각 개수가 1분 간격의 시작·끝 경계 개수와 다릅니다.');
    reference.timestamps.forEach(function (timestamp, index) {
      if (instant(timestamp) !== range.startMs + index * MINUTE) throw new Error('원본 시각에 누락·중복·역순 또는 잘못된 간격이 있습니다.');
    });
    const entries = new Map();
    reference.series.forEach(function (series) {
      if (!series || typeof series.id !== 'string' || entries.has(series.id)) throw new Error('중복되거나 잘못된 연료 TAG가 있습니다.');
      entries.set(series.id, series);
    });
    return { range: range, entries: entries };
  }

  function positiveSetting(config, defaults, unit, fuel, title) {
    const group = config && config[unit];
    const fallback = defaults && defaults[unit];
    let value;
    if (group && Object.prototype.hasOwnProperty.call(group, fuel)) value = group[fuel];
    else if (fallback && Object.prototype.hasOwnProperty.call(fallback, fuel)) value = fallback[fuel];
    // Older saved/reference data predates the separate manure row.
    // Until an explicit manure setting is supplied, inherit the organic assumption.
    else if (fuel === 'manure' && group && Object.prototype.hasOwnProperty.call(group, 'organic')) value = group.organic;
    else if (fuel === 'manure' && fallback && Object.prototype.hasOwnProperty.call(fallback, 'organic')) value = fallback.organic;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(unit + ' ' + fuel + ' ' + title + '은 0보다 큰 숫자여야 합니다.');
    return value;
  }

  function inspectCounter(definition, series, firstIndex, lastIndex, expectedSourceCount, requireQuality) {
    const count = lastIndex - firstIndex + 1;
    const issues = [];
    if (!series) return { id: definition.id, tag: definition.tag, quantity: null, referenceQuantity: null, complete: false, missingSamples: count, observedSamples: 0, qualityVerified: false, issues: ['missing_tag'] };
    if (series.tag !== definition.tag || series.queryTag !== definition.queryTag || series.unit !== definition.unit || series.fuel !== definition.fuel || series.unitOfMeasure !== 'ton') {
      return { id: definition.id, tag: definition.tag, quantity: null, referenceQuantity: null, complete: false, missingSamples: count, observedSamples: 0, qualityVerified: false, issues: ['tag_identity_mismatch'] };
    }
    if (!Array.isArray(series.values) || series.values.length !== expectedSourceCount) {
      return { id: definition.id, tag: definition.tag, quantity: null, referenceQuantity: null, complete: false, missingSamples: count, observedSamples: 0, qualityVerified: false, issues: ['sample_count_mismatch'] };
    }
    let missingSamples = 0, observedSamples = 0, minimum = Infinity, maximum = -Infinity, previous = null;
    let badNumber = false, negative = false, reset = false, badQuality = false;
    const hasQualities = Array.isArray(series.qualities) && series.qualities.length === expectedSourceCount;
    for (let i = firstIndex; i <= lastIndex; i += 1) {
      const value = series.values[i];
      if (hasQualities && !qualityGood(series.qualities[i])) badQuality = true;
      if (value == null) { missingSamples += 1; continue; }
      if (typeof value !== 'number' || !Number.isFinite(value)) { badNumber = true; missingSamples += 1; continue; }
      observedSamples += 1;
      if (value < 0) negative = true;
      if (previous !== null && value < previous) reset = true;
      previous = value;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    if (missingSamples) issues.push('missing_samples');
    if (badNumber) issues.push('invalid_number');
    if (negative) issues.push('negative_counter');
    if (reset) issues.push('counter_reset');
    if (badQuality) issues.push('bad_quality');
    if (requireQuality && !hasQualities) issues.push('quality_not_recorded');
    const referenceQuantity = observedSamples >= 2 && !badNumber && !negative && !reset ? maximum - minimum : null;
    const complete = issues.length === 0 && referenceQuantity !== null;
    return { id: definition.id, tag: definition.tag, quantity: complete ? referenceQuantity : null, referenceQuantity: referenceQuantity, complete: complete, missingSamples: missingSamples, observedSamples: observedSamples, qualityVerified: hasQualities && !badQuality && missingSamples === 0, issues: issues };
  }

  function sumKnown(values) {
    return values.every(function (value) { return typeof value === 'number' && Number.isFinite(value); }) ? values.reduce(function (sum, value) { return sum + value; }, 0) : null;
  }

  function aggregateFuel(counters, coefficient, durationHours) {
    const measuredQuantity = sumKnown(counters.map(function (item) { return item.quantity; }));
    const referenceMeasuredQuantity = sumKnown(counters.map(function (item) { return item.referenceQuantity; }));
    const quantity = measuredQuantity === null ? null : measuredQuantity * coefficient;
    return {
      quantity: quantity,
      measuredQuantity: measuredQuantity,
      referenceMeasuredQuantity: referenceMeasuredQuantity,
      referenceQuantity: referenceMeasuredQuantity === null ? null : referenceMeasuredQuantity * coefficient,
      averageTonPerHour: quantity === null ? null : quantity / durationHours,
      complete: counters.every(function (item) { return item.complete; }),
      missingSamples: counters.reduce(function (sum, item) { return sum + item.missingSamples; }, 0),
      issues: Array.from(new Set(counters.flatMap(function (item) { return item.issues; }))),
      coefficient: coefficient,
      counters: counters
    };
  }

  function manualFuel(input, unit, period, coefficient, fuelName) {
    const issues = [];
    let value = null;
    const label = fuelName === 'manure' ? 'manure' : 'organic';
    if (!input || input[unit] == null || input[unit] === '') issues.push(label + '_not_entered');
    else {
      let matchingPeriod = false;
      try { matchingPeriod = instant(input.start) === period.startMs && instant(input.end) === period.endMs; } catch (_) { /* Missing period cannot authorize reuse. */ }
      if (!matchingPeriod) issues.push('stale_' + label + '_period');
      else if (typeof input[unit] !== 'number' || !Number.isFinite(input[unit]) || input[unit] < 0) issues.push('invalid_' + label);
      else value = input[unit];
    }
    const quantity = value === null ? null : value * coefficient;
    return {
      quantity: quantity,
      enteredQuantity: value,
      measuredQuantity: value,
      referenceQuantity: quantity,
      complete: quantity !== null,
      coefficient: coefficient,
      averageTonPerHour: quantity === null ? null : quantity / period.durationHours,
      issues: issues,
      source: 'period-user-input'
    };
  }

  function implicitZeroFuel(period, coefficient) {
    return {
      quantity: 0,
      enteredQuantity: 0,
      measuredQuantity: 0,
      referenceQuantity: 0,
      complete: true,
      coefficient: coefficient,
      averageTonPerHour: 0,
      issues: [],
      source: 'legacy-implicit-zero'
    };
  }

  function organicFuel(organic, unit, period, coefficient) {
    return manualFuel(organic, unit, period, coefficient, 'organic');
  }

  function heatResult(quantities, calorifics) {
    const heats = {};
    FUELS.forEach(function (fuel) { heats[fuel] = quantities[fuel] === null ? null : quantities[fuel] * calorifics[fuel] / 1000; });
    heats.total = sumKnown(FUELS.map(function (fuel) { return heats[fuel]; }));
    // Keep the legacy ratios keys stable. `organic` now means the organic group
    // (organic solid fuel + manure), while detailed shares are exposed separately.
    const ratios = { bio: null, organic: null, total: null };
    const fuelRatios = { bio: null, organic: null, manure: null, organicGroup: null, total: null };
    if (heats.total !== null && heats.total > 0) {
      fuelRatios.bio = heats.bio / heats.total * 100;
      fuelRatios.organic = heats.organic / heats.total * 100;
      fuelRatios.manure = heats.manure / heats.total * 100;
      fuelRatios.organicGroup = (heats.organic + heats.manure) / heats.total * 100;
      fuelRatios.total = (heats.bio + heats.organic + heats.manure) / heats.total * 100;
      ratios.bio = fuelRatios.bio;
      ratios.organic = fuelRatios.organicGroup;
      ratios.total = fuelRatios.total;
    }
    return { heats: heats, ratios: ratios, fuelRatios: fuelRatios };
  }

  function analyze(reference, options) {
    options = options || {};
    const source = validateSource(reference);
    const period = validateRange(options.start || reference.start, options.end || reference.end);
    if (period.startMs < source.range.startMs || period.endMs > source.range.endMs) throw new Error('선택한 기간이 첨부 원본에 저장된 기간을 벗어납니다.');
    const firstIndex = (period.startMs - source.range.startMs) / MINUTE;
    const lastIndex = (period.endMs - source.range.startMs) / MINUTE;
    const counters = REQUIRED_SERIES.map(function (definition) { return inspectCounter(definition, source.entries.get(definition.id), firstIndex, lastIndex, source.range.boundaryCount, options.requireQuality === true); });
    const units = {}, warnings = [];
    const actualCalorifics = {}, actualCoefficients = {};
    UNIT_IDS.forEach(function (unit, index) {
      const calorifics = {}, coefficients = {};
      FUELS.forEach(function (fuel) {
        calorifics[fuel] = positiveSetting(options.calorifics, reference.calorifics, unit, fuel, '발열량');
        coefficients[fuel] = positiveSetting(options.coefficients, reference.coefficients, unit, fuel, '보정계수');
      });
      actualCalorifics[unit] = calorifics;
      actualCoefficients[unit] = coefficients;
      const coal = aggregateFuel(counters.filter(function (item) { return item.id.startsWith(unit + 'Coal'); }), coefficients.coal, period.durationHours);
      const bio = aggregateFuel(counters.filter(function (item) { return item.id === unit + 'Bio'; }), coefficients.bio, period.durationHours);
      const organic = organicFuel(options.organic, unit, period, coefficients.organic);
      const hasManureInput = Object.prototype.hasOwnProperty.call(options, 'manure');
      const manure = hasManureInput ? manualFuel(options.manure, unit, period, coefficients.manure, 'manure') : implicitZeroFuel(period, coefficients.manure);
      const result = heatResult({ coal: coal.quantity, bio: bio.quantity, organic: organic.quantity, manure: manure.quantity }, calorifics);
      units[unit] = { coal: coal, bio: bio, organic: organic, manure: manure, calorifics: calorifics, heats: result.heats, ratios: result.ratios, fuelRatios: result.fuelRatios, complete: coal.complete && bio.complete && organic.complete && manure.complete, referenceOnly: true };
      if (!coal.complete) warnings.push((index + 1) + '호기 석탄: 누락 또는 비정상 데이터로 사용량을 확정하지 않았습니다.');
      if (!bio.complete) warnings.push((index + 1) + '호기 바이오: 누락 또는 비정상 데이터로 사용량을 확정하지 않았습니다.');
      if (!organic.complete) warnings.push((index + 1) + '호기 유기성 고형연료: 선택한 기간의 사용량 입력이 필요합니다.');
      if (hasManureInput && !manure.complete) warnings.push((index + 1) + '호기 축분: 선택한 기간의 사용량 입력이 필요합니다.');
      if (result.heats.total === 0) warnings.push((index + 1) + '호기: 총 투입열량이 0이므로 혼소율을 계산하지 않았습니다.');
    });
    const combinedHeats = {};
    FUELS.concat(['total']).forEach(function (fuel) { combinedHeats[fuel] = sumKnown(UNIT_IDS.map(function (unit) { return units[unit].heats[fuel]; })); });
    const combinedRatios = { bio: null, organic: null, total: null };
    const combinedFuelRatios = { bio: null, organic: null, manure: null, organicGroup: null, total: null };
    if (combinedHeats.total !== null && combinedHeats.total > 0) {
      combinedFuelRatios.bio = combinedHeats.bio / combinedHeats.total * 100;
      combinedFuelRatios.organic = combinedHeats.organic / combinedHeats.total * 100;
      combinedFuelRatios.manure = combinedHeats.manure / combinedHeats.total * 100;
      combinedFuelRatios.organicGroup = (combinedHeats.organic + combinedHeats.manure) / combinedHeats.total * 100;
      combinedFuelRatios.total = (combinedHeats.bio + combinedHeats.organic + combinedHeats.manure) / combinedHeats.total * 100;
      combinedRatios.bio = combinedFuelRatios.bio;
      combinedRatios.organic = combinedFuelRatios.organicGroup;
      combinedRatios.total = combinedFuelRatios.total;
    }
    const qualityVerified = counters.every(function (counter) { return counter.qualityVerified; });
    if (!qualityVerified) warnings.push('원본에 모든 시점의 품질 정보가 확인되지 않아 운영 저장용 결과로 판정하지 않았습니다.');
    return { period: period, units: units, combined: { heats: combinedHeats, ratios: combinedRatios, fuelRatios: combinedFuelRatios }, warnings: warnings, sourceKind: reference.source && reference.source.kind || 'reference-data', qualityVerified: qualityVerified, productionReady: false, databaseWritten: false, calorifics: actualCalorifics, coefficients: actualCoefficients };
  }


  function periodRange(startLocal, endLocal, stepUnit, stepValue) {
    const localPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
    function zoned(value, label) {
      if (typeof value !== 'string' || !localPattern.test(value)) throw new Error(label + '은 YYYY-MM-DD HH:mm 형식으로 지정해 주세요.');
      return value + ':00+09:00';
    }
    const start = zoned(startLocal, '시작일시');
    const end = zoned(endLocal, '종료일시');
    const startMs = instant(start), endMs = instant(end);
    const durationMinutes = (endMs - startMs) / MINUTE;
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 44640) {
      throw new Error('기간 계산은 1분 이상, 최대 31일까지 지정해 주세요.');
    }
    const unit = String(stepUnit || '').toLowerCase();
    if (!['minute','hour','day'].includes(unit)) throw new Error('계산 간격은 분/시간/일 중에서 선택해 주세요.');
    const value = Number(stepValue);
    if (!Number.isInteger(value) || value < 1 || value > 1440) throw new Error('계산 간격 값은 1 이상의 정수로 지정해 주세요.');
    const stepMinutes = unit === 'minute' ? value : unit === 'hour' ? value * 60 : value * 1440;
    if (stepMinutes > durationMinutes && durationMinutes > 1) throw new Error('계산 간격이 전체 조회 기간보다 큽니다.');
    return {
      mode: 'period', startLocal, endLocal, start, end, startMs, endMs,
      durationMinutes, durationHours: durationMinutes / 60,
      stepUnit: unit, stepValue: value, stepMinutes,
      targetDate: startLocal.slice(0,10), timeZone: 'Asia/Seoul',
      queryStart: start, queryEnd: new Date(endMs + MINUTE + 9*60*MINUTE).toISOString().slice(0,19) + '+09:00'
    };
  }

  function periodSummaryCounter(definition, item, period) {
    const issues = [];
    if (!item || item.key !== definition.id || item.unit !== definition.unit || item.fuel !== definition.fuel || item.tag !== definition.queryTag) {
      return { id: definition.id, quantity: null, referenceQuantity: null, complete: false, missingSamples: 1, observedSamples: 0, qualityVerified: false, issues: ['summary_identity_mismatch'] };
    }
    const n = function (value) { return typeof value === 'number' && Number.isFinite(value) ? value : null; };
    const startValue=n(item.startValue), endValue=n(item.endValue), min=n(item.min), max=n(item.max), delta=n(item.delta), usage=n(item.usageTon);
    if ([startValue,endValue,min,max,delta,usage].some(function(v){return v===null;})) issues.push('summary_number_missing');
    if ([startValue,endValue,min,max].some(function(v){return v!==null&&v<0;})) issues.push('negative_counter');
    if (!qualityGood(item.startQuality) || !qualityGood(item.endQuality)) issues.push('bad_quality');
    const startAt=Date.parse(item.startTime), endAt=Date.parse(item.endTime);
    if (!Number.isFinite(startAt) || startAt < period.startMs || startAt >= period.startMs + MINUTE) issues.push('start_time_invalid');
    if (!Number.isFinite(endAt) || endAt < period.endMs || endAt >= period.endMs + MINUTE) issues.push('end_time_invalid');
    if (startValue!==null&&endValue!==null&&endValue+0.001<startValue) issues.push('counter_reset');
    const derived=startValue===null||endValue===null?null:endValue-startValue;
    if (derived!==null&&usage!==null&&Math.abs(derived-usage)>0.001) issues.push('usage_mismatch');
    const spread=min===null||max===null?null:max-min;
    if (spread!==null&&delta!==null&&Math.abs(spread-delta)>0.001) issues.push('delta_minmax_mismatch');
    if (startValue!==null&&min!==null&&min+0.001<startValue) issues.push('range_below_start');
    if (endValue!==null&&max!==null&&max-0.001>endValue) issues.push('range_above_end');
    const good=n(item.durationGoodSeconds), bad=n(item.durationBadSeconds), expected=period.durationMinutes*60;
    if (good===null||bad===null||good<0||bad<0||Math.abs((good||0)+(bad||0)-expected)>2) issues.push('duration_coverage_invalid');
    if (item.boundaryValid !== true || item.durationCoverageValid !== true) issues.push('worker_validation_failed');
    const complete=issues.length===0&&derived!==null&&derived>=-0.001;
    const qualityGapSeconds=bad!==null&&bad>0.001?bad:0;
    return {
      id: definition.id, tag: definition.tag, quantity: complete ? Math.max(0,derived) : null,
      referenceQuantity: derived===null?null:Math.max(0,derived), complete,
      missingSamples: complete?0:1, observedSamples: complete?2:0,
      qualityVerified: complete&&qualityGapSeconds<=0.001, qualityGapSeconds,
      issues: Array.from(new Set(issues)), summary: item
    };
  }

  function analyzePeriodSummary(reference, options) {
    options = options || {};
    if (!reference || reference.kind !== 'cofiring_period_summary_v1' || reference.schemaVersion !== 1) throw new Error('지원하는 기간 DataPARC 요약 자료가 아닙니다.');
    const period = periodRange(reference.startLocal, reference.endLocal, reference.stepUnit, reference.stepValue);
    if (options.startLocal && options.startLocal !== period.startLocal || options.endLocal && options.endLocal !== period.endLocal) throw new Error('선택한 기간과 조회 결과 기간이 다릅니다.');
    if (!Array.isArray(reference.summaries) || reference.summaries.length !== REQUIRED_SERIES.length) throw new Error('기간 조회에는 Coal 8개와 Bio-SRF 2개 TAG 요약이 모두 필요합니다.');
    const entries=new Map(reference.summaries.map(function(item){return [item && item.key,item];}));
    if(entries.size!==REQUIRED_SERIES.length) throw new Error('기간 조회 TAG가 중복되거나 누락되었습니다.');
    const counters=REQUIRED_SERIES.map(function(def){return periodSummaryCounter(def,entries.get(def.id),period);});
    const units={},warnings=[],actualCalorifics={},actualCoefficients={};
    const maxQualityGapSeconds=counters.reduce(function(max,c){return Math.max(max,c.qualityGapSeconds||0);},0);
    if(maxQualityGapSeconds>0.001)warnings.push('DataPARC 중간 품질 공백이 최대 '+maxQualityGapSeconds.toFixed(1)+'초 확인됐습니다. 시작·종료 누적 경계와 Min/Max가 정상인 TAG는 경계값 차이로 사용량을 표시합니다.');
    UNIT_IDS.forEach(function(unit,index){
      const calorifics={},coefficients={};
      FUELS.forEach(function(fuel){
        calorifics[fuel]=positiveSetting(options.calorifics, reference.calorifics, unit, fuel, '발열량');
        coefficients[fuel]=positiveSetting(options.coefficients, reference.coefficients, unit, fuel, '보정계수');
      });
      actualCalorifics[unit]=calorifics;actualCoefficients[unit]=coefficients;
      const coal=aggregateFuel(counters.filter(function(item){return item.id.startsWith(unit+'Coal');}),coefficients.coal,period.durationHours);
      const bio=aggregateFuel(counters.filter(function(item){return item.id===unit+'Bio';}),coefficients.bio,period.durationHours);
      const organic=manualFuel(options.organic,unit,period,coefficients.organic,'organic');
      const manure=manualFuel(options.manure,unit,period,coefficients.manure,'manure');
      const result=heatResult({coal:coal.quantity,bio:bio.quantity,organic:organic.quantity,manure:manure.quantity},calorifics);
      units[unit]={coal,bio,organic,manure,calorifics,heats:result.heats,ratios:result.ratios,fuelRatios:result.fuelRatios,complete:coal.complete&&bio.complete&&organic.complete&&manure.complete,referenceOnly:true};
      if(!coal.complete)warnings.push((index+1)+'호기 석탄: 기간 경계/품질/누적값 검증을 통과하지 못했습니다.');
      if(!bio.complete)warnings.push((index+1)+'호기 바이오: 기간 경계/품질/누적값 검증을 통과하지 못했습니다.');
      if(!organic.complete)warnings.push((index+1)+'호기 유기성 고형연료: 선택 기간 사용량 입력이 필요합니다.');
      if(!manure.complete)warnings.push((index+1)+'호기 축분: 선택 기간 사용량 입력이 필요합니다.');
    });
    const combinedHeats={};
    FUELS.concat(['total']).forEach(function(fuel){combinedHeats[fuel]=sumKnown(UNIT_IDS.map(function(unit){return units[unit].heats[fuel];}));});
    const combinedRatios={bio:null,organic:null,total:null},combinedFuelRatios={bio:null,organic:null,manure:null,organicGroup:null,total:null};
    if(combinedHeats.total!==null&&combinedHeats.total>0){
      combinedFuelRatios.bio=combinedHeats.bio/combinedHeats.total*100;
      combinedFuelRatios.organic=combinedHeats.organic/combinedHeats.total*100;
      combinedFuelRatios.manure=combinedHeats.manure/combinedHeats.total*100;
      combinedFuelRatios.organicGroup=(combinedHeats.organic+combinedHeats.manure)/combinedHeats.total*100;
      combinedFuelRatios.total=(combinedHeats.bio+combinedHeats.organic+combinedHeats.manure)/combinedHeats.total*100;
      combinedRatios.bio=combinedFuelRatios.bio;combinedRatios.organic=combinedFuelRatios.organicGroup;combinedRatios.total=combinedFuelRatios.total;
    }
    const qualityVerified=counters.every(function(c){return c.qualityVerified;});
    return {period,units,combined:{heats:combinedHeats,ratios:combinedRatios,fuelRatios:combinedFuelRatios},warnings,sourceKind:'dataparc-period-summary',qualityVerified,productionReady:false,databaseWritten:false,calorifics:actualCalorifics,coefficients:actualCoefficients};
  }

  return Object.freeze({ dailyRange: dailyRange, validateDailySource: validateDailySource, analyzeDay: analyzeDay, validateRange: validateRange, analyze: analyze, periodRange: periodRange, analyzePeriodSummary: analyzePeriodSummary, qualityGood: qualityGood, requiredSeries: REQUIRED_SERIES });
}));
