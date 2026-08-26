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

/* =========================================================
  선택 날짜 점검 영역 DOM
========================================================= */

const selectedSection =
  document.getElementById(
    "inspectionCalendarSelectedSection"
  );


const selectedTitle =
  document.getElementById(
    "inspectionCalendarSelectedTitle"
  );


const selectedSummary =
  document.getElementById(
    "inspectionCalendarSelectedSummary"
  );


const selectedList =
  document.getElementById(
    "inspectionCalendarSelectedList"
  );

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

/* =========================================================
  달력 점검항목의 실제 완료 ID

  일반 일정:
  weekly-lng-system

  1호기 일정:
  weekly-sda-hopper-ash::unit1

  2호기 일정:
  weekly-sda-hopper-ash::unit2
========================================================= */

function getInspectionCalendarOccurrenceScheduleId(
  occurrence
) {
  const explicitScheduleId =
    String(
      occurrence?.completionScheduleId ||
      ""
    ).trim();


  if (
    explicitScheduleId
  ) {
    return explicitScheduleId;
  }


  const baseScheduleId =
    String(
      occurrence?.scheduleItem?.id ||
      ""
    ).trim();


  if (
    !baseScheduleId
  ) {
    return "";
  }


  /*
    이미 호기 ID가 붙어 있으면
    중복으로 다시 붙이지 않는다.
  */
  if (
    /::unit[12]$/i.test(
      baseScheduleId
    )
  ) {
    return baseScheduleId;
  }


  const unitNo =
    Number(
      occurrence?.unitNo ||
      0
    );


  return [
    1,
    2
  ].includes(
    unitNo
  )
    ? `${baseScheduleId}::unit${unitNo}`
    : baseScheduleId;
}


/* =========================================================
  점검 완료 기록 조회

  occurrence에 호기가 있으면
  해당 호기 완료 기록만 조회한다.

  중요:
  호기 분리 일정에서 기존 기본 ID를
  대체 완료값으로 인정하지 않는다.
========================================================= */

function getCompletion(
  occurrence
) {
  const completionScheduleId =
    getInspectionCalendarOccurrenceScheduleId(
      occurrence
    );


  if (
    !completionScheduleId
  ) {
    return null;
  }


  return (
    statusMap.get(
      createStatusKey(
        completionScheduleId,
        occurrence?.dueDate,
        occurrence?.shift
      )
    ) ||
    null
  );
}

/* =========================================================
  일정 항목을 근무·호기별로 분리

  일반 일정:
  - D/S 또는 N/S 한 건

  보일러 호기 분리 일정:
  - 1호기 한 건
  - 2호기 한 건

  예:
  SDA Hopper Ash D/S

  결과:
  - weekly-sda-hopper-ash::unit1
  - weekly-sda-hopper-ash::unit2
========================================================= */

function expandOccurrences(
  scheduleItem,
  dueDate
) {
  const shifts =
    Array.isArray(
      scheduleItem?.shifts
    )
      ? [
          ...new Set(
            scheduleItem.shifts
              .map(
                normalizeShift
              )
              .filter(
                Boolean
              )
          )
        ]
      : [];


  const effectiveShifts =
    shifts.length
      ? shifts
      : [
          ""
        ];


  /*
    BCO1·BO1과 BCO2·BO2 담당이 함께 있는
    보일러 일정은 두 호기로 펼친다.
  */
  const unitNumbers =
    isInspectionCalendarUnitSeparatedSchedule(
      scheduleItem
    )
      ? [
          1,
          2
        ]
      : [
          0
        ];


  const baseScheduleId =
    String(
      scheduleItem?.id ||
      ""
    ).trim();


  return effectiveShifts.flatMap(
    shift => {
      return unitNumbers.map(
        unitNo => {
          return {
            scheduleItem,

            dueDate,

            shift,

            unitNo,

            unitLabel:
              unitNo ===
                1
                ? "1호기"
                : unitNo ===
                    2
                  ? "2호기"
                  : "",

            completionScheduleId:
              unitNo ===
                1 ||
              unitNo ===
                2
                ? `${baseScheduleId}::unit${unitNo}`
                : baseScheduleId
          };
        }
      );
    }
  );
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

/* =========================================================
  보직별 담당 호기

  1호기:
  - BCO1
  - BO1

  2호기:
  - BCO2
  - BO2

  터빈·공통:
  - TGO
  - TO
  - 파트장

  반환:
  - 1
  - 2
  - 0
========================================================= */

function getInspectionCalendarRoleUnit(
  role
) {
  const normalizedRole =
    normalizeAssignedRole(
      role
    );


  if (
    [
      "BCO1",
      "BO1"
    ].includes(
      normalizedRole
    )
  ) {
    return 1;
  }


  if (
    [
      "BCO2",
      "BO2"
    ].includes(
      normalizedRole
    )
  ) {
    return 2;
  }


  return 0;
}


/* =========================================================
  1·2호기 분리 일정인지 확인

  담당 보직에 아래가 함께 존재하면
  호기별 독립 일정으로 판단한다.

  - 1호기 보직: BCO1 또는 BO1
  - 2호기 보직: BCO2 또는 BO2
========================================================= */

function isInspectionCalendarUnitSeparatedSchedule(
  scheduleItem
) {
  const assignedRoles =
    getAssignedRoles(
      scheduleItem
    );


  const assignedUnits =
    new Set(
      assignedRoles
        .map(
          getInspectionCalendarRoleUnit
        )
        .filter(
          unitNo => {
            return (
              unitNo ===
                1 ||
              unitNo ===
                2
            );
          }
        )
    );


  return (
    assignedUnits.has(
      1
    ) &&
    assignedUnits.has(
      2
    )
  );
}


/* =========================================================
  보직별 실제 완료 기록 ID

  예:

  SDA Hopper Ash 일정
  weekly-sda-hopper-ash

  BCO1 / BO1:
  weekly-sda-hopper-ash::unit1

  BCO2 / BO2:
  weekly-sda-hopper-ash::unit2

  TGO / TO:
  원래 일정 ID 그대로 사용
========================================================= */

function getInspectionCalendarCompletionScheduleId(
  scheduleItem,
  role
) {
  const baseScheduleId =
    String(
      scheduleItem?.id ||
      ""
    ).trim();


  if (
    !baseScheduleId
  ) {
    return "";
  }


  /*
    일정 ID가 이미 호기별 ID라면
    중복으로 ::unit1을 붙이지 않는다.
  */
  if (
    /::unit[12]$/i.test(
      baseScheduleId
    )
  ) {
    return baseScheduleId;
  }


  /*
    호기 분리 대상이 아니면
    기존 일정 ID를 그대로 사용한다.
  */
  if (
    !isInspectionCalendarUnitSeparatedSchedule(
      scheduleItem
    )
  ) {
    return baseScheduleId;
  }


  const unitNo =
    getInspectionCalendarRoleUnit(
      role
    );


  if (
    unitNo !==
      1 &&
    unitNo !==
      2
  ) {
    return baseScheduleId;
  }


  return `${baseScheduleId}::unit${unitNo}`;
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


  /*
    이미 적용돼 있던 context와 실제로 달라질 때만
    기존 날짜의 점검 배지를 비운다.

    최초 진입과 같은 날짜·근무 재전송에서는
    빈 summary를 보내지 않는다.
  */
  const previousWorkDate =
    String(
      roleSummaryContextOverride
        ?.workDate ||
      ""
    ).trim();


  const previousShift =
    normalizeShift(
      roleSummaryContextOverride
        ?.shift ||
      ""
    );


  const contextChanged =
    Boolean(
      previousWorkDate &&
      previousShift &&
      (
        previousWorkDate !==
          normalizedWorkDate ||

        previousShift !==
          normalizedShift
      )
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
    날짜 또는 근무가 실제로 바뀐 경우에만
    이전 context의 점검 배지를 먼저 지운다.
  */
  if (
    contextChanged
  ) {
    publishEmptyRoleInspectionSummary(
      context
    );
  }


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
  보직별 오늘 점검 현황 전달

  완료 조회 규칙:

  TGO / TO:
  - 원래 일정 ID 사용

  BCO1 / BO1:
  - 1호기 완료 ID 사용
  - scheduleId::unit1

  BCO2 / BO2:
  - 2호기 완료 ID 사용
  - scheduleId::unit2

  중요:
  호기 분리 일정에서는 기존 기본 scheduleId를
  대체 완료값으로 사용하지 않는다.

  기존 ID를 대신 인정하면
  다시 1호기 수행으로 2호기까지 완료되는 문제가
  발생하기 때문이다.
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


  try {
    /*
      서버에서 실제 완료 기록을 불러온다.

      Map에는 다음 ID가 그대로 저장된다.

      일반 일정:
      weekly-lng-system

      호기별 일정:
      weekly-sda-hopper-ash::unit1
      weekly-sda-hopper-ash::unit2
    */
    const completionMap =
      await loadRoleTodayCompletionMap(
        context.workDate
      );


    const scheduleResult =
      getInspectionSchedulesForDate(
        context.workDate
      );


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
      오늘 날짜·현재 근무의 실제 점검 일정
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
      같은 일정·날짜·근무 중복 제거
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
      기존 업무일지 재검사용 일정 목록

      여기에는 원래 일정 ID를 전달한다.
      서버 내부에서 담당 보직과 1·2호기를 다시 나눈다.
    */
    const scheduleOccurrences =
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
              )
          };
        }
      );


    /*
      보직별 점검 목록 및 완료 상태
    */
    const roles =
      roleOrder.map(
        role => {
          const roleUnitNo =
            getInspectionCalendarRoleUnit(
              role
            );


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


                  const baseScheduleId =
                    String(
                      scheduleItem.id ||
                      ""
                    ).trim();


                  const unitSeparated =
                    isInspectionCalendarUnitSeparatedSchedule(
                      scheduleItem
                    );


                  /*
                    현재 보직이 조회해야 하는
                    실제 D1 완료 기록 ID
                  */
                  const completionScheduleId =
                    getInspectionCalendarCompletionScheduleId(
                      scheduleItem,
                      role
                    );


                  /*
                    중요:

                    호기 분리 일정은 해당 호기 ID만 조회한다.

                    BCO1 / BO1:
                    ::unit1

                    BCO2 / BO2:
                    ::unit2

                    기본 일정 ID로 다시 조회하는
                    fallback은 사용하지 않는다.
                  */
                  const completion =
                    completionMap.get(
                      createStatusKey(
                        completionScheduleId,
                        occurrence.dueDate,
                        occurrence.shift
                      )
                    ) ||
                    null;


                  const unitNo =
                    unitSeparated
                      ? roleUnitNo
                      : 0;


                  return {
                    /*
                      화면과 재검사에서 사용하는
                      원래 일정 ID
                    */
                    scheduleId:
                      baseScheduleId,


                    /*
                      실제 완료 기록 조회에 사용한 ID
                    */
                    completionScheduleId,


                    unitSeparated,

                    unitNo,

                    unitLabel:
                      unitNo
                        ? `${unitNo}호기`
                        : "",


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


                    /*
                      완료 상태
                    */
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

                    completionSource:
                      String(
                        completion
                          ?.completionSource ||
                        ""
                      ),

                    isAutomatic:
                      completion
                        ?.isAutomatic ===
                      true,

                    sourceRole:
                      String(
                        completion
                          ?.sourceRole ||
                        ""
                      ),

                    sourceText:
                      String(
                        completion
                          ?.sourceText ||
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
                    ) ||

                    firstItem.title
                      .localeCompare(
                        secondItem.title,
                        "ko"
                      )
                  );
                }
              );


          const completedCount =
            roleItems.filter(
              item => {
                return (
                  item.completed ===
                  true
                );
              }
            ).length;


          return {
            role,

            unitNo:
              roleUnitNo,

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

        /*
          메인 script.js의 기존 업무일지 재검사에도 사용
        */
        scheduleOccurrences,

        roles
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

        scheduleOccurrences:
          [],

        roles:
          []
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
    의미가 같은 긴 표현만 위에서 약칭으로 정리한다.
    글자 수를 기준으로 강제 생략하지 않아 달력 안에서도
    점검 항목의 전체 내용을 확인할 수 있게 한다.
  */

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

/* =========================================================
  점검 완료 시간 표시
========================================================= */

function formatInspectionCalendarCompletionDateTime(
  value
) {
  const date =
    new Date(
      value ||
      0
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    return "";
  }


  return new Intl.DateTimeFormat(
    "ko-KR",
    {
      year:
        "2-digit",

      month:
        "2-digit",

      day:
        "2-digit",

      hour:
        "2-digit",

      minute:
        "2-digit",

      hour12:
        false
    }
  ).format(
    date
  );
}


/* =========================================================
  완료 정보 출력

  자동완료:
  - 근거 업무일지 보직·작성자·문구 표시
  - 근거 업무일지 열기 버튼 표시
  - 완료 취소 버튼은 표시하지 않음

  수동완료:
  - 완료자·완료시간 표시
  - 완료 취소 버튼 표시
========================================================= */

function createInspectionCalendarCompletionHtml(
  occurrence,
  completion
) {
  const scheduleItem =
    occurrence.scheduleItem;


  const completedAt =
    formatInspectionCalendarCompletionDateTime(
      completion?.completedAt
    );


  const isAutomatic =
    completion?.isAutomatic ===
      true ||

    String(
      completion?.completionSource ||
      ""
    )
      .trim()
      .toLowerCase() ===
        "shift_log";


  /* =====================================================
    업무일지 자동완료
  ====================================================== */

  if (
    isAutomatic
  ) {
    const sourceLogId =
      String(
        completion?.sourceLogId ||
        ""
      ).trim();


    const sourceRole =
      String(
        completion?.sourceRole ||
        ""
      ).trim();


    const sourceAuthor =
      String(
        completion?.sourceAuthor ||
        completion?.completedByName ||
        ""
      ).trim();


    const sourceText =
      String(
        completion?.sourceText ||
        ""
      ).trim();


    const sourceMeta = [
      sourceRole,
      sourceAuthor,
      completedAt
    ]
      .filter(
        Boolean
      )
      .join(
        " · "
      );


    return `
      <div
        class="
          inspection-calendar-completion
          is-automatic
        "
      >

        <div class="inspection-calendar-completion__heading">

          <span class="inspection-calendar-completion__badge">
            업무일지 자동완료
          </span>

          ${
            sourceMeta
              ? `
                <span class="inspection-calendar-completion__meta">
                  ${escapeHtml(
                    sourceMeta
                  )}
                </span>
              `
              : ""
          }

        </div>


        ${
          sourceText
            ? `
              <p class="inspection-calendar-completion__source-text">

                <b>
                  근거
                </b>

                <span>
                  ${escapeHtml(
                    sourceText
                  )}
                </span>

              </p>
            `
            : ""
        }


        <div class="inspection-calendar-completion__footer">

          ${
            sourceLogId
              ? `
                <button
                  type="button"
                  class="inspection-calendar-source-log-button"
                  data-calendar-open-source-log="${escapeHtml(
                    sourceLogId
                  )}"
                  data-work-date="${escapeHtml(
                    occurrence.dueDate
                  )}"
                  data-shift="${escapeHtml(
                    occurrence.shift
                  )}"
                >
                  근거 업무일지 열기
                </button>
              `
              : ""
          }


          <span class="inspection-calendar-completion__guide">
            원본 업무일지를 수정하거나 삭제하면 완료 상태가 자동으로 다시 계산됩니다.
          </span>

        </div>

      </div>
    `;
  }


  /* =====================================================
    사용자 수동완료
  ====================================================== */

  const completedBy =
    String(
      completion?.completedByName ||
      "완료자 확인 불가"
    ).trim();


  const completionMeta = [
    completedBy,
    completedAt
  ]
    .filter(
      Boolean
    )
    .join(
      " · "
    );


  return `
    <div
      class="
        inspection-calendar-completion
        is-manual
      "
    >

      <div class="inspection-calendar-completion__heading">

        <span class="inspection-calendar-completion__badge">
          수동 완료
        </span>

        <span class="inspection-calendar-completion__meta">
          ${escapeHtml(
            completionMeta
          )}
        </span>

      </div>


      <div class="inspection-calendar-completion__footer">

        <button
          type="button"
          class="inspection-calendar-cancel-button"
          data-calendar-cancel="${escapeHtml(
            scheduleItem.id
          )}"
          data-due-date="${escapeHtml(
            occurrence.dueDate
          )}"
          data-shift="${escapeHtml(
            occurrence.shift
          )}"
        >
          완료 취소
        </button>

      </div>

    </div>
  `;
}

/* =========================================================
  완료·완료취소 버튼

  일반 일정:
  기본 일정 ID 사용

  보일러 일정:
  ::unit1 또는 ::unit2 사용

  업무일지 자동완료:
  원본 업무일지를 수정해야 해제되므로
  달력에 완료취소 버튼을 표시하지 않는다.
========================================================= */

function createStatusActionHtml(
  occurrence,
  options = {}
) {
  const completion =
    getCompletion(
      occurrence
    );


  const scheduleItem =
    occurrence.scheduleItem;


  const completionScheduleId =
    getInspectionCalendarOccurrenceScheduleId(
      occurrence
    );


  const baseScheduleId =
    String(
      scheduleItem?.id ||
      ""
    ).trim();


  const unitNo =
    Number(
      occurrence?.unitNo ||
      0
    );


  if (
    scheduleItem.referenceOnly ===
      true
  ) {
    return `
      <span class="inspection-calendar-reference">
        타부서 참고
      </span>
    `;
  }


  if (
    completion
  ) {
    const completedDate =
      new Date(
        completion.completedAt ||
        0
      );


    const completedAt =
      Number.isNaN(
        completedDate.getTime()
      )
        ? ""
        : new Intl.DateTimeFormat(
            "ko-KR",
            {
              month:
                "2-digit",

              day:
                "2-digit",

              hour:
                "2-digit",

              minute:
                "2-digit",

              hour12:
                false
            }
          ).format(
            completedDate
          );


    const isAutomatic =
      completion.isAutomatic ===
        true ||

      String(
        completion.completionSource ||
        ""
      ).toLowerCase() ===
        "shift_log";


    return `
      <span class="inspection-calendar-completion-info">
        ${escapeHtml(
          completion.completedByName ||
          "완료자 확인 불가"
        )}

        ${
          completedAt
            ? ` · ${escapeHtml(
                completedAt
              )}`
            : ""
        }
      </span>

      ${
        isAutomatic
          ? `
              <span class="inspection-calendar-reference">
                업무일지 자동완료
              </span>
            `
          : `
              <button
                type="button"
                class="inspection-calendar-cancel-button"
                data-calendar-cancel="${escapeHtml(
                  completionScheduleId
                )}"
                data-base-schedule-id="${escapeHtml(
                  baseScheduleId
                )}"
                data-unit-no="${escapeHtml(
                  unitNo
                )}"
                data-due-date="${escapeHtml(
                  occurrence.dueDate
                )}"
                data-shift="${escapeHtml(
                  occurrence.shift
                )}"
              >
                완료 취소
              </button>
            `
      }
    `;
  }


  const label =
    options.conditional
      ? "해당 시 완료"
      : options.overdue
        ? "지연 점검 완료"
        : "완료 처리";


  return `
    <button
      type="button"
      class="inspection-calendar-complete-button"
      data-calendar-complete="${escapeHtml(
        completionScheduleId
      )}"
      data-base-schedule-id="${escapeHtml(
        baseScheduleId
      )}"
      data-unit-no="${escapeHtml(
        unitNo
      )}"
      data-due-date="${escapeHtml(
        occurrence.dueDate
      )}"
      data-shift="${escapeHtml(
        occurrence.shift
      )}"
    >
      ${escapeHtml(
        label
      )}
    </button>
  `;
}

/* =========================================================
  선택 날짜 점검항목 출력

  보일러 일정은
  1호기와 2호기를 별도 행으로 표시한다.
========================================================= */

function createSelectedItemHtml(
  occurrence,
  options = {}
) {
  const scheduleItem =
    occurrence.scheduleItem;


  const state =
    getOccurrenceState(
      occurrence,
      options
    );


  const stateLabels = {
    completed:
      "완료",

    reference:
      "참고",

    conditional:
      "조건 확인",

    overdue:
      "지연",

    today:
      "오늘 예정",

    scheduled:
      "예정"
  };


  const unitLabel =
    String(
      occurrence?.unitLabel ||
      ""
    ).trim();


  const linkedCard =
    getLinkedCard(
      scheduleItem
    );


  return `
    <article
      class="
        inspection-calendar-selected-item
        is-${escapeHtml(
          state
        )}
      "
    >

      <div class="inspection-calendar-selected-item__content">

        <div class="inspection-calendar-selected-item__badges">

          <span
            class="
              inspection-calendar-category
              is-${escapeHtml(
                scheduleItem.category
              )}
            "
          >
            ${escapeHtml(
              categoryLabels[
                scheduleItem.category
              ] ||
              "기타"
            )}
          </span>


          ${
            unitLabel
              ? `
                  <span class="inspection-calendar-state is-today">
                    ${escapeHtml(
                      unitLabel
                    )}
                  </span>
                `
              : ""
          }


          <span
            class="
              inspection-calendar-state
              is-${escapeHtml(
                state
              )}
            "
          >
            ${escapeHtml(
              stateLabels[
                state
              ] ||
              "예정"
            )}
          </span>

        </div>


        <strong>
          ${escapeHtml(
            scheduleItem.title
          )}
        </strong>


        <span class="inspection-calendar-selected-item__meta">
          ${escapeHtml(
            getShiftLabel(
              occurrence.shift
            )
          )}

          · ${escapeHtml(
            scheduleItem.position ||
            "위치 미지정"
          )}

          · ${escapeHtml(
            scheduleItem.scheduleLabel ||
            "주기 미지정"
          )}
        </span>


        ${
          scheduleItem.note
            ? `
                <small>
                  ${escapeHtml(
                    scheduleItem.note
                  )}
                </small>
              `
            : ""
        }

      </div>


      <div class="inspection-calendar-selected-item__actions">

        ${
          linkedCard
            ? `
                <button
                  type="button"
                  class="inspection-calendar-log-button"
                  data-calendar-open-log="${escapeHtml(
                    scheduleItem.id
                  )}"
                >
                  점검일지 열기
                </button>
              `
            : ""
        }


        ${createStatusActionHtml(
          occurrence,
          {
            ...options,

            overdue:
              state ===
              "overdue"
          }
        )}

      </div>

    </article>
  `;
}

/* =========================================================
  선택 날짜 구역으로 이동

  날짜를 누르면 달력 아래의 목록이 바로 보이도록 한다.
========================================================= */

function focusInspectionCalendarSelectedSection() {
  const section =
    document.getElementById(
      "inspectionCalendarSelectedSection"
    );


  if (
    !section
  ) {
    return;
  }


  /*
    강조 효과를 다시 실행하기 위해
    기존 클래스를 먼저 제거한다.
  */
  section.classList.remove(
    "is-focus-pulse"
  );


  void section.offsetWidth;


  section.classList.add(
    "is-focus-pulse"
  );


  section.scrollIntoView({
    behavior:
      "smooth",

    block:
      "start",

    inline:
      "nearest"
  });


  window.setTimeout(
    () => {
      section.classList.remove(
        "is-focus-pulse"
      );
    },

    1000
  );
}


/* =========================================================
  선택 날짜 점검 목록 출력
========================================================= */

function renderSelectedDate() {
  const selectedDate =
    parseDateValue(
      selectedDateValue
    );


  if (
    !selectedDate
  ) {
    return;
  }


  const dateData =
    getDateData(
      selectedDateValue
    );


  const totalCount =
    dateData.required.length;


  const completedCount =
    dateData.required.filter(
      getCompletion
    ).length;


  const pendingCount =
    totalCount -
    completedCount;


  /* =====================================================
    날짜 제목
  ====================================================== */

  if (
    selectedTitle
  ) {
    selectedTitle.textContent =
      formatLongDate(
        selectedDate
      );
  }


  /* =====================================================
    날짜 하단 설명
  ====================================================== */

  if (
    selectedSummary
  ) {
    const summaryParts = [
      `필수 점검 ${totalCount}건`
    ];


    if (
      dateData.conditional.length
    ) {
      summaryParts.push(
        `조건 확인 ${dateData.conditional.length}건`
      );
    }


    if (
      dateData.reference.length
    ) {
      summaryParts.push(
        `참고 ${dateData.reference.length}건`
      );
    }


    if (
      statusErrorMessage
    ) {
      summaryParts.push(
        statusErrorMessage
      );
    }


    selectedSummary.textContent =
      summaryParts.join(
        " · "
      );
  }


  /* =====================================================
    상단 현황 숫자
  ====================================================== */

  const totalCountElement =
    document.getElementById(
      "inspectionCalendarSelectedTotalCount"
    );


  const pendingCountElement =
    document.getElementById(
      "inspectionCalendarSelectedPendingCount"
    );


  const completedCountElement =
    document.getElementById(
      "inspectionCalendarSelectedCompletedCount"
    );


  if (
    totalCountElement
  ) {
    totalCountElement.textContent =
      String(
        totalCount
      );
  }


  if (
    pendingCountElement
  ) {
    pendingCountElement.textContent =
      String(
        pendingCount
      );
  }


  if (
    completedCountElement
  ) {
    completedCountElement.textContent =
      String(
        completedCount
      );
  }


  /* =====================================================
    일정 정렬

    순서:
    1. 지연
    2. 오늘 예정
    3. 예정
    4. 조건 확인
    5. 참고
    6. 완료
  ====================================================== */

  const items = [
    ...dateData.required.map(
      occurrence => {
        return {
          occurrence
        };
      }
    ),

    ...dateData.conditional.map(
      occurrence => {
        return {
          occurrence,

          conditional:
            true
        };
      }
    ),

    ...dateData.reference.map(
      occurrence => {
        return {
          occurrence,

          reference:
            true
        };
      }
    )
  ]
    .sort(
      (
        firstItem,
        secondItem
      ) => {
        const stateOrder = {
          overdue:
            1,

          today:
            2,

          scheduled:
            3,

          conditional:
            4,

          reference:
            5,

          completed:
            6
        };


        const firstState =
          getOccurrenceState(
            firstItem.occurrence,
            firstItem
          );


        const secondState =
          getOccurrenceState(
            secondItem.occurrence,
            secondItem
          );


        const firstSchedule =
          firstItem
            .occurrence
            .scheduleItem;


        const secondSchedule =
          secondItem
            .occurrence
            .scheduleItem;


        return (
          (
            stateOrder[
              firstState
            ] ||
            99
          ) -
          (
            stateOrder[
              secondState
            ] ||
            99
          ) ||

          (
            categoryOrder[
              firstSchedule.category
            ] ||
            99
          ) -
          (
            categoryOrder[
              secondSchedule.category
            ] ||
            99
          ) ||

          String(
            firstSchedule.title ||
            ""
          ).localeCompare(
            String(
              secondSchedule.title ||
              ""
            ),

            "ko"
          )
        );
      }
    );


  /* =====================================================
    목록 출력
  ====================================================== */

  selectedList.innerHTML =
    items.length
      ? items
          .map(
            item => {
              return createSelectedItemHtml(
                item.occurrence,
                item
              );
            }
          )
          .join(
            ""
          )
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

/* =========================================================
  달력 수동 완료 처리

  보일러 호기 일정:
  - ::unit1
  - ::unit2

  를 각각 독립 저장한다.
========================================================= */

async function completeSchedule(
  button
) {
  const completionScheduleId =
    String(
      button.dataset.calendarComplete ||
      ""
    ).trim();


  const baseScheduleId =
    String(
      button.dataset.baseScheduleId ||

      completionScheduleId.replace(
        /::unit[12]$/i,
        ""
      )
    ).trim();


  const dueDate =
    String(
      button.dataset.dueDate ||
      ""
    ).trim();


  const shift =
    normalizeShift(
      button.dataset.shift
    );


  const unitMatch =
    completionScheduleId.match(
      /::unit([12])$/i
    );


  const datasetUnitNo =
    Number(
      button.dataset.unitNo ||
      0
    );


  const unitNo =
    [
      1,
      2
    ].includes(
      datasetUnitNo
    )
      ? datasetUnitNo
      : Number(
          unitMatch?.[1] ||
          0
        );


  /*
    화면 일정은 기본 일정 ID로 찾는다.
  */
  const scheduleItem =
    INSPECTION_SCHEDULE_MASTER.find(
      item => {
        return (
          item.id ===
          baseScheduleId
        );
      }
    );


  if (
    !completionScheduleId ||
    !scheduleItem ||
    !dueDate
  ) {
    window.alert(
      "완료 처리할 점검 정보를 확인할 수 없습니다."
    );


    return;
  }


  const scheduleTitle =
    unitNo ===
      1 ||
    unitNo ===
      2
      ? `${unitNo}호기 ${scheduleItem.title}`
      : scheduleItem.title;


  const confirmed =
    window.confirm(
      [
        "점검을 완료 처리하시겠습니까?",
        "",
        scheduleTitle,
        `예정일: ${dueDate}`,
        `근무: ${getShiftLabel(
          shift
        )}`
      ].join(
        "\n"
      )
    );


  if (
    !confirmed
  ) {
    return;
  }


  const originalText =
    button.textContent;


  button.disabled =
    true;


  button.textContent =
    "처리 중...";


  try {
    const response =
      await fetch(
        STATUS_API,
        {
          method:
            "POST",

          headers:
            getAuthHeaders({
              "Content-Type":
                "application/json"
            }),

          cache:
            "no-store",

          body:
            JSON.stringify({
              /*
                실제 저장 ID

                일반:
                weekly-lng-system

                호기:
                weekly-sda-hopper-ash::unit1
              */
              scheduleId:
                completionScheduleId,

              dueDate,

              shift,

              scheduleTitle,

              note:
                ""
            })
        }
      );


    const result =
      await readApiResponse(
        response
      );


    window.alert(
      result.message ||
      "점검을 완료 처리했습니다."
    );


    await refreshStatus();

  } catch (
    error
  ) {
    console.error(
      "달력 점검 완료 처리 실패:",
      error
    );


    window.alert(
      error instanceof
        Error
        ? error.message
        : "점검을 완료 처리하지 못했습니다."
    );


    button.disabled =
      false;


    button.textContent =
      originalText;
  }
}

/* =========================================================
  달력 수동 완료 취소

  호기별 완료 ID를 그대로 전달하여
  선택한 호기만 완료 취소한다.
========================================================= */

async function cancelCompletion(
  button
) {
  const completionScheduleId =
    String(
      button.dataset.calendarCancel ||
      ""
    ).trim();


  const baseScheduleId =
    String(
      button.dataset.baseScheduleId ||

      completionScheduleId.replace(
        /::unit[12]$/i,
        ""
      )
    ).trim();


  const dueDate =
    String(
      button.dataset.dueDate ||
      ""
    ).trim();


  const shift =
    normalizeShift(
      button.dataset.shift
    );


  const unitMatch =
    completionScheduleId.match(
      /::unit([12])$/i
    );


  const datasetUnitNo =
    Number(
      button.dataset.unitNo ||
      0
    );


  const unitNo =
    [
      1,
      2
    ].includes(
      datasetUnitNo
    )
      ? datasetUnitNo
      : Number(
          unitMatch?.[1] ||
          0
        );


  const scheduleItem =
    INSPECTION_SCHEDULE_MASTER.find(
      item => {
        return (
          item.id ===
          baseScheduleId
        );
      }
    );


  if (
    !completionScheduleId ||
    !scheduleItem ||
    !dueDate
  ) {
    window.alert(
      "완료 취소할 점검 정보를 확인할 수 없습니다."
    );


    return;
  }


  const scheduleTitle =
    unitNo ===
      1 ||
    unitNo ===
      2
      ? `${unitNo}호기 ${scheduleItem.title}`
      : scheduleItem.title;


  const confirmed =
    window.confirm(
      [
        "점검 완료를 취소하시겠습니까?",
        "",
        scheduleTitle,
        `예정일: ${dueDate}`,
        `근무: ${getShiftLabel(
          shift
        )}`
      ].join(
        "\n"
      )
    );


  if (
    !confirmed
  ) {
    return;
  }


  const originalText =
    button.textContent;


  button.disabled =
    true;


  button.textContent =
    "취소 중...";


  try {
    const url =
      new URL(
        STATUS_API,
        window.location.origin
      );


    url.searchParams.set(
      "scheduleId",
      completionScheduleId
    );


    url.searchParams.set(
      "dueDate",
      dueDate
    );


    url.searchParams.set(
      "shift",
      shift
    );


    const response =
      await fetch(
        url.toString(),
        {
          method:
            "DELETE",

          headers:
            getAuthHeaders(),

          cache:
            "no-store"
        }
      );


    const result =
      await readApiResponse(
        response
      );


    window.alert(
      result.message ||
      "점검 완료를 취소했습니다."
    );


    await refreshStatus();

  } catch (
    error
  ) {
    console.error(
      "달력 점검 완료 취소 실패:",
      error
    );


    window.alert(
      error instanceof
        Error
        ? error.message
        : "점검 완료를 취소하지 못했습니다."
    );


    button.disabled =
      false;


    button.textContent =
      originalText;
  }
}

/* =========================================================
  점검 일정 버튼 처리
========================================================= */

function handleActionClick(
  event
) {
  const target =
    event.target instanceof
      Element
      ? event.target
      : null;


  /* =====================================================
    자동완료 근거 업무일지 열기
  ====================================================== */

  const sourceLogButton =
    target?.closest(
      "[data-calendar-open-source-log]"
    );


  if (
    sourceLogButton
  ) {
    const logId =
      String(
        sourceLogButton.dataset
          .calendarOpenSourceLog ||
        ""
      ).trim();


    const workDate =
      String(
        sourceLogButton.dataset
          .workDate ||
        ""
      ).trim();


    const shift =
      normalizeShift(
        sourceLogButton.dataset
          .shift
      );


    if (
      !logId
    ) {
      window.alert(
        "근거 업무일지 정보를 확인할 수 없습니다."
      );


      return;
    }


    const targetWindow =
      window.parent &&
      window.parent !==
        window
        ? window.parent
        : window.opener;


    if (
      !targetWindow
    ) {
      window.alert(
        "근거 업무일지를 열 수 있는 메인 화면을 찾지 못했습니다."
      );


      return;
    }


    targetWindow.postMessage(
      {
        type:
          "gs-shift-log:open-source-log",

        logId,

        workDate,

        shift
      },

      window.location.origin
    );


    return;
  }


  /* =====================================================
    연결 점검일지 열기
  ====================================================== */

  const logButton =
    target?.closest(
      "[data-calendar-open-log]"
    );


  if (
    logButton
  ) {
    const scheduleItem =
      INSPECTION_SCHEDULE_MASTER.find(
        item => {
          return (
            item.id ===
            String(
              logButton.dataset
                .calendarOpenLog ||
              ""
            )
          );
        }
      );


    openLinkedLog(
      scheduleItem
    );


    return;
  }


  /* =====================================================
    완료 처리
  ====================================================== */

  const completeButton =
    target?.closest(
      "[data-calendar-complete]"
    );


  if (
    completeButton
  ) {
    completeSchedule(
      completeButton
    );


    return;
  }


  /* =====================================================
    수동 완료 취소
  ====================================================== */

  const cancelButton =
    target?.closest(
      "[data-calendar-cancel]"
    );


  if (
    cancelButton
  ) {
    cancelCompletion(
      cancelButton
    );
  }
}

/* =========================================================
  월간 달력 날짜 클릭

  처리:
  - 선택 날짜 변경
  - 선택 날짜 카드 목록 다시 출력
  - 다른 달 날짜면 해당 월로 이동
  - 선택 날짜 목록 위치로 자동 이동
========================================================= */

calendarGrid.addEventListener(
  "click",

  event => {
    const target =
      event.target instanceof
        Element
        ? event.target
        : null;


    const dateButton =
      target?.closest(
        "[data-inspection-calendar-date]"
      );


    if (
      !dateButton
    ) {
      return;
    }


    const nextDateValue =
      String(
        dateButton.dataset
          .inspectionCalendarDate ||
        ""
      ).trim();


    const nextDate =
      parseDateValue(
        nextDateValue
      );


    if (
      !nextDate
    ) {
      return;
    }


    selectedDateValue =
      nextDateValue;


    /* =====================================================
      이전 달 또는 다음 달 날짜를 누른 경우
    ====================================================== */

    if (
      nextDate.getFullYear() !==
        monthCursor.getFullYear() ||

      nextDate.getMonth() !==
        monthCursor.getMonth()
    ) {
      monthCursor =
        new Date(
          nextDate.getFullYear(),
          nextDate.getMonth(),
          1
        );


      void refreshStatus()
        .then(
          () => {
            focusInspectionCalendarSelectedSection();
          }
        );


      return;
    }


    /* =====================================================
      현재 달 날짜를 누른 경우
    ====================================================== */

    renderCalendar();

    renderSelectedDate();


    window.requestAnimationFrame(
      () => {
        focusInspectionCalendarSelectedSection();
      }
    );
  }
);

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
