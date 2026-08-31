(() => {
  "use strict";

  if (window.__morningMeetingCofiringAdjustmentV2Installed === true) {
    return;
  }
  window.__morningMeetingCofiringAdjustmentV2Installed = true;

  const CARD_ID = "efficiencyMorningMeetingAutoCofiringCard";
  const STATUS_ID = "efficiencyMorningMeetingCofiringStatus";
  const DATE_ID = "efficiencyMorningMeetingCofiringDate";
  const BUTTON_ID = "morningMeetingCofiringAdjustmentButton";
  const MODAL_ID = "morningMeetingCofiringAdjustmentModal";
  const ADJUSTMENT_API_URL = "/api/morning-meeting-cofiring-adjustments";
  const SETTINGS_API_URL = "/api/morning-meeting-cofiring-settings";
  const OIS_REQUEST_API_URL = "/api/ois-data-requests";
  const DEFAULT_MAX_BIO_LIMIT = 361.74;
  const VALUE_IDS = {
    unitOneCoal: "efficiencyMorningMeetingCofiringUnit1CoalUsage",
    unitOneBio: "efficiencyMorningMeetingCofiringUnit1BioUsage",
    unitOneBioRatio: "efficiencyMorningMeetingCofiringUnit1BioRatio",
    unitTwoCoal: "efficiencyMorningMeetingCofiringUnit2CoalUsage",
    unitTwoBio: "efficiencyMorningMeetingCofiringUnit2BioUsage",
    unitTwoBioRatio: "efficiencyMorningMeetingCofiringUnit2BioRatio",
    unitOneOrganic: "efficiencyMorningMeetingCofiringUnit1OrganicInput",
    unitOneOrganicRatio: "efficiencyMorningMeetingCofiringUnit1OrganicRatio",
    unitOneTotalRatio: "efficiencyMorningMeetingCofiringUnit1TotalRatio",
    unitTwoOrganic: "efficiencyMorningMeetingCofiringUnit2OrganicInput",
    unitTwoOrganicRatio: "efficiencyMorningMeetingCofiringUnit2OrganicRatio",
    unitTwoTotalRatio: "efficiencyMorningMeetingCofiringUnit2TotalRatio"
  };

  let observer = null;
  let refreshTimer = null;
  let currentContext = null;
  let selectedDirection = 1;
  let currentMode = "manual_transfer";
  let previewResult = null;

  function normalizeNumber(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return null;
    }
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  function round(value, digits = 6) {
    const factor = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  }

  function cloneFuelData(fuelData) {
    return {
      unitOne: {
        coal: normalizeNumber(fuelData?.unitOne?.coal),
        bio: normalizeNumber(fuelData?.unitOne?.bio),
        organic: normalizeNumber(fuelData?.unitOne?.organic)
      },
      unitTwo: {
        coal: normalizeNumber(fuelData?.unitTwo?.coal),
        bio: normalizeNumber(fuelData?.unitTwo?.bio),
        organic: normalizeNumber(fuelData?.unitTwo?.organic)
      }
    };
  }

  function getAuthHeaders(jsonRequest = false) {
    const baseHeaders =
      typeof window.getShiftLogAuthHeaders === "function"
        ? window.getShiftLogAuthHeaders()
        : {};
    return {
      ...baseHeaders,
      Accept: "application/json",
      ...(jsonRequest ? { "Content-Type": "application/json" } : {})
    };
  }

  async function readJsonResponse(response, fallbackMessage) {
    const responseText = await response.text();
    let payload = {};
    if (responseText.trim()) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        throw new Error("서버 응답 형식이 올바르지 않습니다.");
      }
    }
    if (!response.ok || payload.ok === false) {
      throw new Error(
        payload.message ||
          payload.error ||
          fallbackMessage ||
          `요청에 실패했습니다. (HTTP ${response.status})`
      );
    }
    return payload;
  }

  function getTargetDate() {
    const dateElement = document.getElementById(DATE_ID);
    const text = String(dateElement?.textContent || "").trim();
    const match = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    return match ? match[1] : "";
  }

  function normalizeFuelData(result) {
    return {
      unitOne: {
        coal: normalizeNumber(result?.coalUsageUnitOne),
        bio: normalizeNumber(result?.bioUsageUnitOne),
        organic: normalizeNumber(result?.organicUsageUnitOne)
      },
      unitTwo: {
        coal: normalizeNumber(result?.coalUsageUnitTwo),
        bio: normalizeNumber(result?.bioUsageUnitTwo),
        organic: normalizeNumber(result?.organicUsageUnitTwo)
      }
    };
  }

  function allRequiredFuelValuesPresent(fuelData) {
    return [
      fuelData?.unitOne?.coal,
      fuelData?.unitOne?.bio,
      fuelData?.unitOne?.organic,
      fuelData?.unitTwo?.coal,
      fuelData?.unitTwo?.bio,
      fuelData?.unitTwo?.organic
    ].every((value) => normalizeNumber(value) !== null && Number(value) >= 0);
  }

  function validSettings(settings) {
    return [
      settings?.coalKcalPerKg,
      settings?.bioKcalPerKg,
      settings?.organicKcalPerKg
    ].every((value) => normalizeNumber(value) !== null && Number(value) > 0);
  }

  function calculateUnitRatios(unitData, settings) {
    const calculator = window.calculateMorningMeetingCofiring;
    if (typeof calculator === "function") {
      return calculator(unitData, settings);
    }
    const coal = normalizeNumber(unitData?.coal);
    const bio = normalizeNumber(unitData?.bio);
    const organic = normalizeNumber(unitData?.organic);
    const coalHv = normalizeNumber(settings?.coalKcalPerKg);
    const bioHv = normalizeNumber(settings?.bioKcalPerKg);
    const organicHv = normalizeNumber(settings?.organicKcalPerKg);
    if ([coal, bio, organic, coalHv, bioHv, organicHv].some((value) => value === null)) {
      return null;
    }
    const coalHeat = coal * coalHv;
    const bioHeat = bio * bioHv;
    const organicHeat = organic * organicHv;
    const totalHeat = coalHeat + bioHeat + organicHeat;
    if (!(totalHeat > 0)) {
      return null;
    }
    const bioRatio = (bioHeat / totalHeat) * 100;
    const organicRatio = (organicHeat / totalHeat) * 100;
    return {
      bioRatio,
      organicRatio,
      totalRatio: bioRatio + organicRatio
    };
  }

  function calculateFinalBioAdjustment(baseFuelData, settings, finalBioUnitOne, finalBioUnitTwo, metadata = {}) {
    const fuelData = cloneFuelData(baseFuelData);
    const bioOne = normalizeNumber(finalBioUnitOne);
    const bioTwo = normalizeNumber(finalBioUnitTwo);
    const coalHv = normalizeNumber(settings?.coalKcalPerKg);
    const bioHv = normalizeNumber(settings?.bioKcalPerKg);

    if (!allRequiredFuelValuesPresent(fuelData)) {
      return { ok: false, message: "Coal / Bio / 유기성 사용량을 모두 확인해 주세요." };
    }
    if (!validSettings(settings) || coalHv === null || bioHv === null) {
      return { ok: false, message: "발열량 설정을 먼저 확인해 주세요." };
    }
    if (bioOne === null || bioTwo === null || bioOne < 0 || bioTwo < 0) {
      return { ok: false, message: "최종 Bio 사용량을 0 이상으로 입력해 주세요." };
    }

    const actualBioTotal = fuelData.unitOne.bio + fuelData.unitTwo.bio;
    const finalBioTotal = bioOne + bioTwo;
    if (finalBioTotal > actualBioTotal + 0.011) {
      return {
        ok: false,
        message: `최종 Bio 합계(${formatUsagePlain(finalBioTotal)} t/d)가 실제 사용량(${formatUsagePlain(actualBioTotal)} t/d)을 초과할 수 없습니다.`
      };
    }

    const unitOneBioDelta = fuelData.unitOne.bio - bioOne;
    const unitTwoBioDelta = fuelData.unitTwo.bio - bioTwo;
    const unitOneCoalDelta = unitOneBioDelta * bioHv / coalHv;
    const unitTwoCoalDelta = unitTwoBioDelta * bioHv / coalHv;
    const unitOneCoal = fuelData.unitOne.coal + unitOneCoalDelta;
    const unitTwoCoal = fuelData.unitTwo.coal + unitTwoCoalDelta;

    if (unitOneCoal < -1e-9 || unitTwoCoal < -1e-9) {
      return { ok: false, message: "Bio 조정량이 너무 커 Coal 자동 보정값이 0 미만이 됩니다." };
    }

    fuelData.unitOne.bio = round(bioOne, 2);
    fuelData.unitTwo.bio = round(bioTwo, 2);
    fuelData.unitOne.coal = round(Math.max(0, unitOneCoal));
    fuelData.unitTwo.coal = round(Math.max(0, unitTwoCoal));

    const unitOneRatios = calculateUnitRatios(fuelData.unitOne, settings);
    const unitTwoRatios = calculateUnitRatios(fuelData.unitTwo, settings);
    if (!unitOneRatios || !unitTwoRatios) {
      return { ok: false, message: "조정 후 혼소율을 계산하지 못했습니다." };
    }

    const excludedBioTons = round(Math.max(0, actualBioTotal - finalBioTotal), 2);
    const exclusionNote = excludedBioTons > 0.004
      ? `실제 Bio 사용량 ${formatUsagePlain(actualBioTotal)} t/d 중 ${formatUsagePlain(excludedBioTons)} t/d를 혼소량 계산에서 제외했습니다.`
      : "";

    return {
      ok: true,
      mode: metadata.mode || "manual_final",
      fuelData,
      unitOneRatios,
      unitTwoRatios,
      unitOneCoalDelta: round(unitOneCoalDelta),
      unitTwoCoalDelta: round(unitTwoCoalDelta),
      excludedBioTons,
      exclusionNote,
      maxBioLimit: normalizeNumber(metadata.maxBioLimit),
      fromUnit: normalizeNumber(metadata.fromUnit),
      bioTransferTons: normalizeNumber(metadata.bioTransferTons)
    };
  }

  function calculateAdjustment(baseFuelData, settings, fromUnit, bioTransferTons) {
    const fuelData = cloneFuelData(baseFuelData);
    const direction = Number(fromUnit) === 2 ? 2 : 1;
    const transfer = normalizeNumber(bioTransferTons);
    if (!allRequiredFuelValuesPresent(fuelData)) {
      return { ok: false, message: "Coal / Bio / 유기성 사용량을 모두 확인해 주세요." };
    }
    if (transfer === null || transfer <= 0) {
      return { ok: false, message: "Bio 이동량을 0보다 크게 입력해 주세요." };
    }
    const source = direction === 1 ? fuelData.unitOne : fuelData.unitTwo;
    const destination = direction === 1 ? fuelData.unitTwo : fuelData.unitOne;
    if (source.bio + 1e-9 < transfer) {
      return { ok: false, message: `${direction}호기 Bio 사용량보다 많은 양을 이동할 수 없습니다.` };
    }
    const finalOne = direction === 1 ? fuelData.unitOne.bio - transfer : fuelData.unitOne.bio + transfer;
    const finalTwo = direction === 1 ? fuelData.unitTwo.bio + transfer : fuelData.unitTwo.bio - transfer;
    const result = calculateFinalBioAdjustment(baseFuelData, settings, finalOne, finalTwo, {
      mode: "manual_transfer",
      fromUnit: direction,
      bioTransferTons: transfer
    });
    if (result.ok) {
      const coalHv = normalizeNumber(settings?.coalKcalPerKg);
      const bioHv = normalizeNumber(settings?.bioKcalPerKg);
      result.coalEquivalentTons = round(transfer * bioHv / coalHv);
    }
    return result;
  }

  function randomTargetAtOrBelow(maxBioLimit) {
    const maxLimit = normalizeNumber(maxBioLimit);
    if (maxLimit === null || maxLimit <= 0) {
      return null;
    }
    const lower = Math.floor(maxLimit);
    const span = Math.max(0, maxLimit - lower);
    if (span <= 0.000001) {
      return round(maxLimit, 2);
    }
    return round(lower + Math.random() * span, 2);
  }

  function calculateMaxAutoAdjustment(baseFuelData, settings, maxBioLimit) {
    const fuelData = cloneFuelData(baseFuelData);
    const maxLimit = normalizeNumber(maxBioLimit);
    if (!allRequiredFuelValuesPresent(fuelData)) {
      return { ok: false, message: "Coal / Bio / 유기성 사용량을 모두 확인해 주세요." };
    }
    if (!validSettings(settings)) {
      return { ok: false, message: "발열량 설정을 먼저 확인해 주세요." };
    }
    if (maxLimit === null || maxLimit <= 0 || maxLimit > 2000) {
      return { ok: false, message: "호기당 Bio 최대량을 확인해 주세요." };
    }

    const baseOne = fuelData.unitOne.bio;
    const baseTwo = fuelData.unitTwo.bio;
    const overOne = baseOne > maxLimit + 0.0001;
    const overTwo = baseTwo > maxLimit + 0.0001;
    if (!overOne && !overTwo) {
      return { ok: false, message: `현재 1·2호기 Bio 사용량이 모두 최대 ${formatUsagePlain(maxLimit)} t/d 이하입니다.` };
    }

    let finalOne = baseOne;
    let finalTwo = baseTwo;
    let fromUnit = null;
    let transferTons = 0;

    if (overOne && !overTwo) {
      fromUnit = 1;
      finalOne = randomTargetAtOrBelow(maxLimit);
      transferTons = round(baseOne - finalOne, 2);
      finalTwo = round(baseTwo + transferTons, 2);
      if (finalTwo > maxLimit + 0.0001) {
        finalTwo = randomTargetAtOrBelow(maxLimit);
      }
    } else if (!overOne && overTwo) {
      fromUnit = 2;
      finalTwo = randomTargetAtOrBelow(maxLimit);
      transferTons = round(baseTwo - finalTwo, 2);
      finalOne = round(baseOne + transferTons, 2);
      if (finalOne > maxLimit + 0.0001) {
        finalOne = randomTargetAtOrBelow(maxLimit);
      }
    } else {
      finalOne = randomTargetAtOrBelow(maxLimit);
      finalTwo = randomTargetAtOrBelow(maxLimit);
    }

    const result = calculateFinalBioAdjustment(baseFuelData, settings, finalOne, finalTwo, {
      mode: "max_auto",
      maxBioLimit: maxLimit,
      fromUnit,
      bioTransferTons: transferTons
    });
    if (!result.ok) {
      return result;
    }
    result.autoSummary = fromUnit
      ? `${fromUnit}호기 초과분을 ${fromUnit === 1 ? 2 : 1}호기로 우선 이동한 뒤 최대량을 적용했습니다.`
      : "1·2호기가 모두 최대량을 초과하여 각 호기를 최대 범위 안으로 조정했습니다.";
    return result;
  }

  function formatUsage(value) {
    const numeric = normalizeNumber(value);
    return numeric === null
      ? "-"
      : `${numeric.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} t/d`;
  }

  function formatUsagePlain(value) {
    const numeric = normalizeNumber(value);
    return numeric === null
      ? "-"
      : numeric.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatRatio(value) {
    const numeric = normalizeNumber(value);
    return numeric === null
      ? "-"
      : `${numeric.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
  }

  function setText(id, text) {
    const element = document.getElementById(id);
    if (element instanceof HTMLElement) {
      element.textContent = text;
    }
  }

  function renderAdjustedValues(result) {
    if (!result?.ok) {
      return;
    }
    const fuelData = result.fuelData;
    setText(VALUE_IDS.unitOneCoal, formatUsage(fuelData.unitOne.coal));
    setText(VALUE_IDS.unitOneBio, formatUsage(fuelData.unitOne.bio));
    setText(VALUE_IDS.unitTwoCoal, formatUsage(fuelData.unitTwo.coal));
    setText(VALUE_IDS.unitTwoBio, formatUsage(fuelData.unitTwo.bio));
    setText(VALUE_IDS.unitOneOrganic, formatUsage(fuelData.unitOne.organic));
    setText(VALUE_IDS.unitTwoOrganic, formatUsage(fuelData.unitTwo.organic));
    setText(VALUE_IDS.unitOneBioRatio, formatRatio(result.unitOneRatios.bioRatio));
    setText(VALUE_IDS.unitTwoBioRatio, formatRatio(result.unitTwoRatios.bioRatio));
    setText(VALUE_IDS.unitOneOrganicRatio, formatRatio(result.unitOneRatios.organicRatio));
    setText(VALUE_IDS.unitTwoOrganicRatio, formatRatio(result.unitTwoRatios.organicRatio));
    setText(VALUE_IDS.unitOneTotalRatio, formatRatio(result.unitOneRatios.totalRatio));
    setText(VALUE_IDS.unitTwoTotalRatio, formatRatio(result.unitTwoRatios.totalRatio));
  }

  async function fetchDailyData(targetDate) {
    const requestUrl = new URL(OIS_REQUEST_API_URL, window.location.origin);
    requestUrl.searchParams.set("action", "completed_history");
    requestUrl.searchParams.set("startDate", targetDate);
    requestUrl.searchParams.set("endDate", targetDate);
    requestUrl.searchParams.set("_", String(Date.now()));
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: getAuthHeaders(false),
      cache: "no-store"
    });
    const payload = await readJsonResponse(response, "저장된 일일DATA를 불러오지 못했습니다.");
    const items = Array.isArray(payload.items) ? payload.items : [];
    const item = items.find((candidate) => {
      const requestType = String(candidate?.requestType || candidate?.sourceRequestType || "").trim();
      const dateValue = String(candidate?.targetDate || "").trim();
      return dateValue === targetDate && ["daily_data_excel", "steam_status"].includes(requestType);
    });
    return item?.result && typeof item.result === "object" ? item.result : null;
  }

  async function fetchSettings(targetDate) {
    const requestUrl = new URL(SETTINGS_API_URL, window.location.origin);
    requestUrl.searchParams.set("targetDate", targetDate);
    requestUrl.searchParams.set("_", String(Date.now()));
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: getAuthHeaders(false),
      cache: "no-store"
    });
    const payload = await readJsonResponse(response, "발열량 설정을 불러오지 못했습니다.");
    return payload.setting || null;
  }

  async function fetchAdjustmentBundle(targetDate) {
    const requestUrl = new URL(ADJUSTMENT_API_URL, window.location.origin);
    requestUrl.searchParams.set("targetDate", targetDate);
    requestUrl.searchParams.set("_", String(Date.now()));
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: getAuthHeaders(false),
      cache: "no-store"
    });
    const payload = await readJsonResponse(response, "혼소 조정값을 불러오지 못했습니다.");
    return {
      adjustment: payload.adjustment || null,
      setting: payload.setting || { maxBioLimit: DEFAULT_MAX_BIO_LIMIT }
    };
  }

  async function saveAdjustment(targetDate, result) {
    const body = {
      targetDate,
      mode: result.mode || currentMode,
      fromUnit: result.fromUnit || selectedDirection,
      bioTransferTons: result.bioTransferTons || 0,
      finalBioUnitOne: result.fuelData?.unitOne?.bio,
      finalBioUnitTwo: result.fuelData?.unitTwo?.bio,
      maxBioLimit: result.maxBioLimit,
      excludedBioTons: result.excludedBioTons || 0,
      note: result.exclusionNote || ""
    };
    const response = await fetch(ADJUSTMENT_API_URL, {
      method: "POST",
      headers: getAuthHeaders(true),
      cache: "no-store",
      body: JSON.stringify(body)
    });
    const payload = await readJsonResponse(response, "혼소 조정값을 저장하지 못했습니다.");
    return payload.adjustment || null;
  }

  async function saveMaxBioLimit(maxBioLimit) {
    const response = await fetch(ADJUSTMENT_API_URL, {
      method: "POST",
      headers: getAuthHeaders(true),
      cache: "no-store",
      body: JSON.stringify({ action: "save_setting", maxBioLimit })
    });
    const payload = await readJsonResponse(response, "Bio 최대량 설정을 저장하지 못했습니다.");
    return payload.setting || { maxBioLimit };
  }

  async function clearAdjustment(targetDate) {
    const response = await fetch(ADJUSTMENT_API_URL, {
      method: "POST",
      headers: getAuthHeaders(true),
      cache: "no-store",
      body: JSON.stringify({ targetDate, clear: true })
    });
    await readJsonResponse(response, "혼소 조정값을 원복하지 못했습니다.");
  }

  async function loadContext(targetDate) {
    const [dailyResult, settings, adjustmentBundle] = await Promise.all([
      fetchDailyData(targetDate),
      fetchSettings(targetDate),
      fetchAdjustmentBundle(targetDate)
    ]);
    const baseFuelData = dailyResult ? normalizeFuelData(dailyResult) : null;
    return {
      targetDate,
      baseFuelData,
      settings,
      adjustment: adjustmentBundle.adjustment,
      adjustmentSetting: adjustmentBundle.setting
    };
  }

  function resolveStoredAdjustment(context) {
    const adjustment = context?.adjustment;
    if (!adjustment) {
      return null;
    }
    const mode = String(adjustment.mode || "manual_transfer");
    if (mode === "manual_transfer") {
      return calculateAdjustment(
        context.baseFuelData,
        context.settings,
        adjustment.fromUnit,
        adjustment.bioTransferTons
      );
    }
    const result = calculateFinalBioAdjustment(
      context.baseFuelData,
      context.settings,
      adjustment.finalBioUnitOne,
      adjustment.finalBioUnitTwo,
      {
        mode,
        maxBioLimit: adjustment.maxBioLimit,
        fromUnit: adjustment.fromUnit,
        bioTransferTons: adjustment.bioTransferTons
      }
    );
    if (result?.ok && normalizeNumber(adjustment.excludedBioTons) !== null) {
      result.excludedBioTons = normalizeNumber(adjustment.excludedBioTons);
      result.exclusionNote = String(adjustment.note || result.exclusionNote || "").trim();
    }
    return result;
  }

  function setAdjustmentButtonState(adjustment, result) {
    const button = document.getElementById(BUTTON_ID);
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const active = Boolean(adjustment && result?.ok);
    button.classList.toggle("is-active", active);
    if (!active) {
      button.title = "Bio 사용량 이동·최대혼소·최종값 수정을 한 곳에서 조정";
      return;
    }
    const mode = String(adjustment.mode || "manual_transfer");
    if (mode === "manual_transfer") {
      const from = Number(adjustment.fromUnit) === 2 ? 2 : 1;
      const to = from === 1 ? 2 : 1;
      button.title = `수동 이동 적용 · ${from}호기 → ${to}호기 · Bio ${formatUsagePlain(adjustment.bioTransferTons)} t/d`;
    } else if (mode === "max_auto") {
      button.title = `최대혼소 적용 · 1호기 ${formatUsagePlain(result.fuelData.unitOne.bio)} / 2호기 ${formatUsagePlain(result.fuelData.unitTwo.bio)} t/d`;
    } else {
      button.title = `최종값 수동 수정 적용 · 1호기 ${formatUsagePlain(result.fuelData.unitOne.bio)} / 2호기 ${formatUsagePlain(result.fuelData.unitTwo.bio)} t/d`;
    }
  }

  async function refreshAdjustment() {
    const targetDate = getTargetDate();
    if (!targetDate) {
      setAdjustmentButtonState(null, null);
      currentContext = null;
      return;
    }
    try {
      const context = await loadContext(targetDate);
      currentContext = context;
      if (!context.adjustment) {
        setAdjustmentButtonState(null, null);
        return;
      }
      const result = resolveStoredAdjustment(context);
      setAdjustmentButtonState(context.adjustment, result);
      if (result?.ok) {
        renderAdjustedValues(result);
      } else if (result) {
        console.warn("혼소 조정 적용 보류:", result.message);
      }
    } catch (error) {
      console.warn("혼소 조정 조회 실패:", error);
    }
  }

  function scheduleRefresh(delay = 220) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshAdjustment, delay);
  }

  function createButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.id = BUTTON_ID;
    button.className = "morning-meeting-cofiring-adjustment-button";
    button.textContent = "혼소 조정";
    button.title = "Bio 사용량 이동·최대혼소·최종값 수정을 한 곳에서 조정";
    button.addEventListener("click", openModal);
    return button;
  }

  function createModal() {
    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "morning-meeting-cofiring-adjustment-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <section class="morning-meeting-cofiring-adjustment-dialog" role="dialog" aria-modal="true" aria-labelledby="morningMeetingCofiringAdjustmentTitle">
        <header>
          <div>
            <span>CO-FIRING ADJUSTMENT</span>
            <h4 id="morningMeetingCofiringAdjustmentTitle">혼소 조정</h4>
            <p>수동 이동, 최대혼소 자동 조정, 최종 Bio 수정을 한 화면에서 처리합니다.</p>
          </div>
          <button type="button" class="morning-meeting-cofiring-adjustment-close" data-cofiring-adjustment-close aria-label="닫기">×</button>
        </header>
        <form id="morningMeetingCofiringAdjustmentForm">
          <div class="morning-meeting-cofiring-adjustment-topline">
            <div class="morning-meeting-cofiring-adjustment-date" id="morningMeetingCofiringAdjustmentDate">-</div>
            <div class="morning-meeting-cofiring-adjustment-limit">
              <label for="morningMeetingCofiringMaxBioLimit">호기당 Bio 최대량</label>
              <div><input type="number" id="morningMeetingCofiringMaxBioLimit" min="0.01" max="2000" step="0.01" inputmode="decimal"><small>t/d</small></div>
              <button type="button" id="morningMeetingCofiringMaxBioLimitSave">설정 저장</button>
            </div>
          </div>

          <div class="morning-meeting-cofiring-adjustment-section-title"><strong>수동 이동</strong><span>현재 톤수 이동 기능</span></div>
          <div class="morning-meeting-cofiring-adjustment-direction" role="group" aria-label="Bio 이동 방향">
            <button type="button" data-cofiring-direction="1" class="is-active">1호기 → 2호기</button>
            <button type="button" data-cofiring-direction="2">2호기 → 1호기</button>
          </div>
          <label class="morning-meeting-cofiring-adjustment-input">
            <span>Bio 이동량</span>
            <div><input type="number" id="morningMeetingCofiringAdjustmentTons" min="0.01" max="2000" step="0.01" inputmode="decimal"><small>t/d</small></div>
          </label>

          <div class="morning-meeting-cofiring-adjustment-auto-row">
            <div><strong>최대혼소 자동 조정</strong><span>최대량 초과분을 반대 호기로 넘기고, 양쪽이 초과하면 최대 범위 안에서 자동 조정합니다.</span></div>
            <button type="button" id="morningMeetingCofiringMaxAuto">최대혼소 조정</button>
          </div>

          <div class="morning-meeting-cofiring-adjustment-summary" id="morningMeetingCofiringAdjustmentSummary">이동량을 입력하거나 최대혼소 조정을 실행해 주세요.</div>

          <div class="morning-meeting-cofiring-adjustment-preview-toolbar">
            <strong>최종 조정값</strong>
            <button type="button" id="morningMeetingCofiringFinalEdit" disabled>수정</button>
          </div>
          <div class="morning-meeting-cofiring-adjustment-preview" aria-label="혼소 조정 미리보기">
            <div class="is-head"><span>호기</span><span>Coal</span><span>Bio</span><span>Bio 혼소율</span><span>종합 혼소율</span></div>
            <div><strong>1호기</strong><span id="cofAdjU1Coal">-</span><span id="cofAdjU1Bio">-</span><span id="cofAdjU1BioRatio">-</span><span id="cofAdjU1TotalRatio">-</span></div>
            <div><strong>2호기</strong><span id="cofAdjU2Coal">-</span><span id="cofAdjU2Bio">-</span><span id="cofAdjU2BioRatio">-</span><span id="cofAdjU2TotalRatio">-</span></div>
          </div>

          <div class="morning-meeting-cofiring-final-editor" id="morningMeetingCofiringFinalEditor" hidden>
            <div class="morning-meeting-cofiring-adjustment-section-title"><strong>최종 Bio 수동 수정</strong><span>입력 즉시 Coal과 혼소율을 다시 계산합니다.</span></div>
            <label><span>1호기 Bio</span><div><input type="number" id="morningMeetingCofiringFinalBio1" min="0" max="2000" step="0.01" inputmode="decimal"><small>t/d</small></div></label>
            <label><span>2호기 Bio</span><div><input type="number" id="morningMeetingCofiringFinalBio2" min="0" max="2000" step="0.01" inputmode="decimal"><small>t/d</small></div></label>
          </div>

          <div class="morning-meeting-cofiring-excluded-note" id="morningMeetingCofiringExcludedNote" hidden></div>
          <p class="morning-meeting-cofiring-adjustment-formula">Coal 자동 보정 = (실제 Bio − 최종 Bio) × Bio 발열량 ÷ Coal 발열량</p>
          <footer>
            <button type="button" class="is-reset" id="morningMeetingCofiringAdjustmentReset">원복</button>
            <span class="is-spacer"></span>
            <button type="button" data-cofiring-adjustment-close>취소</button>
            <button type="submit" class="is-primary" id="morningMeetingCofiringAdjustmentSave">적용</button>
          </footer>
        </form>
      </section>
    `;
    document.body.appendChild(modal);
    bindModal(modal);
    return modal;
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal instanceof HTMLElement) {
      modal.hidden = true;
      document.body.classList.remove("is-morning-meeting-cofiring-adjustment-open");
    }
  }

  function setDirection(fromUnit) {
    selectedDirection = Number(fromUnit) === 2 ? 2 : 1;
    document.querySelectorAll("[data-cofiring-direction]").forEach((button) => {
      button.classList.toggle("is-active", Number(button.getAttribute("data-cofiring-direction")) === selectedDirection);
    });
  }

  function previewCell(id, beforeValue, afterValue, formatter) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
      return;
    }
    if (afterValue === null || afterValue === undefined) {
      element.textContent = "-";
      return;
    }
    element.innerHTML = `<small>${formatter(beforeValue)}</small><b>→ ${formatter(afterValue)}</b>`;
  }

  function clearPreview(message = "이동량을 입력하거나 최대혼소 조정을 실행해 주세요.") {
    previewResult = null;
    setText("morningMeetingCofiringAdjustmentSummary", message);
    const summary = document.getElementById("morningMeetingCofiringAdjustmentSummary");
    summary?.classList.remove("is-error");
    ["cofAdjU1Coal", "cofAdjU1Bio", "cofAdjU1BioRatio", "cofAdjU1TotalRatio", "cofAdjU2Coal", "cofAdjU2Bio", "cofAdjU2BioRatio", "cofAdjU2TotalRatio"].forEach((id) => setText(id, "-"));
    const editButton = document.getElementById("morningMeetingCofiringFinalEdit");
    if (editButton instanceof HTMLButtonElement) {
      editButton.disabled = true;
    }
    const note = document.getElementById("morningMeetingCofiringExcludedNote");
    if (note instanceof HTMLElement) {
      note.hidden = true;
      note.textContent = "";
    }
  }

  function renderPreview(result) {
    previewResult = result?.ok ? result : null;
    const summary = document.getElementById("morningMeetingCofiringAdjustmentSummary");
    if (!result?.ok) {
      if (summary instanceof HTMLElement) {
        summary.textContent = result?.message || "조정값을 계산하지 못했습니다.";
        summary.classList.add("is-error");
      }
      return;
    }
    if (summary instanceof HTMLElement) {
      if (result.mode === "manual_transfer") {
        const from = Number(result.fromUnit) === 2 ? 2 : 1;
        summary.textContent = `${from}호기 → ${from === 1 ? 2 : 1}호기 Bio ${formatUsagePlain(result.bioTransferTons)} t/d 이동 · Coal 열량 자동 보정`;
      } else if (result.mode === "max_auto") {
        summary.textContent = `최대혼소 조정 완료 · 1호기 ${formatUsagePlain(result.fuelData.unitOne.bio)} t/d · 2호기 ${formatUsagePlain(result.fuelData.unitTwo.bio)} t/d`;
      } else {
        summary.textContent = `최종 Bio 수동 수정 · 1호기 ${formatUsagePlain(result.fuelData.unitOne.bio)} t/d · 2호기 ${formatUsagePlain(result.fuelData.unitTwo.bio)} t/d`;
      }
      summary.classList.remove("is-error");
    }

    const base = currentContext?.baseFuelData;
    if (base) {
      previewCell("cofAdjU1Coal", base.unitOne.coal, result.fuelData.unitOne.coal, formatUsagePlain);
      previewCell("cofAdjU1Bio", base.unitOne.bio, result.fuelData.unitOne.bio, formatUsagePlain);
      previewCell("cofAdjU1BioRatio", calculateUnitRatios(base.unitOne, currentContext.settings)?.bioRatio, result.unitOneRatios.bioRatio, formatRatio);
      previewCell("cofAdjU1TotalRatio", calculateUnitRatios(base.unitOne, currentContext.settings)?.totalRatio, result.unitOneRatios.totalRatio, formatRatio);
      previewCell("cofAdjU2Coal", base.unitTwo.coal, result.fuelData.unitTwo.coal, formatUsagePlain);
      previewCell("cofAdjU2Bio", base.unitTwo.bio, result.fuelData.unitTwo.bio, formatUsagePlain);
      previewCell("cofAdjU2BioRatio", calculateUnitRatios(base.unitTwo, currentContext.settings)?.bioRatio, result.unitTwoRatios.bioRatio, formatRatio);
      previewCell("cofAdjU2TotalRatio", calculateUnitRatios(base.unitTwo, currentContext.settings)?.totalRatio, result.unitTwoRatios.totalRatio, formatRatio);
    }

    const editButton = document.getElementById("morningMeetingCofiringFinalEdit");
    if (editButton instanceof HTMLButtonElement) {
      editButton.disabled = false;
    }
    const note = document.getElementById("morningMeetingCofiringExcludedNote");
    if (note instanceof HTMLElement) {
      if (result.excludedBioTons > 0.004) {
        note.hidden = false;
        note.textContent = result.exclusionNote;
      } else {
        note.hidden = true;
        note.textContent = "";
      }
    }
  }

  function hideFinalEditor() {
    const editor = document.getElementById("morningMeetingCofiringFinalEditor");
    if (editor instanceof HTMLElement) {
      editor.hidden = true;
    }
  }

  function showFinalEditor() {
    if (!previewResult?.ok) {
      return;
    }
    const editor = document.getElementById("morningMeetingCofiringFinalEditor");
    const inputOne = document.getElementById("morningMeetingCofiringFinalBio1");
    const inputTwo = document.getElementById("morningMeetingCofiringFinalBio2");
    if (editor instanceof HTMLElement) {
      editor.hidden = false;
    }
    if (inputOne instanceof HTMLInputElement) {
      inputOne.value = String(round(previewResult.fuelData.unitOne.bio, 2));
    }
    if (inputTwo instanceof HTMLInputElement) {
      inputTwo.value = String(round(previewResult.fuelData.unitTwo.bio, 2));
    }
    currentMode = "manual_final";
  }

  function updateManualTransferPreview() {
    hideFinalEditor();
    currentMode = "manual_transfer";
    const input = document.getElementById("morningMeetingCofiringAdjustmentTons");
    if (!(input instanceof HTMLInputElement) || !currentContext?.baseFuelData || !currentContext?.settings) {
      return;
    }
    const amount = normalizeNumber(input.value);
    if (amount === null || amount <= 0) {
      clearPreview("Bio 이동량을 입력하면 조정 결과가 표시됩니다.");
      return;
    }
    renderPreview(calculateAdjustment(currentContext.baseFuelData, currentContext.settings, selectedDirection, amount));
  }

  function updateManualFinalPreview() {
    if (!currentContext?.baseFuelData || !currentContext?.settings) {
      return;
    }
    const inputOne = document.getElementById("morningMeetingCofiringFinalBio1");
    const inputTwo = document.getElementById("morningMeetingCofiringFinalBio2");
    const one = normalizeNumber(inputOne?.value);
    const two = normalizeNumber(inputTwo?.value);
    if (one === null || two === null) {
      return;
    }
    currentMode = "manual_final";
    const maxInput = document.getElementById("morningMeetingCofiringMaxBioLimit");
    renderPreview(calculateFinalBioAdjustment(currentContext.baseFuelData, currentContext.settings, one, two, {
      mode: "manual_final",
      maxBioLimit: normalizeNumber(maxInput?.value)
    }));
  }

  async function openModal() {
    const targetDate = getTargetDate();
    if (!targetDate) {
      window.alert("혼소율 계산 기준일을 확인하지 못했습니다. 일일DATA 조회 후 다시 시도해 주세요.");
      return;
    }
    const modal = document.getElementById(MODAL_ID) || createModal();
    if (!(modal instanceof HTMLElement)) {
      return;
    }
    modal.hidden = false;
    document.body.classList.add("is-morning-meeting-cofiring-adjustment-open");
    setText("morningMeetingCofiringAdjustmentDate", targetDate);
    setText("morningMeetingCofiringAdjustmentSummary", "데이터를 확인하는 중입니다...");
    hideFinalEditor();
    try {
      currentContext = await loadContext(targetDate);
      if (!currentContext.baseFuelData || !allRequiredFuelValuesPresent(currentContext.baseFuelData)) {
        throw new Error("Coal / Bio / 유기성 사용량을 모두 확인해 주세요.");
      }
      if (!validSettings(currentContext.settings)) {
        throw new Error("발열량 설정을 먼저 확인해 주세요.");
      }

      const limitInput = document.getElementById("morningMeetingCofiringMaxBioLimit");
      const savedLimit = normalizeNumber(currentContext.adjustmentSetting?.maxBioLimit) || DEFAULT_MAX_BIO_LIMIT;
      if (limitInput instanceof HTMLInputElement) {
        limitInput.value = String(savedLimit);
      }

      const adjustment = currentContext.adjustment;
      const resetButton = document.getElementById("morningMeetingCofiringAdjustmentReset");
      if (resetButton instanceof HTMLButtonElement) {
        resetButton.disabled = !adjustment;
      }
      const transferInput = document.getElementById("morningMeetingCofiringAdjustmentTons");
      if (adjustment) {
        currentMode = String(adjustment.mode || "manual_transfer");
        setDirection(adjustment.fromUnit || 1);
        if (transferInput instanceof HTMLInputElement) {
          transferInput.value = currentMode === "manual_transfer" && adjustment.bioTransferTons
            ? String(adjustment.bioTransferTons)
            : "";
        }
        const result = resolveStoredAdjustment(currentContext);
        if (result?.ok) {
          renderPreview(result);
        } else {
          renderPreview(result || { ok: false, message: "저장된 조정값을 계산하지 못했습니다." });
        }
      } else {
        currentMode = "manual_transfer";
        setDirection(1);
        if (transferInput instanceof HTMLInputElement) {
          transferInput.value = "";
        }
        clearPreview();
      }
    } catch (error) {
      const summary = document.getElementById("morningMeetingCofiringAdjustmentSummary");
      if (summary instanceof HTMLElement) {
        summary.textContent = error?.message || "혼소 조정 데이터를 불러오지 못했습니다.";
        summary.classList.add("is-error");
      }
    }
  }

  function bindModal(modal) {
    modal.querySelectorAll("[data-cofiring-adjustment-close]").forEach((button) => {
      button.addEventListener("click", closeModal);
    });
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
    modal.querySelectorAll("[data-cofiring-direction]").forEach((button) => {
      button.addEventListener("click", () => {
        setDirection(button.getAttribute("data-cofiring-direction"));
        updateManualTransferPreview();
      });
    });

    const amountInput = modal.querySelector("#morningMeetingCofiringAdjustmentTons");
    amountInput?.addEventListener("input", updateManualTransferPreview);

    const limitSave = modal.querySelector("#morningMeetingCofiringMaxBioLimitSave");
    limitSave?.addEventListener("click", async () => {
      const input = document.getElementById("morningMeetingCofiringMaxBioLimit");
      const maxBioLimit = normalizeNumber(input?.value);
      if (maxBioLimit === null || maxBioLimit <= 0 || maxBioLimit > 2000) {
        window.alert("호기당 Bio 최대량을 확인해 주세요.");
        return;
      }
      if (limitSave instanceof HTMLButtonElement) {
        limitSave.disabled = true;
        limitSave.textContent = "저장 중...";
      }
      try {
        const setting = await saveMaxBioLimit(maxBioLimit);
        if (currentContext) {
          currentContext.adjustmentSetting = setting;
        }
        if (typeof window.showToast === "function") {
          window.showToast(`호기당 Bio 최대량을 ${formatUsagePlain(maxBioLimit)} t/d로 저장했습니다.`);
        }
      } catch (error) {
        window.alert(error?.message || "Bio 최대량 설정을 저장하지 못했습니다.");
      } finally {
        if (limitSave instanceof HTMLButtonElement) {
          limitSave.disabled = false;
          limitSave.textContent = "설정 저장";
        }
      }
    });

    const maxAuto = modal.querySelector("#morningMeetingCofiringMaxAuto");
    maxAuto?.addEventListener("click", () => {
      if (!currentContext?.baseFuelData || !currentContext?.settings) {
        return;
      }
      const input = document.getElementById("morningMeetingCofiringMaxBioLimit");
      const maxBioLimit = normalizeNumber(input?.value);
      hideFinalEditor();
      currentMode = "max_auto";
      const result = calculateMaxAutoAdjustment(currentContext.baseFuelData, currentContext.settings, maxBioLimit);
      renderPreview(result);
    });

    const editButton = modal.querySelector("#morningMeetingCofiringFinalEdit");
    editButton?.addEventListener("click", showFinalEditor);
    modal.querySelector("#morningMeetingCofiringFinalBio1")?.addEventListener("input", updateManualFinalPreview);
    modal.querySelector("#morningMeetingCofiringFinalBio2")?.addEventListener("input", updateManualFinalPreview);

    const form = modal.querySelector("#morningMeetingCofiringAdjustmentForm");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const targetDate = getTargetDate();
      if (!targetDate || !previewResult?.ok || !currentContext?.baseFuelData || !currentContext?.settings) {
        window.alert("적용할 최종 조정값을 먼저 확인해 주세요.");
        return;
      }
      const saveButton = document.getElementById("morningMeetingCofiringAdjustmentSave");
      if (saveButton instanceof HTMLButtonElement) {
        saveButton.disabled = true;
        saveButton.textContent = "적용 중...";
      }
      try {
        previewResult.mode = currentMode;
        const adjustment = await saveAdjustment(targetDate, previewResult);
        currentContext.adjustment = adjustment;
        renderAdjustedValues(previewResult);
        setAdjustmentButtonState(adjustment, previewResult);
        closeModal();
        if (typeof window.showToast === "function") {
          window.showToast("혼소 조정을 적용했습니다.");
        }
      } catch (error) {
        console.error("혼소 조정 저장 실패:", error);
        window.alert(error?.message || "혼소 조정값을 저장하지 못했습니다.");
      } finally {
        if (saveButton instanceof HTMLButtonElement) {
          saveButton.disabled = false;
          saveButton.textContent = "적용";
        }
      }
    });

    const resetButton = modal.querySelector("#morningMeetingCofiringAdjustmentReset");
    resetButton?.addEventListener("click", async () => {
      const targetDate = getTargetDate();
      if (!targetDate) {
        return;
      }
      if (!window.confirm("이 날짜의 혼소 조정값을 원복하고 자동 조회값으로 되돌릴까요?")) {
        return;
      }
      if (resetButton instanceof HTMLButtonElement) {
        resetButton.disabled = true;
        resetButton.textContent = "원복 중...";
      }
      try {
        await clearAdjustment(targetDate);
        closeModal();
        setAdjustmentButtonState(null, null);
        currentContext = null;
        previewResult = null;
        if (typeof window.refreshMorningMeetingCofiringCard === "function") {
          await window.refreshMorningMeetingCofiringCard();
        }
        scheduleRefresh(180);
        if (typeof window.showToast === "function") {
          window.showToast("혼소 조정을 원복했습니다.");
        }
      } catch (error) {
        console.error("혼소 조정 원복 실패:", error);
        window.alert(error?.message || "혼소 조정값을 원복하지 못했습니다.");
      } finally {
        if (resetButton instanceof HTMLButtonElement) {
          resetButton.disabled = false;
          resetButton.textContent = "원복";
        }
      }
    });
  }

  function ensureUi() {
    const card = document.getElementById(CARD_ID);
    if (!(card instanceof HTMLElement)) {
      return false;
    }
    const meta = card.querySelector(".morning-meeting-cofiring-card__meta");
    if (!(meta instanceof HTMLElement)) {
      return false;
    }
    let button = document.getElementById(BUTTON_ID);
    if (!(button instanceof HTMLButtonElement)) {
      button = createButton();
      const calorificButton = document.getElementById("morningMeetingCofiringCalorificButton");
      if (calorificButton?.parentElement === meta) {
        meta.insertBefore(button, calorificButton);
      } else {
        meta.appendChild(button);
      }
    }
    if (!(document.getElementById(MODAL_ID) instanceof HTMLElement)) {
      createModal();
    }
    return true;
  }

  function observe() {
    if (observer || !(document.body instanceof HTMLElement)) {
      return;
    }
    observer = new MutationObserver((mutations) => {
      let shouldEnsure = false;
      let shouldRefresh = false;
      for (const mutation of mutations) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target?.parentElement;
        if (target?.id === STATUS_ID || target?.closest?.(`#${STATUS_ID}`)) {
          shouldRefresh = true;
        }
        if (target?.id === DATE_ID || target?.closest?.(`#${DATE_ID}`)) {
          shouldRefresh = true;
        }
        if ([...mutation.addedNodes].some((node) => node instanceof Element && (node.id === CARD_ID || node.querySelector?.(`#${CARD_ID}`)))) {
          shouldEnsure = true;
        }
      }
      if (shouldEnsure) {
        ensureUi();
      }
      if (shouldRefresh) {
        scheduleRefresh(260);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  }

  function initialize() {
    const ready = ensureUi();
    observe();
    if (ready) {
      scheduleRefresh(350);
      return;
    }
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (ensureUi()) {
        window.clearInterval(timer);
        scheduleRefresh(220);
        return;
      }
      if (attempts >= 40) {
        window.clearInterval(timer);
      }
    }, 250);
  }

  window.calculateMorningMeetingCofiringAdjustment = calculateAdjustment;
  window.calculateMorningMeetingCofiringFinalBioAdjustment = calculateFinalBioAdjustment;
  window.calculateMorningMeetingCofiringMaxAdjustment = calculateMaxAutoAdjustment;
  window.refreshMorningMeetingCofiringAdjustment = refreshAdjustment;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
