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
      typeof style !== "object"
    ) {
      return;
    }

    const fillColor =
      colorToCss(
        style.fill?.fgColor
      );

    const fontColor =
      colorToCss(
        style.font?.color
      );

    if (fillColor) {
      tableCell.style.backgroundColor =
        fillColor;
    }

    if (fontColor) {
      tableCell.style.color =
        fontColor;
    }

    if (style.font?.bold) {
      tableCell.style.fontWeight =
        "800";
    }

    if (style.font?.italic) {
      tableCell.style.fontStyle =
        "italic";
    }

    const horizontal =
      normalizeText(
        style.alignment?.horizontal
      );

    if (
      [
        "left",
        "center",
        "right"
      ].includes(horizontal)
    ) {
      tableCell.style.textAlign =
        horizontal;
    }

    const vertical =
      normalizeText(
        style.alignment?.vertical
      );

    if (
      [
        "top",
        "middle",
        "bottom"
      ].includes(vertical)
    ) {
      tableCell.style.verticalAlign =
        vertical;
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

          renderGrid();
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

  function renderLoggingItemList() {
    if (
      !elements.itemList ||
      !elements.itemCount
    ) {
      return;
    }

    const items =
      extractLoggingItems();

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
          item.name;

        const tag =
          document.createElement(
            "span"
          );

        tag.className =
          "log-sheet-item-row__tag";

        tag.textContent =
          item.tag || "-";

        const unit =
          document.createElement(
            "span"
          );

        unit.className =
          "log-sheet-item-row__unit";

        unit.textContent =
          item.unit || "-";

        const editButton =
          document.createElement(
            "button"
          );

        editButton.type =
          "button";

        editButton.textContent =
          "수정";

        editButton.disabled =
          true;

        editButton.title =
          "다음 단계에서 수정 기능을 연결합니다.";

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
      }
    );

    elements.itemList.replaceChildren(
      fragment
    );
  }
  function renderGrid() {
    const sheet =
      state.workbook?.Sheets?.[
        state.sheetConfig.sheetName
      ];

    if (!sheet) {
      throw new Error(
        `엑셀 시트를 찾을 수 없습니다: ${state.sheetConfig.sheetName}`
      );
    }

    const renderRange =
      parseRange(
        state.sheetConfig.renderRange ||
        sheet["!ref"]
      );

    const editable =
      getEditableAddresses(
        state.sheetConfig
      );

    const {
      anchorMap,
      slaveAddresses
    } = getMergeAnchorMap(
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

    const columnGroup =
      document.createElement(
        "colgroup"
      );

    for (
      let column = renderRange.s.c;
      column <= renderRange.e.c;
      column += 1
    ) {
      const col =
        document.createElement(
          "col"
        );

      const columnInfo =
        sheet["!cols"]?.[column];

      const width =
        Math.max(
          28,
          Math.min(
            150,
            Number(
              columnInfo?.wpx
            ) ||
            Number(
              columnInfo?.wch
            ) * 7 ||
            54
          )
        );

      col.style.width =
        `${width}px`;

      columnGroup.appendChild(
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

    for (
      let row = renderRange.s.r;
      row <= renderRange.e.r;
      row += 1
    ) {
      const tableRow =
        document.createElement(
          "tr"
        );

      const rowInfo =
        sheet["!rows"]?.[row];

      const rowHeight =
        Math.max(
          18,
          Math.min(
            86,
            Number(
              rowInfo?.hpx
            ) ||
            Number(
              rowInfo?.hpt
            ) * 1.333 ||
            22
          )
        );

      tableRow.style.height =
        `${rowHeight}px`;

      for (
        let column = renderRange.s.c;
        column <= renderRange.e.c;
        column += 1
      ) {
        const address =
          XLSX.utils.encode_cell({
            r: row,
            c: column
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

        cell.dataset.cellAddress =
          address;

        const merge =
          anchorMap.get(address);

        if (merge) {
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
          sheet[address];

        applyCellStyle(
          cell,
          workbookCell
        );

        if (
          editable.has(address)
        ) {
          cell.classList.add(
            "is-editable"
          );

          if (
            Object.prototype.hasOwnProperty.call(
              state.values,
              address
            ) &&
            state.values[address] !==
              state.loadedValues[address]
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

        tableRow.appendChild(
          cell
        );
      }

      tableBody.appendChild(
        tableRow
      );
    }

    table.appendChild(
      tableBody
    );

    elements.grid.replaceChildren(
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

    if (
      dateHeader?.address &&
      !Object.prototype.hasOwnProperty.call(
        state.values,
        dateHeader.address
      )
    ) {
      state.values[
        dateHeader.address
      ] = formatDateTemplate(
        dateHeader.valueTemplate,
        elements.date.value
      );
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
    renderGrid();
    setDirty(false);
  }

  async function loadRecord(
    options = {}
  ) {
    if (state.isBusy) {
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

      applyRecord(
        payload.record
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
      setBusy(false);
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
    renderGrid();

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
    renderGrid();

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
        `엑셀 시트 파일이 없습니다: ${worksheetPath}`
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

    const serialized =
      new XMLSerializer()
        .serializeToString(
          worksheetDocument
        );

    zip.file(
      worksheetPath,
      serialized
    );

    return zip.generateAsync({
      type: "blob",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      compression: "DEFLATE",
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

  function setPreviewOpen(
    open
  ) {
    const isOpen =
      Boolean(open);

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
    updatePrintHeading();

    window.requestAnimationFrame(
      () => window.print()
    );
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

    elements.previewButton.addEventListener(
      "click",
      () => {
        setPreviewOpen(
          elements.previewSection.hidden
        );
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
      () => elements.historyDialog.close()
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
            control.dataset
              .previousValue =
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
      renderGrid();
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
