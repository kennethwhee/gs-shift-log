"use strict";

/* =========================================================
  고압가스 저장시설 주간점검표

  기능:
  - Cloudflare D1 공용 저장
  - 날짜별 저장·불러오기
  - revision 충돌 방지
  - 저장 기록 조회
  - 저장 기록 상세 열기·인쇄
  - 최고관리자 점검항목·확인내용 편집
  - 브라우저 복구용 임시 초안
  - 인쇄 미리보기·실제 인쇄
========================================================= */

const HIGH_PRESSURE_GAS_API_URL =
  "/api/inspection-logs/high-pressure-gas";

const CURRENT_USER_STORAGE_KEY =
  "gsShiftLog.currentUser";

const FORCED_SUPER_ADMIN_EMPLOYEE_NO =
  "2014081";

const DEFAULT_TEMPLATE_ITEMS = [
  {
    number: 1,
    item: "안전거리",
    description:
      "화기와의 안전거리 유지상태는 적절한가."
  },
  {
    number: 2,
    item: "시설 등의 표시",
    description:
      "출입문 경계표지 및 위험표지 설치는 양호한가."
  },
  {
    number: 3,
    item: "가스누설경보장치",
    description:
      "경보기 작동상태 및 설치위치\n제독제 보유량 및 흡수중화설비 연결상태"
  },
  {
    number: 4,
    item: "저장탱크",
    description:
      "탱크실 내 강제통풍 장치 정상적 동작 여부"
  },
  {
    number: 5,
    item: "가스설비의 구조",
    description:
      "방폭기기 유지관리 상태\n위험장소에 따른 적합한 방폭구조 선정 여부"
  },
  {
    number: 6,
    item: "과충전 방지조치",
    description:
      "내용적의 90% 초과 충전방지 조치 여부"
  },
  {
    number: 7,
    item: "누설검사",
    description:
      "저장탱크 부속설비 및 배관설비 연결부 누설 여부"
  },
  {
    number: 8,
    item: "긴급차단장치",
    description:
      "긴급 시 신속하게 조작할 수 있는 위치 및 상태"
  },
  {
    number: 9,
    item: "안전밸브",
    description:
      "압력계, 온도계 지시상태는 양호한가.\n안전밸브 설치위치 및 작동압력 적합 여부"
  },
  {
    number: 10,
    item: "정전기 제거조치",
    description:
      "정전기 제거용 본딩선 및 접지연결 상태"
  },
  {
    number: 11,
    item: "기타사항",
    description:
      "각종 조작용 밸브의 정위치 Setting 상태 확인\n설비 자체 점검 실시 및 기술기준 준수 여부 등"
  },
  {
    number: 12,
    item: "기타시설",
    description:
      "경보장치 및 이송설비 적정한가.\n통신시설, 통행시설은 적정한가."
  }
];

const FORM_INPUT_IDS = [
  "gasSafetyManager",
  "gasSafetyGeneralManager",
  "gasInspectionDate",
  "gasInspectorName",
  "gasOverallResult",
  "gasResult1",
  "gasResult2",
  "gasResult3",
  "gasResult4",
  "gasResult5",
  "gasResult6",
  "gasResult7",
  "gasResult8",
  "gasResult9",
  "gasResult10",
  "gasResult11",
  "gasResult12",
  "gasWorkplaceConfirmation",
  "gasFinalInspector"
];


document.addEventListener(
  "DOMContentLoaded",
  () => {
    initializeHighPressureGasCheck();
  }
);


function initializeHighPressureGasCheck() {
  const sheet =
    document.getElementById(
      "gasCheckSheet"
    );

  const inspectionDate =
    document.getElementById(
      "gasInspectionDate"
    );

  if (
    !sheet ||
    !inspectionDate
  ) {
    return;
  }

  const saveButton =
    document.getElementById(
      "gasCheckSaveButton"
    );

  const previewButton =
    document.getElementById(
      "gasCheckPreviewButton"
    );

  const historyButton =
    document.getElementById(
      "gasCheckHistoryButton"
    );

  const templateEditButton =
    document.getElementById(
      "gasTemplateEditButton"
    );

  const saveState =
    document.getElementById(
      "gasCheckSaveState"
    );

  const historyModal =
    document.getElementById(
      "gasHistoryModal"
    );

  const historyList =
    document.getElementById(
      "gasHistoryList"
    );

  const historyEmpty =
    document.getElementById(
      "gasHistoryEmpty"
    );

  const historyCloseButton =
    document.getElementById(
      "gasHistoryCloseButton"
    );

  const templateModal =
    document.getElementById(
      "gasTemplateModal"
    );

  const templateEditList =
    document.getElementById(
      "gasTemplateEditList"
    );

  const templateCloseButton =
    document.getElementById(
      "gasTemplateCloseButton"
    );

  const templateCancelButton =
    document.getElementById(
      "gasTemplateCancelButton"
    );

  const templateApplyButton =
    document.getElementById(
      "gasTemplateApplyButton"
    );

  const previewModal =
    document.getElementById(
      "gasPrintPreview"
    );

  const previewBody =
    document.getElementById(
      "gasPrintPreviewBody"
    );

  const previewCloseButton =
    document.getElementById(
      "gasPreviewCloseButton"
    );

  const previewCancelButton =
    document.getElementById(
      "gasPreviewCancelButton"
    );

  const printButton =
    document.getElementById(
      "gasPrintButton"
    );

  let currentLogId =
    "";

  let currentRevision =
    0;

  let currentTemplateItems =
    cloneTemplateItems(
      DEFAULT_TEMPLATE_ITEMS
    );

  let canEditTemplate =
    isStoredUserSuperAdmin();

  let isDirty =
    false;

  let isApplyingData =
    false;

  let lastLoadedDate =
    "";

  let latestServerTemplate =
    null;

  let draftSaveTimer =
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


  function cloneTemplateItems(
    items
  ) {
    const source =
      Array.isArray(
        items
      ) &&
      items.length ===
        12
        ? items
        : DEFAULT_TEMPLATE_ITEMS;

    return source.map(
      (
        item,
        index
      ) => ({
        number:
          index +
          1,
        item:
          normalizeText(
            item?.item
          ) ||
          DEFAULT_TEMPLATE_ITEMS[index].item,
        description:
          String(
            item?.description ??
            DEFAULT_TEMPLATE_ITEMS[index].description
          )
            .replace(
              /\r\n?/g,
              "\n"
            )
            .trim()
      })
    );
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
      return dateValue;
    }

    return (
      `${parts[0]} 년 ` +
      `${Number(parts[1])} 월 ` +
      `${Number(parts[2])} 일`
    );
  }


  function formatHistoryDate(
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

    return (
      `${parts[0]}.${parts[1]}.${parts[2]}`
    );
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


  /* =======================================================
    로그인 정보
  ======================================================= */

  function loadStoredUser() {
    try {
      const savedUser =
        localStorage.getItem(
          CURRENT_USER_STORAGE_KEY
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
        FORCED_SUPER_ADMIN_EMPLOYEE_NO ||
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
    저장 상태 표시
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
      historyButton,
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
      !templateEditButton
    ) {
      return;
    }

    templateEditButton.hidden =
      !canEditTemplate;
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
    양식 내용 적용
  ======================================================= */

  function getTemplateRows() {
    return Array.from(
      sheet.querySelectorAll(
        ".gas-check-detail-table tbody tr:not(.gas-check-confirmation-row)"
      )
    ).slice(
      0,
      12
    );
  }


  function applyTemplateToSheet(
    items
  ) {
    currentTemplateItems =
      cloneTemplateItems(
        items
      );

    const rows =
      getTemplateRows();

    rows.forEach(
      (
        row,
        index
      ) => {
        const item =
          currentTemplateItems[index];

        const cells =
          row.children;

        if (
          cells[0]
        ) {
          cells[0].textContent =
            String(
              index +
              1
            );
        }

        if (
          cells[1]
        ) {
          cells[1].textContent =
            item.item;
        }

        if (
          cells[2]
        ) {
          cells[2].innerHTML =
            escapeHtml(
              item.description
            ).replace(
              /\n/g,
              "<br>"
            );
        }
      }
    );
  }


  /* =======================================================
    입력값 수집·적용
  ======================================================= */

  function getInputValue(
    id
  ) {
    return String(
      document.getElementById(
        id
      )?.value ||
      ""
    );
  }


  function setInputValue(
    id,
    value
  ) {
    const input =
      document.getElementById(
        id
      );

    if (
      input
    ) {
      input.value =
        String(
          value ??
          ""
        );
    }
  }


  function collectFormData() {
    return {
      safetyManager:
        getInputValue(
          "gasSafetyManager"
        ),
      safetyGeneralManager:
        getInputValue(
          "gasSafetyGeneralManager"
        ),
      inspectorName:
        getInputValue(
          "gasInspectorName"
        ),
      overallResult:
        getInputValue(
          "gasOverallResult"
        ),
      results:
        Array.from(
          {
            length:
              12
          },
          (
            _,
            index
          ) => {
            return getInputValue(
              `gasResult${index + 1}`
            );
          }
        ),
      workplaceConfirmation:
        getInputValue(
          "gasWorkplaceConfirmation"
        ),
      finalInspector:
        getInputValue(
          "gasFinalInspector"
        )
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

    setInputValue(
      "gasSafetyManager",
      source.safetyManager ??
      source.gasSafetyManager
    );

    setInputValue(
      "gasSafetyGeneralManager",
      source.safetyGeneralManager ??
      source.gasSafetyGeneralManager
    );

    setInputValue(
      "gasInspectorName",
      source.inspectorName ??
      source.gasInspectorName
    );

    setInputValue(
      "gasOverallResult",
      source.overallResult ??
      source.gasOverallResult
    );

    const results =
      Array.isArray(
        source.results
      )
        ? source.results
        : Array.from(
            {
              length:
                12
            },
            (
              _,
              index
            ) => {
              return source[
                `gasResult${index + 1}`
              ];
            }
          );

    results.forEach(
      (
        value,
        index
      ) => {
        setInputValue(
          `gasResult${index + 1}`,
          value
        );
      }
    );

    setInputValue(
      "gasWorkplaceConfirmation",
      source.workplaceConfirmation ??
      source.gasWorkplaceConfirmation
    );

    setInputValue(
      "gasFinalInspector",
      source.finalInspector ??
      source.gasFinalInspector
    );
  }


  function clearFormForNewDate() {
    FORM_INPUT_IDS.forEach(
      id => {
        if (
          id ===
          "gasInspectionDate"
        ) {
          return;
        }

        setInputValue(
          id,
          ""
        );
      }
    );

    const currentUserName =
      getCurrentUserName();

    if (
      currentUserName
    ) {
      setInputValue(
        "gasInspectorName",
        currentUserName
      );

      setInputValue(
        "gasFinalInspector",
        currentUserName
      );
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
    브라우저 복구용 초안
  ======================================================= */

  function getDraftStorageKey(
    dateValue =
      inspectionDate.value
  ) {
    return (
      "inspectionLogs.weekly.highPressureGas.draft." +
      normalizeText(
        dateValue
      )
    );
  }


  function getLegacyStorageKey(
    dateValue =
      inspectionDate.value
  ) {
    return (
      "inspectionLogs.weekly.highPressureGas." +
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

    const draft = {
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
    };

    localStorage.setItem(
      getDraftStorageKey(
        dateValue
      ),
      JSON.stringify(
        draft
      )
    );
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

    localStorage.removeItem(
      getLegacyStorageKey(
        dateValue
      )
    );
  }


  function loadRecoveryDraft(
    dateValue
  ) {
    const candidates = [
      getDraftStorageKey(
        dateValue
      ),
      getLegacyStorageKey(
        dateValue
      )
    ];

    for (
      const key of candidates
    ) {
      const rawValue =
        localStorage.getItem(
          key
        );

      if (
        !rawValue
      ) {
        continue;
      }

      try {
        const parsed =
          JSON.parse(
            rawValue
          );

        if (
          parsed &&
          typeof parsed ===
            "object"
        ) {
          return parsed;
        }

      } catch (
        error
      ) {
        console.warn(
          "고압가스 임시 초안 복구 실패:",
          error
        );
      }
    }

    return null;
  }


  /* =======================================================
    서버 기본 양식 확보
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
          HIGH_PRESSURE_GAS_API_URL
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
                12
            );
          }
        );

      latestServerTemplate =
        sourceLog
          ? cloneTemplateItems(
              sourceLog.templateItems
            )
          : cloneTemplateItems(
              DEFAULT_TEMPLATE_ITEMS
            );

    } catch (
      error
    ) {
      console.warn(
        "최신 고압가스 점검 양식 불러오기 실패:",
        error
      );

      latestServerTemplate =
        cloneTemplateItems(
          DEFAULT_TEMPLATE_ITEMS
        );
    }

    return cloneTemplateItems(
      latestServerTemplate
    );
  }


  /* =======================================================
    날짜별 서버 자료 불러오기
  ======================================================= */

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
          `${HIGH_PRESSURE_GAS_API_URL}?date=${encodeURIComponent(targetDate)}`
        );

      canEditTemplate =
        Boolean(
          payload.canEditTemplate
        ) ||
        isStoredUserSuperAdmin();

      refreshTemplateEditButton();

      isApplyingData =
        true;

      inspectionDate.value =
        targetDate;

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
            draft.form ||
            draft
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
      }

      isApplyingData =
        false;

    } catch (
      error
    ) {
      console.error(
        "고압가스 점검일지 불러오기 실패:",
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
    D1 일지 저장
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
          HIGH_PRESSURE_GAS_API_URL,
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
          ? "고압가스 주간점검일지가 저장되었습니다."
          : "고압가스 주간점검일지가 수정 저장되었습니다."
      );

    } catch (
      error
    ) {
      console.error(
        "고압가스 점검일지 저장 실패:",
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
        } else {
          setSaveState(
            "저장 충돌 · 최신 내용 확인 필요",
            "error"
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
          "고압가스 점검일지를 저장하지 못했습니다."
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
    저장 기록 목록
  ======================================================= */

  function renderHistoryList(
    logs
  ) {
    if (
      !historyList ||
      !historyEmpty
    ) {
      return;
    }

    const normalizedLogs =
      Array.isArray(
        logs
      )
        ? logs
        : [];

    historyList
      .querySelectorAll(
        ".gas-history-card"
      )
      .forEach(
        card => {
          card.remove();
        }
      );

    historyEmpty.hidden =
      normalizedLogs.length >
      0;

    normalizedLogs.forEach(
      log => {
        const card =
          document.createElement(
            "article"
          );

        card.className =
          "gas-history-card";

        card.innerHTML = `
          <div class="gas-history-card__info">
            <div class="gas-history-card__title">
              <span>${escapeHtml(formatHistoryDate(log.inspectionDate))}</span>
              <span class="gas-history-card__status">${escapeHtml(log.status || "저장완료")}</span>
            </div>
            <div class="gas-history-card__meta">
              작성자 ${escapeHtml(log.authorName || "미확인")}
              · 최종수정 ${escapeHtml(log.lastModifiedByName || log.authorName || "미확인")}
              · ${escapeHtml(formatDateTime(log.updatedAt))}
              · revision ${escapeHtml(String(log.serverRevision || 1))}
            </div>
          </div>

          <div class="gas-history-card__actions">
            <button
              type="button"
              data-gas-history-open="${escapeHtml(log.id)}"
            >
              열기
            </button>

            <button
              type="button"
              data-gas-history-print="${escapeHtml(log.id)}"
            >
              인쇄
            </button>
          </div>
        `;

        historyList.appendChild(
          card
        );
      }
    );
  }


  async function openHistoryModal() {
    if (
      !historyModal
    ) {
      return;
    }

    historyModal.hidden =
      false;

    document.body.style.overflow =
      "hidden";

    if (
      historyEmpty
    ) {
      historyEmpty.hidden =
        false;

      historyEmpty.textContent =
        "저장 기록을 불러오는 중입니다.";
    }

    try {
      const payload =
        await requestApi(
          HIGH_PRESSURE_GAS_API_URL
        );

      canEditTemplate =
        Boolean(
          payload.canEditTemplate
        ) ||
        canEditTemplate;

      refreshTemplateEditButton();

      if (
        historyEmpty
      ) {
        historyEmpty.textContent =
          "저장된 점검일지가 없습니다.";
      }

      renderHistoryList(
        payload.logs
      );

    } catch (
      error
    ) {
      if (
        historyEmpty
      ) {
        historyEmpty.hidden =
          false;

        historyEmpty.textContent =
          error.message ||
          "저장 기록을 불러오지 못했습니다.";
      }
    }
  }


  function closeHistoryModal() {
    if (
      !historyModal
    ) {
      return;
    }

    historyModal.hidden =
      true;

    document.body.style.overflow =
      "";
  }


  async function openHistoryLog(
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
          `${HIGH_PRESSURE_GAS_API_URL}?id=${encodeURIComponent(normalizedId)}`
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

      closeHistoryModal();

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


  /* =======================================================
    점검표 내용 편집
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
                class="gas-template-edit-row"
                data-template-edit-index="${index}"
              >
                <span class="gas-template-edit-row__number">
                  ${index + 1}
                </span>

                <input
                  type="text"
                  data-template-item-name
                  value="${escapeHtml(item.item)}"
                  aria-label="${index + 1}번 점검항목"
                >

                <textarea
                  data-template-item-description
                  aria-label="${index + 1}번 확인내용"
                >${escapeHtml(item.description)}</textarea>
              </div>
            `;
          }
        )
        .join("");

    templateModal.hidden =
      false;

    document.body.style.overflow =
      "hidden";
  }


  function closeTemplateModal() {
    if (
      !templateModal
    ) {
      return;
    }

    templateModal.hidden =
      true;

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
          "[data-template-edit-index]"
        )
      );

    if (
      rows.length !==
      12
    ) {
      window.alert(
        "점검항목 12개를 확인해 주세요."
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
                "[data-template-item-name]"
              )?.value
            ),
          description:
            String(
              row.querySelector(
                "[data-template-item-description]"
              )?.value ||
              ""
            )
              .replace(
                /\r\n?/g,
                "\n"
              )
              .trim()
        })
      );

    const invalidItem =
      editedItems.find(
        item => {
          return (
            !item.item ||
            !item.description
          );
        }
      );

    if (
      invalidItem
    ) {
      window.alert(
        "점검항목과 확인내용을 모두 입력해 주세요."
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
      "점검표 내용이 화면에 적용되었습니다. D1에 반영하려면 일지 저장을 눌러 주세요."
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


  function createPreviewSheet() {
    const clonedSheet =
      sheet.cloneNode(
        true
      );

    removeCloneIds(
      clonedSheet
    );

    const originalInputs =
      Array.from(
        sheet.querySelectorAll(
          "input"
        )
      );

    const clonedInputs =
      Array.from(
        clonedSheet.querySelectorAll(
          "input"
        )
      );

    clonedInputs.forEach(
      (
        clonedInput,
        index
      ) => {
        const originalInput =
          originalInputs[index];

        const value =
          String(
            originalInput?.value ||
            ""
          ).trim();

        const printValue =
          document.createElement(
            "span"
          );

        printValue.className =
          "gas-check-print-value";

        printValue.textContent =
          originalInput?.type ===
            "date" &&
          value
            ? formatDateForPrint(
                value
              )
            : value;

        clonedInput.replaceWith(
          printValue
        );
      }
    );

    return clonedSheet;
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

    previewBody.appendChild(
      createPreviewSheet()
    );

    previewModal.hidden =
      false;

    document.body.style.overflow =
      "hidden";
  }


  function closePrintPreview() {
    if (
      !previewModal
    ) {
      return;
    }

    previewModal.hidden =
      true;

    document.body.style.overflow =
      "";
  }


  function printInspectionSheet() {
    closePrintPreview();

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

  sheet.addEventListener(
    "input",
    event => {
      if (
        event.target ===
        inspectionDate
      ) {
        return;
      }

      if (
        event.target instanceof
        HTMLInputElement
      ) {
        markDirty();
      }
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
          lastLoadedDate
      ) {
        const shouldContinue =
          window.confirm(
            "현재 날짜에 저장하지 않은 내용이 있습니다. 다른 날짜로 이동하시겠습니까?"
          );

        if (
          !shouldContinue
        ) {
          inspectionDate.value =
            lastLoadedDate;

          return;
        }
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


  historyButton?.addEventListener(
    "click",
    () => {
      openHistoryModal();
    }
  );


  templateEditButton?.addEventListener(
    "click",
    () => {
      openTemplateModal();
    }
  );


  historyCloseButton?.addEventListener(
    "click",
    () => {
      closeHistoryModal();
    }
  );


  historyModal?.addEventListener(
    "click",
    event => {
      if (
        event.target ===
        historyModal
      ) {
        closeHistoryModal();
      }
    }
  );


  historyList?.addEventListener(
    "click",
    event => {
      const target =
        event.target instanceof
        Element
          ? event.target
          : null;

      const openButton =
        target?.closest(
          "[data-gas-history-open]"
        );

      if (
        openButton
      ) {
        openHistoryLog(
          openButton.getAttribute(
            "data-gas-history-open"
          ),
          false
        );

        return;
      }

      const printHistoryButton =
        target?.closest(
          "[data-gas-history-print]"
        );

      if (
        printHistoryButton
      ) {
        openHistoryLog(
          printHistoryButton.getAttribute(
            "data-gas-history-print"
          ),
          true
        );
      }
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

        return;
      }

      if (
        historyModal &&
        !historyModal.hidden
      ) {
        closeHistoryModal();
      }
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

  refreshTemplateEditButton();

  applyTemplateToSheet(
    DEFAULT_TEMPLATE_ITEMS
  );

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
