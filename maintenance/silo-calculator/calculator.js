(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiloCalculator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Calculation basis: corrected SILO workbooks, 2026-10-20.
  // Values are a geometric/section-capacity conversion, not a live sensor feed.
  var VERSION = '1.0.0-20261020';
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
      id: 'bio-day', name: 'Bio Day Silo', label: 'Bio Day SILO', kind: 'inventory',
      description: '원통부의 남은 높이에서 재고를 계산합니다.',
      basis: '지름 8 m · 원통 11.65 m · 지붕 높이 0.4 m. 수평 재료면 가정.',
      range: { min: 400, max: 12050, unit: 'mm', basis: '지붕 꼭대기 기준 Sounding' },
      inputs: mmInputs(0.22), example: { sounding: 9980, density: 0.22, offset: 0 },
      warnings: [datumWarning, '상부 지붕 구간은 형상이 확정되지 않아 계산하지 않습니다. 12,050 mm에서 모델상 재고는 0 t입니다.'],
      source: 'Bio Day Silo.JPG / SILO 현재고량.xlsx의 수정 계산',
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
      id: 'sludge', name: 'Sludge Silo', label: '하수슬러지 SILO', kind: 'inventory',
      description: '원통과 하부 원뿔을 나누어 공실까지 계산합니다.',
      basis: '원통 + 끝이 뾰족한 원뿔이라는 원자료 형상 가정. Sounding 단위는 m입니다.',
      inputs: [input('sounding', '측정 Sounding', 'm', '', { min: 0 }), density(0.8),
        input('radius', '반지름', 'm', 1.45, { min: 0, minExclusive: true }),
        input('cylinderHeight', '원통 높이', 'm', 8.3, { min: 0, minExclusive: true }),
        input('coneHeight', '원뿔 높이', 'm', 1.928, { min: 0, minExclusive: true }),
        input('hours', '평균 환산 기준시간', 'h', 4, { min: 0, minExclusive: true })],
      example: { sounding: 7.7, density: 0.8, radius: 1.45, cylinderHeight: 8.3, coneHeight: 1.928, hours: 4 },
      warnings: ['Sounding은 상부 기준면부터 아래로 잰 거리(m)입니다. 실제 계측 영점·유효 내경을 확인하세요.',
        '시간당 평균 환산은 현재 재고를 기준시간에 모두 사용한다는 가정이며 실제 사용량 측정값이 아닙니다.'],
      source: '하수슬러지 Silo 재고 계산.xlsx의 수정 계산'
    },
    {
      id: 'bio-storage', name: 'Bio Storage Silo', label: 'Bio Storage SILO', kind: 'capacity',
      description: '안식각·Chute 여유에 따른 Net 만적재량과 예상 LT Level을 계산합니다.',
      basis: '반지름 8 m, Chute 높이 20.895 m, 저레벨 0.61 m. LT는 벽에서 3.4 m 위치 가정.',
      inputs: [input('angle', '안식각', '°', 45, { min: 0, max: 90, minExclusive: true, maxExclusive: true }),
        input('clearance', 'Chute까지 여유', 'm', 1.5, { min: 0 }), density(0.22)],
      example: { angle: 45, clearance: 1.5, density: 0.22 },
      warnings: ['현재 측정 재고가 아니라, 지정 조건의 Net 만적재량을 계산합니다.',
        'Net는 저레벨 0.61 m 아래 잔량을 제외합니다. 전체 물리적 재고와 다릅니다.',
        'LT 위치와 안식각은 원자료 가정입니다. 점검창 여유는 원자료의 약 4.7 m 기준 근사값입니다.'],
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
      provisional: !!(model && model.provisional), warnings: model ? model.warnings.slice() : [] }, additional || {});
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
    return result(model, 'ok', model.provisional ? '잠정 환산값입니다. 원도면을 확인하세요.' : '입력한 기준으로 계산했습니다.', values);
  }

  function calculate(id, supplied) {
    var model = getModel(id);
    if (!model) return result(null, 'invalid', '지원하지 않는 설비입니다.');
    if (model.kind === 'unverified') return result(model, 'unverified', '설비명과 원도면 확인 전에는 재고를 계산하지 않습니다.');
    if (supplied === undefined) supplied = {};
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)) {
      return result(model, 'invalid', '입력값 형식을 확인하세요.');
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
      var d = p.sounding - p.offset;
      if (!Number.isFinite(d)) return result(model, 'invalid', '측정값과 센서높이차의 범위를 확인하세요.');
      if (d < geometry.top || d > geometry.bottom) {
        return result(model, 'unsupported', d < geometry.top ? '상부 형상 확인이 필요한 구간입니다.' : '하부 형상 또는 측정값 확인이 필요한 구간입니다.',
          { effectiveSounding: d, soundingUnit: 'mm', supportedMin: geometry.top, supportedMax: geometry.bottom });
      }
      var cylinderVolume = model.id === 'bio-day'
        ? Math.PI * geometry.radius * geometry.radius * (geometry.bottom - d) / 1000
        : geometry.cylinderVolume * (geometry.bottom - d) / (geometry.bottom - geometry.top);
      var hopperVolume = geometry.hopperVolume || 0;
      var volume = cylinderVolume + hopperVolume;
      var answer = { primaryLabel: model.provisional ? '총 재고 (잠정)' : '총 재고', massTon: volume * p.density,
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
      var totalHeight = p.cylinderHeight + p.coneHeight;
      if (!Number.isFinite(totalHeight)) return result(model, 'invalid', '설비 높이의 숫자 범위를 확인하세요.');
      // Rounding only removes binary summation noise (8.3 + 1.928); no out-of-range clamping.
      var emptySounding = Math.round(totalHeight * 1e9) / 1e9;
      if (!Number.isFinite(emptySounding)) return result(model, 'invalid', '설비 높이의 숫자 범위를 확인하세요.');
      if (p.sounding > emptySounding) return result(model, 'unsupported', '공실 기준보다 큰 Sounding입니다. 측정값 또는 설비 높이를 확인하세요.',
        { supportedMin: 0, supportedMax: emptySounding, soundingUnit: 'm' });
      var cylinderHeight = p.sounding <= p.cylinderHeight ? p.cylinderHeight - p.sounding : 0;
      var coneHeight = p.sounding <= p.cylinderHeight ? p.coneHeight : emptySounding - p.sounding;
      var area = Math.PI * p.radius * p.radius;
      var cylinder = area * cylinderHeight;
      var cone = area * coneHeight * coneHeight * coneHeight / (3 * p.coneHeight * p.coneHeight);
      var fullVolume = area * (p.cylinderHeight + p.coneHeight / 3);
      var sludgeVolume = cylinder + cone;
      return checkedSuccess(model, { primaryLabel: '총 재고', volumeM3: sludgeVolume, massTon: sludgeVolume * p.density,
        cylinderVolumeM3: cylinder, coneVolumeM3: cone, remainingCylinderHeightM: cylinderHeight,
        remainingConeHeightM: coneHeight, emptySoundingM: emptySounding,
        fullVolumeM3: fullVolume, volumeFillRatio: sludgeVolume / fullVolume,
        rateTonPerHour: sludgeVolume * p.density / p.hours, hours: p.hours,
        effectiveSounding: p.sounding, soundingUnit: 'm', density: p.density });
    }
    if (model.id === 'bio-storage') {
      var tangent = Math.tan(p.angle * Math.PI / 180);
      var baseHeight = 20.895 - p.clearance - 8 * tangent;
      var cylinderNetHeight = baseHeight - 0.61;
      var blockSurfaceHeight = 20.895 - p.clearance - 1.1 * tangent;
      if (cylinderNetHeight < 0 || baseHeight > 17 || blockSurfaceHeight < 1.7) {
        return result(model, 'unsupported', '현재 조건은 원통부·지붕·내부 구조물의 계산 범위를 벗어납니다. 안식각과 Chute 여유를 확인하세요.');
      }
      var coneVolume = Math.PI * 8 * 8 * (8 * tangent) / 3;
      var cylinderNetVolume = Math.PI * 8 * 8 * cylinderNetHeight;
      var excludedBlockVolume = Math.PI * 1.1 * 1.1 * 1.09;
      var netVolume = coneVolume + cylinderNetVolume - excludedBlockVolume;
      var residualVolume = Math.PI * (8 * 8 - 1.1 * 1.1) * 0.61;
      return checkedSuccess(model, { primaryLabel: 'Net 만적재량', massTon: netVolume * p.density,
        netMassTon: netVolume * p.density, volumeM3: netVolume, netVolumeM3: netVolume,
        levelM: 20.895 - p.clearance - 4.6 * tangent,
        hatchClearanceM: 4.7 + p.clearance + 8 * (tangent - 1),
        apexHeightM: 20.895 - p.clearance, wallLevelM: baseHeight,
        clearanceM: p.clearance, angleDeg: p.angle,
        coneVolumeM3: coneVolume, cylinderVolumeM3: cylinderNetVolume,
        excludedStructureVolumeM3: excludedBlockVolume,
        residualVolumeM3: residualVolume, residualMassTon: residualVolume * p.density,
        estimatedPhysicalMassTon: (netVolume + residualVolume) * p.density, density: p.density });
    }
    return result(model, 'unverified', '계산 모델 확인이 필요합니다.');
  }
  return Object.freeze({ VERSION: VERSION, MODELS: MODELS, getModel: getModel, getDefaults: getDefaults,
    parseNumber: parseNumber, calculate: calculate });
});
