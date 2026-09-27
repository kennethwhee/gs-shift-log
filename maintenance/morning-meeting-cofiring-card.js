(() => {
  "use strict";

  if (window.__morningMeetingCofiringCardV1Installed === true) {
    return;
  }

  window.__morningMeetingCofiringCardV1Installed = true;

  const CARD_ID = "efficiencyMorningMeetingAutoCofiringCard";
  const SOURCE_CARD_ID = "efficiencyMorningMeetingAutoSiloCard";
  const SETTINGS_MODAL_ID = "morningMeetingCofiringSettingsModal";
  const SETTINGS_API_URL = "/api/morning-meeting-cofiring-settings";

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

  const watchedElementIds = [
    "efficiencyMorningMeetingAutoDailyPowerDate",
    "efficiencyMorningMeetingAutoSteamDate",
    "efficiencyMorningMeetingWaterDate"
  ];

  let activeRefreshToken = 0;
  let refreshTimerId = null;
  let layoutObserver = null;
  const boundObservers = new Map();
  let currentSettings = null;
  let currentTargetDate = "";

  function getAuthHeaders(jsonRequest = false) {
    const baseHeaders =
      typeof window.getShiftLogAuthHeaders === "function"
        ? window.getShiftLogAuthHeaders()
        : {};

    return {
      ...baseHeaders,
      Accept: "application/json",
      ...(jsonRequest
        ? {
            "Content-Type": "application/json"
          }
        : {})
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

  function normalizeNumber(value) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return null;
    }

    const numericValue = Number(value);

    return Number.isFinite(numericValue) ? numericValue : null;
  }

  function formatUsage(value) {
    const numericValue = normalizeNumber(value);

    if (numericValue === null) {
      return "-";
    }

    return `${numericValue.toLocaleString("ko-KR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} t/d`;
  }

  function formatRatio(value) {
    const numericValue = normalizeNumber(value);

    if (numericValue === null) {
      return "-";
    }

    return `${numericValue.toLocaleString("ko-KR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}%`;
  }

  function getDateFromElement(element) {
    if (!(element instanceof HTMLElement)) {
      return "";
    }

    const candidates = [
      element.getAttribute("data-date"),
      element.getAttribute("datetime"),
      element instanceof HTMLInputElement ? element.value : "",
      element.textContent
    ];

    for (const candidate of candidates) {
      const match = String(candidate || "").match(/\b(20\d{2}-\d{2}-\d{2})\b/);

      if (match) {
        return match[1];
      }
    }

    return "";
  }

  function closedProvider() {
    return window.morningMeetingClosedCofiring || null;
  }

  function getTargetDate() {
    if (closedProvider()) {
      return closedProvider().targetDate();
    }
    const preferredIds = [
      "efficiencyMorningMeetingAutoDailyPowerDate",
      "efficiencyMorningMeetingAutoSteamDate",
      "efficiencyMorningMeetingWaterDate"
    ];

    for (const id of preferredIds) {
      const dateValue = getDateFromElement(document.getElementById(id));

      if (dateValue) {
        return dateValue;
      }
    }

    return "";
  }

  function isSelectedDateResetActive(targetDate) {
    return (
      Boolean(targetDate) &&
      (closedProvider()?.isBlocked(targetDate) === true ||
        window.isMorningMeetingSelectedDateResetActive?.(targetDate) === true)
    );
  }

  function setValue(id, text) {
    const element = document.getElementById(id);

    if (element instanceof HTMLElement) {
      element.textContent = text;
    }
  }

  function clearRatios() {
    [
      VALUE_IDS.unitOneBioRatio,
      VALUE_IDS.unitTwoBioRatio,
      VALUE_IDS.unitOneOrganicRatio,
      VALUE_IDS.unitTwoOrganicRatio,
      VALUE_IDS.unitOneTotalRatio,
      VALUE_IDS.unitTwoTotalRatio
    ].forEach((id) => setValue(id, "-"));
  }

  function clearAllValues() {
    Object.values(VALUE_IDS).forEach((id) => setValue(id, "-"));
  }

  function setStatus(state, text) {
    const badge = document.getElementById("efficiencyMorningMeetingCofiringStatus");

    if (!(badge instanceof HTMLElement)) {
      return;
    }

    badge.className = "efficiency-morning-meeting-auto-card__badge morning-meeting-cofiring-status";

    if (state) {
      badge.classList.add(`is-${state}`);
    }

    badge.textContent = text;
  }

  function setCardDate(targetDate) {
    const dateElement = document.getElementById("efficiencyMorningMeetingCofiringDate");

    if (dateElement instanceof HTMLElement) {
      dateElement.textContent =
        targetDate ? `${targetDate}\n마감자료` : "-";
      dateElement.title = "혼소율 메뉴에서 저장한 선택일의 마감자료";
    }
  }

  function createCard() {
    const card = document.createElement("article");
    card.id = CARD_ID;
    card.className = "efficiency-morning-meeting-auto-card morning-meeting-cofiring-card";
    card.innerHTML = `
      <header class="efficiency-morning-meeting-auto-card__header">
        <div>
          <span>CO-FIRING</span>
          <strong>혼소율 현황</strong>
        </div>

        <div class="efficiency-morning-meeting-auto-card__meta morning-meeting-cofiring-card__meta">
          <small id="efficiencyMorningMeetingCofiringDate">-</small>
          <span
            class="efficiency-morning-meeting-auto-card__badge morning-meeting-cofiring-status"
            id="efficiencyMorningMeetingCofiringStatus"
          >
            조회 대기
          </span>
          <button
            type="button"
            class="morning-meeting-daily-mini-refresh"
            id="morningMeetingCofiringRefreshButton"
            title="혼소율 자료 재조회"
            aria-label="혼소율 자료 재조회"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 6v5h-5"></path>
              <path d="M19.2 15a8 8 0 1 1-.6-7.6L20 11"></path>
            </svg>
          </button>
          <button
            type="button"
            class="morning-meeting-cofiring-calorific-button"
            id="morningMeetingCofiringCalorificButton"
            title="Coal / Bio-SRF / 유기성 고형연료 발열량 설정"
          >
            발열량
          </button>
        </div>
      </header>

      <div class="efficiency-morning-meeting-auto-card__body morning-meeting-cofiring-card__body">
        <section class="morning-meeting-cofiring-table is-bio" aria-label="Coal Bio 사용량 및 혼소율">
          <div class="morning-meeting-cofiring-table__head" aria-hidden="true">
            <span></span>
            <span>Coal 사용량</span>
            <span>Bio 사용량</span>
            <span>Bio 혼소율</span>
          </div>
          <div class="morning-meeting-cofiring-table__row">
            <strong class="is-unit">1호기</strong>
            <strong id="${VALUE_IDS.unitOneCoal}">-</strong>
            <strong id="${VALUE_IDS.unitOneBio}">-</strong>
            <strong id="${VALUE_IDS.unitOneBioRatio}" class="is-ratio">-</strong>
          </div>
          <div class="morning-meeting-cofiring-table__row">
            <strong class="is-unit">2호기</strong>
            <strong id="${VALUE_IDS.unitTwoCoal}">-</strong>
            <strong id="${VALUE_IDS.unitTwoBio}">-</strong>
            <strong id="${VALUE_IDS.unitTwoBioRatio}" class="is-ratio">-</strong>
          </div>
        </section>

        <section class="morning-meeting-cofiring-table is-organic" aria-label="유기성 투입량 및 종합 혼소율">
          <div class="morning-meeting-cofiring-table__head" aria-hidden="true">
            <span></span>
            <span>유기성 투입량</span>
            <span>유기성·축분 혼소율</span>
            <span>종합 혼소율</span>
          </div>
          <div class="morning-meeting-cofiring-table__row">
            <strong class="is-unit">1호기</strong>
            <strong id="${VALUE_IDS.unitOneOrganic}">-</strong>
            <strong id="${VALUE_IDS.unitOneOrganicRatio}" class="is-ratio">-</strong>
            <strong id="${VALUE_IDS.unitOneTotalRatio}" class="is-total-ratio">-</strong>
          </div>
          <div class="morning-meeting-cofiring-table__row">
            <strong class="is-unit">2호기</strong>
            <strong id="${VALUE_IDS.unitTwoOrganic}">-</strong>
            <strong id="${VALUE_IDS.unitTwoOrganicRatio}" class="is-ratio">-</strong>
            <strong id="${VALUE_IDS.unitTwoTotalRatio}" class="is-total-ratio">-</strong>
          </div>
        </section>
      </div>
    `;

    return card;
  }

  function createSettingsModal() {
    const modal = document.createElement("div");
    modal.id = SETTINGS_MODAL_ID;
    modal.className = "morning-meeting-cofiring-settings-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <section
        class="morning-meeting-cofiring-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="morningMeetingCofiringSettingsTitle"
      >
        <header>
          <div>
            <span>CALORIFIC VALUE</span>
            <h4 id="morningMeetingCofiringSettingsTitle">발열량 설정</h4>
            <p>적용 시작일부터 이후 날짜의 혼소율 계산에 사용합니다.</p>
          </div>
          <button
            type="button"
            class="morning-meeting-cofiring-settings-close"
            data-cofiring-settings-close
            aria-label="닫기"
          >×</button>
        </header>

        <form id="morningMeetingCofiringSettingsForm">
          <label class="is-date">
            <span>적용 시작일</span>
            <input type="date" id="morningMeetingCofiringEffectiveDate" required>
          </label>

          <div class="morning-meeting-cofiring-settings-grid morning-meeting-cofiring-settings-grid-v6r2">

            <label class="morning-meeting-cofiring-fuel-v6r2">
              <span>Coal</span>
              <div>
                <input
                  type="number"
                  id="morningMeetingCofiringCoalHv"
                  min="1"
                  max="10000"
                  step="0.01"
                  required
                >
                <small>kcal/kg</small>
              </div>
            </label>

            <label class="morning-meeting-cofiring-fuel-v6r2">
              <span>Bio-SRF</span>
              <div>
                <input
                  type="number"
                  id="morningMeetingCofiringBioHv"
                  min="1"
                  max="10000"
                  step="0.01"
                  required
                >
                <small>kcal/kg</small>
              </div>
            </label>

            <label class="morning-meeting-cofiring-fuel-v6r2">
              <span>유기성 고형연료</span>
              <div>
                <input
                  type="number"
                  id="morningMeetingCofiringOrganicHv"
                  min="1"
                  max="10000"
                  step="0.01"
                  required
                >
                <small>kcal/kg</small>
              </div>
            </label>

            <label class="morning-meeting-cofiring-fuel-v6r2">
              <span>축분</span>
              <div>
                <input
                  type="number"
                  id="morningMeetingCofiringManureHv"
                  min="1"
                  max="10000"
                  step="0.01"
                  required
                >
                <small>kcal/kg</small>
              </div>
            </label>

          </div>

          <p class="morning-meeting-cofiring-settings-current" id="morningMeetingCofiringSettingsCurrent">현재 적용값 없음</p>

          <footer>
            <button type="button" data-cofiring-settings-close>취소</button>
            <button type="submit" class="is-primary" id="morningMeetingCofiringSettingsSaveButton">저장</button>
          </footer>
        </form>
      </section>
    `;

    document.body.appendChild(modal);
    bindSettingsModal(modal);

    return modal;
  }

  function ensureCard() {
    const sourceCard = document.getElementById(SOURCE_CARD_ID);

    if (!(sourceCard instanceof HTMLElement) || !(sourceCard.parentElement instanceof HTMLElement)) {
      return null;
    }

    let card = document.getElementById(CARD_ID);

    if (!(card instanceof HTMLElement)) {
      card = createCard();
    }

    if (card.parentElement !== sourceCard.parentElement || card.previousElementSibling !== sourceCard) {
      sourceCard.insertAdjacentElement("afterend", card);
    }

    let modal = document.getElementById(SETTINGS_MODAL_ID);

    if (!(modal instanceof HTMLElement) && !closedProvider()) {
      modal = createSettingsModal();
    }

    const settingsButton = document.getElementById("morningMeetingCofiringCalorificButton");

    if (settingsButton instanceof HTMLButtonElement && settingsButton.dataset.bound !== "true") {
      settingsButton.addEventListener("click", openSettingsModal);
      settingsButton.dataset.bound = "true";
    }

    if (settingsButton instanceof HTMLButtonElement && closedProvider()) {
      settingsButton.disabled = true;
      settingsButton.title = "발열량은 혼소율 메뉴에서 변경한 뒤 마감자료를 다시 저장해 주세요.";
      closeSettingsModal();
    }

    return card;
  }

  function closeSettingsModal() {
    const modal = document.getElementById(SETTINGS_MODAL_ID);

    if (modal instanceof HTMLElement) {
      modal.hidden = true;
      document.body.classList.remove("is-morning-meeting-cofiring-settings-open");
    }
  }

  function formatCalorificValue(value) {
    const numericValue = normalizeNumber(value);

    return numericValue === null
      ? ""
      : String(Math.round(numericValue * 100) / 100);
  }

  function populateSettingsForm(targetDate, settings) {
    const effectiveDateInput = document.getElementById("morningMeetingCofiringEffectiveDate");
    const coalInput = document.getElementById("morningMeetingCofiringCoalHv");
    const bioInput = document.getElementById("morningMeetingCofiringBioHv");
    const organicInput = document.getElementById("morningMeetingCofiringOrganicHv");
    const currentText = document.getElementById("morningMeetingCofiringSettingsCurrent");

    if (effectiveDateInput instanceof HTMLInputElement) {
      effectiveDateInput.value = targetDate || "";
    }

    if (coalInput instanceof HTMLInputElement) {
      coalInput.value = formatCalorificValue(settings?.coalKcalPerKg);
    }

    if (bioInput instanceof HTMLInputElement) {
      bioInput.value = formatCalorificValue(settings?.bioKcalPerKg);
    }

    if (organicInput instanceof HTMLInputElement) {
      organicInput.value =
        formatCalorificValue(
          settings?.organicKcalPerKg
        );
    }

    const manureInput =
      document.getElementById(
        "morningMeetingCofiringManureHv"
      );

    if (manureInput instanceof HTMLInputElement) {
      manureInput.value =
        formatCalorificValue(
          settings?.manureKcalPerKg
        );
    }

    if (currentText instanceof HTMLElement) {
      currentText.textContent = settings
        ? `현재 적용값: ${settings.effectiveDate}부터 · Coal ${formatCalorificValue(settings.coalKcalPerKg)} / Bio ${formatCalorificValue(settings.bioKcalPerKg)} / 유기성 ${formatCalorificValue(settings.organicKcalPerKg)} / 축분 ${formatCalorificValue(settings.manureKcalPerKg)} kcal/kg`
        : "현재 적용값 없음";
    }
  }

  async function openSettingsModal() {
    if (closedProvider()) {
      closeSettingsModal();
      return;
    }
    ensureCard();

    const targetDate = getTargetDate();

    if (!targetDate) {
      window.alert("혼소율 계산 기준일을 확인하지 못했습니다. 기준일을 선택한 뒤 다시 시도해 주세요.");
      return;
    }

    const modal = document.getElementById(SETTINGS_MODAL_ID);

    if (!(modal instanceof HTMLElement)) {
      return;
    }

    modal.hidden = false;
    document.body.classList.add("is-morning-meeting-cofiring-settings-open");
    populateSettingsForm(targetDate, currentTargetDate === targetDate ? currentSettings : null);

    try {
      const settings = await fetchCalorificSettings(targetDate);
      if (closedProvider() || getTargetDate() !== targetDate) return;
      populateSettingsForm(targetDate, settings);
    } catch (error) {
      console.warn("혼소율 발열량 설정 조회 실패:", error);
    }
  }

  function bindSettingsModal(modal) {
    modal.querySelectorAll("[data-cofiring-settings-close]").forEach((button) => {
      button.addEventListener("click", closeSettingsModal);
    });

    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeSettingsModal();
      }
    });

    const form = modal.querySelector("#morningMeetingCofiringSettingsForm");

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (closedProvider()) {
        closeSettingsModal();
        return;
      }

      const effectiveDate = String(document.getElementById("morningMeetingCofiringEffectiveDate")?.value || "").trim();
      const coalKcalPerKg = normalizeNumber(document.getElementById("morningMeetingCofiringCoalHv")?.value);
      const bioKcalPerKg = normalizeNumber(document.getElementById("morningMeetingCofiringBioHv")?.value);
      const organicKcalPerKg =
      normalizeNumber(
        document.getElementById(
          "morningMeetingCofiringOrganicHv"
        )?.value
      );

    const manureKcalPerKg =
      normalizeNumber(
        document.getElementById(
          "morningMeetingCofiringManureHv"
        )?.value
      );
      const saveButton = document.getElementById("morningMeetingCofiringSettingsSaveButton");

      if (
        !/^20\d{2}-\d{2}-\d{2}$/.test(effectiveDate) ||
        ![coalKcalPerKg, bioKcalPerKg, organicKcalPerKg, manureKcalPerKg].every(
          (value) => value !== null && value > 0 && value <= 10000
        )
      ) {
        window.alert("적용 시작일과 각 연료 발열량(kcal/kg)을 확인해 주세요.");
        return;
      }

      if (saveButton instanceof HTMLButtonElement) {
        saveButton.disabled = true;
        saveButton.textContent = "저장 중...";
      }

      try {
        const response = await fetch(SETTINGS_API_URL, {
          method: "POST",
          headers: getAuthHeaders(true),
          cache: "no-store",
          body: JSON.stringify({
            effectiveDate,
            coalKcalPerKg,
            bioKcalPerKg,
            organicKcalPerKg,
          manureKcalPerKg
        })
        });

        await readJsonResponse(response, "발열량 설정을 저장하지 못했습니다.");
        closeSettingsModal();

        if (typeof window.showToast === "function") {
          window.showToast("혼소율 발열량을 저장했습니다.");
        }

        scheduleRefresh(0);
      } catch (error) {
        console.error("혼소율 발열량 저장 실패:", error);
        window.alert(error?.message || "발열량 설정을 저장하지 못했습니다.");
      } finally {
        if (saveButton instanceof HTMLButtonElement) {
          saveButton.disabled = false;
          saveButton.textContent = "저장";
        }
      }
    });
  }

  async function fetchCalorificSettings(targetDate) {
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

  function hasCofiringFields(result) {
    if (!result || typeof result !== "object") {
      return false;
    }

    const keys = [
      "coalUsageUnitOne",
      "coalUsageUnitTwo",
      "bioUsageUnitOne",
      "bioUsageUnitTwo",
      "organicUsageUnitOne",
      "organicUsageUnitTwo"
    ];

    return keys.every((key) => Object.prototype.hasOwnProperty.call(result, key));
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

  function calculateCofiring(unitData, settings) {
    const coalUsage = normalizeNumber(unitData?.coal);
    const bioUsage = normalizeNumber(unitData?.bio);
    const organicUsage = normalizeNumber(unitData?.organic);
    const coalHv = normalizeNumber(settings?.coalKcalPerKg);
    const bioHv = normalizeNumber(settings?.bioKcalPerKg);
    const organicHv =
      normalizeNumber(
        settings?.organicKcalPerKg
      );

    const manureHv =
      normalizeNumber(
        settings?.manureKcalPerKg
      );

    if (
      [coalUsage, bioUsage, organicUsage, coalHv, bioHv, organicHv].some((value) => value === null) ||
      [coalUsage, bioUsage, organicUsage].some((value) => value < 0) ||
      [coalHv, bioHv, organicHv].some((value) => value <= 0)
    ) {
      return null;
    }

    const coalHeat = coalUsage * coalHv;
    const bioHeat = bioUsage * bioHv;
    const organicHeat = organicUsage * organicHv;
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

  function renderFuelUsage(fuelData) {
    setValue(VALUE_IDS.unitOneCoal, formatUsage(fuelData.unitOne.coal));
    setValue(VALUE_IDS.unitOneBio, formatUsage(fuelData.unitOne.bio));
    setValue(VALUE_IDS.unitTwoCoal, formatUsage(fuelData.unitTwo.coal));
    setValue(VALUE_IDS.unitTwoBio, formatUsage(fuelData.unitTwo.bio));
    setValue(VALUE_IDS.unitOneOrganic, formatUsage(fuelData.unitOne.organic));
    setValue(VALUE_IDS.unitTwoOrganic, formatUsage(fuelData.unitTwo.organic));
  }

  function renderCalculatedRatios(fuelData, settings) {
    const unitOneResult = calculateCofiring(fuelData.unitOne, settings);
    const unitTwoResult = calculateCofiring(fuelData.unitTwo, settings);

    if (!unitOneResult || !unitTwoResult) {
      clearRatios();
      return false;
    }

    setValue(VALUE_IDS.unitOneBioRatio, formatRatio(unitOneResult.bioRatio));
    setValue(VALUE_IDS.unitTwoBioRatio, formatRatio(unitTwoResult.bioRatio));
    setValue(VALUE_IDS.unitOneOrganicRatio, formatRatio(unitOneResult.organicRatio));
    setValue(VALUE_IDS.unitTwoOrganicRatio, formatRatio(unitTwoResult.organicRatio));
    setValue(VALUE_IDS.unitOneTotalRatio, formatRatio(unitOneResult.totalRatio));
    setValue(VALUE_IDS.unitTwoTotalRatio, formatRatio(unitTwoResult.totalRatio));

    return true;
  }


  function setRefreshButtonLoading(isLoading) {
    const button = document.getElementById("morningMeetingCofiringRefreshButton");

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    button.disabled = isLoading;
    button.classList.toggle("is-loading", isLoading);
    button.setAttribute("aria-busy", isLoading ? "true" : "false");
  }

  async function forceRefreshDailyData() {
    return refreshCard({ force: true });
  }
  function handleCofiringRefreshClick(event) {
    const target =
      event.target instanceof Element
        ? event.target.closest("#morningMeetingCofiringRefreshButton")
        : null;

    if (!(target instanceof HTMLButtonElement)) {
      return;
    }

    event.preventDefault();
    forceRefreshDailyData();
  }

  function renderLegacySavedFallback(targetDate) {
    const fallback = window.morningMeetingLegacySavedDailyData;
    if (!targetDate || !fallback || typeof fallback.peek !== "function") return false;
    let saved = null;
    try {
      saved = fallback.peek(targetDate);
    } catch {
      saved = null;
    }
    if (!saved) return false;
    try {
      fallback.render?.(targetDate);
      return true;
    } catch (error) {
      console.warn("오전회의 기존 저장값 표시 실패:", error);
      return false;
    }
  }
  function renderClosedSnapshot(snapshot) {
    renderFuelUsage(snapshot);
    for (const [unit, prefix] of [["unitOne", "unitOne"], ["unitTwo", "unitTwo"]]) {
      for (const [field, suffix] of [["bioRatio", "BioRatio"], ["organicRatio", "OrganicRatio"], ["totalRatio", "TotalRatio"]]) {
        setValue(VALUE_IDS[prefix + suffix], formatRatio(snapshot[unit][field]));
      }
    }
    setStatus("complete", "마감자료");
  }

  function renderClosedState() {
    const provider = closedProvider();
    if (!provider || !ensureCard()) return;
    const date = provider.targetDate();
    setCardDate(date);
    if (!date || isSelectedDateResetActive(date)) {
      clearAllValues();
      setStatus("idle", "조회 대기");
      return;
    }
    const state = provider.state(date);
    const snapshot = provider.peek(date);
    if (state.status === "complete" && snapshot?.targetDate === date) {
      clearAllValues();
      renderClosedSnapshot(snapshot);
      return;
    }
    if (renderLegacySavedFallback(date)) return;
    clearAllValues();
    if (state.status === "loading") {
      setStatus("loading", "마감자료 조회 중");
    } else if (state.status === "error") {
      setStatus("error", "마감자료 조회 실패");
    } else {
      setStatus("idle", "마감자료 없음");
    }
  }

  async function refreshCard(options = {}) {
    const card = ensureCard();
    if (!(card instanceof HTMLElement)) return;

    const targetDate = getTargetDate();
    const refreshToken = ++activeRefreshToken;
    const dateChanged = currentTargetDate !== targetDate;
    currentTargetDate = targetDate;
    currentSettings = null;
    setRefreshButtonLoading(false);
    setCardDate(targetDate);

    if (dateChanged) clearAllValues();
    if (!targetDate) {
      setStatus("idle", "조회 대기");
      return;
    }
    if (isSelectedDateResetActive(targetDate)) {
      clearAllValues();
      setStatus("idle", "조회 대기");
      return;
    }

    const provider = closedProvider();
    if (!provider) {
      clearAllValues();
      setStatus("error", "마감자료 모듈 없음");
      return;
    }
    const hasLegacySaved = renderLegacySavedFallback(targetDate);
    if (!hasLegacySaved) {
      clearAllValues();
      setStatus("loading", "마감자료 조회 중");
    }
    setRefreshButtonLoading(true);
    try {
      const snapshot = await provider.load(targetDate, { force: options.force === true });
      if (refreshToken !== activeRefreshToken || getTargetDate() !== targetDate) return;
      if (isSelectedDateResetActive(targetDate)) {
        clearAllValues();
        setStatus("idle", "조회 대기");
        return;
      }
      if (snapshot?.targetDate === targetDate) {
        clearAllValues();
        renderClosedSnapshot(snapshot);
      } else if (!renderLegacySavedFallback(targetDate)) {
        clearAllValues();
        setStatus("idle", "마감자료 없음");
      }
    } catch (error) {
      if (refreshToken !== activeRefreshToken || getTargetDate() !== targetDate) return;
      if (isSelectedDateResetActive(targetDate)) {
        clearAllValues();
        setStatus("idle", "조회 대기");
      } else if (!renderLegacySavedFallback(targetDate)) {
        clearAllValues();
        setStatus("error", "마감자료 조회 실패");
      }
      console.warn("오전회의 혼소율 마감자료 조회 실패:", error);
    } finally {
      if (refreshToken === activeRefreshToken) setRefreshButtonLoading(false);
    }
  }



  function scheduleRefresh(delay = 180) {
    window.clearTimeout(refreshTimerId);
    refreshTimerId = window.setTimeout(refreshCard, delay);
  }

  function handleSelectedDateResetStateChanged(event) {
    const targetDate = getTargetDate();
    const changedDate = String(event?.detail?.targetDate || "").trim();

    if (!targetDate || changedDate !== targetDate) {
      return;
    }

    activeRefreshToken += 1;
    window.clearTimeout(refreshTimerId);
    refreshTimerId = null;
    setRefreshButtonLoading(false);

    if (
      event?.detail?.active === true ||
      isSelectedDateResetActive(targetDate)
    ) {
      currentTargetDate = targetDate;
      currentSettings = null;
      setCardDate(targetDate);
      clearAllValues();
      setStatus("idle", "조회 대기");
      return;
    }

    scheduleRefresh(0);
  }

  function bindWatchedElements() {
    watchedElementIds.forEach((id) => {
      const element = document.getElementById(id);
      const currentObserver = boundObservers.get(id);

      if (!(element instanceof HTMLElement)) {
        if (currentObserver) {
          currentObserver.observer.disconnect();
          boundObservers.delete(id);
        }
        return;
      }

      if (currentObserver?.element === element) {
        return;
      }

      currentObserver?.observer.disconnect();

      const observer = new MutationObserver(() => {
        scheduleRefresh(220);
      });

      observer.observe(element, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["class", "data-date", "datetime", "value"]
      });

      boundObservers.set(id, {
        element,
        observer
      });
    });
  }

  function nodeContainsWatchedElement(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    if (node.id === SOURCE_CARD_ID || watchedElementIds.includes(node.id)) {
      return true;
    }

    return [SOURCE_CARD_ID, ...watchedElementIds].some((id) => node.querySelector?.(`#${id}`));
  }

  function observeLayout() {
    if (layoutObserver || !(document.body instanceof HTMLElement)) {
      return;
    }

    layoutObserver = new MutationObserver((mutations) => {
      const relevantMutation = mutations.some((mutation) =>
        [...mutation.addedNodes, ...mutation.removedNodes].some(nodeContainsWatchedElement)
      );

      if (!relevantMutation) {
        return;
      }

      ensureCard();
      bindWatchedElements();
      scheduleRefresh(250);
    });

    layoutObserver.observe(document.body, {
      subtree: true,
      childList: true
    });
  }

  function initialize() {
    document.addEventListener(
      "click",
      handleCofiringRefreshClick
    );

    document.addEventListener(
      "morningMeetingSelectedDateResetStateChanged",
      handleSelectedDateResetStateChanged
    );

    document.addEventListener("morningMeetingClosedCofiringChanged", renderClosedState);

    const card = ensureCard();

    bindWatchedElements();
    observeLayout();

    if (card) {
      scheduleRefresh(100);
      return;
    }

    let attempts = 0;

    const startupTimer = window.setInterval(() => {
      attempts += 1;

      const delayedCard = ensureCard();
      bindWatchedElements();

      if (delayedCard) {
        scheduleRefresh(100);
        window.clearInterval(startupTimer);
        return;
      }

      if (attempts >= 40) {
        window.clearInterval(startupTimer);
      }
    }, 250);
  }

  window.getMorningMeetingCofiringEffectiveValues = function () {
    const provider = closedProvider();
    if (!provider) return null;
    const targetDate = provider.targetDate();
    if (!targetDate || isSelectedDateResetActive(targetDate) || provider.state(targetDate).status !== "complete") return null;
    const snapshot = provider.peek(targetDate);
    return snapshot?.targetDate === targetDate ? snapshot : null;
  };
  window.refreshMorningMeetingCofiringCard = refreshCard;
  window.calculateMorningMeetingCofiring = calculateCofiring;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();

/* MORNING_MEETING_COFIRING_STABLE_REFRESH_V1_R2 */

/* ===== MORNING_CALORIFIC_NATIVE_4FIELD_V6_R2 =====
   Coal / Bio-SRF / Organic / Manure use native sibling markup.
   No runtime DOM relocation.
   ===== /MORNING_CALORIFIC_NATIVE_4FIELD_V6_R2 ===== */
