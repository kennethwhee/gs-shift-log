"use strict";

/* =========================================================
  LNG System 주간점검 일지

  기능:
  - 매주 일요일 D/S 점검일지
  - Cloudflare D1 공용 저장
  - 날짜별 저장·불러오기
  - revision 충돌 방지
  - 게시판형 보관함 조회
  - 보기·수정·인쇄·삭제
  - 최고관리자 점검사항 편집
  - 브라우저 임시 복구
  - 원본 2페이지 인쇄 미리보기
========================================================= */

const LNG_WEEKLY_API_URL =
  "/api/inspection-logs/lng-weekly";

const LNG_CURRENT_USER_STORAGE_KEY =
  "gsShiftLog.currentUser";

const LNG_FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";

const LNG_DEFAULT_TEMPLATE_ITEMS = [
  "CFBC용 정압기 입구압력 (3~6barg)",
  "CFBC용 정압기 출구압력 (2~4barg)",
  "Aux’ BLR 정압기 입구압력 (3~6barg)",
  "Aux’ BLR 정압기 출구압력 (2~4barg)",
  "CFBC BLR #1 FCV 후단 압력",
  "CFBC BLR #2 FCV 후단 압력",
  "Aux BLR #3 FCV 후단 압력",
  "Aux BLR #4 FCV 후단 압력",
  "긴급 차단장치 동작상태",
  "정압기 이상유무",
  "정압실 통풍상태는 양호한가",
  "각 Press Gauge는 동작상태는 양호한가",
  "각 Gas 누설 경보장치 상태는 양호한가",
  "정압실 LNG Line의 Flange 및 접합 부위 등에서\n가스가 유출되고 있지 않는가",
  "CFBC #1 LNG Line의 Flange 및 접합 부위\n등에서 가스가 유출되고 있지 않는가",
  "CFBC #2 LNG Line의 Flange 및 접합 부위\n등에서 가스가 유출되고 있지 않는가",
  "Aux BLR #3 LNG Line의 Flange 및 접합 부위\n등에서 가스가 유출되고 있지 않는가",
  "Aux BLR #4 LNG Line의 Flange 및 접합 부위\n등에서 가스가 유출되고 있지 않는가",
  "CFBC, Aux’ LNG Flow Meter는 정상인가",
  "소화기 상태와 비치는 적당한가",
  "I.A Press는 적절한가 (4.0~8.5barg)",
  "Gas Filter #A, #B 전, 후단의 △P는 얼마인가",
  "각 Control v/v 의 동작상태는 양호한가",
  "설비 주변 청결상태는 양호한가",
  "정압기 입구압력 (3~6barg)",
  "정압기 출구압력 (0.02~0.04barg)",
  "정압기 동작상태는 양호한가",
  "정압기 및 Line의 Flange 접합부위\n등에서 가스가 새고 있지 않는가"
];


document.addEventListener(
  "DOMContentLoaded",
  () => {
    initializeLngWeeklyInspection();
  }
);


function initializeLngWeeklyInspection() {
  const writeView =
    document.getElementById(
      "lngWriteView"
    );

  const sheetPage1 =
    document.getElementById(
      "lngCheckSheetPage1"
    );

  const sheetPage2 =
    document.getElementById(
      "lngCheckSheetPage2"
    );

  const inspectionDate =
    document.getElementById(
      "lngInspectionDate"
    );

  if (
    !writeView ||
    !sheetPage1 ||
    !sheetPage2 ||
    !inspectionDate
  ) {
    return;
  }

  const saveButton =
    document.getElementById(
      "lngCheckSaveButton"
    );

  const previewButton =
    document.getElementById(
      "lngCheckPreviewButton"
    );

  const archiveOpenButton =
    document.getElementById(
      "lngArchiveOpenButton"
    );

  const templateEditButton =
    document.getElementById(
      "lngTemplateEditButton"
    );

  const saveState =
    document.getElementById(
      "lngCheckSaveState"
    );

  const archiveView =
    document.getElementById(
      "lngArchiveView"
    );

  const archiveBackButton =
    document.getElementById(
      "lngArchiveBackButton"
    );

  const archiveRefreshButton =
    document.getElementById(
      "lngArchiveRefreshButton"
    );

  const archiveStartDate =
    document.getElementById(
      "lngArchiveStartDate"
    );

  const archiveEndDate =
    document.getElementById(
      "lngArchiveEndDate"
    );

  const archiveKeyword =
    document.getElementById(
      "lngArchiveKeyword"
    );

  const archiveSearchButton =
    document.getElementById(
      "lngArchiveSearchButton"
    );

  const archiveResetButton =
    document.getElementById(
      "lngArchiveResetButton"
    );

  const archiveCount =
    document.getElementById(
      "lngArchiveCount"
    );

  const archiveTableBody =
    document.getElementById(
      "lngArchiveTableBody"
    );

  const archiveEmpty =
    document.getElementById(
      "lngArchiveEmpty"
    );

  const templateModal =
    document.getElementById(
      "lngTemplateModal"
    );

  const templateEditList =
    document.getElementById(
      "lngTemplateEditList"
    );

  const templateCloseButton =
    document.getElementById(
      "lngTemplateCloseButton"
    );

  const templateCancelButton =
    document.getElementById(
      "lngTemplateCancelButton"
    );

  const templateApplyButton =
    document.getElementById(
      "lngTemplateApplyButton"
    );

  const previewModal =
    document.getElementById(
      "lngPrintPreview"
    );

  const previewBody =
    document.getElementById(
      "lngPrintPreviewBody"
    );

  const previewCloseButton =
    document.getElementById(
      "lngPreviewCloseButton"
    );

  const previewCancelButton =
    document.getElementById(
      "lngPreviewCancelButton"
    );

  const printButton =
    document.getElementById(
      "lngPrintButton"
    );

  let currentLogId =
    "";

  let currentRevision =
    0;

  let currentTemplateItems =
    cloneTemplateItems(
      LNG_DEFAULT_TEMPLATE_ITEMS
    );

  let latestServerTemplate =
    null;

  let canEditTemplate =
    isStoredUserSuperAdmin();

  let archiveAllLogs =
    [];

  let isDirty =
    false;

  let isApplyingData =
    false;

  let lastLoadedDate =
    "";

  let draftSaveTimer =
    null;

  let printDateBackup =
    null;


  /* =======================================================
    공통 유틸리티
  ======================================================= */

  function normalizeText(
    value
  ) {
    return String(
      value ??
      ""
    ).trim();
  }


  function escapeHtml(
    value
  ) {
    return String(
      value ??
      ""
    )
      .replace(
        /&/g,
        "&amp;"
      )
      .replace(
        /</g,
        "&lt;"
      )
      .replace(
        />/g,
        "&gt;"
      )
      .replace(
        /"/g,
        "&quot;"
      )
      .replace(
        /'/g,
        "&#039;"
      );
  }


  function cloneTemplateItems(
    items
  ) {
    const source =
      Array.isArray(
        items
      ) &&
      items.length ===
        28
        ? items
        : LNG_DEFAULT_TEMPLATE_ITEMS;

    return source.map(
      (
        item,
        index
      ) => {
        const rawText =
          typeof item ===
            "string"
            ? item
            : item?.item;

        return {
          number:
            index +
            1,
          item:
            String(
              rawText ??
              LNG_DEFAULT_TEMPLATE_ITEMS[index]
            )
              .replace(
                /\r\n?/g,
                "\n"
              )
              .trim()
        };
      }
    );
  }


  function getTodayDateValue() {
    const now =
      new Date();

    const year =
      now.getFullYear();

    const month =
      String(
        now.getMonth() +
        1
      ).padStart(
        2,
        "0"
      );

    const day =
      String(
        now.getDate()
      ).padStart(
        2,
        "0"
      );

    return `${year}-${month}-${day}`;
  }


  function getDateMonthsAgo(
    months
  ) {
    const date =
      new Date();

    date.setMonth(
      date.getMonth() -
      Number(
        months ||
        0
      )
    );

    const year =
      date.getFullYear();

    const month =
      String(
        date.getMonth() +
        1
      ).padStart(
        2,
        "0"
      );

    const day =
      String(
        date.getDate()
      ).padStart(
        2,
        "0"
      );

    return `${year}-${month}-${day}`;
  }


  function formatDateForPrint(
    dateValue
  ) {
    const parts =
      String(
        dateValue ||
        ""
      ).split(
        "-"
      );

    if (
      parts.length !==
      3
    ) {
      return dateValue ||
        "";
    }

    return (
      `${parts[0]} 년 ` +
      `${Number(parts[1])} 월 ` +
      `${Number(parts[2])} 일 일요일`
    );
  }


  function formatBoardDate(
    dateValue
  ) {
    const parts =
      String(
        dateValue ||
        ""
      ).split(
        "-"
      );

    if (
      parts.length !==
      3
    ) {
      return dateValue ||
        "날짜 미확인";
    }

    return `${parts[0]}.${parts[1]}.${parts[2]}`;
  }


  function formatDateTime(
    dateTimeValue
  ) {
    const date =
      new Date(
        dateTimeValue ||
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
          "numeric",
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


  function normalizeShiftLabel(
    value
  ) {
    const normalized =
      normalizeText(
        value
      )
        .toUpperCase()
        .replace(
          /[^A-Z]/g,
          ""
        );

    return normalized ===
      "NS"
      ? "N/S"
      : "D/S";
  }


  /* =======================================================
    로그인 정보
  ======================================================= */

  function loadStoredUser() {
    try {
      const savedUser =
        localStorage.getItem(
          LNG_CURRENT_USER_STORAGE_KEY
        );

      return savedUser
        ? JSON.parse(
            savedUser
          )
        : null;

    } catch (
      error
    ) {
      console.warn(
        "로그인 정보 불러오기 실패:",
        error
      );

      return null;
    }
  }


  function getSessionToken() {
    const user =
      loadStoredUser();

    return normalizeText(
      user?.sessionToken ||
      user?.session_token
    );
  }


  function getCurrentUserName() {
    const user =
      loadStoredUser();

    return normalizeText(
      user?.name ||
      user?.userName ||
      user?.user_name ||
      user?.memberName
    );
  }


  function getStoredEmployeeNo() {
    const user =
      loadStoredUser();

    return normalizeText(
      user?.employeeNo ||
      user?.employee_no ||
      user?.employeeId ||
      user?.employee_id ||
      user?.id
    ).replace(
      /\s+/g,
      ""
    );
  }


  function isStoredUserSuperAdmin() {
    const user =
      loadStoredUser();

    const role =
      normalizeText(
        user?.role
      )
        .toLowerCase()
        .replace(
          /[\s-]+/g,
          "_"
        );

    return (
      getStoredEmployeeNo() ===
        LNG_FORCED_SUPER_ADMIN_EMPLOYEE_NO ||
      role ===
        "super_admin" ||
      role ===
        "superadmin" ||
      user?.isSuperAdmin ===
        true ||
      Number(
        user?.adminLevel ??
        user?.admin_level ??
        0
      ) >=
        2
    );
  }


  function canCurrentUserDeleteLog(
    log
  ) {
    if (
      log?.canDelete ===
        true ||
      isStoredUserSuperAdmin()
    ) {
      return true;
    }

    const currentEmployeeNo =
      getStoredEmployeeNo();

    const authorEmployeeNo =
      normalizeText(
        log?.authorId
      ).replace(
        /\s+/g,
        ""
      );

    return Boolean(
      currentEmployeeNo &&
      authorEmployeeNo &&
      currentEmployeeNo ===
        authorEmployeeNo
    );
  }


  /* =======================================================
    API 요청
  ======================================================= */

  async function requestApi(
    url,
    options = {}
  ) {
    const token =
      getSessionToken();

    if (
      !token
    ) {
      throw new Error(
        "로그인 정보가 없습니다. 업무일지에서 다시 로그인해 주세요."
      );
    }

    const headers = {
      Accept:
        "application/json",
      ...(
        options.headers ||
        {}
      ),
      Authorization:
        `Bearer ${token}`
    };

    const response =
      await fetch(
        url,
        {
          ...options,
          headers
        }
      );

    let payload =
      null;

    try {
      payload =
        await response.json();

    } catch {
      payload =
        null;
    }

    if (
      !response.ok ||
      payload?.ok ===
        false
    ) {
      const error =
        new Error(
          payload?.message ||
          `요청에 실패했습니다. (${response.status})`
        );

      error.status =
        response.status;

      error.payload =
        payload;

      throw error;
    }

    return payload ||
      {
        ok:
          true
      };
  }


  /* =======================================================
    원본 표의 빈 구분 칸 자동 생성
  ======================================================= */

  function ensureAreaCells() {
    document
      .querySelectorAll(
        "[data-lng-item-row]"
      )
      .forEach(
        row => {
          const number =
            Number(
              row.getAttribute(
                "data-lng-item-row"
              )
            );

          if (
            !Number.isInteger(
              number
            ) ||
            number <
              1 ||
            number >
              24 ||
            row.querySelector(
              ".lng-area-cell"
            )
          ) {
            return;
          }

          const areaCell =
            document.createElement(
              "td"
            );

          areaCell.className =
            "lng-area-cell";

          areaCell.setAttribute(
            "aria-hidden",
            "true"
          );

          row.insertBefore(
            areaCell,
            row.children[1] ||
            null
          );
        }
      );
  }


  /* =======================================================
    저장 상태
  ======================================================= */

  function setSaveState(
    message,
    state = ""
  ) {
    if (
      !saveState
    ) {
      return;
    }

    saveState.classList.remove(
      "is-saved",
      "is-saving",
      "is-error"
    );

    if (
      state
    ) {
      saveState.classList.add(
        `is-${state}`
      );
    }

    saveState.textContent =
      message;
  }


  function setToolbarBusy(
    isBusy
  ) {
    [
      saveButton,
      previewButton,
      archiveOpenButton,
      templateEditButton
    ].forEach(
      button => {
        if (
          button
        ) {
          button.disabled =
            Boolean(
              isBusy
            );
        }
      }
    );
  }


  function refreshTemplateEditButton() {
    if (
      templateEditButton
    ) {
      templateEditButton.hidden =
        !canEditTemplate;
    }
  }


  function markDirty() {
    if (
      isApplyingData
    ) {
      return;
    }

    isDirty =
      true;

    setSaveState(
      currentLogId
        ? "수정됨 · 저장 필요"
        : "작성 중 · 저장 필요"
    );

    window.clearTimeout(
      draftSaveTimer
    );

    draftSaveTimer =
      window.setTimeout(
        () => {
          saveRecoveryDraft();
        },
        500
      );
  }


  /* =======================================================
    양식 문구 적용
  ======================================================= */

  function getTemplateRows() {
    return Array.from(
      document.querySelectorAll(
        "[data-lng-item-row]"
      )
    ).sort(
      (
        first,
        second
      ) => {
        return (
          Number(
            first.getAttribute(
              "data-lng-item-row"
            )
          ) -
          Number(
            second.getAttribute(
              "data-lng-item-row"
            )
          )
        );
      }
    );
  }


  function applyTemplateToSheet(
    items
  ) {
    currentTemplateItems =
      cloneTemplateItems(
        items
      );

    getTemplateRows().forEach(
      (
        row,
        index
      ) => {
        const titleCell =
          row.querySelector(
            "[data-lng-item-title]"
          );

        if (
          !titleCell
        ) {
          return;
        }

        titleCell.innerHTML =
          escapeHtml(
            currentTemplateItems[index]?.item ||
            ""
          ).replace(
            /\n/g,
            "<br>"
          );
      }
    );
  }


  /* =======================================================
    입력값 수집·적용
  ======================================================= */

  function getFormFieldElements() {
    return Array.from(
      writeView.querySelectorAll(
        "input[id], textarea[id]"
      )
    ).filter(
      element => {
        return (
          element.id !==
            "lngInspectionDate" &&
          !element.closest(
            ".lng-template-modal"
          ) &&
          !element.closest(
            ".lng-print-preview"
          )
        );
      }
    );
  }


  function collectFormData() {
    const fields =
      {};

    getFormFieldElements().forEach(
      element => {
        fields[element.id] =
          String(
            element.value ||
            ""
          );
      }
    );

    return {
      fields,
      inspectorName:
        fields.lngInspectorName ||
        "",
      remark:
        fields.lngRemark ||
        ""
    };
  }


  function applyFormData(
    form
  ) {
    const source =
      form &&
      typeof form ===
        "object"
        ? form
        : {};

    const fields =
      source.fields &&
      typeof source.fields ===
        "object"
        ? source.fields
        : source;

    getFormFieldElements().forEach(
      element => {
        if (
          Object.prototype.hasOwnProperty.call(
            fields,
            element.id
          )
        ) {
          element.value =
            String(
              fields[element.id] ??
              ""
            );
        }
      }
    );
  }


  function clearFormForNewDate() {
    getFormFieldElements().forEach(
      element => {
        element.value =
          "";
      }
    );

    const currentUserName =
      getCurrentUserName();

    if (
      currentUserName
    ) {
      const inspectorInput =
        document.getElementById(
          "lngInspectorName"
        );

      if (
        inspectorInput
      ) {
        inspectorInput.value =
          currentUserName;
      }
    }
  }


  function applyLogToForm(
    log
  ) {
    if (
      !log
    ) {
      return;
    }

    isApplyingData =
      true;

    inspectionDate.value =
      normalizeText(
        log.inspectionDate
      ) ||
      inspectionDate.value;

    applyTemplateToSheet(
      log.templateItems
    );

    applyFormData(
      log.form
    );

    currentLogId =
      normalizeText(
        log.id
      );

    currentRevision =
      Number(
        log.serverRevision
      ) ||
      0;

    lastLoadedDate =
      inspectionDate.value;

    isDirty =
      false;

    isApplyingData =
      false;

    setSaveState(
      `저장 완료 · revision ${currentRevision}`,
      "saved"
    );
  }


  /* =======================================================
    임시 복구
  ======================================================= */

  function getDraftStorageKey(
    dateValue =
      inspectionDate.value
  ) {
    return (
      "inspectionLogs.weekly.lng.draft." +
      normalizeText(
        dateValue
      )
    );
  }


  function saveRecoveryDraft() {
    const dateValue =
      normalizeText(
        inspectionDate.value
      );

    if (
      !dateValue
    ) {
      return;
    }

    localStorage.setItem(
      getDraftStorageKey(
        dateValue
      ),
      JSON.stringify({
        inspectionDate:
          dateValue,
        form:
          collectFormData(),
        templateItems:
          cloneTemplateItems(
            currentTemplateItems
          ),
        savedAt:
          new Date().toISOString()
      })
    );
  }


  function loadRecoveryDraft(
    dateValue
  ) {
    const rawValue =
      localStorage.getItem(
        getDraftStorageKey(
          dateValue
        )
      );

    if (
      !rawValue
    ) {
      return null;
    }

    try {
      return JSON.parse(
        rawValue
      );

    } catch {
      return null;
    }
  }


  function removeRecoveryDraft(
    dateValue =
      inspectionDate.value
  ) {
    localStorage.removeItem(
      getDraftStorageKey(
        dateValue
      )
    );
  }


  /* =======================================================
    서버 양식·날짜별 일지 불러오기
  ======================================================= */

  async function loadLatestTemplateFromServer() {
    if (
      Array.isArray(
        latestServerTemplate
      )
    ) {
      return cloneTemplateItems(
        latestServerTemplate
      );
    }

    try {
      const payload =
        await requestApi(
          LNG_WEEKLY_API_URL
        );

      const logs =
        Array.isArray(
          payload.logs
        )
          ? payload.logs
          : [];

      const sourceLog =
        logs.find(
          log => {
            return (
              Array.isArray(
                log?.templateItems
              ) &&
              log.templateItems.length ===
                28
            );
          }
        );

      latestServerTemplate =
        sourceLog
          ? cloneTemplateItems(
              sourceLog.templateItems
            )
          : cloneTemplateItems(
              LNG_DEFAULT_TEMPLATE_ITEMS
            );

    } catch {
      latestServerTemplate =
        cloneTemplateItems(
          LNG_DEFAULT_TEMPLATE_ITEMS
        );
    }

    return cloneTemplateItems(
      latestServerTemplate
    );
  }


  async function loadLogForDate(
    dateValue
  ) {
    const targetDate =
      normalizeText(
        dateValue
      );

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        targetDate
      )
    ) {
      setSaveState(
        "점검일자를 선택해 주세요.",
        "error"
      );

      return;
    }

    setToolbarBusy(
      true
    );

    setSaveState(
      "저장 기록 불러오는 중...",
      "saving"
    );

    try {
      const payload =
        await requestApi(
          `${LNG_WEEKLY_API_URL}?date=${encodeURIComponent(targetDate)}`
        );

      canEditTemplate =
        Boolean(
          payload.canEditTemplate
        ) ||
        isStoredUserSuperAdmin();

      refreshTemplateEditButton();

      if (
        payload.log
      ) {
        applyLogToForm(
          payload.log
        );

        removeRecoveryDraft(
          targetDate
        );

      } else {
        isApplyingData =
          true;

        inspectionDate.value =
          targetDate;

        currentLogId =
          "";

        currentRevision =
          0;

        clearFormForNewDate();

        const draft =
          loadRecoveryDraft(
            targetDate
          );

        if (
          draft
        ) {
          applyTemplateToSheet(
            draft.templateItems ||
            await loadLatestTemplateFromServer()
          );

          applyFormData(
            draft.form
          );

          isDirty =
            true;

          setSaveState(
            "복구된 임시 내용 · 일지 저장 필요"
          );

        } else {
          applyTemplateToSheet(
            await loadLatestTemplateFromServer()
          );

          isDirty =
            false;

          setSaveState(
            "새 일지 · 저장되지 않음"
          );
        }

        lastLoadedDate =
          targetDate;

        isApplyingData =
          false;
      }

    } catch (
      error
    ) {
      console.error(
        "LNG 점검일지 불러오기 실패:",
        error
      );

      isApplyingData =
        false;

      setSaveState(
        error.message ||
        "점검일지를 불러오지 못했습니다.",
        "error"
      );

    } finally {
      setToolbarBusy(
        false
      );

      refreshTemplateEditButton();
    }
  }


  /* =======================================================
    D1 저장
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
        "DS",
      status:
        "저장완료",
      form:
        collectFormData(),
      templateItems:
        cloneTemplateItems(
          currentTemplateItems
        )
    };

    setToolbarBusy(
      true
    );

    setSaveState(
      "D1에 저장하는 중...",
      "saving"
    );

    try {
      const payload =
        await requestApi(
          LNG_WEEKLY_API_URL,
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

      canEditTemplate =
        Boolean(
          payload.canEditTemplate
        ) ||
        canEditTemplate;

      applyLogToForm(
        payload.log
      );

      latestServerTemplate =
        cloneTemplateItems(
          payload.log?.templateItems ||
          currentTemplateItems
        );

      removeRecoveryDraft(
        dateValue
      );

      window.alert(
        payload.created
          ? "LNG 주간점검 일지가 저장되었습니다."
          : "LNG 주간점검 일지가 수정 저장되었습니다."
      );

    } catch (
      error
    ) {
      console.error(
        "LNG 점검일지 저장 실패:",
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
          "LNG 주간점검 일지를 저장하지 못했습니다."
        );
      }

    } finally {
      setToolbarBusy(
        false
      );

      refreshTemplateEditButton();
    }
  }


  /* =======================================================
    게시판형 보관함
  ======================================================= */

  function setWriteViewVisible(
    visible
  ) {
    writeView.hidden =
      !visible;

    if (
      archiveView
    ) {
      archiveView.hidden =
        visible;
    }
  }


  function getFilteredArchiveLogs() {
    const startDate =
      normalizeText(
        archiveStartDate?.value
      );

    const endDate =
      normalizeText(
        archiveEndDate?.value
      );

    const keyword =
      normalizeText(
        archiveKeyword?.value
      ).toLowerCase();

    return archiveAllLogs
      .filter(
        log => {
          const dateValue =
            normalizeText(
              log?.inspectionDate
            );

          if (
            startDate &&
            dateValue <
              startDate
          ) {
            return false;
          }

          if (
            endDate &&
            dateValue >
              endDate
          ) {
            return false;
          }

          if (
            !keyword
          ) {
            return true;
          }

          const inspectorName =
            normalizeText(
              log?.form?.fields?.lngInspectorName ||
              log?.form?.inspectorName
            );

          const searchText =
            [
              dateValue,
              formatBoardDate(
                dateValue
              ),
              inspectorName,
              log?.authorName,
              log?.lastModifiedByName,
              log?.status,
              normalizeShiftLabel(
                log?.shift
              )
            ]
              .map(
                value => normalizeText(
                  value
                ).toLowerCase()
              )
              .join(
                " "
              );

          return searchText.includes(
            keyword
          );
        }
      )
      .sort(
        (
          first,
          second
        ) => {
          return normalizeText(
            second?.inspectionDate
          ).localeCompare(
            normalizeText(
              first?.inspectionDate
            )
          );
        }
      );
  }


  function renderArchiveBoard() {
    if (
      !archiveTableBody ||
      !archiveEmpty
    ) {
      return;
    }

    const logs =
      getFilteredArchiveLogs();

    archiveTableBody.innerHTML =
      "";

    if (
      archiveCount
    ) {
      archiveCount.textContent =
        `총 ${logs.length}건`;
    }

    archiveEmpty.hidden =
      logs.length >
      0;

    logs.forEach(
      (
        log,
        index
      ) => {
        const row =
          document.createElement(
            "tr"
          );

        const inspectorName =
          normalizeText(
            log?.form?.fields?.lngInspectorName ||
            log?.form?.inspectorName ||
            log?.authorName
          ) ||
          "미확인";

        const canDelete =
          canCurrentUserDeleteLog(
            log
          );

        row.innerHTML = `
          <td>${escapeHtml(String(logs.length - index))}</td>
          <td><strong>${escapeHtml(formatBoardDate(log.inspectionDate))}</strong></td>
          <td>${escapeHtml(normalizeShiftLabel(log.shift))}</td>
          <td>
            <strong>${escapeHtml(inspectorName)}</strong><br>
            <small>작성 ${escapeHtml(log.authorName || "미확인")}</small>
          </td>
          <td>${escapeHtml(log.status || "저장완료")}</td>
          <td>${escapeHtml(formatDateTime(log.updatedAt) || "-")}</td>
          <td>${escapeHtml(String(log.serverRevision || 1))}</td>
          <td>
            <div class="lng-archive-actions">
              <button
                type="button"
                data-lng-archive-open="${escapeHtml(log.id)}"
              >
                보기·수정
              </button>

              <button
                type="button"
                data-lng-archive-print="${escapeHtml(log.id)}"
              >
                인쇄
              </button>

              ${
                canDelete
                  ? `
                    <button
                      type="button"
                      data-lng-archive-delete="${escapeHtml(log.id)}"
                      data-lng-archive-revision="${escapeHtml(String(log.serverRevision || 1))}"
                      data-lng-archive-date="${escapeHtml(log.inspectionDate || "")}"
                    >
                      삭제
                    </button>
                  `
                  : ""
              }
            </div>
          </td>
        `;

        archiveTableBody.appendChild(
          row
        );
      }
    );
  }


  async function loadArchiveBoard() {
    if (
      archiveEmpty
    ) {
      archiveEmpty.hidden =
        false;

      archiveEmpty.textContent =
        "저장된 일지를 불러오는 중입니다.";
    }

    try {
      const payload =
        await requestApi(
          LNG_WEEKLY_API_URL
        );

      archiveAllLogs =
        Array.isArray(
          payload.logs
        )
          ? payload.logs
          : [];

      canEditTemplate =
        Boolean(
          payload.canEditTemplate
        ) ||
        canEditTemplate;

      refreshTemplateEditButton();

      if (
        archiveEmpty
      ) {
        archiveEmpty.textContent =
          "저장된 LNG 주간점검 일지가 없습니다.";
      }

      renderArchiveBoard();

    } catch (
      error
    ) {
      if (
        archiveEmpty
      ) {
        archiveEmpty.hidden =
          false;

        archiveEmpty.textContent =
          error.message ||
          "보관함을 불러오지 못했습니다.";
      }
    }
  }


  async function openArchiveBoard() {
    setWriteViewVisible(
      false
    );

    await loadArchiveBoard();
  }


  function closeArchiveBoard() {
    setWriteViewVisible(
      true
    );
  }


  async function openArchiveLog(
    logId,
    printAfterOpen = false
  ) {
    const normalizedId =
      normalizeText(
        logId
      );

    if (
      !normalizedId
    ) {
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
      const payload =
        await requestApi(
          `${LNG_WEEKLY_API_URL}?id=${encodeURIComponent(normalizedId)}`
        );

      if (
        !payload.log
      ) {
        throw new Error(
          "저장된 점검일지를 찾지 못했습니다."
        );
      }

      canEditTemplate =
        Boolean(
          payload.canEditTemplate
        ) ||
        canEditTemplate;

      applyLogToForm(
        payload.log
      );

      closeArchiveBoard();

      refreshTemplateEditButton();

      if (
        printAfterOpen
      ) {
        openPrintPreview();
      }

    } catch (
      error
    ) {
      window.alert(
        error.message ||
        "저장된 점검일지를 열지 못했습니다."
      );
    }
  }


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

    const dateLabel =
      formatBoardDate(
        inspectionDateValue
      );

    if (
      !normalizedId ||
      !Number.isInteger(
        revision
      ) ||
      revision <
        1
    ) {
      window.alert(
        "삭제할 점검일지 정보를 확인하지 못했습니다."
      );

      return;
    }

    if (
      !window.confirm(
        `${dateLabel} LNG 주간점검 일지를 삭제하시겠습니까?`
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
      const payload =
        await requestApi(
          LNG_WEEKLY_API_URL,
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

      archiveAllLogs =
        archiveAllLogs.filter(
          log => {
            return normalizeText(
              log?.id
            ) !==
              normalizedId;
          }
        );

      renderArchiveBoard();

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

        await loadLogForDate(
          inspectionDate.value
        );
      }

      window.alert(
        payload.message ||
        "LNG 주간점검 일지가 삭제되었습니다."
      );

    } catch (
      error
    ) {
      window.alert(
        error.message ||
        "LNG 주간점검 일지를 삭제하지 못했습니다."
      );

      if (
        error.status ===
          409
      ) {
        await loadArchiveBoard();
      }

    } finally {
      if (
        deleteButton &&
        deleteButton.isConnected
      ) {
        deleteButton.disabled =
          false;

        deleteButton.textContent =
          "삭제";
      }
    }
  }


  /* =======================================================
    점검사항 편집
  ======================================================= */

  function openTemplateModal() {
    if (
      !canEditTemplate ||
      !templateModal ||
      !templateEditList
    ) {
      return;
    }

    templateEditList.innerHTML =
      currentTemplateItems
        .map(
          (
            item,
            index
          ) => {
            return `
              <div
                class="lng-template-edit-row"
                data-lng-template-index="${index}"
              >
                <span class="lng-template-edit-row__number">
                  ${index + 1}
                </span>

                <input
                  type="text"
                  data-lng-template-item
                  value="${escapeHtml(item.item)}"
                  aria-label="${index + 1}번 점검사항"
                >
              </div>
            `;
          }
        )
        .join(
          ""
        );

    templateModal.hidden =
      false;

    document.body.style.overflow =
      "hidden";
  }


  function closeTemplateModal() {
    if (
      templateModal
    ) {
      templateModal.hidden =
        true;
    }

    document.body.style.overflow =
      "";
  }


  function applyTemplateEdits() {
    if (
      !canEditTemplate ||
      !templateEditList
    ) {
      return;
    }

    const rows =
      Array.from(
        templateEditList.querySelectorAll(
          "[data-lng-template-index]"
        )
      );

    if (
      rows.length !==
      28
    ) {
      window.alert(
        "점검사항 28개를 확인해 주세요."
      );

      return;
    }

    const editedItems =
      rows.map(
        (
          row,
          index
        ) => ({
          number:
            index +
            1,
          item:
            normalizeText(
              row.querySelector(
                "[data-lng-template-item]"
              )?.value
            )
        })
      );

    if (
      editedItems.some(
        item => !item.item
      )
    ) {
      window.alert(
        "점검사항을 모두 입력해 주세요."
      );

      return;
    }

    applyTemplateToSheet(
      editedItems
    );

    latestServerTemplate =
      cloneTemplateItems(
        editedItems
      );

    closeTemplateModal();

    markDirty();

    window.alert(
      "점검사항이 화면에 적용되었습니다. D1에 반영하려면 일지 저장을 눌러 주세요."
    );
  }


  /* =======================================================
    인쇄 미리보기
  ======================================================= */

  function removeCloneIds(
    root
  ) {
    if (
      root.id
    ) {
      root.removeAttribute(
        "id"
      );
    }

    root
      .querySelectorAll(
        "[id]"
      )
      .forEach(
        element => {
          element.removeAttribute(
            "id"
          );
        }
      );
  }


  function replaceCloneFieldsWithText(
    originalRoot,
    clonedRoot
  ) {
    const originals =
      Array.from(
        originalRoot.querySelectorAll(
          "input, textarea"
        )
      );

    const clones =
      Array.from(
        clonedRoot.querySelectorAll(
          "input, textarea"
        )
      );

    clones.forEach(
      (
        clone,
        index
      ) => {
        const original =
          originals[index];

        let value =
          String(
            original?.value ||
            ""
          ).trim();

        if (
          original ===
            inspectionDate &&
          value
        ) {
          value =
            formatDateForPrint(
              value
            );
        }

        const printValue =
          document.createElement(
            "span"
          );

        printValue.className =
          "lng-check-print-value";

        printValue.textContent =
          value;

        printValue.style.display =
          "block";

        printValue.style.width =
          "100%";

        printValue.style.minHeight =
          original instanceof
            HTMLTextAreaElement
            ? "8mm"
            : "6mm";

        printValue.style.whiteSpace =
          "pre-wrap";

        printValue.style.textAlign =
          "center";

        printValue.style.fontSize =
          "8.5px";

        clone.replaceWith(
          printValue
        );
      }
    );
  }


  function createPreviewPages() {
    return [
      sheetPage1,
      sheetPage2
    ].map(
      sheet => {
        const clone =
          sheet.cloneNode(
            true
          );

        replaceCloneFieldsWithText(
          sheet,
          clone
        );

        removeCloneIds(
          clone
        );

        return clone;
      }
    );
  }


  function openPrintPreview() {
    if (
      !previewModal ||
      !previewBody
    ) {
      return;
    }

    if (
      isDirty
    ) {
      saveRecoveryDraft();
    }

    previewBody.innerHTML =
      "";

    createPreviewPages().forEach(
      page => {
        previewBody.appendChild(
          page
        );
      }
    );

    previewModal.hidden =
      false;

    document.body.style.overflow =
      "hidden";
  }


  function closePrintPreview() {
    if (
      previewModal
    ) {
      previewModal.hidden =
        true;
    }

    document.body.style.overflow =
      "";
  }


  function prepareDateForPrint() {
    if (
      printDateBackup
    ) {
      return;
    }

    printDateBackup = {
      type:
        inspectionDate.type,
      value:
        inspectionDate.value
    };

    const originalValue =
      inspectionDate.value;

    inspectionDate.type =
      "text";

    inspectionDate.value =
      formatDateForPrint(
        originalValue
      );
  }


  function restoreDateAfterPrint() {
    if (
      !printDateBackup
    ) {
      return;
    }

    inspectionDate.type =
      printDateBackup.type;

    inspectionDate.value =
      printDateBackup.value;

    printDateBackup =
      null;
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

  writeView.addEventListener(
    "input",
    event => {
      const target =
        event.target;

      if (
        target ===
          inspectionDate ||
        !(
          target instanceof
            HTMLInputElement ||
          target instanceof
            HTMLTextAreaElement
        )
      ) {
        return;
      }

      markDirty();
    }
  );


  inspectionDate.addEventListener(
    "change",
    async () => {
      const nextDate =
        inspectionDate.value;

      if (
        isDirty &&
        lastLoadedDate &&
        nextDate !==
          lastLoadedDate &&
        !window.confirm(
          "현재 날짜에 저장하지 않은 내용이 있습니다. 다른 날짜로 이동하시겠습니까?"
        )
      ) {
        inspectionDate.value =
          lastLoadedDate;

        return;
      }

      await loadLogForDate(
        nextDate
      );
    }
  );


  saveButton?.addEventListener(
    "click",
    () => {
      saveInspectionLog();
    }
  );


  previewButton?.addEventListener(
    "click",
    () => {
      openPrintPreview();
    }
  );


  archiveOpenButton?.addEventListener(
    "click",
    () => {
      openArchiveBoard();
    }
  );


  archiveBackButton?.addEventListener(
    "click",
    () => {
      closeArchiveBoard();
    }
  );


  archiveRefreshButton?.addEventListener(
    "click",
    () => {
      loadArchiveBoard();
    }
  );


  archiveSearchButton?.addEventListener(
    "click",
    () => {
      renderArchiveBoard();
    }
  );


  archiveResetButton?.addEventListener(
    "click",
    () => {
      if (
        archiveStartDate
      ) {
        archiveStartDate.value =
          getDateMonthsAgo(
            12
          );
      }

      if (
        archiveEndDate
      ) {
        archiveEndDate.value =
          getTodayDateValue();
      }

      if (
        archiveKeyword
      ) {
        archiveKeyword.value =
          "";
      }

      renderArchiveBoard();
    }
  );


  archiveKeyword?.addEventListener(
    "keydown",
    event => {
      if (
        event.key ===
          "Enter"
      ) {
        renderArchiveBoard();
      }
    }
  );


  archiveTableBody?.addEventListener(
    "click",
    event => {
      const target =
        event.target instanceof
          Element
          ? event.target
          : null;

      const openButton =
        target?.closest(
          "[data-lng-archive-open]"
        );

      if (
        openButton
      ) {
        openArchiveLog(
          openButton.getAttribute(
            "data-lng-archive-open"
          ),
          false
        );

        return;
      }

      const archivePrintButton =
        target?.closest(
          "[data-lng-archive-print]"
        );

      if (
        archivePrintButton
      ) {
        openArchiveLog(
          archivePrintButton.getAttribute(
            "data-lng-archive-print"
          ),
          true
        );

        return;
      }

      const deleteButton =
        target?.closest(
          "[data-lng-archive-delete]"
        );

      if (
        deleteButton
      ) {
        deleteArchiveLog(
          deleteButton.getAttribute(
            "data-lng-archive-delete"
          ),
          deleteButton.getAttribute(
            "data-lng-archive-revision"
          ),
          deleteButton.getAttribute(
            "data-lng-archive-date"
          ),
          deleteButton
        );
      }
    }
  );


  templateEditButton?.addEventListener(
    "click",
    () => {
      openTemplateModal();
    }
  );


  templateCloseButton?.addEventListener(
    "click",
    () => {
      closeTemplateModal();
    }
  );


  templateCancelButton?.addEventListener(
    "click",
    () => {
      closeTemplateModal();
    }
  );


  templateApplyButton?.addEventListener(
    "click",
    () => {
      applyTemplateEdits();
    }
  );


  templateModal?.addEventListener(
    "click",
    event => {
      if (
        event.target ===
          templateModal
      ) {
        closeTemplateModal();
      }
    }
  );


  previewCloseButton?.addEventListener(
    "click",
    () => {
      closePrintPreview();
    }
  );


  previewCancelButton?.addEventListener(
    "click",
    () => {
      closePrintPreview();
    }
  );


  printButton?.addEventListener(
    "click",
    () => {
      printInspectionSheet();
    }
  );


  previewModal?.addEventListener(
    "click",
    event => {
      if (
        event.target ===
          previewModal
      ) {
        closePrintPreview();
      }
    }
  );


  document.addEventListener(
    "keydown",
    event => {
      if (
        event.key !==
        "Escape"
      ) {
        return;
      }

      if (
        previewModal &&
        !previewModal.hidden
      ) {
        closePrintPreview();

        return;
      }

      if (
        templateModal &&
        !templateModal.hidden
      ) {
        closeTemplateModal();
      }
    }
  );


  window.addEventListener(
    "beforeprint",
    () => {
      prepareDateForPrint();
    }
  );


  window.addEventListener(
    "afterprint",
    () => {
      restoreDateAfterPrint();
    }
  );


  window.addEventListener(
    "beforeunload",
    event => {
      if (
        !isDirty
      ) {
        return;
      }

      saveRecoveryDraft();

      event.preventDefault();
      event.returnValue =
        "";
    }
  );


  /* =======================================================
    최초 실행
  ======================================================= */

  ensureAreaCells();

  applyTemplateToSheet(
    LNG_DEFAULT_TEMPLATE_ITEMS
  );

  refreshTemplateEditButton();

  if (
    archiveStartDate
  ) {
    archiveStartDate.value =
      getDateMonthsAgo(
        12
      );
  }

  if (
    archiveEndDate
  ) {
    archiveEndDate.value =
      getTodayDateValue();
  }

  if (
    !inspectionDate.value
  ) {
    inspectionDate.value =
      getTodayDateValue();
  }

  loadLogForDate(
    inspectionDate.value
  );
}
