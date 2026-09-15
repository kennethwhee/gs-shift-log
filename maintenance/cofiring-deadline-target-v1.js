(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CofiringDeadlineTargetV1 = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MINUTE = 60000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const KST = 9 * HOUR;
  const TARGET = 0.25;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const positive = value => finite(value) && value > 0;
  const nonnegative = value => finite(value) && value >= 0;

  function localMinute(value) {
    return new Date(value + KST).toISOString().slice(0, 16);
  }

  function parseText(value, local) {
    if (typeof value !== 'string') return NaN;
    const pattern = local
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
      : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):00(?:\.000)?(Z|[+-]\d{2}:\d{2})$/;
    const match = pattern.exec(value);
    if (!match) return NaN;
    const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
    const wall = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (year < 2000 || year > 9998 || month < 1 || month > 12 || day < 1 ||
        hour > 23 || minute > 59 || wall.getUTCFullYear() !== year ||
        wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day) return NaN;
    let offset = KST;
    if (!local) {
      const zone = match[6];
      offset = 0;
      if (zone !== 'Z') {
        const hours = Number(zone.slice(1, 3)), minutes = Number(zone.slice(4, 6));
        if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return NaN;
        offset = (hours * 60 + minutes) * MINUTE * (zone[0] === '-' ? -1 : 1);
      }
    }
    return wall.getTime() - offset;
  }

  // Core results provide all three forms. Check consistency instead of trusting
  // a stale durationHours or a date parsed in the computer's local timezone.
  function periodInstant(period, key) {
    const values = [];
    if (period[key + 'Local'] != null) values.push(parseText(period[key + 'Local'], true));
    if (period[key] != null) values.push(parseText(period[key], false));
    if (period[key + 'Ms'] != null) values.push(period[key + 'Ms']);
    if (!values.length || values.some(value => !finite(value) || value % MINUTE !== 0)) return NaN;
    if (values.some(value => value !== values[0])) return NaN;
    const date = new Date(values[0] + KST);
    if (!finite(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 9998) return NaN;
    return values[0];
  }

  function forUnit(unit, period, options) {
    options = options || {};
    const now = Object.prototype.hasOwnProperty.call(options, 'now') ? options.now : Date.now();
    const result = {
      status: 'invalid_period', ready: false, message: '', targetPercent: 25,
      targetDate: null, dataAsOfLocal: null, deadlineLocal: null,
      dataAsOfMs: null, deadlineMs: null, elapsedHours: null, remainingHours: null, lagHours: null,
      coalAssumption: null, coalTonPerHour: null, currentBioTonPerHour: null,
      currentMeasuredBioTonPerHour: null, projectedCoalTon: null, targetTotalBioTon: null,
      additionalBioTon: null, targetBioTonPerHour: null, targetMeasuredBioTonPerHour: null,
      projectedRatioPercent: null, exactTargetPossible: false
    };
    function stop(status, message) { return Object.assign(result, { status, message }); }
    if (!period || typeof period !== 'object') return stop('invalid_period', '조회 기간을 확인해 주세요.');
    const start = periodInstant(period, 'start'), end = periodInstant(period, 'end');
    if (!finite(start) || !finite(end) || end <= start) return stop('invalid_period', '조회 기간은 유효한 분 단위 시각으로 지정해야 합니다.');
    const startLocal = localMinute(start);
    if (!startLocal.endsWith('T00:00') || end - start > DAY) {
      return stop('unsupported_period', '마감 목표는 해당일 00:00부터 조회한 당일 누적 자료에 표시합니다.');
    }
    const midnight = start + DAY, deadline = midnight + MINUTE;
    Object.assign(result, {
      targetDate: startLocal.slice(0, 10), dataAsOfLocal: localMinute(end), deadlineLocal: localMinute(deadline),
      dataAsOfMs: end, deadlineMs: deadline, elapsedHours: (end - start) / HOUR,
      remainingHours: (deadline - end) / HOUR
    });
    if (!finite(now) || !finite(new Date(now).getTime())) return stop('invalid_now', '현재 시각을 확인할 수 없습니다.');
    if (end > now) return stop('future_data', '현재 시각 이후의 누적 자료로 마감 목표를 계산할 수 없습니다.');
    result.lagHours = (now - end) / HOUR;
    // A complete midnight-to-midnight report is closed. The extra minute is the
    // query deadline, not an extra accounting minute in an already finished day.
    if (end === midnight || now >= deadline) return stop('closed', '마감된 날짜입니다. 추가 투입 목표를 계산하지 않습니다.');
    if (!unit || unit.coal?.complete !== true || unit.bio?.complete !== true ||
        !nonnegative(unit.coal.quantity) || !nonnegative(unit.bio.quantity)) {
      return stop('incomplete_data', 'Coal·Bio 누적 실사용량을 확인한 뒤 마감 목표를 계산합니다.');
    }
    const coalCV = unit.calorifics?.coal, bioCV = unit.calorifics?.bio;
    const coalCoefficient = unit.coal.coefficient, bioCoefficient = unit.bio.coefficient;
    if (![coalCV, bioCV, coalCoefficient, bioCoefficient].every(positive)) {
      return stop('invalid_settings', 'Coal·Bio 발열량과 보정계수는 0보다 큰 값이어야 합니다.');
    }
    const specifiedCoal = Object.prototype.hasOwnProperty.call(options, 'coalTonPerHour');
    const coalRate = specifiedCoal ? options.coalTonPerHour : unit.coal.quantity / result.elapsedHours;
    if (!nonnegative(coalRate)) return stop('invalid_coal_rate', '예상 Coal 실사용량은 시간당 0 이상의 값이어야 합니다.');

    // quantity has already been corrected by CofiringCore. Do not multiply its
    // coefficient twice. The assumed coal rate and target are corrected tons.
    const projectedCoal = unit.coal.quantity + coalRate * result.remainingHours;
    const totalBio = (TARGET / (1 - TARGET)) * projectedCoal * coalCV / bioCV;
    const difference = totalBio - unit.bio.quantity;
    const tolerance = 1e-10 * Math.max(1, Math.abs(totalBio), unit.bio.quantity);
    const additionalBio = Math.abs(difference) <= tolerance ? 0 : Math.max(0, difference);
    const bioRate = additionalBio / result.remainingHours;
    const measuredBioRate = bioRate / bioCoefficient;
    const currentBioRate = unit.bio.quantity / result.elapsedHours;
    const currentMeasuredBioRate = unit.bio.quantity / bioCoefficient / result.elapsedHours;
    const coalHeat = projectedCoal * coalCV;
    const bioHeat = (unit.bio.quantity + additionalBio) * bioCV;
    const totalHeat = coalHeat + bioHeat;
    if (![projectedCoal, totalBio, difference, additionalBio, bioRate, measuredBioRate, currentBioRate, currentMeasuredBioRate,
      coalHeat, bioHeat, totalHeat].every(finite)) return stop('invalid_calculation', '입력값 범위가 너무 커서 마감 목표를 계산할 수 없습니다.');
    if (totalHeat <= 0) return stop('no_heat', 'Coal·Bio 투입열량이 없어 25% 마감 목표를 계산할 수 없습니다.');
    Object.assign(result, {
      ready: true, coalAssumption: specifiedCoal ? 'specified' : 'period-average', coalTonPerHour: coalRate,
      currentBioTonPerHour: currentBioRate,
      currentMeasuredBioTonPerHour: currentMeasuredBioRate,
      projectedCoalTon: projectedCoal, targetTotalBioTon: totalBio, additionalBioTon: additionalBio,
      targetBioTonPerHour: bioRate, targetMeasuredBioTonPerHour: measuredBioRate,
      projectedRatioPercent: bioHeat / totalHeat * 100, exactTargetPossible: difference >= -tolerance
    });
    if (!result.exactTargetPossible) {
      return stop('above_target', '예상 Coal 투입량에서는 Bio를 추가하지 않아도 마감 혼소율이 25%를 넘습니다.');
    }
    return stop('ready', '자료 기준 시각부터 마감까지의 필요 Bio 투입량입니다.');
  }

  return Object.freeze({ forUnit });
}));
