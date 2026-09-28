(() => {
  "use strict";

  /* MOBILE LIMESTONE / HYDRATED LIME V9 - ROW / MANAGEMENT PARITY */
  const API = "/api/hydrated-lime-receipts";
  const STORAGE_KEY = "gsShiftLog.currentUser";
  const TOP_TAB_ID = "efficiencyLimestoneTab";
  const LIMESTONE_VIEW_ID = "efficiencyLimestoneView";
  const INNER_NAV_ID = "mobileLimestoneHydratedTabs";
  const LIMESTONE_PANEL_ID = "mobileLimestoneManagePanel";
  const HYDRATED_TAB_ID = "mobileHydratedLimeManageTab";
  const LIMESTONE_MANAGE_TAB_ID = "mobileLimestoneManageTab";
  const VIEW_ID = "efficiencyHydratedLimeView";

  const state = {
    month: "",
    loadedMonth: "",
    items: [],
    yearTotal: 0,
    yearAverage: 0,
    recordedMonths: 0,
    loading: false,
    error: "",
    mounted: false,
    quickSaving: false
  };

  function text(value) {
    return String(value ?? "").trim();
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function currentKstParts() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(new Date());

    const value = (type) =>
      parts.find((part) => part.type === type)?.value || "";

    const hour = value("hour") === "24" ? "00" : value("hour");

    return {
      year: value("year"),
      month: value("month"),
      day: value("day"),
      hour,
      minute: value("minute")
    };
  }

  function currentMonthKst() {
    const p = currentKstParts();
    return `${p.year}-${p.month}`;
  }

  function currentDateKst() {
    const p = currentKstParts();
    return `${p.year}-${p.month}-${p.day}`;
  }

  function currentTimeKst() {
    const p = currentKstParts();
    return `${p.hour}:${p.minute}`;
  }

  function validMonth(value) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value));
  }

  function validDate(value) {
    return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(
      text(value)
    );
  }

  function normalizeTimeInput(value) {
    const raw = text(value)
      .replace(/\s+/g, "")
      .replace(/[^0-9:]/g, "");

    if (!raw) return "";

    const colonMatch = raw.match(/^(\d{1,2}):(\d{1,2})$/);
    if (colonMatch) {
      const hour = Number(colonMatch[1]);
      const minute = Number(colonMatch[2]);
      if (
        Number.isInteger(hour) &&
        Number.isInteger(minute) &&
        hour >= 0 &&
        hour <= 23 &&
        minute >= 0 &&
        minute <= 59
      ) {
        return `${pad2(hour)}:${pad2(minute)}`;
      }
      return "";
    }

    if (/^\d{3,4}$/.test(raw)) {
      const digits = raw.padStart(4, "0");
      const hour = Number(digits.slice(0, 2));
      const minute = Number(digits.slice(2, 4));
      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
        return `${pad2(hour)}:${pad2(minute)}`;
      }
    }

    return "";
  }

  function moveMonth(value, amount) {
    const normalized = validMonth(value) ? value : currentMonthKst();
    const [year, month] = normalized.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 + amount, 1));
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
  }

  function monthLabel(value) {
    if (!validMonth(value)) return "-";
    const [year, month] = value.split("-");
    return `${year}.${month}`;
  }

  function selectedMonthDefaultDate(month) {
    const today = currentDateKst();
    return today.startsWith(`${month}-`) ? today : `${month}-01`;
  }

  function formatNumber(value, digits = 2) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "0.00";
    return number.toLocaleString("ko-KR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function parseQuickQuantity(value) {
    const raw = text(value)
      .replaceAll(",", "")
      .replace(/\s+/g, "");

    if (!raw) return null;

    let number = null;

    if (/^\d{3,5}$/.test(raw)) {
      number = Number(raw) / 100;
    } else if (/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(raw)) {
      number = Number(raw);
    }

    if (!Number.isFinite(number) || number < 0.01 || number > 999.99) {
      return null;
    }

    return Math.round(number * 100) / 100;
  }

  function receiptUnitNo(item) {
    const direct = Number(item?.unitNo ?? item?.unit_no);
    if (direct === 1 || direct === 2) return direct;

    const match = text(item?.note).match(/(?:^|[·\s])([12])호기(?:$|[·\s])/);
    return match ? Number(match[1]) : null;
  }

  function visibleReceiptNote(item) {
    const note = text(item?.note);
    if (/^모바일 직접 입력\s*·\s*[12]호기$/.test(note)) return "";
    return note;
  }

  function escapeHtml(value) {
    return text(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function readStoredUser() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || {};
    } catch (_) {
      return {};
    }
  }

  function authHeaders(extra = {}) {
    if (typeof window.getShiftLogAuthHeaders === "function") {
      return window.getShiftLogAuthHeaders(extra);
    }

    const user = readStoredUser();
    const token = text(user.sessionToken || user.session_token);

    return {
      Accept: "application/json",
      ...extra,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  async function api(url, options = {}) {
    const response = await fetch(url, {
      cache: "no-store",
      ...options,
      headers: authHeaders(options.headers || {})
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }

    if (!response.ok || payload?.ok === false) {
      throw new Error(
        payload?.message ||
          `소석회 입고 기록 요청에 실패했습니다. (${response.status})`
      );
    }

    return payload || {};
  }

  function innerTabsMarkup() {
    return `
      <nav class="mobile-limestone-hydrated-tabs" id="${INNER_NAV_ID}" role="tablist" aria-label="석회석 소석회 관리 선택">
        <button type="button" class="mobile-lh-tab is-active" id="${LIMESTONE_MANAGE_TAB_ID}" role="tab" aria-selected="true" aria-controls="${LIMESTONE_PANEL_ID}">석회석 관리</button>
        <button type="button" class="mobile-lh-tab" id="${HYDRATED_TAB_ID}" role="tab" aria-selected="false" aria-controls="${VIEW_ID}">소석회 관리</button>
      </nav>
    `;
  }

  function viewMarkup() {
    const month = state.month || currentMonthKst();

    return `
      <section
        class="mobile-hydrated-lime-view"
        id="${VIEW_ID}"
        role="tabpanel"
        aria-labelledby="${HYDRATED_TAB_ID}"
        aria-hidden="true"
        hidden
      >
        <header class="mhlt-heading">
          <div class="mhlt-heading__copy">
            <span>HYDRATED LIME RECEIPT</span>
            <h3>소석회 입고 관리</h3>
            <p>소석회 입고량을 월별로 조회하고 입고 건별로 등록·수정합니다.</p>
          </div>
          <div class="mhlt-heading__actions">
            <button type="button" class="mhlt-button mhlt-button--secondary" data-mhlt-refresh>
              새로고침
            </button>
            <button type="button" class="mhlt-button mhlt-button--primary" data-mhlt-open-editor>
              <span aria-hidden="true">＋</span> 입고
            </button>
          </div>
        </header>

        <section class="mhlt-month-card" aria-label="소석회 입고 조회 월">
          <button type="button" class="mhlt-month-arrow" data-mhlt-prev aria-label="이전 달">‹</button>
          <label class="mhlt-month-field">
            <span data-mhlt-month-label>${monthLabel(month)}</span>
            <input type="month" value="${month}" data-mhlt-month aria-label="조회 월 선택" />
          </label>
          <button type="button" class="mhlt-month-arrow" data-mhlt-next aria-label="다음 달">›</button>
          <button type="button" class="mhlt-current-month" data-mhlt-current>이번 달</button>
        </section>

        <section class="mhlt-summary" aria-label="소석회 입고 요약">
          <article class="mhlt-summary-card is-month">
            <span>선택월 입고량</span>
            <strong data-mhlt-total>0.00 <small>ton</small></strong>
          </article>
          <article class="mhlt-summary-card is-year">
            <span>연 누계</span>
            <strong data-mhlt-year-total>0.00 <small>ton</small></strong>
          </article>
          <article class="mhlt-summary-card is-average">
            <span>월평균</span>
            <strong data-mhlt-year-average>0.00 <small>ton</small></strong>
          </article>
          <article class="mhlt-summary-card is-count">
            <span>입고 횟수</span>
            <strong data-mhlt-count>0 <small>회</small></strong>
          </article>
        </section>

        <section class="mhlt-history-card">
          <header class="mhlt-history-card__header">
            <div>
              <h4>입고기록 상세</h4>
              <small data-mhlt-active-month>${monthLabel(month)} 기준</small>
            </div>
            <strong class="mhlt-count-badge" data-mhlt-count-badge>0건</strong>
          </header>

          <p class="mhlt-status" data-mhlt-status role="status" aria-live="polite" hidden></p>
          <div class="mhlt-record-list" data-mhlt-list></div>
        </section>

        <section
          class="mhlt-quick-entry limestone-manual-entry-modal"
          data-mhlt-quick-entry
          aria-hidden="true"
          hidden
        >
          <div
            class="limestone-manual-entry-modal__dialog mhlt-quick-entry__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mhltQuickEntryTitle"
          >
            <header class="limestone-manual-entry-modal__header">
              <div>
                <span class="limestone-manual-entry-modal__eyebrow">
                  HYDRATED LIME MANUAL
                </span>
                <h3
                  class="limestone-manual-entry-modal__title"
                  id="mhltQuickEntryTitle"
                >
                  입고량 직접 입력
                </h3>
              </div>
              <button
                type="button"
                class="limestone-manual-entry-modal__close"
                data-mhlt-quick-cancel
                aria-label="소석회 입력창 닫기"
              >
                ×
              </button>
            </header>

            <div class="limestone-manual-entry-modal__body">
              <p class="limestone-manual-entry-modal__description">
                입고량을 입력한 뒤 등록할 호기를 선택해 주세요.
              </p>

              <label
                class="limestone-manual-entry-modal__field-label"
                for="mhltQuickQuantityInput"
              >
                입고량
              </label>

              <div class="limestone-manual-entry-modal__input-wrap">
                <input
                  type="text"
                  class="limestone-manual-entry-modal__input"
                  id="mhltQuickQuantityInput"
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="예: 30.10 또는 3010"
                  data-mhlt-quick-quantity
                />
                <div class="limestone-manual-entry-modal__unit">ton</div>
              </div>

              <p class="limestone-manual-entry-modal__helper">
                0.01 ~ 999.99 ton · 3010 → 30.10
              </p>

              <p
                class="limestone-manual-entry-modal__error"
                data-mhlt-quick-status
                role="alert"
                hidden
              ></p>

              <div class="limestone-manual-entry-modal__actions">
                <button
                  type="button"
                  class="limestone-manual-entry-modal__action limestone-manual-entry-modal__action--unit1"
                  data-mhlt-quick-unit="1"
                >
                  1호기 등록
                </button>
                <button
                  type="button"
                  class="limestone-manual-entry-modal__action limestone-manual-entry-modal__action--unit2"
                  data-mhlt-quick-unit="2"
                >
                  2호기 등록
                </button>
              </div>
            </div>

            <footer class="limestone-manual-entry-modal__footer">
              <button
                type="button"
                class="limestone-manual-entry-modal__cancel"
                data-mhlt-quick-cancel
              >
                취소
              </button>
            </footer>
          </div>
        </section>

        <div class="mhlt-editor-backdrop" data-mhlt-editor hidden>
          <section class="mhlt-editor" role="dialog" aria-modal="true" aria-labelledby="mhltEditorTitle">
            <header>
              <div>
                <span>HYDRATED LIME</span>
                <h4 id="mhltEditorTitle" data-mhlt-editor-title>소석회 입고 기록</h4>
              </div>
              <button type="button" class="mhlt-editor-close" data-mhlt-cancel aria-label="닫기">×</button>
            </header>

            <form data-mhlt-form>
              <input type="hidden" data-mhlt-id />

              <div class="mhlt-form-grid">
                <label>
                  <span>입고 일자</span>
                  <input type="date" required data-mhlt-date />
                </label>
                <label>
                  <span>입고 시간</span>
                  <input
                    type="text"
                    inputmode="numeric"
                    autocomplete="off"
                    maxlength="5"
                    placeholder="1530 또는 15:30"
                    required
                    data-mhlt-time
                  />
                </label>
                <label class="is-wide">
                  <span>입고량 (ton)</span>
                  <input
                    type="number"
                    min="0"
                    max="1000000"
                    step="0.001"
                    inputmode="decimal"
                    placeholder="0.000"
                    required
                    data-mhlt-quantity
                  />
                </label>
                <label class="is-wide">
                  <span>비고</span>
                  <textarea
                    rows="3"
                    maxlength="500"
                    placeholder="차량번호, 전표번호 또는 특이사항"
                    data-mhlt-note
                  ></textarea>
                </label>
              </div>

              <p class="mhlt-editor-status" data-mhlt-editor-status role="alert" hidden></p>

              <footer>
                <button type="button" class="mhlt-button mhlt-button--secondary" data-mhlt-cancel>취소</button>
                <button type="submit" class="mhlt-button mhlt-button--primary" data-mhlt-save>저장</button>
              </footer>
            </form>
          </section>
        </div>
      </section>
    `;
  }

  function setTopTabLabel(tab) {
    if (!tab) return;
    const label = tab.querySelector(".efficiency-team-tab__label");
    if (label) label.textContent = "석회석/소석회";
    tab.setAttribute("aria-label", "석회석/소석회 관리");
    tab.setAttribute("title", "석회석/소석회 관리");
  }

  function activateInner(mode, options = {}) {
    const limestonePanel = document.getElementById(LIMESTONE_PANEL_ID);
    const hydratedPanel = document.getElementById(VIEW_ID);
    const limestoneButton = document.getElementById(LIMESTONE_MANAGE_TAB_ID);
    const hydratedButton = document.getElementById(HYDRATED_TAB_ID);
    if (!limestonePanel || !hydratedPanel || !limestoneButton || !hydratedButton) return;

    const hydrated = mode === "hydrated";
    limestoneButton.classList.toggle("is-active", !hydrated);
    limestoneButton.setAttribute("aria-selected", hydrated ? "false" : "true");
    hydratedButton.classList.toggle("is-active", hydrated);
    hydratedButton.setAttribute("aria-selected", hydrated ? "true" : "false");

    limestonePanel.hidden = hydrated;
    limestonePanel.setAttribute("aria-hidden", hydrated ? "true" : "false");
    hydratedPanel.hidden = !hydrated;
    hydratedPanel.setAttribute("aria-hidden", hydrated ? "false" : "true");

    if (hydrated) {
      if (!state.month) state.month = currentMonthKst();
      syncMonthControls();
      render();
      if (options.load !== false) loadMonth(false);
    } else {
      closeQuickEditor();
      closeEditor();
    }
  }

  function ensureUi() {
    const topTab = document.getElementById(TOP_TAB_ID);
    const limestoneView = document.getElementById(LIMESTONE_VIEW_ID);
    if (!topTab || !limestoneView) return false;

    setTopTabLabel(topTab);

    let limestonePanel = document.getElementById(LIMESTONE_PANEL_ID);
    if (!limestonePanel) {
      limestonePanel = document.createElement("section");
      limestonePanel.id = LIMESTONE_PANEL_ID;
      limestonePanel.className = "mobile-limestone-manage-panel";
      limestonePanel.setAttribute("role", "tabpanel");
      limestonePanel.setAttribute("aria-labelledby", LIMESTONE_MANAGE_TAB_ID);
      limestonePanel.setAttribute("aria-hidden", "false");

      const originalChildren = Array.from(limestoneView.childNodes);
      originalChildren.forEach((node) => limestonePanel.appendChild(node));

      limestoneView.insertAdjacentHTML("afterbegin", innerTabsMarkup());
      limestoneView.appendChild(limestonePanel);
      limestoneView.insertAdjacentHTML("beforeend", viewMarkup());
    }

    const hydratedPanel = document.getElementById(VIEW_ID);
    const limestoneButton = document.getElementById(LIMESTONE_MANAGE_TAB_ID);
    const hydratedButton = document.getElementById(HYDRATED_TAB_ID);
    if (!hydratedPanel || !limestoneButton || !hydratedButton) return false;

    if (!state.mounted) {
      state.mounted = true;
      bindUi(hydratedPanel, limestoneButton, hydratedButton, topTab);
      render();
      activateInner("limestone", { load: false });
    }

    return true;
  }

  function bindUi(view, limestoneButton, hydratedButton, topTab) {
    limestoneButton.addEventListener("click", (event) => {
      event.preventDefault();
      activateInner("limestone", { load: false });
    });

    hydratedButton.addEventListener("click", (event) => {
      event.preventDefault();
      activateInner("hydrated");
    });

    topTab.addEventListener("click", () => {
      window.requestAnimationFrame(() => activateInner("limestone", { load: false }));
    });

    view.querySelector("[data-mhlt-refresh]")?.addEventListener("click", () => {
      loadMonth(true);
    });

    view.querySelector("[data-mhlt-open-editor]")?.addEventListener("click", () => {
      openQuickEditor();
    });

    view.querySelector("[data-mhlt-prev]")?.addEventListener("click", () => {
      setMonth(moveMonth(state.month, -1));
    });

    view.querySelector("[data-mhlt-next]")?.addEventListener("click", () => {
      setMonth(moveMonth(state.month, 1));
    });

    view.querySelector("[data-mhlt-current]")?.addEventListener("click", () => {
      setMonth(currentMonthKst());
    });

    view.querySelector("[data-mhlt-month]")?.addEventListener("change", (event) => {
      if (validMonth(event.target.value)) setMonth(event.target.value);
    });

    view.querySelector("[data-mhlt-list]")?.addEventListener("click", (event) => {
      const edit = event.target.closest("[data-mhlt-edit]");
      if (edit) {
        openEditor(Number(edit.dataset.mhltEdit) || 0);
        return;
      }
      const remove = event.target.closest("[data-mhlt-delete]");
      if (remove) deleteReceipt(Number(remove.dataset.mhltDelete) || 0);
    });

    view.querySelectorAll("[data-mhlt-quick-cancel]").forEach((button) => {
      button.addEventListener("click", closeQuickEditor);
    });

    view.querySelector("[data-mhlt-quick-entry]")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeQuickEditor();
    });

    view.querySelectorAll("[data-mhlt-quick-unit]").forEach((button) => {
      button.addEventListener("click", () => {
        registerQuickReceipt(Number(button.dataset.mhltQuickUnit));
      });
    });

    view.querySelector("[data-mhlt-quick-quantity]")?.addEventListener("blur", (event) => {
      const quantity = parseQuickQuantity(event.target.value);
      if (quantity !== null) event.target.value = quantity.toFixed(2);
    });

    view.querySelectorAll("[data-mhlt-cancel]").forEach((button) => {
      button.addEventListener("click", closeEditor);
    });

    view.querySelector("[data-mhlt-editor]")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeEditor();
    });

    view.querySelector("[data-mhlt-form]")?.addEventListener("submit", saveReceipt);

    view.querySelector("[data-mhlt-time]")?.addEventListener("blur", (event) => {
      const normalized = normalizeTimeInput(event.target.value);
      if (normalized) event.target.value = normalized;
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeQuickEditor();
        closeEditor();
      }
    });
  }

  function setMonth(month) {
    if (!validMonth(month)) return;
    state.month = month;
    state.loadedMonth = "";
    state.error = "";
    syncMonthControls();
    render();
    loadMonth(false);
  }

  function syncMonthControls() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;

    const month = validMonth(state.month) ? state.month : currentMonthKst();
    const input = view.querySelector("[data-mhlt-month]");
    const label = view.querySelector("[data-mhlt-month-label]");
    const activeMonth = view.querySelector("[data-mhlt-active-month]");

    if (input && input.value !== month) input.value = month;
    if (label) label.textContent = monthLabel(month);
    if (activeMonth) activeMonth.textContent = `${monthLabel(month)} 기준`;
  }

  function computeRows() {
    const ascending = state.items
      .slice()
      .sort((a, b) => {
        const aKey = `${a.receiptDate} ${a.receiptTime} ${String(a.id).padStart(12, "0")}`;
        const bKey = `${b.receiptDate} ${b.receiptTime} ${String(b.id).padStart(12, "0")}`;
        return aKey.localeCompare(bKey);
      });

    const daily = new Map();
    const withCumulative = ascending.map((item) => {
      const previous = daily.get(item.receiptDate) || 0;
      const cumulative = previous + (Number(item.quantityTon) || 0);
      daily.set(item.receiptDate, cumulative);
      return { ...item, dailyCumulative: cumulative };
    });

    return withCumulative.sort((a, b) => {
      const aKey = `${a.receiptDate} ${a.receiptTime} ${String(a.id).padStart(12, "0")}`;
      const bKey = `${b.receiptDate} ${b.receiptTime} ${String(b.id).padStart(12, "0")}`;
      return bKey.localeCompare(aKey);
    });
  }

  function render() {
    const view = document.getElementById(VIEW_ID);
    if (!view) return;

    syncMonthControls();

    const total = state.items.reduce(
      (sum, item) => sum + (Number(item.quantityTon) || 0),
      0
    );
    const count = state.items.length;

    const setHtml = (selector, html) => {
      const node = view.querySelector(selector);
      if (node) node.innerHTML = html;
    };

    setHtml("[data-mhlt-total]", `${formatNumber(total)} <small>ton</small>`);
    setHtml(
      "[data-mhlt-year-total]",
      `${formatNumber(state.yearTotal)} <small>ton</small>`
    );
    setHtml(
      "[data-mhlt-year-average]",
      `${formatNumber(state.yearAverage)} <small>ton</small>`
    );
    setHtml("[data-mhlt-count]", `${count} <small>회</small>`);

    const badge = view.querySelector("[data-mhlt-count-badge]");
    if (badge) badge.textContent = `${count}건`;

    const status = view.querySelector("[data-mhlt-status]");
    if (status) {
      if (state.error) {
        status.hidden = false;
        status.classList.add("is-error");
        status.textContent = state.error;
      } else {
        status.hidden = true;
        status.classList.remove("is-error");
        status.textContent = "";
      }
    }

    const list = view.querySelector("[data-mhlt-list]");
    if (!list) return;

    if (state.loading) {
      list.innerHTML = '<div class="mhlt-empty">소석회 입고 기록을 불러오는 중입니다.</div>';
      return;
    }

    const rows = computeRows();
    if (!rows.length) {
      list.innerHTML = '<div class="mhlt-empty">조회 월에 등록된 소석회 입고 기록이 없습니다.</div>';
      return;
    }

    list.innerHTML = `
      <div class="mhlt-receipt-table" role="table" aria-label="소석회 입고기록 상세">
        <div class="mhlt-receipt-head" role="row">
          <span role="columnheader">일자</span>
          <span role="columnheader">시간</span>
          <span role="columnheader">입고량</span>
          <span role="columnheader">관리</span>
        </div>
        <div class="mhlt-receipt-body">
          ${rows
            .map((item) => {
              const note = visibleReceiptNote(item);
              const unitNo = receiptUnitNo(item);
              const unitClass = unitNo === 1 ? "is-unit-1" : unitNo === 2 ? "is-unit-2" : "";
              const titleParts = [
                item.sourceLabel || "직접 입력",
                note || ""
              ].filter(Boolean);

              return `
                <div
                  class="mhlt-receipt-row ${unitClass}"
                  role="row"
                  data-mhlt-row="${Number(item.id)}"
                  title="${escapeHtml(titleParts.join(" · "))}"
                >
                  <span class="mhlt-receipt-cell is-date" role="cell">
                    ${escapeHtml(item.receiptDate?.slice(5) || "-")}
                  </span>
                  <span class="mhlt-receipt-cell is-time" role="cell">
                    ${escapeHtml(item.receiptTime || "-")}
                  </span>

                  <span class="mhlt-receipt-cell is-quantity" role="cell">
                    ${formatNumber(item.quantityTon)} t
                  </span>
                  <span class="mhlt-receipt-cell is-actions" role="cell">
                    <button type="button" data-mhlt-edit="${Number(item.id)}">수정</button>
                    <button type="button" class="danger" data-mhlt-delete="${Number(item.id)}">삭제</button>
                  </span>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  async function loadMonth(force) {
    if (state.loading) return;
    if (!state.month) state.month = currentMonthKst();

    if (!force && state.loadedMonth === state.month) {
      render();
      return;
    }

    state.loading = true;
    state.error = "";
    render();

    try {
      const payload = await api(`${API}?month=${encodeURIComponent(state.month)}`);
      state.items = Array.isArray(payload.items) ? payload.items : [];
      state.yearTotal = Number(payload.summary?.yearTotal || 0);
      state.yearAverage = Number(payload.summary?.yearAverage || 0);
      state.recordedMonths = Number(payload.summary?.recordedMonths || 0);
      state.loadedMonth = state.month;
    } catch (error) {
      state.items = [];
      state.loadedMonth = "";
      state.error = error?.message || "소석회 입고 기록을 불러오지 못했습니다.";
    } finally {
      state.loading = false;
      render();
    }
  }

  function quickElements() {
    const view = document.getElementById(VIEW_ID);
    return {
      modal: view?.querySelector("[data-mhlt-quick-entry]"),
      quantity: view?.querySelector("[data-mhlt-quick-quantity]"),
      status: view?.querySelector("[data-mhlt-quick-status]"),
      unitOneButton: view?.querySelector('[data-mhlt-quick-unit="1"]'),
      unitTwoButton: view?.querySelector('[data-mhlt-quick-unit="2"]')
    };
  }

  function setQuickStatus(message, isError = true) {
    const e = quickElements();
    if (!e.status) return;
    e.status.hidden = !message;
    e.status.textContent = message || "";
    e.status.classList.toggle("is-error", Boolean(message && isError));
  }

  function openQuickEditor() {
    const e = quickElements();
    if (!e.modal) return;

    closeEditor();
    state.quickSaving = false;
    if (e.quantity) e.quantity.value = "";
    if (e.unitOneButton) {
      e.unitOneButton.disabled = false;
      e.unitOneButton.textContent = "1호기 등록";
    }
    if (e.unitTwoButton) {
      e.unitTwoButton.disabled = false;
      e.unitTwoButton.textContent = "2호기 등록";
    }
    setQuickStatus("");

    e.modal.hidden = false;
    e.modal.removeAttribute("hidden");
    e.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-hydrated-lime-manual-entry-open");

    window.requestAnimationFrame(() => e.quantity?.focus());
  }

  function closeQuickEditor() {
    const e = quickElements();
    if (!e.modal) return;
    if (state.quickSaving) return;

    e.modal.hidden = true;
    e.modal.setAttribute("hidden", "");
    e.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("is-hydrated-lime-manual-entry-open");
    if (e.quantity) e.quantity.value = "";
    setQuickStatus("");
  }

  async function registerQuickReceipt(unitNo) {
    if (![1, 2].includes(Number(unitNo)) || state.quickSaving) return;

    const e = quickElements();
    const quantityTon = parseQuickQuantity(e.quantity?.value);
    if (quantityTon === null) {
      setQuickStatus("입고량을 0.01 ~ 999.99 ton 범위로 입력해 주세요.");
      e.quantity?.focus();
      e.quantity?.select?.();
      return;
    }

    const receiptDate = currentDateKst();
    const receiptTime = currentTimeKst();
    const targetButton = Number(unitNo) === 1 ? e.unitOneButton : e.unitTwoButton;

    state.quickSaving = true;
    if (e.unitOneButton) e.unitOneButton.disabled = true;
    if (e.unitTwoButton) e.unitTwoButton.disabled = true;
    if (targetButton) targetButton.textContent = "등록 중...";
    if (e.quantity) e.quantity.value = quantityTon.toFixed(2);
    setQuickStatus(`${unitNo}호기 소석회 입고기록을 등록하고 있습니다.`, false);

    try {
      await api(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ShiftLog-Client": "mobile"
        },
        body: JSON.stringify({
          receiptDate,
          receiptTime,
          unitNo: Number(unitNo),
          quantityTon,
          note: `모바일 직접 입력 · ${unitNo}호기`
        })
      });

      state.month = receiptDate.slice(0, 7);
      state.loadedMonth = "";
      state.error = "";
      state.quickSaving = false;
      closeQuickEditor();
      syncMonthControls();
      await loadMonth(true);
    } catch (error) {
      state.quickSaving = false;
      if (e.unitOneButton) {
        e.unitOneButton.disabled = false;
        e.unitOneButton.textContent = "1호기 등록";
      }
      if (e.unitTwoButton) {
        e.unitTwoButton.disabled = false;
        e.unitTwoButton.textContent = "2호기 등록";
      }
      setQuickStatus(error?.message || "소석회 입고 기록을 저장하지 못했습니다.");
    }
  }

  function editorElements() {
    const view = document.getElementById(VIEW_ID);
    return {
      backdrop: view?.querySelector("[data-mhlt-editor]"),
      form: view?.querySelector("[data-mhlt-form]"),
      title: view?.querySelector("[data-mhlt-editor-title]"),
      id: view?.querySelector("[data-mhlt-id]"),
      date: view?.querySelector("[data-mhlt-date]"),
      time: view?.querySelector("[data-mhlt-time]"),
      quantity: view?.querySelector("[data-mhlt-quantity]"),
      note: view?.querySelector("[data-mhlt-note]"),
      status: view?.querySelector("[data-mhlt-editor-status]"),
      save: view?.querySelector("[data-mhlt-save]")
    };
  }

  function openEditor(id = 0) {
    const numericId = Number(id) || 0;
    const record = state.items.find((item) => Number(item.id) === numericId);
    const e = editorElements();
    if (!e.backdrop) return;

    e.id.value = record ? String(record.id) : "";
    e.title.textContent = record ? "소석회 입고 기록 수정" : "소석회 입고 기록";
    e.date.value =
      record?.receiptDate || selectedMonthDefaultDate(state.month || currentMonthKst());
    e.time.value = record?.receiptTime || currentTimeKst();
    e.quantity.value =
      record && Number.isFinite(Number(record.quantityTon))
        ? String(record.quantityTon)
        : "";
    e.note.value = record?.note || "";
    e.status.hidden = true;
    e.status.textContent = "";
    e.save.disabled = false;
    e.backdrop.hidden = false;
    document.documentElement.classList.add("mhlt-editor-open");

    window.setTimeout(() => e.quantity?.focus(), 0);
  }

  function closeEditor() {
    const e = editorElements();
    if (e.backdrop) e.backdrop.hidden = true;
    document.documentElement.classList.remove("mhlt-editor-open");
  }

  function setEditorStatus(message, isError = true) {
    const e = editorElements();
    if (!e.status) return;
    e.status.hidden = !message;
    e.status.textContent = message || "";
    e.status.classList.toggle("is-error", Boolean(message && isError));
  }

  async function saveReceipt(event) {
    event.preventDefault();

    const e = editorElements();
    const id = Number(e.id?.value) || 0;
    const receiptDate = text(e.date?.value);
    const receiptTime = normalizeTimeInput(e.time?.value);
    const quantityTon = Number(e.quantity?.value);
    const note = text(e.note?.value);

    if (!validDate(receiptDate)) {
      setEditorStatus("입고 일자를 선택해 주세요.");
      return;
    }

    if (!receiptTime) {
      setEditorStatus("입고 시간을 1530 또는 15:30 형식으로 입력해 주세요.");
      e.time?.focus();
      return;
    }

    if (!Number.isFinite(quantityTon) || quantityTon < 0 || quantityTon > 1000000) {
      setEditorStatus("입고량을 0 이상 1,000,000 이하의 숫자로 입력해 주세요.");
      e.quantity?.focus();
      return;
    }

    e.time.value = receiptTime;
    e.save.disabled = true;
    setEditorStatus("저장 중입니다.", false);

    try {
      await api(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ShiftLog-Client": "mobile"
        },
        body: JSON.stringify({
          id: id || undefined,
          receiptDate,
          receiptTime,
          quantityTon,
          note
        })
      });

      state.month = receiptDate.slice(0, 7);
      state.loadedMonth = "";
      state.error = "";
      closeEditor();
      syncMonthControls();
      await loadMonth(true);
    } catch (error) {
      setEditorStatus(error?.message || "소석회 입고 기록을 저장하지 못했습니다.");
    } finally {
      e.save.disabled = false;
    }
  }

  async function deleteReceipt(id) {
    const numericId = Number(id) || 0;
    const record = state.items.find((item) => Number(item.id) === numericId);
    if (!record) return;

    const label = `${record.receiptDate} ${record.receiptTime} · ${formatNumber(record.quantityTon)} t`;
    if (!window.confirm(`${label}\n소석회 입고 기록을 삭제할까요?`)) return;

    try {
      await api(`${API}?id=${encodeURIComponent(numericId)}`, {
        method: "DELETE",
        headers: { "X-ShiftLog-Client": "mobile" }
      });
      state.loadedMonth = "";
      state.error = "";
      await loadMonth(true);
    } catch (error) {
      state.error = error?.message || "소석회 입고 기록을 삭제하지 못했습니다.";
      render();
    }
  }

  function boot() {
    state.month = currentMonthKst();

    if (ensureUi()) return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (ensureUi() || attempts >= 100) {
        window.clearInterval(timer);
      }
    }, 100);
  }

  window.openMobileHydratedLimeReceipts = () => {
    if (!ensureUi()) return false;
    const topTab = document.getElementById(TOP_TAB_ID);
    topTab?.click();
    window.requestAnimationFrame(() => activateInner("hydrated"));
    return true;
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
