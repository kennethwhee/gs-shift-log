(() => {
  "use strict";

  const VERSION =
    "MORNING_MEETING_FINAL_WATER_PREFETCH_V1";

  const BUTTON_ID =
    "createEfficiencyMorningMeetingWorkbookButton";

  const MESSAGE_ID =
    "efficiencyMorningMeetingMessage";

  const WORK_DATE_ID =
    "efficiencyMorningMeetingWorkDatePicker";

  const STORAGE_KEY =
    "gsShiftLog.morningMeetingAutoDataCache.v1";

  const API_URL =
    "/api/ois-data-requests";

  const REQUEST_TYPE =
    "water_environment";

  const MAXIMUM_WAIT_MS =
    15 * 60 * 1000;

  const POLL_INTERVAL_MS =
    1500;

  const WATER_KEYS = Object.freeze([
    "rawWaterInflow",
    "demiProduction",
    "pureWaterUsage",
    "rawWaterTankAmount",
    "rawWaterTankRate",
    "filteredWaterTankAmount",
    "filteredWaterTankRate",
    "demiWaterTankAmount",
    "demiWaterTankRate"
  ]);

  let busy =
    false;

  let replayingClick =
    false;

  function normalizeText(value) {
    return String(
      value ??
      ""
    ).trim();
  }

  function isValidDate(value) {
    const text =
      normalizeText(
        value
      );

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        text
      )
    ) {
      return false;
    }

    const parsed =
      new Date(
        `${text}T00:00:00.000Z`
      );

    return (
      !Number.isNaN(
        parsed.getTime()
      ) &&
      parsed
        .toISOString()
        .slice(
          0,
          10
        ) ===
        text
    );
  }

  function addDateDays(
    value,
    dayCount
  ) {
    if (
      !isValidDate(
        value
      )
    ) {
      return "";
    }

    const parsed =
      new Date(
        `${value}T00:00:00.000Z`
      );

    parsed.setUTCDate(
      parsed.getUTCDate() +
      Number(
        dayCount ||
        0
      )
    );

    return parsed
      .toISOString()
      .slice(
        0,
        10
      );
  }

  function toFiniteNumber(
    value
  ) {
    const text =
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
      !text
    ) {
      return null;
    }

    const numberValue =
      Number(
        text
      );

    return Number.isFinite(
      numberValue
    )
      ? numberValue
      : null;
  }

  function getState() {
    const state =
      window
        .efficiencyMorningMeetingUploadState;

    return state &&
      typeof state ===
        "object"
      ? state
      : {};
  }

  function getWeekendMode(
    state
  ) {
    let weekendMode =
      null;

    try {
      if (
        typeof window
          .getEfficiencyMorningMeetingWeekendMode ===
          "function"
      ) {
        weekendMode =
          window
            .getEfficiencyMorningMeetingWeekendMode();
      }
    } catch (
      error
    ) {
      console.warn(
        "[Morning Meeting] final-water weekend mode read failed:",
        error
      );
    }

    if (
      !weekendMode ||
      typeof weekendMode !==
        "object" ||
      Array.isArray(
        weekendMode
      )
    ) {
      weekendMode =
        state?.weekendMode;
    }

    return weekendMode &&
      typeof weekendMode ===
        "object" &&
      !Array.isArray(
        weekendMode
      )
      ? weekendMode
      : {};
  }

  function resolveDates() {
    const state =
      getState();

    const weekendMode =
      getWeekendMode(
        state
      );

    const weekendStartDate =
      isValidDate(
        weekendMode?.startDate
      )
        ? normalizeText(
            weekendMode.startDate
          )
        : "";

    const weekendEndDate =
      isValidDate(
        weekendMode?.endDate
      )
        ? normalizeText(
            weekendMode.endDate
          )
        : "";

    const weekendEnabled =
      weekendMode?.enabled ===
        true &&
      Boolean(
        weekendStartDate
      ) &&
      Boolean(
        weekendEndDate
      );

    const pickerDate =
      normalizeText(
        document
          .getElementById(
            WORK_DATE_ID
          )
          ?.value
      );

    const stateWorkDate =
      normalizeText(
        state?.workDate
      );

    const waterDate =
      normalizeText(
        state
          ?.waterTreatment
          ?.sourceDate ||
        state
          ?.waterTreatment
          ?.targetDate
      );

    const workDate =
      [
        stateWorkDate,
        pickerDate,
        waterDate
      ].find(
        isValidDate
      ) ||
      "";

    const currentDate =
      weekendEnabled
        ? weekendEndDate
        : workDate;

    const previousDate =
      weekendEnabled
        ? weekendStartDate
        : addDateDays(
            currentDate,
            -1
          );

    return {
      weekendEnabled,
      workDate,
      currentDate,
      previousDate
    };
  }

  function loadCache() {
    try {
      const raw =
        window.localStorage
          ?.getItem(
            STORAGE_KEY
          );

      const parsed =
        raw
          ? JSON.parse(
              raw
            )
          : {};

      return parsed &&
        typeof parsed ===
          "object" &&
        !Array.isArray(
          parsed
        )
        ? parsed
        : {};

    } catch (
      error
    ) {
      console.warn(
        "[Morning Meeting] final-water cache read failed:",
        error
      );

      return {};
    }
  }

  function hasExactWaterDate(
    item,
    expectedDate
  ) {
    if (
      !item ||
      typeof item !==
        "object" ||
      Array.isArray(
        item
      )
    ) {
      return false;
    }

    const dates = [
      item.sourceDate,
      item.targetDate
    ]
      .map(
        normalizeText
      )
      .filter(
        isValidDate
      );

    return (
      dates.length >
        0 &&
      dates.every(
        date =>
          date ===
          expectedDate
      )
    );
  }

  function hasCompleteWaterValues(
    item
  ) {
    return WATER_KEYS.every(
      key =>
        toFiniteNumber(
          item?.[key]
        ) !==
        null
    );
  }

  function getCachedWater(
    targetDate
  ) {
    const cache =
      loadCache();

    const item =
      cache?.water?.[
        targetDate
      ];

    return (
      hasExactWaterDate(
        item,
        targetDate
      ) &&
      hasCompleteWaterValues(
        item
      )
    )
      ? item
      : null;
  }

  function saveCachedWater(
    targetDate,
    item
  ) {
    const cache =
      loadCache();

    const water =
      cache.water &&
      typeof cache.water ===
        "object" &&
      !Array.isArray(
        cache.water
      )
        ? cache.water
        : {};

    cache.water =
      water;

    cache.water[
      targetDate
    ] = {
      ...item,
      sourceDate:
        targetDate,
      targetDate:
        targetDate,
      cachedAt:
        new Date()
          .toISOString()
    };

    window.localStorage
      .setItem(
        STORAGE_KEY,
        JSON.stringify(
          cache
        )
      );

    return cache.water[
      targetDate
    ];
  }

  function getAuthHeaders(
    additional =
      {}
  ) {
    if (
      typeof window
        .getShiftLogAuthHeaders ===
        "function"
    ) {
      return window
        .getShiftLogAuthHeaders(
          additional
        );
    }

    return {
      Accept:
        "application/json",
      ...additional
    };
  }

  async function readApiResponse(
    response,
    fallbackMessage
  ) {
    const text =
      await response.text();

    let data =
      {};

    if (
      text.trim()
    ) {
      try {
        data =
          JSON.parse(
            text
          );
      } catch {
        throw new Error(
          fallbackMessage ||
          "서버 응답 형식을 확인하지 못했습니다."
        );
      }
    }

    if (
      !response.ok ||
      data?.ok ===
        false
    ) {
      throw new Error(
        data?.message ||
        data?.error ||
        fallbackMessage ||
        `HTTP ${response.status}`
      );
    }

    return data;
  }

  async function createOrReuseRequest(
    targetDate
  ) {
    const response =
      await fetch(
        API_URL,
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
              requestType:
                REQUEST_TYPE,
              targetDate,
              forceRefresh:
                false
            })
        }
      );

    const data =
      await readApiResponse(
        response,
        `${targetDate} 전전일 수처리 자료를 확인하지 못했습니다.`
      );

    if (
      !data?.item ||
      typeof data.item !==
        "object"
    ) {
      throw new Error(
        `${targetDate} 수처리 요청 정보를 확인하지 못했습니다.`
      );
    }

    return data.item;
  }

  async function getRequest(
    requestId
  ) {
    const url =
      new URL(
        API_URL,
        window.location.origin
      );

    url.searchParams.set(
      "id",
      requestId
    );

    url.searchParams.set(
      "_",
      String(
        Date.now()
      )
    );

    const response =
      await fetch(
        url.toString(),
        {
          method:
            "GET",
          headers:
            getAuthHeaders(),
          cache:
            "no-store"
        }
      );

    const data =
      await readApiResponse(
        response,
        "수처리 OIS 요청 상태를 확인하지 못했습니다."
      );

    return data?.item ||
      null;
  }

  function wait(
    milliseconds
  ) {
    return new Promise(
      resolve =>
        window.setTimeout(
          resolve,
          milliseconds
        )
    );
  }

  async function waitForRequest(
    requestItem,
    targetDate,
    onUpdate
  ) {
    const status =
      normalizeText(
        requestItem?.status
      ).toLowerCase();

    if (
      status ===
        "complete"
    ) {
      return requestItem;
    }

    const requestId =
      normalizeText(
        requestItem?.id
      );

    if (
      !requestId
    ) {
      throw new Error(
        "수처리 OIS 요청 ID가 없습니다."
      );
    }

    if (
      typeof window
        .waitForSharedOisRequestCompletion ===
        "function"
    ) {
      return await window
        .waitForSharedOisRequestCompletion(
          requestId,
          {
            maximumWaitMs:
              MAXIMUM_WAIT_MS,
            onUpdate,
            notFoundMessage:
              `${targetDate} 수처리 요청을 찾을 수 없습니다.`,
            timeoutMessage:
              `${targetDate} 전전일 수처리 조회 응답 시간이 초과되었습니다.`,
            failureMessage:
              item =>
                item?.errorMessage ||
                `${targetDate} 전전일 수처리 조회에 실패했습니다.`
          }
        );
    }

    const startedAt =
      Date.now();

    let current =
      requestItem;

    while (
      Date.now() -
        startedAt <
      MAXIMUM_WAIT_MS
    ) {
      if (
        typeof onUpdate ===
          "function"
      ) {
        onUpdate(
          current
        );
      }

      await wait(
        POLL_INTERVAL_MS
      );

      current =
        await getRequest(
          requestId
        );

      const nextStatus =
        normalizeText(
          current?.status
        ).toLowerCase();

      if (
        nextStatus ===
          "complete"
      ) {
        return current;
      }

      if (
        nextStatus ===
          "failed"
      ) {
        throw new Error(
          current?.errorMessage ||
          `${targetDate} 전전일 수처리 조회에 실패했습니다.`
        );
      }
    }

    throw new Error(
      `${targetDate} 전전일 수처리 조회 응답 시간이 초과되었습니다.`
    );
  }

  function normalizeCompletedWater(
    requestItem,
    expectedDate
  ) {
    const status =
      normalizeText(
        requestItem?.status
      ).toLowerCase();

    if (
      status !==
        "complete"
    ) {
      throw new Error(
        `${expectedDate} 수처리 요청이 아직 완료되지 않았습니다.`
      );
    }

    const raw =
      requestItem?.result;

    if (
      !raw ||
      typeof raw !==
        "object" ||
      Array.isArray(
        raw
      )
    ) {
      throw new Error(
        `${expectedDate} 수처리 완료 결과가 비어 있습니다.`
      );
    }

    const sourceDate =
      normalizeText(
        raw.sourceDate ||
        raw.targetDate ||
        requestItem?.targetDate
      );

    if (
      sourceDate &&
      sourceDate !==
        expectedDate
    ) {
      throw new Error(
        `수처리 날짜가 다릅니다. 요청 ${expectedDate} / 결과 ${sourceDate}`
      );
    }

    const normalized = {
      source:
        normalizeText(
          raw.source
        ) ||
        "OIS 일일 운전일지(환경)",
      sourceDate:
        expectedDate,
      targetDate:
        expectedDate,
      collectedAt:
        normalizeText(
          raw.collectedAt ||
          requestItem?.completedAt
        ),
      agentId:
        normalizeText(
          requestItem?.agentId
        ),
      requestId:
        normalizeText(
          requestItem?.id
        )
    };

    WATER_KEYS.forEach(
      key => {
        normalized[key] =
          toFiniteNumber(
            raw[key]
          );
      }
    );

    if (
      !hasCompleteWaterValues(
        normalized
      )
    ) {
      throw new Error(
        `${expectedDate} 수처리 9개 값 중 일부가 비어 있습니다.`
      );
    }

    return normalized;
  }

  function statusLabel(
    item
  ) {
    const status =
      normalizeText(
        item?.status
      ).toLowerCase();

    if (
      status ===
        "processing"
    ) {
      return "OIS 조회 중";
    }

    if (
      status ===
        "pending"
    ) {
      return "회사 PC 대기";
    }

    return "자료 확인 중";
  }

  async function ensurePreviousWater(
    options =
      {}
  ) {
    const dates =
      resolveDates();

    if (
      !dates.previousDate ||
      !dates.currentDate
    ) {
      throw new Error(
        "최종 엑셀의 수처리 날짜를 확인하지 못했습니다."
      );
    }

    const cached =
      getCachedWater(
        dates.previousDate
      );

    if (
      cached
    ) {
      return {
        source:
          "cache",
        dates,
        water:
          cached
      };
    }

    const requestItem =
      await createOrReuseRequest(
        dates.previousDate
      );

    const completedItem =
      await waitForRequest(
        requestItem,
        dates.previousDate,
        item => {
          if (
            typeof options.onUpdate ===
              "function"
          ) {
            options.onUpdate({
              dates,
              item,
              label:
                statusLabel(
                  item
                )
            });
          }
        }
      );

    const normalized =
      normalizeCompletedWater(
        completedItem,
        dates.previousDate
      );

    const stored =
      saveCachedWater(
        dates.previousDate,
        normalized
      );

    console.log(
      `[Morning Meeting] previous-day water ${dates.previousDate} ready for final workbook`,
      {
        requestId:
          normalized.requestId,
        currentDate:
          dates.currentDate
      }
    );

    return {
      source:
        requestItem?.status ===
          "complete"
          ? "server-complete"
          : "server-query",
      dates,
      water:
        stored
    };
  }

  function setMessage(
    text
  ) {
    const message =
      document
        .getElementById(
          MESSAGE_ID
        );

    if (
      message
    ) {
      message.textContent =
        text;
    }
  }

  function showFailure(
    error
  ) {
    const message =
      error?.message ||
      "전전일 수처리 자료를 확인하지 못했습니다.";

    setMessage(
      `최종 엑셀 생성 보류 · ${message}`
    );

    console.error(
      "[Morning Meeting] previous-day water prefetch failed:",
      error
    );

    try {
      if (
        typeof window.showToast ===
          "function"
      ) {
        window.showToast(
          message
        );
      }
    } catch {
      /* toast is optional */
    }
  }

  async function handleCreateClick(
    event
  ) {
    const target =
      event?.target;

    const button =
      target?.closest
        ? target.closest(
            `#${BUTTON_ID}`
          )
        : (
            target?.id ===
              BUTTON_ID
              ? target
              : null
          );

    if (
      !button ||
      replayingClick
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (
      busy ||
      button.disabled
    ) {
      return;
    }

    busy =
      true;

    const originalText =
      button.textContent;

    button.disabled =
      true;

    button.dataset
      .previousWaterPrefetch =
      "running";

    button.textContent =
      "전전일 수처리 확인 중";

    setMessage(
      "최종 엑셀 생성 전 전전일 수처리 자료를 확인합니다."
    );

    try {
      const result =
        await ensurePreviousWater({
          onUpdate:
            update => {
              button.textContent =
                `전전일 수처리 · ${update.label}`;
            }
        });

      button.dataset
        .previousWaterPrefetch =
        "ready";

      setMessage(
        `${result.dates.previousDate} 수처리 확보 완료 · 최종 엑셀을 생성합니다.`
      );

      busy =
        false;

      button.disabled =
        false;

      button.textContent =
        originalText;

      replayingClick =
        true;

      try {
        button.click();
      } finally {
        replayingClick =
          false;
      }

    } catch (
      error
    ) {
      busy =
        false;

      button.dataset
        .previousWaterPrefetch =
        "failed";

      button.disabled =
        false;

      button.textContent =
        originalText;

      showFailure(
        error
      );

      try {
        if (
          typeof window
            .updateEfficiencyMorningMeetingCreateButton ===
            "function"
        ) {
          window
            .updateEfficiencyMorningMeetingCreateButton();
        }
      } catch {
        /* button refresh is best effort */
      }
    }
  }

  function install() {
    if (
      window
        .__morningMeetingFinalWaterPrefetchV1Installed ===
        true
    ) {
      return;
    }

    window
      .__morningMeetingFinalWaterPrefetchV1Installed =
      true;

    document.addEventListener(
      "click",
      handleCreateClick,
      true
    );
  }

  window.MorningMeetingFinalWaterPrefetchV1 = {
    version:
      VERSION,
    resolveDates,
    getCachedWater,
    normalizeCompletedWater,
    ensurePreviousWater,
    handleCreateClick,
    install
  };

  install();
})();
