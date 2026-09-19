(() => {
  "use strict";

  /* HYDRATED LIME RECEIPTS V2 R2 TIME INPUT */
  const API = "/api/hydrated-lime-receipts";
  const PARENT_VIEW_ID = "efficiencyLimestoneView";
  const PARENT_TAB_ID = "efficiencyLimestoneTab";
  const SUBMENU_ID = "limestoneSubviewMenu";
  const RECEIPT_VIEW_ID = "limestoneDashboard";
  const USAGE_VIEW_ID = "limestoneUsageCalculatorView";
  const TAB_ID = "hydratedLimeSubviewButton";
  const PANEL_ID = "hydratedLimeReceiptView";
  const REFRESH_ID = "refreshHydratedLimeReceiptsButton";
  const OPEN_EDITOR_ID = "openHydratedLimeReceiptEditorButton";
  const STORAGE_KEY = "gsShiftLog.currentUser";

  const state = {
    month: "",
    items: [],
    loadedMonth: "",
    yearTotal: 0,
    yearAverage: 0,
    loading: false
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

    return {
      year: value("year"),
      month: value("month"),
      day: value("day"),
      hour: value("hour"),
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
    return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(text(value));
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

  function validTime(value) {
    return Boolean(normalizeTimeInput(value));
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
    return `${year}년 ${month}월`;
  }

  function monthDayLabel(value) {
    if (!validDate(value)) return "-";
    return value.slice(5);
  }

  function selectedMonthDefaultDate(month) {
    const currentDate = currentDateKst();
    if (currentDate.startsWith(`${month}-`)) return currentDate;
    return `${month}-01`;
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
          `소석회 입고 기록 요청에 실패했습니다. (${response.status})`
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

    const label = button.querySelector(".efficiency-team-tab__label");

    if (label) {
      if (text(label.textContent) !== "석회석/소석회") {
        label.textContent = "석회석/소석회";
      }
    } else {
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
        class="hydrated-lime-receipts-v2"
        id="${PANEL_ID}"
        role="tabpanel"
        aria-labelledby="${TAB_ID}"
        hidden
      >
        <section class="hlr-month-card">
          <button type="button" class="hlr-date-arrow" data-hlr-prev aria-label="이전 달">‹</button>

          <label class="hlr-month-field">

            <input type="month" data-hlr-month value="${month}">
          </label>

          <button type="button" class="hlr-date-arrow" data-hlr-next aria-label="다음 달">›</button>
          <button type="button" class="hlr-current-button" data-hlr-current>이번 달</button>

          <span class="hlr-month-note">
            월 단위로 조회하고, 입고 건은 월일·시간·톤수로 기록합니다.
          </span>
        </section>

        <section class="hlr-summary-grid">
          <article class="hlr-summary-card is-blue">
            <span>선택 월 입고량</span>
            <strong data-hlr-total>0.00 <small>ton</small></strong>
          </article>

          <article class="hlr-summary-card is-green">
            <span>연간 누적</span>
            <strong data-hlr-year-total>0.00 <small>ton</small></strong>
          </article>

          <article class="hlr-summary-card is-purple">
            <span>월 평균</span>
            <strong data-hlr-year-average>0.00 <small>ton</small></strong>
          </article>

          <article class="hlr-summary-card is-orange">
            <span>기록 횟수</span>
            <strong data-hlr-count>0 <small>회</small></strong>
          </article>
        </section>

        <section class="hlr-history-card">
          <header class="hlr-history-head">
            <div>
              <span>HYDRATED LIME RECEIPT HISTORY</span>
              <strong>입고기록 상세</strong>
            </div>

            <em data-hlr-count-badge>0건</em>
          </header>

          <div class="hlr-table-wrap">
            <table class="hlr-table">
              <thead>
                <tr>
                  <th>월일</th>
                  <th>시간</th>
                  <th>입고량</th>
                  <th>당일 누적</th>
                  <th>출처</th>
                  <th>비고</th>
                  <th>관리</th>
                </tr>
              </thead>

              <tbody data-hlr-body>
                <tr>
                  <td colspan="7" class="hlr-empty">소석회 입고 기록을 불러오는 중입니다.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="hlr-editor-backdrop" data-hlr-editor hidden>
          <form class="hlr-editor" data-hlr-form>
            <header>
              <div>
                <span>HYDRATED LIME RECEIPT</span>
                <strong data-hlr-editor-title>소석회 입고 기록</strong>
              </div>

              <button type="button" class="hlr-editor-close" data-hlr-close aria-label="닫기">×</button>
            </header>

            <div class="hlr-editor-body">
              <input type="hidden" data-hlr-id>

              <label>
                <span>입고 일자</span>
                <input type="date" data-hlr-date required>
              </label>

              <label>
                <span>입고 시간</span>
                <input
                  type="text"
                  data-hlr-time
                  inputmode="numeric"
                  maxlength="5"
                  autocomplete="off"
                  placeholder="1530 또는 15:30"
                  aria-label="입고 시간, 1530 또는 15:30 형식"
                  required
                >
              </label>

              <label>
                <span>입고량 (ton)</span>
                <input
                  type="number"
                  data-hlr-quantity
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
                  data-hlr-note
                  rows="3"
                  maxlength="500"
                  placeholder="필요한 내용만 간단히 기록"
                ></textarea>
              </label>
            </div>

            <p class="hlr-editor-status" data-hlr-editor-status hidden></p>

            <footer>
              <button type="button" class="secondary-button" data-hlr-cancel>취소</button>
              <button type="submit" class="primary-button" data-hlr-save>저장</button>
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
      refresh.addEventListener("click", () => loadMonth(true));
      actions.append(refresh);
    }

    let add = document.getElementById(OPEN_EDITOR_ID);

    if (!add) {
      add = document.createElement("button");
      add.type = "button";
      add.id = OPEN_EDITOR_ID;
      add.className = "primary-button";
      add.textContent = "+ 입고 기록";
      add.hidden = true;
      add.addEventListener("click", () => openEditor());
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

  function setLegacyActionsHidden(hidden) {
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
      if (node) node.hidden = hidden;
    }

    const guide = headingParts().actions?.querySelector(
      ".limestone-slip-camera-guide"
    );
    if (guide && hidden) guide.hidden = true;
  }

  function setHeadingHydrated() {
    const { eyebrow, title, description, actions } = headingParts();

    if (eyebrow) eyebrow.textContent = "HYDRATED LIME RECEIPT";
    if (title) title.textContent = "소석회 입고 현황";
    if (description) {
      description.textContent =
        "소석회 입고량을 월 단위로 조회하고 입고 건별로 기록합니다.";
    }

    // Usage view may leave this whole action area hidden.
    if (actions) actions.hidden = false;
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

    view.dataset.hydratedLimeActive = "1";

    const receipt = receiptView();
    const usage = usageView();

    if (receipt) receipt.hidden = true;
    if (usage) usage.hidden = true;
    panel.hidden = false;

    setHeadingHydrated();
    setLegacyActionsHidden(true);
    setOwnActionsVisible(true);
    setTabState(true);

    if (!state.month) state.month = currentMonthKst();

    const monthInput = panel.querySelector("[data-hlr-month]");
    if (monthInput) monthInput.value = state.month;

    loadMonth(false);
  }

  function deactivateHydratedView() {
    const view = parentView();
    const panel = document.getElementById(PANEL_ID);

    if (view) delete view.dataset.hydratedLimeActive;
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
      if (button.dataset.hydratedLimeV2DeactivateBound === "1") continue;

      button.dataset.hydratedLimeV2DeactivateBound = "1";

      // Synchronous target-capture cleanup is intentional.
      // document's capture handler schedules enhance(), so we must clear the
      // hydrated mode during the same click stack before that timer runs.
      button.addEventListener(
        "click",
        () => {
          deactivateHydratedView();
        },
        true
      );
    }
  }

  function setMonth(month, load = true) {
    if (!validMonth(month)) return;

    state.month = month;

    const panel = document.getElementById(PANEL_ID);
    const input = panel?.querySelector("[data-hlr-month]");

    if (input && input.value !== month) input.value = month;

    if (load) loadMonth(false);
    else render();
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

      return {
        ...item,
        dailyCumulative: cumulative
      };
    });

    return withCumulative.sort((a, b) => {
      const aKey = `${a.receiptDate} ${a.receiptTime} ${String(a.id).padStart(12, "0")}`;
      const bKey = `${b.receiptDate} ${b.receiptTime} ${String(b.id).padStart(12, "0")}`;
      return bKey.localeCompare(aKey);
    });
  }

  function render() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;

    const total = state.items.reduce(
      (sum, item) => sum + (Number(item.quantityTon) || 0),
      0
    );
    const count = state.items.length;

    panel.querySelector("[data-hlr-total]").innerHTML =
      `${number(total)} <small>ton</small>`;
    panel.querySelector("[data-hlr-year-total]").innerHTML =
      `${number(state.yearTotal)} <small>ton</small>`;
    panel.querySelector("[data-hlr-year-average]").innerHTML =
      `${number(state.yearAverage)} <small>ton</small>`;
    panel.querySelector("[data-hlr-count]").innerHTML =
      `${count} <small>회</small>`;
    panel.querySelector("[data-hlr-count-badge]").textContent = `${count}건`;

    const body = panel.querySelector("[data-hlr-body]");
    if (!body) return;

    if (state.loading) {
      body.innerHTML =
        '<tr><td colspan="7" class="hlr-empty">소석회 입고 기록을 불러오는 중입니다.</td></tr>';
      return;
    }

    const rows = computeRows();

    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="7" class="hlr-empty">조회 월에 등록된 소석회 입고 기록이 없습니다.</td></tr>';
      return;
    }

    body.innerHTML = rows
      .map(
        (item) => `
          <tr>
            <td><strong>${escapeHtml(monthDayLabel(item.receiptDate))}</strong></td>
            <td><strong>${escapeHtml(item.receiptTime)}</strong></td>
            <td><strong class="hlr-ton">${number(item.quantityTon)} t</strong></td>
            <td><strong class="hlr-cumulative">${number(item.dailyCumulative)} t</strong></td>
            <td>${escapeHtml(item.sourceLabel || "직접 입력")}</td>
            <td class="hlr-note">${escapeHtml(item.note || "-")}</td>
            <td>
              <div class="hlr-actions">
                <button type="button" data-hlr-edit="${Number(item.id)}">수정</button>
                <button type="button" class="danger" data-hlr-delete="${Number(item.id)}">삭제</button>
              </div>
            </td>
          </tr>
        `
      )
      .join("");
  }

  async function loadMonth(force) {
    if (state.loading) return;
    if (!state.month) state.month = currentMonthKst();

    if (!force && state.loadedMonth === state.month) {
      render();
      return;
    }

    state.loading = true;
    render();

    try {
      const payload = await api(
        `${API}?month=${encodeURIComponent(state.month)}`
      );

      state.items = Array.isArray(payload.items) ? payload.items : [];
      state.yearTotal = Number(payload.summary?.yearTotal || 0);
      state.yearAverage = Number(payload.summary?.yearAverage || 0);
      state.loadedMonth = state.month;
    } catch (error) {
      state.items = [];
      state.loadedMonth = "";
      window.alert(error.message);
    } finally {
      state.loading = false;
      render();
    }
  }

  function editorElements() {
    const panel = document.getElementById(PANEL_ID);

    return {
      backdrop: panel?.querySelector("[data-hlr-editor]"),
      form: panel?.querySelector("[data-hlr-form]"),
      title: panel?.querySelector("[data-hlr-editor-title]"),
      id: panel?.querySelector("[data-hlr-id]"),
      date: panel?.querySelector("[data-hlr-date]"),
      time: panel?.querySelector("[data-hlr-time]"),
      quantity: panel?.querySelector("[data-hlr-quantity]"),
      note: panel?.querySelector("[data-hlr-note]"),
      status: panel?.querySelector("[data-hlr-editor-status]"),
      save: panel?.querySelector("[data-hlr-save]")
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
    e.backdrop.hidden = false;

    window.setTimeout(() => e.quantity?.focus(), 0);
  }

  function closeEditor() {
    const e = editorElements();
    if (e.backdrop) e.backdrop.hidden = true;
  }

  async function saveReceipt(event) {
    event.preventDefault();

    const e = editorElements();
    const id = Number(e.id?.value) || 0;
    const receiptDate = text(e.date?.value);
    const receiptTime = normalizeTimeInput(e.time?.value);
    const quantity = Number(e.quantity?.value);
    const note = text(e.note?.value);

    if (!validDate(receiptDate)) {
      window.alert("입고 일자를 선택해 주세요.");
      return;
    }

    if (!validTime(receiptTime)) {
      window.alert("입고 시간은 1530 또는 15:30 형식으로 입력해 주세요.");
      e.time?.focus();
      return;
    }

    if (e.time) {
      e.time.value = receiptTime;
    }

    if (!Number.isFinite(quantity) || quantity < 0) {
      window.alert("입고량을 0 이상의 숫자로 입력해 주세요.");
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
          id: id || undefined,
          receiptDate,
          receiptTime,
          quantityTon: quantity,
          note
        })
      });

      closeEditor();

      state.month = receiptDate.slice(0, 7);
      state.loadedMonth = "";

      const panel = document.getElementById(PANEL_ID);
      const monthInput = panel?.querySelector("[data-hlr-month]");
      if (monthInput) monthInput.value = state.month;

      await loadMonth(true);
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

  async function deleteReceipt(id) {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) return;

    const record = state.items.find((item) => Number(item.id) === numericId);
    if (!record) return;

    const confirmed = window.confirm(
      `${monthDayLabel(record.receiptDate)} ${record.receiptTime} · ${number(record.quantityTon)} t 소석회 입고 기록을 삭제하시겠습니까?`
    );

    if (!confirmed) return;

    try {
      await api(`${API}?id=${numericId}`, {
        method: "DELETE",
        headers: {
          "X-ShiftLog-Client": "desktop"
        }
      });

      state.loadedMonth = "";
      await loadMonth(true);
    } catch (error) {
      window.alert(error.message);
    }
  }

  function bindPanel(panel) {
    if (!panel || panel.dataset.hydratedLimeV2Bound === "1") return;
    panel.dataset.hydratedLimeV2Bound = "1";

    panel.querySelector("[data-hlr-prev]")?.addEventListener("click", () => {
      setMonth(moveMonth(state.month, -1));
    });

    panel.querySelector("[data-hlr-next]")?.addEventListener("click", () => {
      setMonth(moveMonth(state.month, 1));
    });

    panel.querySelector("[data-hlr-current]")?.addEventListener("click", () => {
      setMonth(currentMonthKst());
    });

    panel.querySelector("[data-hlr-month]")?.addEventListener("change", (event) => {
      setMonth(event.target.value);
    });

    const timeInput = panel.querySelector("[data-hlr-time]");
    if (timeInput) {
      timeInput.addEventListener("input", () => {
        const raw = text(timeInput.value).replace(/[^0-9:]/g, "");
        timeInput.value = raw.slice(0, 5);

        if (/^\d{4}$/.test(timeInput.value)) {
          const normalized = normalizeTimeInput(timeInput.value);
          if (normalized) timeInput.value = normalized;
        }
      });

      timeInput.addEventListener("blur", () => {
        const normalized = normalizeTimeInput(timeInput.value);
        if (normalized) timeInput.value = normalized;
      });
    }

    panel.querySelector("[data-hlr-close]")?.addEventListener("click", closeEditor);
    panel.querySelector("[data-hlr-cancel]")?.addEventListener("click", closeEditor);
    panel.querySelector("[data-hlr-form]")?.addEventListener("submit", saveReceipt);

    panel.querySelector("[data-hlr-editor]")?.addEventListener("click", (event) => {
      if (event.target.matches("[data-hlr-editor]")) closeEditor();
    });

    panel.addEventListener("click", (event) => {
      const edit = event.target.closest("[data-hlr-edit]");
      if (edit) {
        openEditor(edit.dataset.hlrEdit);
        return;
      }

      const del = event.target.closest("[data-hlr-delete]");
      if (del) {
        deleteReceipt(del.dataset.hlrDelete);
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

    if (!state.month) state.month = currentMonthKst();

    if (view.dataset.hydratedLimeActive === "1") {
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

/* HYDRATED_LIME_MONTH_LABEL_REMOVE_V2_R1 */
