"use strict";

/* [PLANNED-MAINTENANCE-EXCEL-TOTAL-V1] */

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

  const WORK_CATEGORIES = [
    "기계",
    "전기",
    "제어",
    "안전",
    "효율",
    "기타"
  ];

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
    updatedAt: "",
    aggregateMeta: null
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
    excelUploadButton:
      document.getElementById(
        "plannedMaintenanceExcelUploadButton"
      ),
    excelDownloadButton:
      document.getElementById(
        "plannedMaintenanceExcelDownloadButton"
      ),
    excelFileInput:
      document.getElementById(
        "plannedMaintenanceExcelFileInput"
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

  function isAggregateUnit() {
    return state.unit === "all";
  }

  function getViewLabel() {
    return state.view === "work"
      ? "작업필요사항"
      : "Logic 개선";
  }

  function getUnitLabel() {
    return isAggregateUnit()
      ? "종합"
      : `${state.unit}호기`;
  }

  function getDocumentTitle() {
    const unitTitle =
      isAggregateUnit()
        ? "#1·#2호기"
        : `#${state.unit}호기`;

    if (state.view === "work") {
      return (
        `${state.year}년 ${unitTitle} ` +
        "계획정비 필요 작업사항" +
        (isAggregateUnit() ? " 종합" : "")
      );
    }

    return (
      `${state.year}년 ${unitTitle} ` +
      "계획정비 Logic 수정 및 보완 요청 List" +
      (isAggregateUnit() ? " 종합" : "")
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
      `${state.year}년 · ${getUnitLabel()} · ${getViewLabel()}`;

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

    syncActionAvailability();
  }

  function syncActionAvailability() {
    const aggregate =
      isAggregateUnit();

    const authenticated =
      Boolean(
        management.getSessionToken()
      );

    if (elements.addRowButton) {
      elements.addRowButton.disabled =
        state.loading || aggregate;
    }

    if (elements.saveButton) {
      elements.saveButton.disabled =
        state.loading ||
        aggregate ||
        !authenticated;
    }

    if (elements.excelUploadButton) {
      elements.excelUploadButton.disabled =
        state.loading ||
        aggregate ||
        !authenticated;

      elements.excelUploadButton.title =
        aggregate
          ? "엑셀 업로드는 1호기 또는 2호기 탭에서 사용할 수 있습니다."
          : "기존 계획정비 Excel 문서를 현재 탭으로 불러옵니다.";
    }

    if (elements.excelDownloadButton) {
      elements.excelDownloadButton.disabled =
        state.loading;
    }

    if (elements.previewButton) {
      elements.previewButton.disabled =
        state.loading;
    }

    if (elements.reloadButton) {
      elements.reloadButton.disabled =
        state.loading;
    }

    if (elements.yearSelect) {
      elements.yearSelect.disabled =
        state.loading;
    }

    document
      .querySelectorAll(
        "[data-planned-maintenance-view], " +
        "[data-planned-maintenance-unit]"
      )
      .forEach(
        button => {
          button.disabled =
            state.loading;
        }
      );
  }

  function setDirty(
    dirty
  ) {
    if (isAggregateUnit()) {
      state.dirty = false;

      elements.statusDot.classList.remove(
        "is-dirty",
        "is-saved"
      );

      const oneCount =
        Number(
          state.aggregateMeta?.one?.rows?.length ||
          0
        );

      const twoCount =
        Number(
          state.aggregateMeta?.two?.rows?.length ||
          0
        );

      elements.statusText.textContent =
        `종합 조회 · 1호기 ${oneCount}건 · 2호기 ${twoCount}건`;

      return;
    }

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

    syncActionAvailability();
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
    if (
      isAggregateUnit() ||
      state.rows.length > 0
    ) {
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

  function displayCellHtml(
    value
  ) {
    const text =
      String(
        value ??
        ""
      );

    return text
      ? management.textToHtml(text)
      : "";
  }

  function renderLogicTable() {
    const aggregate =
      isAggregateUnit();

    elements.table.className =
      "planned-maintenance-table is-logic" +
      (aggregate ? " is-aggregate" : "");

    elements.table.innerHTML = `
      <colgroup>
        <col class="pm-col-number">
        ${aggregate ? '<col class="pm-col-unit">' : ""}
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
        ${aggregate ? "" : '<col class="pm-col-action">'}
      </colgroup>
      <thead id="plannedMaintenanceTableHead">
        <tr>
          <th>번호</th>
          ${aggregate ? "<th>호기</th>" : ""}
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
          ${aggregate ? "" : "<th data-pm-action-column>삭제</th>"}
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

    if (aggregate) {
      elements.tableBody.innerHTML =
        state.rows.map(
          (row, index) => `
            <tr>
              <td class="pm-number-cell">${index + 1}</td>
              <td class="pm-unit-cell">
                <span class="pm-unit-badge">${management.escapeHtml(row.__unit || "-")}호기</span>
              </td>
              <td>${displayCellHtml(row.createdDate)}</td>
              <td>${displayCellHtml(row.equipmentName)}</td>
              <td>${displayCellHtml(row.reason)}</td>
              <td>${displayCellHtml(row.targetEquipment)}</td>
              <td>${displayCellHtml(row.progress)}</td>
              <td>${displayCellHtml(row.author)}</td>
              <td>${displayCellHtml(row.controlReply1)}</td>
              <td>${displayCellHtml(row.operationReply1)}</td>
              <td>${displayCellHtml(row.controlReply2)}</td>
              <td>${displayCellHtml(row.remark)}</td>
            </tr>
          `
        ).join("");

      return;
    }

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
    const aggregate =
      isAggregateUnit();

    elements.table.className =
      "planned-maintenance-table is-work" +
      (aggregate ? " is-aggregate" : "");

    elements.table.innerHTML = `
      <colgroup>
        <col class="pm-col-number">
        ${aggregate ? '<col class="pm-col-unit">' : ""}
        <col class="pm-col-category">
        <col class="pm-col-equipment">
        <col class="pm-col-tag">
        <col class="pm-col-reason">
        <col class="pm-col-date">
        <col class="pm-col-progress">
        <col class="pm-col-author">
        <col class="pm-col-remark">
        ${aggregate ? "" : '<col class="pm-col-action">'}
      </colgroup>
      <thead id="plannedMaintenanceTableHead">
        <tr>
          <th>번호</th>
          ${aggregate ? "<th>호기</th>" : ""}
          <th>분류</th>
          <th>설 비 명</th>
          <th>TAG</th>
          <th>사 유</th>
          <th>Issue Date</th>
          <th>진행사항</th>
          <th>작성자</th>
          <th>비 고</th>
          ${aggregate ? "" : "<th data-pm-action-column>삭제</th>"}
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

    if (aggregate) {
      elements.tableBody.innerHTML =
        state.rows.map(
          (row, index) => `
            <tr>
              <td class="pm-number-cell">${index + 1}</td>
              <td class="pm-unit-cell">
                <span class="pm-unit-badge">${management.escapeHtml(row.__unit || "-")}호기</span>
              </td>
              <td>${displayCellHtml(row.category)}</td>
              <td>${displayCellHtml(row.equipmentName)}</td>
              <td>${displayCellHtml(row.tag)}</td>
              <td>${displayCellHtml(row.reason)}</td>
              <td>${displayCellHtml(row.issueDate)}</td>
              <td>${displayCellHtml(row.progress)}</td>
              <td>${displayCellHtml(row.author)}</td>
              <td>${displayCellHtml(row.remark)}</td>
            </tr>
          `
        ).join("");

      return;
    }

    elements.tableBody.innerHTML =
      state.rows.map(
        (row, index) => `
          <tr data-pm-row-id="${management.escapeHtml(row.id)}">
            <td class="pm-number-cell">${index + 1}</td>
            <td>
              <select data-pm-field="category">
                ${WORK_CATEGORIES.map(
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
    if (isAggregateUnit()) {
      const one =
        state.aggregateMeta?.one || {};
      const two =
        state.aggregateMeta?.two || {};

      elements.modifierText.textContent =
        `1호기 v${Number(one.version || 0)} · ` +
        `2호기 v${Number(two.version || 0)}`;

      return;
    }

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

  async function fetchDocumentForUnit(
    unit
  ) {
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
      String(unit)
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
        `${unit}호기 계획정비 기록을 불러오지 못했습니다.`
      );
    }

    return data.item || {};
  }

  async function loadDocument() {
    const token =
      management.getSessionToken();

    if (!token) {
      elements.authWarning.hidden =
        false;

      elements.statusText.textContent =
        "로그인 필요";

      syncActionAvailability();
      return;
    }

    elements.authWarning.hidden =
      true;

    setLoading(true);
    elements.statusText.textContent =
      "불러오는 중";

    try {
      if (isAggregateUnit()) {
        const [one, two] =
          await Promise.all([
            fetchDocumentForUnit("1"),
            fetchDocumentForUnit("2")
          ]);

        const oneRows =
          Array.isArray(one.rows)
            ? one.rows
            : [];

        const twoRows =
          Array.isArray(two.rows)
            ? two.rows
            : [];

        state.aggregateMeta = {
          one: {
            ...one,
            rows: oneRows
          },
          two: {
            ...two,
            rows: twoRows
          }
        };

        state.version = 0;
        state.recordId = "";
        state.rows = [
          ...oneRows.map(
            row => ({
              ...row,
              __unit: "1"
            })
          ),
          ...twoRows.map(
            row => ({
              ...row,
              __unit: "2"
            })
          )
        ];
        state.lastModifiedBy = "";
        state.updatedAt = "";
        state.dirty = false;

        renderTable();
        updateModifierText();
        setDirty(false);

        return;
      }

      const item =
        await fetchDocumentForUnit(
          state.unit
        );

      state.aggregateMeta = null;
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
      state.aggregateMeta = null;
      renderTable();
      setDirty(false);

    } finally {
      setLoading(false);
    }
  }

  async function saveDocument() {
    if (
      state.loading ||
      isAggregateUnit()
    ) {
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
    if (isAggregateUnit()) {
      return;
    }

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
          behavior: "smooth"
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
    state.aggregateMeta = null;
    state.dirty = false;

    syncContextUi();

    await loadDocument();
  }

  function getPreviewColumns() {
    const aggregate =
      isAggregateUnit();

    if (state.view === "work") {
      return [
        ...(aggregate
          ? [{ header: "호기", field: "__unit" }]
          : []),
        { header: "분류", field: "category" },
        { header: "설 비 명", field: "equipmentName" },
        { header: "TAG", field: "tag" },
        { header: "사 유", field: "reason" },
        { header: "Issue Date", field: "issueDate" },
        { header: "진행사항", field: "progress" },
        { header: "작성자", field: "author" },
        { header: "비 고", field: "remark" }
      ];
    }

    return [
      ...(aggregate
        ? [{ header: "호기", field: "__unit" }]
        : []),
      { header: "작성일시", field: "createdDate" },
      { header: "설 비 명", field: "equipmentName" },
      { header: "사 유", field: "reason" },
      { header: "대상 설비", field: "targetEquipment" },
      { header: "진행사항", field: "progress" },
      { header: "작성자", field: "author" },
      { header: "제어 회신 (1차)", field: "controlReply1" },
      { header: "설비운영팀 회신 (1차)", field: "operationReply1" },
      { header: "제어 회신 (2차)", field: "controlReply2" },
      { header: "비 고", field: "remark" }
    ];
  }

  function getDisplayValue(
    row,
    field
  ) {
    if (field === "__unit") {
      return row.__unit
        ? `${row.__unit}호기`
        : "";
    }

    return row[field] || "";
  }

  function buildPreviewHtml() {
    const columns =
      getPreviewColumns();

    const headers = [
      "번호",
      ...columns.map(
        column => column.header
      )
    ];

    const rowsHtml =
      state.rows.map(
        (row, index) => `
          <tr>
            <td class="number">${index + 1}</td>
            ${columns.map(
              column => `
                <td>${management.textToHtml(
                  getDisplayValue(
                    row,
                    column.field
                  )
                )}</td>
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

  function normalizeExcelHeader(
    value
  ) {
    return String(
      value ??
      ""
    )
      .replace(/\r?\n/g, " ")
      .trim()
      .toLowerCase()
      .replace(/[\s._\-\/()[\]{}:]+/g, "");
  }

  function cleanExcelText(
    value
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return "";
    }

    if (value instanceof Date) {
      const year =
        value.getFullYear();
      const month =
        String(
          value.getMonth() + 1
        ).padStart(2, "0");
      const day =
        String(
          value.getDate()
        ).padStart(2, "0");

      return `${year}-${month}-${day}`;
    }

    return String(value)
      .replace(/\r\n/g, "\n")
      .trim();
  }

  function normalizeImportedDate(
    value
  ) {
    const text =
      cleanExcelText(value);

    if (!text) {
      return "";
    }

    const direct =
      text.match(
        /(20\d{2})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/
      );

    if (direct) {
      const year =
        direct[1];
      const month =
        String(
          Number(direct[2])
        ).padStart(2, "0");
      const day =
        String(
          Number(direct[3])
        ).padStart(2, "0");

      return `${year}-${month}-${day}`;
    }

    if (/^\d{5}(?:\.\d+)?$/.test(text)) {
      const serial =
        Number(text);

      const utcMillis =
        Math.round(
          (serial - 25569) *
          86400 *
          1000
        );

      const date =
        new Date(utcMillis);

      if (!Number.isNaN(date.getTime())) {
        return date
          .toISOString()
          .slice(0, 10);
      }
    }

    return "";
  }

  function normalizeImportedCategory(
    value
  ) {
    const text =
      cleanExcelText(value);

    if (!text) {
      return "제어";
    }

    const match =
      WORK_CATEGORIES.find(
        category =>
          text.includes(category)
      );

    return match || "기타";
  }

  function getExcelHeaderDefinitions() {
    if (state.view === "work") {
      return {
        unit: ["호기", "unit", "unitno"],
        category: ["분류", "구분", "category"],
        equipmentName: ["설비명", "설비", "equipmentname"],
        tag: ["tag", "태그"],
        reason: ["사유", "작업사유", "reason"],
        issueDate: ["issuedate", "이슈데이트", "작성일", "날짜"],
        progress: ["진행사항", "진행상황", "조치사항", "progress"],
        author: ["작성자", "담당자", "author"],
        remark: ["비고", "remark", "remarks"]
      };
    }

    return {
      unit: ["호기", "unit", "unitno"],
      createdDate: ["작성일시", "작성일", "등록일", "date"],
      equipmentName: ["설비명", "설비", "equipmentname"],
      reason: ["사유", "작업사유", "reason"],
      targetEquipment: ["대상설비", "대상", "targetequipment"],
      progress: ["진행사항", "진행상황", "조치사항", "progress"],
      author: ["작성자", "담당자", "author"],
      controlReply1: ["제어회신1차", "제어1차회신", "controlreply1"],
      operationReply1: ["설비운영팀회신1차", "설비운영회신1차", "operationreply1"],
      controlReply2: ["제어회신2차", "제어2차회신", "controlreply2"],
      remark: ["비고", "remark", "remarks"]
    };
  }

  function findExcelHeaderLocation(
    workbook
  ) {
    const definitions =
      getExcelHeaderDefinitions();

    const normalizedDefinitions =
      Object.fromEntries(
        Object.entries(definitions)
          .map(
            ([field, names]) => [
              field,
              names.map(
                normalizeExcelHeader
              )
            ]
          )
      );

    let best = null;

    workbook.SheetNames.forEach(
      sheetName => {
        const worksheet =
          workbook.Sheets[sheetName];

        const matrix =
          window.XLSX.utils.sheet_to_json(
            worksheet,
            {
              header: 1,
              raw: false,
              defval: "",
              blankrows: false
            }
          );

        matrix
          .slice(0, 80)
          .forEach(
            (row, rowIndex) => {
              const fieldIndexes = {};

              row
                .slice(0, 40)
                .forEach(
                  (cell, columnIndex) => {
                    const header =
                      normalizeExcelHeader(
                        cell
                      );

                    if (!header) {
                      return;
                    }

                    Object.entries(
                      normalizedDefinitions
                    ).forEach(
                      ([field, names]) => {
                        if (
                          fieldIndexes[field] ===
                            undefined &&
                          names.includes(header)
                        ) {
                          fieldIndexes[field] =
                            columnIndex;
                        }
                      }
                    );
                  }
                );

              const score =
                Object.keys(
                  fieldIndexes
                ).filter(
                  field => field !== "unit"
                ).length;

              if (
                !best ||
                score > best.score
              ) {
                best = {
                  sheetName,
                  matrix,
                  rowIndex,
                  fieldIndexes,
                  score
                };
              }
            }
          );
      }
    );

    const minimumScore =
      state.view === "work"
        ? 5
        : 6;

    if (
      !best ||
      best.score < minimumScore
    ) {
      throw new Error(
        state.view === "work"
          ? "Excel에서 작업필요사항 표 머리글(분류·설비명·TAG·사유·Issue Date 등)을 찾지 못했습니다."
          : "Excel에서 Logic 개선 표 머리글(작성일시·설비명·사유·진행사항·회신 등)을 찾지 못했습니다."
      );
    }

    return best;
  }

  function rowMatchesSelectedUnit(
    row,
    unitIndex
  ) {
    if (
      unitIndex === undefined ||
      unitIndex === null
    ) {
      return true;
    }

    const unitText =
      normalizeExcelHeader(
        row[unitIndex]
      );

    if (!unitText) {
      return true;
    }

    if (state.unit === "1") {
      return (
        unitText === "1" ||
        unitText === "1호기" ||
        unitText === "#1" ||
        unitText === "unit1"
      );
    }

    return (
      unitText === "2" ||
      unitText === "2호기" ||
      unitText === "#2" ||
      unitText === "unit2"
    );
  }

  function parseExcelRows(
    location
  ) {
    const {
      matrix,
      rowIndex,
      fieldIndexes
    } = location;

    const imported = [];

    const readField =
      (row, field) => {
        const index =
          fieldIndexes[field];

        if (
          index === undefined ||
          index === null
        ) {
          return "";
        }

        return cleanExcelText(
          row[index]
        );
      };

    for (
      let index = rowIndex + 1;
      index < matrix.length;
      index += 1
    ) {
      const row =
        matrix[index] || [];

      if (
        !rowMatchesSelectedUnit(
          row,
          fieldIndexes.unit
        )
      ) {
        continue;
      }

      const rawValues =
        Object.keys(fieldIndexes)
          .filter(
            field => field !== "unit"
          )
          .map(
            field =>
              readField(row, field)
          );

      if (
        rawValues.every(
          value => !value
        )
      ) {
        continue;
      }

      if (state.view === "work") {
        const equipmentName =
          readField(
            row,
            "equipmentName"
          );
        const tag =
          readField(
            row,
            "tag"
          );
        const reason =
          readField(
            row,
            "reason"
          );
        const progress =
          readField(
            row,
            "progress"
          );
        const remark =
          readField(
            row,
            "remark"
          );

        const hasCoreContent =
          Boolean(
            equipmentName ||
            tag ||
            reason ||
            progress ||
            remark
          );

        if (!hasCoreContent) {
          continue;
        }

        imported.push({
          id:
            management.createId(
              "pm-work"
            ),
          category:
            normalizeImportedCategory(
              readField(
                row,
                "category"
              )
            ),
          equipmentName,
          tag,
          reason,
          issueDate:
            normalizeImportedDate(
              readField(
                row,
                "issueDate"
              )
            ) ||
            management.todayDate(),
          progress,
          author:
            readField(
              row,
              "author"
            ) ||
            management.getUserName(),
          remark
        });

      } else {
        const equipmentName =
          readField(
            row,
            "equipmentName"
          );
        const reason =
          readField(
            row,
            "reason"
          );
        const targetEquipment =
          readField(
            row,
            "targetEquipment"
          );
        const progress =
          readField(
            row,
            "progress"
          );
        const controlReply1 =
          readField(
            row,
            "controlReply1"
          );
        const operationReply1 =
          readField(
            row,
            "operationReply1"
          );
        const controlReply2 =
          readField(
            row,
            "controlReply2"
          );
        const remark =
          readField(
            row,
            "remark"
          );

        const hasCoreContent =
          Boolean(
            equipmentName ||
            reason ||
            targetEquipment ||
            progress ||
            controlReply1 ||
            operationReply1 ||
            controlReply2 ||
            remark
          );

        if (!hasCoreContent) {
          continue;
        }

        imported.push({
          id:
            management.createId(
              "pm-logic"
            ),
          createdDate:
            normalizeImportedDate(
              readField(
                row,
                "createdDate"
              )
            ) ||
            management.todayDate(),
          equipmentName,
          reason,
          targetEquipment,
          progress,
          author:
            readField(
              row,
              "author"
            ) ||
            management.getUserName(),
          controlReply1,
          operationReply1,
          controlReply2,
          remark
        });
      }

      if (imported.length >= 1000) {
        break;
      }
    }

    if (imported.length < 1) {
      throw new Error(
        `${state.unit}호기에 입력할 계획정비 항목을 Excel에서 찾지 못했습니다.`
      );
    }

    return imported;
  }

  function hasCurrentBusinessData() {
    if (
      state.version > 0 ||
      state.dirty ||
      state.rows.length > 1
    ) {
      return true;
    }

    return state.rows.some(
      row => {
        if (state.view === "work") {
          return Boolean(
            String(row.equipmentName || "").trim() ||
            String(row.tag || "").trim() ||
            String(row.reason || "").trim() ||
            String(row.progress || "").trim() ||
            String(row.remark || "").trim()
          );
        }

        return Boolean(
          String(row.equipmentName || "").trim() ||
          String(row.reason || "").trim() ||
          String(row.targetEquipment || "").trim() ||
          String(row.progress || "").trim() ||
          String(row.controlReply1 || "").trim() ||
          String(row.operationReply1 || "").trim() ||
          String(row.controlReply2 || "").trim() ||
          String(row.remark || "").trim()
        );
      }
    );
  }

  async function importExcelFile(
    file
  ) {
    if (
      isAggregateUnit() ||
      !file
    ) {
      return;
    }

    if (
      typeof window.XLSX ===
      "undefined"
    ) {
      management.showToast(
        "Excel 분석 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.",
        "error"
      );
      return;
    }

    try {
      setLoading(true);
      elements.statusText.textContent =
        "Excel 불러오는 중";

      const arrayBuffer =
        await file.arrayBuffer();

      const workbook =
        window.XLSX.read(
          arrayBuffer,
          {
            type: "array",
            cellDates: true,
            cellText: true
          }
        );

      const location =
        findExcelHeaderLocation(
          workbook
        );

      const importedRows =
        parseExcelRows(
          location
        );

      if (
        hasCurrentBusinessData() &&
        !window.confirm(
          `현재 ${state.unit}호기 ${getViewLabel()} 내용을 ` +
          `Excel ${importedRows.length}개 항목으로 교체할까요?\n\n` +
          "업로드 후에는 반드시 저장 버튼을 눌러야 서버에 반영됩니다."
        )
      ) {
        setDirty(state.dirty);
        return;
      }

      state.rows =
        importedRows;

      renderTable();
      setDirty(true);

      management.showToast(
        `${file.name}에서 ${importedRows.length}개 항목을 불러왔습니다. 내용 확인 후 저장해 주세요.`,
        "success"
      );

    } catch (error) {
      console.error(
        "계획정비 Excel 업로드 오류:",
        error
      );

      setDirty(state.dirty);

      management.showToast(
        error instanceof Error
          ? error.message
          : "Excel 파일을 불러오지 못했습니다.",
        "error"
      );

    } finally {
      if (elements.excelFileInput) {
        elements.excelFileInput.value =
          "";
      }

      setLoading(false);
    }
  }

  function getExcelExportColumns() {
    const aggregate =
      isAggregateUnit();

    if (state.view === "work") {
      return [
        { header: "번호", field: "__number", width: 8, align: "center" },
        ...(aggregate
          ? [{ header: "호기", field: "__unit", width: 10, align: "center" }]
          : []),
        { header: "분류", field: "category", width: 12, align: "center" },
        { header: "설 비 명", field: "equipmentName", width: 22 },
        { header: "TAG", field: "tag", width: 20, align: "center" },
        { header: "사 유", field: "reason", width: 46 },
        { header: "Issue Date", field: "issueDate", width: 15, align: "center" },
        { header: "진행사항", field: "progress", width: 24 },
        { header: "작성자", field: "author", width: 13, align: "center" },
        { header: "비 고", field: "remark", width: 25 }
      ];
    }

    return [
      { header: "번호", field: "__number", width: 8, align: "center" },
      ...(aggregate
        ? [{ header: "호기", field: "__unit", width: 10, align: "center" }]
        : []),
      { header: "작성일시", field: "createdDate", width: 15, align: "center" },
      { header: "설 비 명", field: "equipmentName", width: 22 },
      { header: "사 유", field: "reason", width: 42 },
      { header: "대상 설비", field: "targetEquipment", width: 22 },
      { header: "진행사항", field: "progress", width: 24 },
      { header: "작성자", field: "author", width: 13, align: "center" },
      { header: "제어 회신 (1차)", field: "controlReply1", width: 24 },
      { header: "설비운영팀 회신 (1차)", field: "operationReply1", width: 26 },
      { header: "제어 회신 (2차)", field: "controlReply2", width: 24 },
      { header: "비 고", field: "remark", width: 24 }
    ];
  }

  function getExcelFileName() {
    const unitText =
      isAggregateUnit()
        ? "1-2호기_종합"
        : `${state.unit}호기`;

    const viewText =
      state.view === "work"
        ? "작업필요사항"
        : "Logic개선";

    return (
      `${state.year}년_${unitText}_계획정비_${viewText}.xlsx`
    );
  }

  async function downloadExcel() {
    if (
      typeof window.ExcelJS ===
      "undefined"
    ) {
      management.showToast(
        "Excel 생성 모듈을 불러오지 못했습니다. 페이지를 새로고침해 주세요.",
        "error"
      );
      return;
    }

    try {
      setLoading(true);
      elements.statusText.textContent =
        "Excel 생성 중";

      const workbook =
        new window.ExcelJS.Workbook();

      workbook.creator =
        "GS Shift Log";
      workbook.lastModifiedBy =
        management.getUserName() ||
        "GS Shift Log";
      workbook.created =
        new Date();
      workbook.modified =
        new Date();

      const sheetName =
        isAggregateUnit()
          ? "종합"
          : `${state.unit}호기`;

      const worksheet =
        workbook.addWorksheet(
          sheetName,
          {
            views: [
              {
                state: "frozen",
                ySplit: 4
              }
            ],
            pageSetup: {
              paperSize: 9,
              orientation: "landscape",
              fitToPage: true,
              fitToWidth: 1,
              fitToHeight: 0,
              margins: {
                left: 0.3,
                right: 0.3,
                top: 0.4,
                bottom: 0.4,
                header: 0.2,
                footer: 0.2
              }
            }
          }
        );

      const columns =
        getExcelExportColumns();

      columns.forEach(
        (column, index) => {
          worksheet.getColumn(
            index + 1
          ).width =
            column.width;
        }
      );

      const lastColumn =
        columns.length;

      worksheet.mergeCells(
        1,
        1,
        1,
        lastColumn
      );

      const titleCell =
        worksheet.getCell(1, 1);

      titleCell.value =
        getDocumentTitle();
      titleCell.font = {
        name: "맑은 고딕",
        size: 16,
        bold: true,
        underline: true
      };
      titleCell.alignment = {
        horizontal: "center",
        vertical: "middle"
      };
      worksheet.getRow(1).height =
        30;

      worksheet.getCell(2, 1).value =
        "설비운영팀";
      worksheet.getCell(2, 1).font = {
        name: "맑은 고딕",
        size: 10,
        bold: true
      };

      if (state.view === "work") {
        const legendCell =
          worksheet.getCell(
            2,
            Math.max(
              2,
              lastColumn - 1
            )
          );

        legendCell.value =
          "정지 중 필수 작업 사항(효율,안전)";
        legendCell.font = {
          name: "맑은 고딕",
          size: 9,
          bold: true
        };
        legendCell.alignment = {
          horizontal: "right"
        };

        const markerCell =
          worksheet.getCell(
            2,
            lastColumn
          );

        markerCell.value = " ";
        markerCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: {
            argb: "FFFFC31A"
          }
        };
      }

      const headerRow =
        worksheet.getRow(4);

      columns.forEach(
        (column, index) => {
          const cell =
            headerRow.getCell(
              index + 1
            );

          cell.value =
            column.header;
          cell.font = {
            name: "맑은 고딕",
            size: 10,
            bold: true,
            color: {
              argb: "FF203247"
            }
          };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: {
              argb: "FF9FC5E6"
            }
          };
          cell.alignment = {
            horizontal: "center",
            vertical: "middle",
            wrapText: true
          };
          cell.border = {
            top: { style: "thin", color: { argb: "FF1F2933" } },
            left: { style: "thin", color: { argb: "FF1F2933" } },
            bottom: { style: "thin", color: { argb: "FF1F2933" } },
            right: { style: "thin", color: { argb: "FF1F2933" } }
          };
        }
      );

      headerRow.height = 25;

      state.rows.forEach(
        (item, rowIndex) => {
          const excelRow =
            worksheet.getRow(
              rowIndex + 5
            );

          columns.forEach(
            (column, columnIndex) => {
              let value = "";

              if (column.field === "__number") {
                value = rowIndex + 1;
              } else if (column.field === "__unit") {
                value = item.__unit
                  ? `${item.__unit}호기`
                  : "";
              } else {
                value =
                  item[column.field] ??
                  "";
              }

              const cell =
                excelRow.getCell(
                  columnIndex + 1
                );

              cell.value =
                value;
              cell.font = {
                name: "맑은 고딕",
                size: 9
              };
              cell.alignment = {
                horizontal:
                  column.align ||
                  "left",
                vertical: "middle",
                wrapText: true
              };
              cell.border = {
                top: { style: "thin", color: { argb: "FF1F2933" } },
                left: { style: "thin", color: { argb: "FF1F2933" } },
                bottom: { style: "thin", color: { argb: "FF1F2933" } },
                right: { style: "thin", color: { argb: "FF1F2933" } }
              };
            }
          );

          excelRow.height =
            38;
        }
      );

      worksheet.pageSetup.printTitlesRow =
        "4:4";

      const buffer =
        await workbook.xlsx.writeBuffer();

      const blob =
        new Blob(
          [buffer],
          {
            type:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      const anchor =
        document.createElement(
          "a"
        );

      anchor.href = url;
      anchor.download =
        getExcelFileName();

      document.body.append(
        anchor
      );

      anchor.click();
      anchor.remove();

      window.setTimeout(
        () => {
          URL.revokeObjectURL(
            url
          );
        },
        1000
      );

      management.showToast(
        "현재 화면 내용을 Excel 파일로 만들었습니다.",
        "success"
      );

      setDirty(state.dirty);

    } catch (error) {
      console.error(
        "계획정비 Excel 다운로드 오류:",
        error
      );

      management.showToast(
        error instanceof Error
          ? error.message
          : "Excel 파일을 만들지 못했습니다.",
        "error"
      );

      setDirty(state.dirty);

    } finally {
      setLoading(false);
    }
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

  elements.excelUploadButton.addEventListener(
    "click",
    () => {
      if (isAggregateUnit()) {
        management.showToast(
          "엑셀 업로드는 1호기 또는 2호기 탭에서 진행해 주세요.",
          "error"
        );
        return;
      }

      elements.excelFileInput.click();
    }
  );

  elements.excelFileInput.addEventListener(
    "change",
    () => {
      const file =
        elements.excelFileInput.files?.[0];

      if (file) {
        importExcelFile(file);
      }
    }
  );

  elements.excelDownloadButton.addEventListener(
    "click",
    downloadExcel
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
