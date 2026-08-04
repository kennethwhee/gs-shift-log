"use strict";

/* =========================================================
  Soot Blower 주간점검일지

  - 매주 월요일 N/S
  - 1호기·2호기 각각 34개 고정 점검행
  - Cloudflare D1 공용 저장 및 revision 충돌 방지
  - 날짜별 임시 복구, 보관함, 보기·수정·인쇄·삭제
========================================================= */

const SOOT_BLOWER_WEEKLY_API_URL =
  "/api/inspection-logs/soot-blower-weekly";

const SOOT_CURRENT_USER_STORAGE_KEY =
  "gsShiftLog.currentUser";

const SOOT_DRAFT_STORAGE_PREFIX =
  "inspectionLogs.weekly.sootBlower.draft.";

const SOOT_CHECK_GROUPS = [
  {
    key: "eco",
    label: "Eco Side S.B",
    labelHtml: "Eco Side<br>S.B",
    numbers: Array.from(
      { length: 16 },
      (_, index) => String(index + 11)
    )
  },
  {
    key: "super-heater",
    label: "Super Heater Side S.B",
    labelHtml: "Super Heater<br>Side S.B",
    numbers: Array.from(
      { length: 10 },
      (_, index) => String(index + 1)
    )
  },
  {
    key: "sonic",
    label: "음파식 제매기",
    labelHtml: "음파식<br>제매기",
    numbers: [
      "A-1",
      "A-2",
      "A-3",
      "A-4",
      "B-1",
      "B-2",
      "B-3",
      "B-4"
    ]
  }
];

const SOOT_CHECK_ITEMS =
  SOOT_CHECK_GROUPS.flatMap(group => {
    return group.numbers.map(number => ({
      groupKey: group.key,
      type: group.label,
      number
    }));
  });


document.addEventListener(
  "DOMContentLoaded",
  () => {
    initializeSootBlowerWeeklyInspection();
  }
);


function initializeSootBlowerWeeklyInspection() {
  const writeView =
    document.getElementById("sootWriteView");

  const sheet =
    document.getElementById("sootCheckSheet");

  const rowsRoot =
    document.getElementById("sootCheckRows");

  const inspectionDate =
    document.getElementById("sootInspectionDate");

  if (
    !writeView ||
    !sheet ||
    !rowsRoot ||
    !inspectionDate
  ) {
    return;
  }

  const saveButton =
    document.getElementById("sootCheckSaveButton");

  const previewButton =
    document.getElementById("sootCheckPreviewButton");

  const archiveOpenButton =
    document.getElementById("sootArchiveOpenButton");

  const saveState =
    document.getElementById("sootCheckSaveState");

  const archiveView =
    document.getElementById("sootArchiveView");

  const archiveBackButton =
    document.getElementById("sootArchiveBackButton");

  const archiveRefreshButton =
    document.getElementById("sootArchiveRefreshButton");

  const archiveStartDate =
    document.getElementById("sootArchiveStartDate");

  const archiveEndDate =
    document.getElementById("sootArchiveEndDate");

  const archiveKeyword =
    document.getElementById("sootArchiveKeyword");

  const archiveSearchButton =
    document.getElementById("sootArchiveSearchButton");

  const archiveResetButton =
    document.getElementById("sootArchiveResetButton");

  const archiveCount =
    document.getElementById("sootArchiveCount");

  const archiveTableBody =
    document.getElementById("sootArchiveTableBody");

  const archiveEmpty =
    document.getElementById("sootArchiveEmpty");

  const previewModal =
    document.getElementById("sootPrintPreview");

  const previewBody =
    document.getElementById("sootPrintPreviewBody");

  const previewCloseButton =
    document.getElementById("sootPreviewCloseButton");

  const previewCancelButton =
    document.getElementById("sootPreviewCancelButton");

  const printButton =
    document.getElementById("sootPrintButton");

  let currentLogId = "";
  let currentRevision = 0;
  let archiveAllLogs = [];
  let isDirty = false;
  let isApplyingData = false;
  let lastLoadedDate = "";
  let draftSaveTimer = null;
  let printDateBackup = null;


  /* =======================================================
    공통 유틸리티
  ======================================================= */

  function normalizeText(value) {
    return String(value ?? "").trim();
  }


  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }


  function getTodayDateValue() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }


  function getDateMonthsAgo(months) {
    const date = new Date();
    date.setMonth(date.getMonth() - Number(months || 0));

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }


  function parseDateValue(dateValue) {
    const match =
      /^(\d{4})-(\d{2})-(\d{2})$/.exec(
        normalizeText(dateValue)
      );

    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day, 12, 0, 0);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }


  function formatDateForPrint(dateValue) {
    const date = parseDateValue(dateValue);

    if (!date) {
      return normalizeText(dateValue);
    }

    const weekday = new Intl.DateTimeFormat(
      "en-US",
      { weekday: "long" }
    ).format(date);

    const month = new Intl.DateTimeFormat(
      "en-US",
      { month: "long" }
    ).format(date);

    const day = String(date.getDate()).padStart(2, "0");

    return `${weekday}, ${month} ${day}, ${date.getFullYear()}`;
  }


  function formatBoardDate(dateValue) {
    const parts = normalizeText(dateValue).split("-");

    if (parts.length !== 3) {
      return normalizeText(dateValue) || "날짜 미확인";
    }

    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }


  function formatDateTime(dateTimeValue) {
    const date = new Date(dateTimeValue || 0);

    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat(
      "ko-KR",
      {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }
    ).format(date);
  }


  function normalizeShiftLabel(value) {
    const normalized = normalizeText(value)
      .toUpperCase()
      .replace(/[^A-Z]/g, "");

    return normalized === "NS" ? "N/S" : "N/S";
  }


  function setElementValue(id, value) {
    const element = document.getElementById(id);

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      element.value = String(value ?? "");
    }
  }


  function getElementValue(id) {
    const element = document.getElementById(id);

    if (
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ) {
      return String(element.value || "");
    }

    return "";
  }


  /* =======================================================
    로그인 정보 및 API
  ======================================================= */

  function loadStoredUser() {
    try {
      const savedUser =
        localStorage.getItem(SOOT_CURRENT_USER_STORAGE_KEY);

      return savedUser ? JSON.parse(savedUser) : null;

    } catch (error) {
      console.warn("로그인 정보 불러오기 실패:", error);
      return null;
    }
  }


  function getSessionToken() {
    const user = loadStoredUser();

    return normalizeText(
      user?.sessionToken ||
      user?.session_token
    );
  }


  /* =======================================================
    Soot Blower 주간점검 일정 자동 연동

    점검일지:
    - 매주 월요일 N/S

    점검 일정표:
    - 매주 일요일 N/S

    날짜 연결:
    - 월요일 점검일지 저장
      → 직전 일요일 일정 완료
    - 그 외 날짜
      → 선택한 날짜 그대로 일정 반영
  ======================================================= */

  const SOOT_SCHEDULE_STATUS_API_URL =
    "/api/inspection-schedule-status";


  const SOOT_SCHEDULE_ID =
    "weekly-soot-blower";


  const SOOT_SCHEDULE_TITLE =
    "보일러 Soot Blower 점검";


  const SOOT_SCHEDULE_SHIFT =
    "NS";


  /* =====================================================
    Date 객체 → YYYY-MM-DD
  ====================================================== */

  function formatSootScheduleDateValue(
    date
  ) {
    return [
      date.getFullYear(),

      String(
        date.getMonth() + 1
      ).padStart(
        2,
        "0"
      ),

      String(
        date.getDate()
      ).padStart(
        2,
        "0"
      )
    ].join(
      "-"
    );
  }


  /* =====================================================
    Soot Blower 일정 기준일 계산

    월요일 점검일지:
    직전 일요일 일정에 연결한다.

    예:
    2026-08-10 월요일
    → 2026-08-09 일요일
  ====================================================== */

  function getSootScheduleDueDate(
    inspectionDateValue
  ) {
    const date =
      parseDateValue(
        inspectionDateValue
      );


    if (
      !date
    ) {
      throw new Error(
        "점검 일정에 반영할 Soot Blower 점검일자를 확인할 수 없습니다."
      );
    }


    if (
      date.getDay() ===
        1
    ) {
      date.setDate(
        date.getDate() - 1
      );
    }


    return formatSootScheduleDateValue(
      date
    );
  }


  /* =====================================================
    점검일지 허브 완료 상태 새로고침
  ====================================================== */

  function notifySootScheduleRefresh() {
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
          "gs-shift-log:refresh-inspection-schedule"
      },

      window.location.origin
    );
  }


  /* =====================================================
    Soot Blower 점검 일정 완료 처리
  ====================================================== */

  async function completeSootScheduleStatus(
    inspectionDateValue
  ) {
    const inspectionDateText =
      normalizeText(
        inspectionDateValue
      );


    const dueDate =
      getSootScheduleDueDate(
        inspectionDateText
      );


    const payload =
      await requestApi(
        SOOT_SCHEDULE_STATUS_API_URL,

        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          cache:
            "no-store",

          body:
            JSON.stringify({
              scheduleId:
                SOOT_SCHEDULE_ID,

              dueDate,

              shift:
                SOOT_SCHEDULE_SHIFT,

              scheduleTitle:
                SOOT_SCHEDULE_TITLE,

              note:
                [
                  "Soot Blower 주간점검일지 저장완료",
                  `점검일지 날짜 ${inspectionDateText}`
                ].join(
                  " · "
                )
            })
        }
      );


    notifySootScheduleRefresh();


    return {
      ...payload,

      dueDate
    };
  }


  /* =====================================================
    Soot Blower 점검 일정 완료 취소

    404:
    완료 기록이 없는 정상적인 미완료 상태
  ====================================================== */

  async function cancelSootScheduleStatus(
    inspectionDateValue
  ) {
    const dueDate =
      getSootScheduleDueDate(
        inspectionDateValue
      );


    const requestUrl =
      new URL(
        SOOT_SCHEDULE_STATUS_API_URL,
        window.location.origin
      );


    requestUrl.searchParams.set(
      "scheduleId",
      SOOT_SCHEDULE_ID
    );


    requestUrl.searchParams.set(
      "dueDate",
      dueDate
    );


    requestUrl.searchParams.set(
      "shift",
      SOOT_SCHEDULE_SHIFT
    );


    try {
      const payload =
        await requestApi(
          requestUrl.toString(),

          {
            method:
              "DELETE",

            cache:
              "no-store"
          }
        );


      notifySootScheduleRefresh();


      return {
        ...payload,

        dueDate
      };

    } catch (
      error
    ) {
      /*
        완료 기록이 없다면
        이미 미완료 상태이므로 정상 처리한다.
      */
      if (
        Number(
          error?.status
        ) ===
          404
      ) {
        notifySootScheduleRefresh();


        return {
          ok:
            true,

          missing:
            true,

          dueDate
        };
      }


      throw error;
    }
  }


  /* =======================================================
    고정 34개 점검행
  ======================================================= */

  function createStatusSelect(unitNumber, itemIndex, item) {
    const unitLabel = `${unitNumber}호기`;
    const id = `sootUnit${unitNumber}Status${itemIndex + 1}`;

    return `
      <select
        id="${id}"
        class="soot-check-status-select"
        aria-label="${escapeHtml(`${unitLabel} ${item.type} ${item.number} 점검 결과`)}"
      >
        <option value=""></option>
        <option value="O">○</option>
        <option value="X">X</option>
      </select>
    `;
  }


  function createRemarkInput(unitNumber, itemIndex, item) {
    return `
      <input
        type="text"
        id="sootUnit${unitNumber}Remark${itemIndex + 1}"
        class="soot-check-remark-input"
        aria-label="${escapeHtml(`${unitNumber}호기 ${item.type} ${item.number} 특이사항`)}"
        maxlength="500"
        autocomplete="off"
      >
    `;
  }


  function createOccurrenceInput(unitNumber, itemIndex, item) {
    return `
      <input
        type="text"
        id="sootUnit${unitNumber}OccurrenceDate${itemIndex + 1}"
        class="soot-check-occurrence-input"
        aria-label="${escapeHtml(`${unitNumber}호기 ${item.type} ${item.number} 발생 날짜`)}"
        maxlength="20"
        autocomplete="off"
      >
    `;
  }


  function renderCheckRows() {
    rowsRoot.innerHTML = "";

    let itemIndex = 0;

    SOOT_CHECK_GROUPS.forEach(group => {
      group.numbers.forEach((number, indexInGroup) => {
        const item = SOOT_CHECK_ITEMS[itemIndex];
        const row = document.createElement("tr");

        row.dataset.sootItemRow = String(itemIndex + 1);
        row.dataset.sootGroup = group.key;

        const typeCell = indexInGroup === 0
          ? `
              <th
                class="soot-check-type-cell"
                scope="rowgroup"
                rowspan="${group.numbers.length}"
              >
                ${group.labelHtml}
              </th>
            `
          : "";

        row.innerHTML = `
          ${typeCell}
          <th class="soot-check-number-cell" scope="row">${escapeHtml(number)}</th>
          <td class="soot-check-result-cell" data-soot-unit-cell="1">
            ${createStatusSelect(1, itemIndex, item)}
          </td>
          <td class="soot-check-remark-cell" data-soot-unit-cell="1">
            ${createRemarkInput(1, itemIndex, item)}
          </td>
          <td class="soot-check-occurrence-cell" data-soot-unit-cell="1">
            ${createOccurrenceInput(1, itemIndex, item)}
          </td>
          <th class="soot-check-number-cell" scope="row">${escapeHtml(number)}</th>
          <td class="soot-check-result-cell" data-soot-unit-cell="2">
            ${createStatusSelect(2, itemIndex, item)}
          </td>
          <td class="soot-check-remark-cell" data-soot-unit-cell="2">
            ${createRemarkInput(2, itemIndex, item)}
          </td>
          <td class="soot-check-occurrence-cell" data-soot-unit-cell="2">
            ${createOccurrenceInput(2, itemIndex, item)}
          </td>
        `;

        rowsRoot.appendChild(row);
        itemIndex += 1;
      });
    });
  }


  function refreshDefectStyle(selectElement) {
    if (!(selectElement instanceof HTMLSelectElement)) {
      return;
    }

    const cell = selectElement.closest("[data-soot-unit-cell]");
    const row = selectElement.closest("tr");
    const unit = cell?.getAttribute("data-soot-unit-cell");

    if (!row || !unit) {
      return;
    }

    row
      .querySelectorAll(`[data-soot-unit-cell="${unit}"]`)
      .forEach(unitCell => {
        unitCell.classList.toggle(
          "is-defect",
          selectElement.value === "X"
        );
      });
  }


  function refreshAllDefectStyles() {
    rowsRoot
      .querySelectorAll(".soot-check-status-select")
      .forEach(refreshDefectStyle);
  }


  /* =======================================================
    저장 상태와 입력값
  ======================================================= */

  function setSaveState(message, state = "") {
    if (!saveState) {
      return;
    }

    saveState.classList.remove(
      "is-saved",
      "is-saving",
      "is-error"
    );

    if (state) {
      saveState.classList.add(`is-${state}`);
    }

    saveState.textContent = message;
  }


  function setToolbarBusy(isBusy) {
    [
      saveButton,
      previewButton,
      archiveOpenButton
    ].forEach(button => {
      if (button) {
        button.disabled = Boolean(isBusy);
      }
    });
  }


  function markDirty() {
    if (isApplyingData) {
      return;
    }

    isDirty = true;

    setSaveState(
      currentLogId
        ? "수정됨 · 저장 필요"
        : "작성 중 · 저장 필요"
    );

    window.clearTimeout(draftSaveTimer);

    draftSaveTimer = window.setTimeout(
      saveRecoveryDraft,
      300
    );
  }


  function normalizeStatus(value) {
    const status = normalizeText(value).toUpperCase();

    if (status === "O" || status === "○") {
      return "O";
    }

    if (status === "X" || status === "×") {
      return "X";
    }

    return "";
  }


  function collectUnitRows(unitNumber) {
    return SOOT_CHECK_ITEMS.map((item, index) => ({
      number: item.number,
      status: normalizeStatus(
        getElementValue(`sootUnit${unitNumber}Status${index + 1}`)
      ),
      remark: getElementValue(
        `sootUnit${unitNumber}Remark${index + 1}`
      ),
      occurrenceDate: getElementValue(
        `sootUnit${unitNumber}OccurrenceDate${index + 1}`
      )
    }));
  }


  function collectFormData() {
    return {
      partLeaderApproval: getElementValue("sootPartLeaderApproval"),
      unit1Inspector: getElementValue("sootUnit1Inspector"),
      unit2Inspector: getElementValue("sootUnit2Inspector"),
      units: {
        unit1: collectUnitRows(1),
        unit2: collectUnitRows(2)
      }
    };
  }


  function getUnitRowsFromForm(form, unitNumber) {
    const rows = form?.units?.[`unit${unitNumber}`];
    return Array.isArray(rows) ? rows : [];
  }


  function applyFormData(form) {
    const source =
      form && typeof form === "object"
        ? form
        : {};

    setElementValue(
      "sootPartLeaderApproval",
      source.partLeaderApproval
    );

    setElementValue(
      "sootUnit1Inspector",
      source.unit1Inspector
    );

    setElementValue(
      "sootUnit2Inspector",
      source.unit2Inspector
    );

    [1, 2].forEach(unitNumber => {
      const rows = getUnitRowsFromForm(source, unitNumber);

      SOOT_CHECK_ITEMS.forEach((item, index) => {
        const savedItem = rows[index] || {};

        setElementValue(
          `sootUnit${unitNumber}Status${index + 1}`,
          normalizeStatus(savedItem.status)
        );

        setElementValue(
          `sootUnit${unitNumber}Remark${index + 1}`,
          savedItem.remark
        );

        setElementValue(
          `sootUnit${unitNumber}OccurrenceDate${index + 1}`,
          savedItem.occurrenceDate
        );
      });
    });

    refreshAllDefectStyles();
  }


  function clearFormForNewDate() {
    applyFormData({
      partLeaderApproval: "",
      unit1Inspector: "",
      unit2Inspector: "",
      units: {
        unit1: [],
        unit2: []
      }
    });
  }


  function applyLogToForm(log) {
    if (!log) {
      return;
    }

    isApplyingData = true;

    inspectionDate.value =
      normalizeText(log.inspectionDate) || inspectionDate.value;

    applyFormData(log.form);

    currentLogId = normalizeText(log.id);
    currentRevision = Number(log.serverRevision) || 0;
    lastLoadedDate = inspectionDate.value;
    isDirty = false;
    isApplyingData = false;

    setSaveState(
      `저장 완료 · revision ${currentRevision}`,
      "saved"
    );
  }


  /* =======================================================
    브라우저 임시 복구
  ======================================================= */

  function getDraftStorageKey(dateValue = inspectionDate.value) {
    return SOOT_DRAFT_STORAGE_PREFIX + normalizeText(dateValue);
  }


  function saveRecoveryDraft() {
    const dateValue = normalizeText(inspectionDate.value);

    if (!dateValue) {
      return;
    }

    try {
      localStorage.setItem(
        getDraftStorageKey(dateValue),
        JSON.stringify({
          inspectionDate: dateValue,
          form: collectFormData(),
          savedAt: new Date().toISOString()
        })
      );
    } catch (error) {
      console.warn("Soot Blower 임시 저장 실패:", error);
    }
  }


  function loadRecoveryDraft(dateValue) {
    try {
      const rawValue =
        localStorage.getItem(getDraftStorageKey(dateValue));

      return rawValue ? JSON.parse(rawValue) : null;

    } catch {
      return null;
    }
  }


  function removeRecoveryDraft(dateValue = inspectionDate.value) {
    try {
      localStorage.removeItem(getDraftStorageKey(dateValue));
    } catch {
      // 저장소를 사용할 수 없는 환경에서는 무시합니다.
    }
  }


  /* =======================================================
    날짜별 불러오기 및 D1 저장
  ======================================================= */

  async function loadLogForDate(dateValue) {
    const targetDate = normalizeText(dateValue);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      setSaveState("점검일자를 선택해 주세요.", "error");
      return;
    }

    setToolbarBusy(true);
    setSaveState("저장 기록 불러오는 중...", "saving");

    try {
      const payload = await requestApi(
        `${SOOT_BLOWER_WEEKLY_API_URL}?date=${encodeURIComponent(targetDate)}`
      );

      if (payload.log) {
        applyLogToForm(payload.log);
        removeRecoveryDraft(targetDate);

      } else {
        isApplyingData = true;
        inspectionDate.value = targetDate;
        currentLogId = "";
        currentRevision = 0;
        clearFormForNewDate();

        const draft = loadRecoveryDraft(targetDate);

        if (draft?.form) {
          applyFormData(draft.form);
          isDirty = true;
          setSaveState("복구된 임시 내용 · 일지 저장 필요");

        } else {
          isDirty = false;
          setSaveState("새 일지 · 저장되지 않음");
        }

        lastLoadedDate = targetDate;
        isApplyingData = false;
      }

    } catch (error) {
      console.error("Soot Blower 점검일지 불러오기 실패:", error);
      isApplyingData = false;

      setSaveState(
        error.message || "점검일지를 불러오지 못했습니다.",
        "error"
      );

    } finally {
      setToolbarBusy(false);
    }
  }


  /* =======================================================
    Soot Blower 점검일지 저장 및 일정 자동 완료

    처리:
    1. Soot Blower 점검일지 D1 저장
    2. 일요일 N/S 점검 일정 완료 처리
    3. 점검일지 상단 건수 즉시 갱신
  ======================================================= */

  async function saveInspectionLog() {
    const dateValue =
      normalizeText(
        inspectionDate.value
      );


    if (
      !dateValue
    ) {
      window.alert(
        "점검일자를 선택해 주세요."
      );


      return;
    }


    const log = {
      id:
        currentLogId,

      inspectionDate:
        dateValue,

      shift:
        "NS",

      status:
        "저장완료",

      form:
        collectFormData()
    };


    setToolbarBusy(
      true
    );


    setSaveState(
      "D1에 저장하는 중...",
      "saving"
    );


    try {
      /* =================================================
        Soot Blower 점검일지 D1 저장
      ================================================= */

      const payload =
        await requestApi(
          SOOT_BLOWER_WEEKLY_API_URL,

          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                log,

                expectedRevision:
                  currentRevision
              })
          }
        );


      applyLogToForm(
        payload.log
      );


      removeRecoveryDraft(
        dateValue
      );


      /* =================================================
        점검 일정 완료 자동 반영

        일정 연동에 실패해도
        저장된 Soot Blower 일지는 유지한다.
      ================================================= */

      let scheduleResult =
        null;


      let scheduleSyncError =
        null;


      setSaveState(
        "저장 완료 · 점검 일정 반영 중...",
        "saving"
      );


      try {
        scheduleResult =
          await completeSootScheduleStatus(
            dateValue
          );

      } catch (
        error
      ) {
        scheduleSyncError =
          error;


        console.error(
          "Soot Blower 점검 일정 자동 완료 실패:",
          error
        );
      }


      /* =================================================
        저장 결과
      ================================================= */

      if (
        scheduleSyncError
      ) {
        setSaveState(
          `저장 완료 · 일정 연동 실패 · revision ${currentRevision}`,
          "error"
        );


        window.alert(
          [
            payload.created
              ? "Soot Blower 주간점검일지는 저장되었습니다."
              : "Soot Blower 주간점검일지는 수정 저장되었습니다.",

            "",

            "다만 점검 일정 완료 상태는 자동 반영하지 못했습니다.",

            scheduleSyncError.message ||
            "점검 일정 연동 오류"
          ].join(
            "\n"
          )
        );

      } else {
        setSaveState(
          `저장 완료 · 일정 완료 · revision ${currentRevision}`,
          "saved"
        );


        window.alert(
          [
            payload.created
              ? "Soot Blower 주간점검일지가 저장되었습니다."
              : "Soot Blower 주간점검일지가 수정 저장되었습니다.",

            "",

            `점검 일정 기준일 ${scheduleResult?.dueDate || dateValue} N/S도 자동 완료 처리했습니다.`
          ].join(
            "\n"
          )
        );
      }

    } catch (
      error
    ) {
      console.error(
        "Soot Blower 점검일지 저장 실패:",
        error
      );


      if (
        error.status ===
          409 &&
        error.payload?.currentLog
      ) {
        const useServerData =
          window.confirm(
            `${error.message}\n\n서버의 최신 내용을 불러오시겠습니까?`
          );


        if (
          useServerData
        ) {
          applyLogToForm(
            error.payload.currentLog
          );
        }

      } else {
        setSaveState(
          error.message ||
          "저장 중 오류가 발생했습니다.",
          "error"
        );


        window.alert(
          error.message ||
          "Soot Blower 주간점검일지를 저장하지 못했습니다."
        );
      }

    } finally {
      setToolbarBusy(
        false
      );
    }
  }


  /* =======================================================
    게시판형 보관함
  ======================================================= */

  function setWriteViewVisible(visible) {
    writeView.hidden = !visible;

    if (archiveView) {
      archiveView.hidden = visible;
    }
  }


  function getLogInspectorNames(log) {
    return [
      normalizeText(log?.form?.unit1Inspector),
      normalizeText(log?.form?.unit2Inspector)
    ].filter(Boolean);
  }


  function getFilteredArchiveLogs() {
    const startDate = normalizeText(archiveStartDate?.value);
    const endDate = normalizeText(archiveEndDate?.value);
    const keyword = normalizeText(archiveKeyword?.value).toLowerCase();

    return archiveAllLogs
      .filter(log => {
        const dateValue = normalizeText(log?.inspectionDate);

        if (startDate && dateValue < startDate) {
          return false;
        }

        if (endDate && dateValue > endDate) {
          return false;
        }

        if (!keyword) {
          return true;
        }

        const searchText = [
          dateValue,
          formatBoardDate(dateValue),
          ...getLogInspectorNames(log),
          log?.authorName,
          log?.lastModifiedByName,
          log?.status,
          normalizeShiftLabel(log?.shift)
        ]
          .map(value => normalizeText(value).toLowerCase())
          .join(" ");

        return searchText.includes(keyword);
      })
      .sort((first, second) => {
        return normalizeText(second?.inspectionDate).localeCompare(
          normalizeText(first?.inspectionDate)
        );
      });
  }


  function renderArchiveBoard() {
    if (!archiveTableBody || !archiveEmpty) {
      return;
    }

    const logs = getFilteredArchiveLogs();
    archiveTableBody.innerHTML = "";

    if (archiveCount) {
      archiveCount.textContent = `총 ${logs.length}건`;
    }

    archiveEmpty.hidden = logs.length > 0;

    logs.forEach((log, index) => {
      const row = document.createElement("tr");
      const inspectors = getLogInspectorNames(log);
      const inspectorLabel = inspectors.length
        ? inspectors.join(" · ")
        : normalizeText(log?.authorName) || "미확인";
      const canDelete = log?.canDelete === true;

      row.innerHTML = `
        <td>${escapeHtml(String(logs.length - index))}</td>
        <td><strong>${escapeHtml(formatBoardDate(log.inspectionDate))}</strong></td>
        <td>${escapeHtml(normalizeShiftLabel(log.shift))}</td>
        <td>
          <strong>${escapeHtml(inspectorLabel)}</strong><br>
          <small>작성 ${escapeHtml(log.authorName || "미확인")}</small>
        </td>
        <td>${escapeHtml(log.status || "저장완료")}</td>
        <td>${escapeHtml(formatDateTime(log.updatedAt) || "-")}</td>
        <td>${escapeHtml(String(log.serverRevision || 1))}</td>
        <td>
          <div class="soot-archive-actions">
            <button
              type="button"
              data-soot-archive-open="${escapeHtml(log.id)}"
            >
              보기·수정
            </button>

            <button
              type="button"
              data-soot-archive-print="${escapeHtml(log.id)}"
            >
              인쇄
            </button>

            ${
              canDelete
                ? `
                    <button
                      type="button"
                      data-soot-archive-delete="${escapeHtml(log.id)}"
                      data-soot-archive-revision="${escapeHtml(String(log.serverRevision || 1))}"
                      data-soot-archive-date="${escapeHtml(log.inspectionDate || "")}"
                    >
                      삭제
                    </button>
                  `
                : ""
            }
          </div>
        </td>
      `;

      archiveTableBody.appendChild(row);
    });
  }


  async function loadArchiveBoard() {
    if (archiveEmpty) {
      archiveEmpty.hidden = false;
      archiveEmpty.textContent = "저장된 일지를 불러오는 중입니다.";
    }

    try {
      const payload = await requestApi(SOOT_BLOWER_WEEKLY_API_URL);

      archiveAllLogs = Array.isArray(payload.logs)
        ? payload.logs
        : [];

      if (archiveEmpty) {
        archiveEmpty.textContent =
          "저장된 Soot Blower 주간점검일지가 없습니다.";
      }

      renderArchiveBoard();

    } catch (error) {
      if (archiveEmpty) {
        archiveEmpty.hidden = false;
        archiveEmpty.textContent =
          error.message || "보관함을 불러오지 못했습니다.";
      }
    }
  }


  async function openArchiveBoard() {
    setWriteViewVisible(false);
    await loadArchiveBoard();
  }


  function closeArchiveBoard() {
    setWriteViewVisible(true);
  }


  async function openArchiveLog(logId, printAfterOpen = false) {
    const normalizedId = normalizeText(logId);

    if (!normalizedId) {
      return;
    }

    if (
      isDirty &&
      !window.confirm(
        "현재 저장하지 않은 내용이 있습니다. 저장된 기록을 열면 현재 내용이 바뀝니다. 계속하시겠습니까?"
      )
    ) {
      return;
    }

    try {
      const payload = await requestApi(
        `${SOOT_BLOWER_WEEKLY_API_URL}?id=${encodeURIComponent(normalizedId)}`
      );

      if (!payload.log) {
        throw new Error("저장된 점검일지를 찾지 못했습니다.");
      }

      applyLogToForm(payload.log);
      closeArchiveBoard();

      if (printAfterOpen) {
        openPrintPreview();
      }

    } catch (error) {
      window.alert(
        error.message || "저장된 점검일지를 열지 못했습니다."
      );
    }
  }


  /* =======================================================
    Soot Blower 점검일지 삭제 및 일정 완료 자동 취소

    처리:
    1. Soot Blower 점검일지 D1 삭제
    2. 연결된 일요일 일정 완료 취소
    3. 점검일지 상단 건수 즉시 갱신
  ======================================================= */

  async function deleteArchiveLog(
    logId,
    expectedRevision,
    inspectionDateValue,
    deleteButton = null
  ) {
    const normalizedId =
      normalizeText(
        logId
      );


    const revision =
      Number(
        expectedRevision
      );


    const normalizedInspectionDate =
      normalizeText(
        inspectionDateValue
      );


    const dateLabel =
      formatBoardDate(
        normalizedInspectionDate
      );


    if (
      !normalizedId ||
      !Number.isInteger(
        revision
      ) ||
      revision <
        1 ||
      !normalizedInspectionDate
    ) {
      window.alert(
        "삭제할 점검일지 정보를 확인하지 못했습니다."
      );


      return;
    }


    if (
      !window.confirm(
        `${dateLabel} Soot Blower 주간점검일지를 삭제하시겠습니까?`
      )
    ) {
      return;
    }


    if (
      deleteButton
    ) {
      deleteButton.disabled =
        true;


      deleteButton.textContent =
        "삭제 중";
    }


    try {
      /* =================================================
        Soot Blower 점검일지 D1 삭제
      ================================================= */

      const payload =
        await requestApi(
          SOOT_BLOWER_WEEKLY_API_URL,

          {
            method:
              "DELETE",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                id:
                  normalizedId,

                expectedRevision:
                  revision
              })
          }
        );


      /* =================================================
        보관함 목록에서 제거
      ================================================= */

      archiveAllLogs =
        archiveAllLogs.filter(
          log => {
            return (
              normalizeText(
                log?.id
              ) !==
              normalizedId
            );
          }
        );


      renderArchiveBoard();


      /* =================================================
        현재 열려 있는 점검일지를 삭제한 경우
      ================================================= */

      if (
        currentLogId ===
          normalizedId
      ) {
        currentLogId =
          "";


        currentRevision =
          0;


        isDirty =
          false;


        removeRecoveryDraft(
          normalizedInspectionDate
        );


        isApplyingData =
          true;


        clearFormForNewDate();


        isApplyingData =
          false;


        setSaveState(
          "새 일지 · 저장되지 않음"
        );
      }


      /* =================================================
        점검 일정 완료 자동 취소

        일정 연동에 실패해도
        이미 삭제된 Soot Blower 일지는 복원하지 않는다.
      ================================================= */

      let scheduleResult =
        null;


      let scheduleSyncError =
        null;


      try {
        scheduleResult =
          await cancelSootScheduleStatus(
            normalizedInspectionDate
          );

      } catch (
        error
      ) {
        scheduleSyncError =
          error;


        console.error(
          "Soot Blower 점검 일정 완료 취소 실패:",
          error
        );
      }


      if (
        scheduleSyncError
      ) {
        window.alert(
          [
            payload.message ||
            "Soot Blower 주간점검일지가 삭제되었습니다.",

            "",

            "다만 점검 일정 완료 상태는 자동 취소하지 못했습니다.",

            scheduleSyncError.message ||
            "점검 일정 연동 오류"
          ].join(
            "\n"
          )
        );

      } else {
        window.alert(
          [
            payload.message ||
            "Soot Blower 주간점검일지가 삭제되었습니다.",

            "",

            `점검 일정 기준일 ${scheduleResult?.dueDate || normalizedInspectionDate} N/S도 미완료 상태로 변경했습니다.`
          ].join(
            "\n"
          )
        );
      }

    } catch (
      error
    ) {
      window.alert(
        error.message ||
        "Soot Blower 주간점검일지를 삭제하지 못했습니다."
      );


      if (
        error.status ===
          409
      ) {
        await loadArchiveBoard();
      }

    } finally {
      if (
        deleteButton?.isConnected
      ) {
        deleteButton.disabled =
          false;


        deleteButton.textContent =
          "삭제";
      }
    }
  }


  /* =======================================================
    A4 1페이지 미리보기 및 인쇄
  ======================================================= */

  function removeCloneIds(root) {
    if (root.id) {
      root.removeAttribute("id");
    }

    root.querySelectorAll("[id]").forEach(element => {
      element.removeAttribute("id");
    });
  }


  function replaceCloneFieldsWithText(originalRoot, clonedRoot) {
    const originals = Array.from(
      originalRoot.querySelectorAll("input, textarea, select")
    );

    const clones = Array.from(
      clonedRoot.querySelectorAll("input, textarea, select")
    );

    clones.forEach((clone, index) => {
      const original = originals[index];
      let value = "";

      if (original instanceof HTMLSelectElement) {
        value = normalizeText(
          original.selectedOptions[0]?.textContent
        );
      } else {
        value = normalizeText(original?.value);
      }

      if (original === inspectionDate && value) {
        value = formatDateForPrint(value);
      }

      const printValue = document.createElement("span");
      printValue.className = "soot-check-print-value";

      if (original instanceof HTMLTextAreaElement) {
        printValue.classList.add("is-textarea");
      }

      if (original instanceof HTMLSelectElement) {
        printValue.classList.add("is-result");
      }

      if (original?.classList.contains("soot-check-remark-input")) {
        printValue.classList.add("is-remark");
      }

      if (original?.classList.contains("soot-check-occurrence-input")) {
        printValue.classList.add("is-occurrence");
      }

      if (original === inspectionDate) {
        printValue.classList.add("is-inspection-date");
      }

      printValue.textContent = value;
      clone.replaceWith(printValue);
    });
  }


  function createPreviewPage() {
    const clone = sheet.cloneNode(true);

    replaceCloneFieldsWithText(sheet, clone);
    removeCloneIds(clone);
    clone.classList.add("soot-check-sheet--preview");

    return clone;
  }


  function openPrintPreview() {
    if (!previewModal || !previewBody) {
      return;
    }

    if (isDirty) {
      saveRecoveryDraft();
    }

    previewBody.innerHTML = "";
    previewBody.appendChild(createPreviewPage());
    previewModal.hidden = false;
    document.body.style.overflow = "hidden";
  }


  function closePrintPreview() {
    if (previewModal) {
      previewModal.hidden = true;
    }

    document.body.style.overflow = "";
  }


  function prepareDateForPrint() {
    if (printDateBackup) {
      return;
    }

    printDateBackup = {
      type: inspectionDate.type,
      value: inspectionDate.value
    };

    inspectionDate.type = "text";
    inspectionDate.value = formatDateForPrint(printDateBackup.value);
  }


  function restoreDateAfterPrint() {
    if (!printDateBackup) {
      return;
    }

    inspectionDate.type = printDateBackup.type;
    inspectionDate.value = printDateBackup.value;
    printDateBackup = null;
  }


  function printInspectionSheet() {
    closePrintPreview();
    prepareDateForPrint();

    window.setTimeout(
      () => {
        window.print();
      },
      100
    );
  }


  /* =======================================================
    이벤트
  ======================================================= */

  function handleEditableFieldChange(event) {
    const target = event.target;

    if (
      target === inspectionDate ||
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
    ) {
      return;
    }

    if (target instanceof HTMLSelectElement) {
      refreshDefectStyle(target);
    }

    markDirty();
  }


  writeView.addEventListener("input", handleEditableFieldChange);
  writeView.addEventListener("change", handleEditableFieldChange);


  inspectionDate.addEventListener(
    "change",
    async () => {
      const nextDate = inspectionDate.value;

      if (
        isDirty &&
        lastLoadedDate &&
        nextDate !== lastLoadedDate &&
        !window.confirm(
          "현재 날짜에 저장하지 않은 내용이 있습니다. 다른 날짜로 이동하시겠습니까?"
        )
      ) {
        inspectionDate.value = lastLoadedDate;
        return;
      }

      await loadLogForDate(nextDate);
    }
  );


  saveButton?.addEventListener("click", saveInspectionLog);
  previewButton?.addEventListener("click", openPrintPreview);
  archiveOpenButton?.addEventListener("click", openArchiveBoard);
  archiveBackButton?.addEventListener("click", closeArchiveBoard);
  archiveRefreshButton?.addEventListener("click", loadArchiveBoard);
  archiveSearchButton?.addEventListener("click", renderArchiveBoard);


  archiveResetButton?.addEventListener(
    "click",
    () => {
      if (archiveStartDate) {
        archiveStartDate.value = getDateMonthsAgo(12);
      }

      if (archiveEndDate) {
        archiveEndDate.value = getTodayDateValue();
      }

      if (archiveKeyword) {
        archiveKeyword.value = "";
      }

      renderArchiveBoard();
    }
  );


  archiveKeyword?.addEventListener(
    "keydown",
    event => {
      if (event.key === "Enter") {
        renderArchiveBoard();
      }
    }
  );


  archiveTableBody?.addEventListener(
    "click",
    event => {
      const target = event.target instanceof Element
        ? event.target
        : null;

      const openButton = target?.closest("[data-soot-archive-open]");

      if (openButton) {
        openArchiveLog(
          openButton.getAttribute("data-soot-archive-open"),
          false
        );
        return;
      }

      const archivePrintButton =
        target?.closest("[data-soot-archive-print]");

      if (archivePrintButton) {
        openArchiveLog(
          archivePrintButton.getAttribute("data-soot-archive-print"),
          true
        );
        return;
      }

      const deleteButton =
        target?.closest("[data-soot-archive-delete]");

      if (deleteButton) {
        deleteArchiveLog(
          deleteButton.getAttribute("data-soot-archive-delete"),
          deleteButton.getAttribute("data-soot-archive-revision"),
          deleteButton.getAttribute("data-soot-archive-date"),
          deleteButton
        );
      }
    }
  );


  previewCloseButton?.addEventListener("click", closePrintPreview);
  previewCancelButton?.addEventListener("click", closePrintPreview);
  printButton?.addEventListener("click", printInspectionSheet);


  previewModal?.addEventListener(
    "click",
    event => {
      if (event.target === previewModal) {
        closePrintPreview();
      }
    }
  );


  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Escape" &&
        previewModal &&
        !previewModal.hidden
      ) {
        closePrintPreview();
      }
    }
  );


  window.addEventListener("beforeprint", prepareDateForPrint);
  window.addEventListener("afterprint", restoreDateAfterPrint);


  window.addEventListener(
    "beforeunload",
    event => {
      if (!isDirty) {
        return;
      }

      saveRecoveryDraft();
      event.preventDefault();
      event.returnValue = "";
    }
  );


  /* =======================================================
    최초 실행
  ======================================================= */

  renderCheckRows();

  if (archiveStartDate) {
    archiveStartDate.value = getDateMonthsAgo(12);
  }

  if (archiveEndDate) {
    archiveEndDate.value = getTodayDateValue();
  }

  if (!inspectionDate.value) {
    inspectionDate.value = getTodayDateValue();
  }

  loadLogForDate(inspectionDate.value);
}
