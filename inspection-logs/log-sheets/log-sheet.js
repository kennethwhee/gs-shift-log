(function initializeLogSheetEditor() {
  "use strict";

  const CURRENT_USER_STORAGE_KEY =
    "gsShiftLog.currentUser";

  const config =
    globalThis.LOG_SHEET_CONFIG;

  const state = {
    documentConfig: null,
    sheetConfig: null,
    workbook: null,
    templateBuffer: null,
    record: null,
    values: {},
    loadedValues: {},
    generatedValues: {},
    loadedGeneratedValues: {},
    isBusy: false,
    isDirty: false,
    identityChanged: false,
    loggingIntervalHours: 0,
    loggingStartHour: 0,
    printZoom: ""
  };

  const templateCache =
    new Map();

  const byId =
    id => document.getElementById(
      id
    );

  const elements = {
    app:
      byId("logSheetApp"),
    title:
      byId("logSheetTitle"),
    description:
      byId("logSheetDescription"),
    date:
      byId("logSheetDate"),
    shift:
      byId("logSheetShift"),
    team:
      byId("logSheetTeam"),
    auxiliaryControls:
      byId("logSheetAuxiliaryControls"),
    loadButton:
      byId("logSheetLoadButton"),
    saveButton:
      byId("logSheetSaveButton"),
    historyButton:
      byId("logSheetHistoryButton"),
    previewButton:
      byId("logSheetPreviewButton"),
    previewSection:
      byId("logSheetPreviewSection"),
    downloadButton:
      byId("logSheetDownloadButton"),
    printButton:
      byId("logSheetPrintButton"),
    stateBadge:
      byId("logSheetStateBadge"),
    stateText:
      byId("logSheetStateText"),
    revisionText:
      byId("logSheetRevisionText"),
    tabs:
      byId("logSheetTabs"),
    loggingIntervalField:
      byId("logSheetLoggingIntervalField"),
    loggingInterval:
      byId("logSheetLoggingInterval"),
    loggingStartField:
      byId("logSheetLoggingStartField"),
    loggingStartHour:
      byId("logSheetLoggingStartHour"),
    itemCount:
      byId("logSheetItemCount"),
    itemAddButton:
      byId("logSheetItemAddButton"),
    templateSaveButton:
      byId("logSheetTemplateSaveButton"),
    itemList:
      byId("logSheetItemList"),
    loading:
      byId("logSheetLoading"),
    gridShell:
      byId("logSheetGridShell"),
    grid:
      byId("logSheetGrid"),
    printTitle:
      byId("logSheetPrintTitle"),
    printMeta:
      byId("logSheetPrintMeta"),
    historyDialog:
      byId("logSheetHistoryDialog"),
    historyList:
      byId("logSheetHistoryList"),
    historyCloseButton:
      byId("logSheetHistoryCloseButton")
  };

  function normalizeText(
    value
  ) {
    return String(
      value ?? ""
    ).trim();
  }

  function todayIsoDate() {
    const now =
      new Date();

    const localDate =
      new Date(
        now.getTime() -
        now.getTimezoneOffset() *
          60000
      );

    return localDate
      .toISOString()
      .slice(0, 10);
  }

  function cloneObject(
    value
  ) {
    return JSON.parse(
      JSON.stringify(
        value || {}
      )
    );
  }

  async function verifyTemplateHash(
    buffer,
    expectedHash
  ) {
    const normalizedExpected =
      normalizeText(
        expectedHash
      ).toLowerCase();

    if (
      !normalizedExpected ||
      !globalThis.crypto?.subtle
    ) {
      return;
    }

    const digest =
      await globalThis.crypto.subtle.digest(
        "SHA-256",
        buffer
      );

    const actualHash = [
      ...new Uint8Array(
        digest
      )
    ].map(
      byte => byte
        .toString(16)
        .padStart(2, "0")
    ).join("");

    if (
      actualHash !==
        normalizedExpected
    ) {
      throw new Error(
        "원본 엑셀 양식의 버전이 일치하지 않습니다. 새로고침 후 다시 시도해 주세요."
      );
    }
  }

  function stableJson(
    value
  ) {
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(
          value || {}
        ).sort(
          ([left], [right]) =>
            left.localeCompare(
              right
            )
        )
      )
    );
  }

  function formatDateTemplate(
    template,
    isoDate
  ) {
    const parsed =
      new Date(
        `${isoDate}T00:00:00`
      );

    if (
      Number.isNaN(
        parsed.getTime()
      )
    ) {
      return isoDate;
    }

    const weekdays = [
      "일",
      "월",
      "화",
      "수",
      "목",
      "금",
      "토"
    ];

    const replacements = {
      "{yyyy}":
        String(
          parsed.getFullYear()
        ),
      "{MM}":
        String(
          parsed.getMonth() + 1
        ).padStart(2, "0"),
      "{dd}":
        String(
          parsed.getDate()
        ).padStart(2, "0"),
      "{weekday}":
        weekdays[
          parsed.getDay()
        ]
    };

    return Object.entries(
      replacements
    ).reduce(
      (
        result,
        [token, replacement]
      ) => result.replaceAll(
        token,
        replacement
      ),
      template || isoDate
    );
  }

  function getStoredUser() {
    try {
      const saved =
        localStorage.getItem(
          CURRENT_USER_STORAGE_KEY
        );

      return saved
        ? JSON.parse(saved)
        : null;

    } catch (
      error
    ) {
      console.warn(
        "로그인 정보 확인 실패:",
        error
      );

      return null;
    }
  }

  function getSessionToken() {
    const user =
      getStoredUser();

    return normalizeText(
      user?.sessionToken ||
      user?.session_token
    );
  }

  async function requestApi(
    url,
    options = {}
  ) {
    const token =
      getSessionToken();

    if (!token) {
      throw new Error(
        "로그인 정보가 없습니다. 업무일지에서 다시 로그인해 주세요."
      );
    }

    const response =
      await fetch(
        url,
        {
          ...options,
          cache: "no-store",
          headers: {
            Accept:
              "application/json",
            ...(
              options.headers ||
              {}
            ),
            Authorization:
              `Bearer ${token}`
          }
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
      payload?.ok === false
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

    return payload || {
      ok: true
    };
  }

  function setStatus(
    badge,
    message,
    tone = "idle"
  ) {
    elements.stateBadge.textContent =
      badge;

    elements.stateBadge.className =
      `log-sheet-state__badge is-${tone}`;

    elements.stateText.textContent =
      message;
  }

  function setBusy(
    busy,
    message = ""
  ) {
    state.isBusy =
      Boolean(busy);

    [
      elements.loadButton,
      elements.saveButton,
      elements.historyButton,
      elements.previewButton,
      elements.downloadButton,
      elements.printButton,
      elements.loggingInterval,
      elements.loggingStartHour
    ].forEach(
      button => {
        if (button) {
          button.disabled =
            state.isBusy;
        }
      }
    );

    if (message) {
      setStatus(
        "처리 중",
        message,
        "loading"
      );
    }
  }

  function setDirty(
    dirty
  ) {
    state.isDirty =
      Boolean(dirty);

    if (state.isDirty) {
      setStatus(
        "수정 중",
        "변경된 값이 있습니다. 저장 버튼을 눌러 한 번에 저장하세요.",
        "dirty"
      );

    } else if (
      state.record
    ) {
      setStatus(
        "저장됨",
        "공용 저장자료를 불러왔습니다.",
        "saved"
      );

    } else {
      setStatus(
        "새 문서",
        "저장된 자료가 없습니다. 값을 입력한 뒤 저장하세요.",
        "idle"
      );
    }
  }

  function updateRevisionText() {
    if (
      !state.record
    ) {
      elements.revisionText.textContent =
        "저장 기록 없음";

      return;
    }

    const editor =
      normalizeText(
        state.record.updatedByName
      ) ||
      normalizeText(
        state.record.updatedById
      ) ||
      "작성자";

    const revision =
      Number(
        state.record.revision
      ) || 1;

    elements.revisionText.textContent =
      `v${revision} · ${editor} · ${formatTimestamp(
        state.record.updatedAt
      )}`;
  }

  function formatTimestamp(
    value
  ) {
    const parsed =
      new Date(value || "");

    if (
      Number.isNaN(
        parsed.getTime()
      )
    ) {
      return "시간 확인 불가";
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
    ).format(parsed);
  }

  function parseRange(
    rangeText
  ) {
    const normalized =
      normalizeText(
        rangeText
      )
        .replaceAll("$", "")
        .split("!")
        .pop();

    return XLSX.utils.decode_range(
      normalized
    );
  }

  function expandRanges(
    ranges
  ) {
    const addresses =
      new Set();

    (ranges || []).forEach(
      rangeText => {
        const range =
          parseRange(
            rangeText
          );

        for (
          let row = range.s.r;
          row <= range.e.r;
          row += 1
        ) {
          for (
            let column = range.s.c;
            column <= range.e.c;
            column += 1
          ) {
            addresses.add(
              XLSX.utils.encode_cell({
                r: row,
                c: column
              })
            );
          }
        }
      }
    );

    return addresses;
  }

  function getEditableAddresses(
    sheetConfig
  ) {
    const addresses =
      expandRanges(
        sheetConfig.editableRanges
      );

    (
      sheetConfig.editableCells ||
      []
    ).forEach(
      address => addresses.add(
        address.replaceAll(
          "$",
          ""
        ).toUpperCase()
      )
    );

    return addresses;
  }

  function getChoiceOptions(
    sheetConfig,
    address
  ) {
    for (
      const choice of
      sheetConfig.choiceRanges ||
      []
    ) {
      const addresses =
        expandRanges(
          choice.ranges
        );

      if (
        addresses.has(address)
      ) {
        return choice.options || [];
      }
    }

    for (
      const header of
      Object.values(
        sheetConfig.headerCells ||
        {}
      )
    ) {
      if (
        header.address === address &&
        Array.isArray(
          header.options
        )
      ) {
        return header.options;
      }
    }

    return [];
  }


  /* =========================================================
    Log Sheet 로깅 시간 주기

    Phase 1:
    - 통합 TGO / BCO1 / BCO2
    - 2 / 3 / 4 / 6시간
    - 기존 12개 물리 열(J:U)을 주기별 슬롯으로 재분할
  ========================================================= */

  function getLoggingScheduleConfig() {
    const schedule =
      state.sheetConfig?.loggingSchedule;

    if (
      !schedule ||
      typeof schedule !==
        "object"
    ) {
      return null;
    }

    return schedule;
  }


  function getSupportedLoggingIntervals() {
    const schedule =
      getLoggingScheduleConfig();

    if (!schedule) {
      return [];
    }

    return (
      Array.isArray(
        schedule.supportedIntervals
      )
        ? schedule.supportedIntervals
        : []
    )
      .map(
        value =>
          Number(value)
      )
      .filter(
        value =>
          Number.isInteger(
            value
          ) &&
          value >
            0 &&
          24 %
            value ===
            0
      );
  }


  function getLoggingIntervalHours() {
    const schedule =
      getLoggingScheduleConfig();

    if (!schedule) {
      return 0;
    }

    const supported =
      getSupportedLoggingIntervals();

    const current =
      Number(
        state.loggingIntervalHours
      );

    if (
      supported.includes(
        current
      )
    ) {
      return current;
    }

    const fallback =
      Number(
        schedule.defaultIntervalHours
      );

    return supported.includes(
      fallback
    )
      ? fallback
      : (
          supported[0] ||
          0
        );
  }



  function getLoggingStartHour() {
    const schedule =
      getLoggingScheduleConfig();

    if (!schedule) {
      return 0;
    }

    const current =
      Number(
        state.loggingStartHour
      );

    if (
      Number.isInteger(
        current
      ) &&
      current >=
        0 &&
      current <=
        23
    ) {
      return current;
    }

    const fallback =
      Number(
        schedule.startHour
      );

    return (
      Number.isInteger(
        fallback
      ) &&
      fallback >=
        0 &&
      fallback <=
        23
    )
      ? fallback
      : 0;
  }


  function renderLoggingStartControl() {
    const field =
      elements.loggingStartField;

    const select =
      elements.loggingStartHour;

    const schedule =
      getLoggingScheduleConfig();

    if (
      !field ||
      !select
    ) {
      return;
    }

    if (!schedule) {
      field.hidden =
        true;

      select.replaceChildren();

      return;
    }

    const fragment =
      document.createDocumentFragment();

    for (
      let hour = 0;
      hour <= 23;
      hour += 1
    ) {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        String(hour);

      option.textContent =
        String(hour)
          .padStart(
            2,
            "0"
          ) +
        "시";

      fragment.appendChild(
        option
      );
    }

    select.replaceChildren(
      fragment
    );

    select.value =
      String(
        getLoggingStartHour()
      );

    field.hidden =
      false;
  }


  function renderLoggingIntervalControl() {
    const field =
      elements.loggingIntervalField;

    const select =
      elements.loggingInterval;

    if (
      !field ||
      !select
    ) {
      return;
    }

    const schedule =
      getLoggingScheduleConfig();

    const supported =
      getSupportedLoggingIntervals();

    if (
      !schedule ||
      !supported.length
    ) {
      field.hidden =
        true;

      select.replaceChildren();

      renderLoggingStartControl();


      return;
    }

    const current =
      getLoggingIntervalHours();

    const fragment =
      document.createDocumentFragment();

    supported.forEach(
      interval => {
        const option =
          document.createElement(
            "option"
          );

        option.value =
          String(interval);

        option.textContent =
          String(interval) +
          "시간";

        fragment.appendChild(
          option
        );
      }
    );

    select.replaceChildren(
      fragment
    );

    select.value =
      String(current);

    field.hidden =
      false;

    renderLoggingStartControl();
  }


  function resetLoggingIntervalForCurrentSheet() {
    const schedule =
      getLoggingScheduleConfig();

    state.loggingIntervalHours =
      schedule
        ? Number(
            schedule.defaultIntervalHours
          ) || 0
        : 0;

    state.loggingStartHour =
      schedule
        ? Number(
            schedule.startHour
          ) || 0
        : 0;

    renderLoggingIntervalControl();
  }


  function applyLoggingIntervalSetting(
    settings
  ) {
    const schedule =
      getLoggingScheduleConfig();

    if (!schedule) {
      state.loggingIntervalHours =
        0;

      renderLoggingIntervalControl();

      return;
    }

    const supported =
      getSupportedLoggingIntervals();

    const requested =
      Number(
        settings?.loggingIntervalHours
      );

    const fallback =
      Number(
        schedule.defaultIntervalHours
      );

    state.loggingIntervalHours =
      supported.includes(
        requested
      )
        ? requested
        : (
            supported.includes(
              fallback
            )
              ? fallback
              : (
                  supported[0] ||
                  0
                )
          );



    const requestedStartHour =
      Number(
        settings?.loggingStartHour
      );

    const fallbackStartHour =
      Number(
        schedule.startHour
      );

    state.loggingStartHour =
      Number.isInteger(
        requestedStartHour
      ) &&
      requestedStartHour >=
        0 &&
      requestedStartHour <=
        23
        ? requestedStartHour
        : (
            Number.isInteger(
              fallbackStartHour
            ) &&
            fallbackStartHour >=
              0 &&
            fallbackStartHour <=
              23
              ? fallbackStartHour
              : 0
          );

    renderLoggingIntervalControl();
  }


  function formatLoggingHour(
    rawHour
  ) {
    const normalized =
      (
        (
          Number(rawHour) %
          24
        ) +
        24
      ) %
      24;

    if (
      Number(rawHour) >
        0 &&
      normalized ===
        0
    ) {
      return "24";
    }

    return String(
      normalized
    ).padStart(
      2,
      "0"
    );
  }


  function getLoggingTimeGroups() {
    const schedule =
      getLoggingScheduleConfig();

    const interval =
      getLoggingIntervalHours();

    if (
      !schedule ||
      !interval
    ) {
      return [];
    }

    const startColumn =
      XLSX.utils.decode_col(
        schedule.startColumn
      );

    const endColumn =
      XLSX.utils.decode_col(
        schedule.endColumn
      );

    const totalColumns =
      endColumn -
      startColumn +
      1;

    const slotCount =
      24 /
      interval;

    if (
      !Number.isInteger(
        slotCount
      ) ||
      slotCount >
        totalColumns
    ) {
      return [];
    }

    const startHour =
      getLoggingStartHour();

    const groups =
      [];

    for (
      let index = 0;
      index < slotCount;
      index += 1
    ) {
      const groupStart =
        startColumn +
        Math.floor(
          index *
          totalColumns /
          slotCount
        );

      const groupEnd =
        startColumn +
        Math.floor(
          (
            index +
            1
          ) *
          totalColumns /
          slotCount
        ) -
        1;

      groups.push({
        index,

        startColumn:
          groupStart,

        endColumn:
          Math.max(
            groupStart,
            groupEnd
          ),

        label:
          formatLoggingHour(
            startHour +
            index *
            interval
          )
      });
    }

    return groups;
  }



  function getOriginalLoggingColumnWidthPx(
    sheet,
    column
  ) {
    const columnInfo =
      sheet?.["!cols"]?.[
        column
      ];

    let widthPx =
      Number(
        columnInfo?.wpx
      );

    if (
      !Number.isFinite(
        widthPx
      ) ||
      widthPx <=
        0
    ) {
      const widthChars =
        Number(
          columnInfo?.wch
        );

      widthPx =
        Number.isFinite(
          widthChars
        ) &&
        widthChars >
          0
          ? widthChars *
              7.2 +
            5
          : 54;
    }

    return Math.max(
      6,
      widthPx
    );
  }


  function getOriginalLoggingColumnWidthChars(
    sheet,
    column
  ) {
    const columnInfo =
      sheet?.["!cols"]?.[
        column
      ];

    const widthChars =
      Number(
        columnInfo?.wch
      );

    if (
      Number.isFinite(
        widthChars
      ) &&
      widthChars >
        0
    ) {
      return widthChars;
    }

    const widthPx =
      Number(
        columnInfo?.wpx
      );

    if (
      Number.isFinite(
        widthPx
      ) &&
      widthPx >
        5
    ) {
      return Math.max(
        0.5,
        (
          widthPx -
          5
        ) /
        7.2
      );
    }

    return 7;
  }


  function getEqualizedLoggingColumnWidth(
    sheet,
    column,
    unit
  ) {
    const schedule =
      getLoggingScheduleConfig();

    const groups =
      getLoggingTimeGroups();

    if (
      !schedule ||
      !groups.length
    ) {
      return null;
    }

    const startColumn =
      XLSX.utils.decode_col(
        schedule.startColumn
      );

    const endColumn =
      XLSX.utils.decode_col(
        schedule.endColumn
      );

    if (
      column <
        startColumn ||
      column >
        endColumn
    ) {
      return null;
    }

    const totalColumns =
      endColumn -
      startColumn +
      1;

    /*
      2시간 = 12칸 = 원본 12열 그대로이므로
      원본 열 폭을 건드리지 않는다.
    */
    if (
      groups.length ===
        totalColumns
    ) {
      return null;
    }

    const widthReader =
      unit ===
        "chars"
        ? getOriginalLoggingColumnWidthChars
        : getOriginalLoggingColumnWidthPx;

    let totalWidth =
      0;

    for (
      let sourceColumn =
        startColumn;
      sourceColumn <=
        endColumn;
      sourceColumn +=
        1
    ) {
      totalWidth +=
        widthReader(
          sheet,
          sourceColumn
        );
    }

    const targetSlotWidth =
      totalWidth /
      groups.length;

    const group =
      groups.find(
        item =>
          column >=
            item.startColumn &&
          column <=
            item.endColumn
      );

    if (!group) {
      return null;
    }

    const physicalColumnCount =
      group.endColumn -
      group.startColumn +
      1;

    return (
      targetSlotWidth /
      physicalColumnCount
    );
  }


  function getLoggingScheduleRows() {
    const schedule =
      getLoggingScheduleConfig();

    const rows =
      new Set();

    if (!schedule) {
      return rows;
    }

    (
      schedule.headerRows ||
      []
    ).forEach(
      rowNumber => {
        const numeric =
          Number(rowNumber);

        if (
          Number.isInteger(
            numeric
          ) &&
          numeric >
            0
        ) {
          rows.add(
            numeric -
            1
          );
        }
      }
    );

    (
      schedule.dataRanges ||
      []
    ).forEach(
      rangeText => {
        const range =
          parseRange(
            rangeText
          );

        for (
          let row =
            range.s.r;
          row <=
            range.e.r;
          row +=
            1
        ) {
          rows.add(
            row
          );
        }
      }
    );

    return rows;
  }


  function applyLoggingScheduleToMergeMaps(
    anchorMap,
    slaveAddresses
  ) {
    const rows =
      getLoggingScheduleRows();

    const groups =
      getLoggingTimeGroups();

    if (
      !rows.size ||
      !groups.length
    ) {
      return;
    }

    rows.forEach(
      row => {
        groups.forEach(
          group => {
            if (
              group.endColumn <=
                group.startColumn
            ) {
              return;
            }

            const merge = {
              s: {
                r:
                  row,

                c:
                  group.startColumn
              },

              e: {
                r:
                  row,

                c:
                  group.endColumn
              }
            };

            const anchor =
              XLSX.utils.encode_cell(
                merge.s
              );

            anchorMap.set(
              anchor,
              merge
            );

            for (
              let column =
                group.startColumn +
                1;
              column <=
                group.endColumn;
              column +=
                1
            ) {
              slaveAddresses.add(
                XLSX.utils.encode_cell({
                  r:
                    row,

                  c:
                    column
                })
              );
            }
          }
        );
      }
    );
  }


  function getLoggingScheduleHeaderValue(
    address
  ) {
    const schedule =
      getLoggingScheduleConfig();

    if (!schedule) {
      return null;
    }

    const cell =
      XLSX.utils.decode_cell(
        address
      );

    const isHeaderRow =
      (
        schedule.headerRows ||
        []
      ).some(
        rowNumber =>
          Number(
            rowNumber
          ) -
            1 ===
          cell.r
      );

    if (!isHeaderRow) {
      return null;
    }

    const group =
      getLoggingTimeGroups()
        .find(
          item =>
            item.startColumn ===
            cell.c
        );

    return group
      ? group.label
      : null;
  }


  function handleLoggingIntervalChange() {
    const schedule =
      getLoggingScheduleConfig();

    if (
      !schedule ||
      !elements.loggingInterval
    ) {
      return;
    }

    const previous =
      getLoggingIntervalHours();

    const next =
      Number(
        elements.loggingInterval.value
      );

    if (
      !getSupportedLoggingIntervals()
        .includes(
          next
        )
    ) {
      elements.loggingInterval.value =
        String(previous);

      return;
    }

    if (
      next ===
        previous
    ) {
      return;
    }

    if (
      state.record &&
      !window.confirm(
        "현재 저장된 Log Sheet는 작성 당시 로깅 주기로 유지됩니다.\n\n" +
        "지금 변경한 주기는 '양식 저장' 후 새로 작성되는 Log Sheet부터 적용됩니다.\n" +
        "현재 화면에서는 새 양식을 미리 확인할 수 있습니다.\n\n" +
        "계속할까요?"
      )
    ) {
      elements.loggingInterval.value =
        String(previous);

      return;
    }

    state.loggingIntervalHours =
      next;

    renderLoggingIntervalControl();

    renderGridIfPreviewVisible();

    setStatus(
      "양식 수정",
      "로깅 주기를 " +
      next +
      "시간으로 변경했습니다. 공용 적용은 '양식 저장'을 눌러 완료하세요.",
      "dirty"
    );
  }


  function handleLoggingStartHourChange() {
    const schedule =
      getLoggingScheduleConfig();

    if (
      !schedule ||
      !elements.loggingStartHour
    ) {
      return;
    }

    const previous =
      getLoggingStartHour();

    const next =
      Number(
        elements.loggingStartHour.value
      );

    if (
      !Number.isInteger(
        next
      ) ||
      next <
        0 ||
      next >
        23
    ) {
      elements.loggingStartHour.value =
        String(previous);

      return;
    }

    if (
      next ===
        previous
    ) {
      return;
    }

    if (
      state.record &&
      !window.confirm(
        "현재 저장된 Log Sheet는 작성 당시 로깅 시간으로 유지됩니다.\n\n" +
        "지금 변경한 시작 시간은 '양식 저장' 후 새로 작성되는 Log Sheet부터 적용됩니다.\n" +
        "현재 화면에서는 새 양식을 미리 확인할 수 있습니다.\n\n" +
        "계속할까요?"
      )
    ) {
      elements.loggingStartHour.value =
        String(previous);

      return;
    }

    state.loggingStartHour =
      next;

    renderLoggingIntervalControl();

    renderGridIfPreviewVisible();

    setStatus(
      "양식 수정",
      "로깅 시작 시간을 " +
      String(next)
        .padStart(
          2,
          "0"
        ) +
      "시로 변경했습니다. 공용 적용은 '양식 저장'을 눌러 완료하세요.",
      "dirty"
    );
  }


  function getMergeAnchorMap(
    sheet
  ) {
    const slaveAddresses =
      new Set();

    const anchorMap =
      new Map();

    (sheet["!merges"] || []).forEach(
      merge => {
        const anchor =
          XLSX.utils.encode_cell(
            merge.s
          );

        anchorMap.set(
          anchor,
          merge
        );

        for (
          let row = merge.s.r;
          row <= merge.e.r;
          row += 1
        ) {
          for (
            let column = merge.s.c;
            column <= merge.e.c;
            column += 1
          ) {
            const address =
              XLSX.utils.encode_cell({
                r: row,
                c: column
              });

            if (
              address !== anchor
            ) {
              slaveAddresses.add(
                address
              );
            }
          }
        }
      }
    );

    return {
      anchorMap,
      slaveAddresses
    };
  }

  function getCellDisplayValue(
    sheet,
    address
  ) {
    if (
      Object.prototype.hasOwnProperty.call(
        state.values,
        address
      )
    ) {
      return String(
        state.values[address] ?? ""
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        state.generatedValues,
        address
      )
    ) {
      return String(
        state.generatedValues[address] ?? ""
      );
    }

    const cell =
      sheet[address];

    if (!cell) {
      return "";
    }

    return String(
      XLSX.utils.format_cell(
        cell
      ) ?? ""
    );
  }

  function colorToCss(
    color
  ) {
    const rgb =
      normalizeText(
        color?.rgb
      ).replace(/^FF/i, "");

    return /^[0-9A-F]{6}$/i.test(
      rgb
    )
      ? `#${rgb}`
      : "";
  }

function applyCellStyle(
  tableCell,
  workbookCell
) {
  const style =
    workbookCell?.s;


  if (
    !style ||
    typeof style !==
      "object"
  ) {
    return;
  }


  /* =====================================================
    배경색
  ====================================================== */

  const fillColor =
    colorToCss(
      style.fill?.fgColor
    );


  if (
    fillColor
  ) {
    tableCell.style
      .backgroundColor =
      fillColor;
  }


  /* =====================================================
    글꼴
  ====================================================== */

  const fontColor =
    colorToCss(
      style.font?.color
    );


  if (
    fontColor
  ) {
    tableCell.style.color =
      fontColor;
  }


  if (
    style.font?.bold
  ) {
    tableCell.style
      .fontWeight =
      "700";
  }


  if (
    style.font?.italic
  ) {
    tableCell.style
      .fontStyle =
      "italic";
  }


  const fontSizePt =
    Number(
      style.font?.sz
    );


  if (
    Number.isFinite(
      fontSizePt
    ) &&
    fontSizePt >
      0
  ) {
    /*
      Excel font size는 pt 단위.

      브라우저 px 변환:
      1pt = 96 / 72px
    */
    const fontSizePx =
      fontSizePt *
      96 /
      72;


    tableCell.style
      .fontSize =
      `${fontSizePx}px`;


    /*
      print CSS에서 사용할
      원본 Excel 글자크기도 기억한다.
    */
    tableCell.style
      .setProperty(
        "--excel-font-size",
        `${fontSizePx}px`
      );
  }


  const fontName =
    normalizeText(
      style.font?.name
    );


  if (
    fontName
  ) {
    tableCell.style
      .fontFamily =
      `"${fontName}", "Malgun Gothic", sans-serif`;
  }


  /* =====================================================
    정렬
  ====================================================== */

  const horizontal =
    normalizeText(
      style.alignment
        ?.horizontal
    );


  if (
    [
      "left",
      "center",
      "right"
    ].includes(
      horizontal
    )
  ) {
    tableCell.style
      .textAlign =
      horizontal;
  }


  const vertical =
    normalizeText(
      style.alignment
        ?.vertical
    );


  if (
    [
      "top",
      "middle",
      "bottom"
    ].includes(
      vertical
    )
  ) {
    tableCell.style
      .verticalAlign =
      vertical;
  }


  if (
    style.alignment
      ?.wrapText ===
      true
  ) {
    tableCell.style
      .whiteSpace =
      "pre-wrap";
  }


  /* =====================================================
    Excel 테두리

    PDF 원본처럼:
    - 실선
    - 점선
    - 파선
    - 굵은선

    을 최대한 그대로 표현한다.
  ====================================================== */

  const convertBorderStyle =
    border => {
      const borderStyle =
        normalizeText(
          border?.style
        );


      const borderColor =
        colorToCss(
          border?.color
        ) ||
        "#000000";


      if (
        !borderStyle
      ) {
        return "";
      }


      switch (
        borderStyle
      ) {
        case "hair":
        case "dotted":
          return (
            `1px dotted ${borderColor}`
          );


        case "dashDot":
        case "dashDotDot":
        case "dashed":
          return (
            `1px dashed ${borderColor}`
          );


        case "medium":
        case "mediumDashed":
        case "mediumDashDot":
        case "mediumDashDotDot":
          return (
            `2px solid ${borderColor}`
          );


        case "thick":
          return (
            `3px solid ${borderColor}`
          );


        case "double":
          return (
            `3px double ${borderColor}`
          );


        default:
          return (
            `1px solid ${borderColor}`
          );
      }
    };


  const borders = {
    top:
      convertBorderStyle(
        style.border?.top
      ),

    right:
      convertBorderStyle(
        style.border?.right
      ),

    bottom:
      convertBorderStyle(
        style.border?.bottom
      ),

    left:
      convertBorderStyle(
        style.border?.left
      )
  };


  if (
    borders.top
  ) {
    tableCell.style
      .borderTop =
      borders.top;
  }


  if (
    borders.right
  ) {
    tableCell.style
      .borderRight =
      borders.right;
  }


  if (
    borders.bottom
  ) {
    tableCell.style
      .borderBottom =
      borders.bottom;
  }


  if (
    borders.left
  ) {
    tableCell.style
      .borderLeft =
      borders.left;
  }
}

  function createEditorControl(
    sheet,
    sheetConfig,
    address
  ) {
    const options =
      getChoiceOptions(
        sheetConfig,
        address
      );

    const value =
      getCellDisplayValue(
        sheet,
        address
      );

    let control;

    if (options.length) {
      control =
        document.createElement(
          "select"
        );

      const blankOption =
        document.createElement(
          "option"
        );

      blankOption.value =
        "";

      blankOption.textContent =
        "-";

      control.appendChild(
        blankOption
      );

      options.forEach(
        optionValue => {
          const option =
            document.createElement(
              "option"
            );

          option.value =
            String(optionValue);

          option.textContent =
            String(optionValue);

          control.appendChild(
            option
          );
        }
      );

      control.value =
        value;

    } else {
      control =
        document.createElement(
          "textarea"
        );

      control.rows =
        1;

      control.value =
        value;
    }

    control.className =
      "log-sheet-cell-editor";

    control.dataset.cellAddress =
      address;

    control.setAttribute(
      "aria-label",
      `${address} 입력`
    );

    control.addEventListener(
      "input",
      () => {
        state.values[address] =
          control.value;

        const printValue =
          control.parentElement
            ?.querySelector(
              ".log-sheet-cell-print-value"
            );

        if (printValue) {
          printValue.textContent =
            control.value;
        }

        control.closest("td")
          ?.classList.add(
            "is-changed"
          );

        if (
          state.sheetConfig.key ===
            "electrical-patrol" &&
          address === "P2"
        ) {
          state.generatedValues =
            createGeneratedSnapshot();

          renderGridIfPreviewVisible();
        }

        updateDirtyState();
      }
    );

    return control;
  }

  /* =========================================================
    Logging 항목 목록
  ========================================================= */

  function normalizeLoggingText(
    value
  ) {
    return normalizeText(
      value
    ).replace(
      /\s+/g,
      " "
    );
  }

  function getTemplateCellText(
    sheet,
    address
  ) {
    const target =
      XLSX.utils.decode_cell(
        address
      );

    const merge =
      (sheet["!merges"] || []).find(
        item =>
          target.r >= item.s.r &&
          target.r <= item.e.r &&
          target.c >= item.s.c &&
          target.c <= item.e.c
      );

    const anchorAddress =
      merge
        ? XLSX.utils.encode_cell(
            merge.s
          )
        : address;

    const cell =
      sheet[anchorAddress];

    if (!cell) {
      return "";
    }

    return normalizeLoggingText(
      XLSX.utils.format_cell(
        cell
      ) ??
      cell.v ??
      ""
    );
  }

  /* =========================================================
    Logging 양식 셀 상세정보

    기존 getTemplateCellText()는
    병합셀의 표시값만 반환한다.

    새 편집기는 아래 정보까지 필요하다.
    - 실제 셀 주소
    - 병합 anchor
    - 병합 시작/끝 행
    - rowspan / colspan
  ========================================================= */

  function getTemplateCellDescriptor(
    sheet,
    address
  ) {
    const target =
      XLSX.utils.decode_cell(
        address
      );


    const merge =
      (
        sheet["!merges"] ||
        []
      ).find(
        item =>
          target.r >=
            item.s.r &&
          target.r <=
            item.e.r &&
          target.c >=
            item.s.c &&
          target.c <=
            item.e.c
      ) ||
      null;


    const anchor =
      merge
        ? merge.s
        : target;


    const anchorAddress =
      XLSX.utils.encode_cell(
        anchor
      );


    const cell =
      sheet[
        anchorAddress
      ];


    const text =
      cell
        ? normalizeLoggingText(
            XLSX.utils.format_cell(
              cell
            ) ??
            cell.v ??
            ""
          )
        : "";


    const columnName =
      String(
        address
      )
        .match(
          /^[A-Z]+/i
        )?.[0]
        ?.toUpperCase() ||
      "";


    return {
      address,

      anchorAddress,

      column:
        columnName,

      row:
        target.r +
        1,

      text,

      isMerged:
        Boolean(
          merge
        ),

      isMergeAnchor:
        Boolean(
          merge &&
          anchorAddress ===
            address
        ),

      merge:
        merge
          ? {
              anchorAddress,

              startRow:
                merge.s.r +
                1,

              endRow:
                merge.e.r +
                1,

              startColumn:
                merge.s.c,

              endColumn:
                merge.e.c,

              rowSpan:
                merge.e.r -
                merge.s.r +
                1,

              colSpan:
                merge.e.c -
                merge.s.c +
                1
            }
          : null
    };
  }

  function getLoggingItemSections(
    sheetConfig
  ) {
    const standardSection = {
      ranges:
        sheetConfig.editableRanges || [],
      nameColumns: [
        "B",
        "C",
        "D",
        "E",
        "F"
      ],
      tagColumn: "G",
      ratingColumn: "H",
      unitColumn: "I"
    };

    switch (
      sheetConfig.key
    ) {
      case "field-night-leader-to":
        return [
          {
            ...standardSection,
            ranges: [
              "J7:M35",
              "J37:M69",
              "J71:M105"
            ]
          },
          {
            ranges: [
              "G108:G112"
            ],
            nameColumns: [
              "D",
              "E",
              "F"
            ]
          },
          {
            ranges: [
              "K108:K112"
            ],
            nameColumns: [
              "H",
              "I",
              "J"
            ]
          },
          {
            ranges: [
              "M108:M112"
            ],
            nameColumns: [
              "L"
            ]
          }
        ];

      case "field-night-bo12":
        return [
          {
            ...standardSection,
            ranges: [
              "J7:Q34"
            ]
          },
          {
            ranges: [
              "J36:K40"
            ],
            nameColumns: [
              "D",
              "E",
              "F"
            ]
          },
          {
            ranges: [
              "P36:Q40"
            ],
            nameColumns: [
              "L",
              "M",
              "N",
              "O"
            ]
          },
          {
            ...standardSection,
            ranges: [
              "J42:Q68"
            ]
          },
          {
            ranges: [
              "H70:H77"
            ],
            nameColumns: [
              "D",
              "E",
              "F"
            ],
            tagColumn: "G"
          },
          {
            ranges: [
              "O70:O77"
            ],
            nameColumns: [
              "L",
              "M"
            ],
            tagColumn: "N"
          },
          {
            ...standardSection,
            ranges: [
              "J79:Q118"
            ]
          }
        ];

      case "electrical-main":
        return [
          {
            ranges:
              sheetConfig.editableRanges || [],
            nameColumns: [
              "B",
              "C",
              "D",
              "E",
              "F"
            ],
            unitColumn: "I"
          }
        ];

      case "electrical-patrol":
        return [
          {
            ranges: [
              "G6:H28"
            ],
            nameColumns: [
              "F"
            ]
          }
        ];

      case "aux-control-room":
        return [
          {
            ranges:
              sheetConfig.editableRanges || [],
            nameColumns: [
              "A",
              "B",
              "C"
            ],
            tagColumn: "D",
            unitColumn: "E"
          }
        ];

      case "aux-field":
        return [
          {
            ranges: [
              "G8:N46"
            ],
            nameColumns: [
              "A",
              "B"
            ],
            tagColumn: "C",
            unitColumn: "D"
          },
          {
            ranges: [
              "P9:R46"
            ],
            nameColumns: [
              "O"
            ]
          }
        ];

      default:
        return [
          standardSection
        ];
    }
  }
  function extractLoggingItems() {
    const sheet =
      state.workbook?.Sheets?.[
        state.sheetConfig
          .sheetName
      ];


    if (!sheet) {
      return [];
    }


    const items = [];


    getLoggingItemSections(
      state.sheetConfig
    ).forEach(
      section => {
        const rowNumbers =
          new Set();


        const sourceColumn =
          Math.min(
            ...(
              section.ranges ||
              []
            ).map(
              rangeText =>
                parseRange(
                  rangeText
                ).s.c
            )
          );


        (
          section.ranges ||
          []
        ).forEach(
          rangeText => {
            const range =
              parseRange(
                rangeText
              );


            for (
              let row =
                range.s.r;

              row <=
                range.e.r;

              row +=
                1
            ) {
              rowNumbers.add(
                row +
                1
              );
            }
          }
        );


        [
          ...rowNumbers
        ]
          .sort(
            (
              left,
              right
            ) =>
              left -
              right
          )
          .forEach(
            rowNumber => {
              /*
                ===========================================
                ITEM 계층 셀 읽기

                예:
                Generator / Stator Current Average

                TBN / HP / Casing Temp
                ===========================================
              */

              const seenNameTexts =
                new Set();


              const nameCells =
                (
                  section.nameColumns ||
                  []
                )
                  .map(
                    column =>
                      getTemplateCellDescriptor(
                        sheet,
                        `${column}${rowNumber}`
                      )
                  )
                  .filter(
                    descriptor => {
                      if (
                        !descriptor.text ||
                        seenNameTexts.has(
                          descriptor.text
                        )
                      ) {
                        return false;
                      }


                      seenNameTexts.add(
                        descriptor.text
                      );


                      return true;
                    }
                  );


              if (
                !nameCells.length
              ) {
                return;
              }


              const pathParts =
                nameCells.map(
                  descriptor =>
                    descriptor.text
                );


              /*
                마지막 이름은 실제 Logging 항목명.

                그 앞쪽은 계층정보로 본다.
              */

              const itemCell =
                nameCells[
                  nameCells.length -
                  1
                ];


              const parentCells =
                nameCells.slice(
                  0,
                  -1
                );


              const groupCell =
                parentCells[0] ||
                null;


              const subgroupCells =
                parentCells.slice(
                  1
                );


              const group =
                groupCell
                  ?.text ||
                "";


              const subgroupParts =
                subgroupCells.map(
                  descriptor =>
                    descriptor.text
                );


              const subgroup =
                subgroupParts.join(
                  " · "
                );


              const itemName =
                itemCell.text;


              /*
                ===========================================
                TAG / RATING / UNIT
                ===========================================
              */

              const tagCell =
                section.tagColumn
                  ? getTemplateCellDescriptor(
                      sheet,
                      `${section.tagColumn}${rowNumber}`
                    )
                  : null;


              const ratingCell =
                section.ratingColumn
                  ? getTemplateCellDescriptor(
                      sheet,
                      `${section.ratingColumn}${rowNumber}`
                    )
                  : null;


              const unitCell =
                section.unitColumn
                  ? getTemplateCellDescriptor(
                      sheet,
                      `${section.unitColumn}${rowNumber}`
                    )
                  : null;


              /*
                기존 코드 호환용 name.

                현재 UI가 아직
                item.name을 사용하므로 유지한다.
              */

              const name =
                pathParts.join(
                  " · "
                );


              items.push({
                /*
                  기존 필드
                */

                name,

                tag:
                  tagCell?.text ||
                  "",

                unit:
                  unitCell?.text ||
                  "",

                sourceRow:
                  rowNumber,

                sourceColumn,


                /*
                  신규 구조 필드
                */

                group,

                subgroup,

                subgroupParts,

                itemName,

                rating:
                  ratingCell?.text ||
                  "",


                /*
                  Excel 원본 위치
                */

                pathParts,

                pathCells:
                  nameCells,

                groupCell,

                subgroupCells,

                itemCell,

                tagCell,

                ratingCell,

                unitCell
              });
            }
          );
      }
    );


    items.sort(
      (
        left,
        right
      ) =>
        left.sourceRow -
          right.sourceRow ||
        left.sourceColumn -
          right.sourceColumn
    );


    return items.map(
      (
        item,
        index
      ) => ({
        ...item,

        order:
          index +
          1
      })
    );
  }

const loggingItemDrafts =
  new Map();


const loggingItemTemplateOverrides =
  new Map();


const loggingItemAddedItems =
  new Map();


let loggingItemAddedSequence =
  0;


let loggingItemEditingKey =
  "";

let loggingTemplateExpectedVersion =
  0;


/* =========================================================
  Logging 항목 임시 상태
========================================================= */

function getCurrentLoggingAddedItems() {
  const sheetKey =
    state.sheetConfig?.key ||
    "";

  if (
    !loggingItemAddedItems.has(
      sheetKey
    )
  ) {
    loggingItemAddedItems.set(
      sheetKey,
      []
    );
  }

  return loggingItemAddedItems.get(
    sheetKey
  );
}


function getLoggingItemDraftKey(
  item
) {
  if (item.draftKey) {
    return item.draftKey;
  }

  return [
    state.sheetConfig?.key || "",
    item.sourceRow,
    item.sourceColumn
  ].join(":");
}

let loggingItemSelectedKey =
  "";


/* =========================================================
  Logging 구조형 양식 저장 보조

  화면에서 병합/병합해제를 추가하기 전에도
  Excel 원본의 병합 정보를 양식 버전에 보존한다.
========================================================= */

function normalizeLoggingMergeSnapshot(
  merge,
  fallbackColumn = ""
) {
  if (
    !merge ||
    typeof merge !==
      "object"
  ) {
    return null;
  }


  const startRow =
    Number(
      merge.startRow
    );


  const endRow =
    Number(
      merge.endRow
    );


  if (
    !Number.isInteger(
      startRow
    ) ||
    !Number.isInteger(
      endRow
    ) ||
    startRow <=
      0 ||
    endRow <
      startRow
  ) {
    return null;
  }


  const column =
    normalizeLoggingText(
      merge.column ||
      fallbackColumn
    )
      .toUpperCase();


  return {
    column,

    startRow,

    endRow,

    rowSpan:
      endRow -
      startRow +
      1
  };
}


function getLoggingGroupMergeSnapshot(
  item
) {
  return (
    normalizeLoggingMergeSnapshot(
      item?.groupMerge,
      item?.groupCell?.column
    ) ||
    normalizeLoggingMergeSnapshot(
      item?.groupCell?.merge,
      item?.groupCell?.column
    )
  );
}


function getLoggingSubgroupMergeSnapshots(
  item
) {
  if (
    Array.isArray(
      item?.subgroupMerges
    )
  ) {
    return item.subgroupMerges
      .map(
        merge =>
          normalizeLoggingMergeSnapshot(
            merge,
            merge?.column
          )
      )
      .filter(Boolean);
  }


  return (
    Array.isArray(
      item?.subgroupCells
    )
      ? item.subgroupCells
          .map(
            descriptor =>
              normalizeLoggingMergeSnapshot(
                descriptor?.merge,
                descriptor?.column
              )
          )
          .filter(Boolean)
      : []
  );
}


function getLoggingSubgroupParts(
  item
) {
  if (
    Array.isArray(
      item?.subgroupParts
    )
  ) {
    return item.subgroupParts
      .map(
        value =>
          normalizeLoggingText(
            value
          )
      )
      .filter(Boolean);
  }


  const subgroup =
    normalizeLoggingText(
      item?.subgroup
    );


  return subgroup
    ? subgroup
        .split(
          /\s*·\s*/
        )
        .map(
          value =>
            normalizeLoggingText(
              value
            )
        )
        .filter(Boolean)
    : [];
}


function buildStructuredLoggingName(
  item
) {
  const group =
    normalizeLoggingText(
      item?.group
    );


  const subgroupParts =
    getLoggingSubgroupParts(
      item
    );


  const itemName =
    normalizeLoggingText(
      item?.itemName
    );


  const structuredName =
    [
      group,
      ...subgroupParts,
      itemName
    ]
      .filter(Boolean)
      .join(
        " · "
      );


  return (
    structuredName ||
    normalizeLoggingText(
      item?.name
    )
  );
}


/* =========================================================
  신규 Logging 항목
========================================================= */

function addLoggingItem() {
  if (
    !state.sheetConfig
  ) {
    return;
  }

  const items =
    buildLoggingItemList();

  if (!items.length) {
    return;
  }

  /*
    선택된 항목이 없으면
    현재 목록의 마지막 항목 아래에 추가
  */
  let insertAfterKey =
    loggingItemSelectedKey;

  if (!insertAfterKey) {
    insertAfterKey =
      getLoggingItemDraftKey(
        items[
          items.length - 1
        ]
      );
  }

  loggingItemAddedSequence +=
    1;

  const draftKey =
    [
      state.sheetConfig.key,
      "added",
      Date.now(),
      loggingItemAddedSequence
    ].join(":");

  const item = {
    draftKey,

    sourceRow: null,
    sourceColumn: null,

    group: "",
    subgroup: "",
    subgroupParts: [],
    itemName: "",

    name: "",
    tag: "",
    rating: "",
    unit: "",

    groupMerge: null,
    subgroupMerges: [],

    isNew: true,

    insertAfterKey
  };

  getCurrentLoggingAddedItems()
    .push(
      item
    );

  loggingItemSelectedKey =
    draftKey;

  loggingItemEditingKey =
    draftKey;

  renderLoggingItemList();
}

/* =========================================================
  Logging 항목 수정
========================================================= */

function beginLoggingItemEdit(
  row,
  item
) {
  const draftKey =
    getLoggingItemDraftKey(
      item
    );


  loggingItemEditingKey =
    draftKey;


  row.classList.add(
    "is-editing"
  );


  const order =
    document.createElement(
      "span"
    );

  order.className =
    "log-sheet-item-row__order";

  order.textContent =
    String(item.order);


  const nameInput =
    document.createElement(
      "input"
    );

  nameInput.type =
    "text";

  nameInput.value =
    item.name || "";

  nameInput.placeholder =
    "항목명";


  const tagInput =
    document.createElement(
      "input"
    );

  tagInput.type =
    "text";

  tagInput.value =
    item.tag || "";

  tagInput.placeholder =
    "TAG";


  const unitInput =
    document.createElement(
      "input"
    );

  unitInput.type =
    "text";

  unitInput.value =
    item.unit || "";

  unitInput.placeholder =
    "단위";


  const actions =
    document.createElement(
      "div"
    );

  actions.className =
    "log-sheet-item-row__edit-actions";


  const saveButton =
    document.createElement(
      "button"
    );

  saveButton.type =
    "button";

  saveButton.textContent =
    "저장";


  const cancelButton =
    document.createElement(
      "button"
    );

  cancelButton.type =
    "button";

  cancelButton.textContent =
    "취소";


  saveButton.addEventListener(
    "click",
    () => {
      const name =
        normalizeLoggingText(
          nameInput.value
        );


      if (!name) {
        nameInput.focus();

        return;
      }


      loggingItemDrafts.set(
        draftKey,
        {
          name,

          tag:
            normalizeLoggingText(
              tagInput.value
            ),

          unit:
            normalizeLoggingText(
              unitInput.value
            )
        }
      );


      loggingItemEditingKey =
        "";


      renderLoggingItemList();
    }
  );


  cancelButton.addEventListener(
    "click",
    () => {
      /*
        방금 만든 신규 항목에서
        아직 한 번도 저장하지 않았다면
        취소 시 목록에서도 제거한다.
      */
      if (
        item.isNew &&
        !loggingItemDrafts.has(
          draftKey
        )
      ) {
        const addedItems =
          getCurrentLoggingAddedItems();


        const index =
          addedItems.findIndex(
            addedItem =>
              addedItem.draftKey ===
              draftKey
          );


        if (
          index >= 0
        ) {
          addedItems.splice(
            index,
            1
          );
        }
      }


      loggingItemEditingKey =
        "";


      renderLoggingItemList();
    }
  );


  actions.append(
    saveButton,
    cancelButton
  );


  row.replaceChildren(
    order,
    nameInput,
    tagInput,
    unitInput,
    actions
  );


  requestAnimationFrame(
    () => {
      nameInput.focus();

      if (nameInput.value) {
        nameInput.select();
      }
    }
  );
}

function buildLoggingItemList() {
  const originalItems =
    extractLoggingItems();

  const addedItems =
    getCurrentLoggingAddedItems();

  const result =
    [];


  function appendAddedItems(
    parentKey
  ) {
    addedItems
      .filter(
        item =>
          item.insertAfterKey ===
          parentKey
      )
      .forEach(
        item => {
          result.push(
            item
          );

          appendAddedItems(
            getLoggingItemDraftKey(
              item
            )
          );
        }
      );
  }


  originalItems.forEach(
    item => {
      result.push(
        item
      );

      appendAddedItems(
        getLoggingItemDraftKey(
          item
        )
      );
    }
  );


  /*
    이전 단계에서 만들어진
    insertAfterKey가 없는 신규 항목도 유지
  */
  addedItems
    .filter(
      item =>
        !item.insertAfterKey
    )
    .forEach(
      item => {
        if (
          !result.includes(
            item
          )
        ) {
          result.push(
            item
          );
        }
      }
    );


  return result.map(
    (
      item,
      index
    ) => {
      const key =
        getLoggingItemDraftKey(
          item
        );


      const templateOverride =
        loggingItemTemplateOverrides.get(
          key
        );


      const draft =
        loggingItemDrafts.get(
          key
        );


      return {
        ...item,

        ...(templateOverride || {}),

        ...(draft || {}),

        order:
          index + 1
      };
    }
  );
}

function resetLoggingTemplateState() {
  loggingItemDrafts.clear();

  loggingItemTemplateOverrides.clear();

  loggingItemAddedItems.set(
    state.sheetConfig.key,
    []
  );

  loggingItemEditingKey =
    "";

  loggingItemSelectedKey =
    "";
}

function applyLoggingTemplateState(
  template
) {
  resetLoggingTemplateState();


  loggingTemplateExpectedVersion =
    Number(
      template?.versionNumber ||
      0
    );


  applyLoggingIntervalSetting(
    template?.settings
  );


  const templateItems =
    Array.isArray(
      template?.items
    )
      ? [...template.items]
      : [];


  if (
    !templateItems.length
  ) {
    return;
  }


  templateItems.sort(
    (
      left,
      right
    ) =>
      Number(
        left?.order ||
        0
      ) -
      Number(
        right?.order ||
        0
      )
  );


  const originalItems =
    extractLoggingItems();


  const originalByKey =
    new Map();


  const originalBySource =
    new Map();


  originalItems.forEach(
    item => {
      const key =
        getLoggingItemDraftKey(
          item
        );


      originalByKey.set(
        key,
        item
      );


      originalBySource.set(
        [
          Number(
            item.sourceRow
          ),
          Number(
            item.sourceColumn
          )
        ].join(":"),
        item
      );
    }
  );


  const addedItems =
    getCurrentLoggingAddedItems();


  templateItems.forEach(
    (
      savedItem,
      index
    ) => {
      if (
        !savedItem ||
        typeof savedItem !==
          "object"
      ) {
        return;
      }


      if (
        savedItem.isNew
      ) {
        const draftKey =
          normalizeLoggingText(
            savedItem.key
          ) ||
          [
            state.sheetConfig.key,
            "loaded",
            index + 1
          ].join(":");


        addedItems.push({
          draftKey,

          sourceRow:
            null,

          sourceColumn:
            null,

          group:
            normalizeLoggingText(
              savedItem.group
            ),

          subgroup:
            normalizeLoggingText(
              savedItem.subgroup
            ),

          subgroupParts:
            Array.isArray(
              savedItem.subgroupParts
            )
              ? savedItem.subgroupParts
                  .map(
                    value =>
                      normalizeLoggingText(
                        value
                      )
                  )
                  .filter(Boolean)
              : [],

          itemName:
            normalizeLoggingText(
              savedItem.itemName
            ),

          name:
            normalizeLoggingText(
              savedItem.name
            ),

          tag:
            normalizeLoggingText(
              savedItem.tag
            ),

          rating:
            normalizeLoggingText(
              savedItem.rating
            ),

          unit:
            normalizeLoggingText(
              savedItem.unit
            ),

          groupMerge:
            normalizeLoggingMergeSnapshot(
              savedItem.groupMerge
            ),

          subgroupMerges:
            Array.isArray(
              savedItem.subgroupMerges
            )
              ? savedItem.subgroupMerges
                  .map(
                    merge =>
                      normalizeLoggingMergeSnapshot(
                        merge,
                        merge?.column
                      )
                  )
                  .filter(Boolean)
              : [],

          isNew:
            true,

          insertAfterKey:
            normalizeLoggingText(
              savedItem.insertAfterKey
            )
        });


        return;
      }


      const savedKey =
        normalizeLoggingText(
          savedItem.key
        );


      const sourceKey =
        [
          Number(
            savedItem.sourceRow
          ),
          Number(
            savedItem.sourceColumn
          )
        ].join(":");


      const originalItem =
        originalByKey.get(
          savedKey
        ) ||
        originalBySource.get(
          sourceKey
        );


      if (
        !originalItem
      ) {
        return;
      }


      const originalKey =
        getLoggingItemDraftKey(
          originalItem
        );


      const override = {
        group:
          normalizeLoggingText(
            savedItem.group
          ),

        subgroup:
          normalizeLoggingText(
            savedItem.subgroup
          ),

        subgroupParts:
          Array.isArray(
            savedItem.subgroupParts
          )
            ? savedItem.subgroupParts
                .map(
                  value =>
                    normalizeLoggingText(
                      value
                    )
                )
                .filter(Boolean)
            : [],

        itemName:
          normalizeLoggingText(
            savedItem.itemName
          ),

        name:
          normalizeLoggingText(
            savedItem.name
          ),

        tag:
          normalizeLoggingText(
            savedItem.tag
          ),

        rating:
          normalizeLoggingText(
            savedItem.rating
          ),

        unit:
          normalizeLoggingText(
            savedItem.unit
          ),

        groupMerge:
          normalizeLoggingMergeSnapshot(
            savedItem.groupMerge
          ),

        subgroupMerges:
          Array.isArray(
            savedItem.subgroupMerges
          )
            ? savedItem.subgroupMerges
                .map(
                  merge =>
                    normalizeLoggingMergeSnapshot(
                      merge,
                      merge?.column
                    )
                )
                .filter(Boolean)
            : []
      };


      loggingItemTemplateOverrides.set(
        originalKey,
        override
      );
    }
  );
}

async function loadActiveLoggingTemplate() {
  const identity =
    getIdentity();


  const params =
    new URLSearchParams({
      mode:
        "template",

      templateKey:
        identity.templateKey,

      sheetKey:
        identity.sheetKey
    });


  const separator =
    config.apiPath.includes("?")
      ? "&"
      : "?";


  const payload =
    await requestApi(
      `${config.apiPath}${separator}${params.toString()}`
    );


  return (
    payload.template ||
    null
  );
}

function buildLoggingTemplatePayload() {
  if (
    !state.sheetConfig
  ) {
    return null;
  }


  const identity =
    getIdentity();


  const items =
    buildLoggingItemList()
      .map(
        (
          item,
          index
        ) => {
          const itemKey =
            getLoggingItemDraftKey(
              item
            );


          const group =
            normalizeLoggingText(
              item.group
            );


          const subgroupParts =
            getLoggingSubgroupParts(
              item
            );


          const subgroup =
            normalizeLoggingText(
              item.subgroup
            ) ||
            subgroupParts.join(
              " · "
            );


          const itemName =
            normalizeLoggingText(
              item.itemName
            );


          const name =
            buildStructuredLoggingName(
              {
                ...item,
                group,
                subgroup,
                subgroupParts,
                itemName
              }
            );


          return {
            key:
              itemKey,

            order:
              index +
              1,


            /*
              기존 버전 호환용 전체 이름
            */

            name,


            /*
              신규 구조형 Logging 필드
            */

            group,

            subgroup,

            subgroupParts,

            itemName,


            tag:
              normalizeLoggingText(
                item.tag
              ),

            rating:
              normalizeLoggingText(
                item.rating
              ),

            unit:
              normalizeLoggingText(
                item.unit
              ),


            /*
              병합 정보

              다음 단계의 병합 / 병합해제 UI가
              이 값을 직접 수정하게 된다.
            */

            groupMerge:
              getLoggingGroupMergeSnapshot(
                item
              ),

            subgroupMerges:
              getLoggingSubgroupMergeSnapshots(
                item
              ),


            isNew:
              Boolean(
                item.isNew
              ),

            sourceRow:
              item.sourceRow ===
                null ||
              item.sourceRow ===
                undefined
                ? null
                : Number(
                    item.sourceRow
                  ),

            sourceColumn:
              item.sourceColumn ===
                null ||
              item.sourceColumn ===
                undefined
                ? null
                : Number(
                    item.sourceColumn
                  ),

            insertAfterKey:
              item.insertAfterKey ||
              null
          };
        }
      )
      .filter(
        item =>
          Boolean(
            normalizeLoggingText(
              item.name
            )
          )
      );


  return {
    templateKey:
      identity.templateKey,

    sheetKey:
      identity.sheetKey,

    sheetName:
      state.sheetConfig.sheetName,

    settings:
      getLoggingScheduleConfig()
        ? {
            loggingIntervalHours:
              getLoggingIntervalHours(),

            loggingStartHour:
              getLoggingStartHour()
          }
        : {},

    items
  };
}

async function saveLoggingTemplate() {
  if (
    state.isBusy ||
    !state.sheetConfig
  ) {
    return;
  }


  const template =
    buildLoggingTemplatePayload();


  if (
    !template ||
    !Array.isArray(
      template.items
    ) ||
    !template.items.length
  ) {
    window.alert(
      "저장할 Logging 항목이 없습니다."
    );

    return;
  }


  const confirmed =
    window.confirm(
      [
        "현재 Logging 항목 구성을",
        "공용 Log Sheet 양식으로 저장할까요?",
        "",
        "저장 이후 새로 작성하는 Log Sheet에 적용됩니다."
      ].join("\n")
    );


  if (!confirmed) {
    return;
  }


  const button =
    elements.templateSaveButton;


  if (button) {
    button.disabled =
      true;

    button.textContent =
      "저장 중";
  }


  try {
    const payload =
      await requestApi(
        config.apiPath,
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              mode:
                "template",

              template,

              expectedVersion:
                loggingTemplateExpectedVersion
            })
        }
      );


    const savedTemplate =
      payload.template ||
      null;


    /*
      서버에 실제 저장된 양식을
      다시 현재 화면 상태로 적용한다.
    */
    applyLoggingTemplateState(
      savedTemplate
    );


    renderLoggingItemList();


    /*
      미리보기가 이미 열려 있다면
      저장 완료된 양식 기준으로 다시 그린다.
    */
    if (
      elements.previewSection &&
      !elements.previewSection.hidden
    ) {
      setPreviewOpen(
        true
      );
    }


    const versionNumber =
      Number(
        savedTemplate
          ?.versionNumber ||
        loggingTemplateExpectedVersion ||
        0
      );


    setStatus(
      "양식 저장 완료",
      versionNumber
        ? `공용 Log Sheet 양식 v${versionNumber}으로 저장했습니다.`
        : "공용 Log Sheet 양식을 저장했습니다.",
      "saved"
    );


    window.alert(
      versionNumber
        ? `공용 Log Sheet 양식 v${versionNumber}으로 저장되었습니다.`
        : "공용 Log Sheet 양식이 저장되었습니다."
    );


  } catch (
    error
  ) {
    console.error(
      "Log Sheet 공용 양식 저장 실패:",
      error
    );


    if (
      error.status ===
        409
    ) {
      const currentTemplate =
        error.payload
          ?.template;


      loggingTemplateExpectedVersion =
        Number(
          currentTemplate
            ?.versionNumber ||
          0
        );


      setStatus(
        "양식 충돌",
        "다른 사용자가 먼저 양식을 저장했습니다. 최신 양식을 다시 불러와 주세요.",
        "error"
      );


      window.alert(
        "다른 사용자가 먼저 Log Sheet 양식을 저장했습니다.\n최신 양식을 다시 불러온 뒤 수정해 주세요."
      );

    } else {
      setStatus(
        "양식 저장 실패",
        error.message,
        "error"
      );


      window.alert(
        error.message ||
        "공용 Log Sheet 양식을 저장하지 못했습니다."
      );
    }


  } finally {
    if (
      button
    ) {
      button.disabled =
        false;

      button.textContent =
        "양식 저장";
    }
  }
}

/* =========================================================
  Logging 항목 목록
========================================================= */

/* =========================================================
  Logging 직접 입력 표
========================================================= */

function getLoggingInlineValues(
  item
) {
  const legacyParts =
    normalizeLoggingText(
      item?.name
    )
      .split(
        /\s*·\s*/
      )
      .map(
        value =>
          normalizeLoggingText(
            value
          )
      )
      .filter(Boolean);


  const pathParts =
    Array.isArray(
      item?.pathParts
    )
      ? item.pathParts
          .map(
            value =>
              normalizeLoggingText(
                value
              )
          )
          .filter(Boolean)
      : [];


  const group =
    normalizeLoggingText(
      item?.group
    ) ||
    normalizeLoggingText(
      item?.groupCell?.text
    ) ||
    (
      pathParts.length > 1
        ? pathParts[0]
        : ""
    ) ||
    (
      legacyParts.length > 1
        ? legacyParts[0]
        : ""
    );


  let subgroupParts =
    Array.isArray(
      item?.subgroupParts
    )
      ? item.subgroupParts
          .map(
            value =>
              normalizeLoggingText(
                value
              )
          )
          .filter(Boolean)
      : [];


  if (
    !subgroupParts.length &&
    Array.isArray(
      item?.subgroupCells
    )
  ) {
    subgroupParts =
      item.subgroupCells
        .map(
          cell =>
            normalizeLoggingText(
              cell?.text
            )
        )
        .filter(Boolean);
  }


  if (
    !subgroupParts.length &&
    pathParts.length > 2
  ) {
    subgroupParts =
      pathParts.slice(
        1,
        -1
      );
  }


  if (
    !subgroupParts.length &&
    legacyParts.length > 2
  ) {
    subgroupParts =
      legacyParts.slice(
        1,
        -1
      );
  }


  const subgroup =
    normalizeLoggingText(
      item?.subgroup
    ) ||
    subgroupParts.join(
      " · "
    );


  const itemName =
    normalizeLoggingText(
      item?.itemName
    ) ||
    normalizeLoggingText(
      item?.itemCell?.text
    ) ||
    (
      pathParts.length
        ? pathParts[
            pathParts.length - 1
          ]
        : ""
    ) ||
    (
      legacyParts.length
        ? legacyParts[
            legacyParts.length - 1
          ]
        : ""
    );


  return {
    group,

    subgroup,

    itemName,

    tag:
      normalizeLoggingText(
        item?.tag
      ),

    rating:
      normalizeLoggingText(
        item?.rating
      ) ||
      normalizeLoggingText(
        item?.ratingCell?.text
      ),

    unit:
      normalizeLoggingText(
        item?.unit
      )
  };
}


function createLoggingInlineInput(
  field,
  value,
  placeholder
) {
  const input =
    document.createElement(
      "input"
    );


  input.type =
    "text";

  input.className =
    `log-sheet-item-input log-sheet-item-input--${field}`;

  input.dataset.field =
    field;

  input.value =
    value || "";

  input.placeholder =
    placeholder;

  input.autocomplete =
    "off";

  input.spellcheck =
    false;


  return input;
}


function saveLoggingInlineDraft(
  item,
  row,
  controls
) {
  const draftKey =
    getLoggingItemDraftKey(
      item
    );


  const group =
    normalizeLoggingText(
      controls.group.value
    );


  const subgroup =
    normalizeLoggingText(
      controls.subgroup.value
    );


  const subgroupParts =
    subgroup
      ? subgroup
          .split(
            /\s*·\s*/
          )
          .map(
            value =>
              normalizeLoggingText(
                value
              )
          )
          .filter(Boolean)
      : [];


  const itemName =
    normalizeLoggingText(
      controls.itemName.value
    );


  const name =
    [
      group,
      ...subgroupParts,
      itemName
    ]
      .filter(Boolean)
      .join(
        " · "
      );


  loggingItemDrafts.set(
    draftKey,
    {
      group,

      subgroup,

      subgroupParts,

      itemName,

      name,

      tag:
        normalizeLoggingText(
          controls.tag.value
        ),

      rating:
        normalizeLoggingText(
          controls.rating.value
        ),

      unit:
        normalizeLoggingText(
          controls.unit.value
        ),

      groupMerge:
        getLoggingGroupMergeSnapshot(
          item
        ),

      subgroupMerges:
        getLoggingSubgroupMergeSnapshots(
          item
        )
    }
  );


  loggingItemSelectedKey =
    draftKey;


  row.classList.add(
    "has-draft",
    "is-selected"
  );
}


function renderLoggingItemList() {
  if (
    !elements.itemList ||
    !elements.itemCount
  ) {
    return;
  }


  const items =
    buildLoggingItemList();


  elements.itemCount.textContent =
    `${items.length}개`;


  if (
    !items.length
  ) {
    const empty =
      document.createElement(
        "div"
      );


    empty.className =
      "log-sheet-item-list__empty";


    empty.textContent =
      "표시할 Logging 항목이 없습니다.";


    elements.itemList.replaceChildren(
      empty
    );


    return;
  }


  const fragment =
    document.createDocumentFragment();


  items.forEach(
    item => {
      const draftKey =
        getLoggingItemDraftKey(
          item
        );


      const values =
        getLoggingInlineValues(
          item
        );


      const row =
        document.createElement(
          "div"
        );


      row.className =
        "log-sheet-item-row";


      if (
        loggingItemDrafts.has(
          draftKey
        )
      ) {
        row.classList.add(
          "has-draft"
        );
      }


      if (
        loggingItemSelectedKey ===
          draftKey
      ) {
        row.classList.add(
          "is-selected"
        );
      }


      const order =
        document.createElement(
          "span"
        );


      order.className =
        "log-sheet-item-row__order";


      order.textContent =
        String(
          item.order
        );


      const controls = {
        group:
          createLoggingInlineInput(
            "group",
            values.group,
            "상위명"
          ),

        subgroup:
          createLoggingInlineInput(
            "subgroup",
            values.subgroup,
            "세부구분"
          ),

        itemName:
          createLoggingInlineInput(
            "itemName",
            values.itemName,
            "항목명"
          ),

        tag:
          createLoggingInlineInput(
            "tag",
            values.tag,
            "TAG"
          ),

        rating:
          createLoggingInlineInput(
            "rating",
            values.rating,
            "RATING"
          ),

        unit:
          createLoggingInlineInput(
            "unit",
            values.unit,
            "UNIT"
          )
      };


      Object.values(
        controls
      ).forEach(
        input => {

          input.addEventListener(
            "focus",
            () => {
              loggingItemSelectedKey =
                draftKey;


              elements.itemList
                .querySelectorAll(
                  ".log-sheet-item-row.is-selected"
                )
                .forEach(
                  selectedRow => {
                    selectedRow.classList.remove(
                      "is-selected"
                    );
                  }
                );


              row.classList.add(
                "is-selected"
              );
            }
          );


          input.addEventListener(
            "input",
            () => {
              saveLoggingInlineDraft(
                item,
                row,
                controls
              );
            }
          );


          input.addEventListener(
            "keydown",
            event => {
              if (
                event.key !== "Enter"
              ) {
                return;
              }


              event.preventDefault();


              const rows =
                [
                  ...elements.itemList
                    .querySelectorAll(
                      ".log-sheet-item-row"
                    )
                ];


              const currentIndex =
                rows.indexOf(
                  row
                );


              const targetIndex =
                event.shiftKey
                  ? currentIndex - 1
                  : currentIndex + 1;


              const targetInput =
                rows[targetIndex]
                  ?.querySelector(
                    `[data-field="${input.dataset.field}"]`
                  );


              targetInput?.focus();
            }
          );
        }
      );


      row.append(
        order,
        controls.group,
        controls.subgroup,
        controls.itemName,
        controls.tag,
        controls.rating,
        controls.unit
      );


      fragment.appendChild(
        row
      );
    }
  );


  elements.itemList.replaceChildren(
    fragment
  );
}

/* =========================================================
  [LOG-SHEET-ITEM-INSERT-REORDER-V3]

  - Keep the current structured Log Sheet item model.
  - Do not replace existing add/edit/render/template functions.
  - Wrap the existing functions and decorate rendered rows only.
  - A row itself never starts drag.
  - Only the far-right grip handle starts drag.
========================================================= */

const loggingItemOrderKeysBySheet =
  new Map();


function getCurrentLoggingItemOrderKeys() {
  const sheetKey =
    String(
      state.sheetConfig?.key ||
      ""
    );

  if (
    !loggingItemOrderKeysBySheet
      .has(
        sheetKey
      )
  ) {
    loggingItemOrderKeysBySheet
      .set(
        sheetKey,
        []
      );
  }

  return [
    ...loggingItemOrderKeysBySheet
      .get(
        sheetKey
      )
  ];
}


function setCurrentLoggingItemOrderKeys(
  keys
) {
  const sheetKey =
    String(
      state.sheetConfig?.key ||
      ""
    );

  const nextKeys =
    [];

  const seen =
    new Set();

  (
    Array.isArray(
      keys
    )
      ? keys
      : []
  ).forEach(
    key => {
      const normalizedKey =
        String(
          key ||
          ""
        ).trim();

      if (
        !normalizedKey ||
        seen.has(
          normalizedKey
        )
      ) {
        return;
      }

      seen.add(
        normalizedKey
      );

      nextKeys.push(
        normalizedKey
      );
    }
  );

  loggingItemOrderKeysBySheet
    .set(
      sheetKey,
      nextKeys
    );
}


function syncLoggingAddedItemInsertAfterKeys(
  orderedItems
) {
  const addedItems =
    getCurrentLoggingAddedItems();

  const addedByKey =
    new Map(
      addedItems.map(
        item => [
          getLoggingItemDraftKey(
            item
          ),
          item
        ]
      )
    );

  (
    Array.isArray(
      orderedItems
    )
      ? orderedItems
      : []
  ).forEach(
    (
      item,
      index
    ) => {
      if (
        !item?.isNew
      ) {
        return;
      }

      const key =
        getLoggingItemDraftKey(
          item
        );

      const sourceItem =
        addedByKey.get(
          key
        );

      if (!sourceItem) {
        return;
      }

      sourceItem.insertAfterKey =
        index > 0
          ? getLoggingItemDraftKey(
              orderedItems[
                index - 1
              ]
            )
          : "";
    }
  );
}


/* ---------------------------------------------------------
   Preserve current structured build logic, then apply order.
--------------------------------------------------------- */

const buildLoggingItemListBeforeReorder =
  buildLoggingItemList;


buildLoggingItemList =
  function buildLoggingItemListWithReorder() {
    const baseItems =
      buildLoggingItemListBeforeReorder();

    const requestedKeys =
      getCurrentLoggingItemOrderKeys();

    if (
      !requestedKeys.length ||
      !baseItems.length
    ) {
      return baseItems.map(
        (
          item,
          index
        ) => ({
          ...item,
          order:
            index + 1
        })
      );
    }

    const itemByKey =
      new Map(
        baseItems.map(
          item => [
            getLoggingItemDraftKey(
              item
            ),
            item
          ]
        )
      );

    const orderedItems =
      [];

    const usedKeys =
      new Set();

    requestedKeys.forEach(
      key => {
        const item =
          itemByKey.get(
            key
          );

        if (!item) {
          return;
        }

        orderedItems.push(
          item
        );

        usedKeys.add(
          key
        );
      }
    );

    baseItems.forEach(
      item => {
        const key =
          getLoggingItemDraftKey(
            item
          );

        if (
          usedKeys.has(
            key
          )
        ) {
          return;
        }

        orderedItems.push(
          item
        );
      }
    );

    return orderedItems.map(
      (
        item,
        index
      ) => ({
        ...item,
        order:
          index + 1
      })
    );
  };


/* ---------------------------------------------------------
   Reset/load wrappers.
   Existing structured fields and logging-interval settings stay intact.
--------------------------------------------------------- */

const resetLoggingTemplateStateBeforeReorder =
  resetLoggingTemplateState;


resetLoggingTemplateState =
  function resetLoggingTemplateStateWithReorder() {
    resetLoggingTemplateStateBeforeReorder();

    setCurrentLoggingItemOrderKeys(
      []
    );
  };


const applyLoggingTemplateStateBeforeReorder =
  applyLoggingTemplateState;


applyLoggingTemplateState =
  function applyLoggingTemplateStateWithReorder(
    template
  ) {
    applyLoggingTemplateStateBeforeReorder(
      template
    );

    const savedItems =
      Array.isArray(
        template?.items
      )
        ? [
            ...template.items
          ].sort(
            (
              left,
              right
            ) =>
              Number(
                left?.order ||
                0
              ) -
              Number(
                right?.order ||
                0
              )
          )
        : [];

    if (
      !savedItems.length
    ) {
      setCurrentLoggingItemOrderKeys(
        []
      );

      return;
    }

    const availableItems =
      buildLoggingItemListBeforeReorder();

    const byKey =
      new Map();

    const bySource =
      new Map();

    availableItems.forEach(
      item => {
        const key =
          getLoggingItemDraftKey(
            item
          );

        byKey.set(
          key,
          item
        );

        if (
          item.sourceRow !==
            null &&
          item.sourceRow !==
            undefined &&
          item.sourceColumn !==
            null &&
          item.sourceColumn !==
            undefined
        ) {
          bySource.set(
            String(
              Number(
                item.sourceRow
              )
            ) +
            ":" +
            String(
              Number(
                item.sourceColumn
              )
            ),
            item
          );
        }
      }
    );

    const resolvedKeys =
      [];

    savedItems.forEach(
      savedItem => {
        const savedKey =
          String(
            savedItem?.key ||
            ""
          ).trim();

        let item =
          savedKey
            ? byKey.get(
                savedKey
              )
            : null;

        if (
          !item &&
          savedItem?.sourceRow !==
            null &&
          savedItem?.sourceRow !==
            undefined &&
          savedItem?.sourceColumn !==
            null &&
          savedItem?.sourceColumn !==
            undefined
        ) {
          item =
            bySource.get(
              String(
                Number(
                  savedItem.sourceRow
                )
              ) +
              ":" +
              String(
                Number(
                  savedItem.sourceColumn
                )
              )
            );
        }

        if (!item) {
          return;
        }

        resolvedKeys.push(
          getLoggingItemDraftKey(
            item
          )
        );
      }
    );

    setCurrentLoggingItemOrderKeys(
      resolvedKeys
    );

    syncLoggingAddedItemInsertAfterKeys(
      buildLoggingItemList()
    );
  };


/* ---------------------------------------------------------
   Insert a new item at an exact gap using the existing add function.
--------------------------------------------------------- */

const addLoggingItemBeforeGapInsert =
  addLoggingItem;


function addLoggingItemAfterKey(
  targetKey
) {
  const normalizedTargetKey =
    String(
      targetKey ||
      ""
    ).trim();

  if (
    !normalizedTargetKey ||
    state.isBusy
  ) {
    return;
  }

  const beforeItems =
    buildLoggingItemList();

  const beforeAddedKeys =
    new Set(
      getCurrentLoggingAddedItems()
        .map(
          item =>
            getLoggingItemDraftKey(
              item
            )
        )
    );

  if (
    !beforeItems.some(
      item =>
        getLoggingItemDraftKey(
          item
        ) ===
        normalizedTargetKey
    )
  ) {
    return;
  }

  loggingItemSelectedKey =
    normalizedTargetKey;

  addLoggingItemBeforeGapInsert();

  const newItem =
    getCurrentLoggingAddedItems()
      .find(
        item =>
          !beforeAddedKeys.has(
            getLoggingItemDraftKey(
              item
            )
          )
      );

  if (!newItem) {
    return;
  }

  const newKey =
    getLoggingItemDraftKey(
      newItem
    );

  newItem.insertAfterKey =
    normalizedTargetKey;

  const orderedKeys =
    beforeItems.map(
      item =>
        getLoggingItemDraftKey(
          item
        )
    );

  const targetIndex =
    orderedKeys.indexOf(
      normalizedTargetKey
    );

  orderedKeys.splice(
    targetIndex + 1,
    0,
    newKey
  );

  setCurrentLoggingItemOrderKeys(
    orderedKeys
  );

  syncLoggingAddedItemInsertAfterKeys(
    buildLoggingItemList()
  );

  loggingItemSelectedKey =
    newKey;

  renderLoggingItemList();
}


/* ---------------------------------------------------------
   Reorder boundaries.
   Structured group/subgroup + source section + fixed print page.
--------------------------------------------------------- */

function getLoggingItemSourceSectionSignature(
  item
) {
  if (
    !item ||
    item.isNew
  ) {
    return "";
  }

  const section =
    typeof getLoggingItemSectionForItem ===
      "function"
      ? getLoggingItemSectionForItem(
          item
        )
      : null;

  if (!section) {
    return "";
  }

  return JSON.stringify({
    ranges:
      section.ranges ||
      [],

    nameColumns:
      section.nameColumns ||
      [],

    tagColumn:
      section.tagColumn ||
      "",

    ratingColumn:
      section.ratingColumn ||
      "",

    unitColumn:
      section.unitColumn ||
      ""
  });
}


function getLoggingItemPrintPageSignature(
  item
) {
  if (
    !item ||
    item.isNew ||
    typeof getIntegratedControlFixedPageRanges !==
      "function"
  ) {
    return "";
  }

  const rowNumber =
    Number(
      item.sourceRow
    );

  if (
    !Number.isFinite(
      rowNumber
    )
  ) {
    return "";
  }

  const pageRanges =
    getIntegratedControlFixedPageRanges();

  const pageIndex =
    pageRanges.findIndex(
      range =>
        rowNumber >=
          Number(
            range.startRow
          ) &&
        rowNumber <=
          Number(
            range.endRow
          )
    );

  return pageIndex >=
    0
    ? "page:" +
        String(
          pageIndex
        )
    : "";
}


function getLoggingItemReorderSegmentKey(
  item,
  orderedItems
) {
  if (!item) {
    return "";
  }

  if (
    item.isNew
  ) {
    const items =
      Array.isArray(
        orderedItems
      )
        ? orderedItems
        : [];

    const key =
      getLoggingItemDraftKey(
        item
      );

    const itemIndex =
      items.findIndex(
        candidate =>
          getLoggingItemDraftKey(
            candidate
          ) ===
          key
      );

    for (
      let index =
        itemIndex - 1;
      index >= 0;
      index -= 1
    ) {
      if (
        !items[index]?.isNew
      ) {
        return getLoggingItemReorderSegmentKey(
          items[index],
          items
        );
      }
    }

    for (
      let index =
        itemIndex + 1;
      index <
        items.length;
      index += 1
    ) {
      if (
        !items[index]?.isNew
      ) {
        return getLoggingItemReorderSegmentKey(
          items[index],
          items
        );
      }
    }

    return "";
  }

  const group =
    normalizeLoggingText(
      item.group ||
      item.groupLabel ||
      ""
    );

  const subgroup =
    normalizeLoggingText(
      item.subgroup ||
      item.subgroupLabel ||
      ""
    );

  return [
    String(
      state.sheetConfig?.key ||
      ""
    ),

    getLoggingItemSourceSectionSignature(
      item
    ),

    group,

    subgroup,

    getLoggingItemPrintPageSignature(
      item
    )
  ].join(
    "||"
  );
}


function moveLoggingItemByKey(
  draggedKey,
  targetKey,
  position
) {
  const items =
    buildLoggingItemList();

  const draggedItem =
    items.find(
      item =>
        getLoggingItemDraftKey(
          item
        ) ===
        draggedKey
    );

  const targetItem =
    items.find(
      item =>
        getLoggingItemDraftKey(
          item
        ) ===
        targetKey
    );

  if (
    !draggedItem ||
    !targetItem ||
    draggedKey ===
      targetKey
  ) {
    return false;
  }

  const draggedSegment =
    getLoggingItemReorderSegmentKey(
      draggedItem,
      items
    );

  const targetSegment =
    getLoggingItemReorderSegmentKey(
      targetItem,
      items
    );

  if (
    !draggedSegment ||
    draggedSegment !==
      targetSegment
  ) {
    setStatus(
      "순서 이동 제한",
      "같은 Log Sheet 구간 안에서만 순서를 이동할 수 있습니다.",
      "idle"
    );

    return false;
  }

  const keys =
    items.map(
      item =>
        getLoggingItemDraftKey(
          item
        )
    );

  const draggedIndex =
    keys.indexOf(
      draggedKey
    );

  if (
    draggedIndex <
    0
  ) {
    return false;
  }

  keys.splice(
    draggedIndex,
    1
  );

  const targetIndex =
    keys.indexOf(
      targetKey
    );

  if (
    targetIndex <
    0
  ) {
    return false;
  }

  keys.splice(
    position ===
      "after"
      ? targetIndex + 1
      : targetIndex,
    0,
    draggedKey
  );

  setCurrentLoggingItemOrderKeys(
    keys
  );

  syncLoggingAddedItemInsertAfterKeys(
    buildLoggingItemList()
  );

  loggingItemSelectedKey =
    draggedKey;

  renderLoggingItemList();

  if (
    elements.previewSection &&
    !elements.previewSection.hidden
  ) {
    renderGrid();

    applyLoggingItemDraftsToPreview();

    applyLoggingItemOrderToPreview();

    applyAddedLoggingItemsToPreview();
  }

  setStatus(
    "양식 수정",
    "Logging 항목 순서를 변경했습니다. 공용 적용은 '양식 저장'을 눌러 완료하세요.",
    "dirty"
  );

  return true;
}


/* ---------------------------------------------------------
   Preview: move cloned HTML rows only.
   The original workbook/template remains untouched here.
--------------------------------------------------------- */

function applyLoggingItemOrderToPreview() {
  if (
    !elements.grid ||
    typeof getLoggingPreviewRow !==
      "function"
  ) {
    return;
  }

  const items =
    buildLoggingItemList();

  const originalItems =
    items.filter(
      item =>
        !item.isNew
    );

  const groups =
    new Map();

  originalItems.forEach(
    item => {
      const segmentKey =
        getLoggingItemReorderSegmentKey(
          item,
          items
        );

      if (!segmentKey) {
        return;
      }

      if (
        !groups.has(
          segmentKey
        )
      ) {
        groups.set(
          segmentKey,
          []
        );
      }

      groups.get(
        segmentKey
      ).push(
        item
      );
    }
  );

  groups.forEach(
    orderedGroupItems => {
      if (
        orderedGroupItems.length <
        2
      ) {
        return;
      }

      const naturalGroupItems =
        [
          ...orderedGroupItems
        ].sort(
          (
            left,
            right
          ) =>
            Number(
              left.sourceRow
            ) -
              Number(
                right.sourceRow
              ) ||
            Number(
              left.sourceColumn
            ) -
              Number(
                right.sourceColumn
              )
        );

      const naturalKeys =
        naturalGroupItems.map(
          item =>
            getLoggingItemDraftKey(
              item
            )
        );

      const orderedKeys =
        orderedGroupItems.map(
          item =>
            getLoggingItemDraftKey(
              item
            )
        );

      if (
        naturalKeys.every(
          (
            key,
            index
          ) =>
            key ===
            orderedKeys[
              index
            ]
        )
      ) {
        return;
      }

      const destinationRows =
        naturalGroupItems.map(
          item =>
            getLoggingPreviewRow(
              item.sourceRow
            )
        );

      const orderedRows =
        orderedGroupItems.map(
          item =>
            getLoggingPreviewRow(
              item.sourceRow
            )
        );

      if (
        destinationRows.some(
          row =>
            !row
        ) ||
        orderedRows.some(
          row =>
            !row
        )
      ) {
        return;
      }

      if (
        new Set(
          destinationRows
        ).size !==
          destinationRows.length ||
        new Set(
          orderedRows
        ).size !==
          orderedRows.length
      ) {
        return;
      }

      const parent =
        destinationRows[0]
          .parentNode;

      if (
        !parent ||
        destinationRows.some(
          row =>
            row.parentNode !==
              parent
        ) ||
        orderedRows.some(
          row =>
            row.parentNode !==
              parent
        )
      ) {
        return;
      }

      const placeholders =
        destinationRows.map(
          row => {
            const placeholder =
              document.createComment(
                "logging-item-order-slot"
              );

            row.before(
              placeholder
            );

            return placeholder;
          }
        );

      orderedRows.forEach(
        (
          row,
          index
        ) => {
          placeholders[
            index
          ].replaceWith(
            row
          );
        }
      );
    }
  );
}


/* ---------------------------------------------------------
   Dedicated grip drag.
--------------------------------------------------------- */

let loggingItemGripDragState =
  null;


function clearLoggingItemDragClasses() {
  elements.itemList
    ?.querySelectorAll(
      [
        ".is-dragging",
        ".is-drop-before",
        ".is-drop-after",
        ".is-drop-blocked"
      ].join(
        ","
      )
    )
    .forEach(
      element => {
        element.classList.remove(
          "is-dragging",
          "is-drop-before",
          "is-drop-after",
          "is-drop-blocked"
        );
      }
    );
}


function beginLoggingItemGripDrag(
  event,
  row,
  item
) {
  if (
    state.isBusy ||
    row.classList.contains(
      "is-editing"
    )
  ) {
    return;
  }

  if (
    event.pointerType ===
      "mouse" &&
    event.button !==
      0
  ) {
    return;
  }

  const handle =
    event.currentTarget;

  const draggedKey =
    getLoggingItemDraftKey(
      item
    );

  loggingItemGripDragState = {
    handle,
    row,
    draggedKey,
    pointerId:
      event.pointerId,
    startX:
      event.clientX,
    startY:
      event.clientY,
    active:
      false,
    targetKey:
      "",
    position:
      "after"
  };

  event.preventDefault();
  event.stopPropagation();

  try {
    handle.setPointerCapture(
      event.pointerId
    );
  } catch {
    /* no-op */
  }

  const onPointerMove =
    moveEvent => {
      const dragState =
        loggingItemGripDragState;

      if (
        !dragState ||
        dragState.pointerId !==
          moveEvent.pointerId
      ) {
        return;
      }

      const distance =
        Math.hypot(
          moveEvent.clientX -
            dragState.startX,
          moveEvent.clientY -
            dragState.startY
        );

      if (
        !dragState.active &&
        distance <
          4
      ) {
        return;
      }

      if (
        !dragState.active
      ) {
        dragState.active =
          true;

        dragState.row
          .classList.add(
            "is-dragging"
          );
      }

      moveEvent.preventDefault();

      const list =
        elements.itemList;

      if (list) {
        const listRect =
          list.getBoundingClientRect();

        if (
          moveEvent.clientY <
          listRect.top +
            34
        ) {
          list.scrollTop -=
            14;

        } else if (
          moveEvent.clientY >
          listRect.bottom -
            34
        ) {
          list.scrollTop +=
            14;
        }
      }

      const targetElement =
        document.elementFromPoint(
          moveEvent.clientX,
          moveEvent.clientY
        );

      const targetRow =
        targetElement
          ?.closest(
            ".log-sheet-item-row"
          );

      elements.itemList
        ?.querySelectorAll(
          [
            ".is-drop-before",
            ".is-drop-after",
            ".is-drop-blocked"
          ].join(
            ","
          )
        )
        .forEach(
          currentRow => {
            currentRow.classList.remove(
              "is-drop-before",
              "is-drop-after",
              "is-drop-blocked"
            );
          }
        );

      dragState.targetKey =
        "";

      if (
        !targetRow ||
        targetRow ===
          dragState.row
      ) {
        return;
      }

      const targetKey =
        String(
          targetRow.dataset
            .loggingItemKey ||
          ""
        ).trim();

      if (!targetKey) {
        return;
      }

      const items =
        buildLoggingItemList();

      const draggedItem =
        items.find(
          currentItem =>
            getLoggingItemDraftKey(
              currentItem
            ) ===
            dragState.draggedKey
        );

      const targetItem =
        items.find(
          currentItem =>
            getLoggingItemDraftKey(
              currentItem
            ) ===
            targetKey
        );

      const allowed =
        draggedItem &&
        targetItem &&
        getLoggingItemReorderSegmentKey(
          draggedItem,
          items
        ) ===
        getLoggingItemReorderSegmentKey(
          targetItem,
          items
        );

      if (!allowed) {
        targetRow.classList.add(
          "is-drop-blocked"
        );

        return;
      }

      const rect =
        targetRow
          .getBoundingClientRect();

      const position =
        moveEvent.clientY <
          rect.top +
          rect.height /
            2
          ? "before"
          : "after";

      targetRow.classList.add(
        position ===
          "before"
          ? "is-drop-before"
          : "is-drop-after"
      );

      dragState.targetKey =
        targetKey;

      dragState.position =
        position;
    };

  const finishDrag =
    endEvent => {
      const dragState =
        loggingItemGripDragState;

      if (
        !dragState ||
        dragState.pointerId !==
          endEvent.pointerId
      ) {
        return;
      }

      handle.removeEventListener(
        "pointermove",
        onPointerMove
      );

      handle.removeEventListener(
        "pointerup",
        finishDrag
      );

      handle.removeEventListener(
        "pointercancel",
        finishDrag
      );

      try {
        handle.releasePointerCapture(
          endEvent.pointerId
        );
      } catch {
        /* no-op */
      }

      const shouldMove =
        dragState.active &&
        dragState.targetKey;

      const draggedKey =
        dragState.draggedKey;

      const targetKey =
        dragState.targetKey;

      const position =
        dragState.position;

      loggingItemGripDragState =
        null;

      clearLoggingItemDragClasses();

      if (
        shouldMove
      ) {
        moveLoggingItemByKey(
          draggedKey,
          targetKey,
          position
        );
      }
    };

  handle.addEventListener(
    "pointermove",
    onPointerMove
  );

  handle.addEventListener(
    "pointerup",
    finishDrag
  );

  handle.addEventListener(
    "pointercancel",
    finishDrag
  );
}


function createLoggingItemGripHandle(
  row,
  item
) {
  const handle =
    document.createElement(
      "button"
    );

  handle.type =
    "button";

  handle.className =
    "log-sheet-item-row__drag-handle";

  handle.setAttribute(
    "aria-label",
    String(
      item.order
    ) +
      "번 항목 순서 이동"
  );

  handle.title =
    "이 핸들을 잡아서 위아래로 이동";

  handle.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopPropagation();
    }
  );

  handle.addEventListener(
    "pointerdown",
    event => {
      beginLoggingItemGripDrag(
        event,
        row,
        item
      );
    }
  );

  return handle;
}


function createLoggingItemInsertSlot(
  item
) {
  const itemKey =
    getLoggingItemDraftKey(
      item
    );

  const slot =
    document.createElement(
      "div"
    );

  slot.className =
    "log-sheet-item-insert-slot";

  const button =
    document.createElement(
      "button"
    );

  button.type =
    "button";

  button.className =
    "log-sheet-item-insert-button";

  button.textContent =
    "+";

  button.setAttribute(
    "aria-label",
    String(
      item.order
    ) +
      "번 항목 뒤에 항목 추가"
  );

  button.title =
    "이 위치에 항목 추가";

  button.addEventListener(
    "click",
    event => {
      event.preventDefault();
      event.stopPropagation();

      addLoggingItemAfterKey(
        itemKey
      );
    }
  );

  slot.appendChild(
    button
  );

  return slot;
}


/* ---------------------------------------------------------
   Decorate the CURRENT renderer instead of replacing it.
--------------------------------------------------------- */

const renderLoggingItemListBeforeInsertReorder =
  renderLoggingItemList;


function decorateLoggingItemRowsForInsertReorder() {
  if (
    !elements.itemList
  ) {
    return;
  }

  elements.itemList
    .querySelectorAll(
      ".log-sheet-item-insert-slot"
    )
    .forEach(
      slot =>
        slot.remove()
    );

  const items =
    buildLoggingItemList();

  const rows = [
    ...elements.itemList
      .querySelectorAll(
        ".log-sheet-item-row"
      )
  ];

  rows.forEach(
    (
      row,
      index
    ) => {
      const item =
        items[
          index
        ];

      if (!item) {
        return;
      }

      const itemKey =
        getLoggingItemDraftKey(
          item
        );

      row.dataset
        .loggingItemKey =
        itemKey;

      row.querySelector(
        ".log-sheet-item-row__drag-handle"
      )?.remove();

      if (
        !row.classList.contains(
          "is-editing"
        )
      ) {
        row.appendChild(
          createLoggingItemGripHandle(
            row,
            item
          )
        );

        row.after(
          createLoggingItemInsertSlot(
            item
          )
        );
      }
    }
  );
}


renderLoggingItemList =
  function renderLoggingItemListWithInsertReorder() {
    const result =
      renderLoggingItemListBeforeInsertReorder();

    decorateLoggingItemRowsForInsertReorder();

    return result;
  };




/* 기존 미리보기 갱신 함수는 아래에서 그대로 사용 */
function renderGridIfPreviewVisible() {
    if (
      elements.previewSection &&
      !elements.previewSection.hidden
    ) {
      renderGrid();
    }
  }

function renderGrid() {
  const sheet =
    state.workbook?.Sheets?.[
      state.sheetConfig
        .sheetName
    ];


  if (
    !sheet
  ) {
    throw new Error(
      `엑셀 시트를 찾을 수 없습니다: ${state.sheetConfig.sheetName}`
    );
  }


  const renderRange =
    parseRange(
      state.sheetConfig
        .renderRange ||
      sheet["!ref"]
    );


  const editable =
    getEditableAddresses(
      state.sheetConfig
    );


  const {
    anchorMap,
    slaveAddresses
  } =
    getMergeAnchorMap(
      sheet
    );


  applyLoggingScheduleToMergeMaps(
    anchorMap,
    slaveAddresses
  );


  const table =
    document.createElement(
      "table"
    );


  table.className =
    "log-sheet-table";


  table.setAttribute(
    "aria-label",
    state.sheetConfig.title
  );


  /* =====================================================
    Excel 원본 열 너비
  ====================================================== */

  const columnGroup =
    document.createElement(
      "colgroup"
    );


  for (
    let column =
      renderRange.s.c;

    column <=
      renderRange.e.c;

    column +=
      1
  ) {
    const col =
      document.createElement(
        "col"
      );


    const columnInfo =
      sheet["!cols"]?.[
        column
      ];


    let widthPx =
      Number(
        columnInfo?.wpx
      );


    if (
      !Number.isFinite(
        widthPx
      ) ||
      widthPx <=
        0
    ) {
      const widthChars =
        Number(
          columnInfo?.wch
        );


      if (
        Number.isFinite(
          widthChars
        ) &&
        widthChars >
          0
      ) {
        /*
          Excel 문자폭 → 브라우저 px
        */
        widthPx =
          widthChars *
          7.2 +
          5;

      } else {
        widthPx =
          54;
      }
    }


    /*
      예전처럼 150px에서 잘라버리지 않는다.

      원본 Excel의 상대적인 열 폭을
      그대로 살린다.
    */
    widthPx =
      Math.max(
        6,
        widthPx
      );


    const loggingWidthPx =
      getEqualizedLoggingColumnWidth(
        sheet,
        column,
        "px"
      );

    if (
      Number.isFinite(
        loggingWidthPx
      ) &&
      loggingWidthPx >
        0
    ) {
      widthPx =
        Math.max(
          6,
          loggingWidthPx
        );
    }


    col.style.width =
      `${widthPx}px`;


    col.style
      .minWidth =
      `${widthPx}px`;


    columnGroup
      .appendChild(
        col
      );
  }


  table.appendChild(
    columnGroup
  );


  const tableBody =
    document.createElement(
      "tbody"
    );


  /* =====================================================
    Excel 원본 행 높이
  ====================================================== */

  for (
    let row =
      renderRange.s.r;

    row <=
      renderRange.e.r;

    row +=
      1
  ) {
    const tableRow =
      document.createElement(
        "tr"
      );


    tableRow.dataset
      .excelRow =
      String(
        row + 1
      );


    const rowInfo =
      sheet["!rows"]?.[
        row
      ];


    let rowHeight =
      Number(
        rowInfo?.hpx
      );


    if (
      !Number.isFinite(
        rowHeight
      ) ||
      rowHeight <=
        0
    ) {
      const rowHeightPt =
        Number(
          rowInfo?.hpt
        );


      if (
        Number.isFinite(
          rowHeightPt
        ) &&
        rowHeightPt >
          0
      ) {
        rowHeight =
          rowHeightPt *
          96 /
          72;

      } else {
        /*
          Excel 기본 행높이
          약 15pt
        */
        rowHeight =
          20;
      }
    }


    /*
      기존 18~86px 제한 제거.
    */
    rowHeight =
      Math.max(
        4,
        rowHeight
      );


    tableRow.style.height =
      `${rowHeight}px`;


    tableRow.dataset
      .excelOriginalHeight =
      String(
        rowHeight
      );


    for (
      let column =
        renderRange.s.c;

      column <=
        renderRange.e.c;

      column +=
        1
    ) {
      const address =
        XLSX.utils
          .encode_cell({
            r:
              row,

            c:
              column
          });


      if (
        slaveAddresses.has(
          address
        )
      ) {
        continue;
      }


      const cell =
        document.createElement(
          "td"
        );


      cell.dataset
        .cellAddress =
        address;


      const merge =
        anchorMap.get(
          address
        );


      if (
        merge
      ) {
        cell.colSpan =
          merge.e.c -
          merge.s.c +
          1;


        cell.rowSpan =
          merge.e.r -
          merge.s.r +
          1;
      }


      const workbookCell =
        sheet[
          address
        ];


      applyCellStyle(
        cell,
        workbookCell
      );


      if (
        editable.has(
          address
        )
      ) {
        cell.classList.add(
          "is-editable"
        );


        if (
          Object.prototype
            .hasOwnProperty
            .call(
              state.values,
              address
            ) &&
          state.values[
            address
          ] !==
            state.loadedValues[
              address
            ]
        ) {
          cell.classList.add(
            "is-changed"
          );
        }


        const editor =
          createEditorControl(
            sheet,
            state.sheetConfig,
            address
          );


        const printValue =
          document.createElement(
            "span"
          );


        printValue.className =
          "log-sheet-cell-print-value";


        printValue.textContent =
          editor.value;


        cell.append(
          editor,
          printValue
        );

      } else {
        const value =
          document.createElement(
            "span"
          );


        value.className =
          "log-sheet-cell-value";


        const loggingHeaderValue =
          getLoggingScheduleHeaderValue(
            address
          );


        value.textContent =
          loggingHeaderValue ??
          getCellDisplayValue(
            sheet,
            address
          );


        cell.appendChild(
          value
        );
      }


      tableRow
        .appendChild(
          cell
        );
    }


    tableBody
      .appendChild(
        tableRow
      );
  }


  table.appendChild(
    tableBody
  );


  elements.grid
    .replaceChildren(
      table
    );


  elements.gridShell.hidden =
    false;


  elements.previewButton.disabled =
    false;


  updatePrintHeading();
}

  function renderAuxiliaryControls() {
    const addresses =
      state.sheetConfig
        ?.auxiliaryControlCells ||
      [];

    if (!addresses.length) {
      elements.auxiliaryControls.hidden =
        true;

      elements.auxiliaryControls
        .replaceChildren();

      return;
    }

    const sheet =
      state.workbook?.Sheets?.[
        state.sheetConfig.sheetName
      ];

    const fragment =
      document.createDocumentFragment();

    addresses.forEach(
      address => {
        const label =
          document.createElement(
            "label"
          );

        const caption =
          document.createElement(
            "span"
          );

        caption.textContent =
          address === "P2"
            ? "순찰 파트"
            : address;

        const control =
          createEditorControl(
            sheet,
            state.sheetConfig,
            address
          );

        label.append(
          caption,
          control
        );

        fragment.appendChild(
          label
        );
      }
    );

    elements.auxiliaryControls
      .replaceChildren(
        fragment
      );

    elements.auxiliaryControls.hidden =
      false;
  }

  function updateDirtyState() {
    const valuesChanged =
      stableJson(
        state.values
      ) !==
      stableJson(
        state.loadedValues
      );

    const generatedChanged =
      stableJson(
        state.generatedValues
      ) !==
      stableJson(
        state.loadedGeneratedValues
      );

    setDirty(
      valuesChanged ||
      generatedChanged ||
      state.identityChanged
    );
  }

  function updatePrintHeading() {
    const identity =
      getIdentity();

    elements.printTitle.textContent =
      state.sheetConfig?.title ||
      state.documentConfig?.title ||
      "Log Sheet";

    elements.printMeta.textContent =
      identity.shift === "ALL"
        ? `${identity.date} · 일일 통합`
        : `${identity.date} · ${identity.shift}`;

    let printStyle =
      byId(
        "logSheetDynamicPrintStyle"
      );

    if (!printStyle) {
      printStyle =
        document.createElement(
          "style"
        );

      printStyle.id =
        "logSheetDynamicPrintStyle";

      document.head.appendChild(
        printStyle
      );
    }

    const orientation =
      state.sheetConfig?.print?.orientation ===
        "portrait"
        ? "portrait"
        : "landscape";

    printStyle.textContent =
      `@page { size: A4 ${orientation}; margin: 7mm; }`;
  }

  function getTemplateHeaderValue(
    headerName
  ) {
    const header =
      state.sheetConfig?.headerCells?.[
        headerName
      ];

    return header?.address
      ? state.values[
          header.address
        ]
      : undefined;
  }

  function ensureMetadataValues() {
    const headers =
      state.sheetConfig?.headerCells ||
      {};

    const dateHeader =
      headers.date;


    /*
      작성일은 실제 출력물에서
      수기로 작성한다.

      저장자료 구분용 날짜는
      숨겨진 logSheetDate 값을 계속 사용하지만,
      Excel 날짜 셀에는 자동 입력하지 않는다.
    */
    if (
      dateHeader?.address
    ) {
      state.values[
        dateHeader.address
      ] = "";
    }

    const shiftTeamHeader =
      headers.shiftTeam;

    if (
      shiftTeamHeader?.address &&
      !Object.prototype.hasOwnProperty.call(
        state.values,
        shiftTeamHeader.address
      )
    ) {
      state.values[
        shiftTeamHeader.address
      ] = getIdentity().shift ===
        "ALL"
        ? ""
        : getIdentity().shift;
    }
  }

  function createGeneratedSnapshot() {
    if (
      state.sheetConfig?.key !==
        "electrical-patrol"
    ) {
      return {};
    }

    const result = {};
    const patrolSheet =
      state.workbook.Sheets[
        state.sheetConfig.sheetName
      ];
    const randomSheet =
      state.workbook.Sheets[
        "랜덤"
      ];
    const part =
      Math.min(
        4,
        Math.max(
          1,
          Number(
            state.values.P2 ||
            getCellDisplayValue(
              patrolSheet,
              "P2"
            ) ||
            3
          ) || 3
        )
      );

    const nameAddress =
      `${[
        "S",
        "T",
        "U",
        "V"
      ][part - 1]}7`;

    [
      "D6",
      "D12",
      "D18",
      "D24"
    ].forEach(
      address => {
        result[address] =
          randomSheet?.[
            nameAddress
          ]?.v ?? "";
      }
    );

    for (
      let row = 6;
      row <= 28;
      row += 1
    ) {
      const targetAddress =
        `F${row}`;

      const formula =
        normalizeText(
          patrolSheet?.[
            targetAddress
          ]?.f
        );

      const sourceMatch =
        formula.match(
          /랜덤!\$?([A-Z]+)\$?(\d+)/i
        );

      const sourceAddress =
        sourceMatch
          ? `${sourceMatch[1].toUpperCase()}${sourceMatch[2]}`
          : "";

      result[targetAddress] =
        sourceAddress
          ? randomSheet?.[
              sourceAddress
            ]?.v ?? ""
          : patrolSheet?.[
              targetAddress
            ]?.v ?? "";
    }

    return result;
  }

  async function loadTemplate() {
    const templateFile =
      state.documentConfig.templateFile;

    let cached =
      templateCache.get(
        templateFile
      );

    if (!cached) {
      const templateUrl =
        state.documentConfig
          .templateSha256
          ? `${templateFile}?v=${state.documentConfig.templateSha256.slice(
              0,
              12
            )}`
          : templateFile;

      const response =
        await fetch(
          templateUrl,
          {
            cache: "force-cache"
          }
        );

      if (!response.ok) {
        throw new Error(
          `원본 엑셀 양식을 불러오지 못했습니다. (${response.status})`
        );
      }

      const buffer =
        await response.arrayBuffer();

      await verifyTemplateHash(
        buffer,
        state.documentConfig
          .templateSha256
      );

      const workbook =
        XLSX.read(
          buffer,
          {
            type: "array",
            cellStyles: true,
            cellFormula: true,
            cellDates: false,
            cellNF: true
          }
        );

      cached = {
        buffer,
        workbook
      };

      templateCache.set(
        templateFile,
        cached
      );
    }

    state.templateBuffer =
      cached.buffer;

    state.workbook =
      cached.workbook;
  }

  function getIdentity() {
    const identityPolicy =
      getIdentityPolicy(
        state.sheetConfig.key
      );

    return {
      templateKey:
        getApiTemplateKey(
          state.sheetConfig.key
        ),
      sheetKey:
        state.sheetConfig.key,
      date:
        elements.date.value,
      shift:
        identityPolicy.shift,
      team:
        identityPolicy.team
    };
  }

  function getIdentityPolicy(
    sheetKey
  ) {
    if (
      sheetKey.startsWith(
        "field-day-"
      )
    ) {
      return {
        shift: "D/S",
        team: ""
      };
    }

    if (
      sheetKey.startsWith(
        "field-night-"
      ) ||
      sheetKey.startsWith(
        "electrical-"
      )
    ) {
      return {
        shift: "N/S",
        team: ""
      };
    }

    return {
      shift: "ALL",
      team: ""
    };
  }

  function applyIdentityPolicy() {
    const policy =
      getIdentityPolicy(
        state.sheetConfig.key
      );

    const shiftLabel =
      elements.shift.closest(
        "label"
      );

    const teamLabel =
      elements.team.closest(
        "label"
      );

    if (shiftLabel) {
      shiftLabel.hidden =
        true;
    }

    if (teamLabel) {
      teamLabel.hidden =
        true;
    }

    if (
      policy.shift !== "ALL"
    ) {
      elements.shift.value =
        policy.shift;
    }
  }

  function getApiTemplateKey(
    sheetKey
  ) {
    if (
      sheetKey.startsWith(
        "integrated-"
      )
    ) {
      return "integrated-control";
    }

    if (
      sheetKey.startsWith(
        "field-"
      )
    ) {
      return "field";
    }

    if (
      sheetKey.startsWith(
        "electrical-"
      )
    ) {
      return "electrical";
    }

    if (
      sheetKey ===
        "aux-control-room"
    ) {
      return "aux-boiler-control-room";
    }

    if (
      sheetKey ===
        "aux-field"
    ) {
      return "aux-boiler-field";
    }

    return sheetKey;
  }

  function createRecordUrl(
    options = {}
  ) {
    const identity =
      getIdentity();

    const search =
      new URLSearchParams({
        sheetKey:
          identity.sheetKey,
        date:
          identity.date,
        shift:
          identity.shift,
        team:
          identity.team
      });

    if (options.history) {
      search.set(
        "history",
        "1"
      );
    }

    return `${config.apiPath}?${search}`;
  }

function applyRecord(
  record
) {
  state.record =
    record || null;


  state.values =
    cloneObject(
      record?.values
    );


  state.generatedValues =
    cloneObject(
      record?.generatedValues
    );


  ensureMetadataValues();


  if (
    state.sheetConfig.key ===
      "electrical-patrol" &&
    !Object.keys(
      state.generatedValues
    ).length
  ) {
    state.generatedValues =
      createGeneratedSnapshot();
  }


  state.loadedValues =
    cloneObject(
      state.values
    );


  state.loadedGeneratedValues =
    cloneObject(
      state.generatedValues
    );


  state.identityChanged =
    false;


  updateRevisionText();

  renderAuxiliaryControls();

  /*
    현재 선택된 양식 상태를 반영해서
    Logging 항목 목록도 다시 그린다.
  */
  renderLoggingItemList();

  renderGridIfPreviewVisible();

  setDirty(false);
}

async function loadRecord(
  options = {}
) {
  if (
    state.isBusy
  ) {
    return;
  }


  if (
    state.isDirty &&
    !options.skipDirtyConfirmation &&
    !window.confirm(
      "저장하지 않은 변경사항이 있습니다. 저장자료를 다시 불러올까요?"
    )
  ) {
    return;
  }


  setBusy(
    true,
    `${elements.date.value} 저장자료를 확인하고 있습니다.`
  );


  try {
    const payload =
      await requestApi(
        createRecordUrl()
      );


    const record =
      payload.record ||
      null;


    /* ===================================================
      기존에 저장된 Log Sheet
    =================================================== */

    if (
      record
    ) {
      /*
        양식 버전 기능 도입 이후 작성된 기록은
        당시 저장했던 양식을 그대로 사용한다.
      */
      if (
        record.templateSnapshot
      ) {
        applyLoggingTemplateState(
          record.templateSnapshot
        );

      } else {
        /*
          양식 버전 기능 도입 전에 작성된 기록은
          최신 양식을 덮어쓰지 않고
          원본 Excel 양식을 사용한다.
        */
        applyLoggingTemplateState(
          null
        );
      }


    /* ===================================================
      아직 저장되지 않은 신규 Log Sheet
    =================================================== */

    } else {
      const activeTemplate =
        await loadActiveLoggingTemplate();


      /*
        공용 양식이 있으면 최신 양식,
        없으면 원본 Excel 양식
      */
      applyLoggingTemplateState(
        activeTemplate
      );
    }


    applyRecord(
      record
    );


  } catch (
    error
  ) {
    console.error(
      "Log Sheet 조회 실패:",
      error
    );


    setStatus(
      "조회 실패",
      error.message,
      "error"
    );


  } finally {
    setBusy(
      false
    );
  }
}

  async function saveRecord() {
    if (state.isBusy) {
      return;
    }

    ensureMetadataValues();

    if (
      state.sheetConfig.key ===
        "electrical-patrol" &&
      !Object.keys(
        state.generatedValues
      ).length
    ) {
      state.generatedValues =
        createGeneratedSnapshot();
    }

    setBusy(
      true,
      "변경된 전체 값을 한 번의 요청으로 저장하고 있습니다."
    );

    try {
      const identity =
        getIdentity();

      const payload =
        await requestApi(
          config.apiPath,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              id:
                state.record?.id ||
                undefined,
              sheetKey:
                identity.sheetKey,
              templateKey:
                identity.templateKey,
              date:
                identity.date,
              shift:
                identity.shift,
              team:
                identity.team,
              values:
                state.values,
              generatedValues:
                state.sheetConfig.key ===
                  "electrical-patrol"
                  ? state.generatedValues
                  : undefined,
              expectedRevision:
                Number(
                  state.record?.revision
                ) || 0
            })
          }
        );

      applyRecord(
        payload.record
      );

      setStatus(
        "저장 완료",
        "공용 저장자료에 반영했습니다.",
        "saved"
      );

    } catch (
      error
    ) {
      console.error(
        "Log Sheet 저장 실패:",
        error
      );

      if (
        error.status === 409
      ) {
        const currentRecord =
          error.payload?.currentRecord;

        setStatus(
          "충돌 발생",
          "다른 사용자가 먼저 저장했습니다. 최신 자료를 불러온 뒤 다시 수정해 주세요.",
          "error"
        );

        if (
          currentRecord &&
          window.confirm(
            "다른 사용자의 최신 저장본을 지금 불러올까요? 현재 입력값은 사라집니다."
          )
        ) {
          applyRecord(
            currentRecord
          );
        }

      } else {
        setStatus(
          "저장 실패",
          error.message,
          "error"
        );
      }

    } finally {
      setBusy(false);
    }
  }

  async function showHistory() {
    if (state.isBusy) {
      return;
    }

    if (!state.record) {
      elements.historyList.textContent =
        "아직 저장된 수정 이력이 없습니다.";

      elements.historyDialog.showModal();

      return;
    }

    setBusy(
      true,
      "수정 이력을 불러오고 있습니다."
    );

    try {
      const payload =
        await requestApi(
          createRecordUrl({
            history: true
          })
        );

      renderHistory(
        payload.history || []
      );

      elements.historyDialog.showModal();

      setDirty(
        state.isDirty
      );

    } catch (
      error
    ) {
      setStatus(
        "이력 조회 실패",
        error.message,
        "error"
      );

    } finally {
      setBusy(false);
    }
  }

  function renderHistory(
    history
  ) {
    if (!history.length) {
      elements.historyList.textContent =
        "저장된 수정 이력이 없습니다.";

      return;
    }

    const fragment =
      document.createDocumentFragment();

    history.forEach(
      item => {
        const row =
          document.createElement(
            "div"
          );

        row.className =
          "log-sheet-history-item";

        const revision =
          document.createElement("b");
        const author =
          document.createElement("span");
        const changedAt =
          document.createElement("time");

        revision.textContent =
          `v${Number(
            item.revision
          ) || 1} · ${normalizeText(
            item.action
          ) || "저장"}`;

        author.textContent =
          normalizeText(
            item.changedByName ||
            item.updatedByName
          ) || "작성자";

        changedAt.textContent =
          formatTimestamp(
            item.changedAt ||
            item.updatedAt
          );

        row.append(
          revision,
          author,
          changedAt
        );

        fragment.appendChild(
          row
        );
      }
    );

    elements.historyList.replaceChildren(
      fragment
    );
  }

  function resolveRoute() {
    const search =
      new URLSearchParams(
        window.location.search
      );

    const requestedType =
      normalizeText(
        search.get("type")
      ) ||
      config.defaultType;

    const alias =
      config.routeAliases?.[
        requestedType
      ];

    const type =
      alias?.type ||
      requestedType;

    const documentConfig =
      config.documents[type];

    if (!documentConfig) {
      throw new Error(
        `등록되지 않은 Log Sheet입니다: ${requestedType}`
      );
    }

    const requestedSheetKey =
      normalizeText(
        search.get("sheet")
      ) ||
      alias?.sheetKey ||
      documentConfig.sheets[0].key;

    const sheetConfig =
      documentConfig.sheets.find(
        item =>
          item.key ===
          requestedSheetKey
      ) ||
      documentConfig.sheets[0];

    return {
      documentConfig,
      sheetConfig
    };
  }

  function renderTabs() {
    const sheets =
      state.documentConfig.sheets;

    if (
      sheets.length < 2
    ) {
      elements.tabs.hidden =
        true;

      elements.tabs.replaceChildren();

      return;
    }

    const fragment =
      document.createDocumentFragment();

    sheets.forEach(
      sheetConfig => {
        const button =
          document.createElement(
            "button"
          );

        button.type =
          "button";

        button.textContent =
          sheetConfig.title;

        button.classList.toggle(
          "is-active",
          sheetConfig.key ===
            state.sheetConfig.key
        );

        button.setAttribute(
          "aria-pressed",
          sheetConfig.key ===
            state.sheetConfig.key
            ? "true"
            : "false"
        );

        button.addEventListener(
          "click",
          () => switchSheet(
            sheetConfig
          )
        );

        fragment.appendChild(
          button
        );
      }
    );

    elements.tabs.replaceChildren(
      fragment
    );

    elements.tabs.hidden =
      false;
  }

  async function switchSheet(
    sheetConfig
  ) {
    if (
      sheetConfig.key ===
        state.sheetConfig.key ||
      state.isBusy
    ) {
      return;
    }

    if (
      state.isDirty &&
      !window.confirm(
        "저장하지 않은 변경사항이 있습니다. 다른 시트로 이동할까요?"
      )
    ) {
      return;
    }

    state.sheetConfig =
      sheetConfig;

    resetLoggingIntervalForCurrentSheet();

    applyIdentityPolicy();

    state.record =
      null;
    state.values =
      {};
    state.generatedValues =
      {};
    state.loadedValues =
      {};
    state.loadedGeneratedValues =
      {};
    state.identityChanged =
      false;

    ensureMetadataValues();

    if (
      sheetConfig.key ===
        "electrical-patrol"
    ) {
      state.generatedValues =
        createGeneratedSnapshot();
    }

    renderTabs();
    renderAuxiliaryControls();
    renderLoggingItemList();
    renderGridIfPreviewVisible();

    await loadRecord({
      skipDirtyConfirmation: true
    });
  }

  function handleIdentityChange(
    event
  ) {
    const changedControl =
      event?.currentTarget;

    if (
      state.isDirty &&
      !window.confirm(
        "저장하지 않은 변경사항이 있습니다. 조회 기준을 변경할까요?"
      )
    ) {
      if (
        changedControl &&
        changedControl.dataset
          .previousValue !==
          undefined
      ) {
        changedControl.value =
          changedControl.dataset
            .previousValue;
      }

      return false;
    }

    if (changedControl) {
      changedControl.dataset
        .previousValue =
        changedControl.value;
    }

    state.record =
      null;
    state.values =
      {};
    state.generatedValues =
      {};
    state.loadedValues =
      {};
    state.loadedGeneratedValues =
      {};
    state.identityChanged =
      true;

    ensureMetadataValues();

    if (
      state.sheetConfig.key ===
        "electrical-patrol"
    ) {
      state.generatedValues =
        createGeneratedSnapshot();
    }

    updateRevisionText();
    renderAuxiliaryControls();
    renderGridIfPreviewVisible();

    updateDirtyState();

    setStatus(
      "기준 변경",
      "새 기준의 저장자료를 확인하려면 저장자료 불러오기를 누르세요.",
      "dirty"
    );

    return true;
  }

  function columnNumberFromAddress(
    address
  ) {
    const letters =
      address.match(
        /^[A-Z]+/i
      )?.[0]
        ?.toUpperCase() || "";

    return [...letters].reduce(
      (total, letter) =>
        total * 26 +
        letter.charCodeAt(0) -
        64,
      0
    );
  }

  function normalizeZipPath(
    basePath,
    target
  ) {
    if (
      target.startsWith("/")
    ) {
      return target.slice(1);
    }

    const parts =
      `${basePath}/${target}`
        .split("/");

    const normalized = [];

    parts.forEach(
      part => {
        if (
          !part ||
          part === "."
        ) {
          return;
        }

        if (part === "..") {
          normalized.pop();
        } else {
          normalized.push(part);
        }
      }
    );

    return normalized.join("/");
  }

  function findWorksheetPath(
    workbookXmlText,
    relationshipsText,
    sheetName
  ) {
    const parser =
      new DOMParser();

    const workbookDocument =
      parser.parseFromString(
        workbookXmlText,
        "application/xml"
      );

    const sheetElement = [
      ...workbookDocument
        .getElementsByTagName("sheet")
    ].find(
      sheet =>
        sheet.getAttribute("name") ===
        sheetName
    );

    if (!sheetElement) {
      throw new Error(
        `엑셀 시트 연결정보가 없습니다: ${sheetName}`
      );
    }

    const relationshipId =
      sheetElement.getAttribute(
        "r:id"
      ) ||
      sheetElement.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "id"
      );

    const relationshipsDocument =
      parser.parseFromString(
        relationshipsText,
        "application/xml"
      );

    const relationship = [
      ...relationshipsDocument
        .getElementsByTagName("Relationship")
    ].find(
      item =>
        item.getAttribute("Id") ===
        relationshipId
    );

    if (!relationship) {
      throw new Error(
        `엑셀 시트 파일 연결정보가 없습니다: ${sheetName}`
      );
    }

    return normalizeZipPath(
      "xl",
      relationship.getAttribute(
        "Target"
      )
    );
  }

  function createOrFindCell(
    worksheetDocument,
    address
  ) {
    const namespace =
      worksheetDocument.documentElement
        .namespaceURI;

    const existing = [
      ...worksheetDocument
        .getElementsByTagName("c")
    ].find(
      cell =>
        cell.getAttribute("r") ===
        address
    );

    if (existing) {
      return existing;
    }

    const rowNumber =
      Number(
        address.match(/\d+$/)?.[0]
      );

    const sheetData =
      worksheetDocument
        .getElementsByTagName(
          "sheetData"
        )[0];

    let rowElement = [
      ...sheetData
        .getElementsByTagName("row")
    ].find(
      row =>
        Number(
          row.getAttribute("r")
        ) === rowNumber
    );

    if (!rowElement) {
      rowElement =
        worksheetDocument
          .createElementNS(
            namespace,
            "row"
          );

      rowElement.setAttribute(
        "r",
        String(rowNumber)
      );

      const nextRow = [
        ...sheetData.children
      ].find(
        row =>
          Number(
            row.getAttribute("r")
          ) > rowNumber
      );

      sheetData.insertBefore(
        rowElement,
        nextRow || null
      );
    }

    const cell =
      worksheetDocument
        .createElementNS(
          namespace,
          "c"
        );

    cell.setAttribute(
      "r",
      address
    );

    const columnNumber =
      columnNumberFromAddress(
        address
      );

    const nextCell = [
      ...rowElement.children
    ].find(
      currentCell =>
        columnNumberFromAddress(
          currentCell.getAttribute("r")
        ) > columnNumber
    );

    rowElement.insertBefore(
      cell,
      nextCell || null
    );

    return cell;
  }



  function applyLoggingScheduleColumnWidthsToWorksheet(
    worksheetDocument
  ) {
    const schedule =
      getLoggingScheduleConfig();

    const groups =
      getLoggingTimeGroups();

    if (
      !schedule ||
      !groups.length
    ) {
      return;
    }

    const startColumn =
      XLSX.utils.decode_col(
        schedule.startColumn
      );

    const endColumn =
      XLSX.utils.decode_col(
        schedule.endColumn
      );

    const totalColumns =
      endColumn -
      startColumn +
      1;

    if (
      groups.length ===
        totalColumns
    ) {
      return;
    }

    const namespace =
      worksheetDocument
        .documentElement
        .namespaceURI;

    let cols =
      worksheetDocument
        .getElementsByTagName(
          "cols"
        )[0];

    if (!cols) {
      cols =
        worksheetDocument
          .createElementNS(
            namespace,
            "cols"
          );

      const sheetData =
        worksheetDocument
          .getElementsByTagName(
            "sheetData"
          )[0];

      sheetData.parentNode
        .insertBefore(
          cols,
          sheetData
        );
    }

    const existingDefinitions =
      [
        ...cols
          .getElementsByTagName(
            "col"
          )
      ]
        .map(
          element => {
            const attributes =
              {};

            [
              ...element.attributes
            ].forEach(
              attribute => {
                attributes[
                  attribute.name
                ] =
                  attribute.value;
              }
            );

            return {
              min:
                Number(
                  attributes.min
                ),

              max:
                Number(
                  attributes.max
                ),

              attributes
            };
          }
        )
        .filter(
          definition =>
            Number.isInteger(
              definition.min
            ) &&
            Number.isInteger(
              definition.max
            )
        );

    const excelStartColumn =
      startColumn +
      1;

    const excelEndColumn =
      endColumn +
      1;

    const outputDefinitions =
      [];

    existingDefinitions.forEach(
      definition => {
        if (
          definition.max <
            excelStartColumn ||
          definition.min >
            excelEndColumn
        ) {
          outputDefinitions.push(
            {
              ...definition.attributes
            }
          );

          return;
        }

        if (
          definition.min <
            excelStartColumn
        ) {
          outputDefinitions.push({
            ...definition.attributes,

            max:
              String(
                excelStartColumn -
                1
              )
          });
        }

        if (
          definition.max >
            excelEndColumn
        ) {
          outputDefinitions.push({
            ...definition.attributes,

            min:
              String(
                excelEndColumn +
                1
              )
          });
        }
      }
    );

    const sheet =
      state.workbook?.Sheets?.[
        state.sheetConfig
          .sheetName
      ];

    for (
      let column =
        startColumn;
      column <=
        endColumn;
      column +=
        1
    ) {
      const excelColumn =
        column +
        1;

      const sourceDefinition =
        existingDefinitions.find(
          definition =>
            excelColumn >=
              definition.min &&
            excelColumn <=
              definition.max
        );

      const width =
        getEqualizedLoggingColumnWidth(
          sheet,
          column,
          "chars"
        );

      const attributes = {
        ...(
          sourceDefinition
            ?.attributes ||
          {}
        ),

        min:
          String(
            excelColumn
          ),

        max:
          String(
            excelColumn
          ),

        width:
          Number(
            width ||
            getOriginalLoggingColumnWidthChars(
              sheet,
              column
            )
          )
            .toFixed(
              6
            ),

        customWidth:
          "1"
      };

      /*
        폭을 직접 지정하므로 bestFit은 제거한다.
      */
      delete attributes.bestFit;

      outputDefinitions.push(
        attributes
      );
    }

    outputDefinitions.sort(
      (
        left,
        right
      ) =>
        Number(
          left.min
        ) -
        Number(
          right.min
        )
    );

    while (
      cols.firstChild
    ) {
      cols.removeChild(
        cols.firstChild
      );
    }

    outputDefinitions.forEach(
      attributes => {
        const element =
          worksheetDocument
            .createElementNS(
              namespace,
              "col"
            );

        Object.entries(
          attributes
        ).forEach(
          (
            [
              name,
              value
            ]
          ) => {
            element.setAttribute(
              name,
              String(value)
            );
          }
        );

        cols.appendChild(
          element
        );
      }
    );
  }


function applyLoggingScheduleToWorksheet(
    worksheetDocument
  ) {
    const schedule =
      getLoggingScheduleConfig();

    const groups =
      getLoggingTimeGroups();

    const rows =
      getLoggingScheduleRows();

    if (
      !schedule ||
      !groups.length ||
      !rows.size
    ) {
      return;
    }

    const namespace =
      worksheetDocument
        .documentElement
        .namespaceURI;

    const startColumn =
      XLSX.utils.decode_col(
        schedule.startColumn
      );

    const endColumn =
      XLSX.utils.decode_col(
        schedule.endColumn
      );

    applyLoggingScheduleColumnWidthsToWorksheet(
      worksheetDocument
    );

    let mergeCells =
      worksheetDocument
        .getElementsByTagName(
          "mergeCells"
        )[0];

    if (!mergeCells) {
      mergeCells =
        worksheetDocument
          .createElementNS(
            namespace,
            "mergeCells"
          );

      const sheetData =
        worksheetDocument
          .getElementsByTagName(
            "sheetData"
          )[0];

      sheetData.parentNode
        .insertBefore(
          mergeCells,
          sheetData.nextSibling
        );
    }

    [
      ...mergeCells
        .getElementsByTagName(
          "mergeCell"
        )
    ].forEach(
      mergeCell => {
        const reference =
          mergeCell.getAttribute(
            "ref"
          );

        if (!reference) {
          return;
        }

        let range;

        try {
          range =
            XLSX.utils.decode_range(
              reference
            );
        } catch {
          return;
        }

        if (
          range.s.r ===
            range.e.r &&
          rows.has(
            range.s.r
          ) &&
          range.s.c >=
            startColumn &&
          range.e.c <=
            endColumn
        ) {
          mergeCell.remove();
        }
      }
    );

    rows.forEach(
      row => {
        groups.forEach(
          group => {
            const anchorAddress =
              XLSX.utils.encode_cell({
                r:
                  row,

                c:
                  group.startColumn
              });

            if (
              (
                schedule.headerRows ||
                []
              ).includes(
                row +
                1
              )
            ) {
              patchCellValue(
                worksheetDocument,
                anchorAddress,
                group.label,
                {
                  removeFormula:
                    true
                }
              );
            }

            for (
              let column =
                group.startColumn +
                1;
              column <=
                group.endColumn;
              column +=
                1
            ) {
              patchCellValue(
                worksheetDocument,
                XLSX.utils.encode_cell({
                  r:
                    row,

                  c:
                    column
                }),
                "",
                {
                  removeFormula:
                    true
                }
              );
            }

            if (
              group.endColumn <=
                group.startColumn
            ) {
              return;
            }

            const mergeCell =
              worksheetDocument
                .createElementNS(
                  namespace,
                  "mergeCell"
                );

            mergeCell.setAttribute(
              "ref",
              XLSX.utils.encode_cell({
                r:
                  row,

                c:
                  group.startColumn
              }) +
              ":" +
              XLSX.utils.encode_cell({
                r:
                  row,

                c:
                  group.endColumn
              })
            );

            mergeCells.appendChild(
              mergeCell
            );
          }
        );
      }
    );

    mergeCells.setAttribute(
      "count",
      String(
        mergeCells
          .getElementsByTagName(
            "mergeCell"
          )
          .length
      )
    );
  }

  function patchCellValue(
    worksheetDocument,
    address,
    value,
    options = {}
  ) {
    const cell =
      createOrFindCell(
        worksheetDocument,
        address
      );

    [
      ...cell.children
    ].forEach(
      child => {
        if (
          [
            "v",
            "is"
          ].includes(
            child.localName
          ) ||
          (
            options.removeFormula &&
            child.localName === "f"
          )
        ) {
          child.remove();
        }
      }
    );

    cell.removeAttribute("t");

    const text =
      String(
        value ?? ""
      );

    if (text === "") {
      return;
    }

    const originalCell =
      state.workbook.Sheets[
        state.sheetConfig.sheetName
      ]?.[address];

    const numeric =
      options.forceNumber ||
      (
        originalCell?.t === "n" &&
        /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(
          text.replaceAll(
            ",",
            ""
          )
        )
      );

    const namespace =
      worksheetDocument.documentElement
        .namespaceURI;

    if (numeric) {
      const valueElement =
        worksheetDocument
          .createElementNS(
            namespace,
            "v"
          );

      valueElement.textContent =
        text.replaceAll(
          ",",
          ""
        );

      cell.appendChild(
        valueElement
      );

      return;
    }

    cell.setAttribute(
      "t",
      "inlineStr"
    );

    const inlineString =
      worksheetDocument
        .createElementNS(
          namespace,
          "is"
        );

    const textElement =
      worksheetDocument
        .createElementNS(
          namespace,
          "t"
        );

    if (
      /^\s|\s$|\n/.test(text)
    ) {
      textElement.setAttributeNS(
        "http://www.w3.org/XML/1998/namespace",
        "xml:space",
        "preserve"
      );
    }

    textElement.textContent =
      text;

    inlineString.appendChild(
      textElement
    );

    cell.appendChild(
      inlineString
    );
  }

async function createPatchedWorkbookBlob() {
  const zip =
    await JSZip.loadAsync(
      state.templateBuffer.slice(0)
    );

  const workbookXml =
    await zip.file(
      "xl/workbook.xml"
    ).async("string");

  const relationshipsXml =
    await zip.file(
      "xl/_rels/workbook.xml.rels"
    ).async("string");

  const worksheetPath =
    findWorksheetPath(
      workbookXml,
      relationshipsXml,
      state.sheetConfig.sheetName
    );

  const worksheetFile =
    zip.file(
      worksheetPath
    );

  if (!worksheetFile) {
    throw new Error(
      `Log Sheet 시트 파일을 찾을 수 없습니다: ${worksheetPath}`
    );
  }

  const worksheetText =
    await worksheetFile.async(
      "string"
    );

  const worksheetDocument =
    new DOMParser()
      .parseFromString(
        worksheetText,
        "application/xml"
      );


  /* =======================================================
    기존 입력값 반영
  ======================================================= */

  Object.entries(
    state.values
  ).forEach(
    ([address, value]) => {
      patchCellValue(
        worksheetDocument,
        address,
        value
      );
    }
  );


  /* =======================================================
    자동 생성값 반영
  ======================================================= */

  Object.entries(
    state.generatedValues
  ).forEach(
    ([address, value]) => {
      patchCellValue(
        worksheetDocument,
        address,
        value,
        {
          removeFormula: true
        }
      );
    }
  );


  /* =======================================================
    Logging 항목 수정값 반영
  ======================================================= */

  extractLoggingItems()
    .forEach(
      item => {
        const draftKey =
          getLoggingItemDraftKey(
            item
          );

        const draft =
          loggingItemDrafts.get(
            draftKey
          );

        if (!draft) {
          return;
        }


        const section =
          getLoggingItemSectionForItem(
            item
          );

        if (!section) {
          return;
        }


        const rowNumber =
          Number(
            item.sourceRow
          );

        if (
          !Number.isFinite(
            rowNumber
          )
        ) {
          return;
        }


        /* -----------------------------------------------
          항목명
        ----------------------------------------------- */

        const nameColumns =
          Array.isArray(
            section.nameColumns
          )
            ? section.nameColumns
            : [];


        const uniqueNameColumns =
          [
            ...new Set(
              nameColumns
            )
          ];


        uniqueNameColumns.forEach(
          (
            columnName,
            index
          ) => {
            patchCellValue(
              worksheetDocument,
              `${columnName}${rowNumber}`,
              index === 0
                ? draft.name
                : ""
            );
          }
        );


        /* -----------------------------------------------
          TAG
        ----------------------------------------------- */

        if (
          section.tagColumn
        ) {
          patchCellValue(
            worksheetDocument,
            `${section.tagColumn}${rowNumber}`,
            draft.tag || ""
          );
        }


        /* -----------------------------------------------
          단위
        ----------------------------------------------- */

        if (
          section.unitColumn
        ) {
          patchCellValue(
            worksheetDocument,
            `${section.unitColumn}${rowNumber}`,
            draft.unit || ""
          );
        }
      }
    );


  /* =======================================================
    로깅 시간 주기 반영

    입력값 / 항목 수정까지 끝난 뒤 적용하여
    병합 slave 셀의 숨은 값을 마지막에 정리한다.
  ======================================================= */

  applyLoggingScheduleToWorksheet(
    worksheetDocument
  );


  /* =======================================================
    XML 저장
  ======================================================= */

  const serialized =
    new XMLSerializer()
      .serializeToString(
        worksheetDocument
      );

  zip.file(
    worksheetPath,
    serialized
  );


  /* =======================================================
    XLSX 생성
  ======================================================= */

  return zip.generateAsync({
    type: "blob",

    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

    compression:
      "DEFLATE",

    compressionOptions: {
      level: 6
    }
  });
}

  function safeFilename(
    value
  ) {
    return String(value)
      .replace(
        /[\\/:*?"<>|]+/g,
        "_"
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();
  }

  async function downloadWorkbook() {
    if (state.isBusy) {
      return;
    }

    setBusy(
      true,
      "원본 서식을 유지한 엑셀 파일을 만들고 있습니다."
    );

    try {
      const blob =
        await createPatchedWorkbookBlob();

      const objectUrl =
        URL.createObjectURL(
          blob
        );

      const link =
        document.createElement(
          "a"
        );

      link.href =
        objectUrl;

      const identity =
        getIdentity();

      link.download =
        safeFilename(
          `${state.sheetConfig.title}_${identity.date}_${identity.shift}.xlsx`
        );

      document.body.appendChild(
        link
      );

      link.click();
      link.remove();

      setTimeout(
        () => URL.revokeObjectURL(
          objectUrl
        ),
        1000
      );

      setStatus(
        "엑셀 생성",
        "원본 양식에 현재 입력값을 반영한 파일을 다운로드했습니다.",
        state.isDirty
          ? "dirty"
          : "saved"
      );

    } catch (
      error
    ) {
      console.error(
        "Log Sheet 엑셀 생성 실패:",
        error
      );

      setStatus(
        "엑셀 실패",
        error.message,
        "error"
      );

    } finally {
      setBusy(false);
    }
  }

function getLoggingItemSectionForItem(
  item
) {
  const sections =
    getLoggingItemSections(
      state.sheetConfig
    );

  return sections.find(
    section => {
      const ranges =
        section.ranges || [];

      if (!ranges.length) {
        return false;
      }

      const sourceColumn =
        Math.min(
          ...ranges.map(
            rangeText =>
              parseRange(
                rangeText
              ).s.c
          )
        );

      if (
        sourceColumn !==
        item.sourceColumn
      ) {
        return false;
      }

      const rowIndex =
        Number(
          item.sourceRow
        ) - 1;

      return ranges.some(
        rangeText => {
          const range =
            parseRange(
              rangeText
            );

          return (
            rowIndex >= range.s.r &&
            rowIndex <= range.e.r
          );
        }
      );
    }
  ) || null;
}


function getLoggingPreviewCell(
  address
) {
  const sheet =
    state.workbook?.Sheets?.[
      state.sheetConfig.sheetName
    ];

  if (
    !sheet ||
    !elements.grid
  ) {
    return null;
  }

  const target =
    XLSX.utils.decode_cell(
      address
    );

  const merge =
    (
      sheet["!merges"] || []
    ).find(
      item =>
        target.r >= item.s.r &&
        target.r <= item.e.r &&
        target.c >= item.s.c &&
        target.c <= item.e.c
    );

  const anchorAddress =
    merge
      ? XLSX.utils.encode_cell(
          merge.s
        )
      : address;

  return elements.grid.querySelector(
    `td[data-cell-address="${anchorAddress}"]`
  );
}


function setLoggingPreviewCellText(
  cell,
  text
) {
  if (!cell) {
    return;
  }

  const value =
    String(
      text ?? ""
    );

  const editor =
    cell.querySelector(
      ".log-sheet-cell-editor"
    );

  if (editor) {
    editor.value =
      value;

    const printValue =
      cell.querySelector(
        ".log-sheet-cell-print-value"
      );

    if (printValue) {
      printValue.textContent =
        value;
    }
  } else {
    const valueElement =
      cell.querySelector(
        ".log-sheet-cell-value"
      );

    if (valueElement) {
      valueElement.textContent =
        value;
    }
  }

  cell.classList.add(
    "is-template-draft"
  );
}

function applyLoggingItemDraftsToPreview() {
  extractLoggingItems().forEach(
    item => {
      const draftKey =
        getLoggingItemDraftKey(
          item
        );


      const templateOverride =
        loggingItemTemplateOverrides.get(
          draftKey
        );


      const draft =
        loggingItemDrafts.get(
          draftKey
        );


      if (
        !templateOverride &&
        !draft
      ) {
        return;
      }


      const effectiveItem = {
        name:
          item.name,

        tag:
          item.tag,

        unit:
          item.unit,

        ...(templateOverride || {}),

        ...(draft || {})
      };


      const section =
        getLoggingItemSectionForItem(
          item
        );


      if (!section) {
        return;
      }


      /* 항목명 */

      const nameCells =
        new Set();


      let nameWritten =
        false;


      (
        section.nameColumns ||
        []
      ).forEach(
        column => {
          const cell =
            getLoggingPreviewCell(
              `${column}${item.sourceRow}`
            );


          if (
            !cell ||
            nameCells.has(
              cell
            )
          ) {
            return;
          }


          nameCells.add(
            cell
          );


          setLoggingPreviewCellText(
            cell,
            nameWritten
              ? ""
              : effectiveItem.name
          );


          nameWritten =
            true;
        }
      );


      /* TAG */

      if (
        section.tagColumn
      ) {
        setLoggingPreviewCellText(
          getLoggingPreviewCell(
            `${section.tagColumn}${item.sourceRow}`
          ),
          effectiveItem.tag
        );
      }


      /* 단위 */

      if (
        section.unitColumn
      ) {
        setLoggingPreviewCellText(
          getLoggingPreviewCell(
            `${section.unitColumn}${item.sourceRow}`
          ),
          effectiveItem.unit
        );
      }
    }
  );
}


function getLoggingPreviewRow(
  rowNumber
) {
  const targetRow =
    Number(rowNumber) - 1;

  const rows =
    elements.grid?.querySelectorAll(
      ".log-sheet-table tbody tr"
    ) || [];

  return [
    ...rows
  ].find(
    row =>
      [
        ...row.querySelectorAll(
          "td[data-cell-address]"
        )
      ].some(
        cell => {
          const address =
            cell.dataset.cellAddress;

          if (!address) {
            return false;
          }

          return (
            XLSX.utils.decode_cell(
              address
            ).r ===
            targetRow
          );
        }
      )
  ) || null;
}


function prepareAddedLoggingPreviewRow(
  sourceRow
) {
  const row =
    sourceRow.cloneNode(
      true
    );

  row.classList.add(
    "is-template-added-row"
  );


  [
    ...row.querySelectorAll(
      "td"
    )
  ].forEach(
    cell => {
      const address =
        cell.dataset.cellAddress;

      if (address) {
        const decoded =
          XLSX.utils.decode_cell(
            address
          );

        cell.dataset.previewColumn =
          String(
            decoded.c
          );
      }


      cell.removeAttribute(
        "data-cell-address"
      );


      cell.classList.remove(
        "is-editable",
        "is-changed",
        "is-template-draft"
      );


      const value =
        document.createElement(
          "span"
        );

      value.className =
        "log-sheet-cell-value";

      value.textContent =
        "";


      cell.replaceChildren(
        value
      );
    }
  );


  return row;
}


function getAddedLoggingPreviewCell(
  row,
  columnName
) {
  const targetColumn =
    XLSX.utils.decode_cell(
      `${columnName}1`
    ).c;


  return [
    ...row.querySelectorAll(
      "td[data-preview-column]"
    )
  ].find(
    cell => {
      const startColumn =
        Number(
          cell.dataset.previewColumn
        );

      const span =
        Number(
          cell.colSpan
        ) || 1;


      return (
        targetColumn >=
          startColumn &&
        targetColumn <
          startColumn + span
      );
    }
  ) || null;
}


function setAddedLoggingPreviewCell(
  row,
  columnName,
  text
) {
  const cell =
    getAddedLoggingPreviewCell(
      row,
      columnName
    );


  if (!cell) {
    return null;
  }


  const value =
    cell.querySelector(
      ".log-sheet-cell-value"
    );


  if (value) {
    value.textContent =
      String(
        text ?? ""
      );
  }


  cell.classList.add(
    "is-template-draft"
  );


  return cell;
}

function applyAddedLoggingItemsToPreview() {
  const items =
    buildLoggingItemList();

  if (!items.length) {
    return;
  }


  /*
    각 Logging 항목이
    미리보기의 어느 행에 있는지 기억한다.
  */
  const previewRowMap =
    new Map();


  /* =======================================================
    기존 Excel 항목 위치 등록
  ======================================================= */

  items.forEach(
    item => {
      if (item.isNew) {
        return;
      }


      const key =
        getLoggingItemDraftKey(
          item
        );


      const row =
        getLoggingPreviewRow(
          item.sourceRow
        );


      if (row) {
        previewRowMap.set(
          key,
          row
        );
      }
    }
  );


  /* =======================================================
    신규 항목을 목록 순서대로 삽입
  ======================================================= */

  items.forEach(
    (
      item,
      itemIndex
    ) => {
      if (!item.isNew) {
        return;
      }


      const itemName =
        normalizeLoggingText(
          item.name
        );


      /*
        아직 저장하지 않은 빈 신규 항목은
        미리보기에 표시하지 않는다.
      */
      if (!itemName) {
        return;
      }


      /* ---------------------------------------------------
        바로 앞에 표시되는 항목 찾기
      --------------------------------------------------- */

      let insertionPoint =
        null;


      for (
        let index =
          itemIndex - 1;

        index >= 0;

        index -= 1
      ) {
        const previousItem =
          items[index];


        const previousKey =
          getLoggingItemDraftKey(
            previousItem
          );


        const previousRow =
          previewRowMap.get(
            previousKey
          );


        if (previousRow) {
          insertionPoint =
            previousRow;

          break;
        }
      }


      if (!insertionPoint) {
        return;
      }


      /* ---------------------------------------------------
        신규 항목이 속한 원본 Excel 영역 찾기

        신규 → 신규 → 신규로 이어져 있어도
        위쪽으로 올라가 가장 가까운
        원본 항목을 기준으로 한다.
      --------------------------------------------------- */

      let baseOriginalItem =
        null;


      for (
        let index =
          itemIndex - 1;

        index >= 0;

        index -= 1
      ) {
        const candidate =
          items[index];


        if (
          !candidate.isNew
        ) {
          baseOriginalItem =
            candidate;

          break;
        }
      }


      if (!baseOriginalItem) {
        return;
      }


      const section =
        getLoggingItemSectionForItem(
          baseOriginalItem
        );


      if (!section) {
        return;
      }


      const sourceRow =
        getLoggingPreviewRow(
          baseOriginalItem.sourceRow
        );


      if (!sourceRow) {
        return;
      }


      /* ---------------------------------------------------
        원본 행 디자인 복제
      --------------------------------------------------- */

      const previewRow =
        prepareAddedLoggingPreviewRow(
          sourceRow
        );


      previewRow.dataset
        .loggingItemKey =
        getLoggingItemDraftKey(
          item
        );


      /* ---------------------------------------------------
        항목명 입력
      --------------------------------------------------- */

      const usedNameCells =
        new Set();


      let nameWritten =
        false;


      (
        section.nameColumns ||
        []
      ).forEach(
        columnName => {
          const cell =
            getAddedLoggingPreviewCell(
              previewRow,
              columnName
            );


          if (
            !cell ||
            usedNameCells.has(
              cell
            )
          ) {
            return;
          }


          usedNameCells.add(
            cell
          );


          setAddedLoggingPreviewCell(
            previewRow,
            columnName,
            nameWritten
              ? ""
              : item.name
          );


          nameWritten =
            true;
        }
      );


      /* ---------------------------------------------------
        TAG 입력
      --------------------------------------------------- */

      if (
        section.tagColumn
      ) {
        setAddedLoggingPreviewCell(
          previewRow,
          section.tagColumn,
          item.tag || ""
        );
      }


      /* ---------------------------------------------------
        단위 입력
      --------------------------------------------------- */

      if (
        section.unitColumn
      ) {
        setAddedLoggingPreviewCell(
          previewRow,
          section.unitColumn,
          item.unit || ""
        );
      }


      /* ---------------------------------------------------
        선택한 위치 바로 다음에 삽입
      --------------------------------------------------- */

      insertionPoint.after(
        previewRow
      );


      previewRowMap.set(
        getLoggingItemDraftKey(
          item
        ),
        previewRow
      );
    }
  );
}

/* =========================================================
  통합 제어실 Log Sheet · Excel 원본 인쇄 설정

  첨부 원본:
  - TGO  : A1:V120 / 48% / 54, 104행 뒤 페이지 구분
  - BCO1 : A1:U85  / 50% / 38행 뒤 페이지 구분
  - BCO2 : A1:U86  / 54% / 47행 뒤 페이지 구분
========================================================= */

function getIntegratedControlPrintProfile() {
  switch (
    state.sheetConfig?.key
  ) {
    case "integrated-tgo":
      return {
        breakAfterRows: [
          54,
          104
        ],

        marginTopMm:
          9,

        marginRightMm:
          6,

        marginBottomMm:
          9,

        marginLeftMm:
          6,

        horizontalCentered:
          true
      };


    case "integrated-bco1":
      return {
        breakAfterRows: [
          38
        ],

        marginTopMm:
          9,

        marginRightMm:
          8,

        marginBottomMm:
          4,

        marginLeftMm:
          13,

        horizontalCentered:
          false
      };


    case "integrated-bco2":
      return {
        breakAfterRows: [
          47
        ],

        marginTopMm:
          9,

        marginRightMm:
          8,

        marginBottomMm:
          4,

        marginLeftMm:
          13,

        horizontalCentered:
          false
      };


    default:
      return {
        breakAfterRows:
          [],

        marginTopMm:
          7,

        marginRightMm:
          7,

        marginBottomMm:
          7,

        marginLeftMm:
          7,

        horizontalCentered:
          false
      };
  }
}


function applyExcelPrintBreaks(
  previewGrid
) {
  const profile =
    getIntegratedControlPrintProfile();


  const table =
    previewGrid.querySelector(
      ".log-sheet-table"
    );


  if (!table) {
    return;
  }


  const rows = [
    ...table.querySelectorAll(
      "tbody > tr"
    )
  ];


  const renderRange =
    parseRange(
      state.sheetConfig?.renderRange ||
      "A1:A1"
    );


  const firstExcelRow =
    renderRange.s.r +
    1;


  rows.forEach(
    row => {
      row.classList.remove(
        "is-excel-print-break"
      );
    }
  );


  (
    profile.breakAfterRows ||
    []
  ).forEach(
    excelRow => {
      const rowIndex =
        excelRow -
        firstExcelRow;


      const targetRow =
        rows[rowIndex];


      targetRow?.classList.add(
        "is-excel-print-break"
      );
    }
  );
}

function cloneGridForPreviewWindow() {
  /*
    기본 Grid는 화면 초기화 과정에서 이미 만들어져 있다.

    미리보기 버튼을 누를 때
    전체 renderGrid()를 다시 실행하지 않고
    기존 Grid를 복제해서 사용한다.
  */
  /*
    미리보기 창을 열 때만
    현재 Log Sheet 상태 기준으로 Grid를 한 번 생성한다.

    본 화면 초기 진입에서는 생성하지 않는다.
  */
  renderGrid();


  const previewGrid =
    elements.grid.cloneNode(
      true
    );


  /*
    textarea/select/input의 현재 값은
    cloneNode만으로 완전히 전달되지 않을 수 있으므로
    실제 값을 복사한다.
  */
  const sourceControls = [
    ...elements.grid.querySelectorAll(
      "textarea, input, select"
    )
  ];


  const clonedControls = [
    ...previewGrid.querySelectorAll(
      "textarea, input, select"
    )
  ];


  sourceControls.forEach(
    (
      control,
      index
    ) => {
      const cloned =
        clonedControls[index];


      if (!cloned) {
        return;
      }


      cloned.value =
        control.value;


      if (
        cloned instanceof
          HTMLTextAreaElement
      ) {
        cloned.textContent =
          control.value;
      }


      if (
        cloned instanceof
          HTMLSelectElement
      ) {
        cloned.value =
          control.value;
      }
    }
  );


  /*
    Logging 항목 수정/추가 내용은
    원본 화면 Grid를 건드리지 않고
    복제한 Grid에만 적용한다.
  */
  const originalGrid =
    elements.grid;


  try {
    elements.grid =
      previewGrid;


    applyLoggingItemDraftsToPreview();

    applyLoggingItemOrderToPreview();

    applyAddedLoggingItemsToPreview();

  } finally {
    elements.grid =
      originalGrid;
  }


  /*
    새창은 미리보기 전용이므로
    입력 컨트롤을 일반 텍스트로 변환한다.
  */
  [
    ...previewGrid.querySelectorAll(
      "textarea, input, select"
    )
  ].forEach(
    control => {
      let text =
        control.value;


      if (
        control instanceof
          HTMLSelectElement
      ) {
        text =
          control.options[
            control.selectedIndex
          ]?.textContent ||
          control.value;
      }


      const value =
        document.createElement(
          "span"
        );


      value.className =
        "log-sheet-cell-value";


      value.textContent =
        text || "";


      control.replaceWith(
        value
      );
    }
  );


  applyExcelPrintBreaks(
    previewGrid
  );


  return previewGrid;
}


/* =========================================================
  Log Sheet 새창 미리보기
========================================================= */

/* =========================================================
  통합 제어실 Log Sheet
  원본 Excel 고정 인쇄 페이지

  TGO
  - 1Page : 1 ~ 54
  - 2Page : 55 ~ 104
  - 3Page : 105 ~ 120

  BCO1
  - 1Page : 1 ~ 38
  - 2Page : 39 ~ 85

  BCO2
  - 1Page : 1 ~ 47
  - 2Page : 48 ~ 86
========================================================= */

function getIntegratedControlFixedPageRanges() {
  switch (
    state.sheetConfig?.key
  ) {
    case "integrated-tgo":
      return [
        {
          startRow:
            1,

          endRow:
            54
        },

        {
          startRow:
            55,

          endRow:
            104
        },

        {
          startRow:
            105,

          endRow:
            120
        }
      ];


    case "integrated-bco1":
      return [
        {
          startRow:
            1,

          endRow:
            38
        },

        {
          startRow:
            39,

          endRow:
            85
        }
      ];


    case "integrated-bco2":
      return [
        {
          startRow:
            1,

          endRow:
            47
        },

        {
          startRow:
            48,

          endRow:
            86
        }
      ];


    default:
      return [];
  }
}


/* =========================================================
  Preview 행 → 원본 Excel 행 번호
========================================================= */

function getPreviewExcelRowNumber(
  row
) {
  const cell =
    row?.querySelector(
      "td[data-cell-address]"
    );


  const address =
    String(
      cell?.dataset
        ?.cellAddress ||
      ""
    ).trim();


  const match =
    address.match(
      /^[A-Z]+(\d+)$/
    );


  if (!match) {
    return null;
  }


  const rowNumber =
    Number(
      match[1]
    );


  return Number.isInteger(
    rowNumber
  )
    ? rowNumber
    : null;
}


/* =========================================================
  지정 Excel 행만 남긴 Grid 생성
========================================================= */

function createFixedPageGrid(
  previewGrid,
  previewDocument,
  range
) {
  const pageGrid =
    previewDocument.importNode(
      previewGrid,
      true
    );


  pageGrid.removeAttribute(
    "id"
  );


  const rows = [
    ...pageGrid.querySelectorAll(
      ".log-sheet-table tbody > tr"
    )
  ];


  let previousExcelRow =
    null;


  rows.forEach(
    row => {
      const currentExcelRow =
        getPreviewExcelRowNumber(
          row
        );


      /*
        사용자가 추가한 Logging 행은
        원본 주소가 없으므로 바로 앞 원본 행과
        같은 페이지에 배치한다.
      */
      if (
        currentExcelRow !==
          null
      ) {
        previousExcelRow =
          currentExcelRow;
      }


      const effectiveExcelRow =
        currentExcelRow ??
        previousExcelRow;


      const keepRow =
        effectiveExcelRow !==
          null &&
        effectiveExcelRow >=
          range.startRow &&
        effectiveExcelRow <=
          range.endRow;


      if (!keepRow) {
        row.remove();
      }
    }
  );


  return pageGrid;
}


/* =========================================================
  TGO / BCO1 / BCO2
  실제 A4 페이지 묶음 생성
========================================================= */

function buildIntegratedControlFixedPages(
  previewGrid,
  previewDocument
) {
  const pageRanges =
    getIntegratedControlFixedPageRanges();


  if (!pageRanges.length) {
    return null;
  }


  const printProfile =
    getIntegratedControlPrintProfile();


  const pages =
    previewDocument.createElement(
      "div"
    );


  pages.className =
    "log-sheet-fixed-print-pages";


  pages.dataset.sheetKey =
    state.sheetConfig?.key ||
    "";


  pageRanges.forEach(
    (
      range,
      pageIndex
    ) => {
      const page =
        previewDocument.createElement(
          "section"
        );


      page.className =
        "log-sheet-fixed-print-page";


      page.dataset.pageNumber =
        String(
          pageIndex + 1
        );


      page.style.setProperty(
        "--excel-page-margin-top",
        `${printProfile.marginTopMm}mm`
      );


      page.style.setProperty(
        "--excel-page-margin-right",
        `${printProfile.marginRightMm}mm`
      );


      page.style.setProperty(
        "--excel-page-margin-bottom",
        `${printProfile.marginBottomMm}mm`
      );


      page.style.setProperty(
        "--excel-page-margin-left",
        `${printProfile.marginLeftMm}mm`
      );


      const viewport =
        previewDocument.createElement(
          "div"
        );


      viewport.className =
        "log-sheet-fixed-print-page__viewport";


      const scaledContent =
        previewDocument.createElement(
          "div"
        );


      scaledContent.className =
        "log-sheet-fixed-print-page__scaled";


      const pageGrid =
        createFixedPageGrid(
          previewGrid,
          previewDocument,
          range
        );


      scaledContent.appendChild(
        pageGrid
      );


      viewport.appendChild(
        scaledContent
      );


      const footer =
        previewDocument.createElement(
          "footer"
        );


      footer.className =
        "log-sheet-fixed-print-page__footer";


      const footerLeft =
        previewDocument.createElement(
          "span"
        );


      footerLeft.textContent =
        "설비운영팀";


      const footerRight =
        previewDocument.createElement(
          "span"
        );


      footerRight.textContent =
        "포천그린에너지";


      footer.append(
        footerLeft,
        footerRight
      );


      page.append(
        viewport,
        footer
      );


      pages.appendChild(
        page
      );
    }
  );


  return pages;
}


/* =========================================================
  고정 A4 페이지 전용 CSS
========================================================= */

function installIntegratedControlFixedPageStyles(
  previewDocument
) {
  if (
    previewDocument
      .getElementById(
        "logSheetFixedExcelPageStyle"
      )
  ) {
    return;
  }


  const style =
    previewDocument
      .createElement(
        "style"
      );


  style.id =
    "logSheetFixedExcelPageStyle";


  style.textContent = `
    @page {
      size: A4 landscape;
      margin: 0;
    }


    html,
    body {
      margin: 0;
      padding: 0;
    }


    body.has-integrated-control-fixed-pages {
      background: #dfe5ec !important;
    }


    body.has-integrated-control-fixed-pages
    .log-sheet-preview-window__root {
      display: block !important;

      width: 100% !important;
      min-width: 0 !important;

      padding: 18px !important;

      box-sizing: border-box !important;
    }


    .log-sheet-fixed-print-pages {
      display: flex;

      width: 100%;

      flex-direction: column;
      align-items: center;

      gap: 20px;
    }


    /* ===================================================
      실제 A4 가로 한 장
    ==================================================== */

    .log-sheet-fixed-print-page {
      position: relative;

      display: block;

      width: 297mm;
      height: 210mm;

      box-sizing: border-box;

      padding:
        var(--excel-page-margin-top)
        var(--excel-page-margin-right)
        var(--excel-page-margin-bottom)
        var(--excel-page-margin-left);

      overflow: hidden;

      background: #ffffff;

      box-shadow:
        0 5px 22px
        rgba(
          15,
          23,
          42,
          0.18
        );
    }


    .log-sheet-fixed-print-page__viewport {
      position: relative;

      width: 100%;
      height: 100%;

      overflow: hidden;
    }


    .log-sheet-fixed-print-page__scaled {
      position: absolute;

      top: 0;
      left: 0;

      width: max-content;

      transform-origin:
        top left;
    }


    .log-sheet-fixed-print-page
    .log-sheet-grid {
      width: max-content !important;
      min-width: 0 !important;

      margin: 0 !important;
      padding: 0 !important;
    }


    .log-sheet-fixed-print-page
    .log-sheet-table {
      width: max-content !important;
      max-width: none !important;

      margin: 0 !important;

      border-collapse:
        collapse !important;

      table-layout:
        fixed !important;

      zoom: 1 !important;

      box-shadow:
        none !important;
    }


    /* ===================================================
      Excel 셀 스타일 유지

      기존 print CSS의
      font-size:9px 강제를 무효화한다.
    ==================================================== */

    .log-sheet-fixed-print-page
    .log-sheet-table td {
      min-width: 0 !important;

      height: auto !important;
      min-height: 0 !important;

      padding:
        0
        2px !important;

      color:
        #000000 !important;

      font-size:
        var(
          --excel-font-size,
          9px
        ) !important;

      line-height:
        1.05 !important;

      box-shadow:
        none !important;

      overflow:
        hidden !important;

      print-color-adjust:
        exact !important;

      -webkit-print-color-adjust:
        exact !important;
    }


    .log-sheet-fixed-print-page
    .log-sheet-cell-value {
      display: block !important;

      width: 100%;

      overflow:
        hidden !important;

      white-space:
        pre-wrap;

      line-height:
        inherit;
    }


    .log-sheet-fixed-print-page
    .log-sheet-cell-editor {
      display:
        none !important;
    }


    .log-sheet-fixed-print-page
    .log-sheet-cell-print-value {
      display:
        block !important;
    }


    /* ===================================================
      페이지 footer
    ==================================================== */

    .log-sheet-fixed-print-page__footer {
      position: absolute;

      right:
        var(--excel-page-margin-right);

      bottom:
        1.5mm;

      left:
        var(--excel-page-margin-left);

      display: flex;

      align-items: center;
      justify-content: space-between;

      color: #333333;

      font-family:
        "Malgun Gothic",
        sans-serif;

      font-size:
        6px;

      line-height:
        1;
    }


    /* ===================================================
      실제 인쇄
    ==================================================== */

    @media print {

      html,
      body {
        width: 297mm !important;

        margin: 0 !important;
        padding: 0 !important;

        background:
          #ffffff !important;
      }


      .log-sheet-preview-window__toolbar {
        display:
          none !important;
      }


      body.has-integrated-control-fixed-pages
      .log-sheet-preview-window__root {
        width:
          297mm !important;

        min-width:
          297mm !important;

        margin:
          0 !important;

        padding:
          0 !important;
      }


      .log-sheet-fixed-print-pages {
        display:
          block !important;

        width:
          297mm !important;

        margin:
          0 !important;

        padding:
          0 !important;

        gap:
          0 !important;
      }


      .log-sheet-fixed-print-page {
        width:
          297mm !important;

        height:
          210mm !important;

        margin:
          0 !important;

        overflow:
          hidden !important;

        box-shadow:
          none !important;

        break-after:
          page !important;

        page-break-after:
          always !important;
      }


      .log-sheet-fixed-print-page:last-child {
        break-after:
          auto !important;

        page-break-after:
          auto !important;
      }


      /*
        우리가 이미 페이지별 DOM으로
        나누었기 때문에 기존 row page-break는 제거
      */

      .log-sheet-fixed-print-page
      tr.is-excel-print-break {
        break-after:
          auto !important;

        page-break-after:
          auto !important;
      }


      /*
        Excel의 48% / 50% / 54%를
        브라우저에서 다시 적용하지 않는다.

        실제 크기는 JS가
        A4 너비에 맞춰 계산한다.
      */

      .log-sheet-fixed-print-page
      .log-sheet-table {
        zoom:
          1 !important;
      }
    }
  `;


  previewDocument.head
    .appendChild(
      style
    );
}

/* =========================================================
  각 A4 페이지 안에 표 비율 맞춤

  중요:
  페이지 높이에 억지로 늘이지 않는다.

  원본 비율을 유지한 채
  가로 또는 세로 중 먼저 닿는 방향까지만 축소한다.
========================================================= */

/* =========================================================
  통합 제어실 고정 A4 페이지 맞춤

  원칙

  1. 페이지 구분
     Excel 원본 그대로 유지

  2. 가로 크기
     Excel 인쇄 배율 그대로 사용

     TGO  : 48%
     BCO1 : 50%
     BCO2 : 54%

  3. 세로 크기
     남는 위·아래 공간을
     실제 데이터 행 높이에 분배한다.

     따라서 마지막 페이지도
     아래쪽이 크게 비지 않고
     칸이 페이지 높이를 최대한 채운다.

  4. 제목부
     지나치게 커지지 않도록
     첫 페이지 상단 4행,
     이후 페이지 첫 행은 고정한다.
========================================================= */

function fitIntegratedControlFixedPages(
  previewWindow
) {
  const previewDocument =
    previewWindow?.document;


  if (
    !previewDocument
  ) {
    return;
  }


  const pages = [
    ...previewDocument
      .querySelectorAll(
        ".log-sheet-fixed-print-page"
      )
  ];


  if (
    !pages.length
  ) {
    return;
  }


  const pageRanges =
    getIntegratedControlFixedPageRanges();


  pages.forEach(
    (
      page,
      pageIndex
    ) => {
      const viewport =
        page.querySelector(
          ".log-sheet-fixed-print-page__viewport"
        );


      const scaledContent =
        page.querySelector(
          ".log-sheet-fixed-print-page__scaled"
        );


      const table =
        scaledContent
          ?.querySelector(
            ".log-sheet-table"
          );


      if (
        !viewport ||
        !scaledContent ||
        !table
      ) {
        return;
      }


      const rows = [
        ...table.querySelectorAll(
          "tbody > tr"
        )
      ];


      if (
        !rows.length
      ) {
        return;
      }


      /* ===================================================
        1. 이전 계산 초기화
      ==================================================== */

      scaledContent.style
        .transform =
        "none";


      scaledContent.style
        .transformOrigin =
        "top left";


      rows.forEach(
        row => {
          /*
            renderGrid에서 저장한
            Excel 원본 행 높이
          */

          const originalHeight =
            Number(
              row.dataset
                .excelOriginalHeight
            );


          if (
            Number.isFinite(
              originalHeight
            ) &&
            originalHeight >
              0
          ) {
            row.style.height =
              `${originalHeight}px`;
          }
        }
      );


      /*
        브라우저 layout 재계산
      */

      void table.offsetHeight;


      /* ===================================================
        2. 사용할 A4 영역
      ==================================================== */

      const availableWidth =
        Math.max(
          1,
          viewport.clientWidth
        );


      const availableHeight =
        Math.max(
          1,
          viewport.clientHeight
        );


      const tableRect =
        table.getBoundingClientRect();


      const naturalWidth =
        Math.max(
          1,
          tableRect.width,
          table.scrollWidth
        );


      /* ===================================================
        3. 가로 크기

        중요:
        Excel의 48% / 50% / 54%는
        여기서 사용하지 않는다.

        브라우저 HTML 표 자체를
        현재 A4 인쇄영역 가로폭에
        정확하게 맞춘다.
      ==================================================== */

      let pageScale =
        availableWidth /
        naturalWidth;


      /*
        브라우저 측정 오차 안전범위.

        원본이 아주 좁더라도
        지나치게 확대하지 않는다.
      */

      pageScale =
        Math.max(
          0.25,
          Math.min(
            1.5,
            pageScale
          )
        );


      /* ===================================================
        4. 세로 목표 높이

        transform 적용 전 좌표계에서
        어느 높이가 되어야
        A4 세로를 정확히 채우는지 계산
      ==================================================== */

      const targetNaturalHeight =
        availableHeight /
        pageScale;


      /*
        첫 페이지의 1~6행은
        제목 / Shift / 날짜 / 컬럼 헤더.

        여기까지는 원본 높이를
        가능한 그대로 유지한다.

        2페이지 이후 첫 행은
        ITEM / TAG / RATING / UNIT /
        시간 헤더이므로 유지한다.
      */

      const fixedHeaderCount =
        pageIndex ===
          0
          ? Math.min(
              6,
              rows.length
            )
          : Math.min(
              1,
              rows.length
            );


      const headerRows =
        rows.slice(
          0,
          fixedHeaderCount
        );


      const dataRows =
        rows.slice(
          fixedHeaderCount
        );


      const getRowHeight =
        row => {
          const height =
            row.getBoundingClientRect()
              .height;


          return Math.max(
            1,
            height
          );
        };


      const headerHeight =
        headerRows.reduce(
          (
            total,
            row
          ) =>
            total +
            getRowHeight(
              row
            ),
          0
        );


      const originalDataHeights =
        dataRows.map(
          getRowHeight
        );


      const dataNaturalHeight =
        originalDataHeights
          .reduce(
            (
              total,
              height
            ) =>
              total +
              height,
            0
          );


      /*
        A4에서 실제 Logging 행들이
        사용할 목표 높이.
      */

      const targetDataHeight =
        Math.max(
          1,
          targetNaturalHeight -
          headerHeight
        );


      /* ===================================================
        5. 남는 공간을 데이터 행에 분배

        이 값은 1보다 클 수도 있고
        1보다 작을 수도 있다.

        즉:
        - 페이지가 비면 행 확대
        - 페이지가 넘치면 행 축소

        해서 항상 A4 세로를
        최대한 채운다.
      ==================================================== */

      let rowFactor =
        dataNaturalHeight >
          0
          ? targetDataHeight /
            dataNaturalHeight
          : 1;


      /*
        너무 비정상적으로 납작하거나
        거대해지는 것만 방지한다.

        TGO 3페이지처럼 행이 적은 경우는
        충분히 크게 확장 가능.
      */

      rowFactor =
        Math.max(
          0.42,
          Math.min(
            4.5,
            rowFactor
          )
        );


      dataRows.forEach(
        (
          row,
          index
        ) => {
          const originalHeight =
            originalDataHeights[
              index
            ] ||
            1;


          const newHeight =
            Math.max(
              5,
              originalHeight *
              rowFactor
            );


          row.style.height =
            `${newHeight}px`;


          row.dataset
            .fixedPrintFilledHeight =
            newHeight.toFixed(
              2
            );
        }
      );


      /*
        높이 적용 후 다시 계산
      */

      void table.offsetHeight;


      /* ===================================================
        6. 마지막 미세 보정

        table border / rowspan 때문에
        1~수 px 정도 오차가 생길 수 있으므로
        마지막 데이터 행에서 맞춘다.
      ==================================================== */

      if (
        dataRows.length >
          0
      ) {
        const currentHeight =
          table.getBoundingClientRect()
            .height;


        const targetHeight =
          targetNaturalHeight;


        const remaining =
          targetHeight -
          currentHeight;


        if (
          Math.abs(
            remaining
          ) >
            0.5
        ) {
          const lastRow =
            dataRows[
              dataRows.length -
              1
            ];


          const currentLastHeight =
            getRowHeight(
              lastRow
            );


          const correctedHeight =
            Math.max(
              5,
              currentLastHeight +
              remaining
            );


          lastRow.style.height =
            `${correctedHeight}px`;
        }
      }


      /* ===================================================
        7. 최종 A4 가로 확대 적용
      ==================================================== */

      scaledContent.style
        .transform =
        `scale(${pageScale})`;


      scaledContent.style
        .transformOrigin =
        "top left";


      page.dataset
        .printScale =
        pageScale.toFixed(
          4
        );


      page.dataset
        .rowFillFactor =
        rowFactor.toFixed(
          4
        );


      const range =
        pageRanges[
          pageIndex
        ] ||
        null;


      if (
        range
      ) {
        page.dataset
          .excelStartRow =
          String(
            range.startRow
          );


        page.dataset
          .excelEndRow =
          String(
            range.endRow
          );
      }
    }
  );
}


/* =========================================================
  새창 미리보기 배율 재계산

  - 창이 열린 직후
  - CSS / 폰트 로딩 후
  - 창 크기 변경
  - 실제 인쇄 직전

  인쇄 직전에도 한 번 더 계산하여
  @media print 적용 후 행 높이까지 정확히 맞춘다.
========================================================= */

function scheduleIntegratedControlFixedPageFit(
  previewWindow
) {
  const runFit =
    () => {
      if (
        !previewWindow ||
        previewWindow.closed
      ) {
        return;
      }


      fitIntegratedControlFixedPages(
        previewWindow
      );
    };


  [
    0,
    120,
    400,
    900
  ].forEach(
    delay => {
      window.setTimeout(
        runFit,
        delay
      );
    }
  );


  previewWindow?.addEventListener(
    "resize",
    runFit
  );


  /*
    인쇄용 CSS가 적용되는 순간
    다시 실제 A4 크기에 맞춘다.
  */

  previewWindow?.addEventListener(
    "beforeprint",
    runFit
  );


  /*
    인쇄창을 닫은 뒤에는
    다시 화면용 크기로 복원
  */

  previewWindow?.addEventListener(
    "afterprint",
    () => {
      window.setTimeout(
        runFit,
        0
      );
    }
  );


  /*
    Chromium의 print media 변경도 감시
  */

  const printMedia =
    previewWindow
      ?.matchMedia
      ?.("print");


  if (
    printMedia &&
    typeof printMedia
      .addEventListener ===
      "function"
  ) {
    printMedia.addEventListener(
      "change",
      event => {
        if (
          event.matches
        ) {
          runFit();

        } else {
          window.setTimeout(
            runFit,
            0
          );
        }
      }
    );
  }
}

function openLogSheetPreviewWindow(options = {}) {
  if (
    state.isBusy
  ) {
    return;
  }


  /*
    사용자 클릭 이벤트 안에서
    새 창을 먼저 열어 팝업 차단을 방지한다.
  */
  const autoPrint =
    options.autoPrint ===
    true;

  const previewWindow =
    window.open(
      "",
      "_blank",
      [
        "popup=yes",
        "width=1500",
        "height=950",
        "resizable=yes",
        "scrollbars=yes"
      ].join(",")
    );


  if (
    !previewWindow
  ) {
    window.alert(
      "미리보기 창이 차단되었습니다.\n브라우저에서 팝업을 허용한 뒤 다시 눌러 주세요."
    );

    return;
  }


  const title =
    `${state.sheetConfig?.title || "Log Sheet"} · 미리보기`;

  const printProfile =
    getIntegratedControlPrintProfile();


  const configuredScale =
    Number(
      state.sheetConfig
        ?.print
        ?.scale ||
      100
    );


  const printScale =
    Math.max(
      10,
      Math.min(
        100,
        configuredScale
      )
    ) /
    100;


  const printOrientation =
    state.sheetConfig
      ?.print
      ?.orientation ===
      "portrait"
        ? "portrait"
        : "landscape";




  const previewDocument =
    previewWindow.document;


  previewDocument.open();

  previewDocument.write(
    [
      "<!DOCTYPE html>",
      '<html lang="ko">',
      "<head>",
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      "<title>Log Sheet 미리보기</title>",
      "</head>",
      "<body>",
      '<div class="log-sheet-preview-window__toolbar">',
      '  <strong id="logSheetPreviewWindowTitle">Log Sheet 미리보기</strong>',
      '  <div>',
      '    <button type="button" id="logSheetPreviewPrintButton">인쇄</button>',
      '    <button type="button" id="logSheetPreviewCloseButton">닫기</button>',
      "  </div>",
      "</div>",
      '<main class="log-sheet-app log-sheet-preview-window__root" id="logSheetPreviewWindowRoot">',
      '  <div class="log-sheet-preview-window__loading">',
      "    미리보기를 준비하고 있습니다.",
      "  </div>",
      "</main>",
      "</body>",
      "</html>"
    ].join("")
  );

  previewDocument.close();


  previewDocument.title =
    title;


  const titleElement =
    previewDocument.getElementById(
      "logSheetPreviewWindowTitle"
    );


  if (
    titleElement
  ) {
    titleElement.textContent =
      title;
  }


  /*
    현재 Log Sheet에 적용된 stylesheet를
    그대로 새창에도 적용한다.
  */
  [
    ...document.querySelectorAll(
      'link[rel="stylesheet"]'
    )
  ].forEach(
    sourceLink => {
      const link =
        previewDocument.createElement(
          "link"
        );


      link.rel =
        "stylesheet";


      link.href =
        sourceLink.href;


      previewDocument.head.appendChild(
        link
      );
    }
  );


  [
    ...document.querySelectorAll(
      "style"
    )
  ].forEach(
    sourceStyle => {
      previewDocument.head.appendChild(
        sourceStyle.cloneNode(
          true
        )
      );
    }
  );


  const previewStyle =
    previewDocument.createElement(
      "style"
    );


  previewStyle.textContent = `
    html,
    body {
      min-height: 100%;
      margin: 0;
    }

    body {
      overflow: auto;
      background: #eef2f6;
    }

    .log-sheet-preview-window__toolbar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 14px;
      background: #ffffff;
      border-bottom: 1px solid #d9e4ef;
    }

    .log-sheet-preview-window__toolbar > div {
      display: flex;
      gap: 6px;
    }

    .log-sheet-preview-window__toolbar button {
      min-height: 34px;
      padding: 0 14px;
      border: 1px solid #b9cce0;
      border-radius: 8px;
      background: #ffffff;
      cursor: pointer;
      font-weight: 700;
    }

    .log-sheet-preview-window__root {
      width: max-content;
      min-width: 100%;
      padding: 16px;
      box-sizing: border-box;
    }

    .log-sheet-preview-window__root
    .log-sheet-grid-shell {
      display: block !important;
      width: max-content !important;
      max-height: none !important;
      overflow: visible !important;
      background: #ffffff;
      box-shadow: 0 8px 30px rgba(22, 42, 65, 0.14);
    }

    .log-sheet-preview-window__root
    .log-sheet-grid {
      width: max-content !important;
      min-width: 0 !important;
      padding: 0 !important;
    }

    .log-sheet-preview-window__loading {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 240px;
      font-weight: 700;
    }


    @page {
      size: A4 ${printOrientation};

      margin:
        ${printProfile.marginTopMm}mm
        ${printProfile.marginRightMm}mm
        ${printProfile.marginBottomMm}mm
        ${printProfile.marginLeftMm}mm;
    }


    @media print {
      html,
      body {
        width: auto !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #ffffff !important;
      }

      .log-sheet-preview-window__toolbar {
        display: none !important;
      }

      .log-sheet-preview-window__root {
        display: block !important;
        width: auto !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      .log-sheet-preview-window__root
      .log-sheet-grid-shell {
        width: max-content !important;
        height: auto !important;
        min-height: 0 !important;
        margin:
          0
          ${printProfile.horizontalCentered ? "auto" : "0"}
          0
          ${printProfile.horizontalCentered ? "auto" : "0"} !important;
        overflow: visible !important;
        background: #ffffff !important;
        box-shadow: none !important;
      }

      .log-sheet-preview-window__root
      .log-sheet-grid {
        width: max-content !important;
        min-width: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
      }

      .log-sheet-preview-window__root
      .log-sheet-table {
        width: max-content !important;
        max-width: none !important;

        margin: 0 !important;

        border-collapse: collapse !important;

        box-shadow: none !important;

        zoom: ${printScale};
      }

      .log-sheet-preview-window__root
      .log-sheet-table tr {
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }

      .log-sheet-preview-window__root
      .log-sheet-table
      tr.is-excel-print-break {
        break-after: page !important;
        page-break-after: always !important;
      }

      .log-sheet-preview-window__root
      .log-sheet-table td {
        min-width: 24px !important;
        height: 22px;
        padding: 2px 4px !important;

        border-color: #000000 !important;

        color: #000000 !important;

        font-size: 9px !important;
        line-height: 1.18 !important;

        box-shadow: none !important;

        print-color-adjust: exact;
        -webkit-print-color-adjust: exact;
      }

      .log-sheet-preview-window__root
      .log-sheet-table td.is-editable,
      .log-sheet-preview-window__root
      .log-sheet-table td.is-changed {
        background: inherit !important;
      }

      .log-sheet-preview-window__root
      .log-sheet-cell-value {
        overflow: visible !important;
      }
    }
  `;


  previewDocument.head.appendChild(
    previewStyle
  );


  previewDocument
    .getElementById(
      "logSheetPreviewPrintButton"
    )
    ?.addEventListener(
      "click",
      () => previewWindow.print()
    );


  previewDocument
    .getElementById(
      "logSheetPreviewCloseButton"
    )
    ?.addEventListener(
      "click",
      () => previewWindow.close()
    );


  /*
    먼저 새창을 화면에 보여준 뒤
    기존 Grid 복제를 수행한다.
  */
  window.setTimeout(
    () => {
      try {
        const previewGrid =
          cloneGridForPreviewWindow();


        const root =
          previewDocument.getElementById(
            "logSheetPreviewWindowRoot"
          );


        const fixedPages =
          buildIntegratedControlFixedPages(
            previewGrid,
            previewDocument
          );


        if (
          fixedPages
        ) {
          /*
            TGO / BCO1 / BCO2는
            원본 Excel의 페이지 구분을 그대로 사용한다.
          */

          installIntegratedControlFixedPageStyles(
            previewDocument
          );


          previewDocument.body
            .classList
            .add(
              "has-integrated-control-fixed-pages"
            );


          root?.replaceChildren(
            fixedPages
          );


          scheduleIntegratedControlFixedPageFit(
            previewWindow
          );

        } else {
          /*
            다른 Log Sheet는
            기존 단일 Grid 미리보기 유지
          */

          const gridShell =
            previewDocument.createElement(
              "div"
            );


          gridShell.className =
            elements.gridShell?.className ||
            "log-sheet-grid-shell";


          gridShell.hidden =
            false;


          gridShell.appendChild(
            previewDocument.importNode(
              previewGrid,
              true
            )
          );


          root?.replaceChildren(
            gridShell
          );
        }

        previewWindow.focus();


        if (
          autoPrint
        ) {
          window.setTimeout(
            () => {
              if (
                !previewWindow.closed
              ) {
                previewWindow.print();
              }
            },
            150
          );
        }

      } catch (
        error
      ) {
        console.error(
          "Log Sheet 새창 미리보기 실패:",
          error
        );


        const root =
          previewDocument.getElementById(
            "logSheetPreviewWindowRoot"
          );


        if (
          root
        ) {
          root.textContent =
            `미리보기를 만들지 못했습니다: ${error.message}`;
        }
      }
    },
    0
  );
}

function setPreviewOpen(
  open
) {
  const isOpen =
    Boolean(open);


  if (isOpen) {
    renderGrid();

    applyLoggingItemDraftsToPreview();

    applyLoggingItemOrderToPreview();

    applyAddedLoggingItemsToPreview();
  }


  elements.previewSection.hidden =
    !isOpen;


  elements.previewButton.textContent =
    isOpen
      ? "미리보기 닫기"
      : "미리보기";


  elements.previewButton.classList.toggle(
    "is-active",
    isOpen
  );


  elements.previewButton.setAttribute(
    "aria-expanded",
    String(isOpen)
  );
}

/* =========================================================
  Log Sheet · Excel 원본 PDF 미리보기

  처리:
  현재 화면
  → 실제 XLSX 생성
  → R2
  → 회사 PC Microsoft Excel
  → PDF
  → 브라우저 PDF 미리보기
========================================================= */

const LOG_SHEET_PDF_POLL_INTERVAL =
  1200;


const LOG_SHEET_PDF_MAXIMUM_WAIT =
  3 *
  60 *
  1000;


function waitLogSheetPdf(
  milliseconds
) {
  return new Promise(
    resolve => {
      window.setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}


function initializeLogSheetPdfPopup(
  previewWindow
) {
  const previewDocument =
    previewWindow.document;


  previewDocument.open();

  previewDocument.write(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>Log Sheet PDF 준비 중</title>
      <style>
        html,
        body {
          width: 100%;
          height: 100%;
          margin: 0;
        }

        body {
          display: grid;
          place-items: center;
          background: #eef2f6;
          color: #29435d;
          font-family:
            Arial,
            "Malgun Gothic",
            sans-serif;
        }

        .pdf-loading {
          display: grid;
          gap: 10px;
          text-align: center;
        }

        .pdf-loading strong {
          font-size: 18px;
        }

        .pdf-loading span {
          color: #6c8195;
          font-size: 12px;
        }
      </style>
    </head>

    <body>
      <div class="pdf-loading">
        <strong>PDF 미리보기 준비 중</strong>
        <span>
          Microsoft Excel에서 원본 출력 양식을 만들고 있습니다.
        </span>
      </div>
    </body>
    </html>
  `);

  previewDocument.close();
}


async function createLogSheetPdfRequest(
  workbookBlob
) {
  const identity =
    getIdentity();


  const parameters =
    new URLSearchParams({
      action:
        "create",

      sheetName:
        state.sheetConfig.sheetName,

      targetDate:
        identity.date
    });


  const payload =
    await requestApi(
      `/api/log-sheet-pdf-files?${parameters.toString()}`,
      {
        method:
          "POST",

        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        },

        body:
          workbookBlob
      }
    );


  const requestId =
    normalizeText(
      payload?.item?.id
    );


  if (
    !requestId
  ) {
    throw new Error(
      "PDF 변환 요청 ID를 받지 못했습니다."
    );
  }


  return requestId;
}


async function waitForLogSheetPdfCompletion(
  requestId
) {
  const token =
    getSessionToken();


  if (
    !token
  ) {
    throw new Error(
      "로그인 정보가 없습니다. 다시 로그인해 주세요."
    );
  }


  const startedAt =
    Date.now();


  let previousStatus =
    "";


  while (
    Date.now() -
      startedAt <
      LOG_SHEET_PDF_MAXIMUM_WAIT
  ) {
    const response =
      await fetch(
        `/api/ois-data-requests?id=${encodeURIComponent(
          requestId
        )}&_=${Date.now()}`,
        {
          method:
            "GET",

          cache:
            "no-store",

          headers: {
            Accept:
              "application/json",

            Authorization:
              `Bearer ${token}`
          }
        }
      );


    let payload =
      null;


    try {
      payload =
        await response.json();

    } catch {
      throw new Error(
        `PDF 변환 상태 응답을 읽지 못했습니다. (${response.status})`
      );
    }


    if (
      !response.ok
    ) {
      throw new Error(
        normalizeText(
          payload?.message
        ) ||
        `PDF 변환 상태 조회에 실패했습니다. (${response.status})`
      );
    }


    const item =
      payload?.item ||
      null;


    if (
      !item
    ) {
      throw new Error(
        "PDF 변환 요청 상태를 찾지 못했습니다."
      );
    }


    const status =
      normalizeText(
        item.status
      ).toLowerCase();


    if (
      status !==
        previousStatus
    ) {
      console.log(
        "Log Sheet PDF 상태:",
        requestId,
        status
      );


      previousStatus =
        status;
    }


    if (
      status ===
        "complete"
    ) {
      console.log(
        "Log Sheet PDF 완료 확인:",
        requestId,
        item.result ||
        null
      );


      return item;
    }


    if (
      status ===
        "failed"
    ) {
      throw new Error(
        normalizeText(
          item.errorMessage ||
          item.error_message
        ) ||
        "회사 PC에서 PDF 변환에 실패했습니다."
      );
    }


    if (
      status ===
        "processing"
    ) {
      setStatus(
        "PDF 변환 중",
        "회사 PC의 Microsoft Excel에서 원본 양식으로 PDF를 만들고 있습니다.",
        "loading"
      );

    } else {
      setStatus(
        "PDF 대기 중",
        "회사 PC의 PDF 변환 Agent가 요청을 확인할 때까지 기다리고 있습니다.",
        "loading"
      );
    }


    await waitLogSheetPdf(
      LOG_SHEET_PDF_POLL_INTERVAL
    );
  }


  throw new Error(
    "PDF 변환 대기 시간이 3분을 초과했습니다."
  );
}

async function fetchLogSheetPdfBlob(
  requestId,
  options = {}
) {
  const waitUntilReady =
    options.waitUntilReady ===
      true;


  const token =
    getSessionToken();


  if (!token) {
    throw new Error(
      "로그인 정보가 없습니다. 다시 로그인해 주세요."
    );
  }


  const startedAt =
    Date.now();


  while (true) {
    const response =
      await fetch(
        `/api/log-sheet-pdf-files?action=preview&id=${encodeURIComponent(
          requestId
        )}&_=${Date.now()}`,
        {
          method:
            "GET",

          cache:
            "no-store",

          headers: {
            Accept:
              "application/pdf",

            Authorization:
              `Bearer ${token}`
          }
        }
      );


    /*
      200:
      PDF 생성 완료
    */
    if (
      response.ok
    ) {
      const contentType =
        normalizeText(
          response.headers.get(
            "content-type"
          )
        ).toLowerCase();


      const blob =
        await response.blob();


      if (
        blob.size <
          5
      ) {
        throw new Error(
          "생성된 PDF 파일이 비어 있습니다."
        );
      }


      if (
        !contentType.includes(
          "application/pdf"
        )
      ) {
        throw new Error(
          "서버에서 받은 파일이 PDF 형식이 아닙니다."
        );
      }


      console.log(
        "Log Sheet PDF 직접 수신 완료:",
        requestId,
        `${blob.size} bytes`
      );


      return blob;
    }


    /*
      409:
      정상적인 변환 대기 상태.

      Agent가 아직 처리 중이므로
      오류로 취급하지 않고 계속 기다린다.
    */
    if (
      response.status ===
        409 &&
      waitUntilReady
    ) {
      if (
        Date.now() -
          startedAt >=
          LOG_SHEET_PDF_MAXIMUM_WAIT
      ) {
        throw new Error(
          "PDF 변환 대기 시간이 3분을 초과했습니다."
        );
      }


      setLogSheetPdfPreviewProgress(
        "PDF 변환 대기 중",
        "회사 PC의 Microsoft Excel에서 원본 인쇄 양식을 만들고 있습니다."
      );


      await waitLogSheetPdf(
        LOG_SHEET_PDF_POLL_INTERVAL
      );


      continue;
    }


    let message =
      "";


    try {
      const payload =
        await response.json();


      message =
        normalizeText(
          payload?.message
        );

    } catch {
      /* JSON 오류 응답이 아니면 기본 메시지 사용 */
    }


    throw new Error(
      message ||
      `PDF 파일을 불러오지 못했습니다. (${response.status})`
    );
  }
}

function releaseLogSheetPdfUrlWhenClosed(
  previewWindow,
  objectUrl
) {
  const timer =
    window.setInterval(
      () => {
        if (
          previewWindow.closed
        ) {
          window.clearInterval(
            timer
          );


          URL.revokeObjectURL(
            objectUrl
          );
        }
      },
      1500
    );


  /*
    비정상적으로 창이 계속 남아 있어도
    30분 뒤에는 Object URL을 정리한다.
  */
  window.setTimeout(
    () => {
      window.clearInterval(
        timer
      );


      URL.revokeObjectURL(
        objectUrl
      );
    },
    30 *
    60 *
    1000
  );
}


/* =========================================================
  Log Sheet PDF 미리보기 모달

  중요:
  별도 about:blank 팝업을 사용하지 않는다.

  현재 Log Sheet 화면 위에서:
  XLSX 생성
  → Agent Excel PDF 변환
  → PDF Blob 조회
  → iframe PDF Viewer 표시
========================================================= */

let logSheetPdfPreviewObjectUrl =
  "";

/* =========================================================
  Log Sheet PDF 미리보기 캐시

  목적:
  - 같은 Log Sheet
  - 같은 날짜/근무
  - 입력값 변경 없음

  위 조건이면:
  - 새 PDF 요청 생성 안 함
  - Agent 호출 안 함
  - Excel 실행 안 함
  - 직전 PDF Blob 즉시 재사용

  값이 하나라도 변경되면 fingerprint가 달라져
  자동으로 새 PDF를 생성한다.
========================================================= */

const LOG_SHEET_PDF_CACHE_MAX_ENTRIES =
  12;


const logSheetPdfCache =
  new Map();


function getLogSheetPdfCacheScopeKey() {
  const identity =
    getIdentity();


  return [
    normalizeText(
      identity.templateKey
    ),

    normalizeText(
      identity.sheetKey
    ),

    normalizeText(
      state.sheetConfig?.sheetName
    ),

    normalizeText(
      identity.date
    ),

    normalizeText(
      identity.shift
    ),

    normalizeText(
      identity.team
    )
  ].join(
    "||"
  );
}


async function createLogSheetPdfFingerprint() {
  const identity =
    getIdentity();


  /*
    XLSX 파일 자체를 해시하지 않는다.

    XLSX ZIP 내부 메타데이터가 달라져도
    실제 Log Sheet 내용이 같으면
    동일한 PDF를 재사용하기 위해:

    - 양식 버전
    - 현재 시트
    - 조회 기준
    - 직접 입력값
    - 자동 생성값

    만으로 fingerprint를 만든다.
  */
  const fingerprintSource =
    JSON.stringify({
      version:
        3,

      loggingIntervalHours:
        getLoggingIntervalHours(),

      loggingStartHour:
        getLoggingStartHour(),

      templateFile:
        normalizeText(
          state.documentConfig
            ?.templateFile
        ),

      templateSha256:
        normalizeText(
          state.documentConfig
            ?.templateSha256
        ),

      sheetName:
        normalizeText(
          state.sheetConfig
            ?.sheetName
        ),

      identity: {
        templateKey:
          normalizeText(
            identity.templateKey
          ),

        sheetKey:
          normalizeText(
            identity.sheetKey
          ),

        date:
          normalizeText(
            identity.date
          ),

        shift:
          normalizeText(
            identity.shift
          ),

        team:
          normalizeText(
            identity.team
          )
      },

      values:
        stableJson(
          state.values
        ),

      generatedValues:
        stableJson(
          state.generatedValues
        )
    });


  /*
    HTTPS 환경에서는 SHA-256 사용
  */
  if (
    globalThis.crypto?.subtle
  ) {
    const digest =
      await globalThis.crypto.subtle.digest(
        "SHA-256",
        new TextEncoder()
          .encode(
            fingerprintSource
          )
      );


    return [
      ...new Uint8Array(
        digest
      )
    ]
      .map(
        byte =>
          byte
            .toString(
              16
            )
            .padStart(
              2,
              "0"
            )
      )
      .join(
        ""
      );
  }


  /*
    구형 환경 fallback.
    캐시 판별용이므로 보안 목적 해시는 아니다.
  */
  let hash =
    2166136261;


  for (
    let index = 0;
    index <
      fingerprintSource.length;
    index += 1
  ) {
    hash ^=
      fingerprintSource.charCodeAt(
        index
      );


    hash =
      Math.imul(
        hash,
        16777619
      );
  }


  return (
    `fallback-${(
      hash >>>
      0
    ).toString(16)}`
  );
}


function getCachedLogSheetPdf(
  scopeKey,
  fingerprint
) {
  const cached =
    logSheetPdfCache.get(
      scopeKey
    );


  if (
    !cached ||
    cached.fingerprint !==
      fingerprint ||
    !(cached.blob instanceof Blob) ||
    cached.blob.size <
      5
  ) {
    return null;
  }


  /*
    최근 사용 항목을 Map 뒤로 이동
  */
  logSheetPdfCache.delete(
    scopeKey
  );


  cached.lastUsedAt =
    Date.now();


  logSheetPdfCache.set(
    scopeKey,
    cached
  );


  return cached.blob;
}


function saveLogSheetPdfCache(
  scopeKey,
  fingerprint,
  pdfBlob
) {
  if (
    !(pdfBlob instanceof Blob) ||
    pdfBlob.size <
      5
  ) {
    return;
  }


  /*
    같은 Log Sheet 기준은
    최신 PDF 하나만 유지한다.

    따라서 수정 후 새 PDF를 만들면
    이전 fingerprint PDF는 자동 교체된다.
  */
  logSheetPdfCache.delete(
    scopeKey
  );


  logSheetPdfCache.set(
    scopeKey,
    {
      fingerprint,

      blob:
        pdfBlob,

      createdAt:
        Date.now(),

      lastUsedAt:
        Date.now()
    }
  );


  /*
    여러 Log Sheet를 계속 열어도
    브라우저 메모리가 무한 증가하지 않게 제한한다.
  */
  while (
    logSheetPdfCache.size >
      LOG_SHEET_PDF_CACHE_MAX_ENTRIES
  ) {
    const oldestKey =
      logSheetPdfCache
        .keys()
        .next()
        .value;


    if (
      oldestKey ===
        undefined
    ) {
      break;
    }


    logSheetPdfCache.delete(
      oldestKey
    );
  }
}




function releaseLogSheetPdfPreviewObjectUrl() {
  if (
    !logSheetPdfPreviewObjectUrl
  ) {
    return;
  }


  URL.revokeObjectURL(
    logSheetPdfPreviewObjectUrl
  );


  logSheetPdfPreviewObjectUrl =
    "";
}


function ensureLogSheetPdfPreviewModal() {
  let modal =
    document.getElementById(
      "logSheetPdfPreviewModal"
    );


  if (
    modal
  ) {
    return modal;
  }


  modal =
    document.createElement(
      "div"
    );


  modal.id =
    "logSheetPdfPreviewModal";


  modal.innerHTML = `
    <div
      data-log-sheet-pdf-backdrop
      style="
        position:absolute;
        inset:0;
        background:rgba(25,42,58,.58);
      "
    ></div>

    <section
      style="
        position:relative;
        display:grid;
        grid-template-rows:auto minmax(0,1fr) auto;
        width:min(1180px,calc(100vw - 48px));
        height:min(860px,calc(100vh - 48px));
        overflow:hidden;
        border:1px solid #cad5df;
        border-radius:14px;
        background:#fff;
        box-shadow:0 24px 70px rgba(13,31,48,.28);
      "
    >

      <header
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:20px;
          min-height:58px;
          padding:10px 14px 10px 18px;
          border-bottom:1px solid #dbe4ec;
          background:#fff;
        "
      >

        <div
          style="
            min-width:0;
          "
        >

          <div
            style="
              margin-bottom:3px;
              color:#1573bd;
              font-size:8px;
              font-weight:900;
              letter-spacing:1.4px;
            "
          >
            PRINT PREVIEW
          </div>

          <strong
            id="logSheetPdfPreviewTitle"
            style="
              display:block;
              overflow:hidden;
              color:#173754;
              font-size:14px;
              font-weight:900;
              text-overflow:ellipsis;
              white-space:nowrap;
            "
          >
            Log Sheet PDF 미리보기
          </strong>

        </div>


        <button
          type="button"
          data-log-sheet-pdf-close
          aria-label="닫기"
          style="
            display:grid;
            place-items:center;
            flex:0 0 34px;
            width:34px;
            height:34px;
            padding:0;
            border:0;
            border-radius:9px;
            background:#eef3f7;
            color:#45647f;
            cursor:pointer;
            font-size:22px;
            line-height:1;
          "
        >
          ×
        </button>

      </header>


      <div
        style="
          position:relative;
          min-height:0;
          overflow:hidden;
          background:#dfe5eb;
        "
      >

        <div
          id="logSheetPdfPreviewLoading"
          style="
            position:absolute;
            inset:0;
            z-index:2;
            display:grid;
            place-items:center;
            padding:24px;
            background:#eef3f7;
          "
        >

          <div
            style="
              display:grid;
              gap:8px;
              max-width:520px;
              text-align:center;
            "
          >

            <strong
              id="logSheetPdfPreviewLoadingTitle"
              style="
                color:#1c4569;
                font-size:17px;
                font-weight:900;
              "
            >
              PDF 미리보기 준비 중
            </strong>

            <span
              id="logSheetPdfPreviewLoadingText"
              style="
                color:#6e8498;
                font-size:11px;
                line-height:1.55;
              "
            >
              현재 Log Sheet를 준비하고 있습니다.
            </span>

          </div>

        </div>


        <iframe
          id="logSheetPdfPreviewFrame"
          title="Log Sheet PDF 미리보기"
          style="
            display:block;
            width:100%;
            height:100%;
            border:0;
            background:#dfe5eb;
          "
        ></iframe>

      </div>


      <footer
        style="
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:14px;
          min-height:52px;
          padding:8px 14px;
          border-top:1px solid #dbe4ec;
          background:#fff;
        "
      >

        <span
          style="
            color:#687f93;
            font-size:9px;
            font-weight:750;
          "
        >
          Microsoft Excel 원본 인쇄 설정
        </span>


        <div
          style="
            display:flex;
            gap:7px;
          "
        >

          <button
            type="button"
            data-log-sheet-pdf-close
            style="
              min-width:58px;
              min-height:31px;
              padding:0 12px;
              border:1px solid #bdccda;
              border-radius:7px;
              background:#fff;
              color:#375775;
              cursor:pointer;
              font-size:10px;
              font-weight:850;
            "
          >
            닫기
          </button>


          <button
            type="button"
            id="logSheetPdfPreviewPrintButton"
            style="
              min-width:58px;
              min-height:31px;
              padding:0 12px;
              border:1px solid #1684cd;
              border-radius:7px;
              background:#1684cd;
              color:#fff;
              cursor:pointer;
              font-size:10px;
              font-weight:900;
            "
          >
            인쇄
          </button>

        </div>

      </footer>

    </section>
  `;


  Object.assign(
    modal.style,
    {
      position:
        "fixed",

      inset:
        "0",

      zIndex:
        "2147483000",

      display:
      "flex",

    visibility:
      "hidden",

    opacity:
      "0",

    pointerEvents:
      "none",

      alignItems:
        "center",

      justifyContent:
        "center",

      padding:
        "24px"
    }
  );


  document.body.append(
    modal
  );


  const closePreview =
    () => {
      modal.style.display =
        "flex";

      modal.style.visibility =
        "hidden";

      modal.style.opacity =
        "0";

      modal.style.pointerEvents =
        "none";


      const frame =
        modal.querySelector(
          "#logSheetPdfPreviewFrame"
        );
      /*
        같은 PDF를 다시 열 때 즉시 표시하기 위해
        닫을 때 iframe src와 Object URL을 유지한다.

        새 PDF가 표시될 때만 기존 Object URL을 정리한다.
      */
    };


  modal
    .querySelectorAll(
      "[data-log-sheet-pdf-close]"
    )
    .forEach(
      button => {
        button.addEventListener(
          "click",
          closePreview
        );
      }
    );


  modal
    .querySelector(
      "[data-log-sheet-pdf-backdrop]"
    )
    ?.addEventListener(
      "click",
      closePreview
    );


  modal
    .querySelector(
      "#logSheetPdfPreviewPrintButton"
    )
    ?.addEventListener(
      "click",
      () => {
        const frame =
          modal.querySelector(
            "#logSheetPdfPreviewFrame"
          );


        try {
          frame?.contentWindow?.focus();

          frame?.contentWindow?.print();

        } catch (
          error
        ) {
          console.warn(
            "PDF 인쇄창 호출 실패:",
            error
          );
        }
      }
    );


  return modal;
}


function setLogSheetPdfPreviewProgress(
  title,
  description
) {
  const modal =
    ensureLogSheetPdfPreviewModal();


  modal.style.display =
    "flex";


  const loading =
    modal.querySelector(
      "#logSheetPdfPreviewLoading"
    );


  const loadingTitle =
    modal.querySelector(
      "#logSheetPdfPreviewLoadingTitle"
    );


  const loadingText =
    modal.querySelector(
      "#logSheetPdfPreviewLoadingText"
    );


  const frame =
    modal.querySelector(
      "#logSheetPdfPreviewFrame"
    );


  if (
    loading
  ) {
    loading.style.display =
      "grid";
  }


  if (
    loadingTitle
  ) {
    loadingTitle.textContent =
      title;
  }


  if (
    loadingText
  ) {
    loadingText.textContent =
      description;
  }


  if (
    frame
  ) {
    frame.style.visibility =
      "hidden";
  }
}


function showLogSheetPdfPreviewBlob(
  pdfBlob,
  options = {}
) {
  const modal =
    ensureLogSheetPdfPreviewModal();

  modal.style.display =
    "flex";


  modal.style.visibility =
    "visible";


  modal.style.opacity =
    "1";


  modal.style.pointerEvents =
    "auto";


  const frame =
    modal.querySelector(
      "#logSheetPdfPreviewFrame"
    );


  const loading =
    modal.querySelector(
      "#logSheetPdfPreviewLoading"
    );


  const title =
    modal.querySelector(
      "#logSheetPdfPreviewTitle"
    );


  if (
    !frame
  ) {
    throw new Error(
      "PDF Viewer를 생성하지 못했습니다."
    );
  }


  const reuseRenderedPdf =
    frame.__logSheetPdfPreviewBlob ===
      pdfBlob &&
    Boolean(
      logSheetPdfPreviewObjectUrl
    ) &&
    frame.getAttribute(
      "src"
    ) ===
      logSheetPdfPreviewObjectUrl;


  if (
    !reuseRenderedPdf
  ) {
    releaseLogSheetPdfPreviewObjectUrl();


    logSheetPdfPreviewObjectUrl =
      URL.createObjectURL(
        pdfBlob
      );


    frame.__logSheetPdfPreviewBlob =
      pdfBlob;
  }


  if (
    title
  ) {
    title.textContent =
      `${
        state.sheetConfig?.title ||
        state.sheetConfig?.sheetName ||
        "Log Sheet"
      } · PDF 미리보기`;
  }


  if (
    loading
  ) {
    loading.style.display =
      "none";
  }


  frame.style.visibility =
    "visible";


  if (
    !reuseRenderedPdf
  ) {
    frame.src =
      logSheetPdfPreviewObjectUrl;
  }


  if (
    reuseRenderedPdf &&
    options.autoPrint ===
      true
  ) {
    window.setTimeout(
      () => {
        try {
          frame.contentWindow?.focus();

          frame.contentWindow?.print();

        } catch (
          error
        ) {
          console.warn(
            "PDF 자동 인쇄창 호출 실패:",
            error
          );
        }
      },
      100
    );


    return;
  }


  if (
    options.autoPrint ===
      true
  ) {
    frame.addEventListener(
      "load",
      () => {
        window.setTimeout(
          () => {
            try {
              frame.contentWindow?.focus();

              frame.contentWindow?.print();

            } catch (
              error
            ) {
              console.warn(
                "PDF 자동 인쇄창 호출 실패:",
                error
              );
            }
          },
          700
        );
      },
      {
        once:
          true
      }
    );
  }
}


function showLogSheetPdfPreviewError(
  error
) {
  setLogSheetPdfPreviewProgress(
    "PDF 미리보기 실패",
    error?.message ||
      "PDF 미리보기를 만들지 못했습니다."
  );
}


async function openLogSheetPdfPreview(
  options = {}
) {
  if (
    state.isBusy ||
    !state.sheetConfig
  ) {
    return;
  }


  const autoPrint =
    options.autoPrint ===
      true;


  try {
    /*
      =====================================================
      1. 현재 Log Sheet 내용 fingerprint 생성
      =====================================================
    */

    const cacheScopeKey =
      getLogSheetPdfCacheScopeKey();


    const fingerprint =
      await createLogSheetPdfFingerprint();


    /*
      =====================================================
      2. 동일 내용 PDF가 이미 있으면 즉시 표시

      중요:
      여기서는
      - XLSX 생성 없음
      - 서버 요청 없음
      - Agent 요청 없음
      - Excel 실행 없음
      =====================================================
    */

    const cachedPdfBlob =
      getCachedLogSheetPdf(
        cacheScopeKey,
        fingerprint
      );


    if (
      cachedPdfBlob
    ) {
      console.log(
        "Log Sheet PDF 캐시 재사용:",
        state.sheetConfig
          ?.sheetName,
        `${cachedPdfBlob.size} bytes`
      );


      showLogSheetPdfPreviewBlob(
        cachedPdfBlob,
        {
          autoPrint
        }
      );


      setStatus(
        "PDF 즉시 표시",
        "변경된 내용이 없어 직전 PDF 미리보기를 재사용했습니다.",
        state.isDirty
          ? "dirty"
          : "saved"
      );


      return;
    }


    /*
      =====================================================
      3. 내용이 변경된 경우에만 새 PDF 생성
      =====================================================
    */

    setLogSheetPdfPreviewProgress(
      "Excel 파일 생성 중",
      "변경된 내용을 원본 Log Sheet Excel 양식에 반영하고 있습니다."
    );


    setBusy(
      true,
      "변경된 내용으로 원본 Excel PDF를 만들고 있습니다."
    );


    const workbookBlob =
      await createPatchedWorkbookBlob();


    setLogSheetPdfPreviewProgress(
      "PDF 변환 요청 중",
      "회사 PC의 Microsoft Excel에 PDF 변환을 요청하고 있습니다."
    );


    const requestId =
      await createLogSheetPdfRequest(
        workbookBlob
      );


    setLogSheetPdfPreviewProgress(
      "PDF 변환 대기 중",
      "회사 PC의 Microsoft Excel에서 원본 인쇄 양식을 만들고 있습니다."
    );


    /*
      상태 API를 별도로 기다리지 않고
      PDF 자체가 준비될 때까지 직접 조회한다.
    */
    const pdfBlob =
      await fetchLogSheetPdfBlob(
        requestId,
        {
          waitUntilReady:
            true
        }
      );


    setLogSheetPdfPreviewProgress(
      "PDF 불러오는 중",
      "생성된 PDF를 미리보기에 표시하고 있습니다."
    );


    /*
      =====================================================
      4. 새 PDF 캐시에 저장

      이후 값이 바뀌지 않은 상태에서
      미리보기를 다시 누르면 이 Blob을 즉시 재사용한다.
      =====================================================
    */

    saveLogSheetPdfCache(
      cacheScopeKey,
      fingerprint,
      pdfBlob
    );


    console.log(
      "Log Sheet PDF 캐시 저장:",
      state.sheetConfig
        ?.sheetName,
      `${pdfBlob.size} bytes`
    );


    showLogSheetPdfPreviewBlob(
      pdfBlob,
      {
        autoPrint
      }
    );


    setStatus(
      "PDF 준비 완료",
      "Microsoft Excel 원본 인쇄 설정으로 PDF를 만들었습니다.",
      state.isDirty
        ? "dirty"
        : "saved"
    );

  } catch (
    error
  ) {
    console.error(
      "Log Sheet PDF 미리보기 실패:",
      error
    );


    showLogSheetPdfPreviewError(
      error
    );


    setStatus(
      "PDF 실패",
      error?.message ||
        "PDF 미리보기를 만들지 못했습니다.",
      "error"
    );

  } finally {
    /*
      캐시 재사용 시에는 setBusy(true)를 실행하지 않았지만
      false 재설정은 안전하다.
    */
    setBusy(
      false
    );
  }
}

function printCurrentSheet() {
  openLogSheetPdfPreview({
    autoPrint:
      true
  });
}
function bindEvents() {
  elements.loadButton.addEventListener(
    "click",
    () => loadRecord()
  );

  elements.saveButton.addEventListener(
    "click",
    saveRecord
  );

  elements.historyButton.addEventListener(
    "click",
    showHistory
  );

  elements.itemAddButton?.addEventListener(
    "click",
    addLoggingItem
  );

  elements.templateSaveButton?.addEventListener(
    "click",
    saveLoggingTemplate
  );

  elements.loggingInterval?.addEventListener(
    "change",
    handleLoggingIntervalChange
  );

  elements.loggingStartHour?.addEventListener(
    "change",
    handleLoggingStartHourChange
  );

  elements.previewButton.addEventListener(
    "click",
    () => {
      openLogSheetPdfPreview({
        autoPrint:
          false
      });
    }
  );
  elements.downloadButton.addEventListener(
    "click",
    downloadWorkbook
  );

  elements.printButton.addEventListener(
    "click",
    printCurrentSheet
  );

  elements.historyCloseButton.addEventListener(
    "click",
    () => {
      elements.historyDialog.close();
    }
  );

  [
    elements.date,
    elements.shift,
    elements.team
  ].forEach(
    control => {
      control.addEventListener(
        "focus",
        () => {
          control.dataset.previousValue =
            control.value;
        }
      );

      control.addEventListener(
        "change",
        handleIdentityChange
      );
    }
  );

  window.addEventListener(
    "beforeunload",
    event => {
      if (!state.isDirty) {
        return;
      }

      event.preventDefault();

      event.returnValue =
        "";
    }
  );

  window.addEventListener(
    "beforeprint",
    () => {
      state.printZoom =
        document.documentElement
          .style.zoom || "";

      document.documentElement
        .style.zoom = "1";
    }
  );

  window.addEventListener(
    "afterprint",
    () => {
      document.documentElement
        .style.zoom =
        state.printZoom;
    }
  );
}
  async function start() {
    try {
      try {
        globalThis.XLSX =
          globalThis.XLSX ||
          window.top?.XLSX;

        globalThis.JSZip =
          globalThis.JSZip ||
          window.top?.JSZip;

      } catch {
        /* CDN 모듈을 아래 검사에서 확인한다. */
      }

      if (
        !config ||
        !globalThis.XLSX ||
        !globalThis.JSZip
      ) {
        throw new Error(
          "Log Sheet 편집 모듈을 불러오지 못했습니다. 네트워크와 캐시를 확인해 주세요."
        );
      }

      const route =
        resolveRoute();

      state.documentConfig =
        route.documentConfig;

      state.sheetConfig =
        route.sheetConfig;

      resetLoggingIntervalForCurrentSheet();

      applyIdentityPolicy();

      elements.date.value =
        todayIsoDate();

      const user =
        getStoredUser();

      const savedTeam =
        normalizeText(
          user?.team ||
          user?.shiftTeam ||
          user?.shift_team
        ).replace(/[^1-4]/g, "");

      if (savedTeam) {
        elements.team.value =
          savedTeam;
      }

      [
        elements.date,
        elements.shift,
        elements.team
      ].forEach(
        control => {
          control.dataset
            .previousValue =
            control.value;
        }
      );

      elements.title.textContent =
        state.documentConfig.title;

      elements.description.textContent =
        `${state.documentConfig.groupTitle} · 원본 엑셀 서식을 유지하여 저장·출력합니다.`;

      document.title =
        `${state.documentConfig.title} · Log Sheet`;

      bindEvents();
      setPreviewOpen(false);
      renderTabs();

      await loadTemplate();

      state.values =
        {};
      state.generatedValues =
        {};

      ensureMetadataValues();

      if (
        state.sheetConfig.key ===
          "electrical-patrol"
      ) {
        state.generatedValues =
          createGeneratedSnapshot();
      }

      renderLoggingItemList();
      renderGridIfPreviewVisible();
      renderAuxiliaryControls();

      await loadRecord({
        skipDirtyConfirmation: true
      });

    } catch (
      error
    ) {
      console.error(
        "Log Sheet 초기화 실패:",
        error
      );

      elements.loading.hidden =
        true;

      setStatus(
        "초기화 실패",
        error.message,
        "error"
      );
    }
  }

  if (
    document.readyState ===
      "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      {
        once: true
      }
    );

  } else {
    start();
  }
})();
