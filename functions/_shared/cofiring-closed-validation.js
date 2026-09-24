import core from '../../maintenance/cofiring-core.js';
import contract from '../../maintenance/cofiring-live-contract.js';
import adjustment from '../../maintenance/cofiring-period-adjustment-v56.js';

const UNITS = ['unit1', 'unit2'];
const FUELS = ['coal', 'bio', 'organic', 'manure'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fail = message => { throw new Error(message); };

export function validDate(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function validateClosedSnapshot(body, source, now = Date.now()) {
  const snapshot = body.snapshot;
  if (!object(snapshot) || snapshot.schemaVersion !== 1 || snapshot.targetDate !== body.targetDate ||
      snapshot.sourceRequestId !== body.sourceRequestId || !validDate(body.targetDate)) {
    fail('마감 날짜·조회 ID·스냅샷 형식을 확인해 주세요.');
  }
  const day = core.dailyRange(body.targetDate);
  if (now < Date.parse(day.queryEnd)) fail('다음 날 00:01 이후의 완료된 일별 자료만 마감할 수 있습니다.');
  const spec = core.periodRange(day.start.slice(0, 16), day.end.slice(0, 16), 'minute', 1);
  for (const key of ['startLocal', 'endLocal', 'stepUnit', 'stepValue']) {
    if (snapshot.period?.[key] !== spec[key]) fail('하루 전체 조회가 완료된 일별 결과만 마감할 수 있습니다.');
  }
  let saved;
  try {
    saved = contract.periodResult(JSON.parse(source.result_json), body.sourceRequestId, spec);
  } catch {
    fail('서버에 저장된 DataPARC 결과의 기간·원본 검증을 통과하지 못했습니다. 다시 조회해 주세요.');
  }

  const settings = {}, manual = { receipts: {} }, calorifics = {}, coefficients = {};
  for (const unit of UNITS) {
    settings[unit] = {}; manual[unit] = {}; calorifics[unit] = {}; coefficients[unit] = {};
    for (const fuel of FUELS) {
      const entry = snapshot.settings?.[unit]?.[fuel];
      if (!object(entry) || !finite(entry.calorific) || entry.calorific <= 0 || entry.calorific > 50000 ||
          !finite(entry.coefficient) || entry.coefficient <= 0 || entry.coefficient > 100) {
        fail('마감 계산에 사용한 발열량·보정계수가 올바르지 않습니다.');
      }
      settings[unit][fuel] = { calorific: entry.calorific, coefficient: entry.coefficient };
      calorifics[unit][fuel] = entry.calorific; coefficients[unit][fuel] = entry.coefficient;
    }
    for (const fuel of ['organic', 'manure']) {
      const value = snapshot.manual?.[unit]?.[fuel];
      if (value !== null && (!finite(value) || value < 0 || value > 1000000)) {
        fail('마감 계산에 사용한 유기성·축분 수량이 올바르지 않습니다.');
      }
      manual[unit][fuel] = value;
    }
  }
  for (const fuel of ['organic', 'manure']) {
    const value = snapshot.manual?.receipts?.[fuel] ?? null;
    if (value !== null && (!finite(value) || value < 0 || value > 1000000)) fail('마감 입고량이 올바르지 않습니다.');
    manual.receipts[fuel] = value;
  }
  const inputMode=snapshot.manual?.inputMode;
  if(inputMode!==undefined&&!['auto','manual'].includes(inputMode))fail('사용량 입력 방식을 확인해 주세요.');
  if(inputMode==='manual')manual.inputMode='manual';
  const organicUsage=inputMode==='manual'
    ?core.organicManualUsage(manual,spec)
    :core.organicInventoryUsage(saved.report.reference,manual.receipts.organic,spec);
  if(!organicUsage.ok)fail(organicUsage.message+' 마감하지 않았습니다.');
  for(const unit of UNITS){
    if(!finite(manual[unit].organic)||Math.abs(manual[unit].organic-organicUsage.allocation[unit])>0.000001){
      fail('유기성 사용량이 서버의 시작재고 + 입고량 - 종료재고 계산값과 다릅니다. 다시 계산해 주세요.');
    }
  }
  // Blank manure retains the established zero policy. Organic quantities have
  // already been validated against the selected automatic or manual basis.
  const manualInput = fuel => ({ start: spec.start, end: spec.end,
    unit1: manual.unit1[fuel] ?? 0, unit2: manual.unit2[fuel] ?? 0 });
  let result = core.analyzePeriodSummary(saved.report.reference, {
    startLocal: spec.startLocal, endLocal: spec.endLocal, calorifics, coefficients,
    organic: manualInput('organic'), manure: manualInput('manure')
  });
  if (!UNITS.every(unit => result.units[unit].coal.complete && result.units[unit].bio.complete)) {
    fail('석탄·바이오 원본 경계값을 확정하지 못해 마감하지 않았습니다.');
  }
  const shown = snapshot.result;
  if (!object(shown)) fail('계산 결과가 없습니다. 다시 계산한 뒤 마감해 주세요.');
  if (shown.adjustment?.applied === true) {
    const meta = shown.adjustment;
    let adjusted;
    if (meta.mode === 'manual_transfer' && [1, 2].includes(meta.fromUnit) && finite(meta.bioTransferTons) && meta.bioTransferTons > 0) {
      const final1 = shown.units?.unit1?.bio?.quantity, final2 = shown.units?.unit2?.bio?.quantity;
      const before1 = result.units.unit1.bio.quantity, before2 = result.units.unit2.bio.quantity;
      const moved = meta.fromUnit === 1 ? before1 - final1 : before2 - final2;
      // The existing adjustment metadata rounds transferred tons to 3 decimals;
      // the actual final quantities retain 6. Preserve those actual quantities.
      if (!finite(final1) || !finite(final2) || moved <= 0 ||
          Math.abs(final1 + final2 - before1 - before2) > 0.000002 ||
          Math.abs(moved - meta.bioTransferTons) > 0.000501) fail('호기 간 Bio 이동량이 계산 결과와 다릅니다.');
      adjusted = adjustment.adjustFinal(result, settings, final1, final2,
        { mode: 'manual_transfer', fromUnit: meta.fromUnit, bioTransferTons: moved });
    } else if (meta.mode === 'max_auto' && finite(meta.maxBioTpd) && meta.maxBioTpd > 0 && meta.maxBioTpd <= 2000) {
      adjusted = adjustment.autoMax(result, settings, meta.maxBioTpd);
    } else if (meta.mode === 'manual_final') {
      adjusted = adjustment.adjustFinal(result, settings, shown.units?.unit1?.bio?.quantity,
        shown.units?.unit2?.bio?.quantity, { mode: 'manual_final' });
    }
    if (!adjusted?.ok) fail(adjusted?.message || '혼소 조정값을 확인하지 못했습니다. 다시 계산해 주세요.');
    result = adjusted.result;
  }

  const same = (actual, expected) => expected === null ? actual === null :
    finite(actual) && finite(expected) && Math.abs(actual - expected) <= 0.000001 + Number.EPSILON * Math.max(1, Math.abs(expected)) * 16;
  for (const key of ['startLocal', 'endLocal', 'stepUnit', 'stepValue']) {
    if (shown.period?.[key] !== spec[key]) fail('표시된 계산 결과와 마감 기간이 다릅니다. 다시 계산해 주세요.');
  }
  for (const unit of UNITS) {
    for (const fuel of FUELS) {
      if (!same(shown.units?.[unit]?.[fuel]?.quantity, result.units[unit][fuel].quantity)) {
        fail('표시된 연료 사용량과 서버 재계산값이 다릅니다. 입력값을 확인하고 다시 계산해 주세요.');
      }
    }
    for (const fuel of [...FUELS, 'total']) {
      if (!same(shown.units?.[unit]?.heats?.[fuel], result.units[unit].heats[fuel])) {
        fail('표시된 열량과 서버 재계산값이 다릅니다. 다시 계산해 주세요.');
      }
    }
    for (const key of ['bio', 'organic', 'total']) {
      if (!same(shown.units?.[unit]?.ratios?.[key], result.units[unit].ratios[key])) {
        fail('표시된 혼소율과 서버 재계산값이 다릅니다. 다시 계산해 주세요.');
      }
    }
    for (const key of ['bio', 'organic', 'manure', 'organicGroup', 'total']) {
      if (!same(shown.units?.[unit]?.fuelRatios?.[key], result.units[unit].fuelRatios[key])) {
        fail('표시된 혼소율과 서버 재계산값이 다릅니다. 다시 계산해 주세요.');
      }
    }
  }
  for (const fuel of [...FUELS, 'total']) {
    if (!same(shown.combined?.heats?.[fuel], result.combined.heats[fuel])) fail('종합 열량을 다시 계산해 주세요.');
  }
  for (const key of ['bio', 'organic', 'manure', 'organicGroup', 'total']) {
    if (!same(shown.combined?.fuelRatios?.[key], result.combined.fuelRatios[key])) {
      fail('종합 혼소율과 서버 재계산값이 다릅니다. 다시 계산해 주세요.');
    }
  }
  // Summaries, heats, counters, warnings and capture metadata are server-derived.
  // Client-provided summary fields are never used as stored calculation results.
  const summary = core.summaryFromResult(result);
  return { summary, snapshot: {
    schemaVersion: 1, validationVersion: 5, saveId: crypto.randomUUID(),
    targetDate: body.targetDate, period: spec, sourceRequestId: body.sourceRequestId,
    settings, manual, organicUsage, manualBlankPolicy: inputMode==='manual'?'organic-explicit-manure-blank-zero':'organic-inventory-required-manure-blank-zero',
    result, summary, capturedAt: new Date(now).toISOString()
  } };
}
