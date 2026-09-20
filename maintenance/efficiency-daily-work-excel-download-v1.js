/* =========================================================
  EFFICIENCY_DAILY_WORK_EXCEL_DOWNLOAD_V1

  일일업무현황
  - 현재 화면 저장
  - 저장 성공 후 기존 월간 Excel 양식 다운로드
  - 기존 XLSX(OpenXML)를 JSZip으로 직접 수정하여
    원본 서식 / 병합 / 도형 / 인쇄설정 최대한 보존

  현재 등록 템플릿:
  - 2026-09
========================================================= */

(() => {
  "use strict";

  const BUTTON_ID =
    "efficiencyDailyWorkExcelDownloadButton";

  const BUTTON_MARKER =
    "EFFICIENCY_DAILY_WORK_EXCEL_DOWNLOAD_V1";

  const TEMPLATE_ROOT =
    "/assets/efficiency-daily-work-excel";

  const XML_NS =
    "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

  const REL_NS =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  const PACKAGE_REL_NS =
    "http://schemas.openxmlformats.org/package/2006/relationships";

  const MIME_XLSX =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  const ROLE_LABELS = {
    "efficiency-overall":
      "효율업무 총괄",

    "efficiency-1":
      "효율업무1",

    "efficiency-2":
      "효율업무2",

    "efficiency-3":
      "효율업무3",

    "purchase-admin":
      "구매·행정업무",

    "operation-day":
      "Day 근무조",

    "operation-night":
      "Night 근무조"
  };

  const FIXED_ROW_KEYS =
    Object.keys(
      ROLE_LABELS
    );

  let busy =
    false;


  function normalizeText(
    value
  ) {
    return String(
      value ??
      ""
    )
      .replace(
        /\r\n?/g,
        "\n"
      )
      .trim();
  }


  function normalizeLabel(
    value
  ) {
    return normalizeText(
      value
    )
      .replace(
        /\s+/g,
        ""
      )
      .replace(
        /[∙ㆍ]/g,
        "·"
      );
  }


  function splitMeaningfulLines(
    value
  ) {
    return String(
      value ??
      ""
    )
      .replace(
        /\r\n?/g,
        "\n"
      )
      .split(
        "\n"
      )
      .map(
        line =>
          line.trim()
      )
      .filter(
        Boolean
      );
  }


  function formatBracketName(
    value,
    options = {}
  ) {
    const raw =
      normalizeText(
        value
      )
        .replace(
          /^\[/,
          ""
        )
        .replace(
          /\]$/,
          ""
        )
        .replace(
          /\+$/,
          ""
        )
        .trim();

    if (!raw) {
      return "";
    }

    return options.plus === true
      ? `[${raw}+]`
      : `[${raw}]`;
  }


  function extractPartNumber(
    value
  ) {
    const match =
      String(
        value ??
        ""
      ).match(
        /([1-4])/
      );

    return match
      ? Number(
          match[1]
        )
      : "";
  }


  function parseXml(
    text
  ) {
    const documentValue =
      new DOMParser()
        .parseFromString(
          text,
          "application/xml"
        );

    const parserError =
      documentValue
        .getElementsByTagName(
          "parsererror"
        )[0];

    if (parserError) {
      throw new Error(
        "Excel XML을 해석하지 못했습니다."
      );
    }

    return documentValue;
  }


  function serializeXml(
    documentValue
  ) {
    return new XMLSerializer()
      .serializeToString(
        documentValue
      );
  }


  function getElementsByLocalName(
    root,
    localName
  ) {
    if (!root) {
      return [];
    }

    return [
      ...root.getElementsByTagNameNS(
        "*",
        localName
      )
    ];
  }


  function getFirstChildByLocalName(
    parent,
    localName
  ) {
    if (!parent) {
      return null;
    }

    return [
      ...parent.childNodes
    ].find(
      node =>
        node.nodeType === 1 &&
        node.localName ===
          localName
    ) ||
    null;
  }


  function removeCellValueNodes(
    cell
  ) {
    if (!cell) {
      return;
    }

    [
      ...cell.childNodes
    ]
      .filter(
        node =>
          node.nodeType === 1 &&
          [
            "f",
            "v",
            "is"
          ].includes(
            node.localName
          )
      )
      .forEach(
        node =>
          node.remove()
      );

    cell.removeAttribute(
      "t"
    );
  }


  function parseCellAddress(
    address
  ) {
    const match =
      String(
        address ||
        ""
      ).match(
        /^([A-Z]+)(\d+)$/i
      );

    if (!match) {
      return null;
    }

    return {
      column:
        match[1]
          .toUpperCase(),

      row:
        Number(
          match[2]
        )
    };
  }


  function columnLettersToNumber(
    letters
  ) {
    return String(
      letters ||
      ""
    )
      .toUpperCase()
      .split(
        ""
      )
      .reduce(
        (
          total,
          character
        ) =>
          total * 26 +
          character.charCodeAt(0) -
          64,
        0
      );
  }


  function getRowElement(
    sheetDocument,
    rowNumber
  ) {
    return getElementsByLocalName(
      sheetDocument,
      "row"
    ).find(
      row =>
        Number(
          row.getAttribute(
            "r"
          )
        ) ===
        Number(
          rowNumber
        )
    ) ||
    null;
  }


  function ensureRowElement(
    sheetDocument,
    rowNumber
  ) {
    const existing =
      getRowElement(
        sheetDocument,
        rowNumber
      );

    if (existing) {
      return existing;
    }

    const sheetData =
      getElementsByLocalName(
        sheetDocument,
        "sheetData"
      )[0];

    if (!sheetData) {
      throw new Error(
        "Excel SheetData를 찾지 못했습니다."
      );
    }

    const row =
      sheetDocument.createElementNS(
        XML_NS,
        "row"
      );

    row.setAttribute(
      "r",
      String(
        rowNumber
      )
    );

    const nextRow =
      [
        ...sheetData.children
      ].find(
        candidate =>
          Number(
            candidate.getAttribute(
              "r"
            )
          ) >
          rowNumber
      );

    if (nextRow) {
      sheetData.insertBefore(
        row,
        nextRow
      );
    } else {
      sheetData.appendChild(
        row
      );
    }

    return row;
  }


  function getCellElement(
    sheetDocument,
    address
  ) {
    return getElementsByLocalName(
      sheetDocument,
      "c"
    ).find(
      cell =>
        String(
          cell.getAttribute(
            "r"
          ) ||
          ""
        ).toUpperCase() ===
        String(
          address ||
          ""
        ).toUpperCase()
    ) ||
    null;
  }


  function ensureCellElement(
    sheetDocument,
    address
  ) {
    const existing =
      getCellElement(
        sheetDocument,
        address
      );

    if (existing) {
      return existing;
    }

    const parsed =
      parseCellAddress(
        address
      );

    if (!parsed) {
      throw new Error(
        `올바르지 않은 Excel 셀 주소입니다: ${address}`
      );
    }

    const row =
      ensureRowElement(
        sheetDocument,
        parsed.row
      );

    const cell =
      sheetDocument.createElementNS(
        XML_NS,
        "c"
      );

    cell.setAttribute(
      "r",
      `${parsed.column}${parsed.row}`
    );

    const targetColumnNumber =
      columnLettersToNumber(
        parsed.column
      );

    const nextCell =
      [
        ...row.children
      ].find(
        candidate => {
          const candidateAddress =
            parseCellAddress(
              candidate.getAttribute(
                "r"
              )
            );

          return Boolean(
            candidateAddress &&
            columnLettersToNumber(
              candidateAddress.column
            ) >
              targetColumnNumber
          );
        }
      );

    if (nextCell) {
      row.insertBefore(
        cell,
        nextCell
      );
    } else {
      row.appendChild(
        cell
      );
    }

    return cell;
  }


  function setCellInlineText(
    sheetDocument,
    address,
    value
  ) {
    const cell =
      ensureCellElement(
        sheetDocument,
        address
      );

    removeCellValueNodes(
      cell
    );

    const text =
      String(
        value ??
        ""
      );

    if (!text) {
      return;
    }

    cell.setAttribute(
      "t",
      "inlineStr"
    );

    const inlineString =
      sheetDocument.createElementNS(
        XML_NS,
        "is"
      );

    const textNode =
      sheetDocument.createElementNS(
        XML_NS,
        "t"
      );

    textNode.setAttributeNS(
      "http://www.w3.org/XML/1998/namespace",
      "xml:space",
      "preserve"
    );

    textNode.textContent =
      text;

    inlineString.appendChild(
      textNode
    );

    cell.appendChild(
      inlineString
    );
  }


  function setCellNumber(
    sheetDocument,
    address,
    value
  ) {
    const cell =
      ensureCellElement(
        sheetDocument,
        address
      );

    removeCellValueNodes(
      cell
    );

    if (
      value === "" ||
      value === null ||
      value === undefined
    ) {
      return;
    }

    const valueNode =
      sheetDocument.createElementNS(
        XML_NS,
        "v"
      );

    valueNode.textContent =
      String(
        value
      );

    cell.appendChild(
      valueNode
    );
  }


  function clearCell(
    sheetDocument,
    address
  ) {
    const cell =
      getCellElement(
        sheetDocument,
        address
      );

    if (!cell) {
      return;
    }

    removeCellValueNodes(
      cell
    );
  }


  function getSharedStrings(
    sharedStringsDocument
  ) {
    if (!sharedStringsDocument) {
      return [];
    }

    return getElementsByLocalName(
      sharedStringsDocument,
      "si"
    ).map(
      item =>
        getElementsByLocalName(
          item,
          "t"
        )
          .map(
            node =>
              node.textContent ||
              ""
          )
          .join(
            ""
          )
    );
  }


  function getCellText(
    cell,
    sharedStrings
  ) {
    if (!cell) {
      return "";
    }

    const type =
      cell.getAttribute(
        "t"
      );

    if (type === "inlineStr") {
      return getElementsByLocalName(
        cell,
        "t"
      )
        .map(
          node =>
            node.textContent ||
            ""
        )
        .join(
          ""
        );
    }

    const valueNode =
      getFirstChildByLocalName(
        cell,
        "v"
      );

    const rawValue =
      valueNode?.textContent ||
      "";

    if (
      type === "s" &&
      /^\d+$/.test(
        rawValue
      )
    ) {
      return sharedStrings[
        Number(
          rawValue
        )
      ] ||
      "";
    }

    return rawValue;
  }


  function findCellRowByText(
    sheetDocument,
    sharedStrings,
    predicate
  ) {
    for (
      const cell
      of getElementsByLocalName(
        sheetDocument,
        "c"
      )
    ) {
      const text =
        getCellText(
          cell,
          sharedStrings
        );

      if (
        predicate(
          text,
          cell
        )
      ) {
        return parseCellAddress(
          cell.getAttribute(
            "r"
          )
        )?.row ||
        0;
      }
    }

    return 0;
  }


  function parseMergeReference(
    reference
  ) {
    const match =
      String(
        reference ||
        ""
      ).match(
        /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i
      );

    if (!match) {
      return null;
    }

    return {
      startColumn:
        match[1]
          .toUpperCase(),

      startRow:
        Number(
          match[2]
        ),

      endColumn:
        match[3]
          .toUpperCase(),

      endRow:
        Number(
          match[4]
        )
    };
  }


  function getMergeRanges(
    sheetDocument
  ) {
    return getElementsByLocalName(
      sheetDocument,
      "mergeCell"
    )
      .map(
        element =>
          parseMergeReference(
            element.getAttribute(
              "ref"
            )
          )
      )
      .filter(
        Boolean
      );
  }


  function findVerticalGroupRange(
    sheetDocument,
    sharedStrings,
    targetLabel
  ) {
    const targetNormalized =
      normalizeLabel(
        targetLabel
      );

    for (
      const range
      of getMergeRanges(
        sheetDocument
      )
    ) {
      if (
        range.startColumn !== "B" ||
        range.endColumn !== "B" ||
        range.endRow <=
          range.startRow
      ) {
        continue;
      }

      const cell =
        getCellElement(
          sheetDocument,
          `B${range.startRow}`
        );

      const label =
        normalizeLabel(
          getCellText(
            cell,
            sharedStrings
          )
        );

      if (
        label ===
          targetNormalized
      ) {
        return range;
      }
    }

    return null;
  }


  function findMergedRows(
    sheetDocument,
    startRow,
    endRow,
    startColumn = "B",
    endColumn = "J"
  ) {
    return getMergeRanges(
      sheetDocument
    )
      .filter(
        range =>
          range.startColumn ===
            startColumn &&
          range.endColumn ===
            endColumn &&
          range.startRow ===
            range.endRow &&
          range.startRow >=
            startRow &&
          range.startRow <=
            endRow
      )
      .map(
        range =>
          range.startRow
      )
      .sort(
        (
          a,
          b
        ) =>
          a - b
      );
  }


  function setRowHeight(
    sheetDocument,
    rowNumber,
    height
  ) {
    const row =
      ensureRowElement(
        sheetDocument,
        rowNumber
      );

    const currentHeight =
      Number(
        row.getAttribute(
          "ht"
        ) ||
        0
      );

    const nextHeight =
      Math.max(
        Number.isFinite(
          currentHeight
        )
          ? currentHeight
          : 0,
        Number(
          height
        ) ||
        0
      );

    if (
      !Number.isFinite(
        nextHeight
      ) ||
      nextHeight <= 0
    ) {
      return;
    }

    row.setAttribute(
      "ht",
      String(
        Math.min(
          180,
          nextHeight
        )
      )
    );

    row.setAttribute(
      "customHeight",
      "1"
    );
  }


  function estimateRowHeight(
    value,
    charactersPerLine
  ) {
    const lines =
      String(
        value ??
        ""
      )
        .replace(
          /\r\n?/g,
          "\n"
        )
        .split(
          "\n"
        );

    const visualLineCount =
      lines.reduce(
        (
          total,
          line
        ) =>
          total +
          Math.max(
            1,
            Math.ceil(
              Math.max(
                1,
                line.length
              ) /
              Math.max(
                1,
                charactersPerLine
              )
            )
          ),
        0
      );

    return Math.max(
      20.1,
      visualLineCount * 15.5 +
        4
    );
  }


  function writeLinesToRows(
    sheetDocument,
    startRow,
    endRow,
    column,
    sourceValue,
    charactersPerLine
  ) {
    const rowNumbers =
      [];

    for (
      let row =
        startRow;
      row <=
        endRow;
      row +=
        1
    ) {
      rowNumbers.push(
        row
      );

      clearCell(
        sheetDocument,
        `${column}${row}`
      );
    }

    const lines =
      splitMeaningfulLines(
        sourceValue
      );

    if (
      lines.length === 0 ||
      rowNumbers.length === 0
    ) {
      return;
    }

    rowNumbers.forEach(
      (
        rowNumber,
        index
      ) => {
        if (
          index >=
            lines.length
        ) {
          return;
        }

        const isLastSlot =
          index ===
            rowNumbers.length -
            1;

        const value =
          isLastSlot &&
          lines.length >
            rowNumbers.length
            ? lines
                .slice(
                  index
                )
                .join(
                  "\n"
                )
            : lines[
                index
              ];

        setCellInlineText(
          sheetDocument,
          `${column}${rowNumber}`,
          value
        );

        setRowHeight(
          sheetDocument,
          rowNumber,
          estimateRowHeight(
            value,
            charactersPerLine
          )
        );
      }
    );
  }


  function writeInstructionBlock(
    sheetDocument,
    availableRows,
    record
  ) {
    availableRows.forEach(
      row =>
        clearCell(
          sheetDocument,
          `B${row}`
        )
    );

    const lines =
      [];

    const pushBlock =
      (
        label,
        value
      ) => {
        const contentLines =
          splitMeaningfulLines(
            value
          );

        if (
          contentLines.length ===
          0
        ) {
          return;
        }

        if (
          lines.length >
          0
        ) {
          lines.push(
            ""
          );
        }

        lines.push(
          label,
          ...contentLines
        );
      };

    pushBlock(
      "[공지사항]",
      record.notice
    );

    pushBlock(
      "[TM 회의]",
      record.tmMeeting
    );

    pushBlock(
      "[설비운영팀]",
      record.teamInstruction
    );

    if (
      availableRows.length ===
        0 ||
      lines.length ===
        0
    ) {
      return;
    }

    availableRows.forEach(
      (
        row,
        index
      ) => {
        if (
          index >=
            lines.length
        ) {
          return;
        }

        const isLastSlot =
          index ===
            availableRows.length -
            1;

        const value =
          isLastSlot &&
          lines.length >
            availableRows.length
            ? lines
                .slice(
                  index
                )
                .join(
                  "\n"
                )
            : lines[
                index
              ];

        setCellInlineText(
          sheetDocument,
          `B${row}`,
          value
        );

        setRowHeight(
          sheetDocument,
          row,
          estimateRowHeight(
            value,
            115
          )
        );
      }
    );
  }


  function getFixedRowsMap(
    record
  ) {
    const map =
      new Map();

    const rows =
      Array.isArray(
        record?.rows
      )
        ? record.rows
        : [];

    rows.forEach(
      row => {
        const rowKey =
          normalizeText(
            row?.rowKey ||
            row?.row_key
          );

        if (
          FIXED_ROW_KEYS.includes(
            rowKey
          )
        ) {
          map.set(
            rowKey,
            {
              rowKey,
              assignee:
                normalizeText(
                  row?.assignee
                ),
              part:
                normalizeText(
                  row?.part
                ),
              members:
                normalizeText(
                  row?.members
                ),
              tasks:
                normalizeText(
                  row?.tasks
                ),
              remarks:
                normalizeText(
                  row?.remarks
                )
            }
          );
        }
      }
    );

    FIXED_ROW_KEYS.forEach(
      rowKey => {
        if (
          !map.has(
            rowKey
          )
        ) {
          map.set(
            rowKey,
            {
              rowKey,
              assignee:
                "",
              part:
                "",
              members:
                "",
              tasks:
                "",
              remarks:
                ""
            }
          );
        }
      }
    );

    appendExtraRows(
      map,
      record
    );

    return map;
  }


  function appendText(
    base,
    additional
  ) {
    const first =
      normalizeText(
        base
      );

    const second =
      normalizeText(
        additional
      );

    if (!second) {
      return first;
    }

    return first
      ? `${first}\n${second}`
      : second;
  }


  function findExtraRowAnchorKey(
    extraRow
  ) {
    const directCandidates = [
      extraRow?.anchorRowKey,
      extraRow?.anchor_row_key,
      extraRow?.parentRowKey,
      extraRow?.parent_row_key,
      extraRow?.baseRowKey,
      extraRow?.base_row_key
    ];

    for (
      const candidate
      of directCandidates
    ) {
      const normalized =
        normalizeText(
          candidate
        );

      if (
        FIXED_ROW_KEYS.includes(
          normalized
        )
      ) {
        return normalized;
      }
    }

    const searchable =
      JSON.stringify(
        extraRow ||
        {}
      ).toLowerCase();

    for (
      const rowKey
      of FIXED_ROW_KEYS
    ) {
      if (
        searchable.includes(
          rowKey
        )
      ) {
        return rowKey;
      }
    }

    if (
      searchable.includes(
        "night"
      )
    ) {
      return "operation-night";
    }

    if (
      searchable.includes(
        "day"
      ) ||
      searchable.includes(
        "operation"
      )
    ) {
      return "operation-day";
    }

    return "purchase-admin";
  }


  function appendExtraRows(
    fixedRowsMap,
    record
  ) {
    const extraRows =
      Array.isArray(
        record?.extraRows
      )
        ? record.extraRows
        : [];

    extraRows.forEach(
      extraRow => {
        const anchorKey =
          findExtraRowAnchorKey(
            extraRow
          );

        const target =
          fixedRowsMap.get(
            anchorKey
          );

        if (!target) {
          return;
        }

        const title =
          normalizeText(
            extraRow?.label ||
            extraRow?.role ||
            extraRow?.name ||
            extraRow?.assignee ||
            extraRow?.members ||
            extraRow?.part
          );

        const tasks =
          normalizeText(
            extraRow?.tasks ||
            extraRow?.task ||
            extraRow?.content ||
            extraRow?.work ||
            extraRow?.workText
          );

        const remarks =
          normalizeText(
            extraRow?.remarks ||
            extraRow?.remark
          );

        const taskLine =
          title &&
          tasks
            ? `[추가] ${title} : ${tasks}`
            : tasks
              ? `[추가] ${tasks}`
              : title
                ? `[추가] ${title}`
                : "";

        target.tasks =
          appendText(
            target.tasks,
            taskLine
          );

        target.remarks =
          appendText(
            target.remarks,
            remarks
          );
      }
    );
  }


  function clearColumnRows(
    sheetDocument,
    column,
    startRow,
    endRow
  ) {
    for (
      let row =
        startRow;
      row <=
        endRow;
      row +=
        1
    ) {
      clearCell(
        sheetDocument,
        `${column}${row}`
      );
    }
  }


  function writeEfficiencyRows(
    sheetDocument,
    groupRange,
    rowsMap
  ) {
    const rowCount =
      groupRange.endRow -
      groupRange.startRow +
      1;

    if (
      rowCount < 5 ||
      rowCount % 5 !== 0
    ) {
      throw new Error(
        "Excel 효율파트 행 구조가 예상과 다릅니다."
      );
    }

    const blockSize =
      rowCount /
      5;

    const rowKeys = [
      "efficiency-overall",
      "efficiency-1",
      "efficiency-2",
      "efficiency-3",
      "purchase-admin"
    ];

    rowKeys.forEach(
      (
        rowKey,
        index
      ) => {
        const startRow =
          groupRange.startRow +
          index *
            blockSize;

        const endRow =
          index ===
            rowKeys.length -
              1
            ? groupRange.endRow
            : startRow +
              blockSize -
              1;

        const source =
          rowsMap.get(
            rowKey
          );

        clearColumnRows(
          sheetDocument,
          "C",
          startRow,
          endRow
        );

        setCellInlineText(
          sheetDocument,
          `C${startRow}`,
          ROLE_LABELS[
            rowKey
          ]
        );

        setCellInlineText(
          sheetDocument,
          `C${Math.min(
            startRow + 1,
            endRow
          )}`,
          formatBracketName(
            source.assignee
          )
        );

        writeLinesToRows(
          sheetDocument,
          startRow,
          endRow,
          "D",
          source.tasks,
          86
        );

        writeLinesToRows(
          sheetDocument,
          startRow,
          endRow,
          "J",
          source.remarks,
          20
        );
      }
    );
  }


  function findNightStartRow(
    sheetDocument,
    sharedStrings,
    operationRange
  ) {
    for (
      let row =
        operationRange.startRow;
      row <=
        operationRange.endRow;
      row +=
        1
    ) {
      const cell =
        getCellElement(
          sheetDocument,
          `C${row}`
        );

      const text =
        normalizeLabel(
          getCellText(
            cell,
            sharedStrings
          )
        );

      if (
        text.includes(
          "Night근무조"
        )
      ) {
        return row;
      }
    }

    return (
      operationRange.startRow +
      Math.floor(
        (
          operationRange.endRow -
          operationRange.startRow +
          1
        ) /
        2
      )
    );
  }


  function writeOperationBlock(
    sheetDocument,
    startRow,
    endRow,
    rowKey,
    source
  ) {
    clearColumnRows(
      sheetDocument,
      "C",
      startRow,
      endRow
    );

    setCellInlineText(
      sheetDocument,
      `C${startRow}`,
      ROLE_LABELS[
        rowKey
      ]
    );

    const partRow =
      Math.min(
        startRow + 1,
        endRow
      );

    const memberRow =
      Math.min(
        startRow + 2,
        endRow
      );

    const partNumber =
      extractPartNumber(
        source.part
      );

    if (
      partNumber !== ""
    ) {
      setCellNumber(
        sheetDocument,
        `C${partRow}`,
        partNumber
      );
    }

    setCellInlineText(
      sheetDocument,
      `C${memberRow}`,
      formatBracketName(
        source.members,
        {
          plus:
            true
        }
      )
    );

    writeLinesToRows(
      sheetDocument,
      startRow,
      endRow,
      "D",
      source.tasks,
      86
    );

    writeLinesToRows(
      sheetDocument,
      startRow,
      endRow,
      "J",
      source.remarks,
      20
    );
  }


  function writeOperationRows(
    sheetDocument,
    sharedStrings,
    operationRange,
    rowsMap
  ) {
    const nightStartRow =
      findNightStartRow(
        sheetDocument,
        sharedStrings,
        operationRange
      );

    if (
      nightStartRow <=
        operationRange.startRow ||
      nightStartRow >
        operationRange.endRow
    ) {
      throw new Error(
        "Excel Day/Night 행 구조를 확인하지 못했습니다."
      );
    }

    writeOperationBlock(
      sheetDocument,
      operationRange.startRow,
      nightStartRow - 1,
      "operation-day",
      rowsMap.get(
        "operation-day"
      )
    );

    writeOperationBlock(
      sheetDocument,
      nightStartRow,
      operationRange.endRow,
      "operation-night",
      rowsMap.get(
        "operation-night"
      )
    );
  }


  function writeOtherNotes(
    sheetDocument,
    sharedStrings,
    record
  ) {
    const titleRow =
      findCellRowByText(
        sheetDocument,
        sharedStrings,
        text =>
          normalizeLabel(
            text
          ).startsWith(
            "3.기타사항"
          )
      );

    if (!titleRow) {
      return;
    }

    const rows =
      findMergedRows(
        sheetDocument,
        titleRow + 1,
        titleRow + 20,
        "B",
        "J"
      );

    rows.forEach(
      row =>
        clearCell(
          sheetDocument,
          `B${row}`
        )
    );

    const lines =
      splitMeaningfulLines(
        record.otherNotes
      );

    rows.forEach(
      (
        row,
        index
      ) => {
        if (
          index >=
            lines.length
        ) {
          return;
        }

        const isLastSlot =
          index ===
            rows.length -
            1;

        const value =
          isLastSlot &&
          lines.length >
            rows.length
            ? lines
                .slice(
                  index
                )
                .join(
                  "\n"
                )
            : lines[
                index
              ];

        setCellInlineText(
          sheetDocument,
          `B${row}`,
          value
        );

        setRowHeight(
          sheetDocument,
          row,
          estimateRowHeight(
            value,
            115
          )
        );
      }
    );
  }


  function writeGenerationReportCheck(
    sheetDocument,
    sharedStrings,
    record
  ) {
    const labelRow =
      findCellRowByText(
        sheetDocument,
        sharedStrings,
        text =>
          normalizeLabel(
            text
          ).includes(
            "일일발전운전현황작성"
          )
      );

    if (!labelRow) {
      return;
    }

    setCellInlineText(
      sheetDocument,
      `I${labelRow}`,
      record.generationReportCompleted ===
        true
        ? "✓"
        : ""
    );
  }


  function patchDailyWorkSheet(
    sheetDocument,
    sharedStrings,
    record
  ) {
    const section1TitleRow =
      findCellRowByText(
        sheetDocument,
        sharedStrings,
        text =>
          normalizeLabel(
            text
          ).startsWith(
            "1.주요전달및지시사항"
          )
      );

    const section2TitleRow =
      findCellRowByText(
        sheetDocument,
        sharedStrings,
        text =>
          normalizeLabel(
            text
          ).startsWith(
            "2.주요업무현황"
          )
      );

    if (
      !section1TitleRow ||
      !section2TitleRow
    ) {
      throw new Error(
        `${record.workDate} Excel 양식의 주요 섹션을 찾지 못했습니다.`
      );
    }

    const instructionRows =
      findMergedRows(
        sheetDocument,
        section1TitleRow + 1,
        section2TitleRow - 1,
        "B",
        "J"
      );

    writeInstructionBlock(
      sheetDocument,
      instructionRows,
      record
    );

    const efficiencyRange =
      findVerticalGroupRange(
        sheetDocument,
        sharedStrings,
        "효율파트"
      );

    const operationRange =
      findVerticalGroupRange(
        sheetDocument,
        sharedStrings,
        "운전파트"
      );

    if (
      !efficiencyRange ||
      !operationRange
    ) {
      throw new Error(
        `${record.workDate} Excel 양식의 효율/운전파트 영역을 찾지 못했습니다.`
      );
    }

    const rowsMap =
      getFixedRowsMap(
        record
      );

    writeEfficiencyRows(
      sheetDocument,
      efficiencyRange,
      rowsMap
    );

    writeOperationRows(
      sheetDocument,
      sharedStrings,
      operationRange,
      rowsMap
    );

    writeGenerationReportCheck(
      sheetDocument,
      sharedStrings,
      record
    );

    writeOtherNotes(
      sheetDocument,
      sharedStrings,
      record
    );
  }


  function getRelationshipId(
    sheetElement
  ) {
    return (
      sheetElement.getAttributeNS(
        REL_NS,
        "id"
      ) ||
      [
        ...sheetElement.attributes
      ].find(
        attribute =>
          attribute.localName ===
            "id"
      )?.value ||
      ""
    );
  }


  function normalizeZipTarget(
    target
  ) {
    const value =
      String(
        target ||
        ""
      ).replace(
        /^\/+/,
        ""
      );

    if (
      value.startsWith(
        "xl/"
      )
    ) {
      return value;
    }

    return `xl/${value}`;
  }


  function findSheetZipPath(
    workbookDocument,
    workbookRelationshipsDocument,
    sheetName
  ) {
    const sheetElement =
      getElementsByLocalName(
        workbookDocument,
        "sheet"
      ).find(
        element =>
          element.getAttribute(
            "name"
          ) ===
          sheetName
      );

    if (!sheetElement) {
      return "";
    }

    const relationshipId =
      getRelationshipId(
        sheetElement
      );

    if (!relationshipId) {
      return "";
    }

    const relationship =
      getElementsByLocalName(
        workbookRelationshipsDocument,
        "Relationship"
      ).find(
        element =>
          element.getAttribute(
            "Id"
          ) ===
          relationshipId
      );

    return relationship
      ? normalizeZipTarget(
          relationship.getAttribute(
            "Target"
          )
        )
      : "";
  }


  function getNormalizedRecord(
    source
  ) {
    if (
      typeof normalizeEfficiencyDailyWorkRecord ===
        "function"
    ) {
      return normalizeEfficiencyDailyWorkRecord(
        source
      );
    }

    return source ||
      {};
  }


  function collectCurrentRecord() {
    if (
      typeof collectEfficiencyDailyWorkEditorData !==
        "function"
    ) {
      throw new Error(
        "일일업무현황 입력값을 읽을 수 없습니다."
      );
    }

    return getNormalizedRecord(
      collectEfficiencyDailyWorkEditorData()
    );
  }


  function getMonthRecords(
    currentRecord
  ) {
    const workDate =
      normalizeText(
        currentRecord?.workDate
      );

    const monthKey =
      workDate.slice(
        0,
        7
      );

    const recordMap =
      new Map();

    try {
      if (
        typeof efficiencyDailyWorkState !==
          "undefined" &&
        Array.isArray(
          efficiencyDailyWorkState?.items
        )
      ) {
        efficiencyDailyWorkState.items
          .map(
            item =>
              getNormalizedRecord(
                item
              )
          )
          .filter(
            item =>
              normalizeText(
                item?.workDate
              ).startsWith(
                `${monthKey}-`
              )
          )
          .forEach(
            item =>
              recordMap.set(
                item.workDate,
                item
              )
          );
      }
    } catch (error) {
      console.warn(
        "[DAILY WORK EXCEL] archive records unavailable",
        error
      );
    }

    if (workDate) {
      recordMap.set(
        workDate,
        currentRecord
      );
    }

    return [
      ...recordMap.values()
    ].sort(
      (
        a,
        b
      ) =>
        String(
          a.workDate
        ).localeCompare(
          String(
            b.workDate
          )
        )
    );
  }


  function createDownloadFileName(
    workDate
  ) {
    const match =
      String(
        workDate ||
        ""
      ).match(
        /^(\d{4})-(\d{2})-/
      );

    if (!match) {
      return "설비운영팀_일일업무현황.xlsx";
    }

    return `(${match[1]}.${match[2]}월)설비운영팀 일일업무현황.xlsx`;
  }


  /* =========================================================
    EFFICIENCY_DAILY_WORK_EXCEL_DOWNLOAD_HANG_FIX_V2

    - 저장 / template / unzip / zip 단계에 상한시간 적용
    - 버튼에 현재 처리 단계를 표시
    - 실패/시간초과 시 finally에서 버튼을 반드시 복구
  ========================================================= */

  function withDailyWorkExcelTimeout(
    promise,
    timeoutMs,
    timeoutMessage
  ) {
    let timeoutId =
      null;

    return Promise.race([
      Promise.resolve(
        promise
      ),

      new Promise(
        (
          _,
          reject
        ) => {
          timeoutId =
            window.setTimeout(
              () => {
                reject(
                  new Error(
                    timeoutMessage
                  )
                );
              },
              timeoutMs
            );
        }
      )
    ]).finally(
      () => {
        if (
          timeoutId !==
            null
        ) {
          window.clearTimeout(
            timeoutId
          );
        }
      }
    );
  }


  function setExcelButtonStage(
    button,
    label
  ) {
    if (!button) {
      return;
    }

    button.textContent =
      String(
        label ||
        ""
      );
  }
  /* =========================================================
    EFFICIENCY_DAILY_WORK_EXCEL_WORKBOOK_COMPAT_V3

    Excel desktop compatibility guard:
    - make the requested date sheet visible
    - focus the requested date sheet when the workbook opens
    - keep sheet tabs / scrollbars visible
    - generate XLSX as Uint8Array, then validate the ZIP again
      before starting the browser download
  ========================================================= */

  function prepareWorkbookCompatibilityV3(
    zip,
    workbookDocument,
    workDate
  ) {
    const sheets =
      getElementsByLocalName(
        workbookDocument,
        "sheet"
      );

    if (sheets.length === 0) {
      throw new Error(
        "Excel workbook에 Sheet 정보가 없습니다."
      );
    }

    const sheetName =
      String(
        workDate ||
        ""
      ).slice(
        8,
        10
      );

    const activeSheetIndex =
      sheets.findIndex(
        sheet =>
          sheet.getAttribute(
            "name"
          ) === sheetName
      );

    if (activeSheetIndex < 0) {
      throw new Error(
        `${workDate}에 해당하는 Excel Sheet(${sheetName})를 찾지 못했습니다.`
      );
    }

    const activeSheet =
      sheets[
        activeSheetIndex
      ];

    activeSheet.removeAttribute(
      "state"
    );

    const workbookView =
      getElementsByLocalName(
        workbookDocument,
        "workbookView"
      )[0];

    if (workbookView) {
      workbookView.removeAttribute(
        "visibility"
      );

      workbookView.setAttribute(
        "showSheetTabs",
        "1"
      );

      workbookView.setAttribute(
        "showHorizontalScroll",
        "1"
      );

      workbookView.setAttribute(
        "showVerticalScroll",
        "1"
      );

      workbookView.setAttribute(
        "activeTab",
        String(
          activeSheetIndex
        )
      );

      workbookView.setAttribute(
        "firstSheet",
        String(
          Math.max(
            0,
            activeSheetIndex - 2
          )
        )
      );
    }

    zip.file(
      "xl/workbook.xml",
      serializeXml(
        workbookDocument
      )
    );
  }


  async function validateGeneratedWorkbookV3(
    generatedBytes,
    workDate
  ) {
    if (
      !(generatedBytes instanceof Uint8Array) ||
      generatedBytes.length < 4 ||
      generatedBytes[0] !== 0x50 ||
      generatedBytes[1] !== 0x4b
    ) {
      throw new Error(
        "생성된 Excel 파일이 정상적인 XLSX(ZIP) 형식이 아닙니다."
      );
    }

    const verifyZip =
      await withDailyWorkExcelTimeout(
        globalThis.JSZip.loadAsync(
          generatedBytes
        ),
        15000,
        "생성된 Excel 파일을 재검증하는 시간이 너무 오래 걸립니다. 다시 시도해주세요."
      );

    const workbookFile =
      verifyZip.file(
        "xl/workbook.xml"
      );

    const workbookRelationshipsFile =
      verifyZip.file(
        "xl/_rels/workbook.xml.rels"
      );

    if (
      !workbookFile ||
      !workbookRelationshipsFile
    ) {
      throw new Error(
        "생성된 Excel 파일의 workbook 연결정보가 누락되었습니다."
      );
    }

    const workbookDocument =
      parseXml(
        await workbookFile.async(
          "string"
        )
      );

    const workbookRelationshipsDocument =
      parseXml(
        await workbookRelationshipsFile.async(
          "string"
        )
      );

    const sheets =
      getElementsByLocalName(
        workbookDocument,
        "sheet"
      );

    const dailySheetNames =
      new Set(
        sheets
          .map(
            sheet =>
              sheet.getAttribute(
                "name"
              ) ||
              ""
          )
          .filter(
            name =>
              /^\d{2}$/.test(
                name
              )
          )
      );

    if (dailySheetNames.size !== 31) {
      throw new Error(
        `생성된 Excel의 날짜 Sheet가 31개가 아닙니다. (${dailySheetNames.size}개)`
      );
    }

    const sheetName =
      String(
        workDate ||
        ""
      ).slice(
        8,
        10
      );

    const targetSheet =
      sheets.find(
        sheet =>
          sheet.getAttribute(
            "name"
          ) === sheetName
      );

    if (!targetSheet) {
      throw new Error(
        `생성된 Excel에서 대상 Sheet(${sheetName})를 찾지 못했습니다.`
      );
    }

    if (
      String(
        targetSheet.getAttribute(
          "state"
        ) ||
        ""
      ).toLowerCase() === "hidden" ||
      String(
        targetSheet.getAttribute(
          "state"
        ) ||
        ""
      ).toLowerCase() === "veryhidden"
    ) {
      throw new Error(
        `생성된 Excel의 대상 Sheet(${sheetName})가 숨김 상태입니다.`
      );
    }

    const targetSheetPath =
      findSheetZipPath(
        workbookDocument,
        workbookRelationshipsDocument,
        sheetName
      );

    if (
      !targetSheetPath ||
      !verifyZip.file(
        targetSheetPath
      )
    ) {
      throw new Error(
        `생성된 Excel의 대상 Sheet(${sheetName}) 연결이 손상되었습니다.`
      );
    }

    parseXml(
      await verifyZip
        .file(
          targetSheetPath
        )
        .async(
          "string"
        )
    );

    return true;
  }


  async function downloadExcelWorkbook(
    currentRecord
  ) {
    if (
      !globalThis.JSZip
    ) {
      throw new Error(
        "Excel 생성 모듈(JSZip)을 불러오지 못했습니다. 새로고침 후 다시 시도해주세요."
      );
    }

    const workDate =
      normalizeText(
        currentRecord?.workDate
      );

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(
        workDate
      )
    ) {
      throw new Error(
        "작성일을 확인해주세요."
      );
    }

    const monthKey =
      workDate.slice(
        0,
        7
      );

    const templateUrl =
      new URL(
        `${TEMPLATE_ROOT}/${monthKey}.xlsx`,
        document.baseURI
      );

    const response =
      await withDailyWorkExcelTimeout(
        fetch(
          templateUrl.href,
          {
            cache:
              "no-store"
          }
        ),
        15000,
        "Excel 양식을 불러오는 시간이 너무 오래 걸립니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요."
      );

    if (!response.ok) {
      if (
        response.status ===
          404
      ) {
        throw new Error(
          `${monthKey}월 일일업무현황 Excel 양식이 등록되지 않았습니다.`
        );
      }

      throw new Error(
        `Excel 양식을 불러오지 못했습니다. (${response.status})`
      );
    }

    const templateBuffer =
      await response.arrayBuffer();

    const zip =
      await withDailyWorkExcelTimeout(
        globalThis.JSZip.loadAsync(
          templateBuffer
        ),
        15000,
        "Excel 양식을 여는 시간이 너무 오래 걸립니다. 다시 시도해주세요."
      );

    const workbookFile =
      zip.file(
        "xl/workbook.xml"
      );

    const workbookRelationshipsFile =
      zip.file(
        "xl/_rels/workbook.xml.rels"
      );

    if (
      !workbookFile ||
      !workbookRelationshipsFile
    ) {
      throw new Error(
        "Excel 양식의 workbook 정보를 찾지 못했습니다."
      );
    }

    const workbookDocument =
      parseXml(
        await workbookFile.async(
          "string"
        )
      );

    const workbookRelationshipsDocument =
      parseXml(
        await workbookRelationshipsFile.async(
          "string"
        )
      );

    const sharedStringsFile =
      zip.file(
        "xl/sharedStrings.xml"
      );

    const sharedStringsDocument =
      sharedStringsFile
        ? parseXml(
            await sharedStringsFile.async(
              "string"
            )
          )
        : null;

    const sharedStrings =
      getSharedStrings(
        sharedStringsDocument
      );

    const records =
      getMonthRecords(
        currentRecord
      );

    let patchedCount =
      0;

    for (
      const record
      of records
    ) {
      const recordDate =
        normalizeText(
          record?.workDate
        );

      if (
        !recordDate.startsWith(
          `${monthKey}-`
        )
      ) {
        continue;
      }

      const sheetName =
        recordDate.slice(
          8,
          10
        );

      const sheetZipPath =
        findSheetZipPath(
          workbookDocument,
          workbookRelationshipsDocument,
          sheetName
        );

      if (!sheetZipPath) {
        throw new Error(
          `${recordDate}에 해당하는 Excel Sheet(${sheetName})를 찾지 못했습니다.`
        );
      }

      const sheetFile =
        zip.file(
          sheetZipPath
        );

      if (!sheetFile) {
        throw new Error(
          `${recordDate} Excel Sheet 파일을 찾지 못했습니다.`
        );
      }

      const sheetDocument =
        parseXml(
          await sheetFile.async(
            "string"
          )
        );

      patchDailyWorkSheet(
        sheetDocument,
        sharedStrings,
        record
      );

      zip.file(
        sheetZipPath,
        serializeXml(
          sheetDocument
        )
      );

      patchedCount +=
        1;
    }

    if (
      patchedCount ===
        0
    ) {
      throw new Error(
        "Excel에 반영할 저장 기록을 찾지 못했습니다."
      );
    }

    prepareWorkbookCompatibilityV3(
      zip,
      workbookDocument,
      workDate
    );

    const generatedBytes =
      await withDailyWorkExcelTimeout(
        zip.generateAsync({
          type:
            "uint8array",

          compression:
            "DEFLATE",

          compressionOptions: {
            level:
              6
          }
        }),
        30000,
        "Excel 파일 생성 시간이 너무 오래 걸립니다. 다시 시도해주세요."
      );

    await validateGeneratedWorkbookV3(
      generatedBytes,
      workDate
    );

    const blob =
      new Blob(
        [
          generatedBytes
        ],
        {
          type:
            MIME_XLSX
        }
      );

    const objectUrl =
      URL.createObjectURL(
        blob
      );

    const anchor =
      document.createElement(
        "a"
      );

    anchor.href =
      objectUrl;

    anchor.download =
      createDownloadFileName(
        workDate
      );

    anchor.style.display =
      "none";

    document.body.appendChild(
      anchor
    );

    anchor.click();
    anchor.remove();

    window.setTimeout(
      () =>
        URL.revokeObjectURL(
          objectUrl
        ),
      60000
    );

    return patchedCount;
  }


  function setButtonBusy(
    button,
    nextBusy
  ) {
    if (!button) {
      return;
    }

    if (
      nextBusy ===
        true
    ) {
      if (
        !button.dataset
          .dailyWorkExcelOriginalLabel
      ) {
        button.dataset
          .dailyWorkExcelOriginalLabel =
          button.textContent ||
          "저장 + 엑셀";
      }

      button.disabled =
        true;

      button.textContent =
        "저장 확인 중...";

      return;
    }

    button.disabled =
      false;

    button.textContent =
      button.dataset
        .dailyWorkExcelOriginalLabel ||
      "저장 + 엑셀";
  }


  /* =========================================================
    EFFICIENCY_DAILY_WORK_EXCEL_SERVER_VERIFY_V4

    Save + Excel safety gate:
    - capture the exact content that the core save request intends to write
    - run the normal save flow
    - GET the server records again without mutating the editor
    - compare intended content with the fresh server record
    - only generate Excel when the values match exactly
  ========================================================= */

  function cloneDailyWorkExcelVerificationValueV4(
    value
  ) {
    return JSON.parse(
      JSON.stringify(
        value ?? null
      )
    );
  }


  function canonicalizeDailyWorkExcelVerificationValueV4(
    value
  ) {
    if (
      Array.isArray(
        value
      )
    ) {
      return value.map(
        item =>
          canonicalizeDailyWorkExcelVerificationValueV4(
            item
          )
      );
    }

    if (
      value &&
      typeof value ===
        "object"
    ) {
      const result =
        {};

      Object.keys(
        value
      )
        .sort()
        .forEach(
          key => {
            const nextValue =
              value[
                key
              ];

            if (
              typeof nextValue ===
                "undefined"
            ) {
              return;
            }

            result[
              key
            ] =
              canonicalizeDailyWorkExcelVerificationValueV4(
                nextValue
              );
          }
        );

      return result;
    }

    return value;
  }


  function createDailyWorkExcelVerificationSignatureV4(
    value
  ) {
    return JSON.stringify(
      canonicalizeDailyWorkExcelVerificationValueV4(
        value
      )
    );
  }


  async function captureDailyWorkExcelSaveIntentV4() {
    if (
      typeof ensureEfficiencyDailyWorkTeamLeaderSelectionsForSave ===
        "function"
    ) {
      const leaderCheck =
        await ensureEfficiencyDailyWorkTeamLeaderSelectionsForSave();

      if (
        !leaderCheck?.ok
      ) {
        const message =
          leaderCheck?.message ||
          "Day/Night 근무조 정보를 확인해주세요.";

        if (
          typeof showEfficiencyDailyWorkSaveError ===
            "function"
        ) {
          showEfficiencyDailyWorkSaveError(
            message
          );
        }

        if (
          typeof showToast ===
            "function"
        ) {
          showToast(
            message
          );
        }

        return null;
      }
    }

    if (
      typeof createEfficiencyDailyWorkWriteRequest !==
        "function"
    ) {
      throw new Error(
        "저장 전 검증용 요청정보를 만들 수 없습니다."
      );
    }

    const writeRequest =
      createEfficiencyDailyWorkWriteRequest();

    const workDate =
      normalizeText(
        writeRequest?.payload?.workDate
      );

    const content =
      writeRequest?.payload?.content;

    if (
      !workDate ||
      !content ||
      typeof content !==
        "object"
    ) {
      throw new Error(
        "저장 전 검증용 일지 내용을 구성하지 못했습니다."
      );
    }

    return {
      workDate,
      content:
        cloneDailyWorkExcelVerificationValueV4(
          content
        )
    };
  }


  async function fetchDailyWorkServerRecordForVerificationV4(
    workDate
  ) {
    if (
      typeof requestEfficiencyDailyWorkApi !==
        "function" ||
      typeof normalizeEfficiencyDailyWorkApiItems !==
        "function" ||
      typeof getEfficiencyDailyWorkApiHeaders !==
        "function" ||
      typeof EFFICIENCY_DAILY_WORK_API_URL ===
        "undefined"
    ) {
      throw new Error(
        "서버 저장 검증에 필요한 일일업무현황 API 기능을 찾지 못했습니다."
      );
    }

    const requestUrl =
      new URL(
        EFFICIENCY_DAILY_WORK_API_URL,
        window.location.origin
      );

    requestUrl.searchParams.set(
      "_excelSaveVerify",
      `${Date.now()}`
    );

    const result =
      await withDailyWorkExcelTimeout(
        requestEfficiencyDailyWorkApi(
          requestUrl.toString(),
          {
            method:
              "GET",

            headers:
              getEfficiencyDailyWorkApiHeaders()
          }
        ),
        20000,
        "서버 저장본 재확인이 20초 안에 끝나지 않았습니다. Excel 다운로드를 중단했습니다."
      );

    const records =
      normalizeEfficiencyDailyWorkApiItems(
        result
      );

    const targetRecord =
      (
        Array.isArray(
          records
        )
          ? records
          : []
      )
        .map(
          item =>
            getNormalizedRecord(
              item
            )
        )
        .find(
          item =>
            normalizeText(
              item?.workDate
            ) ===
            workDate
        ) ||
      null;

    if (
      !targetRecord?.id
    ) {
      throw new Error(
        `${workDate} 저장 기록을 서버 재조회에서 찾지 못했습니다. Excel 다운로드를 중단했습니다.`
      );
    }

    return targetRecord;
  }


  function getDailyWorkServerContentForVerificationV4(
    serverRecord
  ) {
    if (
      typeof buildEfficiencyDailyWorkSavePayload !==
        "function"
    ) {
      throw new Error(
        "서버 저장본 검증용 payload 변환 기능을 찾지 못했습니다."
      );
    }

    const payload =
      buildEfficiencyDailyWorkSavePayload(
        serverRecord
      );

    if (
      !payload?.content ||
      typeof payload.content !==
        "object"
    ) {
      throw new Error(
        "서버 저장본의 일지 내용을 읽지 못했습니다."
      );
    }

    return cloneDailyWorkExcelVerificationValueV4(
      payload.content
    );
  }


  function getDailyWorkExcelVerificationMismatchFieldsV4(
    expectedContent,
    actualContent
  ) {
    const keys =
      [
        ...new Set([
          ...Object.keys(
            expectedContent ||
            {}
          ),
          ...Object.keys(
            actualContent ||
            {}
          )
        ])
      ];

    const labels = {
      notice:
        "공지사항",
      tmMeeting:
        "TM 회의",
      teamInstruction:
        "설비운영팀 전달사항",
      generationReportCompleted:
        "일일발전 운전현황작성",
      rows:
        "주요 업무 현황",
      extraRows:
        "추가 업무행",
      otherNotes:
        "기타사항"
    };

    return keys
      .filter(
        key =>
          createDailyWorkExcelVerificationSignatureV4(
            expectedContent?.[
              key
            ]
          ) !==
          createDailyWorkExcelVerificationSignatureV4(
            actualContent?.[
              key
            ]
          )
      )
      .map(
        key =>
          labels[
            key
          ] ||
          key
      );
  }


  async function verifyDailyWorkServerSaveV4(
    saveIntent
  ) {
    const serverRecord =
      await fetchDailyWorkServerRecordForVerificationV4(
        saveIntent.workDate
      );

    const actualContent =
      getDailyWorkServerContentForVerificationV4(
        serverRecord
      );

    const expectedSignature =
      createDailyWorkExcelVerificationSignatureV4(
        saveIntent.content
      );

    const actualSignature =
      createDailyWorkExcelVerificationSignatureV4(
        actualContent
      );

    if (
      expectedSignature !==
        actualSignature
    ) {
      const mismatchFields =
        getDailyWorkExcelVerificationMismatchFieldsV4(
          saveIntent.content,
          actualContent
        );

      throw new Error(
        `서버 저장 검증 실패: 저장하려던 내용과 서버 저장본이 다릅니다${
          mismatchFields.length
            ? ` (${mismatchFields.join(", ")})`
            : ""
        }. Excel 다운로드를 중단했습니다.`
      );
    }

    return serverRecord;
  }


  async function handleExcelDownloadClick(
    event
  ) {
    event?.preventDefault?.();

    if (busy) {
      return;
    }

    const button =
      event?.target
        ?.closest?.(
          `#${BUTTON_ID}`
        ) ||
      (
        event?.currentTarget?.id ===
          BUTTON_ID
          ? event.currentTarget
          : null
      ) ||
      document.getElementById(
        BUTTON_ID
      );

    busy =
      true;

    setButtonBusy(
      button,
      true
    );

    try {
      if (
        typeof handleEfficiencyDailyWorkSubmit !==
          "function"
      ) {
        throw new Error(
          "일일업무현황 저장 기능을 찾지 못했습니다."
        );
      }

      const saveIntent =
        await captureDailyWorkExcelSaveIntentV4();

      if (!saveIntent) {
        return;
      }

      const saveResult =
        await withDailyWorkExcelTimeout(
          handleEfficiencyDailyWorkSubmit(),
          45000,
          "저장 처리가 45초 안에 끝나지 않았습니다. 확인창이 보이지 않거나 네트워크 응답이 지연되고 있습니다."
        );

      if (!saveResult) {
        return;
      }

      setExcelButtonStage(
        button,
        "서버 저장 검증 중..."
      );

      const verifiedServerRecord =
        await verifyDailyWorkServerSaveV4(
          saveIntent
        );

      setExcelButtonStage(
        button,
        "Excel 생성 중..."
      );

      const patchedCount =
        await downloadExcelWorkbook(
          verifiedServerRecord
        );

      const message =
        patchedCount > 1
          ? `저장 후 ${patchedCount}일치 기록을 기존 Excel 양식에 반영해 다운로드했습니다.`
          : "저장 후 기존 Excel 양식으로 다운로드했습니다.";

      if (
        typeof showToast ===
          "function"
      ) {
        showToast(
          message
        );
      }

      if (
        typeof showEfficiencyDailyWorkSaveMessage ===
          "function"
      ) {
        showEfficiencyDailyWorkSaveMessage(
          message
        );
      }

    } catch (error) {
      console.error(
        "일일업무현황 Excel 다운로드 실패:",
        error
      );

      const message =
        error?.message ||
        "Excel 파일을 만들지 못했습니다.";

      if (
        typeof showEfficiencyDailyWorkSaveError ===
          "function"
      ) {
        showEfficiencyDailyWorkSaveError(
          message
        );
      } else {
        window.alert(
          message
        );
      }

    } finally {
      busy =
        false;

      setButtonBusy(
        button,
        false
      );
    }
  }


  function findSaveButton() {
    try {
      if (
        typeof getEfficiencyDailyWorkElements ===
          "function"
      ) {
        const elements =
          getEfficiencyDailyWorkElements();

        if (
          elements?.saveButton
        ) {
          return elements.saveButton;
        }
      }
    } catch (error) {
      console.warn(
        "[DAILY WORK EXCEL] get elements failed",
        error
      );
    }

    return (
      document.querySelector(
        "#efficiencyDailyWorkForm button[type='submit']"
      ) ||
      document.querySelector(
        ".efficiency-daily-work-form-actions button[type='submit']"
      )
    );
  }


  /* =========================================================
    EFFICIENCY_DAILY_WORK_EXCEL_CLICK_BIND_V5

    The Daily Work view can replace button DOM nodes after the
    Excel runtime has initially attached its click listener.

    V5 keeps both protections:
    - rebind an existing Save + Excel button directly
    - delegated capture listener survives later DOM replacement
  ========================================================= */

  function bindDailyWorkExcelButtonV5(
    button
  ) {
    if (!button) {
      return false;
    }

    button.type =
      "button";

    button.dataset
      .dailyWorkExcelDownload =
      BUTTON_MARKER;

    button.removeEventListener(
      "click",
      handleExcelDownloadClick
    );

    button.addEventListener(
      "click",
      handleExcelDownloadClick
    );

    return true;
  }


  function handleDailyWorkExcelDelegatedClickV5(
    event
  ) {
    const button =
      event?.target
        ?.closest?.(
          `#${BUTTON_ID}`
        );

    if (
      !button ||
      button.dataset
        .dailyWorkExcelDownload !==
        BUTTON_MARKER
    ) {
      return;
    }

    handleExcelDownloadClick(
      event
    );
  }


  function installDailyWorkExcelDelegatedClickV5() {
    if (
      window.__efficiencyDailyWorkExcelDelegatedClickV5
    ) {
      return;
    }

    window.__efficiencyDailyWorkExcelDelegatedClickV5 =
      true;

    document.addEventListener(
      "click",
      handleDailyWorkExcelDelegatedClickV5,
      true
    );
  }


  function installButton() {
    const existingButton =
      document.getElementById(
        BUTTON_ID
      );

    if (
      existingButton
    ) {
      bindDailyWorkExcelButtonV5(
        existingButton
      );

      return true;
    }

    const saveButton =
      findSaveButton();

    if (!saveButton) {
      return false;
    }

    const button =
      document.createElement(
        "button"
      );

    button.type =
      "button";

    button.id =
      BUTTON_ID;

    button.dataset
      .dailyWorkExcelDownload =
      BUTTON_MARKER;

    button.textContent =
      "저장 + 엑셀";

    button.className =
      saveButton.className;

    button.title =
      "현재 일일업무현황을 저장한 뒤 기존 Excel 양식으로 다운로드합니다.";

    bindDailyWorkExcelButtonV5(
      button
    );

    saveButton.insertAdjacentElement(
      "beforebegin",
      button
    );

    return true;
  }


  function initialize() {
    installDailyWorkExcelDelegatedClickV5();

    if (
      installButton()
    ) {
      return;
    }

    [
      100,
      400,
      1000,
      2500
    ].forEach(
      delay =>
        window.setTimeout(
          installButton,
          delay
        )
    );
  }


  if (
    document.readyState ===
      "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initialize,
      {
        once:
          true
      }
    );
  } else {
    initialize();
  }
})();
