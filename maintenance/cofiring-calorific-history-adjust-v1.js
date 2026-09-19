(() => {
  "use strict";

  /* COFIRING CALORIFIC HISTORY ADJUST V1 */
  const ROOT_SELECTOR = "[data-cofiring-draft-root]";
  const API = "/api/cofiring-calculation-settings";
  const BUTTON_ID = "cfvCalorificHistoryAdjustButton";
  const MODAL_ID = "cfvCalorificHistoryAdjustModal";
  const TABLE_CLASS = "cfv-cal-history-fullwidth-v1";
  const FUELS = [
    { key: "coal", label: "Coal" },
    { key: "bio", label: "Bio-SRF" },
    { key: "organic", label: "유기성 고형연료" },
    { key: "manure", label: "축분" }
  ];

  let loadedSettings = null;
  let loadedEffectiveDate = "";
  let previousBodyOverflow = "";

  function textOf(node) {
    return String(node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function authHeaders() {
    return typeof window.getShiftLogAuthHeaders === "function"
      ? window.getShiftLogAuthHeaders()
      : {};
  }

  function koreanToday() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  function requestId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `cfv-cal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function validDate(value) {
    return /^20\d{2}-\d{2}-\d{2}$/.test(String(value || ""));
  }

  function findHistoryTitle(root) {
    return Array.from(root.querySelectorAll("strong,h2,h3"))
      .find((node) => textOf(node) === "발열량 저장 이력") || null;
  }

  function findHistoryPanel(root) {
    const title = findHistoryTitle(root);
    if (!title) return null;

    return (
      title.closest("section") ||
      title.closest(".cfv12-history-panel") ||
      title.parentElement?.parentElement ||
      null
    );
  }

  function findHistoryHeader(panel) {
    if (!panel) return null;
    const title = Array.from(panel.querySelectorAll("strong,h2,h3"))
      .find((node) => textOf(node) === "발열량 저장 이력");
    if (!title) return null;

    return (
      title.closest(".cfv12-history-head") ||
      title.closest(".cfv12-history-header") ||
      title.parentElement?.parentElement ||
      null
    );
  }

  function findRefreshButton(panel) {
    if (!panel) return null;

    const explicit =
      panel.querySelector("[data-cfv12-refresh]") ||
      panel.querySelector("[data-cfv-settings-history-refresh]");

    if (explicit) return explicit;

    return Array.from(panel.querySelectorAll("button"))
      .find((button) => textOf(button) === "새로고침") || null;
  }

  function normalizeHistoryTable(panel) {
    if (!panel) return;

    const table = panel.querySelector("table");
    if (!table) return;

    table.classList.add(TABLE_CLASS);
    const wrap = table.parentElement;
    wrap?.classList.add("cfv-cal-history-wrap-v1");

    const headerRow = table.tHead?.rows?.[table.tHead.rows.length - 1] || null;
    const cellCount = headerRow?.cells?.length || 0;

    if (cellCount === 6) {
      for (const old of Array.from(table.querySelectorAll(":scope > colgroup"))) {
        old.remove();
      }

      const colgroup = document.createElement("colgroup");
      colgroup.className = "cfv-cal-history-colgroup-v1";

      for (let i = 0; i < 6; i += 1) {
        colgroup.append(document.createElement("col"));
      }

      table.insertBefore(colgroup, table.firstChild);
    }
  }

  function createAdjustButton() {
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "cfv-cal-history-adjust-button-v1";
    button.textContent = "발열량 조정";
    button.addEventListener("click", () => {
      void openModal();
    });
    return button;
  }

  function enhanceHeader(panel) {
    const header = findHistoryHeader(panel);
    const refresh = findRefreshButton(panel);
    if (!header || !refresh) return;

    let controls = header.querySelector(".cfv-cal-history-actions-v1");
    if (!controls) {
      controls = document.createElement("span");
      controls.className = "cfv-cal-history-actions-v1";
      refresh.insertAdjacentElement("beforebegin", controls);
    }

    if (refresh.parentElement !== controls) {
      controls.append(refresh);
    }

    let adjust = controls.querySelector(`#${BUTTON_ID}`);
    if (!adjust) {
      adjust = createAdjustButton();
      controls.insertBefore(adjust, refresh);
    }
  }

  function enhance() {
    // Login-safe: do nothing until the co-firing UI exists.
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return false;

    const panel = findHistoryPanel(root);
    if (!panel) return false;

    panel.classList.add("cfv-cal-history-panel-v1");
    enhanceHeader(panel);
    normalizeHistoryTable(panel);
    return true;
  }

  function createModal() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "cfv-cal-adjust-backdrop-v1";
    modal.hidden = true;

    modal.innerHTML = `
      <section class="cfv-cal-adjust-dialog-v1" role="dialog" aria-modal="true" aria-labelledby="cfvCalAdjustTitle">
        <header class="cfv-cal-adjust-head-v1">
          <div>
            <span class="cfv-cal-adjust-eyebrow-v1">CALORIFIC VALUE</span>
            <h3 id="cfvCalAdjustTitle">발열량 설정</h3>
            <p>적용 시작일부터 이후 날짜의 혼소율 계산에 사용합니다.</p>
          </div>
          <button type="button" class="cfv-cal-adjust-close-v1" data-cfv-cal-close aria-label="닫기">×</button>
        </header>

        <form class="cfv-cal-adjust-form-v1" data-cfv-cal-form>
          <label class="cfv-cal-adjust-date-v1">
            <span>적용 시작일</span>
            <input type="date" data-cfv-cal-date min="2021-01-01" required>
          </label>

          <div class="cfv-cal-adjust-grid-v1">
            ${FUELS.map((fuel) => `
              <label>
                <span>${fuel.label}</span>
                <span class="cfv-cal-adjust-input-wrap-v1">
                  <input
                    type="number"
                    min="1"
                    max="50000"
                    step="1"
                    inputmode="numeric"
                    data-cfv-cal-fuel="${fuel.key}"
                    required
                  >
                  <small>kcal/kg</small>
                </span>
              </label>
            `).join("")}
          </div>

          <div class="cfv-cal-adjust-current-v1" data-cfv-cal-current>
            현재 적용값을 불러오는 중입니다.
          </div>

          <div class="cfv-cal-adjust-error-v1" data-cfv-cal-error hidden></div>

          <footer class="cfv-cal-adjust-actions-v1">
            <button type="button" data-cfv-cal-cancel>취소</button>
            <button type="submit" class="is-primary" data-cfv-cal-save>저장</button>
          </footer>
        </form>
      </section>
    `;

    document.body.append(modal);

    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest("[data-cfv-cal-close],[data-cfv-cal-cancel]")) {
        closeModal();
      }
    });

    modal.querySelector("[data-cfv-cal-date]")?.addEventListener("change", (event) => {
      const date = event.currentTarget.value;
      if (validDate(date)) void loadSettings(date);
    });

    modal.querySelector("[data-cfv-cal-form]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void saveSettings();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) {
        closeModal();
      }
    });

    return modal;
  }

  function modalNodes() {
    const modal = createModal();
    return {
      modal,
      date: modal.querySelector("[data-cfv-cal-date]"),
      current: modal.querySelector("[data-cfv-cal-current]"),
      error: modal.querySelector("[data-cfv-cal-error]"),
      save: modal.querySelector("[data-cfv-cal-save]"),
      inputs: Object.fromEntries(
        FUELS.map(({ key }) => [
          key,
          modal.querySelector(`[data-cfv-cal-fuel="${key}"]`)
        ])
      )
    };
  }

  function setModalBusy(busy) {
    const { modal, date, save, inputs } = modalNodes();
    modal.classList.toggle("is-busy", Boolean(busy));
    if (date) date.disabled = Boolean(busy);
    if (save) save.disabled = Boolean(busy);
    for (const input of Object.values(inputs)) {
      if (input) input.disabled = Boolean(busy);
    }
  }

  function showError(message = "") {
    const { error } = modalNodes();
    if (!error) return;
    error.textContent = String(message || "");
    error.hidden = !message;
  }

  function formatCurrentLine(date, settings) {
    const base = settings?.unit1 || settings?.unit2 || {};
    const values = {
      coal: Number(base?.coal?.calorific),
      bio: Number(base?.bio?.calorific),
      organic: Number(base?.organic?.calorific),
      manure: Number(base?.manure?.calorific)
    };

    const effective = loadedEffectiveDate || date || "기본값";
    return `현재 적용값: ${effective}부터 · Coal ${values.coal || "-"} / Bio ${values.bio || "-"} / 유기성 ${values.organic || "-"} / 축분 ${values.manure || "-"} kcal/kg`;
  }

  function writeModalSettings(date, settings) {
    const { current, inputs } = modalNodes();
    const base = settings?.unit1 || settings?.unit2 || {};

    for (const { key } of FUELS) {
      const value = Number(base?.[key]?.calorific);
      if (inputs[key]) {
        inputs[key].value = Number.isFinite(value) ? String(value) : "";
      }
    }

    if (current) {
      current.textContent = formatCurrentLine(date, settings);
    }
  }

  async function readJson(response, fallbackMessage) {
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {}

    if (!response.ok || payload?.ok !== true) {
      throw new Error(payload?.message || fallbackMessage);
    }

    return payload;
  }

  async function loadSettings(date) {
    const { current } = modalNodes();
    showError("");
    setModalBusy(true);

    if (current) current.textContent = "현재 적용값을 불러오는 중입니다.";

    try {
      const url = `${API}?targetDate=${encodeURIComponent(date)}`;
      const response = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          ...authHeaders(),
          Accept: "application/json"
        }
      });

      const payload = await readJson(
        response,
        "발열량 적용값을 불러오지 못했습니다."
      );

      if (!payload.settings) {
        throw new Error("적용할 발열량 값을 확인하지 못했습니다.");
      }

      loadedSettings = payload.settings;
      loadedEffectiveDate = String(payload.effectiveDate || "");
      writeModalSettings(date, loadedSettings);
    } catch (error) {
      loadedSettings = null;
      loadedEffectiveDate = "";
      showError(error?.message || "발열량 적용값을 불러오지 못했습니다.");
    } finally {
      setModalBusy(false);
    }
  }

  function readFuelValues() {
    const { inputs } = modalNodes();
    const output = {};

    for (const { key, label } of FUELS) {
      const value = Number(inputs[key]?.value);
      if (!Number.isFinite(value) || value < 1 || value > 50000) {
        throw new Error(`${label} 발열량을 확인해 주세요.`);
      }
      output[key] = value;
    }

    return output;
  }

  function hiddenCoefficient(root, unit, fuel) {
    const value = Number(
      root?.querySelector(`[data-cfv5-coefficient="${unit}:${fuel}"]`)?.value
    );
    return Number.isFinite(value) && value > 0 && value <= 100 ? value : 1;
  }

  function buildSettings(root, calorifics) {
    const source = loadedSettings || {};
    const settings = { unit1: {}, unit2: {} };

    for (const unit of ["unit1", "unit2"]) {
      for (const { key } of FUELS) {
        const sourceCoefficient = Number(source?.[unit]?.[key]?.coefficient);
        const coefficient =
          Number.isFinite(sourceCoefficient) &&
          sourceCoefficient > 0 &&
          sourceCoefficient <= 100
            ? sourceCoefficient
            : hiddenCoefficient(root, unit, key);

        settings[unit][key] = {
          calorific: calorifics[key],
          coefficient
        };
      }
    }

    return settings;
  }

  function syncHiddenInputs(root, settings) {
    if (!root || !settings) return;

    for (const unit of ["unit1", "unit2"]) {
      for (const { key } of FUELS) {
        const item = settings?.[unit]?.[key];
        if (!item) continue;

        const calorific = root.querySelector(
          `[data-cfv5-calorific="${unit}:${key}"]`
        );
        const coefficient = root.querySelector(
          `[data-cfv5-coefficient="${unit}:${key}"]`
        );

        if (calorific) calorific.value = String(item.calorific);
        if (coefficient) coefficient.value = Number(item.coefficient).toFixed(2);
      }
    }
  }

  function refreshHistory() {
    const root = document.querySelector(ROOT_SELECTOR);
    const panel = root ? findHistoryPanel(root) : null;
    const refresh = findRefreshButton(panel);

    if (refresh && !refresh.disabled) {
      refresh.click();
    }

    for (const delay of [80, 250, 700]) {
      window.setTimeout(enhance, delay);
    }
  }

  async function saveSettings() {
    const root = document.querySelector(ROOT_SELECTOR);
    if (!root) return;

    const { date, save } = modalNodes();
    const effectiveDate = String(date?.value || "");

    if (!validDate(effectiveDate)) {
      showError("적용 시작일을 확인해 주세요.");
      return;
    }

    showError("");
    setModalBusy(true);
    if (save) save.textContent = "저장 중...";

    try {
      const calorifics = readFuelValues();
      const settings = buildSettings(root, calorifics);

      const response = await fetch(API, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          ...authHeaders(),
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-ShiftLog-Client": "desktop"
        },
        body: JSON.stringify({
          effectiveDate,
          settings,
          requestId: requestId()
        })
      });

      const payload = await readJson(
        response,
        "발열량 설정을 저장하지 못했습니다."
      );

      const savedSettings = payload?.entry?.settings || settings;
      loadedSettings = savedSettings;
      loadedEffectiveDate = payload?.entry?.effectiveDate || effectiveDate;

      syncHiddenInputs(root, savedSettings);
      closeModal();
      refreshHistory();
    } catch (error) {
      showError(error?.message || "발열량 설정을 저장하지 못했습니다.");
    } finally {
      if (save) save.textContent = "저장";
      setModalBusy(false);
    }
  }

  async function openModal() {
    const { modal, date } = modalNodes();
    showError("");

    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("is-cfv-cal-adjust-open");

    modal.hidden = false;
    date.value = koreanToday();

    await loadSettings(date.value);
    date.focus();
  }

  function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal || modal.hidden) return;

    modal.hidden = true;
    document.body.classList.remove("is-cfv-cal-adjust-open");
    document.body.style.overflow = previousBodyOverflow;
    showError("");
  }

  function scheduleEnhance() {
    window.setTimeout(enhance, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }

  // No MutationObserver: keep login/startup safe.
  document.addEventListener("click", scheduleEnhance, true);
  window.addEventListener("focus", scheduleEnhance);

  for (const delay of [120, 350, 800, 1500, 3000, 6000]) {
    window.setTimeout(enhance, delay);
  }
})();
