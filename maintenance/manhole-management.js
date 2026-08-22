"use strict";

(function initializeManholeManagementPage() {
  const API_URL =
    "/api/manhole-management";

  const management =
    window.GSManagement;

  if (!management) {
    throw new Error(
      "관리 공통 모듈을 불러오지 못했습니다."
    );
  }

  /*
    1호기 Excel 양식의 위치/개소를 기준으로 만든 공통 마스터입니다.
    왼쪽 위치도는 원본 그림을 그대로 표시하고, 상태 변경은 오른쪽 목록에서만 수행합니다.
    오른쪽 목록에서 Open / Close를 바꾸면 원본 그림의 해당 맨홀 심볼 주변 원형 마커가 상태색으로 바뀝니다.
    2호기는 화면 확인 전까지 1호기 위치도를 임시 복제하여 사용합니다.
  */
  const MASTER_LOCATIONS = [
    {
      no: 1,
      group: "BOILER",
      location: "Combustor 하부",
      area: "2.5층",
      count: 1,
      x: 11,
      y: 61
    },
    {
      no: 2,
      group: "BOILER",
      location: "Penthouse",
      area: "7층",
      count: 1,
      x: 48,
      y: 10
    },
    {
      no: 3,
      group: "BOILER",
      location: "CID",
      area: "6.5층",
      count: 2,
      x: 47,
      y: 18
    },
    {
      no: 4,
      group: "BOILER",
      location: "S/H 3",
      area: "7층",
      count: 2,
      x: 43,
      y: 25
    },
    {
      no: 5,
      group: "BOILER",
      location: "R/H 2",
      area: "6.5층",
      count: 2,
      x: 54,
      y: 25
    },
    {
      no: 6,
      group: "BOILER",
      location: "R/H 1-2",
      area: "6.5층",
      count: 2,
      x: 43,
      y: 32
    },
    {
      no: 7,
      group: "BOILER",
      location: "R/H 1-1",
      area: "6.5층",
      count: 2,
      x: 54,
      y: 32
    },
    {
      no: 8,
      group: "BOILER",
      location: "ECO 2",
      area: "6층",
      count: 2,
      x: 43,
      y: 39
    },
    {
      no: 9,
      group: "BOILER",
      location: "ECO 2 하부",
      area: "6층",
      count: 2,
      x: 54,
      y: 39
    },
    {
      no: 10,
      group: "BOILER",
      location: "SCR 1",
      area: "8층",
      count: 1,
      x: 69,
      y: 17
    },
    {
      no: 11,
      group: "BOILER",
      location: "SCR 2",
      area: "7층",
      count: 1,
      x: 69,
      y: 28
    },
    {
      no: 12,
      group: "BOILER",
      location: "SCR 3",
      area: "6.5층",
      count: 1,
      x: 69,
      y: 39
    },
    {
      no: 13,
      group: "BOILER",
      location: "ECO 1-2",
      area: "6.5층",
      count: 2,
      x: 43,
      y: 47
    },
    {
      no: 14,
      group: "BOILER",
      location: "ECO 1-1",
      area: "6층",
      count: 4,
      x: 54,
      y: 47
    },
    {
      no: 15,
      group: "BOILER",
      location: "ECO 1 하부",
      area: "5.5층",
      count: 2,
      x: 49,
      y: 55
    },
    {
      no: 16,
      group: "BOILER",
      location: "TAH 1",
      area: "3.5층",
      count: 1,
      x: 59,
      y: 65
    },
    {
      no: 17,
      group: "BOILER",
      location: "TAH 2",
      area: "3.5층",
      count: 1,
      x: 67,
      y: 65
    },
    {
      no: 18,
      group: "BOILER",
      location: "TAH 3",
      area: "3층",
      count: 1,
      x: 59,
      y: 73
    },
    {
      no: 19,
      group: "BOILER",
      location: "TAH 4",
      area: "3층",
      count: 1,
      x: 67,
      y: 73
    },
    {
      no: 20,
      group: "BOILER",
      location: "Wind Box",
      area: "2층",
      count: 1,
      x: 50,
      y: 65
    },
    {
      no: 21,
      group: "SDA",
      location: "Atomizer 출입",
      area: "Atomizer Room",
      count: 1,
      x: 88,
      y: 33
    },
    {
      no: 22,
      group: "SDA",
      location: "SDA 상부",
      area: "상부 측면 계단",
      count: 1,
      x: 88,
      y: 44
    },
    {
      no: 23,
      group: "SDA",
      location: "SDA Hopper",
      area: "2층",
      count: 1,
      x: 88,
      y: 56
    },
    {
      no: 24,
      group: "SDA",
      location: "SDA Outlet Duct",
      area: "3층",
      count: 1,
      x: 88,
      y: 68
    },
    {
      no: 25,
      group: "Seal Pot & FBHE RIGHT",
      location: "FBHE EVA'",
      area: "BNR측",
      count: 1,
      x: 11,
      y: 76
    },
    {
      no: 26,
      group: "Seal Pot & FBHE RIGHT",
      location: "FBHE 1-2",
      area: "BNR측",
      count: 1,
      x: 11,
      y: 84
    },
    {
      no: 27,
      group: "Seal Pot & FBHE RIGHT",
      location: "Empty",
      area: "3층",
      count: 1,
      x: 11,
      y: 92
    },
    {
      no: 28,
      group: "Seal Pot & FBHE RIGHT",
      location: "FBHE 상부",
      area: "3층 사다리",
      count: 1,
      x: 21,
      y: 92
    },
    {
      no: 29,
      group: "Seal Pot & FBHE RIGHT",
      location: "Seal Pot",
      area: "4층",
      count: 1,
      x: 20,
      y: 70
    },
    {
      no: 30,
      group: "Seal Pot & FBHE LEFT",
      location: "FBHE 2-1",
      area: "BNR측",
      count: 1,
      x: 31,
      y: 76
    },
    {
      no: 31,
      group: "Seal Pot & FBHE LEFT",
      location: "FBHE 2-2",
      area: "BNR측",
      count: 1,
      x: 31,
      y: 84
    },
    {
      no: 32,
      group: "Seal Pot & FBHE LEFT",
      location: "Empty",
      area: "3층",
      count: 1,
      x: 31,
      y: 92
    },
    {
      no: 33,
      group: "Seal Pot & FBHE LEFT",
      location: "FBHE 상부",
      area: "3층 사다리",
      count: 1,
      x: 41,
      y: 92
    },
    {
      no: 34,
      group: "Seal Pot & FBHE LEFT",
      location: "Seal Pot",
      area: "4층",
      count: 1,
      x: 34,
      y: 70
    }
  ];

  /*
    원본 1호기 그림(710 x 656px)에서 노란 맨홀 심볼 중심점을
    백분율 좌표로 고정한 표시 전용 맵입니다.

    - 14번은 원본 그림에서 3개 심볼을 함께 표시합니다.
    - 25~34번 일부는 같은 심볼 위치에 두 번호가 표기되어 있어
      바깥 원 / 안쪽 원으로 두 상태를 동시에 표시합니다.
    - 2호기는 현재 1호기 원본 위치도를 임시 복제하므로 같은 좌표를 사용합니다.
  */
  const DIAGRAM_MARKERS_BY_NO = {
    1: [{ x: 4.085, y: 90.168 }],
    2: [{ x: 12.746, y: 22.256 }],
    3: [{ x: 18.099, y: 30.030 }],
    4: [{ x: 44.789, y: 24.848 }],
    5: [{ x: 44.718, y: 30.793 }],
    6: [{ x: 44.718, y: 37.271 }],
    7: [{ x: 44.789, y: 43.445 }],
    8: [{ x: 44.789, y: 49.695 }],
    9: [{ x: 44.930, y: 55.488 }],
    10: [{ x: 65.634, y: 11.280 }],
    11: [{ x: 65.493, y: 15.854 }],
    12: [{ x: 65.563, y: 21.189 }],
    13: [{ x: 65.493, y: 31.402 }],
    14: [
      { x: 62.465, y: 36.052 },
      { x: 65.493, y: 36.052 },
      { x: 68.662, y: 36.052 }
    ],
    15: [{ x: 65.563, y: 40.930 }],
    16: [{ x: 65.563, y: 58.460 }],
    17: [{ x: 65.704, y: 63.338 }],
    18: [{ x: 65.563, y: 67.912 }],
    19: [{ x: 65.634, y: 73.399 }],
    20: [{ x: 31.972, y: 97.180 }],
    21: [{ x: 83.732, y: 39.177 }],
    22: [{ x: 89.859, y: 42.835 }],
    23: [{ x: 87.042, y: 67.530 }],
    24: [{ x: 96.972, y: 61.204 }],
    25: [{ x: 25.000, y: 83.308, ring: "outer" }],
    26: [{ x: 29.930, y: 83.384, ring: "outer" }],
    27: [{ x: 34.859, y: 83.232, ring: "outer" }],
    28: [{ x: 21.690, y: 78.277, ring: "outer" }],
    29: [{ x: 27.113, y: 61.128, ring: "outer" }],
    30: [{ x: 25.000, y: 83.308, ring: "inner" }],
    31: [{ x: 29.930, y: 83.384, ring: "inner" }],
    32: [{ x: 34.859, y: 83.232, ring: "inner" }],
    33: [{ x: 21.690, y: 78.277, ring: "inner" }],
    34: [{ x: 27.113, y: 61.128, ring: "inner" }]
  };

  const state = {
    unit: "1",
    version: 0,
    rows: [],
    dirty: false,
    loading: false,
    lastModifiedBy: "",
    updatedAt: ""
  };

  const elements = {
    authWarning:
      document.getElementById(
        "manholeAuthWarning"
      ),
    homeButton:
      document.getElementById(
        "manholeHomeButton"
      ),
    reloadButton:
      document.getElementById(
        "manholeReloadButton"
      ),
    saveButton:
      document.getElementById(
        "manholeSaveButton"
      ),
    unitTitle:
      document.getElementById(
        "manholeUnitTitle"
      ),
    statusDot:
      document.getElementById(
        "manholeStatusDot"
      ),
    statusText:
      document.getElementById(
        "manholeStatusText"
      ),
    modifierText:
      document.getElementById(
        "manholeModifierText"
      ),
    openCount:
      document.getElementById(
        "manholeOpenCount"
      ),
    closeCount:
      document.getElementById(
        "manholeCloseCount"
      ),
    unknownCount:
      document.getElementById(
        "manholeUnknownCount"
      ),
    schematic:
      document.getElementById(
        "manholeSchematic"
      ),
    diagramHeading:
      document.getElementById(
        "manholeDiagramHeading"
      ),
    diagramHint:
      document.getElementById(
        "manholeDiagramHint"
      ),
    diagramImage:
      document.getElementById(
        "manholeDiagramImage"
      ),
    diagramOverlay:
      document.getElementById(
        "manholeDiagramOverlay"
      ),
    diagramUnitNotice:
      document.getElementById(
        "manholeDiagramUnitNotice"
      ),
    tableBody:
      document.getElementById(
        "manholeTableBody"
      )
  };

  function cloneMasterRows() {
    return MASTER_LOCATIONS.map(
      item => ({
        ...item,
        status: "",
        changeDate: "",
        note: ""
      })
    );
  }

  function normalizeStatus(
    value
  ) {
    const normalized =
      String(value || "")
        .trim()
        .toLowerCase();

    if (normalized === "open") {
      return "open";
    }

    if (normalized === "close") {
      return "close";
    }

    return "";
  }

  function mergeStoredRows(
    storedRows
  ) {
    const storedMap =
      new Map();

    if (Array.isArray(storedRows)) {
      storedRows.forEach(
        row => {
          const no =
            Number(row?.no);

          if (
            Number.isInteger(no) &&
            no >= 1 &&
            no <= MASTER_LOCATIONS.length
          ) {
            storedMap.set(
              no,
              row
            );
          }
        }
      );
    }

    return MASTER_LOCATIONS.map(
      item => {
        const stored =
          storedMap.get(
            item.no
          ) || {};

        return {
          ...item,
          status:
            normalizeStatus(
              stored.status
            ),
          changeDate:
            String(
              stored.changeDate ||
              stored.change_date ||
              ""
            ).slice(0, 10),
          note:
            String(
              stored.note ||
              ""
            ).slice(0, 1000)
        };
      }
    );
  }

  function setLoading(
    loading
  ) {
    state.loading =
      Boolean(loading);

    [
      elements.reloadButton,
      elements.saveButton
    ].forEach(
      button => {
        if (button) {
          button.disabled =
            state.loading;
        }
      }
    );

    document
      .querySelectorAll(
        "[data-manhole-unit]"
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
    state.dirty =
      Boolean(dirty);

    elements.statusDot
      .classList.toggle(
        "is-dirty",
        state.dirty
      );

    elements.statusDot
      .classList.toggle(
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

  function syncUnitUi() {
    document
      .querySelectorAll(
        "[data-manhole-unit]"
      )
      .forEach(
        button => {
          button.classList.toggle(
            "is-active",
            button.dataset
              .manholeUnit ===
              state.unit
          );
        }
      );

    elements.unitTitle.textContent =
      `${state.unit}호기 보일러 맨홀 개방/폐쇄 추적 관리`;
  }

  function getRowClass(
    row
  ) {
    if (row.status === "open") {
      return "is-open";
    }

    if (row.status === "close") {
      return "is-close";
    }

    return "";
  }

  function getStatusSelectHtml(
    row
  ) {
    const no =
      Number(row.no);

    return `
      <select
        data-manhole-status-select="${no}"
        aria-label="${no}번 ${management.escapeHtml(row.location)} 상태"
      >
        <option value="" ${row.status === "" ? "selected" : ""}>선택</option>
        <option value="open" ${row.status === "open" ? "selected" : ""}>Open</option>
        <option value="close" ${row.status === "close" ? "selected" : ""}>Close</option>
      </select>
    `;
  }

  function getDiagramMarkerClass(
    row,
    point
  ) {
    const classes = [
      "manhole-diagram-marker"
    ];

    if (row.status === "open") {
      classes.push(
        "is-open"
      );
    } else if (row.status === "close") {
      classes.push(
        "is-close"
      );
    }

    if (point?.ring === "inner") {
      classes.push(
        "is-paired-inner"
      );
    }

    return classes.join(" ");
  }

  function renderDiagramStatusMarkers() {
    if (!elements.diagramOverlay) {
      return;
    }

    const html = [];

    state.rows.forEach(
      row => {
        if (!row.status) {
          return;
        }

        const points =
          DIAGRAM_MARKERS_BY_NO[
            row.no
          ] || [];

        points.forEach(
          (point, index) => {
            html.push(`
              <span
                class="${getDiagramMarkerClass(row, point)}"
                data-manhole-diagram-marker="${row.no}"
                data-manhole-diagram-marker-index="${index}"
                style="--marker-x: ${point.x}%; --marker-y: ${point.y}%;"
              ></span>
            `);
          }
        );
      }
    );

    elements.diagramOverlay.innerHTML =
      html.join("");
  }

  function setDiagramRowHighlight(
    no,
    active
  ) {
    document
      .querySelectorAll(
        `[data-manhole-diagram-marker="${Number(no)}"]`
      )
      .forEach(
        marker => {
          marker.classList.toggle(
            "is-row-highlight",
            Boolean(active)
          );
        }
      );
  }

  function renderSchematic() {
    const isUnit2 =
      state.unit === "2";

    if (elements.diagramHeading) {
      elements.diagramHeading.textContent =
        isUnit2
          ? "2호기 설비 위치도"
          : "1호기 원본 설비 위치도";
    }

    if (elements.diagramHint) {
      elements.diagramHint.textContent =
        isUnit2
          ? "1호기 원본 위치도 임시 복제본에 오른쪽 목록의 Open / Close 상태를 원으로 표시합니다."
          : "오른쪽 목록에서 Open / Close를 바꾸면 해당 맨홀 주변 원의 색이 바뀝니다.";
    }

    if (elements.diagramImage) {
      elements.diagramImage.alt =
        isUnit2
          ? "2호기 맨홀 위치도 임시 복제본"
          : "1호기 보일러 맨홀 개방·폐쇄 추적 관리 원본 위치도";
    }

    if (elements.diagramUnitNotice) {
      elements.diagramUnitNotice.hidden =
        !isUnit2;
    }

    renderDiagramStatusMarkers();
  }

  function renderTable() {
    let previousGroup = "";

    const html = [];

    state.rows.forEach(
      row => {
        if (
          row.group !==
          previousGroup
        ) {
          const groupClass =
            row.group.includes(
              "FBHE"
            )
              ? " is-fbhe"
              : "";

          html.push(`
            <tr class="manhole-group-row${groupClass}">
              <td colspan="7">
                ${management.escapeHtml(row.group)}
              </td>
            </tr>
          `);

          previousGroup =
            row.group;
        }

        html.push(`
          <tr
            class="${getRowClass(row)}"
            data-manhole-row="${row.no}"
          >
            <td class="manhole-number">${row.no}</td>
            <td>${management.escapeHtml(row.location)}</td>
            <td>${management.escapeHtml(row.area)}</td>
            <td class="manhole-count">${row.count}</td>
            <td>
              ${getStatusSelectHtml(row)}
            </td>
            <td>
              <input
                type="date"
                value="${management.escapeHtml(row.changeDate)}"
                data-manhole-date="${row.no}"
                aria-label="${row.no}번 개폐일자"
              >
            </td>
            <td>
              <input
                type="text"
                value="${management.escapeHtml(row.note)}"
                data-manhole-note="${row.no}"
                maxlength="1000"
                aria-label="${row.no}번 비고"
              >
            </td>
          </tr>
        `);
      }
    );

    elements.tableBody.innerHTML =
      html.join("");
  }

  function renderSummary() {
    let openCount = 0;
    let closeCount = 0;
    let unknownCount = 0;

    state.rows.forEach(
      row => {
        const count =
          Math.max(
            0,
            Number(row.count) || 0
          );

        if (row.status === "open") {
          openCount += count;
        } else if (
          row.status === "close"
        ) {
          closeCount += count;
        } else {
          unknownCount += count;
        }
      }
    );

    elements.openCount.textContent =
      String(openCount);

    elements.closeCount.textContent =
      String(closeCount);

    elements.unknownCount.textContent =
      String(unknownCount);
  }

  function render() {
    syncUnitUi();
    renderSchematic();
    renderTable();
    renderSummary();

    elements.modifierText.textContent =
      state.lastModifiedBy
        ? `마지막 수정: ${state.lastModifiedBy}`
        : "";

    setDirty(
      state.dirty
    );
  }

  function findRow(
    no
  ) {
    return state.rows.find(
      row =>
        row.no ===
        Number(no)
    );
  }

  function updateStatus(
    no,
    nextStatus
  ) {
    const row =
      findRow(no);

    if (!row) {
      return;
    }

    const normalized =
      normalizeStatus(
        nextStatus
      );

    if (
      row.status ===
      normalized
    ) {
      return;
    }

    row.status =
      normalized;

    if (normalized) {
      row.changeDate =
        management.todayDate();
    }

    setDirty(true);
    render();
  }

  function updateDate(
    no,
    value
  ) {
    const row =
      findRow(no);

    if (!row) {
      return;
    }

    const nextValue =
      String(value || "")
        .slice(0, 10);

    if (
      row.changeDate ===
      nextValue
    ) {
      return;
    }

    row.changeDate =
      nextValue;

    setDirty(true);
  }

  function updateNote(
    no,
    value
  ) {
    const row =
      findRow(no);

    if (!row) {
      return;
    }

    const nextValue =
      String(value || "")
        .slice(0, 1000);

    if (
      row.note ===
      nextValue
    ) {
      return;
    }

    row.note =
      nextValue;

    setDirty(true);
  }

  async function loadDocument() {
    setLoading(true);

    elements.statusText.textContent =
      "불러오는 중";

    try {
      const response =
        await fetch(
          `${API_URL}?unit=${encodeURIComponent(state.unit)}`,
          {
            method: "GET",
            headers:
              management.getAuthHeaders()
          }
        );

      const payload =
        await management.parseJsonResponse(
          response
        );

      if (!response.ok) {
        throw new Error(
          payload?.message ||
          "맨홀 개폐관리 데이터를 불러오지 못했습니다."
        );
      }

      state.version =
        Number(
          payload?.version
        ) || 0;

      state.rows =
        mergeStoredRows(
          payload?.content?.rows
        );

      state.lastModifiedBy =
        String(
          payload?.lastModifiedBy ||
          ""
        );

      state.updatedAt =
        String(
          payload?.updatedAt ||
          ""
        );

      state.dirty = false;

      render();

    } catch (error) {
      console.error(
        "맨홀 개폐관리 조회 오류:",
        error
      );

      state.version = 0;
      state.rows =
        cloneMasterRows();
      state.lastModifiedBy = "";
      state.updatedAt = "";
      state.dirty = false;

      render();

      management.showToast(
        error?.message ||
        "데이터를 불러오지 못했습니다.",
        "error"
      );

    } finally {
      setLoading(false);
    }
  }

  function createSaveRows() {
    return state.rows.map(
      row => ({
        no: row.no,
        status: row.status,
        changeDate:
          row.changeDate,
        note:
          row.note
      })
    );
  }

  async function saveDocument() {
    if (state.loading) {
      return;
    }

    const token =
      management.getSessionToken();

    if (!token) {
      management.showToast(
        "로그인 정보가 없어 저장할 수 없습니다.",
        "error"
      );
      return;
    }

    setLoading(true);

    try {
      const response =
        await fetch(
          API_URL,
          {
            method: "PUT",
            headers:
              management.getAuthHeaders({
                "Content-Type":
                  "application/json"
              }),
            body:
              JSON.stringify({
                unit:
                  state.unit,
                version:
                  state.version,
                content: {
                  rows:
                    createSaveRows()
                }
              })
          }
        );

      const payload =
        await management.parseJsonResponse(
          response
        );

      if (
        response.status === 409
      ) {
        const shouldReload =
          window.confirm(
            "다른 사용자가 먼저 수정했습니다. 최신 내용을 다시 불러올까요?"
          );

        if (shouldReload) {
          await loadDocument();
        }

        return;
      }

      if (!response.ok) {
        throw new Error(
          payload?.message ||
          "맨홀 개폐관리 저장에 실패했습니다."
        );
      }

      state.version =
        Number(
          payload?.version
        ) ||
        state.version + 1;

      state.lastModifiedBy =
        String(
          payload?.lastModifiedBy ||
          management.getUserName() ||
          ""
        );

      state.updatedAt =
        String(
          payload?.updatedAt ||
          ""
        );

      setDirty(false);
      render();

      management.showToast(
        `${state.unit}호기 맨홀 개폐상태를 저장했습니다.`,
        "success"
      );

    } catch (error) {
      console.error(
        "맨홀 개폐관리 저장 오류:",
        error
      );

      management.showToast(
        error?.message ||
        "저장에 실패했습니다.",
        "error"
      );

    } finally {
      setLoading(false);
    }
  }

  async function changeUnit(
    unit
  ) {
    const nextUnit =
      unit === "2"
        ? "2"
        : "1";

    if (
      nextUnit ===
      state.unit
    ) {
      return;
    }

    if (
      state.dirty &&
      !window.confirm(
        "저장하지 않은 변경사항이 있습니다. 호기를 변경할까요?"
      )
    ) {
      return;
    }

    state.unit =
      nextUnit;

    state.version = 0;
    state.rows = [];
    state.dirty = false;

    await loadDocument();
  }

  document.addEventListener(
    "change",
    event => {
      const unitButton =
        event.target.closest?.(
          "[data-manhole-unit]"
        );

      if (unitButton) {
        return;
      }

      const statusSelect =
        event.target.closest?.(
          "[data-manhole-status-select]"
        );

      if (statusSelect) {
        updateStatus(
          statusSelect.dataset
            .manholeStatusSelect,
          statusSelect.value
        );
        return;
      }

      const dateInput =
        event.target.closest?.(
          "[data-manhole-date]"
        );

      if (dateInput) {
        updateDate(
          dateInput.dataset
            .manholeDate,
          dateInput.value
        );
      }
    }
  );

  document.addEventListener(
    "input",
    event => {
      const noteInput =
        event.target.closest?.(
          "[data-manhole-note]"
        );

      if (!noteInput) {
        return;
      }

      updateNote(
        noteInput.dataset
          .manholeNote,
        noteInput.value
      );
    }
  );

  elements.tableBody
    ?.addEventListener(
      "pointerover",
      event => {
        const row =
          event.target.closest?.(
            "[data-manhole-row]"
          );

        if (!row) {
          return;
        }

        setDiagramRowHighlight(
          row.dataset.manholeRow,
          true
        );
      }
    );

  elements.tableBody
    ?.addEventListener(
      "pointerout",
      event => {
        const row =
          event.target.closest?.(
            "[data-manhole-row]"
          );

        if (!row) {
          return;
        }

        if (
          row.contains(
            event.relatedTarget
          )
        ) {
          return;
        }

        setDiagramRowHighlight(
          row.dataset.manholeRow,
          false
        );
      }
    );

  elements.tableBody
    ?.addEventListener(
      "focusin",
      event => {
        const row =
          event.target.closest?.(
            "[data-manhole-row]"
          );

        if (row) {
          setDiagramRowHighlight(
            row.dataset.manholeRow,
            true
          );
        }
      }
    );

  elements.tableBody
    ?.addEventListener(
      "focusout",
      event => {
        const row =
          event.target.closest?.(
            "[data-manhole-row]"
          );

        if (!row) {
          return;
        }

        if (
          row.contains(
            event.relatedTarget
          )
        ) {
          return;
        }

        setDiagramRowHighlight(
          row.dataset.manholeRow,
          false
        );
      }
    );

  document
    .querySelectorAll(
      "[data-manhole-unit]"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          () => {
            changeUnit(
              button.dataset
                .manholeUnit
            );
          }
        );
      }
    );

  elements.reloadButton
    ?.addEventListener(
      "click",
      async () => {
        if (
          state.dirty &&
          !window.confirm(
            "저장하지 않은 변경사항을 버리고 다시 불러올까요?"
          )
        ) {
          return;
        }

        await loadDocument();
      }
    );

  elements.saveButton
    ?.addEventListener(
      "click",
      saveDocument
    );

  elements.homeButton
    ?.addEventListener(
      "click",
      () => {
        window.location.href =
          "/";
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

  const hasToken =
    Boolean(
      management.getSessionToken()
    );

  elements.authWarning.hidden =
    hasToken;

  state.rows =
    cloneMasterRows();

  render();
  loadDocument();
})();
