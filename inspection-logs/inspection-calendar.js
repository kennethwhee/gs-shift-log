/* =========================================================
  월간 달력형 점검 일정

  구성:
  - 해당 월 달력
  - 날짜별 주요 점검명
  - 선택 날짜 점검 목록
  - 접이식 점검주기 목록
========================================================= */

function initializeInspectionCalendarDashboard() {
  const STATUS_API = "/api/inspection-schedule-status";
  const TRACKING_START_DATE = "2026-08-04";

  const dashboard = document.getElementById("inspectionScheduleDashboard");
  const calendarTitle = document.getElementById("inspectionCalendarTitle");
  const calendarGrid = document.getElementById("inspectionCalendarGrid");
  const calendarCard = dashboard?.querySelector(".inspection-calendar-card") || null;
  const calendarToolbar = dashboard?.querySelector(".inspection-calendar-toolbar") || null;
  const previousButton = document.getElementById("inspectionCalendarPreviousButton");
  const nextButton = document.getElementById("inspectionCalendarNextButton");
  const todayButton = document.getElementById("inspectionCalendarTodayButton");
  const selectedTitle = document.getElementById("inspectionCalendarSelectedTitle");
  const selectedSummary = document.getElementById("inspectionCalendarSelectedSummary");
  const selectedList = document.getElementById("inspectionCalendarSelectedList");
  const cycleDetails = document.getElementById("inspectionCalendarCycleDetails");
  const cycleCount = document.getElementById("inspectionCalendarCycleCount");
  const cycleCategory = document.getElementById("inspectionCalendarCycleCategory");
  const cycleList = document.getElementById("inspectionCalendarCycleList");
  const logCards = [...document.querySelectorAll("[data-inspection-category-item]")];
  const tabButtons = [...document.querySelectorAll("[data-inspection-category]")];

  if (!dashboard || !calendarGrid || !selectedList || !cycleList) {
    return;
  }

  const categoryLabels = {
    daily: "일일",
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

  const roleOrder = [
    "파트장",
    "TGO",
    "BCO1",
    "BCO2",
    "TO",
    "BO1",
    "BO2"
  ];

  const calendarFilterCategories = [
    "daily",
    "weekly",
    "monthly",
    "quarterly",
    "other"
  ];

/*
  달력 기본 표시:
  - 일일
  - 주간
  - 월간
  - 분기
  - 기타

  모든 점검 구분을 처음부터 체크하여
  해당 날짜의 점검을 빠짐없이 표시한다.
*/
let visibleCalendarCategories = new Set([
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "other"
]);

  let monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDateValue = formatDateValue(new Date());
  let statusMap = new Map();
  let statusLoading = false;

/*
  업무일지 저장과 기존 상태 조회가 겹쳤을 때
  새로고침 요청이 사라지지 않도록 보관한다.
*/
let statusRefreshRequested = false;

  let statusErrorMessage = "";

  /*
  메인 업무일지에서 선택한 날짜·근무

  값이 전달되기 전에는
  실제 현재 근무를 기준으로 사용한다.
*/
let roleSummaryContextOverride =
  null;


  /* =====================================================
    달력 구분 체크 필터

    기본:
    - 주간 체크
    - 월간 체크
  ====================================================== */

  function createCalendarCategoryFilter() {
    if (
      !calendarCard ||
      !calendarToolbar
    ) {
      return null;
    }

    const existingFilter = document.getElementById(
      "inspectionCalendarCategoryFilter"
    );

    if (existingFilter) {
      return existingFilter;
    }

    const filterElement = document.createElement("div");

    filterElement.className = "inspection-calendar-category-filter";
    filterElement.id = "inspectionCalendarCategoryFilter";

    filterElement.innerHTML = `
      <div class="inspection-calendar-category-filter__title">
        <strong>달력 표시</strong>
        <span>체크한 점검 구분만 달력과 날짜별 목록에 표시됩니다.</span>
      </div>

      <div class="inspection-calendar-category-filter__checks">
        ${calendarFilterCategories.map(category => {
          return `
            <label class="is-${category}">
              <input
                type="checkbox"
                value="${category}"
                data-inspection-calendar-category-filter
                ${visibleCalendarCategories.has(category) ? "checked" : ""}
              >

              <span>
                ${categoryLabels[category] || "기타"}
              </span>
            </label>
          `;
        }).join("")}
      </div>
    `;

    calendarToolbar.insertAdjacentElement(
      "afterend",
      filterElement
    );

    filterElement.addEventListener(
      "change",
      event => {
        const input = event.target instanceof HTMLInputElement
          ? event.target
          : null;

        if (
          !input ||
          !input.matches("[data-inspection-calendar-category-filter]")
        ) {
          return;
        }

        visibleCalendarCategories = new Set(
          [
            ...filterElement.querySelectorAll(
              "[data-inspection-calendar-category-filter]:checked"
            )
          ].map(item => String(item.value || "").trim())
        );

        renderCalendar();
        renderSelectedDate();
      }
    );

    return filterElement;
  }


  function isCalendarCategoryVisible(scheduleItem) {
    return visibleCalendarCategories.has(
      String(scheduleItem?.category || "").trim()
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDateValue(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function formatLongDate(date) {
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long"
    }).format(date);
  }

  function formatMonthTitle(date) {
    return new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "long"
    }).format(date);
  }

  function parseDateValue(value) {
    return createInspectionScheduleDate(value);
  }

  function normalizeShift(value) {
    const shift = String(value || "")
      .trim()
      .toUpperCase()
      .replaceAll("/", "")
      .replace(/\s+/g, "");

    if (["D", "DS"].includes(shift)) {
      return "DS";
    }

    if (["N", "NS"].includes(shift)) {
      return "NS";
    }

    return "";
  }

  function getShiftLabel(value) {
    const shift = normalizeShift(value);

    if (shift === "DS") {
      return "D/S";
    }

    if (shift === "NS") {
      return "N/S";
    }

    return "별도 지정";
  }

  function getSessionToken() {
    try {
      const savedUser = localStorage.getItem("gsShiftLog.currentUser");
      const currentUser = savedUser ? JSON.parse(savedUser) : null;

      return String(
        currentUser?.sessionToken ||
        currentUser?.session_token ||
        ""
      ).trim();
    } catch (error) {
      console.warn("점검 일정 로그인 정보 확인 실패:", error);
      return "";
    }
  }

  function getAuthHeaders(extraHeaders = {}) {
    const token = getSessionToken();

    return {
      Accept: "application/json",
      ...extraHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    };
  }

  async function readApiResponse(response) {
    const text = await response.text();
    let result = {};

    if (text.trim()) {
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error("점검 일정 서버 응답 형식이 올바르지 않습니다.");
      }
    }

    if (!response.ok || result.ok === false) {
      throw new Error(
        result.message ||
        result.error ||
        `점검 일정 요청에 실패했습니다. (HTTP ${response.status})`
      );
    }

    return result;
  }

  function createStatusKey(scheduleId, dueDate, shift) {
    return [
      String(scheduleId || "").trim(),
      String(dueDate || "").trim(),
      normalizeShift(shift)
    ].join("||");
  }

  function getCompletion(occurrence) {
    return statusMap.get(
      createStatusKey(
        occurrence.scheduleItem.id,
        occurrence.dueDate,
        occurrence.shift
      )
    ) || null;
  }

  function expandOccurrences(scheduleItem, dueDate) {
    const shifts = Array.isArray(scheduleItem?.shifts)
      ? [...new Set(scheduleItem.shifts.map(normalizeShift).filter(Boolean))]
      : [];

    return (shifts.length ? shifts : [""]).map(shift => ({
      scheduleItem,
      dueDate,
      shift
    }));
  }

  function getDateData(dateValue) {
    const result = getInspectionSchedulesForDate(dateValue);

    const visibleDueItems = result.dueItems.filter(
      isCalendarCategoryVisible
    );

    const visibleConditionalItems = result.conditionalItems.filter(
      isCalendarCategoryVisible
    );

    const required = visibleDueItems
      .filter(item => item.referenceOnly !== true)
      .flatMap(item => expandOccurrences(item, dateValue));

    const reference = visibleDueItems
      .filter(item => item.referenceOnly === true)
      .flatMap(item => expandOccurrences(item, dateValue));

    const conditional = visibleConditionalItems
      .flatMap(item => expandOccurrences(item, dateValue));

    return {
      scheduleItems: [
        ...visibleDueItems,
        ...visibleConditionalItems
      ],
      required,
      reference,
      conditional
    };
  }

  function normalizeAssignedRole(value) {
    const originalValue = String(value || "").trim();
    const comparableValue = originalValue
      .toUpperCase()
      .replace(/[\s_\-/]+/g, "");

    const roleMap = {
      "파트장": "파트장",
      "PARTLEADER": "파트장",
      "SHIFTLEADER": "파트장",
      "LEADER": "파트장",
      "TGO": "TGO",
      "BCO1": "BCO1",
      "BCO2": "BCO2",
      "TO": "TO",
      "BO1": "BO1",
      "BO2": "BO2"
    };

    return roleMap[originalValue] || roleMap[comparableValue] || "";
  }

  function getAssignedRoles(scheduleItem) {
    const assignedRoleSet = new Set(
      (Array.isArray(scheduleItem?.assignedRoles)
        ? scheduleItem.assignedRoles
        : []
      )
        .map(normalizeAssignedRole)
        .filter(Boolean)
    );

    return roleOrder.filter(role => assignedRoleSet.has(role));
  }

/* =====================================================
  보직별 점검 기준 날짜·근무

  우선순위:
  1. 메인 업무일지에서 선택한 날짜·근무
  2. 실제 현재 날짜·근무
====================================================== */

function getRoleTodayShiftContext() {
  /*
    메인 업무일지에서 날짜·근무가 전달된 경우
  */
  if (
    roleSummaryContextOverride?.workDate &&
    roleSummaryContextOverride?.shift
  ) {
    return {
      workDate:
        roleSummaryContextOverride.workDate,

      shift:
        roleSummaryContextOverride.shift,

      shiftLabel:
        getShiftLabel(
          roleSummaryContextOverride.shift
        )
    };
  }


  /*
    전달된 값이 없을 때만
    실제 현재 근무를 계산한다.
  */
  const now =
    new Date();


  const workDate =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );


  let shift =
    "DS";


  if (
    now.getHours() >=
    19
  ) {
    shift =
      "NS";

  } else if (
    now.getHours() <
    7
  ) {
    shift =
      "NS";


    workDate.setDate(
      workDate.getDate() -
      1
    );
  }


  return {
    workDate:
      formatDateValue(
        workDate
      ),

    shift,

    shiftLabel:
      getShiftLabel(
        shift
      )
  };
}


/* =====================================================
  이전 날짜 점검 표시 즉시 초기화
====================================================== */

function publishEmptyRoleInspectionSummary(
  context
) {
  if (
    !window.parent ||
    window.parent ===
      window
  ) {
    return;
  }


  window.parent.postMessage(
    {
      type:
        "gs-shift-log:inspection-role-today-summary",

      available:
        true,

      loading:
        true,

      workDate:
        context.workDate,

      shift:
        context.shift,

      shiftLabel:
        context.shiftLabel,

      roles:
        roleOrder.map(
          role => {
            return {
              role,

              totalCount:
                0,

              completedCount:
                0,

              pendingCount:
                0,

              items:
                []
            };
          }
        )
    },

    window.location.origin
  );
}


/* =====================================================
  메인 업무일지 선택 날짜·근무 적용
====================================================== */

async function applyRoleInspectionContext(
  workDateValue,
  shiftValue
) {
  const parsedDate =
    parseDateValue(
      workDateValue
    );


  const normalizedShift =
    normalizeShift(
      shiftValue
    );


  if (
    !parsedDate ||
    !normalizedShift
  ) {
    return;
  }


  const normalizedWorkDate =
    formatDateValue(
      parsedDate
    );


  roleSummaryContextOverride = {
    workDate:
      normalizedWorkDate,

    shift:
      normalizedShift
  };


  /*
    점검일지 전체보기를 열었을 때도
    업무일지에서 선택한 날짜가 보이게 한다.
  */
  selectedDateValue =
    normalizedWorkDate;


  monthCursor =
    new Date(
      parsedDate.getFullYear(),
      parsedDate.getMonth(),
      1
    );


  const context =
    getRoleTodayShiftContext();


  /*
    기존 날짜의 점검 배지를 먼저 지운다.
  */
  publishEmptyRoleInspectionSummary(
    context
  );


  /*
    이전 완료 기록 조회가 진행 중이면
    보직별 점검만 먼저 다시 계산한다.
  */
  if (
    statusLoading
  ) {
    renderCalendar();
    renderSelectedDate();


    await publishRoleTodaySummary();


    return;
  }


  /*
    선택 날짜의 완료 기록과
    보직별 점검을 다시 조회한다.
  */
  await refreshStatus();
}

  async function loadRoleTodayCompletionMap(workDate) {
    const url = new URL(STATUS_API, window.location.origin);
    url.searchParams.set("startDate", workDate);
    url.searchParams.set("endDate", workDate);
    url.searchParams.set("_", String(Date.now()));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: getAuthHeaders(),
      cache: "no-store"
    });

    const result = await readApiResponse(response);
    const completionMap = new Map();

    (Array.isArray(result.items) ? result.items : []).forEach(item => {
      completionMap.set(
        createStatusKey(item.scheduleId, item.dueDate, item.shift),
        item
      );
    });

    return completionMap;
  }

/* =========================================================
  선택 날짜·근무 점검 현황 전달

  전달 내용:
  - 보직별 오늘 점검
  - 업무일지 자동완료 판정용 전체 점검 목록

  전체 점검 목록은 담당 보직과 관계없이 전달한다.
  어떤 보직의 업무일지에서든 점검 수행 문구를
  인식할 수 있도록 하기 위함이다.
========================================================= */

async function publishRoleTodaySummary() {
  if (
    !window.parent ||
    window.parent ===
      window
  ) {
    return;
  }


  const context =
    getRoleTodayShiftContext();


  let scheduleOccurrences =
    [];


  try {
    const scheduleResult =
      getInspectionSchedulesForDate(
        context.workDate
      );


    /*
      타부서 참고 일정은 자동완료 대상에서 제외한다.

      포함:
      - 날짜가 확정된 점검
      - 조건부 점검
    */
    const todayScheduleItems = [
      ...scheduleResult.dueItems.filter(
        item => {
          return (
            item.referenceOnly !==
            true
          );
        }
      ),

      ...scheduleResult.conditionalItems.filter(
        item => {
          return (
            item.referenceOnly !==
            true
          );
        }
      )
    ];


    /*
      일정에 D/S·N/S가 모두 지정된 경우
      현재 선택 근무에 해당하는 일정만 남긴다.

      근무가 비어 있는 일정은
      D/S·N/S 공통 일정으로 유지한다.
    */
    const occurrences =
      todayScheduleItems
        .flatMap(
          scheduleItem => {
            return expandOccurrences(
              scheduleItem,
              context.workDate
            );
          }
        )
        .filter(
          occurrence => {
            const occurrenceShift =
              normalizeShift(
                occurrence.shift
              );


            return (
              !occurrenceShift ||
              occurrenceShift ===
                context.shift
            );
          }
        );


    /*
      일정 ID + 날짜 + 근무 기준 중복 제거
    */
    const uniqueOccurrences = [
      ...new Map(
        occurrences.map(
          occurrence => {
            const scheduleItem =
              occurrence.scheduleItem;


            const key =
              createStatusKey(
                scheduleItem.id,
                occurrence.dueDate,
                occurrence.shift
              );


            return [
              key,
              occurrence
            ];
          }
        )
      ).values()
    ];


    /*
      업무일지 자동완료 서버에 전달할
      최종 점검 목록

      assignedRoles는 화면 표시용 정보이며,
      자동완료 판정에서는 보직 제한을 걸지 않는다.
    */
    scheduleOccurrences =
      uniqueOccurrences.map(
        occurrence => {
          const scheduleItem =
            occurrence.scheduleItem;


          return {
            scheduleId:
              String(
                scheduleItem.id ||
                ""
              ).trim(),

            scheduleTitle:
              String(
                scheduleItem.title ||
                "점검 일정"
              ).trim(),

            dueDate:
              String(
                occurrence.dueDate ||
                context.workDate
              ).trim(),

            shift:
              normalizeShift(
                occurrence.shift
              ),

            category:
              String(
                scheduleItem.category ||
                "other"
              ).trim(),

            scheduleLabel:
              String(
                scheduleItem.scheduleLabel ||
                ""
              ).trim(),

            position:
              String(
                scheduleItem.position ||
                ""
              ).trim(),

            note:
              String(
                scheduleItem.note ||
                ""
              ).trim(),

            conditional:
              scheduleItem.conditional ===
                true,

            assignedRoles:
              getAssignedRoles(
                scheduleItem
              )
          };
        }
      )
      .filter(
        occurrence => {
          return Boolean(
            occurrence.scheduleId &&
            occurrence.scheduleTitle &&
            occurrence.dueDate
          );
        }
      );


    /*
      완료 상태 조회

      이 조회가 실패해도 위에서 만든
      scheduleOccurrences는 메인 화면에 전달한다.
    */
    const completionMap =
      await loadRoleTodayCompletionMap(
        context.workDate
      );


    const roles =
      roleOrder.map(
        role => {
          const roleItems =
            uniqueOccurrences
              .filter(
                occurrence => {
                  return getAssignedRoles(
                    occurrence.scheduleItem
                  ).includes(
                    role
                  );
                }
              )
              .map(
                occurrence => {
                  const scheduleItem =
                    occurrence.scheduleItem;


                  const completion =
                    completionMap.get(
                      createStatusKey(
                        scheduleItem.id,
                        occurrence.dueDate,
                        occurrence.shift
                      )
                    ) ||
                    null;


                  return {
                    scheduleId:
                      String(
                        scheduleItem.id ||
                        ""
                      ),

                    title:
                      String(
                        scheduleItem.title ||
                        "점검 일정"
                      ),

                    category:
                      String(
                        scheduleItem.category ||
                        "other"
                      ),

                    scheduleLabel:
                      String(
                        scheduleItem.scheduleLabel ||
                        ""
                      ),

                    dueDate:
                      occurrence.dueDate,

                    shift:
                      normalizeShift(
                        occurrence.shift
                      ),

                    shiftLabel:
                      getShiftLabel(
                        occurrence.shift
                      ),

                    position:
                      String(
                        scheduleItem.position ||
                        ""
                      ),

                    note:
                      String(
                        scheduleItem.note ||
                        ""
                      ),

                    conditional:
                      scheduleItem.conditional ===
                        true,

                    completed:
                      Boolean(
                        completion
                      ),

                    completedByName:
                      String(
                        completion
                          ?.completedByName ||
                        ""
                      ),

                    completedAt:
                      String(
                        completion
                          ?.completedAt ||
                        ""
                      ),

                    canOpenLog:
                      Boolean(
                        getLinkedCard(
                          scheduleItem
                        )
                      )
                  };
                }
              )
              .sort(
                (
                  firstItem,
                  secondItem
                ) => {
                  return (
                    (
                      categoryOrder[
                        firstItem.category
                      ] ||
                      99
                    ) -
                    (
                      categoryOrder[
                        secondItem.category
                      ] ||
                      99
                    )
                  ) ||
                  firstItem.title.localeCompare(
                    secondItem.title,
                    "ko"
                  );
                }
              );


          const completedCount =
            roleItems.filter(
              item => {
                return item.completed;
              }
            ).length;


          return {
            role,

            totalCount:
              roleItems.length,

            completedCount,

            pendingCount:
              roleItems.length -
              completedCount,

            items:
              roleItems
          };
        }
      );


    window.parent.postMessage(
      {
        type:
          "gs-shift-log:inspection-role-today-summary",

        available:
          true,

        workDate:
          context.workDate,

        shift:
          context.shift,

        shiftLabel:
          context.shiftLabel,

        roles,

        /*
          업무일지 자동완료용 전체 점검 목록
        */
        scheduleOccurrences
      },

      window.location.origin
    );

  } catch (
    error
  ) {
    console.error(
      "보직별 오늘 점검 현황 조회 실패:",
      error
    );


    /*
      완료 상태 조회가 실패해도
      계산에 성공한 점검 목록은 전달한다.
    */
    window.parent.postMessage(
      {
        type:
          "gs-shift-log:inspection-role-today-summary",

        available:
          false,

        workDate:
          context.workDate,

        shift:
          context.shift,

        shiftLabel:
          context.shiftLabel,

        errorMessage:
          error instanceof
            Error
            ? error.message
            : "오늘 점검 현황을 불러오지 못했습니다.",

        roles:
          [],

        scheduleOccurrences
      },

      window.location.origin
    );
  }
}

  async function loadStatusRecords() {
    const monthStart = formatDateValue(
      new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1)
    );

    const monthEnd = formatDateValue(
      new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0)
    );

    const startDate = monthStart < TRACKING_START_DATE
      ? TRACKING_START_DATE
      : monthStart;

    if (startDate > monthEnd) {
      statusMap = new Map();
      statusErrorMessage = "";
      return;
    }

    const url = new URL(STATUS_API, window.location.origin);
    url.searchParams.set("startDate", startDate);
    url.searchParams.set("endDate", monthEnd);
    url.searchParams.set("_", String(Date.now()));

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: getAuthHeaders(),
      cache: "no-store"
    });

    const result = await readApiResponse(response);
    const items = Array.isArray(result.items) ? result.items : [];

    statusMap = new Map();

    items.forEach(item => {
      statusMap.set(
        createStatusKey(item.scheduleId, item.dueDate, item.shift),
        item
      );
    });

    statusErrorMessage = "";
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

  function openLinkedLog(scheduleItem) {
    const card = getLinkedCard(scheduleItem);

    if (!card) {
      window.alert("연결된 전용 점검일지가 없습니다.");
      return;
    }

    const category = String(card.dataset.inspectionCategoryItem || "daily");
    const tabButton = tabButtons.find(button => {
      return button.dataset.inspectionCategory === category;
    });

    tabButton?.click();

    window.requestAnimationFrame(() => {
      card.click();
    });
  }

/* =========================================================
  캘린더용 점검명 약칭

  - 상세 목록에서는 원래 점검명을 그대로 사용
  - 월간 캘린더에서만 간략한 이름 사용
  - 약칭이 길면 마지막에 말줄임표 표시
  - 마우스를 올리면 전체 점검명 표시
========================================================= */

function getCalendarShortTitle(value) {
  const originalTitle = String(
    value || ""
  )
    .replace(/\s+/g, " ")
    .trim();


  if (!originalTitle) {
    return "점검";
  }


  /*
    자주 사용하는 긴 점검명은
    이해하기 쉬운 약칭으로 우선 변환한다.
  */

  const exactAliases = [
    {
      pattern:
        /^1\s*[,·]\s*2호기\s+유기성고형연료\s+Silo\s+Vent\s+Line\s+점검$/i,

      title:
        "1·2호기 Silo Vent 점검"
    },

    {
      pattern:
        /^고압가스\s+저장시설\s+주간점검(?:표)?$/i,

      title:
        "고압가스 주간점검"
    },

    {
      pattern:
        /^Bed\s+Ash\s+Bucket\s+Elevator\s+하부\s+점검\s*\(청소\)$/i,

      title:
        "Bed Ash B/E 하부점검"
    },

    {
      pattern:
        /^Aux\s+BLR\s+Air-?Comp(?:ressor)?\s+기능\s+Test\s+및\s+회전기기\s+Hand\s+Turning$/i,

      title:
        "Aux BLR Air-Comp Test"
    },

    {
      pattern:
        /^Lime\s+Slurry\s+Density\s+Meter\s+Flushing$/i,

      title:
        "Lime Slurry D/M Flushing"
    }
  ];


  const exactAlias =
    exactAliases.find(
      item => {
        return item.pattern.test(
          originalTitle
        );
      }
    );


  if (exactAlias) {
    return exactAlias.title;
  }


  /*
    그 외 점검명은 공통 단어를 자동 축약한다.
  */

  let shortTitle =
    originalTitle
      .replace(
        /1\s*[,·]\s*2호기/gi,
        "1·2호기"
      )
      .replace(
        /3\s*[,·]\s*4호기/gi,
        "3·4호기"
      )
      .replace(
        /유기성고형연료\s+/gi,
        ""
      )
      .replace(
        /Silo\s+Vent\s+Line/gi,
        "Silo Vent"
      )
      .replace(
        /Fly\s+Ash\s+Silo\s*,\s*Lime\s+Silo/gi,
        "Fly/Lime Silo"
      )
      .replace(
        /Bucket\s+Elevator/gi,
        "B/E"
      )
      .replace(
        /Density\s+Meter/gi,
        "D/M"
      )
      .replace(
        /Air[\s-]*Compressor/gi,
        "Air-Comp"
      )
      .replace(
        /Air[\s-]*Comp\./gi,
        "Air-Comp"
      )
      .replace(
        /\bBoiler\b/gi,
        "BLR"
      )
      .replace(
        /Off-Line\s+Mode\s+진행/gi,
        "Off-Line"
      )
      .replace(
        /기능\s+Test\s+및\s+회전기기\s+Hand\s+Turning/gi,
        "기능 Test"
      )
      .replace(
        /상부\s+Screen\s+이물질\s+청소/gi,
        "상부 Screen 청소"
      )
      .replace(
        /하부\s+점검\s*\(청소\)/gi,
        "하부점검"
      )
      .replace(
        /저장시설\s+주간점검표/gi,
        "주간점검"
      )
      .replace(
        /주간점검\s+일지/gi,
        "주간점검"
      )
      .replace(
        /주간점검일지/gi,
        "주간점검"
      )
      .replace(
        /점검\s+일지/gi,
        "점검"
      )
      .replace(
        /점검일지/gi,
        "점검"
      )
      .replace(
        /Return\s+Line/gi,
        "Return"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();


  /*
    약칭 변환 후 같은 단어가 반복된 경우 정리한다.
  */

  shortTitle =
    shortTitle
      .replace(
        /점검\s+점검/g,
        "점검"
      )
      .replace(
        /Air-Comp\s+Air-Comp/gi,
        "Air-Comp"
      )
      .trim();


  /*
    자동 축약 후에도 너무 긴 경우
    캘린더에서는 30자까지만 표시한다.

    전체 이름은 title 속성과
    아래 선택 날짜 상세 목록에서 확인할 수 있다.
  */

  const characters = [
    ...shortTitle
  ];

  const maximumLength =
    30;


  if (
    characters.length >
    maximumLength
  ) {
    return (
      characters
        .slice(
          0,
          maximumLength - 1
        )
        .join("") +
      "…"
    );
  }


  return (
    shortTitle ||
    originalTitle
  );
}


/* =========================================================
  날짜별 캘린더 표시 항목 생성

  - 외 N건으로 숨기지 않는다.
  - 일일점검 N건으로 묶지 않는다.
  - 해당 날짜의 모든 점검을 개별 표시한다.
========================================================= */

function getCalendarLines(scheduleItems) {
  const uniqueItems = [
    ...new Map(
      scheduleItems.map(
        item => {
          const uniqueKey =
            String(
              item.id ||
              item.title ||
              ""
            ).trim();


          return [
            uniqueKey,
            item
          ];
        }
      )
    ).values()
  ];


  return uniqueItems
    .slice()
    .sort(
      (
        firstItem,
        secondItem
      ) => {
        return (
          (
            categoryOrder[
              firstItem.category
            ] ||
            99
          ) -
          (
            categoryOrder[
              secondItem.category
            ] ||
            99
          )
        ) ||
        String(
          firstItem.title ||
          ""
        ).localeCompare(
          String(
            secondItem.title ||
            ""
          ),
          "ko"
        );
      }
    )
    .map(
      item => {
        const originalTitle =
          String(
            item.title ||
            "점검"
          ).trim();


        return {
          text:
            getCalendarShortTitle(
              originalTitle
            ),

          fullText:
            originalTitle,

          type:
            item.referenceOnly ===
            true
              ? "reference"
              : (
                  item.category ||
                  "other"
                )
        };
      }
    );
}


/* =========================================================
  월간 캘린더 출력
========================================================= */

function renderCalendar() {
  const todayValue =
    formatDateValue(
      new Date()
    );


  const firstDay =
    new Date(
      monthCursor.getFullYear(),
      monthCursor.getMonth(),
      1
    );


  const gridStart =
    new Date(
      firstDay.getFullYear(),
      firstDay.getMonth(),
      1 -
        firstDay.getDay()
    );


  if (
    calendarTitle
  ) {
    calendarTitle.textContent =
      formatMonthTitle(
        monthCursor
      );
  }


  const cells = [];


  for (
    let index = 0;
    index < 42;
    index += 1
  ) {
    const date =
      new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() +
          index
      );


    const dateValue =
      formatDateValue(
        date
      );


    const dateData =
      getDateData(
        dateValue
      );


    const completedCount =
      dateData.required.filter(
        getCompletion
      ).length;


    const pendingCount =
      dateData.required.length -
      completedCount;


    const isOutside =
      date.getMonth() !==
      monthCursor.getMonth();


    const isToday =
      dateValue ===
      todayValue;


    const isSelected =
      dateValue ===
      selectedDateValue;


    const isPastTracked =
      dateValue >=
        TRACKING_START_DATE &&
      dateValue <
        todayValue;


    const isOverdue =
      isPastTracked &&
      pendingCount >
        0;


    const isComplete =
      dateData.required.length >
        0 &&
      completedCount ===
        dateData.required.length;


    const classes = [
      "inspection-calendar-day",

      isOutside
        ? "is-outside"
        : "",

      isToday
        ? "is-today"
        : "",

      isSelected
        ? "is-selected"
        : "",

      dateData.scheduleItems.length
        ? "has-schedule"
        : "",

      isOverdue
        ? "has-overdue"
        : "",

      isComplete
        ? "is-complete"
        : "",

      dateData.conditional.length
        ? "has-conditional"
        : ""
    ]
      .filter(
        Boolean
      )
      .join(" ");


    /*
      모든 점검 일정을 개별 표시한다.
    */

    const calendarLines =
      getCalendarLines(
        dateData.scheduleItems
      );


    const previewHtml =
      calendarLines
        .map(
          line => {
            return `
              <span
                class="
                  inspection-calendar-day__item
                  is-${escapeHtml(
                    line.type
                  )}
                "
                title="${escapeHtml(
                  line.fullText
                )}"
                aria-label="${escapeHtml(
                  line.fullText
                )}"
              >
                ${escapeHtml(
                  line.text
                )}
              </span>
            `;
          }
        )
        .join("");


    /*
      예정 N건 표시는 모든 일정이 위에 보이므로 삭제한다.

      미완료·완료처럼 실제 상태 확인이 필요한 경우만
      하단에 표시한다.
    */

    let statusText =
      "";


    if (
      isOverdue
    ) {
      statusText =
        `미완료 ${pendingCount}건`;

    } else if (
      isComplete
    ) {
      statusText =
        "완료";

    } else if (
      isToday &&
      pendingCount >
        0
    ) {
      statusText =
        `미완료 ${pendingCount}건`;

    } else if (
      !dateData.required.length &&
      dateData.conditional.length
    ) {
      statusText =
        "조건 확인";
    }


    const totalScheduleCount =
      calendarLines.length;


    cells.push(`
      <button
        type="button"
        class="${classes}"
        data-inspection-calendar-date="${escapeHtml(
          dateValue
        )}"
        aria-selected="${
          isSelected
            ? "true"
            : "false"
        }"
        aria-label="${escapeHtml(
          [
            formatLongDate(
              date
            ),

            totalScheduleCount
              ? `점검 ${totalScheduleCount}건`
              : "점검 없음",

            statusText
          ]
            .filter(
              Boolean
            )
            .join(", ")
        )}"
      >
        <span
          class="inspection-calendar-day__number"
        >
          ${date.getDate()}
        </span>

        <span
          class="inspection-calendar-day__items"
        >
          ${previewHtml}
        </span>

        ${
          statusText
            ? `
                <span
                  class="inspection-calendar-day__status"
                >
                  ${escapeHtml(
                    statusText
                  )}
                </span>
              `
            : ""
        }
      </button>
    `);
  }


  calendarGrid.innerHTML =
    cells.join("");
}

  function getOccurrenceState(occurrence, options = {}) {
    if (getCompletion(occurrence)) {
      return "completed";
    }

    if (options.reference) {
      return "reference";
    }

    if (options.conditional) {
      return "conditional";
    }

    const todayValue = formatDateValue(new Date());

    if (
      occurrence.dueDate >= TRACKING_START_DATE &&
      occurrence.dueDate < todayValue
    ) {
      return "overdue";
    }

    if (occurrence.dueDate === todayValue) {
      return "today";
    }

    return "scheduled";
  }

  function createStatusActionHtml(occurrence, options = {}) {
    const completion = getCompletion(occurrence);
    const scheduleItem = occurrence.scheduleItem;

    if (scheduleItem.referenceOnly === true) {
      return `<span class="inspection-calendar-reference">타부서 참고</span>`;
    }

    if (completion) {
      const completedDate = new Date(completion.completedAt || 0);
      const completedAt = Number.isNaN(completedDate.getTime())
        ? ""
        : new Intl.DateTimeFormat("ko-KR", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
          }).format(completedDate);

      return `
        <span class="inspection-calendar-completion-info">
          ${escapeHtml(completion.completedByName || "완료자 확인 불가")}
          ${completedAt ? ` · ${escapeHtml(completedAt)}` : ""}
        </span>

        <button
          type="button"
          class="inspection-calendar-cancel-button"
          data-calendar-cancel="${escapeHtml(scheduleItem.id)}"
          data-due-date="${escapeHtml(occurrence.dueDate)}"
          data-shift="${escapeHtml(occurrence.shift)}"
        >
          완료 취소
        </button>
      `;
    }

    const label = options.conditional
      ? "해당 시 완료"
      : options.overdue
        ? "지연 점검 완료"
        : "완료 처리";

    return `
      <button
        type="button"
        class="inspection-calendar-complete-button"
        data-calendar-complete="${escapeHtml(scheduleItem.id)}"
        data-due-date="${escapeHtml(occurrence.dueDate)}"
        data-shift="${escapeHtml(occurrence.shift)}"
      >
        ${escapeHtml(label)}
      </button>
    `;
  }

  function createSelectedItemHtml(occurrence, options = {}) {
    const scheduleItem = occurrence.scheduleItem;
    const state = getOccurrenceState(occurrence, options);
    const stateLabels = {
      completed: "완료",
      reference: "참고",
      conditional: "조건 확인",
      overdue: "지연",
      today: "오늘 예정",
      scheduled: "예정"
    };

    const linkedCard = getLinkedCard(scheduleItem);

    return `
      <article class="inspection-calendar-selected-item is-${escapeHtml(state)}">
        <div class="inspection-calendar-selected-item__content">
          <div class="inspection-calendar-selected-item__badges">
            <span class="inspection-calendar-category is-${escapeHtml(scheduleItem.category)}">
              ${escapeHtml(categoryLabels[scheduleItem.category] || "기타")}
            </span>

            <span class="inspection-calendar-state is-${escapeHtml(state)}">
              ${escapeHtml(stateLabels[state] || "예정")}
            </span>
          </div>

          <strong>${escapeHtml(scheduleItem.title)}</strong>

          <span class="inspection-calendar-selected-item__meta">
            ${escapeHtml(getShiftLabel(occurrence.shift))}
            · ${escapeHtml(scheduleItem.position || "위치 미지정")}
            · ${escapeHtml(scheduleItem.scheduleLabel || "주기 미지정")}
          </span>

          ${scheduleItem.note ? `
            <small>${escapeHtml(scheduleItem.note)}</small>
          ` : ""}
        </div>

        <div class="inspection-calendar-selected-item__actions">
          ${linkedCard ? `
            <button
              type="button"
              class="inspection-calendar-log-button"
              data-calendar-open-log="${escapeHtml(scheduleItem.id)}"
            >
              점검일지 열기
            </button>
          ` : ""}

          ${createStatusActionHtml(occurrence, {
            ...options,
            overdue: state === "overdue"
          })}
        </div>
      </article>
    `;
  }

  function renderSelectedDate() {
    const selectedDate = parseDateValue(selectedDateValue);

    if (!selectedDate) {
      return;
    }

    const dateData = getDateData(selectedDateValue);
    const completedCount = dateData.required.filter(getCompletion).length;
    const pendingCount = dateData.required.length - completedCount;

    if (selectedTitle) {
      selectedTitle.textContent = formatLongDate(selectedDate);
    }

    if (selectedSummary) {
      const parts = [
        `점검 ${dateData.required.length}건`,
        `완료 ${completedCount}건`,
        `미완료 ${pendingCount}건`
      ];

      if (dateData.conditional.length) {
        parts.push(`조건 확인 ${dateData.conditional.length}건`);
      }

      if (dateData.reference.length) {
        parts.push(`참고 ${dateData.reference.length}건`);
      }

      if (statusErrorMessage) {
        parts.push(statusErrorMessage);
      }

      selectedSummary.textContent = parts.join(" · ");
    }

    const items = [
      ...dateData.required.map(occurrence => ({ occurrence })),
      ...dateData.conditional.map(occurrence => ({ occurrence, conditional: true })),
      ...dateData.reference.map(occurrence => ({ occurrence, reference: true }))
    ].sort((firstItem, secondItem) => {
      const stateOrder = {
        overdue: 1,
        today: 2,
        scheduled: 3,
        conditional: 4,
        reference: 5,
        completed: 6
      };

      const firstState = getOccurrenceState(firstItem.occurrence, firstItem);
      const secondState = getOccurrenceState(secondItem.occurrence, secondItem);
      const firstSchedule = firstItem.occurrence.scheduleItem;
      const secondSchedule = secondItem.occurrence.scheduleItem;

      return (
        (stateOrder[firstState] || 99) - (stateOrder[secondState] || 99) ||
        (categoryOrder[firstSchedule.category] || 99) -
          (categoryOrder[secondSchedule.category] || 99) ||
        String(firstSchedule.title || "").localeCompare(
          String(secondSchedule.title || ""),
          "ko"
        )
      );
    });

    selectedList.innerHTML = items.length
      ? items.map(item => createSelectedItemHtml(item.occurrence, item)).join("")
      : `
          <div class="inspection-calendar-empty">
            선택한 날짜에 예정된 점검이 없습니다.
          </div>
        `;
  }

  function renderCycleList() {
    const category = String(cycleCategory?.value || "").trim();

    const items = INSPECTION_SCHEDULE_MASTER
      .filter(item => !category || item.category === category)
      .slice()
      .sort((firstItem, secondItem) => {
        return (
          (categoryOrder[firstItem.category] || 99) -
          (categoryOrder[secondItem.category] || 99)
        ) || String(firstItem.title || "").localeCompare(
          String(secondItem.title || ""),
          "ko"
        );
      });

    if (cycleCount) {
      cycleCount.textContent = String(items.length);
    }

    cycleList.innerHTML = items.length
      ? items.map(item => {
          const shiftLabel = Array.isArray(item.shifts) && item.shifts.length
            ? item.shifts.join(" · ")
            : "별도 지정";
          const linkedCard = getLinkedCard(item);

          return `
            <article class="inspection-calendar-cycle-item">
              <span class="inspection-calendar-category is-${escapeHtml(item.category)}">
                ${escapeHtml(categoryLabels[item.category] || "기타")}
              </span>

              <div class="inspection-calendar-cycle-item__content">
                <strong>${escapeHtml(item.title)}</strong>
                <span>
                  ${escapeHtml(item.scheduleLabel || "주기 미지정")}
                  · ${escapeHtml(shiftLabel)}
                  · ${escapeHtml(item.position || "위치 미지정")}
                </span>
                ${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}
              </div>

              <div class="inspection-calendar-cycle-item__action">
                ${linkedCard ? `
                  <button
                    type="button"
                    class="inspection-calendar-log-button"
                    data-calendar-open-log="${escapeHtml(item.id)}"
                  >
                    점검일지 열기
                  </button>
                ` : `<span>전용 일지 없음</span>`}
              </div>
            </article>
          `;
        }).join("")
      : `
          <div class="inspection-calendar-empty">
            선택한 구분에 해당하는 점검주기가 없습니다.
          </div>
        `;
  }

  function renderAll() {
    renderCalendar();
    renderSelectedDate();
    renderCycleList();
  }


  /* =========================================================
  점검 완료 상태 새로고침

  조회 중 다시 요청이 들어오면:
  - 요청을 버리지 않는다.
  - 현재 조회가 끝난 뒤 한 번 더 조회한다.
========================================================= */

async function refreshStatus() {
  if (
    statusLoading
  ) {
    statusRefreshRequested =
      true;

    return;
  }


  statusLoading =
    true;

  statusRefreshRequested =
    false;


  calendarGrid.setAttribute(
    "aria-busy",
    "true"
  );

  selectedList.setAttribute(
    "aria-busy",
    "true"
  );


  try {
    await loadStatusRecords();

  } catch (
    error
  ) {
    console.error(
      "달력 점검 완료 기록 조회 실패:",
      error
    );


    statusMap =
      new Map();


    statusErrorMessage =
      error instanceof
        Error
        ? error.message
        : "점검 완료 기록을 불러오지 못했습니다.";

  } finally {
    statusLoading =
      false;


    calendarGrid.removeAttribute(
      "aria-busy"
    );

    selectedList.removeAttribute(
      "aria-busy"
    );


    /*
      월간 달력과 선택 날짜 상세를 갱신한다.
    */
    renderAll();


    /*
      메인 업무일지의 보직별 오늘 점검도
      새 완료 상태로 다시 전달한다.
    */
    await publishRoleTodaySummary();


    /*
      조회 중 들어온 새로고침 요청이 있으면
      최신 상태를 한 번 더 조회한다.
    */
    if (
      statusRefreshRequested
    ) {
      statusRefreshRequested =
        false;


      window.setTimeout(
        () => {
          void refreshStatus();
        },
        0
      );
    }
  }
}

  async function completeSchedule(button) {
    const scheduleId = String(button.dataset.calendarComplete || "").trim();
    const dueDate = String(button.dataset.dueDate || "").trim();
    const shift = normalizeShift(button.dataset.shift);
    const scheduleItem = INSPECTION_SCHEDULE_MASTER.find(item => item.id === scheduleId);

    if (!scheduleItem || !dueDate) {
      window.alert("완료 처리할 점검 정보를 확인할 수 없습니다.");
      return;
    }

    const confirmed = window.confirm([
      "점검을 완료 처리하시겠습니까?",
      "",
      scheduleItem.title,
      `예정일: ${dueDate}`,
      `근무: ${getShiftLabel(shift)}`
    ].join("\n"));

    if (!confirmed) {
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "처리 중...";

    try {
      const response = await fetch(STATUS_API, {
        method: "POST",
        headers: getAuthHeaders({ "Content-Type": "application/json" }),
        cache: "no-store",
        body: JSON.stringify({
          scheduleId,
          dueDate,
          shift,
          scheduleTitle: scheduleItem.title,
          note: ""
        })
      });

      const result = await readApiResponse(response);
      window.alert(result.message || "점검을 완료 처리했습니다.");
      await refreshStatus();
    } catch (error) {
      console.error("달력 점검 완료 처리 실패:", error);
      window.alert(error instanceof Error ? error.message : "점검을 완료 처리하지 못했습니다.");
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function cancelCompletion(button) {
    const scheduleId = String(button.dataset.calendarCancel || "").trim();
    const dueDate = String(button.dataset.dueDate || "").trim();
    const shift = normalizeShift(button.dataset.shift);
    const scheduleItem = INSPECTION_SCHEDULE_MASTER.find(item => item.id === scheduleId);

    if (!scheduleItem || !dueDate) {
      window.alert("완료 취소할 점검 정보를 확인할 수 없습니다.");
      return;
    }

    const confirmed = window.confirm([
      "점검 완료를 취소하시겠습니까?",
      "",
      scheduleItem.title,
      `예정일: ${dueDate}`,
      `근무: ${getShiftLabel(shift)}`
    ].join("\n"));

    if (!confirmed) {
      return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "취소 중...";

    try {
      const url = new URL(STATUS_API, window.location.origin);
      url.searchParams.set("scheduleId", scheduleId);
      url.searchParams.set("dueDate", dueDate);
      url.searchParams.set("shift", shift);

      const response = await fetch(url.toString(), {
        method: "DELETE",
        headers: getAuthHeaders(),
        cache: "no-store"
      });

      const result = await readApiResponse(response);
      window.alert(result.message || "점검 완료를 취소했습니다.");
      await refreshStatus();
    } catch (error) {
      console.error("달력 점검 완료 취소 실패:", error);
      window.alert(error instanceof Error ? error.message : "점검 완료를 취소하지 못했습니다.");
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  function handleActionClick(event) {
    const target = event.target instanceof Element ? event.target : null;

    const logButton = target?.closest("[data-calendar-open-log]");
    if (logButton) {
      const scheduleItem = INSPECTION_SCHEDULE_MASTER.find(item => {
        return item.id === String(logButton.dataset.calendarOpenLog || "");
      });
      openLinkedLog(scheduleItem);
      return;
    }

    const completeButton = target?.closest("[data-calendar-complete]");
    if (completeButton) {
      completeSchedule(completeButton);
      return;
    }

    const cancelButton = target?.closest("[data-calendar-cancel]");
    if (cancelButton) {
      cancelCompletion(cancelButton);
    }
  }

  calendarGrid.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    const dateButton = target?.closest("[data-inspection-calendar-date]");

    if (!dateButton) {
      return;
    }

    const nextDateValue = String(
      dateButton.dataset.inspectionCalendarDate || ""
    ).trim();
    const nextDate = parseDateValue(nextDateValue);

    if (!nextDate) {
      return;
    }

    selectedDateValue = nextDateValue;

    if (
      nextDate.getFullYear() !== monthCursor.getFullYear() ||
      nextDate.getMonth() !== monthCursor.getMonth()
    ) {
      monthCursor = new Date(nextDate.getFullYear(), nextDate.getMonth(), 1);
      refreshStatus();
      return;
    }

    renderCalendar();
    renderSelectedDate();
  });

  previousButton?.addEventListener("click", () => {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1);
    selectedDateValue = formatDateValue(monthCursor);
    refreshStatus();
  });

  nextButton?.addEventListener("click", () => {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1);
    selectedDateValue = formatDateValue(monthCursor);
    refreshStatus();
  });

  todayButton?.addEventListener("click", () => {
    const today = new Date();
    monthCursor = new Date(today.getFullYear(), today.getMonth(), 1);
    selectedDateValue = formatDateValue(today);
    refreshStatus();
  });

  selectedList.addEventListener("click", handleActionClick);
  cycleList.addEventListener("click", handleActionClick);
  cycleCategory?.addEventListener("change", renderCycleList);
  cycleDetails?.addEventListener("toggle", () => {
    if (cycleDetails.open) {
      renderCycleList();
    }
  });

/* =====================================================
  메인 업무일지와 점검 캘린더 통신
====================================================== */

window.addEventListener(
  "message",
  event => {
    if (
      event.origin !==
      window.location.origin
    ) {
      return;
    }


    const messageType =
      String(
        event.data?.type ||
        ""
      ).trim();


    /*
      메인 업무일지에서 선택한
      날짜·근무 적용
    */
    if (
      messageType ===
      "gs-shift-log:set-inspection-context"
    ) {
      void applyRoleInspectionContext(
        event.data?.workDate,
        event.data?.shift
      );


      return;
    }


    /*
      점검 일정 수정 후 새로고침
    */
    if (
      messageType ===
      "gs-shift-log:refresh-inspection-schedule"
    ) {
      void refreshStatus();
    }
  }
);


/*
  iframe 로딩 완료를 메인 업무일지에 전달한다.

  메인 업무일지는 이 메시지를 받으면
  현재 선택 날짜·근무를 다시 전송한다.
*/
if (
  window.parent &&
  window.parent !==
    window
) {
  window.parent.postMessage(
    {
      type:
        "gs-shift-log:inspection-calendar-ready"
    },

    window.location.origin
  );
}

  window.setInterval(
    () => {
      publishRoleTodaySummary();
    },
    300000
  );

  createCalendarCategoryFilter();

/*
  달력 데이터는 미리 준비하지만
  최초 화면에서는 표시하지 않는다.

  왼쪽의 '월간 달력' 버튼을 눌렀을 때
  inspection-navigation.js가 표시한다.
*/
dashboard.hidden =
  true;

  if (cycleDetails) {
    cycleDetails.open = false;
  }

  renderCycleList();
  refreshStatus();
}

/* =========================================================
  점검 일정 기본 데이터 준비 후 달력 실행

  관리자 API 완료 여부가 아니라
  기본 일정 함수가 준비됐는지를 확인한다.

  관리자 변경 일정은 나중에 갱신 메시지로 반영한다.
========================================================= */

async function waitForInspectionCalendarScheduleReady() {
  for (
    let attempt =
      0;

    attempt <
      60;

    attempt +=
      1
  ) {
    const scheduleMasterReady =
      typeof INSPECTION_SCHEDULE_MASTER !==
        "undefined" &&

      Array.isArray(
        INSPECTION_SCHEDULE_MASTER
      );


    const scheduleFunctionsReady =
      typeof getInspectionSchedulesForDate ===
        "function" &&

      typeof createInspectionScheduleDate ===
        "function";


    const elementsReady =
      Boolean(
        document.getElementById(
          "inspectionScheduleDashboard"
        )
      ) &&

      Boolean(
        document.getElementById(
          "inspectionCalendarGrid"
        )
      ) &&

      Boolean(
        document.getElementById(
          "inspectionCalendarSelectedList"
        )
      );


    if (
      scheduleMasterReady &&
      scheduleFunctionsReady &&
      elementsReady
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


  return false;
}


async function startInspectionCalendarDashboard() {
  if (
    window.__gsInspectionCalendarDashboardStarted ===
      true
  ) {
    return;
  }


  const ready =
    await waitForInspectionCalendarScheduleReady();


  if (
    !ready
  ) {
    console.error(
      "점검 달력 실행에 필요한 기본 일정 데이터를 찾지 못했습니다."
    );


    const calendarGrid =
      document.getElementById(
        "inspectionCalendarGrid"
      );


    const selectedList =
      document.getElementById(
        "inspectionCalendarSelectedList"
      );


    if (
      calendarGrid
    ) {
      calendarGrid.innerHTML = `
        <div class="inspection-calendar-empty">
          점검 일정 기본 데이터를 불러오지 못했습니다.
        </div>
      `;
    }


    if (
      selectedList
    ) {
      selectedList.innerHTML = `
        <div class="inspection-calendar-empty">
          점검 일정 파일 연결 상태를 확인해 주세요.
        </div>
      `;
    }


    return;
  }


  window.__gsInspectionCalendarDashboardStarted =
    true;


  initializeInspectionCalendarDashboard();
}


if (
  document.readyState ===
    "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    startInspectionCalendarDashboard,

    {
      once:
        true
    }
  );

} else {
  startInspectionCalendarDashboard();
}

async function startInspectionCalendarDashboard() {
  if (window.__gsInspectionCalendarDashboardStarted === true) {
    return;
  }

  window.__gsInspectionCalendarDashboardStarted = true;

  await waitForInspectionCalendarScheduleReady();
  initializeInspectionCalendarDashboard();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    startInspectionCalendarDashboard,
    { once: true }
  );
} else {
  startInspectionCalendarDashboard();
}

/* =========================================================
  전체 점검주기 목록 표시 정리

  적용 내용:
  1. "수정됨" 배지 제거
  2. "담당" 표시를 점검명 오른쪽으로 이동
  3. "점검일지 열기" 버튼 제거

  주의:
  - 일정 수정 데이터와 revision은 삭제하지 않는다.
  - 전체 점검주기 목록의 화면 표시만 정리한다.
========================================================= */

function initializeInspectionCycleListDisplayCleanup() {
  /*
    중복 실행 방지
  */
  if (
    window
      .__inspectionCycleListDisplayCleanupStarted ===
    true
  ) {
    return;
  }


  window
    .__inspectionCycleListDisplayCleanupStarted =
    true;


  const cycleList =
    document.getElementById(
      "inspectionCalendarCycleList"
    );


  if (
    !cycleList
  ) {
    console.warn(
      "전체 점검주기 목록을 찾지 못했습니다."
    );


    return;
  }


  let cleanupFrameId =
    0;


  /* =====================================================
    화면 문구 정리
  ====================================================== */

  function normalizeCycleText(
    value
  ) {
    return String(
      value ||
      ""
    )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }


  /* =====================================================
    점검명 요소 찾기
  ====================================================== */

  function findInspectionCycleTitle(
    row
  ) {
    const candidates = [
      ...row.querySelectorAll(
        `
          [data-inspection-title],
          .inspection-calendar-cycle-item__title,
          .inspection-schedule-title,
          h3,
          strong
        `
      )
    ];


    return (
      candidates.find(
        element => {
          const text =
            normalizeCycleText(
              element.textContent
            );


          if (
            !text
          ) {
            return false;
          }


          return ![
            "수정됨",
            "담당",
            "점검일지 열기",
            "일간",
            "주간",
            "월간",
            "분기",
            "기타",
            "수정"
          ].includes(
            text
          );
        }
      ) ||
      null
    );
  }


  /* =====================================================
    담당 표시 영역 찾기
  ====================================================== */

  function findInspectionCycleAssignee(
    row,
    titleElement
  ) {
    const candidates = [
      ...row.querySelectorAll(
        `
          span,
          small,
          p,
          div
        `
      )
    ]
      .filter(
        element => {
          const text =
            normalizeCycleText(
              element.textContent
            );


          if (
            !text.startsWith(
              "담당"
            ) ||
            text.length >
              50
          ) {
            return false;
          }


          /*
            점검명까지 포함하고 있는 큰 영역은 제외한다.
          */
          if (
            titleElement &&
            element.contains(
              titleElement
            )
          ) {
            return false;
          }


          if (
            element.querySelector(
              "button"
            )
          ) {
            return false;
          }


          return true;
        }
      );


    /*
      "담당 TO"처럼 담당자까지 포함된 요소를 우선 사용한다.
    */
    const combinedElement =
      candidates.find(
        element => {
          return (
            normalizeCycleText(
              element.textContent
            ) !==
            "담당"
          );
        }
      );


    if (
      combinedElement
    ) {
      return combinedElement;
    }


    const labelElement =
      candidates.find(
        element => {
          return (
            normalizeCycleText(
              element.textContent
            ) ===
            "담당"
          );
        }
      );


    if (
      !labelElement
    ) {
      return null;
    }


    const parentElement =
      labelElement.parentElement;


    /*
      담당 배지와 보직명이 같은 전용 부모에 들어 있다면
      부모 전체를 이동한다.
    */
    if (
      parentElement &&
      parentElement !==
        row &&
      ![
        "TD",
        "TR",
        "ARTICLE"
      ].includes(
        parentElement.tagName
      ) &&
      !(
        titleElement &&
        parentElement.contains(
          titleElement
        )
      )
    ) {
      const parentText =
        normalizeCycleText(
          parentElement.textContent
        );


      if (
        parentText.startsWith(
          "담당"
        ) &&
        parentText.length <=
          50
      ) {
        return parentElement;
      }
    }


    return labelElement;
  }


  /* =====================================================
    한 행의 표시 정리
  ====================================================== */

  function cleanupInspectionCycleRow(
    row
  ) {
    /*
      [수정됨] 배지 제거
    */
    row
      .querySelectorAll(
        `
          span,
          small,
          em,
          b
        `
      )
      .forEach(
        element => {
          if (
            normalizeCycleText(
              element.textContent
            ) ===
            "수정됨"
          ) {
            element.remove();
          }
        }
      );


    /*
      점검일지 열기 버튼 제거
    */
    row
      .querySelectorAll(
        `
          button,
          a
        `
      )
      .forEach(
        element => {
          if (
            normalizeCycleText(
              element.textContent
            ) ===
            "점검일지 열기"
          ) {
            element.remove();
          }
        }
      );


    const titleElement =
      findInspectionCycleTitle(
        row
      );


    if (
      !titleElement
    ) {
      return;
    }


    const assigneeElement =
      findInspectionCycleAssignee(
        row,
        titleElement
      );


    if (
      !assigneeElement
    ) {
      return;
    }


    /*
      이미 정리된 경우 중복 이동하지 않는다.
    */
    let titleLine =
      titleElement.closest(
        ".inspection-cycle-title-line"
      );


    if (
      !titleLine
    ) {
      titleLine =
        document.createElement(
          "div"
        );


      titleLine.className =
        "inspection-cycle-title-line";


      titleElement
        .parentElement
        ?.insertBefore(
          titleLine,
          titleElement
        );


      titleLine.appendChild(
        titleElement
      );
    }


    assigneeElement.classList.add(
      "inspection-cycle-inline-assignee"
    );


    if (
      !titleLine.contains(
        assigneeElement
      )
    ) {
      titleLine.appendChild(
        assigneeElement
      );
    }
  }


  /* =====================================================
    전체 목록 정리
  ====================================================== */

  function cleanupInspectionCycleList() {
    const tableRows = [
      ...cycleList.querySelectorAll(
        "tbody tr"
      )
    ];


    const cardRows = [
      ...cycleList.querySelectorAll(
        `
          .inspection-calendar-cycle-item,
          article
        `
      )
    ];


    const rows =
      tableRows.length
        ? tableRows
        : cardRows;


    rows.forEach(
      cleanupInspectionCycleRow
    );


    /*
      혹시 별도 클래스 버튼으로 남아 있는 경우도 숨긴다.
    */
    cycleList
      .querySelectorAll(
        `
          .inspection-calendar-log-button,
          [data-calendar-open-log]
        `
      )
      .forEach(
        button => {
          button.remove();
        }
      );
  }


  /* =====================================================
    목록이 다시 그려질 때 재적용
  ====================================================== */

  function requestInspectionCycleCleanup() {
    if (
      cleanupFrameId
    ) {
      return;
    }


    cleanupFrameId =
      window.requestAnimationFrame(
        () => {
          cleanupFrameId =
            0;


          cleanupInspectionCycleList();
        }
      );
  }


  const observer =
    new MutationObserver(
      requestInspectionCycleCleanup
    );


  observer.observe(
    cycleList,
    {
      childList:
        true,

      subtree:
        true
    }
  );


  requestInspectionCycleCleanup();
}


/* =========================================================
  실행
========================================================= */

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initializeInspectionCycleListDisplayCleanup,
    {
      once:
        true
    }
  );

} else {
  initializeInspectionCycleListDisplayCleanup();
}
