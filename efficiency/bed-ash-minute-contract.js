(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BedAshMinuteContract = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MINUTE = 60000;
  const KST = 9 * 60 * MINUTE;
  const SOURCE_KIND = 'dataparc_bed_ash_minute';
  const SOURCE_NAME = 'DataPARC Bed Ash 1분 중량';
  const UNIT_DEFINITIONS = Object.freeze([
    Object.freeze({ unitNo: 1, tagNumber: '104HDC01CW101XQ01', itemName: '#1 UNIT BED ASH SILO WE WT-2011' }),
    Object.freeze({ unitNo: 2, tagNumber: '204HDC01CW101XQ01', itemName: '#2 UNIT BED ASH SILO WE WT-2012' })
  ]);

  function invalid(message) {
    const error = new Error('Bed Ash 1분 자료: ' + message);
    error.code = 'BED_ASH_MINUTE_INVALID_RESULT';
    throw error;
  }

  function object(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function calendar(year, month, day, hour, minute, second) {
    const wall = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59 ||
        wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month - 1 || wall.getUTCDate() !== day) {
      invalid('유효한 날짜와 시각이 필요합니다.');
    }
    return wall.getTime();
  }

  // Reject Date.parse's rollover dates and timezone-less local timestamps.
  function instant(value, title) {
    if (typeof value !== 'string') invalid(title + '에 시간대를 포함한 ISO 시각이 필요합니다.');
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) invalid(title + '의 ISO 시각 형식이 올바르지 않습니다.');
    const wall = calendar(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
    const zone = match[8];
    let offset = 0;
    if (zone !== 'Z') {
      const hours = Number(zone.slice(1, 3));
      const minutes = Number(zone.slice(4, 6));
      if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) invalid(title + '의 시간대가 올바르지 않습니다.');
      offset = (hours * 60 + minutes) * MINUTE * (zone[0] === '-' ? -1 : 1);
    }
    // .NET's round-trip ISO format carries seven fractional digits. Compare at
    // JavaScript's millisecond resolution while preserving the actual source text.
    return wall + Number((match[7] || '').slice(0, 3).padEnd(3, '0')) - offset;
  }

  function minuteInstant(value, title) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00$/.test(value)) {
      invalid(title + '은 한국 시각(+09:00)의 정확한 1분 경계여야 합니다.');
    }
    return instant(value, title);
  }

  function kstMinute(timestamp) {
    return new Date(timestamp + KST).toISOString().slice(0, 19) + '+09:00';
  }

  function isGoodQuality(quality) {
    return /^(?:Good|Raw\s*,\s*Good|Good\s*,\s*Raw)$/i.test(quality);
  }

  function normalizeMinuteBedAshResult(raw, targetDate, now) {
    if (now === undefined) now = Date.now();
    if (!Number.isFinite(now)) invalid('검증 기준 시각이 올바르지 않습니다.');
    if (!object(raw)) invalid('결과가 객체 형식이 아닙니다.');
    if (raw.schemaVersion !== 2 || raw.sourceKind !== SOURCE_KIND || raw.sampleIntervalSeconds !== 60) {
      invalid('schemaVersion 2, DataPARC 1분 원본과 60초 간격이 필요합니다.');
    }
    if (typeof targetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) invalid('요청 날짜가 올바르지 않습니다.');
    const start = minuteInstant(targetDate + 'T00:00:00+09:00', '요청 날짜');
    const dayEnd = start + 24 * 60 * MINUTE;
    const today = new Date(now + KST).toISOString().slice(0, 10);
    if (targetDate > today) invalid('미래 날짜의 자료를 등록할 수 없습니다.');
    if (raw.targetDate !== targetDate) invalid('결과 날짜가 요청 날짜와 다릅니다.');

    const collectedAt = instant(raw.collectedAt, '수집 시각');
    if (collectedAt > now) invalid('수집 시각이 현재보다 미래입니다.');
    const intervalStart = minuteInstant(raw.intervalStart, '시작 시각');
    const intervalEnd = minuteInstant(raw.intervalEnd, '종료 시각');
    const cutoff = Math.floor((collectedAt - 5 * MINUTE) / MINUTE) * MINUTE;
    if (intervalStart !== start || intervalEnd < start || intervalEnd > dayEnd || intervalEnd > cutoff) {
      invalid('조회 구간은 선택일 00:00부터 다음 날 00:00 이내이며 수집 시각보다 5분 이전이어야 합니다.');
    }
    const count = (intervalEnd - start) / MINUTE + 1;
    if (!Number.isInteger(count) || count < 1 || count > 1441) invalid('조회 구간의 1분 표본 수가 올바르지 않습니다.');
    if (!Array.isArray(raw.units) || raw.units.length !== 2) invalid('1·2호기 자료가 정확히 하나씩 필요합니다.');

    const seenUnits = new Set();
    const units = UNIT_DEFINITIONS.map(function (definition) {
      const unit = raw.units.find(function (candidate) { return object(candidate) && candidate.unitNo === definition.unitNo; });
      if (!unit || seenUnits.has(unit.unitNo) || unit.tagNumber !== definition.tagNumber) {
        invalid(definition.unitNo + '호기의 허용된 TAG 자료가 없습니다.');
      }
      seenUnits.add(unit.unitNo);
      if (typeof unit.itemName !== 'string' || !unit.itemName.trim() || unit.itemName.length > 200) {
        invalid(definition.unitNo + '호기의 항목명이 올바르지 않습니다.');
      }
      if (!Array.isArray(unit.samples) || unit.samples.length !== count || unit.samples.length > 1441) {
        invalid(definition.unitNo + '호기에 조회 구간의 모든 1분 행이 필요합니다. 누락 값은 null로 보존해야 합니다.');
      }
      const samples = unit.samples.map(function (sample, index) {
        if (!object(sample)) invalid(definition.unitNo + '호기의 표본이 객체 형식이 아닙니다.');
        const timestamp = minuteInstant(sample.sampledAt, definition.unitNo + '호기 표본 시각');
        const expected = start + index * MINUTE;
        if (timestamp !== expected) invalid(definition.unitNo + '호기 표본의 분 경계가 중복·누락되었거나 순서가 다릅니다.');
        if (typeof sample.quality !== 'string' || !sample.quality.trim() || sample.quality.length > 100) {
          invalid(definition.unitNo + '호기 표본의 원본 품질이 필요합니다.');
        }
        const quality = sample.quality.trim();
        if (sample.returnedAt !== null && typeof sample.returnedAt !== 'string') {
          invalid(definition.unitNo + '호기 표본의 실제 반환 시각은 ISO 시각 또는 null이어야 합니다.');
        }
        const returnedAt = sample.returnedAt === null ? null : instant(sample.returnedAt, definition.unitNo + '호기 실제 반환 시각');
        if (returnedAt !== null && returnedAt > collectedAt) invalid(definition.unitNo + '호기 실제 반환 시각이 수집 시각보다 미래입니다.');
        if (sample.levelTon !== null) {
          if (typeof sample.levelTon !== 'number' || !Number.isFinite(sample.levelTon) || sample.levelTon < 0) {
            invalid(definition.unitNo + '호기 중량은 유한한 0 이상 숫자 또는 null이어야 합니다.');
          }
          if (!isGoodQuality(quality)) invalid(definition.unitNo + '호기의 불량·미확인 품질 중량은 null이어야 합니다.');
          if (returnedAt === null || returnedAt < timestamp || returnedAt >= timestamp + MINUTE) {
            invalid(definition.unitNo + '호기의 실제 반환 시각이 해당 1분 구간에 없습니다.');
          }
        }
        return { sampledAt: kstMinute(expected), levelTon: sample.levelTon, quality: quality, returnedAt: sample.returnedAt };
      });
      return { unitNo: definition.unitNo, tagNumber: definition.tagNumber, itemName: unit.itemName.trim(), samples: samples };
    });

    // Never trust payload ready/complete booleans, nor substitute missing values with zero.
    return {
      schemaVersion: 2, sourceKind: SOURCE_KIND, source: SOURCE_NAME, sampleIntervalSeconds: 60,
      targetDate: targetDate, collectedAt: new Date(collectedAt).toISOString(),
      intervalStart: kstMinute(start), intervalEnd: kstMinute(intervalEnd), units: units
    };
  }

  return Object.freeze({ normalizeMinuteBedAshResult: normalizeMinuteBedAshResult, SOURCE_KIND: SOURCE_KIND, UNIT_DEFINITIONS: UNIT_DEFINITIONS });
}));
