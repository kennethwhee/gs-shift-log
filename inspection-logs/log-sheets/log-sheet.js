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
      elements.printButton
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
        state.sheetConfig.sheetName
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
              section.ranges || []
            ).map(
              rangeText =>
                parseRange(
                  rangeText
                ).s.c
            )
          );

        (
          section.ranges || []
        ).forEach(
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
              rowNumbers.add(
                row + 1
              );
            }
          }
        );

        [
          ...rowNumbers
        ].sort(
          (left, right) =>
            left - right
        ).forEach(
          rowNumber => {
            const nameParts =
              (
                section.nameColumns || []
              ).map(
                column =>
                  getTemplateCellText(
                    sheet,
                    `${column}${rowNumber}`
                  )
              ).filter(
                (value, index, array) =>
                  value &&
                  array.indexOf(value) ===
                    index
              );

            const name =
              nameParts.join(
                " · "
              );

            if (!name) {
              return;
            }

            const tag =
              section.tagColumn
                ? getTemplateCellText(
                    sheet,
                    `${section.tagColumn}${rowNumber}`
                  )
                : "";

            const unit =
              section.unitColumn
                ? getTemplateCellText(
                    sheet,
                    `${section.unitColumn}${rowNumber}`
                  )
                : "";

            items.push({
              name,
              tag,
              unit,
              sourceRow:
                rowNumber,
              sourceColumn
            });
          }
        );
      }
    );

    items.sort(
      (left, right) =>
        left.sourceRow -
          right.sourceRow ||
        left.sourceColumn -
          right.sourceColumn
    );

    return items.map(
      (item, index) => ({
        ...item,
        order:
          index + 1
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

    name: "",
    tag: "",
    unit: "",

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

          name:
            normalizeLoggingText(
              savedItem.name
            ),

          tag:
            normalizeLoggingText(
              savedItem.tag
            ),

          unit:
            normalizeLoggingText(
              savedItem.unit
            ),

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
        name:
          normalizeLoggingText(
            savedItem.name
          ),

        tag:
          normalizeLoggingText(
            savedItem.tag
          ),

        unit:
          normalizeLoggingText(
            savedItem.unit
          )
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
      .filter(
        item =>
          normalizeLoggingText(
            item.name
          )
      )
      .map(
        (
          item,
          index
        ) => {
          const itemKey =
            getLoggingItemDraftKey(
              item
            );


          return {
            key:
              itemKey,

            order:
              index + 1,

            name:
              normalizeLoggingText(
                item.name
              ),

            tag:
              normalizeLoggingText(
                item.tag
              ),

            unit:
              normalizeLoggingText(
                item.unit
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
      );


  return {
    templateKey:
      identity.templateKey,

    sheetKey:
      identity.sheetKey,

    sheetName:
      state.sheetConfig.sheetName,

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

  if (!items.length) {
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
      const row =
        document.createElement(
          "div"
        );

      row.className =
        "log-sheet-item-row";

      const draftKey =
        getLoggingItemDraftKey(
          item
        );

      const hasDraft =
        loggingItemDrafts.has(
          draftKey
        );

      if (hasDraft) {
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

      row.addEventListener(
        "click",
        event => {
          if (
            event.target.closest(
              "button, input"
            )
          ) {
            return;
          }

          loggingItemSelectedKey =
            draftKey;

          renderLoggingItemList();
        }
      );

      const order =
        document.createElement(
          "span"
        );

      order.className =
        "log-sheet-item-row__order";

      order.textContent =
        String(item.order);

      const name =
        document.createElement(
          "strong"
        );

      name.className =
        "log-sheet-item-row__name";

      name.textContent =
        item.name ||
        "새 항목";

      const tag =
        document.createElement(
          "span"
        );

      tag.className =
        "log-sheet-item-row__tag";

      tag.textContent =
        item.tag ||
        "-";

      const unit =
        document.createElement(
          "span"
        );

      unit.className =
        "log-sheet-item-row__unit";

      unit.textContent =
        item.unit ||
        "-";

      const editButton =
        document.createElement(
          "button"
        );

      editButton.type =
        "button";

      editButton.textContent =
        hasDraft
          ? "재수정"
          : "수정";

      editButton.addEventListener(
        "click",
        () => {
          loggingItemSelectedKey =
            draftKey;

          beginLoggingItemEdit(
            row,
            item
          );
        }
      );

      row.append(
        order,
        name,
        tag,
        unit,
        editButton
      );

      fragment.appendChild(
        row
      );

      if (
        loggingItemEditingKey ===
        draftKey
      ) {
        beginLoggingItemEdit(
          row,
          item
        );
      }
    }
  );

  elements.itemList.replaceChildren(
    fragment
  );
}

  /*
    본 화면에서는 Excel 전체 Grid를 만들지 않는다.

    기존 inline preview가 실제로 열린 경우에만
    Grid를 다시 그린다.

    새창 미리보기는
    cloneGridForPreviewWindow()에서 별도로 렌더링한다.
  */
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


        value.textContent =
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

  function printCurrentSheet() {
    openLogSheetPreviewWindow({
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

  elements.previewButton.addEventListener(
    "click",
    openLogSheetPreviewWindow
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
