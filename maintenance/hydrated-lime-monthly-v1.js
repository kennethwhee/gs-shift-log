(() => {
  "use strict";

  /* HYDRATED LIME MONTHLY V1 R1 ICON FIX */
  const API = "/api/hydrated-lime-monthly";
  const PARENT_VIEW_ID = "efficiencyLimestoneView";
  const PARENT_TAB_ID = "efficiencyLimestoneTab";
  const SUBMENU_ID = "limestoneSubviewMenu";
  const RECEIPT_VIEW_ID = "limestoneDashboard";
  const USAGE_VIEW_ID = "limestoneUsageCalculatorView";
  const TAB_ID = "hydratedLimeSubviewButton";
  const PANEL_ID = "hydratedLimeMonthlyView";
  const REFRESH_ID = "refreshHydratedLimeMonthlyButton";
  const OPEN_EDITOR_ID = "openHydratedLimeMonthlyEditorButton";
  const STORAGE_KEY = "gsShiftLog.currentUser";

  const state = {
    month: "",
    year: "",
    items: [],
    loaded: false,
    loading: false
  };

  function text(value) {
    return String(value ?? "").trim();
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function currentMonthKst() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit"
    }).formatToParts(new Date());

    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    return `${year}-${month}`;
  }

  function validMonth(value) {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value));
  }

  function monthLabel(value) {
    if (!validMonth(value)) return "-";
    const [year, month] = value.split("-");
    return `${year}년 ${month}월`;
  }

  function moveMonth(value, amount) {
    const normalized = validMonth(value) ? value : currentMonthKst();
    const [year, month] = normalized.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 + amount, 1, 0, 0, 0));
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
  }

  function escapeHtml(value) {
    return text(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function number(value, digits = 2) {
    const n = Number(value);
    return Number.isFinite(n)
      ? n.toLocaleString("ko-KR", {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits
        })
      : "0.00";
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
          `소석회 월별 기록 요청에 실패했습니다. (${response.status})`
      );
    }

    return payload || {};
  }

  function parentView() {
    return document.getElementById(PARENT_VIEW_ID);
  }

  function submenu() {
    return document.getElementById(SUBMENU_ID);
  }

  function receiptView() {
    return document.getElementById(RECEIPT_VIEW_ID);
  }

  function usageView() {
    return document.getElementById(USAGE_VIEW_ID);
  }

  function headingParts() {
    const view = parentView();
    return {
      eyebrow: view?.querySelector(
        ".limestone-view-heading > div:first-child > span"
      ),
      title: view?.querySelector(".limestone-view-heading h3"),
      description: view?.querySelector(".limestone-view-description"),
      actions: view?.querySelector(".limestone-heading-actions")
    };
  }

  function renameParentMenu() {
    const button = document.getElementById(PARENT_TAB_ID);
    if (!button) return false;

    // Preserve the existing SVG icon. Replacing button.textContent would
    // delete every child node inside the menu button, including the icon.
    const label = button.querySelector(".efficiency-team-tab__label");

    if (label) {
      if (text(label.textContent) !== "석회석/소석회") {
        label.textContent = "석회석/소석회";
      }
    } else {
      // Legacy fallback only: create a label without touching existing children.
      const fallbackLabel = document.createElement("span");
      fallbackLabel.className = "efficiency-team-tab__label";
      fallbackLabel.textContent = "석회석/소석회";
      button.append(fallbackLabel);
    }

    button.setAttribute("aria-label", "석회석/소석회");
    button.title = "석회석/소석회";

    return true;
  }

  function panelMarkup() {
    const month = state.month || currentMonthKst();

    return `
      <section
        class="hydrated-lime-monthly-v1"
        id="${PANEL_ID}"
        role="tabpanel"
        aria-labelledby="${TAB_ID}"
        hidden
      >
        <div class="hlm-month-bar">
          <button type="button" class="hlm-nav-button" data-hlm-prev aria-label="이전 달">‹</button>
          <label class="hlm-month-field">
            <span>조회 월</span>
            <input type="month" data-hlm-month value="${month}">
          </label>
          <button type="button" class="hlm-nav-button" data-hlm-next aria-label="다음 달">›</button>
          <button type="button" class="hlm-today-button" data-hlm-current>이번 달</button>
          <span class="hlm-month-only-note">일·주 단위 없이 월 단위로만 기록합니다.</span>
        </div>

        <div class="hlm-summary-grid">
          <article class="hlm-summary-card is-primary">
            <span>선택 월 입고량</span>
            <strong data-hlm-selected-quantity>0.00 <small>ton</small></strong>
          </article>
          <article class="hlm-summary-card is-green">
            <span>연간 누적</span>
            <strong data-hlm-year-total>0.00 <small>ton</small></strong>
          </article>
          <article class="hlm-summary-card is-purple">
            <span>월 평균</span>
            <strong data-hlm-year-average>0.00 <small>ton</small></strong>
          </article>
          <article class="hlm-summary-card is-orange">
            <span>기록 월수</span>
            <strong data-hlm-record-count>0 <small>개월</small></strong>
          </article>
        </div>

        <section class="hlm-history-card">
          <header class="hlm-history-head">
            <div>
              <span>HYDRATED LIME HISTORY</span>
              <strong>소석회 월별 기록</strong>
            </div>
            <em data-hlm-year-label>-</em>
          </header>

          <div class="hlm-table-wrap">
            <table class="hlm-table">
              <thead>
                <tr>
                  <th>월</th>
                  <th>입고량</th>
                  <th>비고</th>
                  <th>수정자</th>
                  <th>수정 시각</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody data-hlm-body>
                <tr>
                  <td colspan="6" class="hlm-empty">월별 기록을 불러오는 중입니다.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="hlm-editor-backdrop" data-hlm-editor hidden>
          <form class="hlm-editor" data-hlm-form>
            <header>
              <div>
                <span>MONTHLY RECORD</span>
                <strong>소석회 월 기록</strong>
              </div>
              <button type="button" class="hlm-editor-close" data-hlm-close aria-label="닫기">×</button>
            </header>

            <div class="hlm-editor-body">
              <label>
                <span>기준 월</span>
                <input type="month" data-hlm-edit-month required>
              </label>

              <label>
                <span>월 입고량 (ton)</span>
                <input
                  type="number"
                  data-hlm-quantity
                  min="0"
                  max="1000000"
                  step="0.01"
                  inputmode="decimal"
                  placeholder="예: 28.78"
                  required
                >
              </label>

              <label class="is-wide">
                <span>비고</span>
                <textarea
                  data-hlm-note
                  rows="3"
                  maxlength="500"
                  placeholder="필요한 내용만 간단히 기록"
                ></textarea>
              </label>
            </div>

            <p class="hlm-editor-status" data-hlm-editor-status hidden></p>

            <footer>
              <button type="button" class="secondary-button" data-hlm-cancel>취소</button>
              <button type="submit" class="primary-button" data-hlm-save>저장</button>
            </footer>
          </form>
        </div>
      </section>
    `;
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    const receipt = receiptView();
    const usage = usageView();
    const anchor = usage || receipt;
    if (!anchor) return null;

    anchor.insertAdjacentHTML("afterend", panelMarkup());
    panel = document.getElementById(PANEL_ID);
    bindPanel(panel);
    return panel;
  }

  function ensureTab() {
    const menu = submenu();
    if (!menu) return null;

    let tab = document.getElementById(TAB_ID);
    if (tab) return tab;

    tab = document.createElement("button");
    tab.type = "button";
    tab.id = TAB_ID;
    tab.className = "limestone-subview-menu__button";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", "false");
    tab.setAttribute("aria-controls", PANEL_ID);
    tab.tabIndex = -1;
    tab.textContent = "소석회";

    const usageTab = document.getElementById("limestoneUsageSubviewButton");
    if (usageTab?.parentElement === menu) {
      usageTab.insertAdjacentElement("afterend", tab);
    } else {
      menu.append(tab);
    }

    tab.addEventListener("click", activateHydratedView);
    return tab;
  }

  function ensureHeaderActions() {
    const { actions } = headingParts();
    if (!actions) return false;

    let refresh = document.getElementById(REFRESH_ID);
    if (!refresh) {
      refresh = document.createElement("button");
      refresh.type = "button";
      refresh.id = REFRESH_ID;
      refresh.className = "secondary-button";
      refresh.textContent = "새로고침";
      refresh.hidden = true;
      refresh.addEventListener("click", () => loadYear(true));
      actions.append(refresh);
    }

    let add = document.getElementById(OPEN_EDITOR_ID);
    if (!add) {
      add = document.createElement("button");
      add.type = "button";
      add.id = OPEN_EDITOR_ID;
      add.className = "primary-button";
      add.textContent = "+ 월 기록";
      add.hidden = true;
      add.addEventListener("click", () => openEditor(state.month));
      actions.append(add);
    }

    return true;
  }

  function setOwnActionsVisible(visible) {
    const refresh = document.getElementById(REFRESH_ID);
    const add = document.getElementById(OPEN_EDITOR_ID);
    if (refresh) refresh.hidden = !visible;
    if (add) add.hidden = !visible;
  }

  function hideLegacyHeaderActionsForHydrated() {
    const ids = [
      "refreshLimestoneReceiptsButton",
      "importLimestoneFromShiftLogsButton",
      "openLimestoneSlipCaptureButton",
      "openLimestoneSlipLibraryButton",
      "openLimestoneReceiptEditorButton",
      "loadLimestoneUsageOisButton",
      "refreshLimestoneUsageReceiptButton"
    ];

    for (const id of ids) {
      const node = document.getElementById(id);
      if (node) node.hidden = true;
    }

    const guide = headingParts().actions?.querySelector(
      ".limestone-slip-camera-guide"
    );
    if (guide) guide.hidden = true;
  }

  function setHeadingHydrated() {
    const { eyebrow, title, description } = headingParts();

    if (eyebrow) eyebrow.textContent = "HYDRATED LIME";
    if (title) title.textContent = "소석회 월별 입고 현황";
    if (description) {
      description.textContent =
        "소석회 입고량을 월 단위로 기록하고 연간 누계를 확인합니다.";
    }
  }

  function setTabState(active) {
    const own = document.getElementById(TAB_ID);
    const others = [
      document.getElementById("limestoneReceiptSubviewButton"),
      document.getElementById("limestoneUsageSubviewButton")
    ].filter(Boolean);

    if (own) {
      own.classList.toggle("is-active", active);
      own.setAttribute("aria-selected", String(active));
      own.tabIndex = active ? 0 : -1;
    }

    if (active) {
      for (const button of others) {
        button.classList.remove("is-active");
        button.setAttribute("aria-selected", "false");
        button.tabIndex = -1;
      }
    }
  }

  function activateHydratedView() {
    const view = parentView();
    const panel = ensurePanel();
    if (!view || !panel) return;

    view.dataset.hydratedLimeMonthlyActive = "1";

    const receipt = receiptView();
    const usage = usageView();
    if (receipt) receipt.hidden = true;
    if (usage) usage.hidden = true;
    panel.hidden = false;

    setHeadingHydrated();
    hideLegacyHeaderActionsForHydrated();
    setOwnActionsVisible(true);
    setTabState(true);

    if (!state.month) state.month = currentMonthKst();
    state.year = state.month.slice(0, 4);

    const monthInput = panel.querySelector("[data-hlm-month]");
    if (monthInput) monthInput.value = state.month;

    loadYear(false);
  }

  function deactivateHydratedView() {
    const view = parentView();
    const panel = document.getElementById(PANEL_ID);

    if (view) delete view.dataset.hydratedLimeMonthlyActive;
    if (panel) panel.hidden = true;

    setOwnActionsVisible(false);
    setTabState(false);
  }

  function bindStandardTabs() {
    const buttons = [
      document.getElementById("limestoneReceiptSubviewButton"),
      document.getElementById("limestoneUsageSubviewButton")
    ].filter(Boolean);

    for (const button of buttons) {
      if (button.dataset.hydratedLimeDeactivateBound === "1") continue;
      button.dataset.hydratedLimeDeactivateBound = "1";

      button.addEventListener("click", () => {
        window.setTimeout(deactivateHydratedView, 0);
      });
    }
  }

  function setMonth(month, load = true) {
    if (!validMonth(month)) return;

    const oldYear = state.year;
    state.month = month;
    state.year = month.slice(0, 4);

    const panel = document.getElementById(PANEL_ID);
    const input = panel?.querySelector("[data-hlm-month]");
    if (input && input.value !== month) input.value = month;

    if (load && state.year !== oldYear) {
      loadYear(false);
    } else {
      render();
    }
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const selected = state.items.find((item) => item.month === state.month);
    const total = state.items.reduce(
      (sum, item) => sum + (Number(item.quantityTon) || 0),
      0
    );
    const count = state.items.length;
    const average = count ? total / count : 0;

    panel.querySelector("[data-hlm-selected-quantity]").innerHTML =
      `${number(selected?.quantityTon)} <small>ton</small>`;
    panel.querySelector("[data-hlm-year-total]").innerHTML =
      `${number(total)} <small>ton</small>`;
    panel.querySelector("[data-hlm-year-average]").innerHTML =
      `${number(average)} <small>ton</small>`;
    panel.querySelector("[data-hlm-record-count]").innerHTML =
      `${count} <small>개월</small>`;
    panel.querySelector("[data-hlm-year-label]").textContent =
      `${state.year || state.month.slice(0, 4)}년`;

    const body = panel.querySelector("[data-hlm-body]");
    if (!body) return;

    if (state.loading) {
      body.innerHTML =
        '<tr><td colspan="6" class="hlm-empty">월별 기록을 불러오는 중입니다.</td></tr>';
      return;
    }

    if (!state.items.length) {
      body.innerHTML =
        '<tr><td colspan="6" class="hlm-empty">등록된 소석회 월별 기록이 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = state.items
      .slice()
      .sort((a, b) => b.month.localeCompare(a.month))
      .map(
        (item) => `
          <tr class="${item.month === state.month ? "is-selected" : ""}">
            <td><strong>${escapeHtml(monthLabel(item.month))}</strong></td>
            <td><strong class="hlm-ton">${number(item.quantityTon)} t</strong></td>
            <td class="hlm-note">${escapeHtml(item.note || "-")}</td>
            <td>${escapeHtml(item.updatedByName || "-")}</td>
            <td>${escapeHtml(formatSavedAt(item.updatedAt))}</td>
            <td>
              <div class="hlm-actions">
                <button type="button" data-hlm-edit="${escapeHtml(item.month)}">수정</button>
                <button type="button" class="danger" data-hlm-delete="${escapeHtml(item.month)}">삭제</button>
              </div>
            </td>
          </tr>
        `
      )
      .join("");
  }

  function formatSavedAt(value) {
    const raw = text(value);
    if (!raw) return "-";

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;

    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  async function loadYear(force) {
    if (state.loading) return;

    if (!state.month) state.month = currentMonthKst();
    state.year = state.month.slice(0, 4);

    if (!force && state.loaded && state.loadedYear === state.year) {
      render();
      return;
    }

    state.loading = true;
    render();

    try {
      const payload = await api(
        `${API}?year=${encodeURIComponent(state.year)}`
      );

      state.items = Array.isArray(payload.items) ? payload.items : [];
      state.loaded = true;
      state.loadedYear = state.year;
    } catch (error) {
      state.items = [];
      window.alert(error.message);
    } finally {
      state.loading = false;
      render();
    }
  }

  function editorElements() {
    const panel = document.getElementById(PANEL_ID);
    return {
      backdrop: panel?.querySelector("[data-hlm-editor]"),
      form: panel?.querySelector("[data-hlm-form]"),
      month: panel?.querySelector("[data-hlm-edit-month]"),
      quantity: panel?.querySelector("[data-hlm-quantity]"),
      note: panel?.querySelector("[data-hlm-note]"),
      status: panel?.querySelector("[data-hlm-editor-status]"),
      save: panel?.querySelector("[data-hlm-save]")
    };
  }

  function openEditor(month) {
    const targetMonth = validMonth(month) ? month : state.month || currentMonthKst();
    const record = state.items.find((item) => item.month === targetMonth);
    const e = editorElements();
    if (!e.backdrop) return;

    e.month.value = targetMonth;
    e.quantity.value =
      record && Number.isFinite(Number(record.quantityTon))
        ? String(record.quantityTon)
        : "";
    e.note.value = record?.note || "";
    e.status.hidden = true;
    e.status.textContent = "";
    e.backdrop.hidden = false;

    window.setTimeout(() => e.quantity?.focus(), 0);
  }

  function closeEditor() {
    const e = editorElements();
    if (e.backdrop) e.backdrop.hidden = true;
  }

  async function saveRecord(event) {
    event.preventDefault();

    const e = editorElements();
    const month = text(e.month?.value);
    const quantity = Number(e.quantity?.value);
    const note = text(e.note?.value);

    if (!validMonth(month)) {
      window.alert("기준 월을 선택해 주세요.");
      return;
    }

    if (!Number.isFinite(quantity) || quantity < 0) {
      window.alert("월 입고량을 0 이상의 숫자로 입력해 주세요.");
      return;
    }

    if (e.save) {
      e.save.disabled = true;
      e.save.textContent = "저장 중...";
    }

    try {
      await api(API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-ShiftLog-Client": "desktop"
        },
        body: JSON.stringify({
          month,
          quantityTon: quantity,
          note
        })
      });

      closeEditor();
      state.month = month;
      state.year = month.slice(0, 4);
      state.loaded = false;
      await loadYear(true);
    } catch (error) {
      if (e.status) {
        e.status.textContent = error.message;
        e.status.hidden = false;
      } else {
        window.alert(error.message);
      }
    } finally {
      if (e.save) {
        e.save.disabled = false;
        e.save.textContent = "저장";
      }
    }
  }

  async function deleteRecord(month) {
    if (!validMonth(month)) return;

    const record = state.items.find((item) => item.month === month);
    const quantity = number(record?.quantityTon);

    const confirmed = window.confirm(
      `${monthLabel(month)} 소석회 기록 ${quantity} ton을 삭제하시겠습니까?`
    );
    if (!confirmed) return;

    try {
      await api(`${API}?month=${encodeURIComponent(month)}`, {
        method: "DELETE",
        headers: { "X-ShiftLog-Client": "desktop" }
      });

      state.loaded = false;
      await loadYear(true);
    } catch (error) {
      window.alert(error.message);
    }
  }

  function bindPanel(panel) {
    if (!panel || panel.dataset.hydratedLimeBound === "1") return;
    panel.dataset.hydratedLimeBound = "1";

    panel.querySelector("[data-hlm-prev]")?.addEventListener("click", () => {
      setMonth(moveMonth(state.month, -1));
    });

    panel.querySelector("[data-hlm-next]")?.addEventListener("click", () => {
      setMonth(moveMonth(state.month, 1));
    });

    panel.querySelector("[data-hlm-current]")?.addEventListener("click", () => {
      setMonth(currentMonthKst());
    });

    panel.querySelector("[data-hlm-month]")?.addEventListener("change", (event) => {
      setMonth(event.target.value);
    });

    panel.querySelector("[data-hlm-close]")?.addEventListener("click", closeEditor);
    panel.querySelector("[data-hlm-cancel]")?.addEventListener("click", closeEditor);
    panel.querySelector("[data-hlm-form]")?.addEventListener("submit", saveRecord);

    panel.querySelector("[data-hlm-editor]")?.addEventListener("click", (event) => {
      if (event.target.matches("[data-hlm-editor]")) closeEditor();
    });

    panel.addEventListener("click", (event) => {
      const edit = event.target.closest("[data-hlm-edit]");
      if (edit) {
        openEditor(edit.dataset.hlmEdit);
        return;
      }

      const del = event.target.closest("[data-hlm-delete]");
      if (del) {
        deleteRecord(del.dataset.hlmDelete);
      }
    });
  }

  function enhance() {
    renameParentMenu();

    const view = parentView();
    if (!view) return false;

    const menu = submenu();
    const receipt = receiptView();
    if (!menu || !receipt) return false;

    ensurePanel();
    ensureTab();
    ensureHeaderActions();
    bindStandardTabs();

    if (!state.month) {
      state.month = currentMonthKst();
      state.year = state.month.slice(0, 4);
    }

    if (view.dataset.hydratedLimeMonthlyActive === "1") {
      activateHydratedView();
    }

    return true;
  }

  function scheduleEnhance() {
    window.setTimeout(enhance, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }

  document.addEventListener("click", scheduleEnhance, true);
  window.addEventListener("focus", scheduleEnhance);

  for (const delay of [120, 350, 800, 1500, 3000, 6000, 10000]) {
    window.setTimeout(enhance, delay);
  }
})();
