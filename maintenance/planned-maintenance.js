"use strict";

/* [PLANNED-MAINTENANCE-SHEET-TABS-V2] */

(function initializePlannedMaintenancePage() {
  const API_URL = "/api/planned-maintenance";
  const STORAGE_UNIT = "1";
  const TEMPLATE_VERSION = "20260823-maintenance-sheet-tabs-v2";
  const management = window.GSManagement;

  if (!management) {
    throw new Error("관리 공통 모듈을 불러오지 못했습니다.");
  }

  const params = new URLSearchParams(window.location.search);
  const initialView = params.get("view") === "work" ? "work" : "logic";


/* [PLANNED-MAINTENANCE-WORK-CATEGORY-OPTIONS-V2]
   작업필요사항 분류:
   기계 / 전기 / 제어 / 기타
   화면 필터:
   통합 / 기계 / 전기 / 제어 / 기타
*/  const WORK_CATEGORIES = [
    "기계",
    "전기",
    "제어",
    "기타"
  ];

  const SHEETS = {
    logic: [
      {
        key: "logic-blr",
        name: "BLR",
        theme: "logic-blr",
        tabColor: "FFFFC000",
        excelTitle: year =>
          `${year}년 Boiler 정지 중 Logic 수정 및 보완 요청 List`,
        columns: [
          column("작성일시", "createdDate", 110, "date", ["작성일시", "작성 일시", "작성일"]),
          column("설 비 명", "equipmentName", 180, "textarea", ["설비명", "설 비 명"]),
          column("사 유", "reason", 340, "textarea", ["사유", "사 유"]),
          column("대상 설비", "targetEquipment", 165, "textarea", ["대상설비", "대상 설비"]),
          column("진행사항", "progress", 175, "textarea", ["진행사항", "진행 사항"]),
          column("작성자", "author", 95, "text", ["작성자"]),
          column("제어 회신 (1차)", "controlReply1", 190, "textarea", ["제어회신1차", "제어 회신 (1차)", "제어 회신(1차)"]),
          column("설비운영팀 회신 (1차)", "operationReply1", 205, "textarea", ["설비운영팀회신1차", "설비운영팀 회신 (1차)", "설비운영팀 회신(1차)"]),
          column("제어 회신 (2차)", "controlReply2", 190, "textarea", ["제어회신2차", "제어 회신 (2차)", "제어 회신(2차)"]),
          column("비 고", "remark", 185, "textarea", ["비고", "비 고"])
        ],
        importSignals: [
          "equipmentName",
          "reason",
          "targetEquipment",
          "progress",
          "controlReply1",
          "operationReply1",
          "controlReply2",
          "remark"
        ]
      },
      {
        key: "logic-tbn-bop",
        name: "TBN & BOP",
        theme: "logic-tbn-bop",
        tabColor: "FFFF0000",
        excelTitle: year =>
          `${year}년 TBN & BOP 정지 중 Logic 수정 및 보완 요청 List`,
        columns: [
          column("작성일시", "createdDate", 110, "date", ["작성일시", "작성 일시", "작성일"]),
          column("설 비 명", "equipmentName", 190, "textarea", ["설비명", "설 비 명"]),
          column("사 유", "reason", 380, "textarea", ["사유", "사 유"]),
          column("진행사항", "progress", 180, "textarea", ["진행사항", "진행 사항"]),
          column("작성자", "author", 95, "text", ["작성자"]),
          column("제어 회신 (1차)", "controlReply1", 190, "textarea", ["제어회신1차", "제어 회신 (1차)", "제어 회신(1차)"]),
          column("설비운영팀 회신 (1차)", "operationReply1", 205, "textarea", ["설비운영팀회신1차", "설비운영팀 회신 (1차)", "설비운영팀 회신(1차)"]),
          column("제어 회신 (2차)", "controlReply2", 190, "textarea", ["제어회신2차", "제어 회신 (2차)", "제어 회신(2차)"]),
          column("비 고", "remark", 185, "textarea", ["비고", "비 고"])
        ],
        importSignals: [
          "equipmentName",
          "reason",
          "progress",
          "controlReply1",
          "operationReply1",
          "controlReply2",
          "remark"
        ]
      },
      {
        key: "logic-aux-blr",
        name: "Aux. BLR",
        theme: "logic-aux-blr",
        tabColor: "FF70AD47",
        excelTitle: year =>
          `${year}년 Aux. BLR Logic 수정 및 보완 요청 List`,
        columns: [
          column("작성일시", "createdDate", 110, "date", ["작성일시", "작성 일시", "작성일"]),
          column("설 비 명", "equipmentName", 190, "textarea", ["설비명", "설 비 명"]),
          column("사 유", "reason", 390, "textarea", ["사유", "사 유"]),
          column("진행사항", "progress", 180, "textarea", ["진행사항", "진행 사항"]),
          column("작성자", "author", 95, "text", ["작성자"]),
          column("제어회신", "controlReply", 200, "textarea", ["제어회신", "제어 회신"]),
          column("확인및작업", "confirmWork", 165, "textarea", ["확인및작업", "확인 및 작업"]),
          column("작업내용", "workContent", 205, "textarea", ["작업내용", "작업 내용"]),
          column("비 고", "remark", 185, "textarea", ["비고", "비 고"])
        ],
        importSignals: [
          "equipmentName",
          "reason",
          "progress",
          "controlReply",
          "confirmWork",
          "workContent",
          "remark"
        ]
      },
      {
        key: "logic-dcs",
        name: "DCS",
        theme: "logic-dcs",
        tabColor: "FFFFFF00",
        excelTitle: year =>
          `${year}년 Boiler 정지 중 Graphic & Description 수정 List`,
        columns: [
          column("작성일시", "createdDate", 110, "date", ["작성일시", "작성 일시", "작성일"]),
          column("설 비 명", "equipmentName", 175, "textarea", ["설비명", "설 비 명"]),
          column("사 유", "reason", 330, "textarea", ["사유", "사 유"]),
          column("대상 설비", "targetEquipment", 165, "textarea", ["대상설비", "대상 설비"]),
          column("Tag", "tag", 150, "text", ["tag", "태그", "TAG"]),
          column("작성자", "author", 95, "text", ["작성자"]),
          column("1 Part", "part1", 150, "textarea", ["1part", "1 part", "1파트"]),
          column("2 Part", "part2", 150, "textarea", ["2part", "2 part", "2파트"]),
          column("3 Part", "part3", 150, "textarea", ["3part", "3 part", "3파트"]),
          column("4 Part", "part4", 150, "textarea", ["4part", "4 part", "4파트"])
        ],
        importSignals: [
          "equipmentName",
          "reason",
          "targetEquipment",
          "tag",
          "part1",
          "part2",
          "part3",
          "part4"
        ]
      },
      {
        key: "logic-realtime",
        name: "실시간 발전 운영 현황",
        theme: "logic-realtime",
        tabColor: "FFFFC000",
        excelTitle: year =>
          `${year}년 실시간 발전 운영 현황 수정 List`,
        columns: [
          column("작성일시", "createdDate", 110, "date", ["작성일시", "작성 일시", "작성일"]),
          column("설 비 명", "equipmentName", 175, "textarea", ["설비명", "설 비 명"]),
          column("사 유", "reason", 330, "textarea", ["사유", "사 유"]),
          column("대상 설비", "targetEquipment", 165, "textarea", ["대상설비", "대상 설비"]),
          column("Tag", "tag", 150, "text", ["tag", "태그", "TAG"]),
          column("작성자", "author", 95, "text", ["작성자"]),
          column("1 Part", "part1", 150, "textarea", ["1part", "1 part", "1파트"]),
          column("2 Part", "part2", 150, "textarea", ["2part", "2 part", "2파트"]),
          column("3 Part", "part3", 150, "textarea", ["3part", "3 part", "3파트"]),
          column("4 Part", "part4", 150, "textarea", ["4part", "4 part", "4파트"])
        ],
        importSignals: [
          "equipmentName",
          "reason",
          "targetEquipment",
          "tag",
          "part1",
          "part2",
          "part3",
          "part4"
        ]
      }
    ],
    work: [
      workSheet("work-tbn-bop", "TBN,BOP", "work-tbn-bop", "FF70AD47", year =>
        `${year}년 TBN & BOP 정지 작업 요청사항`),
      workSheet("work-blr1", "#1 BLR", "work-blr1", "FF7030A0", year =>
        `${year}년 #1 BLR 정지 작업 요청사항`),
      workSheet("work-blr2", "#2 BLR", "work-blr2", "FF1F4E78", year =>
        `${year}년 #2 Boiler 정지 작업 요청사항`),
      workSheet("work-aux-blr", "Aux. BLR", "work-aux-blr", "FF7030A0", year =>
        `${year}년 Aux. BLR 정지 작업 요청사항`),
      workSheet("work-shutdown", "정지 중 자체작업 사항", "work-shutdown", "FF1F4E78", year =>
        `${year}년 정지 중 자체 작업 사항(설비운영팀)`, "인력")
    ]
  };

  function column(header, field, width, type, aliases) {
    return {
      header,
      field,
      width,
      type,
      aliases: aliases || [header]
    };
  }

  function workSheet(key, name, theme, tabColor, excelTitle, defaultCategory = "제어") {
    return {
      key,
      name,
      theme,
      tabColor,
      excelTitle,
      defaultCategory,
      columns: [
        column("분류", "category", 100, "select", ["분류"]),
        column("설 비 명", "equipmentName", 220, "textarea", ["설비명", "설 비 명"]),
        column("사 유", "reason", 465, "textarea", ["사유", "사 유"]),
        column("Issue Date", "issueDate", 120, "date", ["Issue Date", "issuedate", "issue date", "이슈일자"]),
        column("진행사항", "progress", 185, "textarea", ["진행사항", "진행 사항"]),
        column("작성자", "author", 100, "text", ["작성자"]),
        column("비 고", "remark", 230, "textarea", ["비고", "비 고"])
      ],
      importSignals: [
        "equipmentName",
        "reason",
        "issueDate",
        "progress",
        "remark"
      ]
    };
  }

  const state = {
    year: 2027,
    view: initialView,
    sheetKey: "",
    version: 0,
    recordId: "",
    rows: [],
    dirty: false,
    loading: false,
    lastModifiedBy: "",
    updatedAt: "",
    legacyRowsDetected: false
  };

  const elements = {
    authWarning: document.getElementById("plannedMaintenanceAuthWarning"),
    title: document.getElementById("plannedMaintenancePageTitle"),
    yearSelect: document.getElementById("plannedMaintenanceYearSelect"),
    addRowButton: document.getElementById("plannedMaintenanceAddRowButton"),
    reloadButton: document.getElementById("plannedMaintenanceReloadButton"),
    previewButton: document.getElementById("plannedMaintenancePreviewButton"),
    saveButton: document.getElementById("plannedMaintenanceSaveButton"),
    homeButton: document.getElementById("plannedMaintenanceHomeButton"),
    excelUploadButton: document.getElementById("plannedMaintenanceExcelUploadButton"),
    excelDownloadButton: document.getElementById("plannedMaintenanceExcelDownloadButton"),
    excelFileInput: document.getElementById("plannedMaintenanceExcelFileInput"),
    sheetTabs: document.getElementById("plannedMaintenanceSheetTabs"),
    statusDot: document.getElementById("plannedMaintenanceStatusDot"),
    contextLabel: document.getElementById("plannedMaintenanceContextLabel"),
    statusText: document.getElementById("plannedMaintenanceStatusText"),
    modifierText: document.getElementById("plannedMaintenanceModifierText"),
    table: document.getElementById("plannedMaintenanceTable"),
    tableHead: document.getElementById("plannedMaintenanceTableHead"),
    tableBody: document.getElementById("plannedMaintenanceTableBody")
  };

  function getViewLabel(view = state.view) {
    return view === "work" ? "작업필요사항" : "Logic 개선";
  }

  function getSheetConfigs(view = state.view) {
    return SHEETS[view] || SHEETS.logic;
  }

  function getSheetConfigByKey(key, view = state.view) {
    return getSheetConfigs(view).find(item => item.key === key) || null;
  }

  function getActiveSheetConfig() {
    return getSheetConfigByKey(state.sheetKey) || getSheetConfigs()[0];
  }

  function ensureSheetKey() {
    const configs = getSheetConfigs();
    const requested = state.sheetKey || params.get("sheet") || "";
    state.sheetKey = configs.some(item => item.key === requested)
      ? requested
      : configs[0].key;
  }

  function getDocumentTitle() {
    return getActiveSheetConfig().excelTitle(state.year);
  }

  function normalizeString(value) {
    return String(value ?? "").trim();
  }

  function normalizeToken(value) {
    return normalizeString(value)
      .toLowerCase()
      .replace(/[\s._,&()\-\/\\]+/g, "")
      .replace(/[^0-9a-z가-힣#]/gi, "");
  }

  function dateToIso(year, month, day) {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);

    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      return "";
    }

    const date = new Date(y, m - 1, d);
    if (
      date.getFullYear() !== y ||
      date.getMonth() !== m - 1 ||
      date.getDate() !== d
    ) {
      return "";
    }

    return [
      String(y).padStart(4, "0"),
      String(m).padStart(2, "0"),
      String(d).padStart(2, "0")
    ].join("-");
  }

  function valueToIsoDate(value) {
    if (!value) {
      return "";
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return dateToIso(
        value.getFullYear(),
        value.getMonth() + 1,
        value.getDate()
      );
    }

    if (typeof value === "number" && window.XLSX?.SSF?.parse_date_code) {
      const parsed = window.XLSX.SSF.parse_date_code(value);
      if (parsed) {
        return dateToIso(parsed.y, parsed.m, parsed.d);
      }
    }

    const text = normalizeString(value);
    if (!text) {
      return "";
    }

    let match = text.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
    if (match) {
      return dateToIso(match[1], match[2], match[3]);
    }

    match = text.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
    if (match) {
      return dateToIso(2000 + Number(match[1]), match[2], match[3]);
    }

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return dateToIso(
        parsed.getFullYear(),
        parsed.getMonth() + 1,
        parsed.getDate()
      );
    }

    return "";
  }

  function isoToExcelDate(value) {
    const text = normalizeString(value);
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) {
      return text;
    }

    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  }

  function rowIdPrefix(config) {
    return `pmv2-${config.key}`;
  }

  function createRowId(config) {
    return management.createId(rowIdPrefix(config));
  }

  function resolveRowSheetKey(row, view = state.view) {
    const configs = getSheetConfigs(view);
    const explicit = normalizeString(row?.sheetKey || row?.__sheetKey);

    if (configs.some(item => item.key === explicit)) {
      return explicit;
    }

    const id = normalizeString(row?.id);
    const byId = configs.find(config => id.startsWith(rowIdPrefix(config)));
    if (byId) {
      return byId.key;
    }

    return configs[0].key;
  }

  function normalizeStoredRows(rows) {
    const source = Array.isArray(rows) ? rows : [];
    let legacy = false;

    const normalized = source.map(row => {
      const explicit = normalizeString(row?.sheetKey || row?.__sheetKey);
      if (!explicit) {
        const id = normalizeString(row?.id);
        const hasV2Id = getSheetConfigs().some(config =>
          id.startsWith(rowIdPrefix(config))
        );
        if (!hasV2Id) {
          legacy = true;
        }
      }

      const sheetKey = resolveRowSheetKey(row);
      const config = getSheetConfigByKey(sheetKey) || getSheetConfigs()[0];

      return {
        ...row,
        id: normalizeString(row?.id) || createRowId(config),
        sheetKey,
        __placeholder: false
      };
    });

    state.legacyRowsDetected = legacy;
    return normalized;
  }

  function createBlankRow(config, placeholder = true) {
    const row = {
      id: createRowId(config),
      sheetKey: config.key,
      __placeholder: placeholder
    };

    config.columns.forEach(col => {
      if (col.field === "category") {
        row[col.field] = config.defaultCategory || "제어";
      } else if (col.field === "createdDate" || col.field === "issueDate") {
        row[col.field] = management.todayDate();
      } else if (col.field === "author") {
        row[col.field] = management.getUserName();
      } else {
        row[col.field] = "";
      }
    });

    return row;
  }

  function getRowsForSheet(sheetKey = state.sheetKey) {
    return state.rows.filter(row => resolveRowSheetKey(row) === sheetKey);
  }

  function getPersistableRows() {
    return state.rows
      .filter(row => !row.__placeholder)
      .map(row => {
        const clean = { ...row };
        delete clean.__placeholder;
        delete clean.__sheetKey;
        delete clean.__unit;
        clean.sheetKey = resolveRowSheetKey(row);
        return clean;
      });
  }

  function ensureVisibleRow() {
    if (getRowsForSheet().length > 0) {
      return;
    }

    state.rows.push(createBlankRow(getActiveSheetConfig(), true));
  }

  function syncSheetTabs() {
    const configs = getSheetConfigs();

    elements.sheetTabs.innerHTML = configs.map(config => `
      <button
        type="button"
        class="pm-sheet-tab ${config.key === state.sheetKey ? "is-active" : ""}"
        data-planned-maintenance-sheet="${management.escapeHtml(config.key)}"
        data-pm-sheet-theme="${management.escapeHtml(config.theme)}"
        role="tab"
        aria-selected="${config.key === state.sheetKey ? "true" : "false"}"
      >${management.escapeHtml(config.name)}</button>
    `).join("");
  }

  function syncContextUi() {
    ensureSheetKey();

    document
      .querySelectorAll("[data-planned-maintenance-view]")
      .forEach(button => {
        button.classList.toggle(
          "is-active",
          button.dataset.plannedMaintenanceView === state.view
        );
      });

    syncSheetTabs();

    elements.yearSelect.value = String(state.year);
    elements.title.textContent = getViewLabel();
    elements.contextLabel.textContent =
      `${state.year}년 · ${getViewLabel()} · ${getActiveSheetConfig().name}`;

    const url = new URL(window.location.href);
    url.searchParams.set("view", state.view);
    url.searchParams.set("sheet", state.sheetKey);
    history.replaceState(null, "", url);

    syncActionAvailability();
  }

  function syncActionAvailability() {
    const authenticated = Boolean(management.getSessionToken());

    elements.saveButton.disabled = state.loading || !authenticated;
    elements.addRowButton.disabled = state.loading || !authenticated;
    elements.excelUploadButton.disabled = state.loading || !authenticated;
    elements.excelDownloadButton.disabled = state.loading;
    elements.previewButton.disabled = state.loading;
    elements.reloadButton.disabled = state.loading;
    elements.yearSelect.disabled = state.loading;

    document
      .querySelectorAll("[data-planned-maintenance-view], [data-planned-maintenance-sheet]")
      .forEach(button => {
        button.disabled = state.loading;
      });
  }

  function setLoading(loading) {
    state.loading = Boolean(loading);
    syncActionAvailability();
  }

  function setDirty(dirty) {
    state.dirty = Boolean(dirty);

    elements.statusDot.classList.toggle("is-dirty", state.dirty);
    elements.statusDot.classList.toggle(
      "is-saved",
      !state.dirty && state.version > 0
    );

    if (state.dirty) {
      elements.statusText.textContent = "저장되지 않은 변경사항 있음";
    } else if (state.version > 0) {
      elements.statusText.textContent = `저장됨 · v${state.version}`;
    } else {
      elements.statusText.textContent = "아직 저장된 기록 없음";
    }
  }

  function updateModifierText() {
    if (!state.updatedAt) {
      elements.modifierText.textContent = state.legacyRowsDetected
        ? "기존 호기형 데이터 감지"
        : "";
      return;
    }

    const date = new Date(state.updatedAt);
    const dateText = Number.isNaN(date.getTime())
      ? state.updatedAt
      : date.toLocaleString("ko-KR");

    const prefix = state.lastModifiedBy
      ? `최종 수정 ${state.lastModifiedBy} · ${dateText}`
      : `최종 수정 ${dateText}`;

    elements.modifierText.textContent = state.legacyRowsDetected
      ? `${prefix} · 기존 호기형 데이터 감지`
      : prefix;
  }

  function inputHtml(row, col) {
    const value = normalizeString(row[col.field]);

    if (col.type === "select") {
      const values = WORK_CATEGORIES.includes(value)
        ? WORK_CATEGORIES
        : [value, ...WORK_CATEGORIES].filter(Boolean);

      return `
        <select data-pm-field="${management.escapeHtml(col.field)}">
          ${values.map(option => `
            <option
              value="${management.escapeHtml(option)}"
              ${option === value ? "selected" : ""}
            >${management.escapeHtml(option)}</option>
          `).join("")}
        </select>
      `;
    }

    if (col.type === "textarea") {
      return `
        <textarea
          data-pm-field="${management.escapeHtml(col.field)}"
        >${management.escapeHtml(value)}</textarea>
      `;
    }

    if (col.type === "date") {
      return `
        <input
          type="date"
          data-pm-field="${management.escapeHtml(col.field)}"
          value="${management.escapeHtml(valueToIsoDate(value) || value)}"
        >
      `;
    }

    return `
      <input
        type="text"
        data-pm-field="${management.escapeHtml(col.field)}"
        value="${management.escapeHtml(value)}"
      >
    `;
  }

  function renderTable() {
    ensureVisibleRow();

    const config = getActiveSheetConfig();
    const rows = getRowsForSheet();
    const totalWidth = 54 + config.columns.reduce((sum, col) => sum + col.width, 0) + 54;

    elements.table.className = `planned-maintenance-table is-${state.view}`;
    elements.table.style.minWidth = `${Math.max(1080, totalWidth)}px`;

    elements.table.innerHTML = `
      <colgroup>
        <col style="width:54px">
        ${config.columns.map(col => `<col style="width:${col.width}px">`).join("")}
        <col style="width:54px">
      </colgroup>
      <thead id="plannedMaintenanceTableHead">
        <tr>
          <th>번호</th>
          ${config.columns.map(col => `<th>${management.escapeHtml(col.header)}</th>`).join("")}
          <th data-pm-action-column>삭제</th>
        </tr>
      </thead>
      <tbody id="plannedMaintenanceTableBody">
        ${rows.map((row, index) => `
          <tr data-pm-row-id="${management.escapeHtml(row.id)}">
            <td class="pm-number-cell">${index + 1}</td>
            ${config.columns.map(col => `<td>${inputHtml(row, col)}</td>`).join("")}
            <td class="pm-row-delete-cell" data-pm-action-column>
              <button
                type="button"
                class="pm-row-delete-button"
                data-pm-delete-row
                aria-label="${index + 1}번 항목 삭제"
              >×</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    `;

    elements.tableHead = document.getElementById("plannedMaintenanceTableHead");
    elements.tableBody = document.getElementById("plannedMaintenanceTableBody");
  }

  async function fetchDocument() {
    const url = new URL(API_URL, window.location.origin);
    url.searchParams.set("year", String(state.year));
    url.searchParams.set("unit", STORAGE_UNIT);
    url.searchParams.set("type", state.view);

    const response = await fetch(url, {
      method: "GET",
      headers: management.getAuthHeaders(),
      cache: "no-store"
    });

    const data = await management.parseJsonResponse(response);

    if (!response.ok || !data.ok) {
      throw new Error(data.message || "계획정비 기록을 불러오지 못했습니다.");
    }

    return data.item || {};
  }

  async function loadDocument() {
    const token = management.getSessionToken();

    if (!token) {
      elements.authWarning.hidden = false;
      elements.statusText.textContent = "로그인 필요";
      syncActionAvailability();
      return;
    }

    elements.authWarning.hidden = true;
    setLoading(true);
    elements.statusText.textContent = "불러오는 중";

    try {
      const item = await fetchDocument();

      state.version = Number(item.version || 0);
      state.recordId = normalizeString(item.id);
      state.rows = normalizeStoredRows(item.rows);
      state.lastModifiedBy = normalizeString(
        item.lastModifiedBy || item.updatedByName
      );
      state.updatedAt = normalizeString(item.updatedAt);
      state.dirty = false;

      renderTable();
      updateModifierText();
      setDirty(false);

      if (state.legacyRowsDetected && state.rows.length > 0) {
        management.showToast(
          "기존 1·2호기 방식 데이터가 감지되었습니다. 이번 Sheet 방식 Excel을 업로드한 뒤 저장하면 새 구조로 전환됩니다.",
          "info"
        );
      }
    } catch (error) {
      console.error("계획정비 불러오기 오류:", error);
      management.showToast(
        error instanceof Error
          ? error.message
          : "계획정비 기록을 불러오지 못했습니다.",
        "error"
      );

      state.rows = [];
      state.version = 0;
      state.recordId = "";
      state.lastModifiedBy = "";
      state.updatedAt = "";
      state.legacyRowsDetected = false;
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
      management.showToast("로그인 정보가 없습니다.", "error");
      return;
    }

    setLoading(true);
    elements.statusText.textContent = "저장 중";

    try {
      const rows = getPersistableRows();
      const response = await fetch(API_URL, {
        method: "PUT",
        headers: management.getAuthHeaders({
          "Content-Type": "application/json; charset=utf-8"
        }),
        body: JSON.stringify({
          year: state.year,
          unit: STORAGE_UNIT,
          type: state.view,
          version: state.version,
          rows
        }),
        cache: "no-store"
      });

      const data = await management.parseJsonResponse(response);

      if (!response.ok || !data.ok) {
        if (response.status === 409) {
          throw new Error("다른 사용자가 먼저 수정했습니다. 다시 불러온 뒤 저장해 주세요.");
        }

        throw new Error(data.message || "계획정비 기록 저장에 실패했습니다.");
      }

      const item = data.item || {};
      state.version = Number(item.version || 0);
      state.recordId = normalizeString(item.id);
      state.rows = normalizeStoredRows(
        Array.isArray(item.rows) ? item.rows : rows
      );
      state.lastModifiedBy = normalizeString(
        item.lastModifiedBy || item.updatedByName
      );
      state.updatedAt = normalizeString(item.updatedAt);
      state.legacyRowsDetected = false;

      renderTable();
      updateModifierText();
      setDirty(false);

      management.showToast("계획정비 기록을 저장했습니다.", "success");
    } catch (error) {
      console.error("계획정비 저장 오류:", error);
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
    const config = getActiveSheetConfig();
    state.rows.push(createBlankRow(config, false));
    renderTable();
    setDirty(true);

    window.requestAnimationFrame(() => {
      const wrap = document.querySelector(".planned-maintenance-table-wrap");
      wrap?.scrollTo({ top: wrap.scrollHeight, behavior: "smooth" });
    });
  }

  function confirmContextChange() {
    if (!state.dirty) {
      return true;
    }

    return window.confirm(
      "저장되지 않은 변경사항이 있습니다. 저장하지 않고 이동할까요?"
    );
  }

  async function changeView(nextView) {
    if (nextView === state.view) {
      return;
    }

    if (!confirmContextChange()) {
      syncContextUi();
      return;
    }

    state.view = nextView;
    state.sheetKey = getSheetConfigs(nextView)[0].key;
    state.version = 0;
    state.recordId = "";
    state.rows = [];
    state.lastModifiedBy = "";
    state.updatedAt = "";
    state.legacyRowsDetected = false;
    state.dirty = false;

    syncContextUi();
    await loadDocument();
  }

  function changeSheet(nextSheetKey) {
    if (nextSheetKey === state.sheetKey) {
      return;
    }

    if (!getSheetConfigByKey(nextSheetKey)) {
      return;
    }

    state.sheetKey = nextSheetKey;
    syncContextUi();
    renderTable();
    setDirty(state.dirty);
  }

  async function changeYear(nextYear) {
    if (Number(nextYear) === state.year) {
      return;
    }

    if (!confirmContextChange()) {
      elements.yearSelect.value = String(state.year);
      return;
    }

    state.year = Number(nextYear);
    state.version = 0;
    state.recordId = "";
    state.rows = [];
    state.lastModifiedBy = "";
    state.updatedAt = "";
    state.legacyRowsDetected = false;
    state.dirty = false;

    syncContextUi();
    await loadDocument();
  }

  function getPreviewColumns() {
    return getActiveSheetConfig().columns;
  }

  function buildPreviewHtml() {
    const config = getActiveSheetConfig();
    const columns = getPreviewColumns();
    const rows = getRowsForSheet().filter(row => !row.__placeholder);

    const body = rows.length > 0
      ? rows.map((row, index) => `
          <tr>
            <td class="number">${index + 1}</td>
            ${columns.map(col => `
              <td>${management.textToHtml(normalizeString(row[col.field]))}</td>
            `).join("")}
          </tr>
        `).join("")
      : `<tr><td colspan="${columns.length + 1}" class="empty">등록된 내용이 없습니다.</td></tr>`;

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${management.escapeHtml(getDocumentTitle())}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111827; font-family: "Malgun Gothic", Arial, sans-serif; }
  .toolbar { display: flex; justify-content: flex-end; margin-bottom: 8px; }
  .toolbar button { padding: 7px 12px; border: 1px solid #9aa7b5; background: #fff; border-radius: 6px; font-weight: 700; cursor: pointer; }
  h1 { margin: 0 0 9px; font-size: 17px; text-align: center; }
  .meta { margin-bottom: 6px; font-size: 10px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #1f2933; padding: 2mm 1.5mm; vertical-align: middle; font-size: 7.4px; line-height: 1.35; word-break: break-word; white-space: normal; }
  th { background: #9fc5e6; text-align: center; font-weight: 900; }
  td.number { width: 8mm; text-align: center; font-weight: 900; }
  td.empty { text-align: center; padding: 16mm 4mm; color: #64748b; }
  @media print { .toolbar { display: none; } }
</style>
</head>
<body>
  <div class="toolbar"><button onclick="window.print()">인쇄 / PDF 저장</button></div>
  <h1>${management.escapeHtml(getDocumentTitle())}</h1>
  <div class="meta">${management.escapeHtml(getViewLabel())} · Sheet: ${management.escapeHtml(config.name)}</div>
  <table>
    <thead>
      <tr>
        <th style="width:8mm">번호</th>
        ${columns.map(col => `<th>${management.escapeHtml(col.header)}</th>`).join("")}
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
  }

  function openPreview() {
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      management.showToast("팝업이 차단되어 PDF 미리보기를 열 수 없습니다.", "error");
      return;
    }

    previewWindow.document.open();
    previewWindow.document.write(buildPreviewHtml());
    previewWindow.document.close();
    previewWindow.focus();
  }

  function findWorkbookSheet(workbook, config) {
    const wanted = normalizeToken(config.name);
    return workbook.SheetNames.find(name => normalizeToken(name) === wanted) || null;
  }

  function findHeaderRow(matrix, config) {
    const expected = ["번호", ...config.columns.map(col => col.header)];
    const expectedTokens = expected.map(normalizeToken);
    let best = null;

    matrix.slice(0, 15).forEach((row, index) => {
      const tokens = (row || []).map(normalizeToken);
      const score = expectedTokens.reduce(
        (sum, token) => sum + (tokens.includes(token) ? 1 : 0),
        0
      );

      if (!best || score > best.score) {
        best = { index, score, row: row || [] };
      }
    });

    if (!best || best.score < Math.max(3, Math.ceil(expectedTokens.length * 0.45))) {
      return null;
    }

    return best;
  }

  function findColumnIndex(headerRow, aliases) {
    const tokens = (headerRow || []).map(normalizeToken);
    const aliasTokens = (aliases || []).map(normalizeToken);

    for (const alias of aliasTokens) {
      const index = tokens.indexOf(alias);
      if (index >= 0) {
        return index;
      }
    }

    return -1;
  }

  function importedRowHasContent(config, row) {
    return config.importSignals.some(field => normalizeString(row[field]));
  }

  function importRowsFromWorksheet(workbook, sheetName, config) {
    const worksheet = workbook.Sheets[sheetName];
    const matrix = window.XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: "",
      blankrows: false
    });

    const headerInfo = findHeaderRow(matrix, config);
    if (!headerInfo) {
      throw new Error(`${config.name} Sheet의 표 머리글을 찾지 못했습니다.`);
    }

    const indexes = {};
    config.columns.forEach(col => {
      indexes[col.field] = findColumnIndex(
        headerInfo.row,
        [col.header, ...(col.aliases || [])]
      );
    });

    return matrix
      .slice(headerInfo.index + 1)
      .map(sourceRow => {
        const row = {
          id: createRowId(config),
          sheetKey: config.key,
          __placeholder: false
        };

        config.columns.forEach(col => {
          const index = indexes[col.field];
          const raw = index >= 0 ? sourceRow[index] : "";
          row[col.field] = col.type === "date"
            ? valueToIsoDate(raw)
            : normalizeString(raw);
        });

        return row;
      })
      .filter(row => importedRowHasContent(config, row));
  }

  async function importExcelFile(file) {
    if (!file) {
      return;
    }

    if (!window.XLSX) {
      management.showToast("Excel 읽기 모듈이 아직 준비되지 않았습니다.", "error");
      return;
    }

    setLoading(true);
    elements.statusText.textContent = "Excel 읽는 중";

    try {
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(buffer, {
        type: "array",
        cellDates: true
      });

      const matched = [];
      const imported = [];

      getSheetConfigs().forEach(config => {
        const sheetName = findWorkbookSheet(workbook, config);
        if (!sheetName) {
          return;
        }

        const rows = importRowsFromWorksheet(workbook, sheetName, config);
        matched.push(config);
        imported.push(...rows);
      });

      if (matched.length === 0) {
        throw new Error(
          `${getViewLabel()} 원본 Sheet를 찾지 못했습니다. 현재 화면에 맞는 Excel 파일인지 확인해 주세요.`
        );
      }

      const matchedKeys = new Set(matched.map(config => config.key));
      const description = matched
        .map(config => `${config.name} ${imported.filter(row => row.sheetKey === config.key).length}건`)
        .join(" · ");

      const confirmed = window.confirm(
        `Excel의 ${matched.length}개 Sheet를 ${getViewLabel()}에 불러옵니다.\n` +
        `해당 Sheet의 현재 내용은 Excel 내용으로 교체됩니다.\n\n${description}\n\n계속할까요?`
      );

      if (!confirmed) {
        setDirty(state.dirty);
        return;
      }

      state.rows = [
        ...state.rows.filter(row => !matchedKeys.has(resolveRowSheetKey(row))),
        ...imported
      ];
      state.legacyRowsDetected = false;

      renderTable();
      setDirty(true);
      updateModifierText();

      management.showToast(
        `Excel Sheet ${matched.length}개를 불러왔습니다. 화면 확인 후 저장을 눌러 주세요.`,
        "success"
      );
    } catch (error) {
      console.error("Excel 업로드 오류:", error);
      management.showToast(
        error instanceof Error ? error.message : "Excel 파일을 읽지 못했습니다.",
        "error"
      );
      setDirty(state.dirty);
    } finally {
      setLoading(false);
      elements.excelFileInput.value = "";
    }
  }

  function templatePathForView() {
    return state.view === "work"
      ? `templates/planned-maintenance-work-template.xlsx?v=${TEMPLATE_VERSION}`
      : `templates/planned-maintenance-logic-template.xlsx?v=${TEMPLATE_VERSION}`;
  }

  function cloneStyle(value) {
    if (!value || typeof value !== "object") {
      return value;
    }

    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return value;
    }
  }

  function copyTemplateRowStyle(worksheet, sourceRowNumber, targetRowNumber, lastColumnNumber) {
    const sourceRow = worksheet.getRow(sourceRowNumber);
    const targetRow = worksheet.getRow(targetRowNumber);

    targetRow.height = sourceRow.height;

    for (let col = 1; col <= lastColumnNumber; col += 1) {
      const sourceCell = sourceRow.getCell(col);
      const targetCell = targetRow.getCell(col);

      targetCell.style = cloneStyle(sourceCell.style);
      if (sourceCell.numFmt) {
        targetCell.numFmt = sourceCell.numFmt;
      }
    }
  }

  function setExcelCellValue(cell, col, value) {
    if (col.type === "date") {
      cell.value = value ? isoToExcelDate(value) : null;
      cell.numFmt = "m/d/yy";
      return;
    }

    cell.value = normalizeString(value) || null;
  }

  function estimateExcelRowHeight(config, row, fallback) {
    let longest = 0;
    config.columns.forEach(col => {
      const text = normalizeString(row[col.field]);
      const lineCount = Math.max(1, text.split(/\r?\n/).length);
      const roughWrap = Math.ceil(text.length / Math.max(18, Math.floor(col.width / 7)));
      longest = Math.max(longest, lineCount, roughWrap);
    });

    return Math.max(fallback || 22, Math.min(95, 18 + longest * 13));
  }

  async function downloadExcel() {
    if (!window.ExcelJS) {
      management.showToast("Excel 생성 모듈이 아직 준비되지 않았습니다.", "error");
      return;
    }

    setLoading(true);
    elements.statusText.textContent = "Excel 생성 중";

    try {
      const templateResponse = await fetch(templatePathForView(), {
        cache: "no-store"
      });

      if (!templateResponse.ok) {
        throw new Error("Excel 원본 양식 템플릿을 불러오지 못했습니다.");
      }

      const templateBuffer = await templateResponse.arrayBuffer();
      const workbook = new window.ExcelJS.Workbook();
      await workbook.xlsx.load(templateBuffer);

      const legacyWorksheet = workbook.getWorksheet("2021.09 긴급 정비 사항");
      if (legacyWorksheet) {
        workbook.removeWorksheet(legacyWorksheet.id);
      }

      getSheetConfigs().forEach(config => {
        const worksheet = workbook.getWorksheet(config.name);
        if (!worksheet) {
          throw new Error(`${config.name} Excel 템플릿 Sheet를 찾지 못했습니다.`);
        }

        worksheet.properties.tabColor = { argb: config.tabColor };
        worksheet.getCell("B2").value = config.excelTitle(state.year);

        const lastColumn = 2 + config.columns.length;
        const rows = state.rows
          .filter(row => resolveRowSheetKey(row) === config.key && !row.__placeholder);

        const clearTo = Math.max(worksheet.rowCount, 6 + rows.length + 5);
        for (let rowNumber = 6; rowNumber <= clearTo; rowNumber += 1) {
          for (let colNumber = 2; colNumber <= lastColumn; colNumber += 1) {
            worksheet.getCell(rowNumber, colNumber).value = null;
          }
        }

        rows.forEach((row, index) => {
          const rowNumber = 6 + index;

          if (rowNumber > worksheet.rowCount || !worksheet.getRow(rowNumber).hasValues) {
            copyTemplateRowStyle(worksheet, 6, rowNumber, lastColumn);
          }

          worksheet.getCell(rowNumber, 2).value = index + 1;

          config.columns.forEach((col, colIndex) => {
            setExcelCellValue(
              worksheet.getCell(rowNumber, 3 + colIndex),
              col,
              row[col.field]
            );
          });

          worksheet.getRow(rowNumber).height = estimateExcelRowHeight(
            config,
            row,
            worksheet.getRow(rowNumber).height
          );
        });
      });

      const output = await workbook.xlsx.writeBuffer();
      const blob = new Blob(
        [output],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${state.year}년_계획정비_${getViewLabel()}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      management.showToast(
        `${getViewLabel()} 5개 Sheet를 원본 양식 Excel로 다운로드했습니다.`,
        "success"
      );
      setDirty(state.dirty);
    } catch (error) {
      console.error("Excel 다운로드 오류:", error);
      management.showToast(
        error instanceof Error ? error.message : "Excel 파일 생성에 실패했습니다.",
        "error"
      );
      setDirty(state.dirty);
    } finally {
      setLoading(false);
    }
  }

  function handleTableInput(event) {
    const fieldElement = event.target.closest("[data-pm-field]");
    if (!fieldElement) {
      return;
    }

    const rowElement = fieldElement.closest("[data-pm-row-id]");
    if (!rowElement) {
      return;
    }

    const row = state.rows.find(item => item.id === rowElement.dataset.pmRowId);
    if (!row) {
      return;
    }

    row[fieldElement.dataset.pmField] = fieldElement.value;
    row.__placeholder = false;
    setDirty(true);
  }

  function handleTableClick(event) {
    const deleteButton = event.target.closest("[data-pm-delete-row]");
    if (!deleteButton) {
      return;
    }

    const rowElement = deleteButton.closest("[data-pm-row-id]");
    if (!rowElement) {
      return;
    }

    state.rows = state.rows.filter(item => item.id !== rowElement.dataset.pmRowId);
    renderTable();
    setDirty(true);
  }

  function bindEvents() {
    document
      .querySelectorAll("[data-planned-maintenance-view]")
      .forEach(button => {
        button.addEventListener("click", () => {
          void changeView(button.dataset.plannedMaintenanceView);
        });
      });

    elements.sheetTabs.addEventListener("click", event => {
      const button = event.target.closest("[data-planned-maintenance-sheet]");
      if (!button) {
        return;
      }
      changeSheet(button.dataset.plannedMaintenanceSheet);
    });

    elements.yearSelect.addEventListener("change", event => {
      void changeYear(event.target.value);
    });

    elements.addRowButton.addEventListener("click", addRow);
    elements.saveButton.addEventListener("click", () => void saveDocument());

    elements.reloadButton.addEventListener("click", () => {
      if (!confirmContextChange()) {
        return;
      }
      state.dirty = false;
      void loadDocument();
    });

    elements.previewButton.addEventListener("click", openPreview);

    elements.homeButton.addEventListener("click", () => {
      window.location.href = "../index.html";
    });

    elements.excelUploadButton.addEventListener("click", () => {
      elements.excelFileInput.click();
    });

    elements.excelFileInput.addEventListener("change", event => {
      const file = event.target.files?.[0];
      if (file) {
        void importExcelFile(file);
      }
    });

    elements.excelDownloadButton.addEventListener("click", () => {
      void downloadExcel();
    });

    elements.table.addEventListener("input", handleTableInput);
    elements.table.addEventListener("change", handleTableInput);
    elements.table.addEventListener("click", handleTableClick);

    window.addEventListener("beforeunload", event => {
      if (!state.dirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    });
  }

  async function initialize() {
    ensureSheetKey();
    bindEvents();
    syncContextUi();
    renderTable();
    await loadDocument();
  }

  void initialize();
})();
/* =========================================================
   [PLANNED-MAINTENANCE-AUTO-TEXTAREA-HEIGHT-V1]

   Logic 개선 / 작업필요사항 표의 textarea를 내용 높이에 맞춰
   자동 확장한다.

   - 사용자 입력 / 붙여넣기 즉시 반영
   - Sheet 탭 전환 및 표 재렌더링 반영
   - Excel 업로드 후 생성된 행 반영
   - 다시 불러오기 후 반영
   - 화면 폭 변경으로 줄바꿈 수가 변할 때 재계산
========================================================= */
(() => {
  const TEXTAREA_SELECTOR =
    ".planned-maintenance-table textarea";

  const MIN_HEIGHT_PX = 72;

  let resizeFrame = 0;

  function resizeTextarea(textarea) {
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return;
    }

    if (!textarea.matches(TEXTAREA_SELECTOR)) {
      return;
    }

    textarea.style.height = "auto";

    const nextHeight = Math.max(
      MIN_HEIGHT_PX,
      textarea.scrollHeight
    );

    textarea.style.height = `${nextHeight}px`;
  }

  function resizeAllTextareas(root = document) {
    if (
      root instanceof HTMLTextAreaElement &&
      root.matches(TEXTAREA_SELECTOR)
    ) {
      resizeTextarea(root);
      return;
    }

    if (
      root === document ||
      root instanceof Document ||
      root instanceof DocumentFragment ||
      root instanceof Element
    ) {
      root
        .querySelectorAll(TEXTAREA_SELECTOR)
        .forEach(resizeTextarea);
    }
  }

  function scheduleResize(root = document) {
    if (resizeFrame) {
      cancelAnimationFrame(resizeFrame);
    }

    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resizeAllTextareas(root);
    });
  }

  function scheduleFollowupResizes() {
    scheduleResize();

    window.setTimeout(() => {
      scheduleResize();
    }, 80);

    window.setTimeout(() => {
      scheduleResize();
    }, 300);

    window.setTimeout(() => {
      scheduleResize();
    }, 900);
  }

  document.addEventListener(
    "input",
    (event) => {
      const target = event.target;

      if (
        target instanceof HTMLTextAreaElement &&
        target.matches(TEXTAREA_SELECTOR)
      ) {
        resizeTextarea(target);
      }
    },
    true
  );

  document.addEventListener(
    "change",
    (event) => {
      const target = event.target;

      if (
        target instanceof HTMLTextAreaElement &&
        target.matches(TEXTAREA_SELECTOR)
      ) {
        resizeTextarea(target);
        return;
      }

      if (
        target instanceof HTMLInputElement &&
        target.type === "file"
      ) {
        scheduleFollowupResizes();
      }
    },
    true
  );

  document.addEventListener(
    "click",
    () => {
      scheduleResize();
    },
    true
  );

  window.addEventListener(
    "resize",
    () => {
      scheduleResize();
    }
  );

  const observer = new MutationObserver((mutations) => {
    let shouldResize = false;

    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }

      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) {
          continue;
        }

        if (
          node.matches(TEXTAREA_SELECTOR) ||
          node.querySelector(TEXTAREA_SELECTOR)
        ) {
          shouldResize = true;
          break;
        }
      }

      if (shouldResize) {
        break;
      }
    }

    if (shouldResize) {
      scheduleResize();
    }
  });

  function startAutoResize() {
    resizeAllTextareas();

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    scheduleFollowupResizes();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      startAutoResize,
      { once: true }
    );
  } else {
    startAutoResize();
  }
})();
/* =========================================================
   [PLANNED-MAINTENANCE-WORK-CATEGORY-TABS-V1]

   작업필요사항 표에 "분류" 열이 있을 때만
   통합 / 기계 / 전기 / 제어 화면 필터 탭을 표시한다.

   원본 행과 값은 그대로 유지하고 CSS class로만 숨김 처리한다.
   따라서 저장 데이터나 Excel Sheet 구성은 변경하지 않는다.
========================================================= */
(() => {
  const TABLE_SELECTOR =
    ".planned-maintenance-table";

  const SHEET_TABS_SHELL_SELECTOR =
    ".pm-sheet-tabs-shell";

  const FILTER_SHELL_CLASS =
    "pm-work-category-tabs-shell";

  const FILTER_BUTTON_CLASS =
    "pm-work-category-tab";

  const FILTERED_ROW_CLASS =
    "pm-category-filtered-out";

  const FILTERS = [
    {
      key: "all",
      label: "통합"
    },
    {
      key: "기계",
      label: "기계"
    },
    {
      key: "전기",
      label: "전기"
    },
    {
      key: "제어",
      label: "제어"
    },
    {
      key: "기타",
      label: "기타"
    }
  ];

  let activeFilter = "all";
  let refreshFrame = 0;

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findCategoryContext() {
    const table =
      document.querySelector(
        TABLE_SELECTOR
      );

    if (!(table instanceof HTMLTableElement)) {
      return null;
    }

    const headers = Array.from(
      table.querySelectorAll(
        "thead th"
      )
    );

    const categoryIndex =
      headers.findIndex(
        header =>
          normalizeText(
            header.textContent
          ) === "분류"
      );

    if (categoryIndex < 0) {
      return null;
    }

    const sheetTabsShell =
      document.querySelector(
        SHEET_TABS_SHELL_SELECTOR
      );

    if (!(sheetTabsShell instanceof HTMLElement)) {
      return null;
    }

    return {
      table,
      categoryIndex,
      sheetTabsShell
    };
  }

  function getExistingFilterShell() {
    return document.querySelector(
      `.${FILTER_SHELL_CLASS}`
    );
  }

  function createFilterShell() {
    const shell =
      document.createElement("div");

    shell.className =
      FILTER_SHELL_CLASS;

    shell.setAttribute(
      "role",
      "tablist"
    );

    shell.setAttribute(
      "aria-label",
      "작업필요사항 분류"
    );

    for (const filter of FILTERS) {
      const button =
        document.createElement("button");

      button.type = "button";

      button.className =
        FILTER_BUTTON_CLASS;

      button.dataset.pmCategoryFilter =
        filter.key;

      button.textContent =
        filter.label;

      button.setAttribute(
        "role",
        "tab"
      );

      shell.appendChild(
        button
      );
    }

    return shell;
  }

  function ensureFilterShell(
    context
  ) {
    let shell =
      getExistingFilterShell();

    if (!(shell instanceof HTMLElement)) {
      shell =
        createFilterShell();
    }

    if (
      shell.previousElementSibling !==
        context.sheetTabsShell
    ) {
      context.sheetTabsShell
        .insertAdjacentElement(
          "afterend",
          shell
        );
    }

    shell.hidden = false;

    return shell;
  }

  function clearFilteredRows() {
    document
      .querySelectorAll(
        `.${FILTERED_ROW_CLASS}`
      )
      .forEach(
        row => {
          row.classList.remove(
            FILTERED_ROW_CLASS
          );
        }
      );
  }

  function readRowCategory(
    row,
    categoryIndex
  ) {
    const cell =
      row.cells?.[categoryIndex];

    if (!(cell instanceof HTMLTableCellElement)) {
      return "";
    }

    const select =
      cell.querySelector(
        "select"
      );

    if (select instanceof HTMLSelectElement) {
      const selectedText =
        select.selectedOptions?.[0]
          ?.textContent;

      return normalizeText(
        selectedText ||
        select.value
      );
    }

    const control =
      cell.querySelector(
        "input, textarea"
      );

    if (
      control instanceof HTMLInputElement ||
      control instanceof HTMLTextAreaElement
    ) {
      return normalizeText(
        control.value
      );
    }

    return normalizeText(
      cell.textContent
    );
  }

  function updateFilterButtons(
    shell
  ) {
    shell
      .querySelectorAll(
        `.${FILTER_BUTTON_CLASS}`
      )
      .forEach(
        button => {
          const isActive =
            button.dataset
              .pmCategoryFilter ===
            activeFilter;

          button.classList.toggle(
            "is-active",
            isActive
          );

          button.setAttribute(
            "aria-selected",
            isActive
              ? "true"
              : "false"
          );
        }
      );
  }

  function applyCategoryFilter() {
    const context =
      findCategoryContext();

    if (!context) {
      const shell =
        getExistingFilterShell();

      if (shell instanceof HTMLElement) {
        shell.hidden = true;
      }

      clearFilteredRows();
      return;
    }

    const shell =
      ensureFilterShell(
        context
      );

    updateFilterButtons(
      shell
    );

    const rows =
      Array.from(
        context.table.tBodies
      )
        .flatMap(
          body =>
            Array.from(
              body.rows
            )
        );

    for (const row of rows) {
      const category =
        readRowCategory(
          row,
          context.categoryIndex
        );

      /*
        새 항목처럼 분류가 아직 비어 있는 행은
        특정 필터 탭에서도 숨기지 않는다.
        그래야 +항목 추가 직후 새 행이 사라지지 않는다.
      */
      const shouldShow =
        activeFilter === "all" ||
        category === "" ||
        category === activeFilter;

      row.classList.toggle(
        FILTERED_ROW_CLASS,
        !shouldShow
      );
    }
  }

  function scheduleRefresh() {
    if (refreshFrame) {
      cancelAnimationFrame(
        refreshFrame
      );
    }

    refreshFrame =
      requestAnimationFrame(
        () => {
          refreshFrame = 0;
          applyCategoryFilter();
        }
      );
  }

  document.addEventListener(
    "click",
    event => {
      const button =
        event.target.closest?.(
          `.${FILTER_BUTTON_CLASS}`
        );

      if (
        button instanceof HTMLButtonElement
      ) {
        const nextFilter =
          button.dataset
            .pmCategoryFilter;

        if (
          FILTERS.some(
            filter =>
              filter.key ===
              nextFilter
          )
        ) {
          activeFilter =
            nextFilter;

          applyCategoryFilter();
        }

        return;
      }

      /*
        Sheet 탭 / Logic 개선 / 작업필요사항 전환,
        항목 추가 등 기존 버튼 동작 뒤 DOM이 바뀌는 경우를
        다음 frame에서 다시 판정한다.
      */
      scheduleRefresh();
    },
    true
  );

  document.addEventListener(
    "change",
    event => {
      const target =
        event.target;

      if (
        target instanceof Element &&
        target.closest(
          TABLE_SELECTOR
        )
      ) {
        scheduleRefresh();
      }
    },
    true
  );

  const observer =
    new MutationObserver(
      mutations => {
        const hasRelevantChange =
          mutations.some(
            mutation =>
              mutation.type ===
                "childList" &&
              (
                mutation.addedNodes.length >
                  0 ||
                mutation.removedNodes.length >
                  0
              )
          );

        if (hasRelevantChange) {
          scheduleRefresh();
        }
      }
    );

  function startCategoryTabs() {
    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true
      }
    );

    applyCategoryFilter();
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      startCategoryTabs,
      {
        once: true
      }
    );
  } else {
    startCategoryTabs();
  }
})();
