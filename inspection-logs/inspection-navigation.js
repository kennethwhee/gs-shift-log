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
    "inspection-workspace inspection-workspace--nav-v2";


  const sidebar =
    document.createElement(
      "aside"
    );

  sidebar.className =
    "inspection-nav-v2";

  sidebar.setAttribute(
    "aria-label",
    "점검일지 메뉴"
  );

  sidebar.innerHTML = `
<details
  class="inspection-nav-v2__section inspection-nav-v2__section--inspection inspection-nav-v2__collapsible-section"
  aria-labelledby="inspectionSidebarInspectionTitle"
  open
>
  <summary class="inspection-nav-v2__section-header">
    <span>INSPECTION LOG</span>
    <strong id="inspectionSidebarInspectionTitle">점검일지</strong>
  </summary>

  <div class="inspection-nav-v2__groups">
    <details class="inspection-nav-v2__group" data-nav-icon="cycle">
      <summary>점검주기</summary>

      <div class="inspection-nav-v2__submenu">
        <button type="button" data-inspection-sidebar-view="calendar">
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

    <details class="inspection-nav-v2__group" data-nav-icon="daily">
      <summary>일일점검</summary>

      <div class="inspection-nav-v2__submenu">
        <button type="button" data-inspection-sidebar-log="night-patrol">
          야간 순찰 점검일지
        </button>
      </div>
    </details>

    <details class="inspection-nav-v2__group" data-nav-icon="weekly">
      <summary>주간점검</summary>

      <div class="inspection-nav-v2__submenu">
        <button type="button" data-inspection-sidebar-log="high-pressure-gas">
          고압가스 저장시설 주간점검표
        </button>

        <button type="button" data-inspection-sidebar-log="lng-weekly">
          LNG System 주간점검 일지
        </button>

        <button type="button" data-inspection-sidebar-log="soot-blower-weekly">
          Soot Blower 주간점검일지
        </button>
      </div>
    </details>

    <details class="inspection-nav-v2__group" data-nav-icon="monthly">
      <summary>월간점검</summary>

      <div class="inspection-nav-v2__submenu">
        <span class="inspection-nav-v2__empty">
          등록된 월간 점검일지가 없습니다.
        </span>
      </div>
    </details>
  </div>
</details>

<details
  class="inspection-nav-v2__section inspection-nav-v2__worklog inspection-nav-v2__collapsible-section"
  aria-labelledby="inspectionSidebarLogSheetTitle"
  open
>
  <summary class="inspection-nav-v2__section-header">
    <span>WORK LOG</span>
    <strong id="inspectionSidebarLogSheetTitle">Log Sheet</strong>
  </summary>

  <div class="inspection-nav-v2__groups">
    <details class="inspection-nav-v2__sheet-group" data-nav-icon="sheet">
      <summary>제어실 Log Sheet</summary>

      <div class="inspection-nav-v2__sheet-menu">
        <button type="button" data-inspection-sidebar-log="log-sheet-integrated-tgo">TGO</button>
        <button type="button" data-inspection-sidebar-log="log-sheet-integrated-bco1">BCO1</button>
        <button type="button" data-inspection-sidebar-log="log-sheet-integrated-bco2">BCO2</button>
      </div>
    </details>

    <details class="inspection-nav-v2__sheet-group" data-nav-icon="sheet">
      <summary>현장 Log Sheet</summary>

      <div class="inspection-nav-v2__sheet-branches">
        <details class="inspection-nav-v2__sheet-branch">
          <summary class="inspection-nav-v2__sheet-branch-summary inspection-nav-v2__sheet-branch-summary--night">야간</summary>

          <div class="inspection-nav-v2__sheet-menu">
            <button type="button" data-inspection-sidebar-log="log-sheet-field-night-leader-to">파트장·TO 야간</button>
            <button type="button" data-inspection-sidebar-log="log-sheet-field-night-bo12">BO1·2 야간</button>
          </div>
        </details>

        <details class="inspection-nav-v2__sheet-branch">
          <summary class="inspection-nav-v2__sheet-branch-summary inspection-nav-v2__sheet-branch-summary--day">주간</summary>

          <div class="inspection-nav-v2__sheet-menu">
            <button type="button" data-inspection-sidebar-log="log-sheet-field-day-to">TO</button>
            <button type="button" data-inspection-sidebar-log="log-sheet-field-day-bo1">BO1</button>
            <button type="button" data-inspection-sidebar-log="log-sheet-field-day-bo2">BO2</button>
          </div>
        </details>
      </div>
    </details>

    <div class="inspection-nav-v2__sheet-direct">
      <button type="button" data-inspection-sidebar-log="log-sheet-electrical">
        Elec. Log Sheet
      </button>

      <button type="button" data-inspection-sidebar-log="log-sheet-aux-control-room">
        고압 Aux BLR 제어실
      </button>

      <button type="button" data-inspection-sidebar-log="log-sheet-aux-field">
        고압 Aux BLR 현장
      </button>
    </div>
  </div>
</details>
  `;


  const content =
    document.createElement(
      "section"
    );

  content.className =
    "inspection-workspace__content";


  const homeButton =
    document.createElement(
      "button"
    );

  homeButton.type =
    "button";

  homeButton.className =
    "inspection-workspace-home-button";

  homeButton.hidden =
    true;

  homeButton.setAttribute(
    "aria-label",
    "점검일지 초기 화면으로 돌아가기"
  );

  homeButton.innerHTML = `
    <span aria-hidden="true">←</span>
    <strong>목록</strong>
  `;

/*
  왼쪽 메뉴 선택 전 안내 화면
*/
const emptyGuide =
  document.createElement(
    "section"
  );


emptyGuide.className =
  "inspection-workspace-empty";


emptyGuide.id =
  "inspectionWorkspaceEmpty";


emptyGuide.setAttribute(
  "aria-live",
  "polite"
);


emptyGuide.innerHTML = `
  <div class="inspection-workspace-empty__card">

    <span class="inspection-workspace-empty__eyebrow">
      SELECT MENU
    </span>

    <strong>
      확인할 메뉴를 선택하세요
    </strong>

    <p>
      왼쪽 메뉴에서 점검주기 또는 점검일지를 선택하면
      해당 내용이 표시됩니다.
    </p>

  </div>
`;    

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

  const previewButtonHtml = `
    <button
      type="button"
      class="inspection-schedule-table-preview-button"
      id="inspectionScheduleTablePreviewButton"
      hidden
    >
      미리보기
    </button>
  `;


  const printButtonHtml = `
    <button
      type="button"
      class="inspection-schedule-table-print-button"
      id="inspectionScheduleTablePrintButton"
      hidden
    >
      인쇄
    </button>
  `;

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

  ${previewButtonHtml}

  ${printButtonHtml}

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
  homeButton,
  emptyGuide,
  dashboard,
  tablePanel,
  registry,
  viewer
);


/*
  달력·점검표·점검일지가 열리면
  안내 문구를 자동으로 숨긴다.
*/
function updateInspectionEmptyGuide() {
  const hasVisibleContent =
    [
      dashboard,
      tablePanel,
      viewer
    ].some(
      element => {
        return (
          element &&
          element.hidden ===
            false
        );
      }
    );


  const viewerVisible =
    Boolean(
      viewer &&
      viewer.hidden ===
        false
    );

  emptyGuide.hidden =
    hasVisibleContent;

  /*
    크게 보기에서 달력·점검주기표는 자체 목록 버튼이 없으므로
    별도 홈 버튼을 표시한다.

    전용 점검일지 viewer는 상단의 기존 ← 목록 버튼을 사용한다.
  */
  homeButton.hidden =
    !hasVisibleContent ||
    viewerVisible;
}


const inspectionEmptyGuideObserver =
  new MutationObserver(
    updateInspectionEmptyGuide
  );


[
  dashboard,
  tablePanel,
  viewer
].forEach(
  element => {
    if (
      !element
    ) {
      return;
    }


    inspectionEmptyGuideObserver.observe(
      element,
      {
        attributes:
          true,

        attributeFilter: [
          "hidden"
        ]
      }
    );
  }
);


updateInspectionEmptyGuide();


  workspace.append(
    sidebar,
    content
  );


  hub.appendChild(
    workspace
  );

  /* =====================================================
    좌측 메뉴 접기 정책

    - 전체 사이드바 접기 기능은 사용하지 않는다.
    - 점검일지 / Log Sheet 섹션만 각각 독립적으로 접는다.
  ====================================================== */

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

  const previewScheduleButton =
    document.getElementById(
      "inspectionScheduleTablePreviewButton"
    );


  const printScheduleButton =
    document.getElementById(
      "inspectionScheduleTablePrintButton"
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
    점검주기표 상태·담당 보직 배지

    - "수정됨" 배지는 표시하지 않는다.
    - 사용 중지·추가 일정 상태는 유지한다.
    - 담당 보직은 점검명 오른쪽에 표시한다.
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


    /*
      hasOverride 상태여도
      "수정됨" 배지는 표시하지 않는다.
    */
    return "";
  }


  function createAssignedRoleBadgeHtml(
    assignedRoles
  ) {
    const roleText =
      Array.isArray(
        assignedRoles
      ) &&
      assignedRoles.length
        ? assignedRoles.join(
            " · "
          )
        : "미지정";


    /*
      기존 수정됨 배지와 동일한 모양을 사용하되
      내용은 담당 보직으로 표시한다.
    */
    return `
      <span class="inspection-schedule-table-state is-edited">
        담당 ${escapeHtml(
          roleText
        )}
      </span>
    `;
  }

/* =====================================================
  [INSPECTION-SCHEDULE-EXCEL-PRINT-V6]

  전체 점검표 인쇄 / 미리보기

  기준 양식:
  - "(GS포천 설비운영팀)2025년 설비 정기점검 업무일정표(251014).xlsx"
  - "설비 정기점검&교체운전(251014수정)" 시트
  - 주설비 운전분야 B2:J47 형식

  출력 원칙:
  - 연료설비 운전분야는 제외
  - 사용 중지 일정도 행 자체는 모두 포함
  - 별도 상태 열은 만들지 않고 Excel 열 구조를 그대로 유지
  - 구분 / 점검주기 / Shift(D/S,N/S) / 점검사항 /
    담당(Position) / 결재 / 공유 / 비고
  - A4 세로 1페이지 · Excel처럼 인쇄 가능 폭을 넓게 사용
===================================================== */

function isInspectionScheduleFuelFacilityItem(
  item
) {
  const possibleSectionValues = [
    item?.section,
    item?.sectionKey,
    item?.sourceSection,
    item?.operationArea,
    item?.facilityGroup
  ]
    .map(
      value => {
        return String(
          value ||
          ""
        )
          .trim()
          .toLowerCase();
      }
    )
    .filter(
      Boolean
    );


  const fuelSectionKeys =
    new Set([
      "fuel",
      "fuel-facility",
      "fuel_facility",
      "fuel facility",
      "연료설비",
      "연료설비 운전분야"
    ]);


  return possibleSectionValues.some(
    value => {
      return fuelSectionKeys.has(
        value
      );
    }
  );
}


function getInspectionScheduleExcelPrintItems() {
  return getManagerItems()
    .filter(
      item => {
        return (
          !isInspectionScheduleFuelFacilityItem(
            item
          )
        );
      }
    );
}


function getInspectionSchedulePrintCategoryOrder() {
  return [
    "daily",
    "weekly",
    "monthly",
    "quarterly",
    "other"
  ];
}


function buildInspectionScheduleExcelPrintRows(
  items
) {
  const rows = [];


  getInspectionSchedulePrintCategoryOrder()
    .forEach(
      category => {
        const categoryItems =
          items.filter(
            item => {
              return (
                String(
                  item?.category ||
                  ""
                ).trim() ===
                category
              );
            }
          );


        if (
          !categoryItems.length
        ) {
          return;
        }


        categoryItems.forEach(
          (
            item,
            index
          ) => {
            const shifts =
              Array.isArray(
                item?.shifts
              )
                ? item.shifts
                : [];


            const isCategoryFirst =
              index ===
              0;


            rows.push(`
              <tr
                class="${
                  isCategoryFirst
                    ? "is-category-start"
                    : ""
                }"
              >
                ${
                  isCategoryFirst
                    ? `
                        <th
                          class="is-category"
                          rowspan="${categoryItems.length}"
                        >
                          ${escapeHtml(
                            categoryLabels[
                              category
                            ] ||
                            "기타"
                          )}
                        </th>
                      `
                    : ""
                }

                <td class="is-cycle">
                  ${escapeHtml(
                    item?.scheduleLabel ||
                    "-"
                  )}
                </td>

                <td class="is-shift">
                  ${shifts.includes("D/S") ? "●" : ""}
                </td>

                <td class="is-shift">
                  ${shifts.includes("N/S") ? "●" : ""}
                </td>

                <td class="is-title">
                  ${escapeHtml(
                    item?.title ||
                    "-"
                  )}
                </td>

                <td class="is-position">
                  ${escapeHtml(
                    item?.position ||
                    "-"
                  )}
                </td>

                <td class="is-approval">
                  ${escapeHtml(
                    item?.approval ||
                    "-"
                  )}
                </td>

                <td class="is-share">
                  ${escapeHtml(
                    item?.share ||
                    "-"
                  )}
                </td>

                <td class="is-note">
                  ${escapeHtml(
                    item?.note ||
                    "-"
                  )}
                </td>
              </tr>
            `);
          }
        );
      }
    );


  return rows.join(
    ""
  );
}


function buildInspectionScheduleExcelPrintDocument(
  items
) {
  const rowsHtml =
    buildInspectionScheduleExcelPrintRows(
      items
    );


  const now =
    new Date();


  const yearText =
    String(
      now.getFullYear()
    ).slice(
      -2
    );


  const monthText =
    String(
      now.getMonth() +
      1
    ).padStart(
      2,
      "0"
    );


  const dayText =
    String(
      now.getDate()
    ).padStart(
      2,
      "0"
    );


  const revisionText =
    `설비운영팀('${yearText}.${monthText}.${dayText})`;


  /*
    Excel 원본은 80% 고정 배율이다.
    항목 수에 따른 선제적 폰트 축소는 하지 않고,
    실제 한 페이지를 넘을 때만 마지막 fit 단계에서 미세 축소한다.
  */
  const densityClass =
    "";


  return `
    <!DOCTYPE html>

    <html lang="ko">

    <head>

      <meta charset="UTF-8">

      <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
      >

      <title>
        전체 점검표
      </title>

      <style>

        @page {
          /*
            Edge/Chromium 자동 머리글·바닥글
            (날짜·시간 / 문서명 / URL / 페이지 번호)이
            들어갈 page margin 공간을 없앤다.

            실제 문서 여백은 아래 print 전용
            .preview-stage padding과 174mm 문서폭으로 복원한다.
          */
          size: A4 portrait;
          margin: 0;
        }


        * {
          box-sizing: border-box;
        }


        html,
        body {
          margin: 0;
          padding: 0;

          background: #e8edf2;

          color: #000000;

          font-family:
            "Malgun Gothic",
            "맑은 고딕",
            Arial,
            sans-serif;
        }


        .preview-toolbar {
          position: sticky;
          top: 0;
          z-index: 20;

          display: flex;

          min-height: 54px;

          align-items: center;
          justify-content: space-between;

          gap: 12px;

          padding: 8px 14px;

          border-bottom:
            1px solid
            #cad4dd;

          background:
            rgba(
              255,
              255,
              255,
              0.97
            );

          box-shadow:
            0 2px 10px
            rgba(
              28,
              45,
              64,
              0.08
            );
        }


        .preview-toolbar strong {
          color: #18344f;

          font-size: 14px;
          font-weight: 900;
        }


        .preview-toolbar span {
          margin-left: 8px;

          color: #60778c;

          font-size: 10px;
          font-weight: 750;
        }


        .preview-toolbar__actions {
          display: flex;

          align-items: center;

          gap: 6px;
        }


        .preview-toolbar button {
          min-height: 34px;

          padding: 0 14px;

          border:
            1px solid
            #bfd0df;

          border-radius: 7px;

          background: #ffffff;

          color: #2f5f8f;

          font: inherit;
          font-size: 10px;
          font-weight: 900;

          cursor: pointer;
        }


        .preview-toolbar button.is-primary {
          border-color: #2f73b8;

          background: #2f73b8;

          color: #ffffff;
        }


        .preview-stage {
          display: flex;

          min-height:
            calc(
              100vh -
              54px
            );

          align-items: flex-start;
          justify-content: center;

          padding: 18px;

          overflow: auto;
        }


        .print-document {
          /*
            A4 portrait에서 좌우 18mm를 제외한
            실제 인쇄 가능 폭 174mm를 사용한다.

            Excel의 80%는 원본 시트 전체 배율이며,
            완성된 143.5mm 폭을 다시 적용하는 값이 아니다.
          */
          width: 174mm;
          max-width: 174mm;

          margin: 0 auto;

          padding: 0;

          background: #ffffff;

          box-shadow:
            0 12px 34px
            rgba(
              22,
              43,
              65,
              0.18
            );

          transform-origin: top center;
        }


        .excel-title {
          position: relative;

          min-height: 11.9mm;

          padding-top: 0;

          text-align: center;
        }


        .excel-title h1 {
          margin: 0;

          font-size: 11.2pt;
          font-weight: 900;
          line-height: 1.1;
        }


        .excel-title__revision {
          position: absolute;
          right: 0;
          bottom: 1mm;

          font-size: 6.4pt;
          font-weight: 500;
        }


        .excel-section-title {
          min-height: 5.1mm;

          margin:
            0
            0
            0.8mm;

          font-size: 9.6pt;
          font-weight: 900;
          line-height: 1.05;
        }


        table {
          width: 100%;

          border:
            1.8px solid
            #000000;

          border-collapse: collapse;
          table-layout: fixed;

          font-size: 6.4pt;
        }


        body.is-compact table {
          font-size: 6.45pt;
        }


        body.is-ultra-compact table {
          font-size: 5.9pt;
        }


        col.is-category {
          width: 12.06mm;
        }


        col.is-cycle {
          width: 15.14mm;
        }


        col.is-shift-ds,
        col.is-shift-ns {
          width: 10mm;
        }


        col.is-title {
          width: 45.94mm;
        }


        col.is-position {
          width: 15.14mm;
        }


        col.is-approval {
          width: 15.14mm;
        }


        col.is-share {
          width: 15.14mm;
        }


        col.is-note {
          width: 35.42mm;
        }


        th,
        td {
          border:
            1px solid
            #000000;

          vertical-align: middle;
        }


        thead th {
          padding:
            0.2mm
            0.55mm;

          background: #f2f2f2;

          font-size: 6.4pt;
          font-weight: 900;
          line-height: 1.05;

          text-align: center;
        }


        thead tr:first-child {
          height: 4.7mm;
        }


        thead tr:last-child {
          height: 4.9mm;
        }


        thead tr:first-child th {
          border-top-width: 1.8px;
        }


        thead tr:first-child
        > th:first-child {
          border-left-width: 1.8px;
        }


        thead tr:first-child
        > th:last-child {
          border-right-width: 1.8px;
        }


        thead tr:last-child th {
          border-bottom: 3px double #000000;
        }


        tbody tr {
          height: 5.08mm;
        }


        tbody th,
        tbody td {
          padding:
            0.2mm
            0.55mm;

          line-height: 1.12;
        }


        body.is-compact tbody th,
        body.is-compact tbody td {
          padding:
            0.38mm
            0.55mm;

          line-height: 1.04;
        }


        body.is-ultra-compact tbody th,
        body.is-ultra-compact tbody td {
          padding:
            0.22mm
            0.45mm;

          line-height: 1;
        }


        tbody tr.is-category-start
        > * {
          border-top-width: 1.8px;
        }


        tbody th.is-category {
          border-left-width: 1.8px;
          border-bottom-width: 1.8px;

          font-weight: 900;
          text-align: center;
        }


        tbody td.is-note {
          border-right-width: 1.8px;
        }


        tbody tr:last-child
        > td {
          border-bottom-width: 1.8px;
        }


        td.is-cycle,
        td.is-shift,
        td.is-position,
        td.is-approval,
        td.is-share {
          text-align: center;
        }


        td.is-title,
        td.is-note {
          text-align: left;
        }


        td.is-title,
        td.is-note,
        td.is-position,
        td.is-approval,
        td.is-share {
          word-break: keep-all;
          overflow-wrap: anywhere;
        }


        .excel-footnote {
          min-height: 5.1mm;

          margin:
            0.8mm
            0
            0;

          color: #ff0000;

          font-size: 7.2pt;
          font-weight: 500;
        }


        @media print {

          html,
          body {
            width: 100% !important;
            height: auto !important;
            min-height: 0 !important;

            margin: 0 !important;
            padding: 0 !important;

            overflow: hidden !important;

            background: #ffffff;

            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }


          .preview-toolbar {
            display: none !important;
          }


          .preview-stage {
            display: block;

            width: 100% !important;
            height: auto !important;
            min-height: 0 !important;

            /*
              @page margin을 0으로 바꾼 대신
              Excel 기준 상·하 19mm 여백을 문서 안쪽에서 복원한다.
              174mm 문서폭을 가운데 두면 좌·우는 각각 18mm가 된다.
            */
            margin: 0 !important;
            padding:
              19mm
              0 !important;

            overflow: hidden !important;
          }


          .print-document {
            width: 174mm;
            max-width: 174mm;
            height: auto !important;
            min-height: 0 !important;

            margin:
              0
              auto !important;

            padding: 0;

            /*
              기존 hidden은 표 오른쪽 외곽선의 절반을 잘라냈다.
              문서 자체는 visible로 두고,
              페이지 넘침은 상위 preview-stage에서 차단한다.
            */
            overflow: visible !important;

            box-shadow: none;

            break-inside: avoid-page;
            break-after: avoid-page;
            page-break-inside: avoid;
            page-break-after: avoid;
          }


          .print-document table {
            break-inside: avoid-page;
            page-break-inside: avoid;
          }


          .excel-footnote {
            break-after: avoid-page;
            page-break-after: avoid;
          }

        }

      </style>

    </head>


    <body class="${densityClass}">

      <div class="preview-toolbar">

        <div>

          <strong>
            전체 점검표 미리보기
          </strong>

          <span>
            주설비 ${items.length}건 · 사용 중지 포함 · 연료설비 제외
          </span>

        </div>


        <div class="preview-toolbar__actions">

          <button
            type="button"
            id="inspectionSchedulePrintPreviewCloseButton"
          >
            닫기
          </button>

          <button
            type="button"
            class="is-primary"
            id="inspectionSchedulePrintPreviewPrintButton"
          >
            인쇄
          </button>

        </div>

      </div>


      <div class="preview-stage">

        <main class="print-document">

          <header class="excel-title">

            <h1>
              설비운영팀 설비점검 및 회전기기 교체운전 List 및 주기
            </h1>

            <span class="excel-title__revision">
              ${escapeHtml(
                revisionText
              )}
            </span>

          </header>


          <h2 class="excel-section-title">
            ▣ 주설비 운전분야 설비점검
          </h2>


          <table>

            <colgroup>
              <col class="is-category">
              <col class="is-cycle">
              <col class="is-shift-ds">
              <col class="is-shift-ns">
              <col class="is-title">
              <col class="is-position">
              <col class="is-approval">
              <col class="is-share">
              <col class="is-note">
            </colgroup>


            <thead>

              <tr>

                <th
                  colspan="2"
                  rowspan="2"
                >
                  점검 주기
                </th>

                <th colspan="2">
                  Shift
                </th>

                <th rowspan="2">
                  점검사항
                </th>

                <th>
                  담당
                </th>

                <th rowspan="2">
                  결재
                </th>

                <th rowspan="2">
                  공유
                </th>

                <th rowspan="2">
                  비고
                </th>

              </tr>


              <tr>

                <th>
                  D/S
                </th>

                <th>
                  N/S
                </th>

                <th>
                  Position
                </th>

              </tr>

            </thead>


            <tbody>
              ${rowsHtml}
            </tbody>

          </table>


          <p class="excel-footnote">
            * 월간 점검기준 첫주는 1일이 금요일 포함시 첫주 적용
          </p>

        </main>

      </div>

    </body>

    </html>
  `;
}


function fitInspectionScheduleExcelPrintToOnePage(
  printWindow
) {
  if (
    !printWindow ||
    printWindow.closed
  ) {
    return;
  }


  const printDocument =
    printWindow.document.querySelector(
      ".print-document"
    );


  if (
    !printDocument
  ) {
    return;
  }


  printDocument.style.zoom =
    "1";


  /*
    A4 portrait + 좌우 18mm / 상하 19mm 기준.

    폭은 실제 인쇄 가능 폭 174mm에 가깝게 사용하고,
    높이는 브라우저 인쇄 반올림과 기본 머리글/바닥글을 고려해
    약 7mm의 안전 여유를 둔다.
  */
  const targetWidth =
    650;


  const targetHeight =
    952;


  const widthRatio =
    targetWidth /
    Math.max(
      printDocument.scrollWidth,
      1
    );


  const heightRatio =
    targetHeight /
    Math.max(
      printDocument.scrollHeight,
      1
    );


  const fitRatio =
    Math.min(
      1,
      widthRatio,
      heightRatio
    );


  const safeRatio =
    Math.max(
      0.72,
      Math.min(
        0.98,
        Math.floor(
          fitRatio *
          100
        ) /
        100
      )
    );


  printDocument.style.zoom =
    String(
      safeRatio
    );
}


function openInspectionSchedulePrintPreview(
  options = {}
) {
  if (
    activeTableCategory
  ) {
    return;
  }


  const items =
    getInspectionScheduleExcelPrintItems();


  if (
    items.length <
      1
  ) {
    window.alert(
      "인쇄할 주설비 점검 목록이 없습니다."
    );

    return;
  }


  const autoPrint =
    options.autoPrint ===
      true;


  const printWindow =
    window.open(
      "",
      "_blank",
      "width=1280,height=900,resizable=yes,scrollbars=yes"
    );


  if (
    !printWindow
  ) {
    window.alert(
      "미리보기 창을 열 수 없습니다. 브라우저의 팝업 차단을 확인해 주세요."
    );

    return;
  }


  printWindow.document.open();

  printWindow.document.write(
    buildInspectionScheduleExcelPrintDocument(
      items
    )
  );

  printWindow.document.close();


  const previewPrintButton =
    printWindow.document.getElementById(
      "inspectionSchedulePrintPreviewPrintButton"
    );


  const previewCloseButton =
    printWindow.document.getElementById(
      "inspectionSchedulePrintPreviewCloseButton"
    );


  function fitPreview() {
    fitInspectionScheduleExcelPrintToOnePage(
      printWindow
    );
  }


  function runPrint() {
    fitPreview();

    printWindow.focus();

    printWindow.setTimeout(
      () => {
        printWindow.print();
      },
      80
    );
  }


  previewPrintButton?.addEventListener(
    "click",
    runPrint
  );


  previewCloseButton?.addEventListener(
    "click",
    () => {
      printWindow.close();
    }
  );


  printWindow.addEventListener(
    "beforeprint",
    fitPreview
  );


  printWindow.addEventListener(
    "resize",
    fitPreview
  );


  if (
    autoPrint
  ) {
    printWindow.addEventListener(
      "afterprint",
      () => {
        printWindow.close();
      },
      {
        once:
          true
      }
    );
  }


  printWindow.setTimeout(
    () => {
      fitPreview();

      if (
        autoPrint
      ) {
        runPrint();
      }
    },
    140
  );
}


function previewInspectionScheduleList() {
  openInspectionSchedulePrintPreview();
}


function printInspectionScheduleList() {
  openInspectionSchedulePrintPreview({
    autoPrint:
      true
  });
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
      previewScheduleButton
    ) {
      previewScheduleButton.hidden =
        Boolean(
          activeTableCategory
        );
    }


    if (
      printScheduleButton
    ) {
      printScheduleButton.hidden =
        Boolean(
          activeTableCategory
        );
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
                    <strong>
                      ${escapeHtml(
                        item.title ||
                        "-"
                      )}
                    </strong>

                    ${createAssignedRoleBadgeHtml(
                      assignedRoles
                    )}

                    ${createStateBadgeHtml(
                      item
                    )}
                  </div>
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

    적용:
    - 저장 후 페이지 전체 새로고침 금지
    - 현재 열어둔 점검주기표 유지
    - 현재 선택한 전체·일간·주간·월간 구분 유지
    - 기존 표 스크롤 위치 유지
    - 서버 최신 데이터만 다시 불러와 표 갱신
  ====================================================== */


  /* =====================================================
    현재 선택된 점검주기표 메뉴 버튼 찾기
  ====================================================== */

  function getCurrentScheduleTableMenuButton() {
    const currentCategory =
      String(
        activeTableCategory ||
        ""
      ).trim();


    return (
      viewButtons.find(
        button => {
          const view =
            String(
              button.dataset
                .inspectionSidebarView ||
              ""
            ).trim();


          const category =
            String(
              button.dataset
                .inspectionScheduleCategory ||
              ""
            ).trim();


          return (
            view ===
              "schedule-table" &&
            category ===
              currentCategory
          );
        }
      ) ||
      null
    );
  }


  /* =====================================================
    저장·복원·삭제 후 현재 점검주기표 갱신

    페이지 전체를 다시 불러오지 않는다.
  ====================================================== */

  async function refreshCurrentScheduleTableAfterChange(
    options = {}
  ) {
    const focusId =
      String(
        options.focusId ||
        ""
      ).trim();


    const previousScrollTop =
      Math.max(
        0,

        Number(
          options.scrollTop
        ) ||
        0
      );


    const successMessage =
      String(
        options.message ||
        "점검 일정을 반영했습니다."
      ).trim();


    let refreshWarning =
      "";


    /*
      inspection-logs.js의 일정 조회 함수를 사용해
      D1 최신 자료만 다시 가져온다.
    */
    if (
      typeof loadInspectionScheduleOverrides ===
        "function"
    ) {
      try {
        await loadInspectionScheduleOverrides();

      } catch (
        error
      ) {
        console.warn(
          "점검 일정 저장 후 최신 목록 조회 실패:",
          error
        );


        refreshWarning =
          "저장은 완료됐지만 최신 목록 조회가 지연되고 있습니다.";
      }
    }


    activeEditorId =
      "";


    managerBusy =
      false;


    /*
      달력·점검일지는 숨기고
      현재 점검주기표를 계속 표시한다.
    */
    hideViewer();


    dashboard.hidden =
      true;


    tablePanel.hidden =
      false;


    /*
      현재 선택된 전체·일간·주간·월간 구분으로
      표를 다시 출력한다.
    */
    renderScheduleTable(
      activeTableCategory
    );


    const currentMenuButton =
      getCurrentScheduleTableMenuButton();


    if (
      currentMenuButton
    ) {
      setActiveButton(
        currentMenuButton
      );


      /*
        점검주기 접이식 메뉴가 닫히지 않게 유지한다.
      */
      const parentGroup =
        currentMenuButton.closest(
          ".inspection-nav-v2__group"
        );


      if (
        parentGroup
      ) {
        parentGroup.open =
          true;
      }
    }


    /*
      현재 화면 종류도 유지한다.
    */
    saveLastView(
      "schedule-table",
      activeTableCategory
    );


    setTableMessage(
      refreshWarning ||
      successMessage,

      refreshWarning
        ? "warning"
        : "success"
    );


    /*
      표를 다시 그린 뒤
      기존 스크롤 위치를 복구한다.
    */
    window.requestAnimationFrame(
      () => {
        const tableScroll =
          tablePanel.querySelector(
            ".inspection-schedule-table-scroll"
          );


        if (
          tableScroll
        ) {
          tableScroll.scrollTop =
            previousScrollTop;
        }


        /*
          저장 또는 복원된 행이 현재 구분에 남아 있으면
          화면 안에 보이도록 한다.
        */
        if (
          focusId
        ) {
          const targetRow =
            tableBody.querySelector(
              `[data-schedule-id="${focusId}"]`
            );


          targetRow?.scrollIntoView({
            block:
              "nearest",

            behavior:
              "smooth"
          });
        }
      }
    );


    /*
      달력과 보직별 점검 현황도 갱신한다.
    */
    const refreshMessage = {
      type:
        "gs-shift-log:refresh-inspection-schedule",

      scheduleId:
        focusId
    };


    try {
      window.dispatchEvent(
        new MessageEvent(
          "message",

          {
            data:
              refreshMessage,

            origin:
              window.location.origin
          }
        )
      );

    } catch (
      error
    ) {
      console.warn(
        "점검 일정 내부 갱신 메시지 전달 실패:",
        error
      );
    }


    try {
      if (
        window.parent &&
        window.parent !==
          window
      ) {
        window.parent.postMessage(
          refreshMessage,
          window.location.origin
        );
      }

    } catch (
      error
    ) {
      console.warn(
        "점검 일정 상위 화면 갱신 메시지 전달 실패:",
        error
      );
    }
  }


  /* =====================================================
    점검 일정 저장
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


    const tableScroll =
      row.closest(
        ".inspection-schedule-table-scroll"
      ) ||
      tablePanel.querySelector(
        ".inspection-schedule-table-scroll"
      );


    const previousScrollTop =
      Number(
        tableScroll?.scrollTop
      ) ||
      0;


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


      const savedId =
        String(
          result?.item?.id ||
          item.id ||
          ""
        ).trim();


      const resultMessage =
        String(
          result.message ||
          (
            isNew
              ? "점검 일정을 등록했습니다."
              : "점검 일정을 수정했습니다."
          )
        ).trim();


      /*
        window.location.reload()을 사용하지 않는다.

        서버 자료만 다시 불러온 뒤
        현재 점검주기표를 그대로 유지한다.
      */
      await refreshCurrentScheduleTableAfterChange({
        focusId:
          savedId,

        scrollTop:
          previousScrollTop,

        message:
          resultMessage
      });


      window.alert(
        resultMessage
      );

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


  /* =====================================================
    기본값 복원 또는 사용자 일정 삭제
  ====================================================== */

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


    const tableScroll =
      row.closest(
        ".inspection-schedule-table-scroll"
      ) ||
      tablePanel.querySelector(
        ".inspection-schedule-table-scroll"
      );


    const previousScrollTop =
      Number(
        tableScroll?.scrollTop
      ) ||
      0;


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


      const resultMessage =
        String(
          result.message ||
          (
            isCustom
              ? "점검 일정을 삭제했습니다."
              : "기본 일정으로 복원했습니다."
          )
        ).trim();


      /*
        사용자 추가 일정은 삭제되므로 focusId를 비운다.

        기본 일정 복원은 같은 ID의 기본 일정이 다시 나타나므로
        해당 행으로 돌아간다.
      */
      await refreshCurrentScheduleTableAfterChange({
        focusId:
          isCustom
            ? ""
            : id,

        scrollTop:
          previousScrollTop,

        message:
          resultMessage
      });


      window.alert(
        resultMessage
      );

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
        ".inspection-nav-v2__group"
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


  function exitInspectionFocusMode() {
    if (
      typeof window.gsInspectionViewToolsExitFocusMode ===
        "function"
    ) {
      window.gsInspectionViewToolsExitFocusMode();
      return;
    }

    document.body.classList.remove(
      "inspection-focus-mode"
    );
  }


  function returnToInspectionHome() {
    exitInspectionFocusMode();
    showEmptyInspectionWorkspace();
  }


  window.gsShiftLogShowInspectionHome =
    returnToInspectionHome;


  homeButton.addEventListener(
    "click",
    returnToInspectionHome
  );
  
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

  previewScheduleButton?.addEventListener(
    "click",
    () => {
      previewInspectionScheduleList();
    }
  );


  printScheduleButton?.addEventListener(
    "click",
    () => {
      printInspectionScheduleList();
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
    event => {
      event.preventDefault();
      returnToInspectionHome();
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

  - 필요한 HTML 요소가 준비될 때까지 기다린다.
  - 관리자 일정 조회가 끝나면 왼쪽 메뉴를 만든다.
  - 일정 조회가 늦어져도 최대 8초 후에는 메뉴를 표시한다.
  - 최초 화면에서는 어떤 본문도 자동으로 열지 않는다.
========================================================= */

async function waitForInspectionWorkspaceReady() {
  const maximumAttempts =
    80;


  for (
    let attempt =
      0;

    attempt <
      maximumAttempts;

    attempt +=
      1
  ) {
    const hasRequiredElements =
      Boolean(
        document.querySelector(
          ".inspection-log-hub"
        )
      ) &&

      Boolean(
        document.getElementById(
          "inspectionScheduleDashboard"
        )
      ) &&

      Boolean(
        document.querySelector(
          ".inspection-log-tabs"
        )
      ) &&

      Boolean(
        document.getElementById(
          "inspectionLogList"
        )
      ) &&

      Boolean(
        document.getElementById(
          "inspectionLogViewer"
        )
      );


    const scheduleStateReady =
      typeof inspectionScheduleOverrideState ===
        "undefined" ||

      inspectionScheduleOverrideState.loaded ===
        true;


    if (
      hasRequiredElements &&
      scheduleStateReady
    ) {
      return true;
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


  /*
    일정 API 응답이 늦더라도
    기본 HTML 요소만 준비되어 있으면
    왼쪽 메뉴 화면은 실행한다.
  */

  return Boolean(
    document.querySelector(
      ".inspection-log-hub"
    ) &&

    document.getElementById(
      "inspectionScheduleDashboard"
    ) &&

    document.querySelector(
      ".inspection-log-tabs"
    ) &&

    document.getElementById(
      "inspectionLogList"
    ) &&

    document.getElementById(
      "inspectionLogViewer"
    )
  );
}


async function startInspectionWorkspaceNavigation() {
  if (
    window.__gsInspectionWorkspaceNavigationStarted ===
      true
  ) {
    return;
  }


  const ready =
    await waitForInspectionWorkspaceReady();


  if (
    !ready
  ) {
    console.error(
      "점검일지 왼쪽 메뉴 실행에 필요한 화면 요소를 찾지 못했습니다."
    );

    return;
  }


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


