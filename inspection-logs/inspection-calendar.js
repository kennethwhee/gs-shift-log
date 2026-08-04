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

  const calendarFilterCategories = [
    "daily",
    "weekly",
    "monthly",
    "quarterly",
    "other"
  ];

  /*
    달력 기본 표시:
    - 주간
    - 월간

    일일·분기·기타는 사용자가 체크했을 때 표시한다.
  */
  let visibleCalendarCategories = new Set([
    "weekly",
    "monthly"
  ]);

  let monthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDateValue = formatDateValue(new Date());
  let statusMap = new Map();
  let statusLoading = false;
  let statusErrorMessage = "";


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

  function getPreviewLines(scheduleItems) {
    const uniqueItems = [...new Map(
      scheduleItems.map(item => [item.id, item])
    ).values()];

    const specificItems = uniqueItems
      .filter(item => item.category !== "daily" && item.referenceOnly !== true)
      .sort((firstItem, secondItem) => {
        return (
          (categoryOrder[firstItem.category] || 99) -
          (categoryOrder[secondItem.category] || 99)
        ) || String(firstItem.title || "").localeCompare(
          String(secondItem.title || ""),
          "ko"
        );
      });

    const dailyCount = uniqueItems.filter(item => {
      return item.category === "daily" && item.referenceOnly !== true;
    }).length;

    const referenceCount = uniqueItems.filter(item => {
      return item.referenceOnly === true;
    }).length;

    const lines = specificItems.slice(0, 2).map(item => ({
      text: item.title,
      type: item.category
    }));

    if (dailyCount > 0 && lines.length < 3) {
      lines.push({
        text: `일일점검 ${dailyCount}건`,
        type: "daily"
      });
    }

    const representedCount = Math.min(specificItems.length, 2) + dailyCount;
    const hiddenCount = Math.max(0, uniqueItems.length - representedCount);

    if (hiddenCount > 0 && lines.length < 3) {
      lines.push({
        text: `외 ${hiddenCount}건`,
        type: "more"
      });
    }

    if (!lines.length && referenceCount > 0) {
      lines.push({
        text: `참고 일정 ${referenceCount}건`,
        type: "reference"
      });
    }

    return lines;
  }

  function renderCalendar() {
    const todayValue = formatDateValue(new Date());
    const firstDay = new Date(
      monthCursor.getFullYear(),
      monthCursor.getMonth(),
      1
    );

    const gridStart = new Date(
      firstDay.getFullYear(),
      firstDay.getMonth(),
      1 - firstDay.getDay()
    );

    if (calendarTitle) {
      calendarTitle.textContent = formatMonthTitle(monthCursor);
    }

    const cells = [];

    for (let index = 0; index < 42; index += 1) {
      const date = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + index
      );

      const dateValue = formatDateValue(date);
      const dateData = getDateData(dateValue);
      const completedCount = dateData.required.filter(getCompletion).length;
      const pendingCount = dateData.required.length - completedCount;
      const isOutside = date.getMonth() !== monthCursor.getMonth();
      const isToday = dateValue === todayValue;
      const isSelected = dateValue === selectedDateValue;
      const isPastTracked = (
        dateValue >= TRACKING_START_DATE &&
        dateValue < todayValue
      );
      const isOverdue = isPastTracked && pendingCount > 0;
      const isComplete = (
        dateData.required.length > 0 &&
        completedCount === dateData.required.length
      );

      const hasPartialCompletion = (
        completedCount > 0 &&
        pendingCount > 0
      );

      const classes = [
        "inspection-calendar-day",
        isOutside ? "is-outside" : "",
        isToday ? "is-today" : "",
        isSelected ? "is-selected" : "",
        dateData.scheduleItems.length ? "has-schedule" : "",
        isOverdue ? "has-overdue" : "",
        isComplete ? "is-complete" : "",
        dateData.conditional.length ? "has-conditional" : ""
      ].filter(Boolean).join(" ");

      const previewHtml = getPreviewLines(dateData.scheduleItems)
        .map(line => {
          return `
            <span class="inspection-calendar-day__item is-${escapeHtml(line.type)}">
              ${escapeHtml(line.text)}
            </span>
          `;
        })
        .join("");

      let statusText = "";

      if (isOverdue) {
        statusText = `미완료 ${pendingCount}건`;
      } else if (isComplete) {
        statusText = "완료";
      } else if (hasPartialCompletion) {
        statusText = `완료 ${completedCount}/${dateData.required.length}`;
      } else if (isToday && pendingCount > 0) {
        statusText = `미완료 ${pendingCount}건`;
      } else if (dateData.scheduleItems.length) {
        statusText = `예정 ${dateData.scheduleItems.length}건`;
      }

      const completionMarkHtml = completedCount > 0
        ? `
            <span
              class="inspection-calendar-day__completion-mark ${isComplete ? "is-complete" : "is-partial"}"
              aria-label="${isComplete ? "전체 완료" : `일부 완료 ${completedCount}/${dateData.required.length}`}"
            >
              ${isComplete ? "✓" : `✓ ${completedCount}/${dateData.required.length}`}
            </span>
          `
        : "";

      cells.push(`
        <button
          type="button"
          class="${classes}"
          data-inspection-calendar-date="${escapeHtml(dateValue)}"
          aria-selected="${isSelected ? "true" : "false"}"
          aria-label="${escapeHtml(
            `${formatLongDate(date)}${statusText ? `, ${statusText}` : ""}`
          )}"
        >
          <span class="inspection-calendar-day__number">${date.getDate()}</span>

          ${completionMarkHtml}

          <span class="inspection-calendar-day__items">
            ${previewHtml}
          </span>

          ${statusText ? `
            <span class="inspection-calendar-day__status">
              ${escapeHtml(statusText)}
            </span>
          ` : ""}
        </button>
      `);
    }

    calendarGrid.innerHTML = cells.join("");
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

  async function refreshStatus() {
    if (statusLoading) {
      return;
    }

    statusLoading = true;
    calendarGrid.setAttribute("aria-busy", "true");
    selectedList.setAttribute("aria-busy", "true");

    try {
      await loadStatusRecords();
    } catch (error) {
      console.error("달력 점검 완료 기록 조회 실패:", error);
      statusMap = new Map();
      statusErrorMessage = error instanceof Error
        ? error.message
        : "점검 완료 기록을 불러오지 못했습니다.";
    } finally {
      statusLoading = false;
      calendarGrid.removeAttribute("aria-busy");
      selectedList.removeAttribute("aria-busy");
      renderAll();
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

  window.addEventListener("message", event => {
    if (
      event.origin === window.location.origin &&
      event.data?.type === "gs-shift-log:refresh-inspection-schedule"
    ) {
      refreshStatus();
    }
  });

  createCalendarCategoryFilter();

  dashboard.hidden = false;

  if (cycleDetails) {
    cycleDetails.open = false;
  }

  renderCycleList();
  refreshStatus();
}

/* =========================================================
  점검 일정 관리자 변경사항 적용 후 달력 실행
========================================================= */

async function waitForInspectionCalendarScheduleReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (
      typeof inspectionScheduleOverrideState !== "undefined" &&
      inspectionScheduleOverrideState.loaded === true
    ) {
      return;
    }

    await new Promise(resolve => {
      window.setTimeout(resolve, 100);
    });
  }
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
