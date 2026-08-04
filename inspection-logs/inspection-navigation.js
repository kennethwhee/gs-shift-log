"use strict";

/* =========================================================
  점검일지 왼쪽 메뉴 + 점검주기표 + 표 안 직접 편집
========================================================= */

function initializeInspectionWorkspaceNavigation() {
  if (
    window.__gsInspectionWorkspaceNavigationStarted ===
      true
  ) {
    return;
  }


  const hub =
    document.querySelector(
      ".inspection-log-hub"
    );

  const dashboard =
    document.getElementById(
      "inspectionScheduleDashboard"
    );

  const tabNavigation =
    document.querySelector(
      ".inspection-log-tabs"
    );

  const logList =
    document.getElementById(
      "inspectionLogList"
    );

  const viewer =
    document.getElementById(
      "inspectionLogViewer"
    );

  const viewerFrame =
    document.getElementById(
      "inspectionLogFrame"
    );

  const backButton =
    document.getElementById(
      "inspectionLogBackButton"
    );

  const oldManageButton =
    document.getElementById(
      "inspectionScheduleManageButton"
    );

  const oldManagerModal =
    document.getElementById(
      "inspectionScheduleManagerModal"
    );

  const logCards = [
    ...document.querySelectorAll(
      "[data-inspection-category-item]"
    )
  ];

  const categoryTabButtons = [
    ...document.querySelectorAll(
      "[data-inspection-category]"
    )
  ];


  if (
    !hub ||
    !dashboard ||
    !tabNavigation ||
    !logList ||
    !viewer
  ) {
    console.error(
      "점검일지 왼쪽 메뉴를 구성할 필수 요소가 없습니다."
    );

    return;
  }


  window.__gsInspectionWorkspaceNavigationStarted =
    true;


  const canManage =
    typeof inspectionScheduleOverrideState !==
      "undefined" &&
    inspectionScheduleOverrideState.canManage ===
      true;


  const SCHEDULE_API_URL =
    typeof INSPECTION_SCHEDULE_API_URL !==
      "undefined"
      ? INSPECTION_SCHEDULE_API_URL
      : "/api/inspection-schedules";


  const VIEW_STORAGE_KEY =
    "gsShiftLog.inspectionWorkspace.view.v1";


  let activeEditorId =
    "";

  let activeTableCategory =
    "";

  let managerBusy =
    false;


  /* =====================================================
    기존 별도 관리 버튼·팝업 제거

    점검 일정 관리는 점검주기표 행 안에서만 수행한다.
  ====================================================== */

  oldManageButton?.remove();

  oldManagerModal?.remove();


  /* =====================================================
    작업 화면 기본 구조
  ====================================================== */

  const workspace =
    document.createElement(
      "div"
    );

  workspace.className =
    "inspection-workspace";


  const sidebar =
    document.createElement(
      "aside"
    );

  sidebar.className =
    "inspection-sidebar";

  sidebar.setAttribute(
    "aria-label",
    "점검일지 메뉴"
  );

  sidebar.innerHTML = `
    <div class="inspection-sidebar__intro">
      <strong>점검일지 메뉴</strong>
      <span>점검주기와 등록된 점검일지를 선택합니다.</span>
    </div>

    <details class="inspection-sidebar-group">
      <summary>점검주기</summary>

      <div class="inspection-sidebar-submenu">
        <button
          type="button"
          data-inspection-sidebar-view="calendar"
        >
          월간 달력
        </button>

        <button
          type="button"
          data-inspection-sidebar-view="schedule-table"
          data-inspection-schedule-category=""
        >
          전체 점검표
        </button>

        <button
          type="button"
          data-inspection-sidebar-view="schedule-table"
          data-inspection-schedule-category="daily"
        >
          일간 점검주기
        </button>

        <button
          type="button"
          data-inspection-sidebar-view="schedule-table"
          data-inspection-schedule-category="weekly"
        >
          주간 점검주기
        </button>

        <button
          type="button"
          data-inspection-sidebar-view="schedule-table"
          data-inspection-schedule-category="monthly"
        >
          월간 점검주기
        </button>

        <button
          type="button"
          data-inspection-sidebar-view="schedule-table"
          data-inspection-schedule-category="quarterly"
        >
          분기 점검주기
        </button>

        <button
          type="button"
          data-inspection-sidebar-view="schedule-table"
          data-inspection-schedule-category="other"
        >
          기타 점검주기
        </button>
      </div>
    </details>

    <details class="inspection-sidebar-group">
      <summary>일일점검</summary>

      <div class="inspection-sidebar-submenu">
        <button
          type="button"
          data-inspection-sidebar-log="night-patrol"
        >
          야간 순찰 점검일지
        </button>
      </div>
    </details>

    <details class="inspection-sidebar-group">
      <summary>주간점검</summary>

      <div class="inspection-sidebar-submenu">
        <button
          type="button"
          data-inspection-sidebar-log="high-pressure-gas"
        >
          고압가스 저장시설 주간점검표
        </button>

        <button
          type="button"
          data-inspection-sidebar-log="lng-weekly"
        >
          LNG System 주간점검 일지
        </button>

        <button
          type="button"
          data-inspection-sidebar-log="soot-blower-weekly"
        >
          Soot Blower 주간점검일지
        </button>
      </div>
    </details>

    <details class="inspection-sidebar-group">
      <summary>월간점검</summary>

      <div class="inspection-sidebar-submenu">
        <span class="inspection-sidebar-empty">
          등록된 월간 점검일지가 없습니다.
        </span>
      </div>
    </details>
  `;


  const content =
    document.createElement(
      "section"
    );

  content.className =
    "inspection-workspace__content";


  const tablePanel =
    document.createElement(
      "section"
    );

  tablePanel.className =
    "inspection-schedule-table-panel";

  tablePanel.id =
    "inspectionScheduleTablePanel";

  tablePanel.hidden =
    true;


  const managerColumnHtml =
    canManage
      ? `
          <col class="inspection-schedule-table-col-manage">
        `
      : "";


  const managerHeaderHtml =
    canManage
      ? `
          <th rowspan="2">관리</th>
        `
      : "";


  const newButtonHtml =
    canManage
      ? `
          <button
            type="button"
            class="inspection-schedule-table-new-button"
            id="inspectionScheduleTableNewButton"
          >
            + 새 일정
          </button>
        `
      : "";


  tablePanel.innerHTML = `
    <header class="inspection-schedule-table-header">
      <div class="inspection-schedule-table-header__title">
        <p>INSPECTION SCHEDULE LIST</p>

        <h2 id="inspectionScheduleTableTitle">
          설비점검 및 회전기기 교체운전 List 및 주기
        </h2>
      </div>

      <div class="inspection-schedule-table-header__actions">
        <span id="inspectionScheduleTableSummary">
          전체 점검주기
        </span>

        ${newButtonHtml}
      </div>
    </header>

    <div
      class="inspection-schedule-table-message"
      id="inspectionScheduleTableMessage"
      hidden
    ></div>

    <div class="inspection-schedule-table-scroll">
      <table class="inspection-schedule-table">
        <colgroup>
          <col>
          <col>
          <col>
          <col>
          <col>
          <col>
          <col>
          <col>
          <col>
          ${managerColumnHtml}
        </colgroup>

        <thead>
          <tr>
            <th rowspan="2">구분</th>
            <th rowspan="2">점검 주기</th>
            <th colspan="2">Shift</th>
            <th rowspan="2">점검사항</th>
            <th rowspan="2">담당<br>Position</th>
            <th rowspan="2">결재</th>
            <th rowspan="2">공유</th>
            <th rowspan="2">비고</th>
            ${managerHeaderHtml}
          </tr>

          <tr>
            <th>D/S</th>
            <th>N/S</th>
          </tr>
        </thead>

        <tbody id="inspectionScheduleTableBody"></tbody>
      </table>
    </div>

    <p class="inspection-schedule-table-footnote">
      * 월간 점검기준 첫주는 1일이 금요일 포함 시 첫주 적용
    </p>
  `;


  const registry =
    document.createElement(
      "div"
    );

  registry.className =
    "inspection-log-source-registry";

  registry.append(
    tabNavigation,
    logList
  );


  content.append(
    dashboard,
    tablePanel,
    registry,
    viewer
  );


  workspace.append(
    sidebar,
    content
  );


  hub.appendChild(
    workspace
  );


  const tableBody =
    document.getElementById(
      "inspectionScheduleTableBody"
    );

  const tableTitle =
    document.getElementById(
      "inspectionScheduleTableTitle"
    );

  const tableSummary =
    document.getElementById(
      "inspectionScheduleTableSummary"
    );

  const tableMessage =
    document.getElementById(
      "inspectionScheduleTableMessage"
    );

  const newScheduleButton =
    document.getElementById(
      "inspectionScheduleTableNewButton"
    );

  const viewButtons = [
    ...sidebar.querySelectorAll(
      "[data-inspection-sidebar-view]"
    )
  ];

  const logButtons = [
    ...sidebar.querySelectorAll(
      "[data-inspection-sidebar-log]"
    )
  ];


  const categoryLabels = {
    daily:
      "일간",

    weekly:
      "주간",

    monthly:
      "월간",

    quarterly:
      "분기",

    other:
      "기타"
  };


  const assignedRoleOptions = [
    {
      value:
        "파트장",

      label:
        "파트장"
    },

    {
      value:
        "TGO",

      label:
        "TGO"
    },

    {
      value:
        "BCO1",

      label:
        "BCO1"
    },

    {
      value:
        "BCO2",

      label:
        "BCO2"
    },

    {
      value:
        "TO",

      label:
        "TO"
    },

    {
      value:
        "BO1",

      label:
        "BO1"
    },

    {
      value:
        "BO2",

      label:
        "BO2"
    }
  ];


  const assignedRoleOrder =
    assignedRoleOptions.map(
      option => {
        return option.value;
      }
    );


  /* =====================================================
    공통 처리
  ====================================================== */

  function escapeHtml(
    value
  ) {
    return String(
      value ??
      ""
    )
      .replaceAll(
        "&",
        "&amp;"
      )
      .replaceAll(
        "<",
        "&lt;"
      )
      .replaceAll(
        ">",
        "&gt;"
      )
      .replaceAll(
        '"',
        "&quot;"
      )
      .replaceAll(
        "'",
        "&#039;"
      );
  }


  function cloneItem(
    value
  ) {
    try {
      return JSON.parse(
        JSON.stringify(
          value ||
          {}
        )
      );

    } catch {
      return {};
    }
  }


  function setTableMessage(
    message = "",
    state = "info"
  ) {
    if (
      !tableMessage
    ) {
      return;
    }


    const normalizedMessage =
      String(
        message ||
        ""
      ).trim();


    tableMessage.hidden =
      !normalizedMessage;

    tableMessage.textContent =
      normalizedMessage;

    tableMessage.dataset.state =
      state;
  }


  function setActiveButton(
    targetButton
  ) {
    [
      ...viewButtons,
      ...logButtons
    ].forEach(
      button => {
        const active =
          button ===
          targetButton;


        button.classList.toggle(
          "is-active",
          active
        );

        button.setAttribute(
          "aria-current",
          active
            ? "page"
            : "false"
        );
      }
    );
  }


  function saveLastView(
    view,
    category = ""
  ) {
    try {
      window.sessionStorage.setItem(
        VIEW_STORAGE_KEY,
        JSON.stringify({
          view,
          category
        })
      );

    } catch {
      /* 저장 실패는 화면 동작에 영향 없음 */
    }
  }


  function readLastView() {
    try {
      const savedText =
        window.sessionStorage.getItem(
          VIEW_STORAGE_KEY
        );

      const savedValue =
        savedText
          ? JSON.parse(
              savedText
            )
          : null;


      return (
        savedValue &&
        typeof savedValue ===
          "object"
      )
        ? savedValue
        : null;

    } catch {
      return null;
    }
  }


  function hideViewer() {
    viewer.hidden =
      true;


    if (
      viewerFrame
    ) {
      viewerFrame.src =
        "about:blank";
    }
  }


  function getManagerItems() {
    if (
      canManage &&
      typeof buildInspectionScheduleManagerItems ===
        "function"
    ) {
      return buildInspectionScheduleManagerItems();
    }


    return INSPECTION_SCHEDULE_MASTER.map(
      (
        item,
        index
      ) => {
        return {
          ...cloneItem(
            item
          ),

          isActive:
            true,

          isCustom:
            false,

          hasOverride:
            false,

          revision:
            0,

          sortIndex:
            index
        };
      }
    );
  }


  function getLinkedCard(
    scheduleItem
  ) {
    const logKey =
      String(
        scheduleItem?.logKey ||
        ""
      ).trim();


    if (
      logKey
    ) {
      const exactCard =
        logCards.find(
          card => {
            return (
              String(
                card.dataset.inspectionLog ||
                ""
              ).trim() ===
              logKey
            );
          }
        );


      if (
        exactCard
      ) {
        return exactCard;
      }
    }


    const keyword =
      String(
        scheduleItem?.titleKeyword ||
        ""
      )
        .trim()
        .toLowerCase();


    if (
      !keyword
    ) {
      return null;
    }


    return (
      logCards.find(
        card => {
          const title =
            String(
              card.querySelector(
                ".inspection-log-card__text strong"
              )?.textContent ||
              ""
            )
              .trim()
              .toLowerCase();


          return title.includes(
            keyword
          );
        }
      ) ||
      null
    );
  }


  function openLogCard(
    card,
    sourceButton = null
  ) {
    if (
      !card
    ) {
      window.alert(
        "연결된 점검일지가 없습니다."
      );

      return;
    }


    const category =
      String(
        card.dataset.inspectionCategoryItem ||
        "daily"
      ).trim();


    const categoryTabButton =
      categoryTabButtons.find(
        button => {
          return (
            String(
              button.dataset.inspectionCategory ||
              ""
            ).trim() ===
            category
          );
        }
      ) ||
      null;


    const logKey =
      String(
        card.dataset.inspectionLog ||
        ""
      ).trim();


    const effectiveSourceButton =
      sourceButton ||
      logButtons.find(
        button => {
          return (
            String(
              button.dataset.inspectionSidebarLog ||
              ""
            ).trim() ===
            logKey
          );
        }
      ) ||
      null;


    tablePanel.hidden =
      true;

    dashboard.hidden =
      true;


    if (
      effectiveSourceButton
    ) {
      setActiveButton(
        effectiveSourceButton
      );
    }


    categoryTabButton?.click();


    window.requestAnimationFrame(
      () => {
        tablePanel.hidden =
          true;

        dashboard.hidden =
          true;

        card.click();
      }
    );
  }


  /* =====================================================
    API
  ====================================================== */

  function getScheduleApiHeaders(
    extraHeaders = {}
  ) {
    if (
      typeof getInspectionScheduleAuthHeaders ===
        "function"
    ) {
      return getInspectionScheduleAuthHeaders(
        extraHeaders
      );
    }


    let token =
      "";


    try {
      const savedUser =
        window.localStorage.getItem(
          "gsShiftLog.currentUser"
        );

      const currentUser =
        savedUser
          ? JSON.parse(
              savedUser
            )
          : null;


      token =
        String(
          currentUser?.sessionToken ||
          currentUser?.session_token ||
          ""
        ).trim();

    } catch {
      token =
        "";
    }


    return {
      Accept:
        "application/json",

      ...extraHeaders,

      ...(
        token
          ? {
              Authorization:
                `Bearer ${token}`
            }
          : {}
      )
    };
  }


  async function readScheduleApiResponse(
    response
  ) {
    if (
      typeof readInspectionScheduleApiResponse ===
        "function"
    ) {
      return readInspectionScheduleApiResponse(
        response
      );
    }


    const text =
      await response.text();


    let result =
      {};


    if (
      text.trim()
    ) {
      try {
        result =
          JSON.parse(
            text
          );

      } catch {
        throw new Error(
          "점검 일정 서버 응답 형식이 올바르지 않습니다."
        );
      }
    }


    if (
      !response.ok ||
      result.ok ===
        false
    ) {
      throw new Error(
        result.message ||
        result.error ||
        `점검 일정 요청에 실패했습니다. (HTTP ${response.status})`
      );
    }


    return result;
  }


  /* =====================================================
    편집 폼 HTML
  ====================================================== */

  function createNumberChecksHtml(
    type,
    values,
    options
  ) {
    const selectedValues =
      new Set(
        (
          Array.isArray(
            values
          )
            ? values
            : []
        ).map(
          value => {
            return String(
              value
            );
          }
        )
      );


    return options.map(
      option => {
        const value =
          String(
            option.value
          );


        return `
          <label class="inspection-schedule-inline-check">
            <input
              type="checkbox"
              data-inline-${escapeHtml(type)}
              value="${escapeHtml(value)}"
              ${selectedValues.has(value) ? "checked" : ""}
            >

            <span>${escapeHtml(option.label)}</span>
          </label>
        `;
      }
    ).join(
      ""
    );
  }


  function createInlineTitleEditorHtml(
    item,
    isNew
  ) {
    const rule =
      item?.rule &&
      typeof item.rule ===
        "object"
        ? item.rule
        : {};


    const dayOptions = [
      { value: 0, label: "일" },
      { value: 1, label: "월" },
      { value: 2, label: "화" },
      { value: 3, label: "수" },
      { value: 4, label: "목" },
      { value: 5, label: "금" },
      { value: 6, label: "토" }
    ];


    const weekOptions = [
      { value: 1, label: "1주" },
      { value: 2, label: "2주" },
      { value: 3, label: "3주" },
      { value: 4, label: "4주" },
      { value: 5, label: "5주" }
    ];


    const monthOptions =
      Array.from(
        {
          length:
            12
        },
        (
          unused,
          index
        ) => {
          return {
            value:
              index +
              1,

            label:
              `${index + 1}월`
          };
        }
      );


    return `
      <input
        type="text"
        class="inspection-schedule-inline-input is-title"
        data-inline-title
        value="${escapeHtml(item.title || "")}"
        maxlength="300"
        placeholder="점검사항"
      >

      <details class="inspection-schedule-inline-advanced" open>
        <summary>
          세부 일정 설정
        </summary>

        <div class="inspection-schedule-inline-advanced__grid">
          <label>
            <span>일정 ID</span>

            <input
              type="text"
              data-inline-id
              value="${escapeHtml(item.id || "")}"
              maxlength="120"
              ${isNew ? "" : "readonly"}
              placeholder="weekly-equipment-check"
            >
          </label>

          <label>
            <span>구분</span>

            <select data-inline-category>
              <option value="daily" ${item.category === "daily" ? "selected" : ""}>일간</option>
              <option value="weekly" ${item.category === "weekly" ? "selected" : ""}>주간</option>
              <option value="monthly" ${item.category === "monthly" ? "selected" : ""}>월간</option>
              <option value="quarterly" ${item.category === "quarterly" ? "selected" : ""}>분기</option>
              <option value="other" ${item.category === "other" ? "selected" : ""}>기타</option>
            </select>
          </label>

          <label>
            <span>일정 계산 유형</span>

            <select data-inline-rule-type>
              <option value="daily" ${rule.type === "daily" ? "selected" : ""}>매일</option>
              <option value="weekdays" ${rule.type === "weekdays" ? "selected" : ""}>지정 요일 반복</option>
              <option value="weekly" ${rule.type === "weekly" ? "selected" : ""}>매주 지정 요일</option>
              <option value="monthlyDate" ${rule.type === "monthlyDate" ? "selected" : ""}>매월 지정일</option>
              <option value="monthlyWeek" ${rule.type === "monthlyWeek" ? "selected" : ""}>매월 지정 주차·요일</option>
              <option value="monthlyFloating" ${rule.type === "monthlyFloating" ? "selected" : ""}>월간 유동 일정</option>
              <option value="adHoc" ${rule.type === "adHoc" ? "selected" : ""}>수시·조건부</option>
            </select>
          </label>

          <label>
            <span>매월 지정일</span>

            <input
              type="number"
              data-inline-rule-day
              min="1"
              max="31"
              value="${rule.day !== undefined && rule.day !== null && rule.day !== "" && Number.isInteger(Number(rule.day)) ? escapeHtml(Number(rule.day)) : ""}"
              placeholder="1~31"
            >
          </label>

          <label>
            <span>연결 점검일지 키</span>

            <input
              type="text"
              data-inline-log-key
              value="${escapeHtml(item.logKey || "")}"
              maxlength="120"
              placeholder="예: lng-weekly"
            >
          </label>

          <label>
            <span>제목 검색어</span>

            <input
              type="text"
              data-inline-title-keyword
              value="${escapeHtml(item.titleKeyword || "")}"
              maxlength="120"
              placeholder="점검일지 연결 검색어"
            >
          </label>
        </div>

        <div class="inspection-schedule-inline-option-row">
          <strong>적용 요일</strong>

          <div>
            ${createNumberChecksHtml("day", rule.days, dayOptions)}
          </div>
        </div>

        <div class="inspection-schedule-inline-option-row">
          <strong>적용 주차</strong>

          <div>
            ${createNumberChecksHtml("week", rule.weeks, weekOptions)}
          </div>
        </div>

        <div class="inspection-schedule-inline-option-row">
          <strong>적용 월</strong>

          <div class="is-months">
            ${createNumberChecksHtml("month", rule.months, monthOptions)}
          </div>
        </div>

        <div class="inspection-schedule-inline-option-row is-assigned-roles">
          <strong>담당 보직</strong>

          <div class="is-roles">
            ${createNumberChecksHtml(
              "role",
              item.assignedRoles,
              assignedRoleOptions
            )}
          </div>

          <small>
            선택한 보직 카드에 오늘 점검 버튼과 완료 현황이 자동 표시됩니다.
          </small>
        </div>

        <div class="inspection-schedule-inline-option-row">
          <strong>일정 설정</strong>

          <div>
            <label class="inspection-schedule-inline-check">
              <input
                type="checkbox"
                data-inline-active
                ${item.isActive !== false ? "checked" : ""}
              >

              <span>일정 사용</span>
            </label>

            <label class="inspection-schedule-inline-check">
              <input
                type="checkbox"
                data-inline-conditional
                ${item.conditional === true ? "checked" : ""}
              >

              <span>조건부</span>
            </label>

            <label class="inspection-schedule-inline-check">
              <input
                type="checkbox"
                data-inline-reference
                ${item.referenceOnly === true ? "checked" : ""}
              >

              <span>참고용</span>
            </label>
          </div>
        </div>
      </details>
    `;
  }


  function createInlineManageButtonsHtml(
    item,
    isNew
  ) {
    const revision =
      Number(
        item.revision
      ) ||
      0;


    const restoreOrDeleteHtml =
      !isNew &&
      revision >
        0
        ? `
            <button
              type="button"
              class="inspection-schedule-inline-delete-button"
              data-inline-delete
            >
              ${item.isCustom === true ? "삭제" : "기본값 복원"}
            </button>
          `
        : "";


    return `
      <div class="inspection-schedule-inline-manage-buttons">
        <button
          type="button"
          class="inspection-schedule-inline-save-button"
          data-inline-save
        >
          저장
        </button>

        <button
          type="button"
          class="inspection-schedule-inline-cancel-button"
          data-inline-cancel
        >
          취소
        </button>

        ${restoreOrDeleteHtml}
      </div>
    `;
  }


  function createEditorRowHtml(
    item,
    options = {}
  ) {
    const isNew =
      options.isNew ===
      true;


    const categoryCellMode =
      String(
        options.categoryCellMode ||
        "single"
      );


    const categoryRowspan =
      Math.max(
        1,
        Number(
          options.categoryRowspan
        ) ||
        1
      );


    const shifts =
      Array.isArray(
        item.shifts
      )
        ? item.shifts
        : [];


    const categoryText =
      isNew
        ? "신규"
        : categoryLabels[
            item.category
          ] ||
          "기타";


    const categoryCellHtml =
      categoryCellMode ===
        "none"
        ? ""
        : `
            <th
              class="inspection-schedule-table-category"
              ${categoryCellMode === "rowspan" ? `rowspan="${categoryRowspan}"` : ""}
            >
              ${escapeHtml(categoryText)}
            </th>
          `;


    return `
      <tr
        class="inspection-schedule-table-editor-row"
        data-inline-editor-id="${escapeHtml(isNew ? "__new__" : item.id)}"
        data-inline-revision="${escapeHtml(Number(item.revision) || 0)}"
        data-inline-is-custom="${item.isCustom === true || isNew ? "true" : "false"}"
      >
        ${categoryCellHtml}

        <td>
          <input
            type="text"
            class="inspection-schedule-inline-input"
            data-inline-schedule-label
            value="${escapeHtml(item.scheduleLabel || "")}"
            maxlength="160"
            placeholder="점검 주기"
          >
        </td>

        <td class="inspection-schedule-table-shift">
          <label class="inspection-schedule-inline-shift-check">
            <input
              type="checkbox"
              data-inline-shift-ds
              ${shifts.includes("D/S") ? "checked" : ""}
            >

            <span>D/S</span>
          </label>
        </td>

        <td class="inspection-schedule-table-shift">
          <label class="inspection-schedule-inline-shift-check">
            <input
              type="checkbox"
              data-inline-shift-ns
              ${shifts.includes("N/S") ? "checked" : ""}
            >

            <span>N/S</span>
          </label>
        </td>

        <td class="inspection-schedule-table-title-cell is-editing">
          ${createInlineTitleEditorHtml(item, isNew)}
        </td>

        <td>
          <input
            type="text"
            class="inspection-schedule-inline-input"
            data-inline-position
            value="${escapeHtml(item.position || "")}"
            maxlength="200"
            placeholder="Position"
          >
        </td>

        <td>
          <input
            type="text"
            class="inspection-schedule-inline-input"
            data-inline-approval
            value="${escapeHtml(item.approval || "")}"
            maxlength="200"
            placeholder="결재"
          >
        </td>

        <td>
          <input
            type="text"
            class="inspection-schedule-inline-input"
            data-inline-share
            value="${escapeHtml(item.share || "")}"
            maxlength="200"
            placeholder="공유"
          >
        </td>

        <td>
          <textarea
            class="inspection-schedule-inline-textarea"
            data-inline-note
            maxlength="1000"
            placeholder="비고"
          >${escapeHtml(item.note || "")}</textarea>
        </td>

        <td class="inspection-schedule-table-manage-cell">
          ${createInlineManageButtonsHtml(item, isNew)}
        </td>
      </tr>
    `;
  }


  /* =====================================================
    점검주기표 출력
  ====================================================== */

  function createStateBadgeHtml(
    item
  ) {
    if (
      item.isActive ===
        false
    ) {
      return `
        <span class="inspection-schedule-table-state is-inactive">
          사용 중지
        </span>
      `;
    }


    if (
      item.isCustom ===
        true
    ) {
      return `
        <span class="inspection-schedule-table-state is-custom">
          추가 일정
        </span>
      `;
    }


    if (
      item.hasOverride ===
        true
    ) {
      return `
        <span class="inspection-schedule-table-state is-edited">
          수정됨
        </span>
      `;
    }


    return "";
  }


  function renderScheduleTable(
    category = ""
  ) {
    activeTableCategory =
      String(
        category ||
        ""
      ).trim();


    const allItems =
      getManagerItems();


    const items =
      allItems.filter(
        item => {
          return (
            !activeTableCategory ||
            item.category ===
              activeTableCategory
          );
        }
      );


    if (
      tableTitle
    ) {
      tableTitle.textContent =
        activeTableCategory
          ? `${categoryLabels[activeTableCategory] || "기타"} 점검주기`
          : "설비점검 및 회전기기 교체운전 List 및 주기";
    }


    if (
      tableSummary
    ) {
      tableSummary.textContent =
        activeTableCategory
          ? `${categoryLabels[activeTableCategory] || "기타"} 항목 ${items.length}건`
          : `전체 점검주기 ${items.length}건`;
    }


    if (
      !items.length &&
      activeEditorId !==
        "__new__"
    ) {
      tableBody.innerHTML = `
        <tr>
          <td
            colspan="${canManage ? 10 : 9}"
            class="inspection-schedule-table-empty"
          >
            표시할 점검주기가 없습니다.
          </td>
        </tr>
      `;

      return;
    }


    const groupedItems =
      new Map();


    items.forEach(
      item => {
        const categoryKey =
          String(
            item.category ||
            "other"
          );


        if (
          !groupedItems.has(
            categoryKey
          )
        ) {
          groupedItems.set(
            categoryKey,
            []
          );
        }


        groupedItems.get(
          categoryKey
        ).push(
          item
        );
      }
    );


    const rows =
      [];


    if (
      canManage &&
      activeEditorId ===
        "__new__"
    ) {
      rows.push(
        createEditorRowHtml(
          {
            id:
              "",

            category:
              activeTableCategory ||
              "weekly",

            title:
              "",

            scheduleLabel:
              "",

            shifts: [
              "D/S"
            ],

            assignedRoles:
              [],

            position:
              "Local",

            approval:
              "-",

            share:
              "-",

            note:
              "",

            isActive:
              true,

            isCustom:
              true,

            revision:
              0,

            rule: {
              type:
                activeTableCategory ===
                  "daily"
                  ? "daily"
                  : "weekly",

              days: [
                0
              ]
            }
          },
          {
            isNew:
              true
          }
        )
      );
    }


    groupedItems.forEach(
      (
        groupItems,
        categoryKey
      ) => {
        groupItems.forEach(
          (
            item,
            itemIndex
          ) => {
            const editing =
              canManage &&
              activeEditorId ===
                item.id;


            if (
              editing
            ) {
              rows.push(
                createEditorRowHtml(
                  item,
                  {
                    categoryCellMode:
                      itemIndex ===
                        0
                        ? "rowspan"
                        : "none",

                    categoryRowspan:
                      groupItems.length
                  }
                )
              );

              return;
            }


            const linkedCard =
              getLinkedCard(
                item
              );


            const shifts =
              Array.isArray(
                item.shifts
              )
                ? item.shifts
                : [];


            const assignedRoles =
              assignedRoleOrder.filter(
                role => {
                  return Array.isArray(
                    item.assignedRoles
                  ) &&
                  item.assignedRoles.includes(
                    role
                  );
                }
              );


            const rowClasses = [
              item.conditional ===
                true
                ? "is-conditional"
                : "",

              item.referenceOnly ===
                true
                ? "is-reference"
                : "",

              item.isActive ===
                false
                ? "is-inactive"
                : ""
            ]
              .filter(
                Boolean
              )
              .join(
                " "
              );


            const manageCellHtml =
              canManage
                ? `
                    <td class="inspection-schedule-table-manage-cell">
                      <button
                        type="button"
                        class="inspection-schedule-table-edit-button"
                        data-inspection-table-edit="${escapeHtml(item.id)}"
                      >
                        수정
                      </button>
                    </td>
                  `
                : "";


            rows.push(`
              <tr
                class="${rowClasses}"
                data-schedule-id="${escapeHtml(item.id)}"
              >
                ${itemIndex === 0 ? `
                  <th
                    scope="rowgroup"
                    class="inspection-schedule-table-category"
                    rowspan="${groupItems.length}"
                  >
                    ${escapeHtml(categoryLabels[categoryKey] || "기타")}
                  </th>
                ` : ""}

                <td class="inspection-schedule-table-cycle">
                  ${escapeHtml(item.scheduleLabel || "-")}
                </td>

                <td class="inspection-schedule-table-shift">
                  ${shifts.includes("D/S") ? "●" : ""}
                </td>

                <td class="inspection-schedule-table-shift">
                  ${shifts.includes("N/S") ? "●" : ""}
                </td>

                <td class="inspection-schedule-table-title-cell">
                  <div class="inspection-schedule-table-title-line">
                    <strong>${escapeHtml(item.title || "-")}</strong>
                    ${createStateBadgeHtml(item)}
                  </div>

                  <div
                    class="inspection-schedule-table-assigned-roles ${assignedRoles.length ? "" : "is-empty"}"
                  >
                    <span>담당</span>
                    <b>
                      ${escapeHtml(
                        assignedRoles.length
                          ? assignedRoles.join(" · ")
                          : "미지정"
                      )}
                    </b>
                  </div>

                  ${linkedCard ? `
                    <button
                      type="button"
                      class="inspection-schedule-table-log-button"
                      data-inspection-table-open-log="${escapeHtml(item.id)}"
                    >
                      점검일지 열기
                    </button>
                  ` : ""}
                </td>

                <td>${escapeHtml(item.position || "-")}</td>
                <td>${escapeHtml(item.approval || "-")}</td>
                <td>${escapeHtml(item.share || "-")}</td>

                <td class="inspection-schedule-table-note">
                  ${escapeHtml(item.note || "-")}
                </td>

                ${manageCellHtml}
              </tr>
            `);
          }
        );
      }
    );


    tableBody.innerHTML =
      rows.join(
        ""
      );


    if (
      activeEditorId
    ) {
      window.requestAnimationFrame(
        () => {
          [
            ...tableBody.querySelectorAll(
              "[data-inline-editor-id]"
            )
          ]
            .find(
              row => {
                return (
                  row.dataset.inlineEditorId ===
                  activeEditorId
                );
              }
            )
            ?.scrollIntoView({
              block:
                "nearest",

              behavior:
                "smooth"
            });
        }
      );
    }
  }


  /* =====================================================
    편집값 수집·검증
  ====================================================== */

  function getCheckedNumbers(
    row,
    selector
  ) {
    return [
      ...row.querySelectorAll(
        selector
      )
    ]
      .filter(
        input => {
          return input.checked;
        }
      )
      .map(
        input => {
          return Number(
            input.value
          );
        }
      )
      .filter(
        Number.isInteger
      );
  }


  function getCheckedStrings(
    row,
    selector
  ) {
    return [
      ...row.querySelectorAll(
        selector
      )
    ]
      .filter(
        input => {
          return input.checked;
        }
      )
      .map(
        input => {
          return String(
            input.value ||
            ""
          ).trim();
        }
      )
      .filter(
        Boolean
      );
  }


  function collectInlineEditorItem(
    row
  ) {
    const ruleType =
      String(
        row.querySelector(
          "[data-inline-rule-type]"
        )?.value ||
        "daily"
      ).trim();


    const rawDay =
      String(
        row.querySelector(
          "[data-inline-rule-day]"
        )?.value ||
        ""
      ).trim();


    const days =
      getCheckedNumbers(
        row,
        "[data-inline-day]"
      );


    const weeks =
      getCheckedNumbers(
        row,
        "[data-inline-week]"
      );


    const months =
      getCheckedNumbers(
        row,
        "[data-inline-month]"
      );


    const assignedRoles =
      assignedRoleOrder.filter(
        role => {
          return getCheckedStrings(
            row,
            "[data-inline-role]"
          ).includes(
            role
          );
        }
      );


    const rule = {
      type:
        ruleType
    };


    if (
      days.length
    ) {
      rule.days =
        days;
    }


    if (
      weeks.length
    ) {
      rule.weeks =
        weeks;
    }


    if (
      months.length
    ) {
      rule.months =
        months;
    }


    if (
      rawDay
    ) {
      rule.day =
        Number(
          rawDay
        );
    }


    const shifts =
      [];


    if (
      row.querySelector(
        "[data-inline-shift-ds]"
      )?.checked
    ) {
      shifts.push(
        "D/S"
      );
    }


    if (
      row.querySelector(
        "[data-inline-shift-ns]"
      )?.checked
    ) {
      shifts.push(
        "N/S"
      );
    }


    return {
      id:
        String(
          row.querySelector(
            "[data-inline-id]"
          )?.value ||
          ""
        )
          .trim()
          .toLowerCase(),

      category:
        String(
          row.querySelector(
            "[data-inline-category]"
          )?.value ||
          "weekly"
        ).trim(),

      title:
        String(
          row.querySelector(
            "[data-inline-title]"
          )?.value ||
          ""
        ).trim(),

      scheduleLabel:
        String(
          row.querySelector(
            "[data-inline-schedule-label]"
          )?.value ||
          ""
        ).trim(),

      shifts,

      assignedRoles,

      position:
        String(
          row.querySelector(
            "[data-inline-position]"
          )?.value ||
          ""
        ).trim(),

      approval:
        String(
          row.querySelector(
            "[data-inline-approval]"
          )?.value ||
          ""
        ).trim(),

      share:
        String(
          row.querySelector(
            "[data-inline-share]"
          )?.value ||
          ""
        ).trim(),

      note:
        String(
          row.querySelector(
            "[data-inline-note]"
          )?.value ||
          ""
        ).trim(),

      conditional:
        row.querySelector(
          "[data-inline-conditional]"
        )?.checked ===
          true,

      referenceOnly:
        row.querySelector(
          "[data-inline-reference]"
        )?.checked ===
          true,

      logKey:
        String(
          row.querySelector(
            "[data-inline-log-key]"
          )?.value ||
          ""
        ).trim(),

      titleKeyword:
        String(
          row.querySelector(
            "[data-inline-title-keyword]"
          )?.value ||
          ""
        ).trim(),

      rule
    };
  }


  function validateInlineEditorItem(
    item,
    isNew
  ) {
    if (
      !/^[a-z0-9][a-z0-9_-]{2,119}$/.test(
        item.id
      )
    ) {
      return "일정 ID는 영문 소문자·숫자·하이픈·밑줄로 3자 이상 입력해 주세요.";
    }


    if (
      !item.title
    ) {
      return "점검사항을 입력해 주세요.";
    }


    if (
      !item.scheduleLabel
    ) {
      return "점검 주기를 입력해 주세요.";
    }


    if (
      isNew &&
      getManagerItems().some(
        existingItem => {
          return existingItem.id ===
            item.id;
        }
      )
    ) {
      return "이미 사용 중인 일정 ID입니다.";
    }


    if (
      [
        "weekdays",
        "weekly"
      ].includes(
        item.rule.type
      ) &&
      !item.rule.days?.length
    ) {
      return "지정 요일 반복 일정은 적용 요일을 한 개 이상 선택해 주세요.";
    }


    if (
      item.rule.type ===
        "monthlyWeek" &&
      (
        !item.rule.days?.length ||
        !item.rule.weeks?.length
      )
    ) {
      return "월간 주차 일정은 적용 주차와 요일을 모두 선택해 주세요.";
    }


    if (
      item.rule.type ===
        "monthlyDate" &&
      (
        !Number.isInteger(
          item.rule.day
        ) ||
        item.rule.day <
          1 ||
        item.rule.day >
          31
      )
    ) {
      return "매월 지정일은 1~31 범위로 입력해 주세요.";
    }


    return "";
  }


  /* =====================================================
    표 안 저장·복원·삭제
  ====================================================== */

  async function saveInlineEditor(
    row
  ) {
    if (
      managerBusy
    ) {
      return;
    }


    const isNew =
      row.dataset.inlineEditorId ===
      "__new__";


    const item =
      collectInlineEditorItem(
        row
      );


    const validationMessage =
      validateInlineEditorItem(
        item,
        isNew
      );


    if (
      validationMessage
    ) {
      setTableMessage(
        validationMessage,
        "error"
      );

      return;
    }


    const revision =
      Number(
        row.dataset.inlineRevision
      ) ||
      0;


    const isCustom =
      isNew ||
      row.dataset.inlineIsCustom ===
        "true";


    const isActive =
      row.querySelector(
        "[data-inline-active]"
      )?.checked ===
        true;


    managerBusy =
      true;


    row.classList.add(
      "is-busy"
    );


    setTableMessage(
      "점검 일정을 저장하는 중입니다.",
      "saving"
    );


    try {
      const response =
        await fetch(
          SCHEDULE_API_URL,
          {
            method:
              "POST",

            headers:
              getScheduleApiHeaders({
                "Content-Type":
                  "application/json"
              }),

            cache:
              "no-store",

            body:
              JSON.stringify({
                item,

                expectedRevision:
                  revision >
                    0
                    ? revision
                    : null,

                isActive,
                isCustom
              })
          }
        );


      const result =
        await readScheduleApiResponse(
          response
        );


      window.alert(
        result.message ||
        "점검 일정을 저장했습니다."
      );


      window.location.reload();

    } catch (
      error
    ) {
      console.error(
        "점검주기표 직접 저장 실패:",
        error
      );


      setTableMessage(
        error instanceof Error
          ? error.message
          : "점검 일정을 저장하지 못했습니다.",
        "error"
      );


      managerBusy =
        false;

      row.classList.remove(
        "is-busy"
      );
    }
  }


  async function restoreOrDeleteInlineEditor(
    row
  ) {
    if (
      managerBusy
    ) {
      return;
    }


    const id =
      String(
        row.querySelector(
          "[data-inline-id]"
        )?.value ||
        ""
      ).trim();


    const revision =
      Number(
        row.dataset.inlineRevision
      ) ||
      0;


    const isCustom =
      row.dataset.inlineIsCustom ===
        "true";


    const title =
      String(
        row.querySelector(
          "[data-inline-title]"
        )?.value ||
        "점검 일정"
      ).trim();


    if (
      !id ||
      revision <
        1
    ) {
      return;
    }


    const confirmed =
      window.confirm(
        isCustom
          ? `“${title}” 일정을 완전히 삭제할까요?`
          : `“${title}”의 수정 내용을 삭제하고 기본값으로 복원할까요?`
      );


    if (
      !confirmed
    ) {
      return;
    }


    managerBusy =
      true;


    row.classList.add(
      "is-busy"
    );


    setTableMessage(
      isCustom
        ? "점검 일정을 삭제하는 중입니다."
        : "기본 일정으로 복원하는 중입니다.",
      "saving"
    );


    try {
      const url =
        new URL(
          SCHEDULE_API_URL,
          window.location.origin
        );


      url.searchParams.set(
        "id",
        id
      );

      url.searchParams.set(
        "revision",
        String(
          revision
        )
      );


      const response =
        await fetch(
          url.toString(),
          {
            method:
              "DELETE",

            headers:
              getScheduleApiHeaders(),

            cache:
              "no-store"
          }
        );


      const result =
        await readScheduleApiResponse(
          response
        );


      window.alert(
        result.message ||
        (
          isCustom
            ? "점검 일정을 삭제했습니다."
            : "기본 일정으로 복원했습니다."
        )
      );


      window.location.reload();

    } catch (
      error
    ) {
      console.error(
        "점검주기표 복원·삭제 실패:",
        error
      );


      setTableMessage(
        error instanceof Error
          ? error.message
          : "점검 일정을 복원하거나 삭제하지 못했습니다.",
        "error"
      );


      managerBusy =
        false;

      row.classList.remove(
        "is-busy"
      );
    }
  }

  /* =====================================================
    점검일지 최초 빈 화면

    처음 팝업을 열었을 때:
    - 월간 달력 숨김
    - 전체 점검표 숨김
    - 전용 점검일지 숨김
    - 왼쪽 메뉴 선택 해제
    - 왼쪽 접이식 메뉴 모두 닫힘

    사용자가 왼쪽 메뉴를 눌러야
    해당 화면이 표시된다.
  ====================================================== */

  function showEmptyInspectionWorkspace() {
    activeEditorId =
      "";


    managerBusy =
      false;


    hideViewer();


    tablePanel.hidden =
      true;


    dashboard.hidden =
      true;


    setTableMessage(
      ""
    );


    /*
      모든 왼쪽 메뉴 버튼 선택 해제
    */
    setActiveButton(
      null
    );


    /*
      점검주기·일일점검·주간점검·월간점검
      접이식 메뉴를 모두 닫는다.
    */
    sidebar
      .querySelectorAll(
        ".inspection-sidebar-group"
      )
      .forEach(
        group => {
          group.open =
            false;
        }
      );


    /*
      이전에 열었던 메뉴를 자동 복원하지 않는다.
    */
    try {
      window.sessionStorage.removeItem(
        VIEW_STORAGE_KEY
      );

    } catch {
      /*
        sessionStorage를 사용할 수 없어도
        화면 동작에는 영향 없음
      */
    }
  }
  
  /* =====================================================
    화면 전환
  ====================================================== */

  function showCalendar(
    button = null
  ) {
    activeEditorId =
      "";


    hideViewer();

    tablePanel.hidden =
      true;

    dashboard.hidden =
      false;


    setTableMessage(
      ""
    );


    if (
      button
    ) {
      setActiveButton(
        button
      );
    }


    saveLastView(
      "calendar"
    );
  }


  function showScheduleTable(
    category,
    button
  ) {
    hideViewer();

    dashboard.hidden =
      true;

    tablePanel.hidden =
      false;


    renderScheduleTable(
      category
    );

    setActiveButton(
      button
    );


    saveLastView(
      "schedule-table",
      String(
        category ||
        ""
      )
    );
  }


  /* =====================================================
    이벤트
  ====================================================== */

  viewButtons.forEach(
    button => {
      button.addEventListener(
        "click",
        () => {
          const view =
            String(
              button.dataset.inspectionSidebarView ||
              ""
            ).trim();

          const category =
            String(
              button.dataset.inspectionScheduleCategory ||
              ""
            ).trim();


          activeEditorId =
            "";

          managerBusy =
            false;

          setTableMessage(
            ""
          );


          if (
            view ===
            "calendar"
          ) {
            showCalendar(
              button
            );

            return;
          }


          if (
            view ===
            "schedule-table"
          ) {
            showScheduleTable(
              category,
              button
            );
          }
        }
      );
    }
  );


  logButtons.forEach(
    button => {
      button.addEventListener(
        "click",
        () => {
          const logKey =
            String(
              button.dataset.inspectionSidebarLog ||
              ""
            ).trim();


          const card =
            logCards.find(
              targetCard => {
                return (
                  String(
                    targetCard.dataset.inspectionLog ||
                    ""
                  ).trim() ===
                  logKey
                );
              }
            );


          openLogCard(
            card,
            button
          );
        }
      );
    }
  );


  newScheduleButton?.addEventListener(
    "click",
    () => {
      if (
        managerBusy
      ) {
        return;
      }


      activeEditorId =
        "__new__";

      setTableMessage(
        "새 점검 일정을 입력한 뒤 저장해 주세요.",
        "info"
      );

      renderScheduleTable(
        activeTableCategory
      );
    }
  );


  tableBody.addEventListener(
    "click",
    event => {
      const target =
        event.target instanceof Element
          ? event.target
          : null;


      const openButton =
        target?.closest(
          "[data-inspection-table-open-log]"
        );


      if (
        openButton
      ) {
        const scheduleId =
          String(
            openButton.dataset.inspectionTableOpenLog ||
            ""
          ).trim();


        const scheduleItem =
          getManagerItems().find(
            item => {
              return item.id ===
                scheduleId;
            }
          );


        openLogCard(
          getLinkedCard(
            scheduleItem
          )
        );

        return;
      }


      const editButton =
        target?.closest(
          "[data-inspection-table-edit]"
        );


      if (
        editButton &&
        canManage &&
        !managerBusy
      ) {
        activeEditorId =
          String(
            editButton.dataset.inspectionTableEdit ||
            ""
          ).trim();

        setTableMessage(
          "선택한 행을 점검주기표에서 직접 수정합니다.",
          "info"
        );

        renderScheduleTable(
          activeTableCategory
        );

        return;
      }


      const editorRow =
        target?.closest(
          "[data-inline-editor-id]"
        );


      if (
        !editorRow
      ) {
        return;
      }


      if (
        target?.closest(
          "[data-inline-save]"
        )
      ) {
        saveInlineEditor(
          editorRow
        );

        return;
      }


      if (
        target?.closest(
          "[data-inline-cancel]"
        )
      ) {
        activeEditorId =
          "";

        managerBusy =
          false;

        setTableMessage(
          ""
        );

        renderScheduleTable(
          activeTableCategory
        );

        return;
      }


      if (
        target?.closest(
          "[data-inline-delete]"
        )
      ) {
        restoreOrDeleteInlineEditor(
          editorRow
        );
      }
    }
  );


  window.addEventListener(
    "message",
    event => {
      if (
        event.origin !==
          window.location.origin ||
        (
          window.parent !==
            window &&
          event.source !==
            window.parent
        ) ||
        event.data?.type !==
          "gs-shift-log:open-inspection-schedule"
      ) {
        return;
      }


      const scheduleId =
        String(
          event.data?.scheduleId ||
          ""
        ).trim();


      if (
        !scheduleId
      ) {
        return;
      }


      const scheduleItem =
        getManagerItems().find(
          item => {
            return item.id ===
              scheduleId;
          }
        );


      const linkedCard =
        getLinkedCard(
          scheduleItem
        );


      if (
        !linkedCard
      ) {
        window.alert(
          "연결된 전용 점검일지가 없습니다."
        );

        return;
      }


      openLogCard(
        linkedCard
      );
    }
  );


  backButton?.addEventListener(
    "click",
    () => {
      const calendarButton =
        viewButtons.find(
          button => {
            return (
              button.dataset.inspectionSidebarView ===
              "calendar"
            );
          }
        );


      window.setTimeout(
        () => {
          showCalendar(
            calendarButton ||
            null
          );
        },
        0
      );
    }
  );


  /* =====================================================
    최초 화면

    아무 화면도 자동으로 열지 않는다.
    사용자가 왼쪽 메뉴를 눌러야 표시한다.
  ====================================================== */

  showEmptyInspectionWorkspace();
}


/* =========================================================
  관리자 일정과 달력 준비 후 실행
========================================================= */

async function waitForInspectionWorkspaceReady() {
  for (
    let attempt =
      0;
    attempt <
      80;
    attempt +=
      1
  ) {
    if (
      typeof inspectionScheduleOverrideState !==
        "undefined" &&
      inspectionScheduleOverrideState.loaded ===
        true &&
      document.getElementById(
        "inspectionScheduleDashboard"
      ) &&
      document.getElementById(
        "inspectionLogList"
      )
    ) {
      return;
    }


    await new Promise(
      resolve => {
        window.setTimeout(
          resolve,
          100
        );
      }
    );
  }
}


async function startInspectionWorkspaceNavigation() {
  await waitForInspectionWorkspaceReady();

  initializeInspectionWorkspaceNavigation();
}


if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    startInspectionWorkspaceNavigation,
    {
      once:
        true
    }
  );

} else {
  startInspectionWorkspaceNavigation();
}




