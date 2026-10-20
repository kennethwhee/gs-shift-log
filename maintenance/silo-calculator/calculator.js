(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiloCalculator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Calculation basis: corrected SILO workbooks, 2026-10-20.
  // Values are a geometric/section-capacity conversion, not a live sensor feed.
  var VERSION = '5.0.0-20261020';
  function input(key, label, unit, defaultValue, options) {
    return Object.assign({ key: key, label: label, unit: unit, defaultValue: defaultValue,
      step: 'any', required: true }, options || {});
  }
  var density = function (value) {
    return input('density', '벌크밀도', 't/m³', value, { min: 0, minExclusive: true });
  };
  var mmInputs = function (value) {
    return [input('sounding', '측정 Sounding', 'mm', '', { min: 0 }), density(value),
      input('offset', '센서높이차', 'mm', 0, {
        help: '센서 기준점이 도면 지붕 기준면보다 높으면 +. 도면 기준 Sounding = 측정값 − 센서높이차.'
      })];
  };
  var datumWarning = '센서높이차 0은 센서와 도면 지붕 기준면의 높이가 같다는 가정입니다.';
  var MODELS = [
    {
      id: 'limestone', name: 'Limestone Silo', label: '석회석 SILO', kind: 'inventory',
      description: '도면 구간용량 기준으로 총재고와 유효재고를 환산합니다.',
      basis: '원통 403 m³ + 하부 60.9 m³. 수평 재료면 가정.',
      range: { min: 2654, max: 19655, unit: 'mm', basis: '도면 기준 Sounding' },
      inputs: mmInputs(1.12), example: { sounding: 9980, density: 1.12, offset: 0 },
      warnings: [datumWarning, '유효재고는 총재고에서 하부 V4+V5 6.6 m³의 중량을 제외한 값입니다.'],
      source: 'Limestone Silo 재고.xlsx / Sheet2 및 상세 삽입 도면',
      geometry: { top: 2654, bottom: 19655, cylinderVolume: 403, hopperVolume: 60.9, excludedVolume: 6.6 }
    },
    {
      id: 'coal-day', name: 'Coal Day Silo', label: 'Coal Day SILO', kind: 'inventory', provisional: true,
      description: '원도면 확인 전 기존 구간용적으로 계산하는 잠정 환산값입니다.',
      basis: '기존 원통 336.4 m³ + 하부 102 m³. 수평 재료면 가정.',
      range: { min: 1628, max: 11300, unit: 'mm', basis: '도면 기준 Sounding' },
      inputs: mmInputs(0.8), example: { sounding: 9980, density: 0.8, offset: 0 },
      warnings: ['잠정 환산값: 원도면이 없고, 원통 치수로 계산한 320.95 m³와 기존 용적 336.4 m³가 다릅니다.', datumWarning],
      source: 'SILO 현재고량.xlsx / Coal Day Silo (원도면 미첨부)',
      geometry: { top: 1628, bottom: 11300, cylinderVolume: 336.4, hopperVolume: 102 }
    },
    {
      id: 'bio-day', name: 'Bio Day Silo', label: 'Bio Day SILO', kind: 'inventory', drawingBased: true,
      description: '제작도면의 명목 내경과 높이로 원통 구간의 재고를 계산합니다.',
      basis: '내경 8 m · 원통 11.65 m · 지붕 높이 0.4 m. 중앙 평탄 지붕 높이 = Sounding 0 mm, 바닥판 상면 = 12,050 mm. 수평 재료면 가정.',
      range: { min: 400, max: 12050, unit: 'mm', basis: '도면 기준 Sounding (원통 구간)' },
      inputs: [input('sounding', '도면 기준 Sounding', 'mm', '', { min: 0,
        help: '도면의 중앙 평탄 지붕 높이에서 재료면까지 아래로 잰 거리입니다.' }),
        input('density', '벌크밀도', 't/m³', 0.22, { min: 0, minExclusive: true,
          help: '도면의 설계 밀도는 0.22 t/m³입니다. 변경하면 입력한 밀도로 환산합니다.' })],
      example: { sounding: 10500, density: 0.22 },
      warnings: ['명목 내경을 사용하는 기하 계산입니다. 라이너·배출기 등 내부 구조물의 치환체적은 공제하지 않습니다.',
        '0 이상 400 mm 미만은 중앙 평탄부가 있는 경사지붕 구간으로, 이 원통 계산의 범위에 포함하지 않습니다.',
        'Gross 589.1 m³와 Net 419.5 m³는 도면의 참고 용량(Estimated)입니다. 높이별 재고를 임의 비례 보정하는 데 사용하지 않습니다.'],
      source: 'GSPC-004-EB-TSS-M-511 Rev.F / PDF 2쪽(도면 1/30), 지붕 상세 PDF 8–10쪽',
      references: { grossVolumeM3: 589.1, netVolumeM3: 419.5, designDensity: 0.22, operatingMassTon: 92.3 },
      geometry: { top: 400, bottom: 12050, radius: 4 }
    },
    {
      id: 'fly-ash', name: 'Fly Ash Silo', label: 'Fly Ash SILO', kind: 'inventory',
      description: '기존 원통 구간용량을 기준으로 재고를 환산합니다.',
      basis: '원통 1,945.67 m³ + 하부 36 m³. 수평 재료면 가정.',
      range: { min: 600, max: 15240, unit: 'mm', basis: '도면 기준 Sounding' },
      inputs: mmInputs(0.65), example: { sounding: 850, density: 0.65, offset: 0 },
      warnings: ['밀도 기본값 0.65와 도면 메모 0.8 t/m³가 다릅니다. 현장 보정 밀도를 확인하세요.',
        '지붕·호퍼의 표기 용적과 치수가 맞지 않아 원통부 밖에서는 계산하지 않습니다.', datumWarning],
      source: 'Fly Ash Silo.JPG / SILO 현재고량.xlsx의 구간용적',
      geometry: { top: 600, bottom: 15240, cylinderVolume: 1945.67, hopperVolume: 36, grossVolume: 2000 }
    },
    {
      id: 'sludge', name: '유기성 고형연료 Day Silo', label: '유기성 고형연료 Day Silo', kind: 'inventory',
      description: '원통과 하부 원뿔을 나누어 공실까지 계산합니다.',
      basis: '원통 + 끝이 뾰족한 원뿔이라는 원자료 형상 가정. Sounding과 모든 길이는 mm로 입력합니다.',
      inputs: [input('sounding', '측정 Sounding', 'mm', '', { min: 0 }), density(0.8),
        input('radius', '반지름', 'mm', 1450, { min: 0, minExclusive: true }),
        input('cylinderHeight', '원통 높이', 'mm', 8300, { min: 0, minExclusive: true }),
        input('coneHeight', '원뿔 높이', 'mm', 1928, { min: 0, minExclusive: true }),
        input('hours', '평균 환산 기준시간', 'h', 4, { min: 0, minExclusive: true })],
      example: { sounding: 7700, density: 0.8, radius: 1450, cylinderHeight: 8300, coneHeight: 1928, hours: 4 },
      warnings: ['Sounding은 상부 기준면부터 아래로 잰 거리(mm)입니다. 실제 계측 영점·유효 내경을 확인하세요.',
        '시간당 평균 환산은 현재 재고를 기준시간에 모두 사용한다는 가정이며 실제 사용량 측정값이 아닙니다.'],
      source: '하수슬러지 Silo 재고 계산.xlsx의 수정 계산'
    },
    {
      id: 'bio-storage', name: 'Bio Storage Silo', label: 'Bio Storage Silo', kind: 'inventory',
      description: '측정 Sounding과 실제 기준점 높이로 안식각을 고려한 Net 재고를 계산합니다.',
      basis: '반지름 8,000 mm · Chute 높이 20,895 mm · 저레벨 610 mm. LT는 벽에서 3,400 mm 위치라는 원자료 가정입니다.',
      inputs: [input('sounding', '측정 Sounding', 'mm', '', { min: 0,
        help: '센서의 Sounding 시작점에서 LT 위치 재료면까지 아래로 잰 거리입니다.' }),
        input('referenceHeight', 'Sounding 기준점 높이', 'mm', '', { min: 0, minExclusive: true,
          help: 'SILO 바닥에서 센서의 Sounding 시작점까지 높이. 실제 설치값을 입력하세요.' }),
        input('angle', '안식각', '°', 45, { min: 0, max: 90, minExclusive: true, maxExclusive: true }), density(0.22)],
      example: { sounding: 6100, referenceHeight: 20895, angle: 45, density: 0.22 },
      warnings: ['기준점 높이는 실제 센서 설치값을 입력해야 합니다. 예시 20,895 mm는 Chute 높이를 사용한 계산 예일 뿐 실제 센서 높이가 아닙니다.',
        '원자료의 중앙 원뿔형 재료면과 LT 위치를 가정한 환산 재고입니다. 실제 재료면 형상에 따라 달라집니다.',
        'Net는 저레벨 610 mm 아래 잔량을 제외합니다. 전체 물리적 재고와 다릅니다.',
        '벽면 재료 높이가 저레벨보다 낮거나 내부 구조물이 완전히 덮이지 않는 구간은 계산하지 않습니다. 계산 하한을 공실로 보지 않습니다.',
        '점검창 여유는 원자료의 약 4,700 mm 기준 근사값입니다.'],
      source: 'Bio Storage Silo 적재량 검토 / 수정 계산 및 Calculation Sheet(Bio Storage).pdf'
    },
    {
      id: 'fly-ash-2', name: 'Fly Ash Silo (2)', label: '설비 미확인 시트', kind: 'unverified',
      description: '원자료의 설비명·치수·구간용적이 섞여 있어 계산을 보류합니다.',
      basis: '실제 설비명과 원도면을 확보한 뒤 계산 모델을 확정해야 합니다.',
      inputs: [], example: {},
      warnings: ['기존 음수 재고 및 mm/m³ 혼합 계산은 사용하지 않습니다.'],
      source: 'SILO 현재고량.xlsx / Fly Ash Silo (2)'
    }
  ];

  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.getOwnPropertyNames(value).forEach(function (key) { deepFreeze(value[key]); });
      Object.freeze(value);
    }
    return value;
  }
  deepFreeze(MODELS);
  function getModel(id) {
    if (id === 'unresolved') id = 'fly-ash-2';
    return MODELS.find(function (model) { return model.id === id; }) || null;
  }
  function getDefaults(id) {
    var model = getModel(id), values = {};
    if (model) model.inputs.forEach(function (field) { values[field.key] = field.defaultValue; });
    return values;
  }
  function parseNumber(raw) {
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
      return { status: 'missing' };
    }
    if (typeof raw !== 'number' && typeof raw !== 'string') return { status: 'invalid' };
    if (typeof raw === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw.trim())) {
      return { status: 'invalid' };
    }
    var number = Number(raw);
    return Number.isFinite(number) ? { status: 'ok', value: number } : { status: 'invalid' };
  }
  function result(model, status, message, additional) {
    return Object.assign({ modelId: model ? model.id : null, status: status, message: message,
      provisional: !!(model && model.provisional), drawingBased: !!(model && model.drawingBased),
      warnings: model ? model.warnings.slice() : [] }, additional || {});
  }
  function validateFields(model, supplied) {
    var values = {}, errors = [], own = Object.prototype.hasOwnProperty;
    model.inputs.forEach(function (field) {
      var raw = own.call(supplied, field.key) ? supplied[field.key] : field.defaultValue;
      var parsed = parseNumber(raw);
      if (parsed.status !== 'ok') {
        errors.push({ key: field.key, label: field.label, status: parsed.status,
          message: field.label + (parsed.status === 'missing' ? ' 입력이 필요합니다.' : '에 유효한 숫자를 입력하세요.') });
        return;
      }
      var n = parsed.value;
      if ((field.min !== undefined && (field.minExclusive ? n <= field.min : n < field.min)) ||
          (field.max !== undefined && (field.maxExclusive ? n >= field.max : n > field.max))) {
        errors.push({ key: field.key, label: field.label, status: 'invalid', message: field.label + '의 입력 범위를 확인하세요.' });
        return;
      }
      values[field.key] = n;
    });
    return { values: values, errors: errors };
  }
  function checkedSuccess(model, values) {
    // Even finite inputs may overflow when multiplied; never expose Infinity/NaN.
    var finite = Object.keys(values).every(function (key) {
      return typeof values[key] !== 'number' || Number.isFinite(values[key]);
    });
    if (!finite) return result(model, 'invalid', '계산 가능한 숫자 범위를 벗어났습니다. 입력값을 확인하세요.');
    return result(model, 'ok', model.drawingBased ? '도면의 명목 치수와 입력 밀도로 계산했습니다. 내부 구조물의 체적은 공제하지 않았습니다.'
      : model.provisional ? '잠정 환산값입니다. 원도면을 확인하세요.' : '입력한 기준으로 계산했습니다.', values);
  }

  function getBioStorageRange(referenceHeightMm, angleDeg) {
    var reference = parseNumber(referenceHeightMm), angle = parseNumber(angleDeg);
    if (reference.status !== 'ok' || angle.status !== 'ok' || reference.value <= 0 || angle.value <= 0 || angle.value >= 90) return null;
    var height = reference.value / 1000, tangent = Math.tan(angle.value * Math.PI / 180);
    // Apex <= Chute, wall <= cylinder roof, wall >= low level, and block fully buried.
    var min = Math.max(0, height - 20.895 + 4.6 * tangent, height - 17 - 3.4 * tangent) * 1000;
    var max = Math.min(height - 0.61 - 3.4 * tangent, height - 1.7 + 3.5 * tangent) * 1000;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return null;
    return { minSoundingMm: min, maxSoundingMm: max };
  }

  function calculate(id, supplied) {
    var model = getModel(id);
    if (!model) return result(null, 'invalid', '지원하지 않는 설비입니다.');
    if (model.kind === 'unverified') return result(model, 'unverified', '설비명과 원도면 확인 전에는 재고를 계산하지 않습니다.');
    if (supplied === undefined) supplied = {};
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
      return result(model, 'invalid', '입력값 형식을 확인하세요.');
    }
    // Reject a stale V1 non-zero sensor correction: BIO V2 accepts drawing distances only.
    if (model.drawingBased && Object.prototype.hasOwnProperty.call(supplied, 'offset')) {
      var legacyOffset = parseNumber(supplied.offset);
      if (legacyOffset.status !== 'ok' || legacyOffset.value !== 0) {
        return result(model, 'invalid', 'BIO는 도면 기준 Sounding을 직접 입력합니다. 이전 센서높이차 입력을 제거하세요.');
      }
    }
    var validated = validateFields(model, supplied);
    if (validated.errors.length) {
      var invalid = validated.errors.some(function (error) { return error.status === 'invalid'; });
      return result(model, invalid ? 'invalid' : 'missing', validated.errors.map(function (error) { return error.message; }).join(' '),
        { errors: validated.errors });
    }
    var p = validated.values;
    if (model.geometry) {
      var geometry = model.geometry;
      var d = model.drawingBased ? p.sounding : p.sounding - p.offset;
      if (!Number.isFinite(d)) return result(model, 'invalid', '측정값과 센서높이차의 범위를 확인하세요.');
      if (d < geometry.top || d > geometry.bottom) {
        var rangeMessage = model.drawingBased
          ? (d < geometry.top ? '지붕 구간은 원통 재고 계산 범위에 포함하지 않습니다.' : '도면의 바닥판 상면 기준 12,050 mm를 벗어났습니다.')
          : (d < geometry.top ? '상부 형상 확인이 필요한 구간입니다.' : '하부 형상 또는 측정값 확인이 필요한 구간입니다.');
        return result(model, 'unsupported', rangeMessage,
          { effectiveSounding: d, soundingUnit: 'mm', supportedMin: geometry.top, supportedMax: geometry.bottom });
      }
      var cylinderVolume = model.id === 'bio-day'
        ? Math.PI * geometry.radius * geometry.radius * (geometry.bottom - d) / 1000
        : geometry.cylinderVolume * (geometry.bottom - d) / (geometry.bottom - geometry.top);
      var hopperVolume = geometry.hopperVolume || 0;
      var volume = cylinderVolume + hopperVolume;
      var answer = { primaryLabel: model.drawingBased ? '도면 기준 재고' : model.provisional ? '총 재고 (잠정)' : '총 재고', massTon: volume * p.density,
        volumeM3: volume, cylinderVolumeM3: cylinderVolume, hopperVolumeM3: hopperVolume,
        effectiveSounding: d, soundingUnit: 'mm', supportedMin: geometry.top, supportedMax: geometry.bottom,
        remainingCylinderHeightM: (geometry.bottom - d) / 1000,
        cylinderFillRatio: (geometry.bottom - d) / (geometry.bottom - geometry.top), density: p.density };
      if (geometry.excludedVolume !== undefined) {
        answer.usableTon = (volume - geometry.excludedVolume) * p.density;
        answer.excludedMassTon = geometry.excludedVolume * p.density;
      }
      if (geometry.grossVolume !== undefined) {
        answer.referenceGrossMassTon = geometry.grossVolume * p.density;
        answer.emptyCapacityMassTon = (geometry.grossVolume - volume) * p.density;
      }
      return checkedSuccess(model, answer);
    }
    if (model.id === 'sludge') {
      // V5 accepts every length in mm; geometry and volumes are calculated in metres.
      var totalHeightMm = p.cylinderHeight + p.coneHeight;
      if (!Number.isFinite(totalHeightMm)) return result(model, 'invalid', '설비 높이의 숫자 범위를 확인하세요.');
      var emptySoundingMm = Math.round(totalHeightMm * 1e6) / 1e6;
      if (!Number.isFinite(emptySoundingMm)) return result(model, 'invalid', '설비 높이의 숫자 범위를 확인하세요.');
      if (p.sounding > emptySoundingMm) return result(model, 'unsupported', '공실 기준보다 큰 Sounding입니다. 측정값 또는 설비 높이를 확인하세요.',
        { effectiveSounding: p.sounding, supportedMin: 0, supportedMax: emptySoundingMm, soundingUnit: 'mm' });
      var soundingM = p.sounding / 1000;
      var cylinderHeightM = p.cylinderHeight / 1000;
      var coneHeightM = p.coneHeight / 1000;
      var radiusM = p.radius / 1000;
      var emptySoundingM = emptySoundingMm / 1000;
      var cylinderHeight = p.sounding <= p.cylinderHeight ? cylinderHeightM - soundingM : 0;
      var coneHeight = p.sounding <= p.cylinderHeight ? coneHeightM : emptySoundingM - soundingM;
      var area = Math.PI * radiusM * radiusM;
      var cylinder = area * cylinderHeight;
      var cone = area * coneHeight * coneHeight * coneHeight / (3 * coneHeightM * coneHeightM);
      var fullVolume = area * (cylinderHeightM + coneHeightM / 3);
      var sludgeVolume = cylinder + cone;
      return checkedSuccess(model, { primaryLabel: '총 재고', volumeM3: sludgeVolume, massTon: sludgeVolume * p.density,
        cylinderVolumeM3: cylinder, coneVolumeM3: cone, remainingCylinderHeightM: cylinderHeight,
        remainingConeHeightM: coneHeight, emptySoundingM: emptySoundingM, emptySoundingMm: emptySoundingMm,
        fullVolumeM3: fullVolume, volumeFillRatio: sludgeVolume / fullVolume,
        rateTonPerHour: sludgeVolume * p.density / p.hours, hours: p.hours,
        effectiveSounding: p.sounding, soundingUnit: 'mm', supportedMin: 0, supportedMax: emptySoundingMm, density: p.density });
    }
    if (model.id === 'bio-storage') {
      var tangent = Math.tan(p.angle * Math.PI / 180);
      var referenceHeight = p.referenceHeight / 1000;
      var level = referenceHeight - p.sounding / 1000;
      var apexHeight = level + 4.6 * tangent;
      var baseHeight = apexHeight - 8 * tangent;
      var blockSurfaceHeight = apexHeight - 1.1 * tangent;
      var range = getBioStorageRange(p.referenceHeight, p.angle);
      var rangeFields = { effectiveSounding: p.sounding, soundingUnit: 'mm', referenceHeightM: referenceHeight };
      if (range) Object.assign(rangeFields, range, { supportedMin: range.minSoundingMm, supportedMax: range.maxSoundingMm });
      // Preserve the validated original full-footprint cone and fully buried block model.
      // A 1e-9 m tolerance admits decimal boundary values despite binary round-off.
      var tolerance = 1e-9;
      if (!range || baseHeight < 0.61 - tolerance || baseHeight > 17 + tolerance ||
          blockSurfaceHeight < 1.7 - tolerance || apexHeight > 20.895 + tolerance) {
        return result(model, 'unsupported', '현재 Sounding은 원자료 형상으로 계산 가능한 범위를 벗어납니다. 기준점 높이·안식각을 확인하세요. 저레벨 이하 구간은 공실로 환산하지 않습니다.', rangeFields);
      }
      var cylinderNetHeight = Math.max(0, baseHeight - 0.61);
      var clearance = Math.max(0, 20.895 - apexHeight);
      var coneVolume = Math.PI * 8 * 8 * (8 * tangent) / 3;
      var cylinderNetVolume = Math.PI * 8 * 8 * cylinderNetHeight;
      var excludedBlockVolume = Math.PI * 1.1 * 1.1 * 1.09;
      var netVolume = coneVolume + cylinderNetVolume - excludedBlockVolume;
      var residualVolume = Math.PI * (8 * 8 - 1.1 * 1.1) * 0.61;
      return checkedSuccess(model, Object.assign(rangeFields, { primaryLabel: 'Net 재고', massTon: netVolume * p.density,
        netMassTon: netVolume * p.density, volumeM3: netVolume, netVolumeM3: netVolume,
        levelM: level, hatchClearanceM: 4.7 + clearance + 8 * (tangent - 1),
        apexHeightM: apexHeight, wallLevelM: baseHeight, clearanceM: clearance, angleDeg: p.angle,
        coneVolumeM3: coneVolume, cylinderVolumeM3: cylinderNetVolume,
        excludedStructureVolumeM3: excludedBlockVolume,
        residualVolumeM3: residualVolume, residualMassTon: residualVolume * p.density,
        estimatedPhysicalMassTon: (netVolume + residualVolume) * p.density, density: p.density }));
    }
    return result(model, 'unverified', '계산 모델 확인이 필요합니다.');
  }
  return Object.freeze({ VERSION: VERSION, MODELS: MODELS, getModel: getModel, getDefaults: getDefaults,
    parseNumber: parseNumber, getBioStorageRange: getBioStorageRange, calculate: calculate });
});
