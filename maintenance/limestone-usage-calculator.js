"use strict";

// Definition only. The original main-script call site owns initialization.
// The installer body is retained byte-for-byte (LF) from the reviewed V15 R2 source.
window.GSLimestoneUsageCalculator = Object.freeze({
  install: function installLimestoneUsageCalculatorFeature() {
  if (
    window
      .__limestoneUsageCalculatorFeatureInstalled ===
      true
  ) {
    return;
  }


  window
    .__limestoneUsageCalculatorFeatureInstalled =
    true;


  const LIMESTONE_USAGE_RECEIPT_API_URL =
    "/api/limestone-receipts";


  const LIMESTONE_USAGE_TAGS = {
    1:
      "103HRJ01CW201XQ01",

    2:
      "203HRJ01CW201XQ01"
  };


  const limestoneUsageState = {
    selectedDate:
      "",

    loadedDate:
      "",

    receiptByUnit: {
      1:
        0,

      2:
        0
    },

    isLoading:
      false,

    receiptRequestToken:
      0,

    dateRequestToken:
      0
  };


  /* =====================================================
    HTML 요소
  ====================================================== */

  function getLimestoneUsageElements() {
    return {
      limestoneView:
        document.getElementById(
          "efficiencyLimestoneView"
        ),

      heading:
        document.querySelector(
          `
            #efficiencyLimestoneView
            .limestone-view-heading
          `
        ),

      headingEyebrow:
        document.querySelector(
          `
            #efficiencyLimestoneView
            .limestone-view-heading
            > div:first-child
            > span
          `
        ),

      headingTitle:
        document.querySelector(
          `
            #efficiencyLimestoneView
            .limestone-view-heading
            h3
          `
        ),

      headingDescription:
        document.querySelector(
          `
            #efficiencyLimestoneView
            .limestone-view-description
          `
        ),

      headingActions:
        document.querySelector(
          `
            #efficiencyLimestoneView
            .limestone-heading-actions
          `
        ),

      receiptDashboard:
        document.getElementById(
          "limestoneDashboard"
        ),

      submenu:
        document.getElementById(
          "limestoneSubviewMenu"
        ),

      submenuButtons: [
        ...document.querySelectorAll(
          "[data-limestone-subview]"
        )
      ],

      usageView:
        document.getElementById(
          "limestoneUsageCalculatorView"
        ),

      previousDateButton:
        document.getElementById(
          "limestoneUsagePreviousDateButton"
        ),

      nextDateButton:
        document.getElementById(
          "limestoneUsageNextDateButton"
        ),

      todayButton:
        document.getElementById(
          "limestoneUsageTodayButton"
        ),

      dateInput:
        document.getElementById(
          "limestoneUsageDate"
        ),

      refreshReceiptButton:
        document.getElementById(
          "refreshLimestoneUsageReceiptButton"
        ),

      loadOisButton:
        document.getElementById(
          "loadLimestoneUsageOisButton"
        ),

      status:
        document.getElementById(
          "limestoneUsageStatus"
        ),

      statusTitle:
        document.getElementById(
          "limestoneUsageStatusTitle"
        ),

      statusDescription:
        document.getElementById(
          "limestoneUsageStatusDescription"
        ),

      unitOneStartStock:
        document.getElementById(
          "limestoneUsageUnitOneStartStock"
        ),

      unitOneReceipt:
        document.getElementById(
          "limestoneUsageUnitOneReceipt"
        ),

      unitOneEndStock:
        document.getElementById(
          "limestoneUsageUnitOneEndStock"
        ),

      unitOneUsage:
        document.getElementById(
          "limestoneUsageUnitOneUsage"
        ),

      unitOneSummary:
        document.getElementById(
          "limestoneUsageUnitOneSummary"
        ),

      unitTwoStartStock:
        document.getElementById(
          "limestoneUsageUnitTwoStartStock"
        ),

      unitTwoReceipt:
        document.getElementById(
          "limestoneUsageUnitTwoReceipt"
        ),

      unitTwoEndStock:
        document.getElementById(
          "limestoneUsageUnitTwoEndStock"
        ),

      unitTwoUsage:
        document.getElementById(
          "limestoneUsageUnitTwoUsage"
        ),

      unitTwoSummary:
        document.getElementById(
          "limestoneUsageUnitTwoSummary"
        ),

      totalUsage:
        document.getElementById(
          "limestoneUsageTotalSummary"
        ),

      unitOneRow:
        document.querySelector(
          '[data-limestone-usage-unit="1"]'
        ),

      unitTwoRow:
        document.querySelector(
          '[data-limestone-usage-unit="2"]'
        )
    };
  }


  /* =====================================================
    날짜
  ====================================================== */

  function formatLimestoneUsageDate(
    date
  ) {
    if (
      !(date instanceof Date) ||
      Number.isNaN(
        date.getTime()
      )
    ) {
      return "";
    }


    return [
      date.getFullYear(),

      String(
        date.getMonth() +
        1
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


  function getLimestoneUsageToday() {
    return formatLimestoneUsageDate(
      new Date()
    );
  }


  function parseLimestoneUsageDate(
    value
  ) {
    const normalizedValue =
      String(
        value ||
        ""
      ).trim();


    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        normalizedValue
      )
    ) {
      return null;
    }


    const parsedDate =
      new Date(
        `${normalizedValue}T00:00:00`
      );


    return Number.isNaN(
      parsedDate.getTime()
    )
      ? null
      : parsedDate;
  }


  function addLimestoneUsageDays(
    value,
    dayCount
  ) {
    const parsedDate =
      parseLimestoneUsageDate(
        value
      );


    if (
      !parsedDate
    ) {
      return "";
    }


    parsedDate.setDate(
      parsedDate.getDate() +
      Number(
        dayCount ||
        0
      )
    );


    return formatLimestoneUsageDate(
      parsedDate
    );
  }


  /* =====================================================
    숫자
  ====================================================== */

  function parseLimestoneUsageNumber(
    value
  ) {
    const normalizedValue =
      String(
        value ??
        ""
      )
        .replaceAll(
          ",",
          ""
        )
        .trim();


    if (
      normalizedValue ===
      ""
    ) {
      return null;
    }


    const numericValue =
      Number(
        normalizedValue
      );


    return Number.isFinite(
      numericValue
    )
      ? numericValue
      : null;
  }


/* =========================================================
  석회석 숫자 표시

  규칙:
  - 반올림하지 않음
  - 소수점 둘째 자리 아래는 절삭
  - 항상 소수점 두 자리 표시

  예:
  331.179 → 331.17
  72.098  → 72.09
  5       → 5.00
========================================================= */

function formatLimestoneUsageNumber(
  value
) {
  const numericValue =
    Number(
      value
    );


  if (
    !Number.isFinite(
      numericValue
    )
  ) {
    return "-";
  }


  const truncatedValue =
    Math.trunc(
      numericValue *
      100
    ) /
    100;


  return truncatedValue.toLocaleString(
    "ko-KR",
    {
      minimumFractionDigits:
        2,

      maximumFractionDigits:
        2
    }
  );
}

  /* =====================================================
    상태 표시
  ====================================================== */

  function setLimestoneUsageStatus(
    status,
    title,
    description
  ) {
    const {
      usageView,
      statusTitle,
      statusDescription
    } =
      getLimestoneUsageElements();


    if (
      usageView
    ) {
      usageView.dataset
        .limestoneUsageStatus =
        String(
          status ||
          "idle"
        );
    }


    if (
      statusTitle
    ) {
      statusTitle.textContent =
        String(
          title ||
          ""
        );
    }


    if (
      statusDescription
    ) {
      statusDescription.textContent =
        String(
          description ||
          ""
        );
    }
  }


  /* =====================================================
    호기별 사용량 계산

    시작재고 + 입고량 - 종료재고
  ====================================================== */

  function calculateLimestoneUsageForUnit(
    unitNo
  ) {
    const elements =
      getLimestoneUsageElements();


    const startInput =
      unitNo ===
        1
        ? elements
            .unitOneStartStock
        : elements
            .unitTwoStartStock;


    const endInput =
      unitNo ===
        1
        ? elements
            .unitOneEndStock
        : elements
            .unitTwoEndStock;


    const startStock =
      parseLimestoneUsageNumber(
        startInput?.value
      );


    const endStock =
      parseLimestoneUsageNumber(
        endInput?.value
      );


    const receiptQuantity =
      Number(
        limestoneUsageState
          .receiptByUnit[
            unitNo
          ] ||
        0
      );


    if (
      startStock ===
        null ||
      endStock ===
        null
    ) {
      return null;
    }


    return (
      startStock +
      receiptQuantity -
      endStock
    );
  }


  /* =====================================================
    계산 결과 출력
  ====================================================== */

function renderLimestoneUsageCalculation() {
  const {
    unitOneReceipt,
    unitTwoReceipt,
    unitOneUsage,
    unitTwoUsage,
    unitOneSummary,
    unitTwoSummary,
    totalUsage,
    unitOneRow,
    unitTwoRow
  } =
    getLimestoneUsageElements();

  const unitOneReceiptValue =
    Number(
      limestoneUsageState
        .receiptByUnit[1] ||
      0
    );

  const unitTwoReceiptValue =
    Number(
      limestoneUsageState
        .receiptByUnit[2] ||
      0
    );

  if (
    unitOneReceipt
  ) {
    unitOneReceipt.textContent =
      `${formatLimestoneUsageNumber(
        unitOneReceiptValue
      )} ton`;
  }

  if (
    unitTwoReceipt
  ) {
    unitTwoReceipt.textContent =
      `${formatLimestoneUsageNumber(
        unitTwoReceiptValue
      )} ton`;
  }

  const unitOneUsageValue =
    calculateLimestoneUsageForUnit(
      1
    );

  const unitTwoUsageValue =
    calculateLimestoneUsageForUnit(
      2
    );

  if (
    unitOneUsage
  ) {
    unitOneUsage.textContent =
      unitOneUsageValue ===
        null
        ? "-"
        : `${formatLimestoneUsageNumber(
            unitOneUsageValue
          )} ton`;
  }

  if (
    unitTwoUsage
  ) {
    unitTwoUsage.textContent =
      unitTwoUsageValue ===
        null
        ? "-"
        : `${formatLimestoneUsageNumber(
            unitTwoUsageValue
          )} ton`;
  }

  if (
    unitOneSummary
  ) {
    unitOneSummary.textContent =
      unitOneUsageValue ===
        null
        ? "-"
        : formatLimestoneUsageNumber(
            unitOneUsageValue
          );
  }

  if (
    unitTwoSummary
  ) {
    unitTwoSummary.textContent =
      unitTwoUsageValue ===
        null
        ? "-"
        : formatLimestoneUsageNumber(
            unitTwoUsageValue
          );
  }

  const hasCompleteResult =
    unitOneUsageValue !==
      null &&
    unitTwoUsageValue !==
      null;

  if (
    totalUsage
  ) {
    totalUsage.textContent =
      hasCompleteResult
        ? formatLimestoneUsageNumber(
            unitOneUsageValue +
            unitTwoUsageValue
          )
        : "-";
  }

  unitOneRow?.classList.toggle(
    "is-negative",
    unitOneUsageValue !==
      null &&
    unitOneUsageValue < 0
  );

  unitTwoRow?.classList.toggle(
    "is-negative",
    unitTwoUsageValue !==
      null &&
    unitTwoUsageValue < 0
  );
}

  /* =====================================================
    입고량 조회

    기존 석회석 입고기록 API를 사용한다.
  ====================================================== */

  /* =====================================================
    입고량 새로고침 후 계산 결과 D1 저장

    - 추가 polling 없음
    - 새로고침 1회당 POST 1회
    - manual 보정값은 서버에서 보호
  ====================================================== */

  async function synchronizeLimestoneUsageAfterReceiptRefresh(
    usageDate
  ) {
    try {
      const requestHeaders =
        new Headers(
          typeof getShiftLogAuthHeaders ===
            "function"
            ? getShiftLogAuthHeaders()
            : {}
        );

      requestHeaders.set(
        "Accept",
        "application/json"
      );

      requestHeaders.set(
        "Content-Type",
        "application/json"
      );

      const response =
        await fetch(
          LIMESTONE_USAGE_RECEIPT_API_URL,
          {
            method: "POST",
            headers: requestHeaders,
            cache: "no-store",
            body: JSON.stringify({
              action: "sync_usage",
              usageDate
            })
          }
        );

      const responseText =
        await response.text();

      let result = {};

      if (responseText.trim()) {
        try {
          result =
            JSON.parse(responseText);
        } catch {
          return {
            ok: false,
            message:
              "사용량 저장 서버 응답을 확인하지 못했습니다."
          };
        }
      }

      if (
        !response.ok ||
        result.ok === false
      ) {
        return {
          ok: false,
          message:
            result.message ||
            `사용량 저장 실패 (HTTP ${response.status})`
        };
      }

      return result;

    } catch (error) {
      console.warn(
        "석회석 입고량 새로고침 후 사용량 저장 실패:",
        error
      );

      return {
        ok: false,
        message:
          error?.message ||
          "사용량 저장 중 오류가 발생했습니다."
      };
    }
  }

  async function loadLimestoneUsageReceiptQuantities() {
    const {
      refreshReceiptButton,
      dateInput
    } =
      getLimestoneUsageElements();


    const selectedDate =
      String(
        dateInput?.value ||
        limestoneUsageState
          .selectedDate ||
        ""
      ).trim();


    if (
      !parseLimestoneUsageDate(
        selectedDate
      )
    ) {
      setLimestoneUsageStatus(
        "error",
        "날짜 확인 필요",
        "사용량을 계산할 날짜를 선택해 주세요."
      );


      return;
    }


    const requestToken =
      limestoneUsageState
        .receiptRequestToken +
      1;


    limestoneUsageState
      .receiptRequestToken =
      requestToken;


    limestoneUsageState
      .selectedDate =
      selectedDate;


    limestoneUsageState
      .isLoading =
      true;


    if (
      refreshReceiptButton
    ) {
      refreshReceiptButton.disabled =
        true;


      refreshReceiptButton.textContent =
        "불러오는 중...";
    }


    setLimestoneUsageStatus(
      "loading",
      "입고량 조회 중",
      `${selectedDate} 석회석 입고기록을 확인하고 있습니다.`
    );


    try {
      const requestUrl =
        new URL(
          LIMESTONE_USAGE_RECEIPT_API_URL,
          window.location.origin
        );


      requestUrl.searchParams.set(
        "startDate",
        selectedDate
      );


      requestUrl.searchParams.set(
        "endDate",
        selectedDate
      );


      requestUrl.searchParams.set(
        "_",
        String(
          Date.now()
        )
      );


      const response =
        await fetch(
          requestUrl.toString(),
          {
            method:
              "GET",

            headers:
              typeof getShiftLogAuthHeaders ===
                "function"
                ? getShiftLogAuthHeaders()
                : {
                    Accept:
                      "application/json"
                  },

            cache:
              "no-store"
          }
        );


      const responseText =
        await response.text();


      let result = {};


      if (
        responseText.trim()
      ) {
        try {
          result =
            JSON.parse(
              responseText
            );

        } catch {
          throw new Error(
            "석회석 입고량 서버 응답 형식이 올바르지 않습니다."
          );
        }
      }


      if (
        !response.ok ||
        result.ok ===
          false ||
        result.success ===
          false
      ) {
        throw new Error(
          result.message ||
          result.error ||
          `석회석 입고량 조회 실패 (HTTP ${response.status})`
        );
      }


      const items =
        Array.isArray(
          result.items
        )
          ? result.items
          : Array.isArray(
              result.data?.items
            )
            ? result.data.items
            : [];


      const receiptByUnit = {
        1:
          0,

        2:
          0
      };


      items.forEach(
        item => {
          const receiptDate =
            String(
              item?.receiptDate ||
              item?.receipt_date ||
              ""
            ).trim();


          const unitNo =
            Number(
              item?.unitNo ??
              item?.unit_no ??
              0
            );


          const quantity =
            Number(
              item?.quantityTon ??
              item?.quantity_ton ??
              0
            );


          if (
            receiptDate !==
              selectedDate ||
            ![
              1,
              2
            ].includes(
              unitNo
            ) ||
            !Number.isFinite(
              quantity
            )
          ) {
            return;
          }


          receiptByUnit[
            unitNo
          ] +=
            quantity;
        }
      );


      if (
        requestToken !==
          limestoneUsageState
            .receiptRequestToken ||
        selectedDate !==
          limestoneUsageState
            .selectedDate ||
        selectedDate !==
          String(
            dateInput?.value ||
            ""
          ).trim()
      ) {
        return;
      }


      limestoneUsageState
        .receiptByUnit = {
          1:
            Math.round(
              receiptByUnit[1] *
              100
            ) /
            100,

          2:
            Math.round(
              receiptByUnit[2] *
              100
            ) /
            100
        };


      limestoneUsageState
        .loadedDate =
        selectedDate;


      renderLimestoneUsageCalculation();


      /*
        최신 입고량으로 화면 계산을 끝낸 뒤
        같은 날짜의 저장 사용량도 즉시 맞춘다.
      */
      const usageSyncResult =
        await synchronizeLimestoneUsageAfterReceiptRefresh(
          selectedDate
        );


      if (
        requestToken !==
          limestoneUsageState
            .receiptRequestToken ||
        selectedDate !==
          limestoneUsageState
            .selectedDate
      ) {
        return;
      }


      const totalReceipt =
        limestoneUsageState
          .receiptByUnit[1] +
        limestoneUsageState
          .receiptByUnit[2];


      setLimestoneUsageStatus(
        "complete",
        usageSyncResult?.updatedCount > 0
          ? "입고량·사용량 저장 완료"
          : "입고량 불러오기 완료",
        [
          `1호기 ${formatLimestoneUsageNumber(
            limestoneUsageState
              .receiptByUnit[1],
            2
          )} ton`,

          `2호기 ${formatLimestoneUsageNumber(
            limestoneUsageState
              .receiptByUnit[2],
            2
          )} ton`,

          `합계 ${formatLimestoneUsageNumber(
            totalReceipt,
            2
          )} ton`,

          usageSyncResult?.updatedCount > 0
            ? `사용량 ${usageSyncResult.updatedCount}건 저장 완료`
            : usageSyncResult?.manualProtectedCount > 0
              ? "수동 보정값 보호"
              : usageSyncResult?.ok === false
                ? `사용량 저장 실패: ${usageSyncResult.message || "확인 필요"}`
                : "저장 사용량 변경 없음"
        ].join(
          " · "
        )
      );

    } catch (
      error
    ) {
      if (
        requestToken !==
          limestoneUsageState
            .receiptRequestToken ||
        selectedDate !==
          limestoneUsageState
            .selectedDate ||
        selectedDate !==
          String(
            dateInput?.value ||
            ""
          ).trim()
      ) {
        return;
      }


      console.error(
        "석회석 사용량용 입고량 조회 실패:",
        error
      );


      limestoneUsageState
        .receiptByUnit = {
          1:
            0,

          2:
            0
        };


      renderLimestoneUsageCalculation();


      setLimestoneUsageStatus(
        "error",
        "입고량을 불러오지 못했습니다.",
        error?.message ||
        "석회석 입고기록 조회 중 오류가 발생했습니다."
      );

    } finally {
      if (
        requestToken ===
          limestoneUsageState
            .receiptRequestToken
      ) {
        limestoneUsageState
          .isLoading =
          false;


        if (
          refreshReceiptButton
        ) {
          refreshReceiptButton.disabled =
            false;


          refreshReceiptButton.textContent =
            "입고량 새로고침";
        }
      }
    }
  }

async function setLimestoneUsageDate(
  requestedDate,
  options = {}
) {
  const {
    load = false,
    restoreSaved = true
  } = options;

  const parsedDate =
    parseLimestoneUsageDate(
      requestedDate
    );

  if (!parsedDate) {
    setLimestoneUsageStatus(
      "error",
      "날짜 확인 필요",
      "사용량을 조회할 날짜를 선택해 주세요."
    );

    return;
  }

  const normalizedDate =
    formatLimestoneUsageDate(
      parsedDate
    );

  const dateRequestToken =
    limestoneUsageState.dateRequestToken + 1;

  limestoneUsageState.dateRequestToken =
    dateRequestToken;

  const isCurrentDateRequest = () => {
    return (
      dateRequestToken ===
        limestoneUsageState.dateRequestToken &&
      normalizedDate ===
        limestoneUsageState.selectedDate
    );
  };

  const renderAutoPreview = () => {
    if (
      typeof window
        .renderEfficiencyMorningMeetingAutoPreview ===
        "function"
    ) {
      window
        .renderEfficiencyMorningMeetingAutoPreview();
    }
  };

  const {
    dateInput,
    unitOneStartStock,
    unitOneEndStock,
    unitTwoStartStock,
    unitTwoEndStock
  } = getLimestoneUsageElements();

  limestoneUsageState.selectedDate =
    normalizedDate;

  limestoneUsageState.loadedDate =
    "";

  limestoneUsageState.receiptByUnit = {
    1: 0,
    2: 0
  };

  if (dateInput) {
    dateInput.value =
      normalizedDate;
  }

  /*
    날짜가 바뀌면 이전 날짜 값을 먼저 제거한다.
  */
  [
    unitOneStartStock,
    unitOneEndStock,
    unitTwoStartStock,
    unitTwoEndStock
  ]
    .filter(Boolean)
    .forEach(input => {
      input.value = "";
    });

  renderLimestoneUsageCalculation();

  /*
    load=true인 기존 호출에서만
    입고기록을 새로 조회한다.

    날짜 버튼 이동은 load=false이므로
    이 조회를 실행하지 않는다.
  */
  if (load) {
    await loadLimestoneUsageReceiptQuantities();
  }

  if (!isCurrentDateRequest()) {
    return;
  }

  let restored =
    false;

  const canRestoreSaved =
    (restoreSaved || load) &&
    typeof window
      .loadSavedLimestoneUsageRecords ===
      "function";

  if (canRestoreSaved) {
    /*
      날짜 change에 연결된 다른 처리가 끝난 뒤
      D1 저장값 복원 상태를 표시한다.
    */
    if (!load) {
      await Promise.resolve();

      if (!isCurrentDateRequest()) {
        return;
      }

      setLimestoneUsageStatus(
        "restoring",
        "저장값 불러오는 중",
        `${normalizedDate} D1 저장 기록을 확인하고 있습니다.`
      );

      renderAutoPreview();
    }

    try {
      restored =
        await window
          .loadSavedLimestoneUsageRecords(
            normalizedDate,
            {
              silentWhenMissing:
                true,

              requireActiveUsageDate:
                true,

              isCurrentUsageRequest:
                isCurrentDateRequest
            }
          );

    } catch (error) {
      if (!isCurrentDateRequest()) {
        return;
      }

      limestoneUsageState.loadedDate =
        normalizedDate;

      setLimestoneUsageStatus(
        "error",
        "저장값 불러오기 실패",
        error?.message ||
          `${normalizedDate} 저장 기록을 확인하지 못했습니다.`
      );

      renderAutoPreview();

      console.error(
        "석회석 D1 저장값 복원 실패:",
        error
      );

      return;
    }
  }

  if (!isCurrentDateRequest()) {
    return;
  }

  limestoneUsageState.loadedDate =
    normalizedDate;

  if (restored) {
    renderAutoPreview();

    return;
  }

  if (!load) {
    setLimestoneUsageStatus(
      "idle",
      "저장된 사용량 없음",
      `${normalizedDate}은 아직 저장된 계산 결과가 없습니다.`
    );

    renderAutoPreview();
  }
}

/* =====================================================
  소메뉴 전환
====================================================== */

function switchLimestoneSubview(
  requestedView
) {
  const normalizedView =
    requestedView === "usage"
      ? "usage"
      : "receipt";

  const {
    limestoneView,
    receiptDashboard,
    usageView,
    headingEyebrow,
    headingTitle,
    headingDescription,
    headingActions,
    submenuButtons,
    dateInput,
    loadOisButton,
    refreshReceiptButton
  } =
    getLimestoneUsageElements();

  const isUsageView =
    normalizedView ===
      "usage";

  const isMobile =
    isLimestoneUsageMobileMonitorMode();

  /*
    현재 화면 상태를 CSS에서도
    직접 사용할 수 있게 저장한다.
  */
  if (
    limestoneView
  ) {
    limestoneView.dataset
      .limestoneSubview =
      normalizedView;
  }

  /*
    입고현황 / 사용량 계산 본문
  */
  if (
    receiptDashboard
  ) {
    receiptDashboard.hidden =
      isUsageView;
  }

  if (
    usageView
  ) {
    usageView.hidden =
      !isUsageView;
  }

  /*
    상단 입고 기능

    입고현황:
    PC     = 기존 기능 모두
    모바일 = 새로고침 + 입고만

    사용량 계산:
    공통 상단 입고 버튼 영역 숨김
  */
  if (
    headingActions
  ) {
    headingActions.hidden =
      isUsageView;

    const receiptButtonRules = [
      {
        id:
          "refreshLimestoneReceiptsButton",

        mobileHidden:
          false
      },

      {
        id:
          "openLimestoneSlipCaptureButton",

        mobileHidden:
          true
      },

      {
        id:
          "openLimestoneSlipLibraryButton",

        mobileHidden:
          true
      },

      {
        id:
          "openLimestoneReceiptEditorButton",

        mobileHidden:
          false
      }
    ];

    receiptButtonRules.forEach(
      rule => {
        const button =
          document.getElementById(
            rule.id
          );

        if (
          !button
        ) {
          return;
        }

        button.hidden =
          isUsageView ||
          (
            isMobile &&
            rule.mobileHidden
          );
      }
    );

    const cameraGuide =
      headingActions.querySelector(
        ".limestone-slip-camera-guide"
      );

    if (
      cameraGuide
    ) {
      cameraGuide.hidden =
        isUsageView ||
        isMobile;
    }
  }

  /*
    사용량 화면 상단 기능

    PC:
    기존 OIS / 입고량 새로고침 유지

    모바일:
    모니터링 전용이므로 전부 숨김
  */
  const usageHeaderActions =
    usageView?.querySelector(
      ".limestone-usage-calculator__header-actions"
    ) ||
    null;

  if (
    usageHeaderActions
  ) {
    usageHeaderActions.hidden =
      !isUsageView ||
      isMobile;
  }

  [
    loadOisButton,
    refreshReceiptButton
  ]
    .filter(
      Boolean
    )
    .forEach(
      button => {
        button.hidden =
          !isUsageView ||
          isMobile;
      }
    );

  /*
    소메뉴 활성 상태
  */
  submenuButtons.forEach(
    button => {
      const isActive =
        button.dataset
          .limestoneSubview ===
        normalizedView;

      button.classList.toggle(
        "is-active",
        isActive
      );

      button.setAttribute(
        "aria-selected",
        String(
          isActive
        )
      );

      button.tabIndex =
        isActive
          ? 0
          : -1;
    }
  );

  /*
    상단 제목
  */
  if (
    headingEyebrow
  ) {
    headingEyebrow.textContent =
      isUsageView
        ? "LIMESTONE CONSUMPTION"
        : "LIMESTONE RECEIPT";
  }

  if (
    headingTitle
  ) {
    headingTitle.textContent =
      isUsageView
        ? "석회석 사용량 계산"
        : "석회석 입고 현황";
  }

  if (
    headingDescription
  ) {
    headingDescription.textContent =
      isUsageView
        ? "OIS 재고량과 당일 입고량을 기준으로 호기별 석회석 사용량을 계산합니다."
        : "호기별 석회석 입고량을 기록하고 기간별 합계를 확인합니다.";
  }

  /*
    사용량 화면 진입 시
    현재 선택 날짜의 저장값 복원
  */
  if (
    isUsageView
  ) {
    const currentReceiptDate =
      String(
        document.getElementById(
          "limestoneStartDate"
        )?.value ||
        ""
      ).trim();

    const targetDate =
      parseLimestoneUsageDate(
        limestoneUsageState
          .selectedDate
      )
        ? limestoneUsageState
            .selectedDate

        : parseLimestoneUsageDate(
            currentReceiptDate
          )
          ? currentReceiptDate
          : getLimestoneUsageToday();

    if (
      dateInput
    ) {
      dateInput.value =
        targetDate;
    }

    if (
      limestoneUsageState
        .loadedDate !==
      targetDate
    ) {
      setLimestoneUsageDate(
        targetDate
      );
    }
  }
}

/* =====================================================
  화면 생성
====================================================== */

function createLimestoneUsageFeatureHtml() {
  const {
    limestoneView,
    heading,
    receiptDashboard
  } =
    getLimestoneUsageElements();


  if (
    !limestoneView ||
    !heading ||
    !receiptDashboard
  ) {
    return false;
  }


  /* ===================================================
    석회석 소메뉴
  ==================================================== */

  if (
    !document.getElementById(
      "limestoneSubviewMenu"
    )
  ) {
    heading.insertAdjacentHTML(
      "afterend",

      `
        <nav
          class="limestone-subview-menu"
          id="limestoneSubviewMenu"
          role="tablist"
          aria-label="석회석 세부 메뉴"
        >

          <button
            type="button"
            class="
              limestone-subview-menu__button
              is-active
            "
            id="limestoneReceiptSubviewButton"
            data-limestone-subview="receipt"
            role="tab"
            aria-selected="true"
            aria-controls="limestoneDashboard"
          >
            입고 현황
          </button>


          <button
            type="button"
            class="limestone-subview-menu__button"
            id="limestoneUsageSubviewButton"
            data-limestone-subview="usage"
            role="tab"
            aria-selected="false"
            aria-controls="limestoneUsageCalculatorView"
            tabindex="-1"
          >
            사용량 계산
          </button>

        </nav>
      `
    );
  }


  /* ===================================================
    사용량 계산 화면
  ==================================================== */

  if (
    !document.getElementById(
      "limestoneUsageCalculatorView"
    )
  ) {
    receiptDashboard.insertAdjacentHTML(
      "afterend",

      `
        <section
          class="limestone-usage-calculator"
          id="limestoneUsageCalculatorView"
          data-limestone-usage-status="idle"
          role="tabpanel"
          aria-labelledby="limestoneUsageSubviewButton"
          hidden
        >

          <!-- =========================================
            사용량 계산 상단
          ========================================== -->

          <header class="limestone-usage-calculator__header">

            <div>

              <span>
                DAILY CONSUMPTION
              </span>

              <h4>
                일일 석회석 사용량
              </h4>

              <p>
                시작 재고 + 당일 입고량 - 종료 재고로 계산합니다.
              </p>

            </div>


            <div class="limestone-usage-calculator__header-actions">

              <button
                type="button"
                class="secondary-button"
                id="loadLimestoneUsageOisButton"
                title="선택일의 석회석 사용량을 계산·저장합니다."
                disabled
              >
                석회석 사용량 계산
              </button>


              <button
                type="button"
                class="secondary-button"
                id="refreshLimestoneUsageReceiptButton"
              >
                입고량 새로고침
              </button>

            </div>

          </header>


          <!-- =========================================
            날짜
          ========================================== -->

          <section class="limestone-usage-date-card">

            <button
              type="button"
              class="limestone-usage-date-arrow"
              id="limestoneUsagePreviousDateButton"
              aria-label="이전 날짜"
            >
              ‹
            </button>


            <label class="limestone-usage-date-field">

              <span>
                계산 기준일
              </span>

              <input
                type="date"
                id="limestoneUsageDate"
                autocomplete="off"
              />

            </label>


            <button
              type="button"
              class="limestone-usage-date-arrow"
              id="limestoneUsageNextDateButton"
              aria-label="다음 날짜"
            >
              ›
            </button>


            <button
              type="button"
              class="secondary-button"
              id="limestoneUsageTodayButton"
            >
              오늘
            </button>


            <div
              class="limestone-usage-status"
              id="limestoneUsageStatus"
            >

              <span
                class="limestone-usage-status__dot"
                aria-hidden="true"
              >
              </span>


              <div>

                <strong id="limestoneUsageStatusTitle">
                  조회 준비
                </strong>

                <small id="limestoneUsageStatusDescription">
                  날짜를 선택하면 당일 입고량을 자동으로 불러옵니다.
                </small>

              </div>

            </div>

          </section>


          <!-- =========================================
            결과 요약
          ========================================== -->

          <section class="limestone-usage-summary-grid">

            <article
              class="
                limestone-usage-summary-card
                is-total
              "
            >

              <span>
                전체 사용량
              </span>

              <strong id="limestoneUsageTotalSummary">
                -
              </strong>

              <small>
                ton
              </small>

            </article>


            <article
              class="
                limestone-usage-summary-card
                is-unit-one
              "
            >

              <span>
                1호기 사용량
              </span>

              <strong id="limestoneUsageUnitOneSummary">
                -
              </strong>

              <small>
                ton
              </small>

            </article>


            <article
              class="
                limestone-usage-summary-card
                is-unit-two
              "
            >

              <span>
                2호기 사용량
              </span>

              <strong id="limestoneUsageUnitTwoSummary">
                -
              </strong>

              <small>
                ton
              </small>

            </article>

          </section>


          <!-- =========================================
            계산표
          ========================================== -->

          <section class="limestone-usage-table-card">

            <header class="limestone-usage-table-card__header">

              <div>

                <span>
                  CALCULATION
                </span>

                <h4>
                  호기별 사용량 계산
                </h4>

              </div>

            </header>


            <div class="limestone-usage-table-wrap">

              <table class="limestone-usage-table">

                <thead>

                  <tr>

                    <th>
                      호기
                    </th>

                    <th>
                      시작 재고

                      <small>
                        선택일 00:00
                      </small>
                    </th>

                    <th>
                      ＋ 입고량
                    </th>

                    <th>
                      종료 재고

                      <small>
                        다음 날 00:00
                      </small>
                    </th>

                    <th>
                      ＝ 사용량
                    </th>

                    <th>
                      OIS TAG
                    </th>

                  </tr>

                </thead>


                <tbody>

                  <!-- 1호기 -->

                  <tr
                    data-limestone-usage-unit="1"
                  >

                    <th>
                      1호기
                    </th>


                    <td>

                      <div class="limestone-usage-number-input">

                        <input
                          type="number"
                          id="limestoneUsageUnitOneStartStock"
                          min="0"
                          step="0.001"
                          inputmode="decimal"
                          placeholder="시작 재고"
                        />

                        <span>
                          ton
                        </span>

                      </div>

                    </td>


                    <td>

                      <strong id="limestoneUsageUnitOneReceipt">
                        0.00 ton
                      </strong>

                    </td>


                    <td>

                      <div class="limestone-usage-number-input">

                        <input
                          type="number"
                          id="limestoneUsageUnitOneEndStock"
                          min="0"
                          step="0.001"
                          inputmode="decimal"
                          placeholder="종료 재고"
                        />

                        <span>
                          ton
                        </span>

                      </div>

                    </td>


                    <td>

                      <strong
                        class="limestone-usage-result-value"
                        id="limestoneUsageUnitOneUsage"
                      >
                        -
                      </strong>

                    </td>


                    <td>

                      <code>
                        ${LIMESTONE_USAGE_TAGS[1]}
                      </code>

                    </td>

                  </tr>


                  <!-- 2호기 -->

                  <tr
                    data-limestone-usage-unit="2"
                  >

                    <th>
                      2호기
                    </th>


                    <td>

                      <div class="limestone-usage-number-input">

                        <input
                          type="number"
                          id="limestoneUsageUnitTwoStartStock"
                          min="0"
                          step="0.001"
                          inputmode="decimal"
                          placeholder="시작 재고"
                        />

                        <span>
                          ton
                        </span>

                      </div>

                    </td>


                    <td>

                      <strong id="limestoneUsageUnitTwoReceipt">
                        0.00 ton
                      </strong>

                    </td>


                    <td>

                      <div class="limestone-usage-number-input">

                        <input
                          type="number"
                          id="limestoneUsageUnitTwoEndStock"
                          min="0"
                          step="0.001"
                          inputmode="decimal"
                          placeholder="종료 재고"
                        />

                        <span>
                          ton
                        </span>

                      </div>

                    </td>


                    <td>

                      <strong
                        class="limestone-usage-result-value"
                        id="limestoneUsageUnitTwoUsage"
                      >
                        -
                      </strong>

                    </td>


                    <td>

                      <code>
                        ${LIMESTONE_USAGE_TAGS[2]}
                      </code>

                    </td>

                  </tr>

                </tbody>

              </table>

            </div>


            <p class="limestone-usage-formula-help">
              사용량 = 시작 재고 + 당일 입고량 - 종료 재고
            </p>

          </section>


          <p class="limestone-usage-ois-help">
            ‘석회석 사용량 계산’을 누르면 OIS 재고와 당일 입고량으로 사용량을 계산·저장합니다.
          </p>

        </section>
      `
    );
  }


  return true;
}


/* =====================================================
  이벤트
====================================================== */

function bindLimestoneUsageEvents() {
  const elements =
    getLimestoneUsageElements();


  if (
    !elements.submenu ||
    elements.submenu.dataset
      .limestoneUsageBound ===
      "true"
  ) {
    return;
  }


  /* ===================================================
    소메뉴
  ==================================================== */

  elements.submenuButtons.forEach(
    button => {
      button.addEventListener(
        "click",
        () => {
          switchLimestoneSubview(
            button.dataset
              .limestoneSubview
          );
        }
      );
    }
  );


  /* ===================================================
    이전 날짜
  ==================================================== */

  elements.previousDateButton
    ?.addEventListener(
      "click",
      () => {
        const currentDate =
          elements.dateInput?.value ||
          limestoneUsageState
            .selectedDate ||
          getLimestoneUsageToday();


        setLimestoneUsageDate(
          addLimestoneUsageDays(
            currentDate,
            -1
          )
        );
      }
    );


  /* ===================================================
    다음 날짜
  ==================================================== */

  elements.nextDateButton
    ?.addEventListener(
      "click",
      () => {
        const currentDate =
          elements.dateInput?.value ||
          limestoneUsageState
            .selectedDate ||
          getLimestoneUsageToday();


        setLimestoneUsageDate(
          addLimestoneUsageDays(
            currentDate,
            1
          )
        );
      }
    );


  /* ===================================================
    오늘
  ==================================================== */

  elements.todayButton
    ?.addEventListener(
      "click",
      () => {
        setLimestoneUsageDate(
          getLimestoneUsageToday()
        );
      }
    );


  /* ===================================================
    날짜 직접 선택
  ==================================================== */

  elements.dateInput
    ?.addEventListener(
      "change",
      () => {
        setLimestoneUsageDate(
          elements.dateInput.value
        );
      }
    );


  /* ===================================================
    입고량 새로고침
  ==================================================== */

  elements.refreshReceiptButton
    ?.addEventListener(
      "click",
      loadLimestoneUsageReceiptQuantities
    );


  /* ===================================================
    재고 직접입력 계산
  ==================================================== */

  [
    elements.unitOneStartStock,
    elements.unitOneEndStock,
    elements.unitTwoStartStock,
    elements.unitTwoEndStock
  ]
    .filter(
      Boolean
    )
    .forEach(
      input => {
        input.addEventListener(
          "input",
          renderLimestoneUsageCalculation
        );


        input.addEventListener(
          "change",
          renderLimestoneUsageCalculation
        );
      }
    );


  elements.submenu.dataset
    .limestoneUsageBound =
    "true";
}


/* =====================================================
  초기화
====================================================== */

function initializeLimestoneUsageCalculator() {
  const created =
    createLimestoneUsageFeatureHtml();


  if (
    !created
  ) {
    return;
  }


  /*
    화면을 생성한 뒤 다시 요소를 조회해야 한다.

    submenu / 사용량 날짜 버튼 등은
    createLimestoneUsageFeatureHtml()에서 생성된다.
  */
  bindLimestoneUsageEvents();


  const currentReceiptDate =
    String(
      document.getElementById(
        "limestoneStartDate"
      )?.value ||
      ""
    ).trim();


  limestoneUsageState
    .selectedDate =
    parseLimestoneUsageDate(
      currentReceiptDate
    )
      ? currentReceiptDate
      : getLimestoneUsageToday();


  const {
    dateInput
  } =
    getLimestoneUsageElements();


  if (
    dateInput
  ) {
    dateInput.value =
      limestoneUsageState
        .selectedDate;
  }


  switchLimestoneSubview(
    "receipt"
  );
}


/* =====================================================
  외부 공개
====================================================== */

window
  .switchLimestoneSubview =
  switchLimestoneSubview;


window
  .loadLimestoneUsageReceiptQuantities =
  loadLimestoneUsageReceiptQuantities;

window.setLimestoneUsageSavedReceiptQuantities = (targetDate, receipts) => {
  if (String(getLimestoneUsageElements().dateInput?.value || "").trim() !== targetDate) return false;
  limestoneUsageState.selectedDate = targetDate;
  limestoneUsageState.loadedDate = targetDate;
  limestoneUsageState.receiptByUnit = { 1: receipts[1], 2: receipts[2] };
  return true;
};


/* =====================================================
  최초 실행
====================================================== */

if (
  document.readyState ===
    "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initializeLimestoneUsageCalculator,
    {
      once:
        true
    }
  );

} else {
  initializeLimestoneUsageCalculator();
}


/*
  installLimestoneUsageCalculatorFeature 종료
*/
}
});
