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
  var exampleMeasurements = {};
  var numberFormat = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 });
  var massFormat = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  var formulas = {
    limestone: 'd = 측정 Sounding − 센서높이차 (mm)\n영점 = 도면 19,655 mm 치수 상단 기준\nV원통 = π × 2.75² × (19,655 − d) ÷ 1,000 (m³)\nV하부 = V3 + V4 + V5 = 54.3 + 4.5 + 2.1 = 60.9 m³\n환산 재고 = (V원통 + V하부) × 입력 밀도 (t)\n하부 6.6 m³ 제외 재고 = (V원통 + V하부 − 6.6) × 입력 밀도\n0 ≤ d ≤ 19,655 mm, 수평 재료면 가정.\n공칭 내경과 하부 표기용적을 사용하며 라이너 등 내부물은 별도 공제하지 않습니다.\n도면 Net 474.3 m³ = V1 + V2 + V3이며 현재 재고를 이 값으로 제한하지 않습니다.',
    'coal-day': 'd = 측정 Sounding − 센서높이차 (mm)\n영점 = 조립도 11,300 mm 치수 상단 기준\nV원통 = π × 3.25² × (11,300 − d) ÷ 1,000 (m³)\nV하부 = V3 + V4 = 74.8 + 27.2 = 102 m³\n환산 재고 = (V원통 + V하부) × 입력 밀도 (t)\n0 ≤ d ≤ 11,300 mm, 수평 재료면 가정.\n상부 V1의 경사 재료면 용적을 원통 높이에 비례 배분하지 않습니다.\n공칭 내경과 하부 표기용적을 사용하며 라이너 등 내부물은 별도 공제하지 않습니다.\n도면 Net 388 m³ / Gross 476 m³는 참고 용량입니다.',
    'bio-day': 'd = 중앙 평탄 지붕 기준면(0 mm)에서 아래로 잰 Sounding\n바닥판 상면 = 12,050 mm, 원통 공칭 내경 = 8 m\nV = π × 4² × (12,050 − d) ÷ 1,000 (m³)\n도면 기준 재고 = V × 벌크밀도 (t)\n수평 재료면을 가정하며, 400 ≤ d ≤ 12,050 mm에 적용합니다.\n상부 경사 지붕 구간(d < 400 mm)은 이 계산의 산정 범위 밖입니다.',
    'fly-ash': 'd = 측정 Sounding − 센서높이차 (mm)\n영점 = 재료 적재 프로파일의 중앙 지붕 정점 기준\nV원통 = π × 6.5² × (15,240 − d) ÷ 1,000 (m³)\nV하부 = LL 아래 표기용적 36 m³\n환산 재고 = (V원통 + V하부) × 입력 밀도 (t)\n600 ≤ d ≤ 15,240 mm, 수평 재료면 가정.\n기본밀도 0.8 t/m³는 본체 설계값이며 현장값으로 변경할 수 있습니다.\nPDF 28쪽 프로파일 기준. 일반배치의 지붕 610 mm와 10 mm 차이가 있습니다.\nGross 2,000 m³, Net 1,816/1,742 m³, 구조계산 MAX 1,762 m³는 서로 다른 참고값입니다.\nGross 차이를 추가 투입 가능량으로 환산하지 않습니다.',
    sludge: '입력 길이(mm)를 1,000으로 나누어 m로 변환합니다.\nd = Sounding (m), r = 반지름 (m)\nHc = 원통 높이, Hk = 원뿔 높이\n원통 구간 (0 ≤ d ≤ Hc):\n  V = πr²(Hc − d) + πr²Hk ÷ 3\n원뿔 구간 (Hc < d ≤ Hc + Hk):\n  h = Hc + Hk − d\n  V = πr²h³ ÷ (3Hk²)\n총재고 = V × 벌크밀도 (t)\n시간당 평균 환산 = 총재고 ÷ 기준시간 (t/h)',
    'bio-storage': 'S = 측정 Sounding(mm) ÷ 1,000\nR = 바닥 기준 Sounding 시작점 높이(mm) ÷ 1,000\nT = tan(안식각)\nLT Level = R − S (m)\n중앙 정점 A = LT Level + 4.6T\n벽면 높이 H = LT Level − 3.4T\nV원뿔 = π × 8² × (8T) ÷ 3\nV원통 = π × 8² × (H − 0.61)\nV구조물 = π × 1.1² × 1.09\nNet 재고 = (V원뿔 + V원통 − V구조물) × 벌크밀도\n적용: A ≤ 20.895 m, 0.61 ≤ H ≤ 17 m, A − 1.1T ≥ 1.7 m\n저레벨 아래 잔량 ≈ π × (8² − 1.1²) × 0.61 × 벌크밀도 (t)\n지원 하한 밖은 계산 보류이며, 공실을 뜻하지 않습니다.',
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
      if (selectedModel.drawingBased && !selectedModel.directSounding) {
        byId('rangeNote').textContent += ' 수평 재료면 가정이며 운전 허용범위를 뜻하지 않습니다.';
      }
    } else if (selectedModel.id === 'sludge') {
      var cylinder = engine.parseNumber(values.cylinderHeight), cone = engine.parseNumber(values.coneHeight);
      var max = cylinder.status === 'ok' && cone.status === 'ok' ? cylinder.value + cone.value : NaN;
      byId('rangeNote').textContent = isFiniteNumber(max) && cylinder.value > 0 && cone.value > 0
        ? '측정 Sounding 0–' + format(max) + ' mm. 0 mm는 만재, ' + format(max) + ' mm는 공실 기준입니다.'
        : '측정 단위는 mm입니다. 원통 높이와 원뿔 높이를 입력하면 공실 기준을 표시합니다.';
    } else if (selectedModel.id === 'bio-storage') {
      var storageRange = engine.getBioStorageRange(values.referenceHeight, values.angle);
      byId('rangeNote').textContent = storageRange
        ? '현재 기준점·안식각의 Sounding 지원 범위: ' + format(storageRange.minSoundingMm) + '–' + format(storageRange.maxSoundingMm) + ' mm. 저레벨 구간은 별도 검토가 필요합니다.'
        : '측정 Sounding과 바닥 기준 측정 시작점 높이를 mm로 입력하세요. LT는 벽에서 3,400 mm 안쪽 위치를 기준으로 합니다.';
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
    byId('drawingReferenceTitle').textContent = '도면 참고값';
    byId('drawingReferenceHint').textContent = '';
    if (!references) return;
    byId('drawingReferenceTitle').textContent = selectedModel.label + ' · 도면 참고값';
    byId('drawingReferenceHint').textContent = selectedModel.id === 'fly-ash'
      ? '같은 자료 안에서 Net 표기가 다릅니다. 프로파일(PDF 28쪽)과 설계조건(PDF 8쪽)을 구분해 표시합니다. 구조검토 밀도 1.445 t/m³는 재고 환산에 사용하지 않습니다. Gross 차이는 추가 투입 가능량이 아닙니다.'
      : selectedModel.id === 'limestone' ? 'Net 474.3 m³는 V1+V2+V3의 합입니다. 하부 6.6 m³ 제외 재고와 별개이며, 현재 재고를 Net에 맞추어 보정하지 않습니다.'
      : '도면의 추정 용량은 별도 참고값입니다. 재고를 이 값에 맞추어 비례 보정하거나 운전 허용 투입량으로 사용하지 않습니다.';
    [
      ['Gross (도면 표기)', references.grossVolumeM3, 'm³'],
      [selectedModel.id === 'fly-ash' ? 'Net (프로파일)' : 'Net (도면 표기)', references.netVolumeM3, 'm³'],
      ['설계밀도', references.designDensity, 't/m³'],
      ['운전중량 (도면 표기)', references.operatingMassTon, 't'],
      ['Net (설계조건)', references.alternateNetVolumeM3, 'm³'],
      ['MAX (구조계산)', references.structuralMaxVolumeM3, 'm³'],
      ['지지구조 검토 밀도', references.structuralDensity, 't/m³']
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
    byId('siloLevelSummary').hidden = !show || model.id === 'bio-storage';
    byId('siloPlaceholder').hidden = show;
    byId('siloPlaceholderMessage').textContent = model.kind === 'capacity'
      ? '운전조건별 만적재량 계산입니다. 현재 재고의 채움 그림은 표시하지 않습니다.'
      : result.status === 'unverified' ? '설비와 원도면을 확인한 뒤 채움 상태를 표시할 수 있습니다.'
      : result.status === 'missing' ? '측정값을 입력하면 재료면과 높이를 표시합니다.'
      : '유효한 범위의 입력값을 확인하세요. 이전 채움 상태는 표시하지 않습니다.';
    byId('siloVisualKind').textContent = '';
    byId('siloVisualFootnote').textContent = '';
    byId('siloFillPercent').textContent = '';
    byId('siloHeightValue').textContent = '';
    byId('siloDiagramDesc').textContent = '';
    byId('siloLevelBar').setAttribute('style', 'width:0%');
    ['siloHeapFill', 'siloHeapTexture'].forEach(function (id) { byId(id).setAttribute('d', ''); });
    byId('siloSurfaceLabel').textContent = '재료면';
    if (!show) return;
    if (model.id === 'bio-storage') { renderStorageSilo(result); return; }

    var bio = model.id === 'bio-day';
    var sludge = model.id === 'sludge';
    var ash = model.id === 'fly-ash';
    var flatRoof = model.id === 'limestone' || model.id === 'coal-day';
    var geometry = model.geometry;
    var bodyTop = bio ? 62 : 67;
    var bodyBottom = bio ? 353.25 : 303;
    var bottom = bio ? bodyBottom : 353;
    var left = 115, right = 285, datum = bio ? 52 : 45;
    var surface, ratio, height, heightLabel, fillLabel;
    var hopper = flatRoof;
    if (flatRoof) datum = bodyTop;
    if (ash) {
      left = 90; right = 310;
      bodyTop = datum + (bottom - datum) * 600 / 16040;
      bodyBottom = datum + (bottom - datum) * 15240 / 16040;
    }
    if (bio) {
      left = 100; right = 300;
      ratio = result.cylinderFillRatio;
      height = result.remainingCylinderHeightM;
      surface = bodyBottom - (bodyBottom - bodyTop) * ratio;
      heightLabel = '원통부 재료 높이';
      fillLabel = '원통 높이 대비';
    } else if (sludge) {
      var values = readValues();
      var cylinderHeight = engine.parseNumber(values.cylinderHeight).value / 1000, coneHeight = engine.parseNumber(values.coneHeight).value / 1000;
      var radius = engine.parseNumber(values.radius).value / 1000;
      var scale = Math.min(280 / result.emptySoundingM, 190 / (2 * radius));
      left = 200 - radius * scale; right = 400 - left;
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
    if (ash) { heightLabel = 'LL 위 재료 높이'; fillLabel = 'LL 위 계산구간 높이 대비'; }
    var roof = sludge || flatRoof ? 'M' + left + ' ' + bodyTop + 'H' + right
      : 'M' + left + ' ' + bodyTop + 'L180 ' + datum + 'H220L' + right + ' ' + bodyTop;
    if (ash) roof = 'M' + left + ' ' + bodyTop + 'L200 ' + datum + 'L' + right + ' ' + bodyTop;
    var shape = ash ? roof + 'V' + bottom + 'H' + left + 'Z'
      : roof + 'V' + bodyBottom + (sludge ? 'L200 ' + bottom
      : hopper ? 'L235 ' + bottom + 'H165' : 'H' + left) + 'L' + left + ' ' + bodyBottom + 'Z';
    ['siloClipShape', 'siloShell', 'siloOutline'].forEach(function (id) { byId(id).setAttribute('d', shape); });
    byId('siloShoulder').setAttribute('d', 'M' + left + ' ' + bodyTop + 'H' + right);
    byId('siloHopperTop').setAttribute('d', hopper || sludge ? 'M' + left + ' ' + bodyBottom + 'H' + right : '');
    if (ash) {
      var outletHalf = (right - left) * 2.2 / 13 / 2;
      var outletY = bottom - (bottom - datum) * 114 / 16040;
      var floor = 'L' + (200 + outletHalf) + ' ' + outletY + 'H' + (200 - outletHalf) + 'L' + left + ' ' + bodyBottom;
      byId('siloClipShape').setAttribute('d', roof + 'V' + bodyBottom + floor + 'Z');
      byId('siloHopperTop').setAttribute('d', 'M' + right + ' ' + bodyBottom + floor);
    }
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
    byId('siloDatumLabel').textContent = bio ? '중앙 평탄 지붕 기준 · 0 mm' : ash ? '프로파일 지붕 정점 · 0 mm' : flatRoof ? '도면 치수 상단 · 0 mm' : 'Sounding 기준 · 0 mm';
    byId('siloBottomLabel').setAttribute('y', bottom + 24);
    byId('siloBottomLabel').textContent = bio ? '바닥판 상면 · 12,050 mm' : sludge ? '공실 기준 · ' + format(result.emptySoundingMm) + ' mm' : '원통 하단 · ' + format(geometry.bottom) + ' mm';
    if (hopper) byId('siloBottomLabel').textContent = '하부 표기용적 · ' + format(result.hopperVolumeM3) + ' m³';
    if (ash) byId('siloBottomLabel').textContent = 'LL 아래 표기용적 · 36 m³';
    byId('siloDistance').setAttribute('d', 'M84 ' + datum + 'h-12M78 ' + datum + 'V' + surface + 'M84 ' + surface + 'h-12');
    // Keep a short Sounding label below the roof caption near the full end.
    var distanceLabelY = (datum + surface) / 2;
    if (ash || flatRoof) distanceLabelY = Math.max(110, distanceLabelY);
    byId('siloDistanceLabel').setAttribute('transform', 'translate(61 ' + distanceLabelY + ') rotate(-90)');
    byId('siloDistanceLabel').setAttribute('x', 0);
    byId('siloDistanceLabel').setAttribute('y', 0);
    byId('siloDistanceLabel').textContent = format(result.effectiveSounding) + ' ' + result.soundingUnit;
    byId('siloSurface').setAttribute('d', 'M' + left + ' ' + surface + 'H320');
    byId('siloSurfaceLabel').setAttribute('y', surface + 4);
    ['siloDistance', 'siloDistanceLabel', 'siloSurface', 'siloSurfaceLabel'].forEach(function (id) {
      byId(id).setAttribute('visibility', 'visible');
    });
    var percent = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(ratio * 100) + '%';
    byId('siloVisualKind').textContent = bio ? '도면 높이 기준' : model.drawingBased ? '수평 재료면 가정 · 형상 개념도' : '형상 개념도';
    byId('siloFillLabel').textContent = fillLabel;
    byId('siloFillPercent').textContent = percent;
    byId('siloLevelBar').setAttribute('style', 'width:' + Math.max(0, Math.min(100, ratio * 100)) + '%');
    byId('siloHeightLabel').textContent = heightLabel;
    byId('siloHeightValue').textContent = format(sludge ? height * 1000 : height) + (sludge ? ' mm' : ' m');
    byId('siloVisualNote').textContent = bio ? '재료 높이 ÷ 원통 높이 11.65 m' : sludge ? '재료 높이 ÷ 원통·원뿔 전체 높이' : ash ? 'LL 위 재료 높이 ÷ LL–지붕 하단 높이 14.64 m' : '원통부 재료 높이 ÷ 공칭 원통 높이 · 용적 비율과 다름';
    byId('siloVisualFootnote').textContent = bio
      ? '지붕 윤곽은 개념도입니다. 채움 높이는 도면 치수에 연동하며, 내부 구조물은 생략합니다.'
      : sludge ? '입력한 치수와 원통·원뿔 형상 가정을 반영합니다. 높이 비율과 용적 비율은 다릅니다.'
      : ash ? '재료 적재 프로파일의 경사 바닥을 단순화했습니다. LL 아래 표기용적 36 m³가 채워진 것으로 계산하며, %는 LL 위 계산구간 높이 기준입니다.'
      : '평탄 지붕과 하부 형상을 단순화한 개념도입니다. 하부 표기용적은 채워진 것으로 계산합니다. 내부 구조물과 두 갈래 배출 형상은 생략하며 %는 원통 높이 기준입니다.';
    byId('siloDiagramDesc').textContent = model.label + ', ' + fillLabel + ' ' + percent + ', ' + heightLabel + ' ' + format(sludge ? height * 1000 : height) + (sludge ? ' mm, 측정 Sounding ' : ' m, 도면 기준 Sounding ') + format(result.effectiveSounding) + ' ' + result.soundingUnit + ', ' + result.primaryLabel + ' ' + massFormat.format(result.massTon) + ' t.';
  }
  function renderStorageSilo(result) {
    var scale = Math.min(280 / Math.max(20.895, result.referenceHeightM), 200 / 16);
    var bottom = 350, left = 200 - 8 * scale, right = 200 + 8 * scale;
    function y(height) { return bottom - height * scale; }
    var top = y(17), roof = y(20.895), datum = y(result.referenceHeightM);
    var wall = y(result.wallLevelM), apex = y(result.apexHeightM), level = y(result.levelM);
    var ltX = 200 + 4.6 * scale;
    var shell = 'M' + left + ' ' + top + 'L200 ' + roof + 'L' + right + ' ' + top + 'V' + bottom + 'H' + left + 'Z';
    ['siloClipShape', 'siloShell', 'siloOutline'].forEach(function (id) { byId(id).setAttribute('d', shell); });
    byId('siloShoulder').setAttribute('d', 'M' + left + ' ' + top + 'H' + right);
    byId('siloHopperTop').setAttribute('d', 'M' + left + ' ' + y(0.61) + 'H' + right);
    byId('siloTicks').setAttribute('d', '');
    ['siloFill', 'siloTexture'].forEach(function (id) { byId(id).setAttribute('height', 0); });
    var heap = 'M' + left + ' ' + wall + 'L200 ' + apex + 'L' + right + ' ' + wall + 'V' + bottom + 'H' + left + 'Z';
    ['siloHeapFill', 'siloHeapTexture'].forEach(function (id) { byId(id).setAttribute('d', heap); });
    byId('siloMaterial').setAttribute('visibility', 'visible');
    byId('siloDatum').setAttribute('d', 'M80 ' + datum + 'H320');
    byId('siloDatumLabel').textContent = '입력 기준점 · ' + format(result.referenceHeightM * 1000) + ' mm';
    byId('siloBottomLabel').setAttribute('y', bottom + 24);
    byId('siloBottomLabel').textContent = '바닥 기준 · 0 mm';
    byId('siloDistance').setAttribute('d', 'M' + (ltX - 5) + ' ' + datum + 'h10M' + ltX + ' ' + datum + 'V' + level + 'M' + (ltX - 5) + ' ' + level + 'h10');
    byId('siloDistanceLabel').setAttribute('transform', 'translate(' + (ltX + 15) + ' ' + ((datum + level) / 2) + ') rotate(-90)');
    byId('siloDistanceLabel').setAttribute('x', 0);
    byId('siloDistanceLabel').setAttribute('y', 0);
    byId('siloDistanceLabel').textContent = format(result.effectiveSounding) + ' mm';
    byId('siloSurface').setAttribute('d', 'M' + left + ' ' + wall + 'L200 ' + apex + 'L' + right + ' ' + wall + 'M' + ltX + ' ' + level + 'H320');
    byId('siloSurfaceLabel').setAttribute('y', level + 4);
    byId('siloSurfaceLabel').textContent = 'LT';
    ['siloDistance', 'siloDistanceLabel', 'siloSurface', 'siloSurfaceLabel'].forEach(function (id) { byId(id).setAttribute('visibility', 'visible'); });
    byId('siloVisualKind').textContent = '안식각을 반영한 재료면 · Net 재고는 저레벨 아래 잔량 제외';
    byId('siloVisualFootnote').textContent = '바닥 기준 높이와 원자료 LT 위치(벽에서 3,400 mm 안쪽)를 사용합니다. 그림은 안식각을 반영한 개념도이며 내부 구조물은 생략합니다. Net 재고는 610 mm 저레벨 아래 잔량을 제외합니다.';
    byId('siloDiagramDesc').textContent = 'Bio Storage Silo, 측정 Sounding ' + format(result.effectiveSounding) + ' mm, 기준점 높이 ' + format(result.referenceHeightM * 1000) + ' mm, LT 위치 재료 높이 ' + format(result.levelM * 1000) + ' mm, Net 재고 ' + massFormat.format(result.massTon) + ' t. 안식각을 반영한 경사 재료면입니다.';
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
    byId('detailNumbers').hidden = !isOk;
    byId('emptyTitle').textContent = titles[result.status] || '측정값을 입력하세요';
    byId('resultMessage').textContent = result.message + (result.status === 'unsupported' && isFiniteNumber(result.effectiveSounding)
      ? ' 적용 Sounding: ' + format(result.effectiveSounding) + ' ' + result.soundingUnit + '.' : '');
    byId('exampleNotice').hidden = !usingExample;
    byId('exampleNotice').textContent = selectedModel.id === 'bio-storage'
      ? '예시 입력값이 포함되어 있습니다. 예시 기준점 20,895 mm는 Chute 높이를 가정한 값이며 실제 센서 높이가 아닙니다. Sounding과 기준점 높이를 실제값으로 바꾸세요.'
      : '예시 입력값이 포함되어 있습니다. 실제 측정값과 운전조건을 확인하세요.';
    // Clear previous numeric nodes on every edit, including missing/out-of-range inputs.
    byId('massValue').textContent = '';
    byId('primaryLabel').textContent = '';
    byId('keyResults').replaceChildren();
    byId('resultDetails').replaceChildren();
    renderSilo(result);
    if (!isOk) return;
    byId('primaryLabel').textContent = result.primaryLabel;
    byId('massValue').textContent = massFormat.format(result.massTon);
    if (selectedModel.id === 'limestone') addKey('하부 6.6 m³ 제외 재고', result.usableTon, 't', '도면 Net 용량과 별개');
    if (selectedModel.id === 'sludge') addKey('시간당 평균 환산', result.rateTonPerHour, 't/h', format(result.hours) + '시간에 모두 사용하는 경우');
    if (selectedModel.id === 'bio-storage') {
      addKey('LT 위치 재료 높이', result.levelM * 1000, 'mm', '바닥 기준 · 벽에서 3,400 mm 안쪽');
      addKey('Chute 여유', result.clearanceM * 1000, 'mm');
    }
    addDetail(selectedModel.drawingBased ? '도면 치수 환산 용적' : selectedModel.id === 'bio-storage' ? 'Net 용적' : '재고 환산 용적', result.volumeM3, 'm³');
    addDetail('적용 벌크밀도', result.density, 't/m³');
    addDetail(selectedModel.id === 'sludge' || selectedModel.id === 'bio-storage' ? '측정 Sounding' : '도면 기준 Sounding', result.effectiveSounding, result.soundingUnit);
    if (selectedModel.id === 'sludge') {
      addDetail('원통부 남은 높이', result.remainingCylinderHeightM * 1000, 'mm');
      addDetail('원뿔부 남은 높이', result.remainingConeHeightM * 1000, 'mm');
      addDetail('공실 Sounding 기준', result.emptySoundingMm, 'mm');
    }
    if (selectedModel.id === 'bio-storage') {
      addDetail('입력한 Sounding 기준점 높이', result.referenceHeightM * 1000, 'mm');
      addDetail('중앙 정점 높이', result.apexHeightM * 1000, 'mm');
      addDetail('원통 벽면 높이', result.wallLevelM * 1000, 'mm');
      addDetail('저레벨 아래 잔량 (근사)', result.residualMassTon, 't');
      addDetail('잔량 포함 물리적 재고 (근사)', result.estimatedPhysicalMassTon, 't');
    }
  }
  function recalculate() {
    var values = readValues();
    var result = engine.calculate(selectedModel.id, values);
    updateRange(values);
    if (selectedModel.references && controls.density) {
      var density = engine.parseNumber(values.density);
      var designDensity = selectedModel.references.designDensity;
      byId('help-density').textContent = density.status === 'ok' && density.value === designDensity
        ? '도면 설계밀도 ' + format(designDensity) + ' t/m³ 적용 · 실제 운전값은 확인 후 변경하세요.'
        : density.status === 'ok' && density.value > 0
          ? '입력 밀도 ' + format(density.value) + ' t/m³ 적용 · 도면 설계밀도는 ' + format(designDensity) + ' t/m³입니다.'
          : '유효한 벌크밀도를 입력하세요. 도면 설계밀도는 ' + format(designDensity) + ' t/m³입니다.';
    }
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
    exampleMeasurements = example && selectedModel.id === 'bio-storage' ? { sounding: true, referenceHeight: true } : {};
    recalculate();
  }
  function chooseModel(id) {
    selectedModel = engine.getModel(id) || engine.MODELS[0];
    select.value = selectedModel.id;
    fields.replaceChildren();
    byId('inputGuidance').replaceChildren();
    controls = {};
    byId('modelDescription').textContent = selectedModel.description;
    byId('modelKind').textContent = selectedModel.drawingBased ? '도면 치수 기준' : selectedModel.provisional ? '원도면 미확인 · 잠정 환산' : selectedModel.id === 'bio-storage' ? 'Sounding → Net 재고' : selectedModel.kind === 'unverified' ? '계산 보류' : '측정값 → 재고 환산';
    byId('modelKind').className = 'kind-badge' + (selectedModel.provisional ? ' is-provisional' : selectedModel.kind === 'unverified' ? ' is-unverified' : '');
    byId('formActions').hidden = selectedModel.inputs.length === 0;
    byId('inputCaption').textContent = selectedModel.drawingBased ? '도면 기준 Sounding' : '밀도·측정 기준 확인';
    document.querySelector('.input-footnote').hidden = selectedModel.kind !== 'inventory';
    document.querySelector('.input-footnote').textContent = selectedModel.directSounding
      ? '중앙 평탄 지붕 기준면을 0 mm로 하여 아래로 잰 거리입니다. 바닥판 상면은 12,050 mm입니다.'
      : selectedModel.id === 'bio-storage' ? '기준점 높이는 바닥에서 센서의 측정 시작점까지, Sounding은 그 시작점에서 LT 위치 재료면까지의 수직 빈 거리입니다. 두 길이는 모두 mm입니다.'
      : selectedModel.id === 'limestone' ? '영점은 도면의 19,655 mm 치수 상단입니다. 셸 치수 19,645 mm와 상단 10 mm를 구분하며, 실제 센서 시작점과의 차이는 센서높이차로 반영하세요.'
      : selectedModel.id === 'coal-day' ? '영점은 조립도의 11,300 mm 치수 상단입니다. 센서 노즐의 돌출 높이만으로 측정 영점을 확정하지 않으며, 실제 센서 시작점과의 차이를 입력하세요.'
      : selectedModel.id === 'fly-ash' ? '영점은 PDF 28쪽 프로파일의 지붕 정점입니다. 센서 시작점이 이 기준보다 높으면 센서높이차를 +로 입력하세요.'
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
      if (field.key === 'sounding') input.placeholder = selectedModel.directSounding ? '도면 기준 Sounding 입력' : '측정값을 입력하세요';
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
      if (field.key === 'referenceHeight') {
        input.placeholder = '실제 설치 높이 입력';
        wrapper.appendChild(helpNode);
      } else if (field.key === 'density' && selectedModel.references) {
        wrapper.appendChild(helpNode);
      } else if (help) {
        var guidance = element('div', 'guidance-item');
        guidance.appendChild(element('strong', '', field.label));
        guidance.appendChild(helpNode);
        byId('inputGuidance').appendChild(guidance);
      } else {
        wrapper.appendChild(helpNode);
      }
      wrapper.appendChild(error);
      fields.appendChild(wrapper);
      controls[field.key] = input;
      input.addEventListener('input', function () {
        touched[field.key] = true;
        if (selectedModel.id === 'bio-storage') {
          delete exampleMeasurements[field.key];
          usingExample = !!(exampleMeasurements.sounding || exampleMeasurements.referenceHeight);
        } else if (field.key === 'sounding') usingExample = false;
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
