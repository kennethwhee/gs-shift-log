"use strict";

function initializeInspectionWorkspaceNavigation() {
  if (window.__gsInspectionWorkspaceNavigationStarted === true) {
    return;
  }

  const hub = document.querySelector(".inspection-log-hub");
  const dashboard = document.getElementById("inspectionScheduleDashboard");
  const tabNavigation = document.querySelector(".inspection-log-tabs");
  const logList = document.getElementById("inspectionLogList");
  const viewer = document.getElementById("inspectionLogViewer");
  const viewerFrame = document.getElementById("inspectionLogFrame");
  const backButton = document.getElementById("inspectionLogBackButton");
  const managerModal = document.getElementById("inspectionScheduleManagerModal");
  const logCards = [...document.querySelectorAll("[data-inspection-category-item]")];
  const categoryTabButtons = [...document.querySelectorAll("[data-inspection-category]")];

  if (!hub || !dashboard || !tabNavigation || !logList || !viewer) {
    console.error("점검일지 왼쪽 메뉴를 구성할 필수 요소가 없습니다.");
    return;
  }

  window.__gsInspectionWorkspaceNavigationStarted = true;

  const workspace = document.createElement("div");
  workspace.className = "inspection-workspace";

  const sidebar = document.createElement("aside");
  sidebar.className = "inspection-sidebar";
  sidebar.setAttribute("aria-label", "점검일지 메뉴");
  sidebar.innerHTML = `
    <div class="inspection-sidebar__intro">
      <strong>점검일지 메뉴</strong>
      <span>점검주기와 등록된 점검일지를 선택합니다.</span>
    </div>

    <details class="inspection-sidebar-group" open>
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

  const content = document.createElement("section");
  content.className = "inspection-workspace__content";

  const tablePanel = document.createElement("section");
  tablePanel.className = "inspection-schedule-table-panel";
  tablePanel.id = "inspectionScheduleTablePanel";
  tablePanel.hidden = true;
  tablePanel.innerHTML = `
    <header class="inspection-schedule-table-header">
      <div>
        <p>INSPECTION SCHEDULE LIST</p>
        <h2 id="inspectionScheduleTableTitle">
          설비점검 및 회전기기 교체운전 List 및 주기
        </h2>
      </div>

      <span id="inspectionScheduleTableSummary">
        전체 점검주기
      </span>
    </header>

    <div class="inspection-schedule-table-scroll">
      <table class="inspection-schedule-table">
        <colgroup>
          <col><col><col><col><col><col><col><col><col>
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

  const registry = document.createElement("div");
  registry.className = "inspection-log-source-registry";
  registry.append(tabNavigation, logList);

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

  if (managerModal) {
    hub.insertBefore(workspace, managerModal);
  } else {
    hub.appendChild(workspace);
  }

  const tableBody = document.getElementById("inspectionScheduleTableBody");
  const tableTitle = document.getElementById("inspectionScheduleTableTitle");
  const tableSummary = document.getElementById("inspectionScheduleTableSummary");
  const viewButtons = [...sidebar.querySelectorAll("[data-inspection-sidebar-view]")];
  const logButtons = [...sidebar.querySelectorAll("[data-inspection-sidebar-log]")];

  const categoryLabels = {
    daily: "일간",
    weekly: "주간",
    monthly: "월간",
    quarterly: "분기",
    other: "기타"
  };

  const categoryOrder = {
    daily: 1,
    weekly: 2,
    monthly: 3,
    quarterly: 4,
    other: 5
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setActiveButton(targetButton) {
    [...viewButtons, ...logButtons].forEach(button => {
      const active = button === targetButton;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    });
  }

  function hideViewer() {
    viewer.hidden = true;

    if (viewerFrame) {
      viewerFrame.src = "about:blank";
    }
  }

  function getLinkedCard(scheduleItem) {
    const logKey = String(scheduleItem?.logKey || "").trim();

    if (logKey) {
      const exactCard = logCards.find(card => {
        return String(card.dataset.inspectionLog || "").trim() === logKey;
      });

      if (exactCard) {
        return exactCard;
      }
    }

    const keyword = String(scheduleItem?.titleKeyword || "")
      .trim()
      .toLowerCase();

    if (!keyword) {
      return null;
    }

    return logCards.find(card => {
      const title = String(
        card.querySelector(".inspection-log-card__text strong")?.textContent || ""
      ).trim().toLowerCase();

      return title.includes(keyword);
    }) || null;
  }

  function openLogCard(card, sourceButton = null) {
    if (!card) {
      window.alert("연결된 점검일지가 없습니다.");
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

    tablePanel.hidden = true;
    dashboard.hidden = true;

    if (
      effectiveSourceButton
    ) {
      setActiveButton(
        effectiveSourceButton
      );
    }

    /*
      기존 허브는 현재 선택된 분류에 속한 카드만
      열도록 검사한다.

      주간 메뉴를 누른 상태에서 주간 카드가 hidden이면
      클릭이 무시되므로 먼저 해당 분류 탭을 실행한다.
    */
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

  function renderScheduleTable(category = "") {
    const normalizedCategory = String(category || "").trim();
    /*
      원본 PDF 표의 행 순서를 유지한다.
      INSPECTION_SCHEDULE_MASTER가 원본 순서로 작성되어 있으므로
      별도 가나다순 정렬을 하지 않는다.
    */
    const items =
      INSPECTION_SCHEDULE_MASTER
        .filter(
          item => {
            return (
              !normalizedCategory ||
              item.category ===
                normalizedCategory
            );
          }
        )
        .slice();

    if (tableTitle) {
      tableTitle.textContent = normalizedCategory
        ? `${categoryLabels[normalizedCategory] || "기타"} 점검주기`
        : "설비점검 및 회전기기 교체운전 List 및 주기";
    }

    if (tableSummary) {
      tableSummary.textContent = normalizedCategory
        ? `${categoryLabels[normalizedCategory] || "기타"} 항목 ${items.length}건`
        : `전체 점검주기 ${items.length}건`;
    }

    if (!items.length) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="9" class="inspection-schedule-table-empty">
            표시할 점검주기가 없습니다.
          </td>
        </tr>
      `;
      return;
    }

    const groupedItems = new Map();

    items.forEach(item => {
      const categoryKey = String(item.category || "other");

      if (!groupedItems.has(categoryKey)) {
        groupedItems.set(categoryKey, []);
      }

      groupedItems.get(categoryKey).push(item);
    });

    const rows = [];

    groupedItems.forEach((groupItems, categoryKey) => {
      groupItems.forEach((item, itemIndex) => {
        const linkedCard = getLinkedCard(item);
        const shifts = Array.isArray(item.shifts) ? item.shifts : [];
        const rowClasses = [
          item.conditional === true ? "is-conditional" : "",
          item.referenceOnly === true ? "is-reference" : ""
        ].filter(Boolean).join(" ");

        rows.push(`
          <tr class="${rowClasses}" data-schedule-id="${escapeHtml(item.id)}">
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
              <strong>${escapeHtml(item.title || "-")}</strong>
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
          </tr>
        `);
      });
    });

    tableBody.innerHTML = rows.join("");
  }

  function showCalendar(button = null) {
    hideViewer();
    tablePanel.hidden = true;
    dashboard.hidden = false;

    if (button) {
      setActiveButton(button);
    }
  }

  function showScheduleTable(category, button) {
    hideViewer();
    dashboard.hidden = true;
    tablePanel.hidden = false;
    renderScheduleTable(category);
    setActiveButton(button);
  }

  viewButtons.forEach(button => {
    button.addEventListener("click", () => {
      const view = String(button.dataset.inspectionSidebarView || "").trim();
      const category = String(button.dataset.inspectionScheduleCategory || "").trim();

      if (view === "calendar") {
        showCalendar(button);
        return;
      }

      if (view === "schedule-table") {
        showScheduleTable(category, button);
      }
    });
  });

  logButtons.forEach(button => {
    button.addEventListener("click", () => {
      const logKey = String(button.dataset.inspectionSidebarLog || "").trim();
      const card = logCards.find(targetCard => {
        return String(targetCard.dataset.inspectionLog || "").trim() === logKey;
      });

      openLogCard(card, button);
    });
  });

  tableBody.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("[data-inspection-table-open-log]");

    if (!button) {
      return;
    }

    const scheduleId = String(button.dataset.inspectionTableOpenLog || "").trim();
    const scheduleItem = INSPECTION_SCHEDULE_MASTER.find(item => item.id === scheduleId);
    openLogCard(getLinkedCard(scheduleItem));
  });

  backButton?.addEventListener("click", () => {
    const calendarButton = viewButtons.find(button => {
      return button.dataset.inspectionSidebarView === "calendar";
    });

    window.setTimeout(() => {
      showCalendar(calendarButton || null);
    }, 0);
  });

  const initialCalendarButton = viewButtons.find(button => {
    return button.dataset.inspectionSidebarView === "calendar";
  });

  showCalendar(initialCalendarButton || null);
}

/* =========================================================
  점검 일정 관리자 변경사항 적용 후
  왼쪽 메뉴와 점검표 실행
========================================================= */

async function waitForInspectionWorkspaceReady() {
  for (
    let attempt = 0;
    attempt < 80;
    attempt += 1
  ) {
    if (
      typeof inspectionScheduleOverrideState !== "undefined" &&
      inspectionScheduleOverrideState.loaded === true &&
      document.getElementById("inspectionScheduleDashboard") &&
      document.getElementById("inspectionLogList")
    ) {
      return;
    }

    await new Promise(resolve => {
      window.setTimeout(
        resolve,
        100
      );
    });
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
