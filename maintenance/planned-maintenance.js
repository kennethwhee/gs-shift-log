"use strict";

(function initializePlannedMaintenancePage() {
  const API_URL =
    "/api/planned-maintenance";

  const management =
    window.GSManagement;

  if (!management) {
    throw new Error(
      "관리 공통 모듈을 불러오지 못했습니다."
    );
  }

  const params =
    new URLSearchParams(
      window.location.search
    );

  const initialView =
    params.get("view") === "work"
      ? "work"
      : "logic";

  const state = {
    year: 2027,
    unit: "1",
    view: initialView,
    version: 0,
    recordId: "",
    rows: [],
    dirty: false,
    loading: false,
    lastModifiedBy: "",
    updatedAt: ""
  };

  const elements = {
    authWarning:
      document.getElementById(
        "plannedMaintenanceAuthWarning"
      ),
    title:
      document.getElementById(
        "plannedMaintenancePageTitle"
      ),
    yearSelect:
      document.getElementById(
        "plannedMaintenanceYearSelect"
      ),
    addRowButton:
      document.getElementById(
        "plannedMaintenanceAddRowButton"
      ),
    reloadButton:
      document.getElementById(
        "plannedMaintenanceReloadButton"
      ),
    previewButton:
      document.getElementById(
        "plannedMaintenancePreviewButton"
      ),
    saveButton:
      document.getElementById(
        "plannedMaintenanceSaveButton"
      ),
    homeButton:
      document.getElementById(
        "plannedMaintenanceHomeButton"
      ),
    statusDot:
      document.getElementById(
        "plannedMaintenanceStatusDot"
      ),
    contextLabel:
      document.getElementById(
        "plannedMaintenanceContextLabel"
      ),
    statusText:
      document.getElementById(
        "plannedMaintenanceStatusText"
      ),
    modifierText:
      document.getElementById(
        "plannedMaintenanceModifierText"
      ),
    table:
      document.getElementById(
        "plannedMaintenanceTable"
      ),
    tableHead:
      document.getElementById(
        "plannedMaintenanceTableHead"
      ),
    tableBody:
      document.getElementById(
        "plannedMaintenanceTableBody"
      )
  };

  function getViewLabel() {
    return state.view === "work"
      ? "작업필요사항"
      : "Logic 개선";
  }

  function getDocumentTitle() {
    if (state.view === "work") {
      return (
        `${state.year}년 #${state.unit}호기 ` +
        "계획정비 필요 작업사항"
      );
    }

    return (
      `${state.year}년 #${state.unit}호기 ` +
      "계획정비 Logic 수정 및 보완 요청 List"
    );
  }

  function syncContextUi() {
    document
      .querySelectorAll(
        "[data-planned-maintenance-view]"
      )
      .forEach(
        button => {
          button.classList.toggle(
            "is-active",
            button.dataset
              .plannedMaintenanceView ===
              state.view
          );
        }
      );

    document
      .querySelectorAll(
        "[data-planned-maintenance-unit]"
      )
      .forEach(
        button => {
          button.classList.toggle(
            "is-active",
            button.dataset
              .plannedMaintenanceUnit ===
              state.unit
          );
        }
      );

    elements.yearSelect.value =
      String(state.year);

    elements.title.textContent =
      getViewLabel();

    elements.contextLabel.textContent =
      `${state.year}년 · ${state.unit}호기 · ${getViewLabel()}`;

    const url =
      new URL(
        window.location.href
      );

    url.searchParams.set(
      "view",
      state.view
    );

    history.replaceState(
      null,
      "",
      url
    );
  }

  function setDirty(
    dirty
  ) {
    state.dirty =
      Boolean(dirty);

    elements.statusDot.classList.toggle(
      "is-dirty",
      state.dirty
    );

    elements.statusDot.classList.toggle(
      "is-saved",
      !state.dirty &&
      state.version > 0
    );

    if (state.dirty) {
      elements.statusText.textContent =
        "저장되지 않은 변경사항 있음";
    } else if (state.version > 0) {
      elements.statusText.textContent =
        `저장됨 · v${state.version}`;
    } else {
      elements.statusText.textContent =
        "아직 저장된 기록 없음";
    }
  }

  function setLoading(
    loading
  ) {
    state.loading =
      Boolean(loading);

    [
      elements.addRowButton,
      elements.reloadButton,
      elements.saveButton,
      elements.previewButton,
      elements.yearSelect
    ].forEach(
      element => {
        if (element) {
          element.disabled =
            state.loading;
        }
      }
    );
  }

  function createLogicRow() {
    return {
      id:
        management.createId(
          "pm-logic"
        ),
      createdDate:
        management.todayDate(),
      equipmentName: "",
      reason: "",
      targetEquipment: "",
      progress: "",
      author:
        management.getUserName(),
      controlReply1: "",
      operationReply1: "",
      controlReply2: "",
      remark: ""
    };
  }

  function createWorkRow() {
    return {
      id:
        management.createId(
          "pm-work"
        ),
      category: "제어",
      equipmentName: "",
      tag: "",
      reason: "",
      issueDate:
        management.todayDate(),
      progress: "",
      author:
        management.getUserName(),
      remark: ""
    };
  }

  function ensureVisibleRow() {
    if (state.rows.length > 0) {
      return;
    }

    state.rows = [
      state.view === "work"
        ? createWorkRow()
        : createLogicRow()
    ];

    setDirty(false);
  }

  function inputHtml(
    row,
    field,
    type = "text"
  ) {
    return `
      <input
        type="${type}"
        data-pm-field="${field}"
        value="${management.escapeHtml(row[field] || "")}"
      >
    `;
  }

  function textareaHtml(
    row,
    field
  ) {
    return `
      <textarea
        data-pm-field="${field}"
      >${management.escapeHtml(row[field] || "")}</textarea>
    `;
  }

  function renderLogicTable() {
    elements.table.className =
      "planned-maintenance-table is-logic";

    elements.tableHead.innerHTML = `
      <tr>
        <th>번호</th>
        <th>작성일시</th>
        <th>설 비 명</th>
        <th>사 유</th>
        <th>대상 설비</th>
        <th>진행사항</th>
        <th>작성자</th>
        <th>제어 회신 (1차)</th>
        <th>설비운영팀 회신 (1차)</th>
        <th>제어 회신 (2차)</th>
        <th>비 고</th>
        <th data-pm-action-column>삭제</th>
      </tr>
    `;

    elements.table.innerHTML = `
      <colgroup>
        <col class="pm-col-number">
        <col class="pm-col-date">
        <col class="pm-col-equipment">
        <col class="pm-col-reason">
        <col class="pm-col-target">
        <col class="pm-col-progress">
        <col class="pm-col-author">
        <col class="pm-col-reply">
        <col class="pm-col-reply">
        <col class="pm-col-reply">
        <col class="pm-col-remark">
        <col class="pm-col-action">
      </colgroup>
      <thead id="plannedMaintenanceTableHead">
        ${elements.tableHead.innerHTML}
      </thead>
      <tbody id="plannedMaintenanceTableBody"></tbody>
    `;

    elements.tableHead =
      document.getElementById(
        "plannedMaintenanceTableHead"
      );

    elements.tableBody =
      document.getElementById(
        "plannedMaintenanceTableBody"
      );

    elements.tableBody.innerHTML =
      state.rows.map(
        (row, index) => `
          <tr data-pm-row-id="${management.escapeHtml(row.id)}">
            <td class="pm-number-cell">${index + 1}</td>
            <td>${inputHtml(row, "createdDate", "date")}</td>
            <td>${textareaHtml(row, "equipmentName")}</td>
            <td>${textareaHtml(row, "reason")}</td>
            <td>${textareaHtml(row, "targetEquipment")}</td>
            <td>${textareaHtml(row, "progress")}</td>
            <td>${inputHtml(row, "author")}</td>
            <td>${textareaHtml(row, "controlReply1")}</td>
            <td>${textareaHtml(row, "operationReply1")}</td>
            <td>${textareaHtml(row, "controlReply2")}</td>
            <td>${textareaHtml(row, "remark")}</td>
            <td class="pm-row-delete-cell" data-pm-action-column>
              <button
                type="button"
                class="pm-row-delete-button"
                data-pm-delete-row
                aria-label="${index + 1}번 항목 삭제"
              >×</button>
            </td>
          </tr>
        `
      ).join("");
  }

  function renderWorkTable() {
    elements.table.className =
      "planned-maintenance-table is-work";

    elements.table.innerHTML = `
      <colgroup>
        <col class="pm-col-number">
        <col class="pm-col-category">
        <col class="pm-col-equipment">
        <col class="pm-col-tag">
        <col class="pm-col-reason">
        <col class="pm-col-date">
        <col class="pm-col-progress">
        <col class="pm-col-author">
        <col class="pm-col-remark">
        <col class="pm-col-action">
      </colgroup>
      <thead id="plannedMaintenanceTableHead">
        <tr>
          <th>번호</th>
          <th>분류</th>
          <th>설 비 명</th>
          <th>TAG</th>
          <th>사 유</th>
          <th>Issue Date</th>
          <th>진행사항</th>
          <th>작성자</th>
          <th>비 고</th>
          <th data-pm-action-column>삭제</th>
        </tr>
      </thead>
      <tbody id="plannedMaintenanceTableBody"></tbody>
    `;

    elements.tableHead =
      document.getElementById(
        "plannedMaintenanceTableHead"
      );

    elements.tableBody =
      document.getElementById(
        "plannedMaintenanceTableBody"
      );

    elements.tableBody.innerHTML =
      state.rows.map(
        (row, index) => `
          <tr data-pm-row-id="${management.escapeHtml(row.id)}">
            <td class="pm-number-cell">${index + 1}</td>
            <td>
              <select data-pm-field="category">
                ${[
                  "기계",
                  "전기",
                  "제어",
                  "안전",
                  "효율",
                  "기타"
                ].map(
                  option => `
                    <option
                      value="${option}"
                      ${row.category === option ? "selected" : ""}
                    >${option}</option>
                  `
                ).join("")}
              </select>
            </td>
            <td>${textareaHtml(row, "equipmentName")}</td>
            <td>${inputHtml(row, "tag")}</td>
            <td>${textareaHtml(row, "reason")}</td>
            <td>${inputHtml(row, "issueDate", "date")}</td>
            <td>${textareaHtml(row, "progress")}</td>
            <td>${inputHtml(row, "author")}</td>
            <td>${textareaHtml(row, "remark")}</td>
            <td class="pm-row-delete-cell" data-pm-action-column>
              <button
                type="button"
                class="pm-row-delete-button"
                data-pm-delete-row
                aria-label="${index + 1}번 항목 삭제"
              >×</button>
            </td>
          </tr>
        `
      ).join("");
  }

  function renderTable() {
    ensureVisibleRow();

    if (state.view === "work") {
      renderWorkTable();
    } else {
      renderLogicTable();
    }
  }

  function updateModifierText() {
    if (!state.updatedAt) {
      elements.modifierText.textContent =
        "";
      return;
    }

    const date =
      new Date(
        state.updatedAt
      );

    const dateText =
      Number.isNaN(
        date.getTime()
      )
        ? state.updatedAt
        : date.toLocaleString(
            "ko-KR"
          );

    elements.modifierText.textContent =
      state.lastModifiedBy
        ? `최종 수정 ${state.lastModifiedBy} · ${dateText}`
        : `최종 수정 ${dateText}`;
  }

  async function loadDocument() {
    const token =
      management.getSessionToken();

    if (!token) {
      elements.authWarning.hidden =
        false;
      elements.saveButton.disabled =
        true;
      elements.statusText.textContent =
        "로그인 필요";
      return;
    }

    elements.authWarning.hidden =
      true;

    setLoading(true);
    elements.statusText.textContent =
      "불러오는 중";

    try {
      const url =
        new URL(
          API_URL,
          window.location.origin
        );

      url.searchParams.set(
        "year",
        String(state.year)
      );
      url.searchParams.set(
        "unit",
        state.unit
      );
      url.searchParams.set(
        "type",
        state.view
      );

      const response =
        await fetch(
          url,
          {
            method: "GET",
            headers:
              management.getAuthHeaders(),
            cache: "no-store"
          }
        );

      const data =
        await management.parseJsonResponse(
          response
        );

      if (!response.ok || !data.ok) {
        throw new Error(
          data.message ||
          "계획정비 기록을 불러오지 못했습니다."
        );
      }

      const item =
        data.item || {};

      state.version =
        Number(item.version || 0);
      state.recordId =
        String(item.id || "");
      state.rows =
        Array.isArray(item.rows)
          ? item.rows
          : [];
      state.lastModifiedBy =
        String(
          item.lastModifiedBy ||
          item.updatedByName ||
          ""
        );
      state.updatedAt =
        String(
          item.updatedAt ||
          ""
        );

      renderTable();
      updateModifierText();
      setDirty(false);

    } catch (error) {
      console.error(
        "계획정비 불러오기 오류:",
        error
      );

      management.showToast(
        error instanceof Error
          ? error.message
          : "계획정비 기록을 불러오지 못했습니다.",
        "error"
      );

      state.rows = [];
      state.version = 0;
      renderTable();
      setDirty(false);

    } finally {
      setLoading(false);
    }
  }

  async function saveDocument() {
    if (state.loading) {
      return;
    }

    if (!management.getSessionToken()) {
      management.showToast(
        "로그인 정보가 없습니다.",
        "error"
      );
      return;
    }

    setLoading(true);
    elements.statusText.textContent =
      "저장 중";

    try {
      const response =
        await fetch(
          API_URL,
          {
            method: "PUT",
            headers:
              management.getAuthHeaders({
                "Content-Type":
                  "application/json; charset=utf-8"
              }),
            body:
              JSON.stringify({
                year: state.year,
                unit: state.unit,
                type: state.view,
                version: state.version,
                rows: state.rows
              }),
            cache: "no-store"
          }
        );

      const data =
        await management.parseJsonResponse(
          response
        );

      if (!response.ok || !data.ok) {
        if (response.status === 409) {
          throw new Error(
            "다른 사용자가 먼저 수정했습니다. 다시 불러온 뒤 저장해 주세요."
          );
        }

        throw new Error(
          data.message ||
          "계획정비 기록 저장에 실패했습니다."
        );
      }

      const item =
        data.item || {};

      state.version =
        Number(item.version || 0);
      state.recordId =
        String(item.id || "");
      state.rows =
        Array.isArray(item.rows)
          ? item.rows
          : state.rows;
      state.lastModifiedBy =
        String(
          item.lastModifiedBy ||
          item.updatedByName ||
          ""
        );
      state.updatedAt =
        String(item.updatedAt || "");

      renderTable();
      updateModifierText();
      setDirty(false);

      management.showToast(
        "계획정비 기록을 저장했습니다.",
        "success"
      );

    } catch (error) {
      console.error(
        "계획정비 저장 오류:",
        error
      );

      setDirty(true);

      management.showToast(
        error instanceof Error
          ? error.message
          : "계획정비 기록 저장에 실패했습니다.",
        "error"
      );

    } finally {
      setLoading(false);
    }
  }

  function addRow() {
    state.rows.push(
      state.view === "work"
        ? createWorkRow()
        : createLogicRow()
    );

    renderTable();
    setDirty(true);

    window.requestAnimationFrame(
      () => {
        const wrap =
          document.querySelector(
            ".planned-maintenance-table-wrap"
          );

        wrap?.scrollTo({
          top:
            wrap.scrollHeight,
          behavior:
            "smooth"
        });
      }
    );
  }

  function confirmContextChange() {
    if (!state.dirty) {
      return true;
    }

    return window.confirm(
      "저장되지 않은 변경사항이 있습니다. 저장하지 않고 이동할까요?"
    );
  }

  async function changeContext(
    next
  ) {
    if (!confirmContextChange()) {
      syncContextUi();
      return;
    }

    if (next.view) {
      state.view = next.view;
    }

    if (next.unit) {
      state.unit = next.unit;
    }

    if (next.year) {
      state.year = Number(next.year);
    }

    state.version = 0;
    state.recordId = "";
    state.rows = [];
    state.lastModifiedBy = "";
    state.updatedAt = "";
    setDirty(false);
    syncContextUi();

    await loadDocument();
  }

  function buildPreviewHtml() {
    const logicHeaders = [
      "번호",
      "작성일시",
      "설 비 명",
      "사 유",
      "대상 설비",
      "진행사항",
      "작성자",
      "제어 회신 (1차)",
      "설비운영팀 회신 (1차)",
      "제어 회신 (2차)",
      "비 고"
    ];

    const workHeaders = [
      "번호",
      "분류",
      "설 비 명",
      "TAG",
      "사 유",
      "Issue Date",
      "진행사항",
      "작성자",
      "비 고"
    ];

    const headers =
      state.view === "work"
        ? workHeaders
        : logicHeaders;

    const fields =
      state.view === "work"
        ? [
            "category",
            "equipmentName",
            "tag",
            "reason",
            "issueDate",
            "progress",
            "author",
            "remark"
          ]
        : [
            "createdDate",
            "equipmentName",
            "reason",
            "targetEquipment",
            "progress",
            "author",
            "controlReply1",
            "operationReply1",
            "controlReply2",
            "remark"
          ];

    const rowsHtml =
      state.rows.map(
        (row, index) => `
          <tr>
            <td class="number">${index + 1}</td>
            ${fields.map(
              field => `
                <td>${management.textToHtml(row[field] || "")}</td>
              `
            ).join("")}
          </tr>
        `
      ).join("");

    const workLegend =
      state.view === "work"
        ? `
          <div class="legend">
            <span></span>
            정지 중 필수 작업 사항(효율,안전)
          </div>
        `
        : "";

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${management.escapeHtml(getDocumentTitle())}</title>
<style>
  @page { size: A4 landscape; margin: 9mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Malgun Gothic", sans-serif; color: #111; background: #e9eef4; }
  .toolbar { position: sticky; top: 0; z-index: 10; display: flex; justify-content: flex-end; gap: 8px; padding: 10px 14px; background: #fff; border-bottom: 1px solid #ccd6e1; }
  .toolbar button { min-height: 34px; padding: 0 13px; border: 1px solid #b8c5d3; border-radius: 7px; background: #fff; font-weight: 800; cursor: pointer; }
  .toolbar button.primary { border-color: #1f5fae; background: #1f5fae; color: #fff; }
  .stage { padding: 20px; }
  .paper { width: 277mm; min-height: 190mm; margin: 0 auto; padding: 7mm; background: #fff; box-shadow: 0 12px 30px rgba(20,35,55,.16); }
  h1 { margin: 0 0 7mm; font-size: 20px; text-align: center; text-decoration: underline; }
  .meta { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 2mm; font-size: 10px; font-weight: 700; }
  .legend { display: flex; align-items: center; gap: 6px; }
  .legend span { width: 22mm; height: 5mm; background: #ffc31a; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border: 1px solid #1f2933; padding: 2mm 1.5mm; vertical-align: middle; font-size: ${state.view === "logic" ? "7.2px" : "8px"}; line-height: 1.35; word-break: break-word; white-space: normal; }
  th { background: #9fc5e6; font-weight: 900; text-align: center; }
  td.number { width: 8mm; text-align: center; font-weight: 800; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .stage { padding: 0; }
    .paper { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.close()">닫기</button>
    <button class="primary" onclick="window.print()">인쇄 / PDF 저장</button>
  </div>
  <div class="stage">
    <section class="paper">
      <h1>${management.escapeHtml(getDocumentTitle())}</h1>
      <div class="meta">
        <strong>설비운영팀</strong>
        ${workLegend}
      </div>
      <table>
        <thead>
          <tr>${headers.map(header => `<th>${management.escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </section>
  </div>
</body>
</html>`;
  }

  function openPreview() {
    const previewWindow =
      window.open(
        "",
        "GS_PLANNED_MAINTENANCE_PREVIEW"
      );

    if (!previewWindow) {
      management.showToast(
        "팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.",
        "error"
      );
      return;
    }

    previewWindow.document.open();
    previewWindow.document.write(
      buildPreviewHtml()
    );
    previewWindow.document.close();
    previewWindow.focus();
  }

  elements.table.addEventListener(
    "input",
    event => {
      const fieldElement =
        event.target.closest?.(
          "[data-pm-field]"
        );

      if (!fieldElement) {
        return;
      }

      const rowElement =
        fieldElement.closest(
          "[data-pm-row-id]"
        );

      const row =
        state.rows.find(
          item =>
            item.id ===
            rowElement?.dataset.pmRowId
        );

      if (!row) {
        return;
      }

      row[
        fieldElement.dataset.pmField
      ] = fieldElement.value;

      setDirty(true);
    }
  );

  elements.table.addEventListener(
    "change",
    event => {
      event.target.dispatchEvent(
        new Event(
          "input",
          { bubbles: true }
        )
      );
    }
  );

  elements.table.addEventListener(
    "click",
    event => {
      const deleteButton =
        event.target.closest?.(
          "[data-pm-delete-row]"
        );

      if (!deleteButton) {
        return;
      }

      const rowElement =
        deleteButton.closest(
          "[data-pm-row-id]"
        );

      const rowId =
        rowElement?.dataset.pmRowId;

      state.rows =
        state.rows.filter(
          row => row.id !== rowId
        );

      renderTable();
      setDirty(true);
    }
  );

  document
    .querySelectorAll(
      "[data-planned-maintenance-view]"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          () => {
            changeContext({
              view:
                button.dataset
                  .plannedMaintenanceView
            });
          }
        );
      }
    );

  document
    .querySelectorAll(
      "[data-planned-maintenance-unit]"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          () => {
            changeContext({
              unit:
                button.dataset
                  .plannedMaintenanceUnit
            });
          }
        );
      }
    );

  elements.yearSelect.addEventListener(
    "change",
    () => {
      changeContext({
        year:
          elements.yearSelect.value
      });
    }
  );

  elements.addRowButton.addEventListener(
    "click",
    addRow
  );

  elements.reloadButton.addEventListener(
    "click",
    () => {
      if (!confirmContextChange()) {
        return;
      }

      loadDocument();
    }
  );

  elements.saveButton.addEventListener(
    "click",
    saveDocument
  );

  elements.previewButton.addEventListener(
    "click",
    openPreview
  );

  elements.homeButton.addEventListener(
    "click",
    () => {
      window.location.href = "/";
    }
  );

  window.addEventListener(
    "beforeunload",
    event => {
      if (!state.dirty) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }
  );

  syncContextUi();
  loadDocument();
})();
