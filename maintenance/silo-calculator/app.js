(function () {
  'use strict';

  var engine = window.SiloCalculator;
  function byId(id) { return document.getElementById(id); }
  if (!engine || !Array.isArray(engine.MODELS)) {
    byId('fatalMessage').textContent = '계산 모듈을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 확인하세요.';
    byId('fatalMessage').hidden = false;
    return;
  }

  var select = byId('modelSelect');
  var form = byId('calculatorForm');
  var fields = byId('inputFields');
  var selectedModel;
  var controls = {};
  var touched = {};
  var submitted = false;
  var usingExample = false;
  var numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });
  var massFormat = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  var formulas = {
    limestone: 'd = 측정 Sounding − 센서높이차 (mm)\nV = 60.9 + 403 × (19,655 − d) ÷ 17,001 (m³)\n총재고 = V × 벌크밀도 (t)\n유효재고 = (V − 6.6) × 벌크밀도 (t)',
    'coal-day': 'd = 측정 Sounding − 센서높이차 (mm)\nV = 102 + 336.4 × (11,300 − d) ÷ 9,672 (m³)\n잠정 총재고 = V × 벌크밀도 (t)',
    'bio-day': 'd = 중앙 평탄 지붕 기준면(0 mm)에서 아래로 잰 Sounding\n바닥판 상면 = 12,050 mm, 원통 공칭 내경 = 8 m\nV = π × 4² × (12,050 − d) ÷ 1,000 (m³)\n도면 기준 재고 = V × 벌크밀도 (t)\n수평 재료면을 가정하며, 400 ≤ d ≤ 12,050 mm에 적용합니다.\n상부 경사 지붕 구간(d < 400 mm)은 이 계산의 산정 범위 밖입니다.',
    'fly-ash': 'd = 측정 Sounding − 센서높이차 (mm)\nV = 36 + 1,945.67 × (15,240 − d) ÷ 14,640 (m³)\n총재고 = V × 벌크밀도 (t)\n빈 용량 환산 = (2,000 − V) × 벌크밀도 (t)\n2,000 m³는 원자료의 총 용량 참고값입니다.',
    sludge: 'd = 측정 Sounding (m), r = 반지름\nHc = 원통 높이, Hk = 원뿔 높이\n원통 구간 (0 ≤ d ≤ Hc):\n  V = πr²(Hc − d) + πr²Hk ÷ 3\n원뿔 구간 (Hc < d ≤ Hc + Hk):\n  h = Hc + Hk − d\n  V = πr²h³ ÷ (3Hk²)\n총재고 = V × 벌크밀도 (t)\n시간당 평균 환산 = 총재고 ÷ 기준시간 (t/h)',
    'bio-storage': 'T = tan(안식각), C = Chute 여유 (m)\nV원뿔 = π × 8² × (8T) ÷ 3\nV원통 = π × 8² × (20.895 − C − 0.61 − 8T)\nV구조물 = π × 1.1² × 1.09\nNet 만적재량 = (V원뿔 + V원통 − V구조물) × 벌크밀도\nLT Level = 20.895 − C − 4.6T (m)\n점검창 여유 ≈ 4.7 + C + 8(T − 1) (m)\n저레벨 아래 잔량 ≈ π × (8² − 1.1²) × 0.61 × 벌크밀도 (t)',
    'fly-ash-2': '계산 보류 · 설비명 및 원도면 확인이 필요합니다.'
  };

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function format(value) { return numberFormat.format(value); }
  function isFiniteNumber(value) { return typeof value === 'number' && Number.isFinite(value); }
  function readValues() {
    var values = {};
    Object.keys(controls).forEach(function (key) { values[key] = controls[key].value; });
    return values;
  }
  function updateRange(values) {
    if (selectedModel.range) {
      var range = selectedModel.range;
      byId('rangeNote').textContent = range.basis + ' ' + format(range.min) + '–' + format(range.max) + ' ' + range.unit + '에서 계산합니다.';
    } else if (selectedModel.id === 'sludge') {
      var cylinder = engine.parseNumber(values.cylinderHeight), cone = engine.parseNumber(values.coneHeight);
      var max = cylinder.status === 'ok' && cone.status === 'ok' ? cylinder.value + cone.value : NaN;
      byId('rangeNote').textContent = isFiniteNumber(max) && cylinder.value > 0 && cone.value > 0
        ? '측정 Sounding 0–' + format(max) + ' m. 0 m는 만재, ' + format(max) + ' m는 공실 기준입니다.'
        : '측정 단위는 m입니다. 원통 높이와 원뿔 높이를 입력하면 공실 기준을 표시합니다.';
    } else if (selectedModel.kind === 'capacity') {
      byId('rangeNote').textContent = '운전조건에 따른 만적재량 검토입니다. 현재 Sounding을 입력하는 화면이 아닙니다.';
    } else {
      byId('rangeNote').textContent = 'Fly Ash Silo (2) 원자료: 설비명·지름·높이·용적을 확인해야 합니다.';
    }
  }
  function addKey(label, value, unit, note) {
    if (!isFiniteNumber(value)) return;
    var card = element('div', 'key-result');
    card.appendChild(element('span', '', label));
    card.appendChild(element('strong', '', format(value) + ' ' + unit));
    if (note) card.appendChild(element('small', '', note));
    byId('keyResults').appendChild(card);
  }
  function addDetail(label, value, unit) {
    if (!isFiniteNumber(value)) return;
    var row = element('div', 'detail-row');
    row.appendChild(element('dt', '', label));
    row.appendChild(element('dd', '', format(value) + (unit ? ' ' + unit : '')));
    byId('resultDetails').appendChild(row);
  }
  function renderDrawingReferences() {
    var references = selectedModel.drawingBased && selectedModel.references;
    byId('drawingReference').hidden = !references;
    byId('drawingReferenceValues').replaceChildren();
    if (!references) return;
    [
      ['Gross (도면 표기)', references.grossVolumeM3, 'm³'],
      ['Net (도면 표기)', references.netVolumeM3, 'm³'],
      ['설계밀도', references.designDensity, 't/m³'],
      ['운전중량 (도면 표기)', references.operatingMassTon, 't']
    ].forEach(function (item) {
      if (!isFiniteNumber(item[1])) return;
      var cell = element('div', 'drawing-reference-cell');
      cell.appendChild(element('dt', '', item[0]));
      cell.appendChild(element('dd', '', format(item[1]) + ' ' + item[2]));
      byId('drawingReferenceValues').appendChild(cell);
    });
  }
  function renderSilo(result) {
    var model = selectedModel;
    // The picture uses the same successful result as the numbers. Invalid input
    // hides the whole picture, including its previous level and percentages.
    var show = result.status === 'ok' && model.kind === 'inventory';
    byId('siloVisual').hidden = !show;
    byId('siloFillPercent').textContent = '';
    byId('siloHeightValue').textContent = '';
    byId('siloDiagramDesc').textContent = '';
    byId('siloLevelBar').setAttribute('style', 'width:0%');
    if (!show) return;

    var bio = model.id === 'bio-day';
    var sludge = model.id === 'sludge';
    var geometry = model.geometry;
    var bodyTop = bio ? 62 : 67;
    var bodyBottom = bio ? 353.25 : 303;
    var bottom = bio ? bodyBottom : 353;
    var left = 115, right = 285, datum = bio ? 52 : 45;
    var surface, ratio, height, heightLabel, fillLabel;
    var hopper = !bio && !sludge;
    if (bio) {
      left = 100; right = 300;
      ratio = result.cylinderFillRatio;
      height = result.remainingCylinderHeightM;
      surface = bodyBottom - (bodyBottom - bodyTop) * ratio;
      heightLabel = '원통부 재료 높이';
      fillLabel = '원통 높이 대비';
    } else if (sludge) {
      var values = readValues();
      var cylinderHeight = Number(values.cylinderHeight), coneHeight = Number(values.coneHeight);
      var scale = Math.min(280 / result.emptySoundingM, 190 / (2 * Number(values.radius)));
      left = 200 - Number(values.radius) * scale; right = 400 - left;
      datum = bodyTop;
      bodyBottom = bodyTop + cylinderHeight * scale;
      bottom = bodyBottom + coneHeight * scale;
      height = result.remainingCylinderHeightM + result.remainingConeHeightM;
      ratio = height / result.emptySoundingM;
      surface = bottom - height * scale;
      heightLabel = '원통·원뿔 재료 높이';
      fillLabel = '전체 높이 대비';
    } else {
      ratio = result.cylinderFillRatio;
      height = result.remainingCylinderHeightM;
      surface = bodyBottom - (bodyBottom - bodyTop) * ratio;
      heightLabel = '원통부 재료 높이';
      fillLabel = '원통 높이 대비';
    }
    var roof = sludge ? 'M' + left + ' ' + bodyTop + 'H' + right
      : 'M' + left + ' ' + bodyTop + 'L180 ' + datum + 'H220L' + right + ' ' + bodyTop;
    var shape = roof + 'V' + bodyBottom + (sludge ? 'L200 ' + bottom
      : hopper ? 'L235 ' + bottom + 'H165' : 'H' + left) + 'L' + left + ' ' + bodyBottom + 'Z';
    ['siloClipShape', 'siloShell', 'siloOutline'].forEach(function (id) { byId(id).setAttribute('d', shape); });
    byId('siloShoulder').setAttribute('d', 'M' + left + ' ' + bodyTop + 'H' + right);
    byId('siloHopperTop').setAttribute('d', hopper || sludge ? 'M' + left + ' ' + bodyBottom + 'H' + right : '');
    var ticks = '';
    [0.25, 0.5, 0.75].forEach(function (fraction) {
      var y = bodyBottom - (bodyBottom - bodyTop) * fraction;
      ticks += 'M' + left + ' ' + y + 'h10M' + right + ' ' + y + 'h-10';
    });
    byId('siloTicks').setAttribute('d', ticks);
    var fillHeight = bottom - surface;
    ['siloFill', 'siloTexture'].forEach(function (id) {
      byId(id).setAttribute('y', surface);
      byId(id).setAttribute('height', fillHeight);
    });
    byId('siloMaterial').setAttribute('visibility', 'visible');
    byId('siloDatum').setAttribute('d', 'M80 ' + datum + 'H320');
    byId('siloDatumLabel').textContent = bio ? '중앙 평탄 지붕 기준 · 0 mm' : sludge ? 'Sounding 기준 · 0 m' : 'Sounding 기준 · 0 mm';
    byId('siloBottomLabel').setAttribute('y', bottom + 24);
    byId('siloBottomLabel').textContent = bio ? '바닥판 상면 · 12,050 mm' : sludge ? '공실 기준 · ' + format(result.emptySoundingM) + ' m' : '원통 하단 · ' + format(geometry.bottom) + ' mm';
    if (hopper) byId('siloBottomLabel').textContent = '하부 용적 · ' + format(result.hopperVolumeM3) + ' m³';
    byId('siloDistance').setAttribute('d', 'M84 ' + datum + 'h-12M78 ' + datum + 'V' + surface + 'M84 ' + surface + 'h-12');
    byId('siloDistanceLabel').setAttribute('transform', 'translate(61 ' + ((datum + surface) / 2) + ') rotate(-90)');
    byId('siloDistanceLabel').setAttribute('x', 0);
    byId('siloDistanceLabel').setAttribute('y', 0);
    byId('siloDistanceLabel').textContent = format(result.effectiveSounding) + ' ' + result.soundingUnit;
    byId('siloSurface').setAttribute('d', 'M' + left + ' ' + surface + 'H320');
    byId('siloSurfaceLabel').setAttribute('y', surface + 4);
    ['siloDistance', 'siloDistanceLabel', 'siloSurface', 'siloSurfaceLabel'].forEach(function (id) {
      byId(id).setAttribute('visibility', 'visible');
    });
    var percent = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(ratio * 100) + '%';
    byId('siloVisualKind').textContent = bio ? '도면 높이 기준' : '형상 개념도';
    byId('siloFillLabel').textContent = fillLabel;
    byId('siloFillPercent').textContent = percent;
    byId('siloLevelBar').setAttribute('style', 'width:' + Math.max(0, Math.min(100, ratio * 100)) + '%');
    byId('siloHeightLabel').textContent = heightLabel;
    byId('siloHeightValue').textContent = format(height) + ' m';
    byId('siloVisualNote').textContent = bio ? '재료 높이 ÷ 원통 높이 11.65 m' : sludge ? '재료 높이 ÷ 원통·원뿔 전체 높이' : '원통부 재료 높이 ÷ 원통 전체 높이';
    byId('siloVisualFootnote').textContent = bio
      ? '지붕 윤곽은 개념도입니다. 채움 높이는 도면 치수에 연동하며, 내부 구조물은 생략합니다.'
      : sludge ? '입력한 치수와 원통·원뿔 형상 가정을 반영합니다. 높이 비율과 용적 비율은 다릅니다.'
      : '형상은 축척 없는 개념도입니다. 지원 범위에서 하부는 채워진 것으로 계산하며, %는 원통부 높이 기준입니다.';
    byId('siloDiagramDesc').textContent = model.label + ', ' + fillLabel + ' ' + percent + ', ' + heightLabel + ' ' + format(height) + ' m, 도면 기준 Sounding ' + format(result.effectiveSounding) + ' ' + result.soundingUnit + ', ' + result.primaryLabel + ' ' + massFormat.format(result.massTon) + ' t.';
  }
  function renderResult(result) {
    var isOk = result.status === 'ok';
    var state = result.drawingBased && isOk ? 'drawing' : result.provisional && isOk ? 'provisional' : result.status;
    var labels = { ok: '계산 완료', drawing: '도면 기준 계산', provisional: '잠정 환산', missing: '입력 대기', invalid: '입력 확인', unsupported: '범위 밖', unverified: '계산 보류' };
    var titles = { missing: '입력값을 확인하세요', invalid: '입력을 다시 확인하세요', unsupported: '지원 범위를 벗어났습니다', unverified: '도면 확인 후 계산할 수 있습니다' };
    byId('resultStatus').textContent = labels[state] || '입력 확인';
    byId('resultStatus').className = 'status-pill is-' + state;
    byId('resultEmpty').hidden = isOk;
    byId('resultNumbers').hidden = !isOk;
    byId('emptyTitle').textContent = titles[result.status] || '측정값을 입력하세요';
    byId('resultMessage').textContent = result.message + (result.status === 'unsupported' && isFiniteNumber(result.effectiveSounding)
      ? ' 도면 기준 Sounding: ' + format(result.effectiveSounding) + ' ' + result.soundingUnit + '.' : '');
    byId('exampleNotice').hidden = !usingExample;
    // Clear previous numeric nodes on every edit, including missing/out-of-range inputs.
    byId('massValue').textContent = '';
    byId('primaryLabel').textContent = '';
    byId('keyResults').replaceChildren();
    byId('resultDetails').replaceChildren();
    renderSilo(result);
    if (!isOk) return;
    byId('primaryLabel').textContent = result.primaryLabel;
    byId('massValue').textContent = massFormat.format(result.massTon);
    if (selectedModel.id === 'limestone') addKey('유효재고', result.usableTon, 't', '하부 6.6 m³ 중량 제외');
    if (selectedModel.id === 'fly-ash') addKey('빈 용량 환산', result.emptyCapacityMassTon, 't', '총 용량 참고값 2,000 m³ 기준');
    if (selectedModel.id === 'sludge') addKey('시간당 평균 환산', result.rateTonPerHour, 't/h', format(result.hours) + '시간에 모두 사용하는 경우');
    if (selectedModel.id === 'bio-storage') {
      addKey('예상 LT Level', result.levelM, 'm', '원자료 LT 위치 기준');
      addKey('점검창 여유 (근사)', result.hatchClearanceM, 'm');
    }
    addDetail(selectedModel.drawingBased ? '도면 치수 환산 용적' : selectedModel.kind === 'capacity' ? 'Net 용적' : '재고 환산 용적', result.volumeM3, 'm³');
    addDetail('적용 벌크밀도', result.density, 't/m³');
    addDetail(selectedModel.id === 'sludge' ? '측정 Sounding' : '도면 기준 Sounding', result.effectiveSounding, result.soundingUnit);
    addDetail('원통부 남은 높이', result.remainingCylinderHeightM, 'm');
    if (selectedModel.id === 'sludge') {
      addDetail('원뿔부 남은 높이', result.remainingConeHeightM, 'm');
      addDetail('공실 Sounding 기준', result.emptySoundingM, 'm');
    }
    if (selectedModel.id === 'fly-ash') addDetail('총 용량 환산 (참고)', result.referenceGrossMassTon, 't');
    if (selectedModel.id === 'bio-storage') {
      addDetail('원통 벽면 Level', result.wallLevelM, 'm');
      addDetail('저레벨 아래 잔량 (근사)', result.residualMassTon, 't');
      addDetail('잔량 포함 물리적 재고 (근사)', result.estimatedPhysicalMassTon, 't');
    }
  }
  function recalculate() {
    var values = readValues();
    var result = engine.calculate(selectedModel.id, values);
    updateRange(values);
    Object.keys(controls).forEach(function (key) {
      var error = (result.errors || []).find(function (item) { return item.key === key; });
      var show = error && (touched[key] || submitted);
      controls[key].setAttribute('aria-invalid', show ? 'true' : 'false');
      byId('error-' + key).textContent = show ? error.message : '';
    });
    renderResult(result);
    return result;
  }
  function loadValues(values, example) {
    Object.keys(controls).forEach(function (key) { controls[key].value = values[key] === undefined ? '' : String(values[key]); });
    touched = {};
    submitted = false;
    usingExample = example;
    recalculate();
  }
  function chooseModel(id) {
    selectedModel = engine.getModel(id) || engine.MODELS[0];
    select.value = selectedModel.id;
    fields.replaceChildren();
    controls = {};
    byId('modelDescription').textContent = selectedModel.description;
    byId('modelKind').textContent = selectedModel.drawingBased ? '도면 치수 기준' : selectedModel.provisional ? '원도면 미확인 · 잠정 환산' : selectedModel.kind === 'capacity' ? '운전조건별 만적재량' : selectedModel.kind === 'unverified' ? '계산 보류' : '측정값 → 재고 환산';
    byId('modelKind').className = 'kind-badge' + (selectedModel.provisional ? ' is-provisional' : selectedModel.kind === 'unverified' ? ' is-unverified' : '');
    byId('formActions').hidden = selectedModel.inputs.length === 0;
    byId('inputCaption').textContent = selectedModel.drawingBased ? '도면 기준 Sounding' : '밀도·측정 기준 확인';
    document.querySelector('.input-footnote').hidden = selectedModel.kind !== 'inventory';
    document.querySelector('.input-footnote').textContent = selectedModel.drawingBased
      ? '중앙 평탄 지붕 기준면을 0 mm로 하여 아래로 잰 거리입니다. 바닥판 상면은 12,050 mm입니다.'
      : '입력값을 바꾸면 결과가 바로 갱신됩니다. Sounding은 위 기준면에서 재료 표면까지의 빈 거리입니다.';
    renderDrawingReferences();
    byId('basisText').textContent = selectedModel.basis;
    byId('formulaText').textContent = formulas[selectedModel.id] || '';
    byId('sourceText').textContent = '원자료: ' + selectedModel.source + ' · 수정 기준 2026-10-20';
    byId('modelWarnings').replaceChildren();
    selectedModel.warnings.forEach(function (warning) { byId('modelWarnings').appendChild(element('li', '', warning)); });
    document.querySelector('.basis-notes').className = 'basis-notes' + (selectedModel.provisional || selectedModel.kind === 'unverified' || selectedModel.id === 'fly-ash' ? ' is-caution' : '');
    selectedModel.inputs.forEach(function (field) {
      var wrapper = element('div', 'field' + (field.key === 'sounding' ? ' is-main' : ''));
      var label = element('label', '', field.label);
      label.setAttribute('for', 'input-' + field.key);
      var inputWrap = element('div', 'field-input-wrap');
      var input = element('input');
      input.id = 'input-' + field.key;
      input.name = field.key;
      input.type = 'text';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.required = field.required;
      input.setAttribute('aria-describedby', 'help-' + field.key + ' error-' + field.key);
      if (field.key === 'sounding') input.placeholder = selectedModel.drawingBased ? '도면 기준 Sounding 입력' : '측정값을 입력하세요';
      var help = selectedModel.drawingBased && field.key === 'density'
        ? '도면 설계밀도를 기본값으로 사용합니다.'
        : field.help || (field.key === 'density' ? '현장 벌크밀도를 확인해 적용하세요.' : field.key === 'hours' ? '현재 재고를 모두 사용하는 가정 시간' : field.key === 'angle' ? '0° 초과, 90° 미만' : '');
      var helpNode = element('p', 'field-help', help);
      helpNode.id = 'help-' + field.key;
      var error = element('p', 'field-error');
      error.id = 'error-' + field.key;
      inputWrap.appendChild(input);
      inputWrap.appendChild(element('span', 'field-unit', field.unit));
      wrapper.appendChild(label);
      wrapper.appendChild(inputWrap);
      wrapper.appendChild(helpNode);
      wrapper.appendChild(error);
      fields.appendChild(wrapper);
      controls[field.key] = input;
      input.addEventListener('input', function () {
        touched[field.key] = true;
        if (field.key === 'sounding' || selectedModel.kind === 'capacity') usingExample = false;
        recalculate();
      });
    });
    loadValues(engine.getDefaults(selectedModel.id), false);
  }
  engine.MODELS.forEach(function (model) {
    var option = element('option', '', model.label);
    option.value = model.id;
    select.appendChild(option);
  });
  select.addEventListener('change', function () { chooseModel(select.value); });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitted = true;
    var result = recalculate();
    if (result.errors && result.errors.length && controls[result.errors[0].key]) controls[result.errors[0].key].focus();
  });
  byId('exampleButton').addEventListener('click', function () { loadValues(selectedModel.example, true); });
  byId('resetButton').addEventListener('click', function () { loadValues(engine.getDefaults(selectedModel.id), false); });

  function returnContext() {
    var navigation = window.GSShiftLogNavigation;
    return navigation && typeof navigation.getReturnContext === 'function' ? navigation.getReturnContext() : null;
  }
  function syncBackLink() {
    var context = returnContext();
    byId('backLink').href = context && context.returnTo === '/mobile-app/' ? '/mobile-app/' : '/';
  }
  byId('backLink').addEventListener('click', function (event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    var navigation = window.GSShiftLogNavigation;
    if (returnContext() && typeof navigation.returnToShiftLog === 'function') {
      event.preventDefault();
      navigation.returnToShiftLog(byId('backLink'));
    }
  });
  window.addEventListener('pageshow', syncBackLink);
  chooseModel(engine.MODELS[0].id);
  syncBackLink();
  byId('calculatorWorkspace').hidden = false;
})();
