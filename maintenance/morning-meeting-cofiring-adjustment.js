(() => {
  "use strict";

  if (window.__morningMeetingCofiringAdjustmentV1Installed === true) {
    return;
  }
  window.__morningMeetingCofiringAdjustmentV1Installed = true;

  const CARD_ID = "efficiencyMorningMeetingAutoCofiringCard";
  const STATUS_ID = "efficiencyMorningMeetingCofiringStatus";
  const DATE_ID = "efficiencyMorningMeetingCofiringDate";
  const BUTTON_ID = "morningMeetingCofiringAdjustmentButton";
  const MODAL_ID = "morningMeetingCofiringAdjustmentModal";
  const ADJUSTMENT_API_URL = "/api/morning-meeting-cofiring-adjustments";
  const SETTINGS_API_URL = "/api/morning-meeting-cofiring-settings";
  const OIS_REQUEST_API_URL = "/api/ois-data-requests";
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

  function calculateAdjustment(baseFuelData, settings, fromUnit, bioTransferTons) {
    const fuelData = cloneFuelData(baseFuelData);
    const direction = Number(fromUnit) === 2 ? 2 : 1;
    const transfer = normalizeNumber(bioTransferTons);
    const coalHv = normalizeNumber(settings?.coalKcalPerKg);
    const bioHv = normalizeNumber(settings?.bioKcalPerKg);

    if (!allRequiredFuelValuesPresent(fuelData)) {
      return { ok: false, message: "Coal / Bio / 유기성 사용량을 모두 확인해 주세요." };
    }
    if (!validSettings(settings) || coalHv === null || bioHv === null) {
      return { ok: false, message: "발열량 설정을 먼저 확인해 주세요." };
    }
    if (transfer === null || transfer <= 0) {
      return { ok: false, message: "Bio 이동량을 0보다 크게 입력해 주세요." };
    }

    const source = direction === 1 ? fuelData.unitOne : fuelData.unitTwo;
    const destination = direction === 1 ? fuelData.unitTwo : fuelData.unitOne;
    const coalEquivalentTons = transfer * bioHv / coalHv;

    if (source.bio + 1e-9 < transfer) {
      return { ok: false, message: `${direction}호기 Bio 사용량보다 많은 양을 이동할 수 없습니다.` };
    }
    if (destination.coal + 1e-9 < coalEquivalentTons) {
      return { ok: false, message: `${direction === 1 ? 2 : 1}호기 Coal 사용량이 자동 보정량보다 작습니다.` };
    }

    source.bio = round(source.bio - transfer);
    destination.bio = round(destination.bio + transfer);
    source.coal = round(source.coal + coalEquivalentTons);
    destination.coal = round(destination.coal - coalEquivalentTons);

    const unitOneRatios = calculateUnitRatios(fuelData.unitOne, settings);
    const unitTwoRatios = calculateUnitRatios(fuelData.unitTwo, settings);
    if (!unitOneRatios || !unitTwoRatios) {
      return { ok: false, message: "조정 후 혼소율을 계산하지 못했습니다." };
    }

    return {
      ok: true,
      fuelData,
      coalEquivalentTons: round(coalEquivalentTons),
      unitOneRatios,
      unitTwoRatios
    };
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

  async function fetchAdjustment(targetDate) {
    const requestUrl = new URL(ADJUSTMENT_API_URL, window.location.origin);
    requestUrl.searchParams.set("targetDate", targetDate);
    requestUrl.searchParams.set("_", String(Date.now()));
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: getAuthHeaders(false),
      cache: "no-store"
    });
    const payload = await readJsonResponse(response, "혼소 조정값을 불러오지 못했습니다.");
    return payload.adjustment || null;
  }

  async function saveAdjustment(targetDate, fromUnit, bioTransferTons) {
    const response = await fetch(ADJUSTMENT_API_URL, {
      method: "POST",
      headers: getAuthHeaders(true),
      cache: "no-store",
      body: JSON.stringify({ targetDate, fromUnit, bioTransferTons })
    });
    const payload = await readJsonResponse(response, "혼소 조정값을 저장하지 못했습니다.");
    return payload.adjustment || null;
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
    const [dailyResult, settings, adjustment] = await Promise.all([
      fetchDailyData(targetDate),
      fetchSettings(targetDate),
      fetchAdjustment(targetDate)
    ]);
    const baseFuelData = dailyResult ? normalizeFuelData(dailyResult) : null;
    return { targetDate, baseFuelData, settings, adjustment };
  }

  function setAdjustmentButtonState(adjustment, result) {
    const button = document.getElementById(BUTTON_ID);
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    const active = adjustment && normalizeNumber(adjustment.bioTransferTons) > 0;
    button.classList.toggle("is-active", Boolean(active));
    if (active && result?.ok) {
      const from = Number(adjustment.fromUnit) === 2 ? 2 : 1;
      const to = from === 1 ? 2 : 1;
      button.title = `조정 적용 · ${from}호기 → ${to}호기 · Bio ${formatUsagePlain(adjustment.bioTransferTons)} t/d · Coal ±${formatUsagePlain(result.coalEquivalentTons)} t/d`;
    } else {
      button.title = "Bio 사용량을 호기 간 이동하고 발열량 기준으로 Coal 사용량을 자동 보정";
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
      const result = calculateAdjustment(
        context.baseFuelData,
        context.settings,
        context.adjustment.fromUnit,
        context.adjustment.bioTransferTons
      );
      setAdjustmentButtonState(context.adjustment, result);
      if (result.ok) {
        renderAdjustedValues(result);
      } else {
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
    button.title = "Bio 사용량을 호기 간 이동하고 발열량 기준으로 Coal 사용량을 자동 보정";
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
            <p>Bio 이동량을 입력하면 같은 열량만큼 Coal 사용량을 자동 보정합니다.</p>
          </div>
          <button type="button" class="morning-meeting-cofiring-adjustment-close" data-cofiring-adjustment-close aria-label="닫기">×</button>
        </header>
        <form id="morningMeetingCofiringAdjustmentForm">
          <div class="morning-meeting-cofiring-adjustment-date" id="morningMeetingCofiringAdjustmentDate">-</div>
          <div class="morning-meeting-cofiring-adjustment-direction" role="group" aria-label="Bio 이동 방향">
            <button type="button" data-cofiring-direction="1" class="is-active">1호기 → 2호기</button>
            <button type="button" data-cofiring-direction="2">2호기 → 1호기</button>
          </div>
          <label class="morning-meeting-cofiring-adjustment-input">
            <span>Bio 이동량</span>
            <div><input type="number" id="morningMeetingCofiringAdjustmentTons" min="0.01" max="2000" step="0.01" inputmode="decimal" required><small>t/d</small></div>
          </label>
          <div class="morning-meeting-cofiring-adjustment-summary" id="morningMeetingCofiringAdjustmentSummary">이동량을 입력하면 조정 결과가 표시됩니다.</div>
          <div class="morning-meeting-cofiring-adjustment-preview" aria-label="혼소 조정 미리보기">
            <div class="is-head"><span>호기</span><span>Coal</span><span>Bio</span><span>Bio 혼소율</span><span>종합 혼소율</span></div>
            <div><strong>1호기</strong><span id="cofAdjU1Coal">-</span><span id="cofAdjU1Bio">-</span><span id="cofAdjU1BioRatio">-</span><span id="cofAdjU1TotalRatio">-</span></div>
            <div><strong>2호기</strong><span id="cofAdjU2Coal">-</span><span id="cofAdjU2Bio">-</span><span id="cofAdjU2BioRatio">-</span><span id="cofAdjU2TotalRatio">-</span></div>
          </div>
          <p class="morning-meeting-cofiring-adjustment-formula">Coal 보정량 = Bio 이동량 × Bio 발열량 ÷ Coal 발열량</p>
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
    updatePreview();
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

  function updatePreview() {
    const input = document.getElementById("morningMeetingCofiringAdjustmentTons");
    const summary = document.getElementById("morningMeetingCofiringAdjustmentSummary");
    if (!(input instanceof HTMLInputElement) || !currentContext?.baseFuelData || !currentContext?.settings) {
      return;
    }
    const amount = normalizeNumber(input.value);
    if (amount === null || amount <= 0) {
      if (summary instanceof HTMLElement) {
        summary.textContent = "이동량을 입력하면 조정 결과가 표시됩니다.";
        summary.classList.remove("is-error");
      }
      ["cofAdjU1Coal", "cofAdjU1Bio", "cofAdjU1BioRatio", "cofAdjU1TotalRatio", "cofAdjU2Coal", "cofAdjU2Bio", "cofAdjU2BioRatio", "cofAdjU2TotalRatio"].forEach((id) => setText(id, "-"));
      return;
    }
    const result = calculateAdjustment(currentContext.baseFuelData, currentContext.settings, selectedDirection, amount);
    if (!result.ok) {
      if (summary instanceof HTMLElement) {
        summary.textContent = result.message;
        summary.classList.add("is-error");
      }
      return;
    }
    if (summary instanceof HTMLElement) {
      const toUnit = selectedDirection === 1 ? 2 : 1;
      summary.textContent = `${selectedDirection}호기 → ${toUnit}호기 Bio ${formatUsagePlain(amount)} t/d · Coal 자동 보정 ±${formatUsagePlain(result.coalEquivalentTons)} t/d`;
      summary.classList.remove("is-error");
    }
    const base = currentContext.baseFuelData;
    previewCell("cofAdjU1Coal", base.unitOne.coal, result.fuelData.unitOne.coal, formatUsagePlain);
    previewCell("cofAdjU1Bio", base.unitOne.bio, result.fuelData.unitOne.bio, formatUsagePlain);
    previewCell("cofAdjU1BioRatio", calculateUnitRatios(base.unitOne, currentContext.settings)?.bioRatio, result.unitOneRatios.bioRatio, formatRatio);
    previewCell("cofAdjU1TotalRatio", calculateUnitRatios(base.unitOne, currentContext.settings)?.totalRatio, result.unitOneRatios.totalRatio, formatRatio);
    previewCell("cofAdjU2Coal", base.unitTwo.coal, result.fuelData.unitTwo.coal, formatUsagePlain);
    previewCell("cofAdjU2Bio", base.unitTwo.bio, result.fuelData.unitTwo.bio, formatUsagePlain);
    previewCell("cofAdjU2BioRatio", calculateUnitRatios(base.unitTwo, currentContext.settings)?.bioRatio, result.unitTwoRatios.bioRatio, formatRatio);
    previewCell("cofAdjU2TotalRatio", calculateUnitRatios(base.unitTwo, currentContext.settings)?.totalRatio, result.unitTwoRatios.totalRatio, formatRatio);
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
    try {
      currentContext = await loadContext(targetDate);
      if (!currentContext.baseFuelData || !allRequiredFuelValuesPresent(currentContext.baseFuelData)) {
        throw new Error("Coal / Bio / 유기성 사용량을 모두 확인해 주세요.");
      }
      if (!validSettings(currentContext.settings)) {
        throw new Error("발열량 설정을 먼저 확인해 주세요.");
      }
      const adjustment = currentContext.adjustment;
      setDirection(adjustment?.fromUnit || 1);
      const input = document.getElementById("morningMeetingCofiringAdjustmentTons");
      if (input instanceof HTMLInputElement) {
        input.value = adjustment?.bioTransferTons ? String(adjustment.bioTransferTons) : "";
      }
      const resetButton = document.getElementById("morningMeetingCofiringAdjustmentReset");
      if (resetButton instanceof HTMLButtonElement) {
        resetButton.disabled = !adjustment;
      }
      updatePreview();
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
      button.addEventListener("click", () => setDirection(button.getAttribute("data-cofiring-direction")));
    });
    const amountInput = modal.querySelector("#morningMeetingCofiringAdjustmentTons");
    amountInput?.addEventListener("input", updatePreview);

    const form = modal.querySelector("#morningMeetingCofiringAdjustmentForm");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const targetDate = getTargetDate();
      const input = document.getElementById("morningMeetingCofiringAdjustmentTons");
      const amount = normalizeNumber(input?.value);
      if (!targetDate || amount === null || amount <= 0 || !currentContext?.baseFuelData || !currentContext?.settings) {
        window.alert("Bio 이동량과 계산 기준 데이터를 확인해 주세요.");
        return;
      }
      const result = calculateAdjustment(currentContext.baseFuelData, currentContext.settings, selectedDirection, amount);
      if (!result.ok) {
        window.alert(result.message);
        return;
      }
      const saveButton = document.getElementById("morningMeetingCofiringAdjustmentSave");
      if (saveButton instanceof HTMLButtonElement) {
        saveButton.disabled = true;
        saveButton.textContent = "적용 중...";
      }
      try {
        const adjustment = await saveAdjustment(targetDate, selectedDirection, amount);
        currentContext.adjustment = adjustment;
        renderAdjustedValues(result);
        setAdjustmentButtonState(adjustment, result);
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
  window.refreshMorningMeetingCofiringAdjustment = refreshAdjustment;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
