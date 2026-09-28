(() => {
  "use strict";

  const VERSION = "20260929-v10";
  const BIO_TITLE_PATTERN = /Bio\s*\/\s*유기성\s*고형연료\s*혼소율/i;
  const POWER_TITLE_PATTERN = /전일\s*전력\s*단가/i;

  function colNumber(name) {
    let value = 0;
    for (const ch of String(name || "").toUpperCase()) {
      if (ch < "A" || ch > "Z") continue;
      value = value * 26 + ch.charCodeAt(0) - 64;
    }
    return value;
  }

  function colName(number) {
    let n = Number(number);
    let result = "";
    while (Number.isFinite(n) && n > 0) {
      const rest = (n - 1) % 26;
      result = String.fromCharCode(65 + rest) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  }

  function parseAddress(address) {
    const match = String(address || "").trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
    return match ? { column: match[1], columnNumber: colNumber(match[1]), row: Number(match[2]) } : null;
  }

  function direct(parent, name) {
    return Array.from(parent?.children || []).filter((item) => item?.tagName === name);
  }

  function spreadsheetNamespace(document) {
    return document?.documentElement?.namespaceURI ||
      "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  }

  function elements(document, name) {
    const ns = spreadsheetNamespace(document);
    if (typeof document?.getElementsByTagNameNS === "function") {
      const values = Array.from(document.getElementsByTagNameNS(ns, name) || []);
      if (values.length) return values;
    }
    return typeof document?.getElementsByTagName === "function"
      ? Array.from(document.getElementsByTagName(name) || [])
      : [];
  }

  function cellText(cell, sharedStrings = []) {
    if (!cell) return "";
    if (typeof cell.value === "string" && cell.value) return cell.value.trim();

    const type = String(cell.getAttribute?.("t") || "");
    const inline = direct(cell, "is")[0];
    if (inline) {
      const text = direct(inline, "t").map((node) => node.textContent || "").join("");
      if (text) return String(text).trim();
      if (inline.textContent) return String(inline.textContent).trim();
    }

    const value = direct(cell, "v")[0]?.textContent ?? "";
    if (type === "s" && value !== "") {
      const index = Number(value);
      const shared = sharedStrings?.[index];
      if (typeof shared === "string") return shared.trim();
      if (shared && typeof shared.textContent === "string") return shared.textContent.trim();
      if (shared?.text !== undefined) return String(shared.text).trim();
    }

    return String(value || cell.textContent || "").trim();
  }

  function setCellText(document, cell, text) {
    if (!cell) return false;
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    if (Array.isArray(cell.children)) {
      while (cell.children.length) cell.removeChild(cell.children[0]);
    }
    const value = String(text ?? "");
    if ("value" in cell) cell.value = value;
    if (!value) {
      cell.removeAttribute?.("t");
      return true;
    }
    cell.setAttribute?.("t", "inlineStr");
    const ns = spreadsheetNamespace(document);
    const isElement = document.createElementNS(ns, "is");
    const textElement = document.createElementNS(ns, "t");
    textElement.textContent = value;
    isElement.appendChild(textElement);
    cell.appendChild(isElement);
    return true;
  }

  function rows(document) {
    return elements(document, "row").sort((a, b) => Number(a.getAttribute?.("r") || 0) - Number(b.getAttribute?.("r") || 0));
  }

  function cells(document) {
    return elements(document, "c");
  }

  function findRow(document, rowNumber) {
    return rows(document).find((row) => Number(row.getAttribute?.("r") || 0) === Number(rowNumber)) || null;
  }

  function ensureRow(document, rowNumber) {
    const found = findRow(document, rowNumber);
    if (found) return found;
    const sheetData = elements(document, "sheetData")[0];
    if (!sheetData) throw new Error("최종 Excel sheetData를 찾지 못했습니다.");
    const ns = spreadsheetNamespace(document);
    const row = document.createElementNS(ns, "row");
    row.setAttribute("r", String(rowNumber));
    const next = direct(sheetData, "row").find((item) => Number(item.getAttribute?.("r") || 0) > rowNumber) || null;
    sheetData.insertBefore(row, next);
    return row;
  }

  function findCell(document, address) {
    const normalized = String(address || "").trim().toUpperCase();
    return cells(document).find((cell) => String(cell.getAttribute?.("r") || "").trim().toUpperCase() === normalized) || null;
  }

  function ensureCell(document, rowNumber, columnNumber, styleSource = null) {
    const address = `${colName(columnNumber)}${rowNumber}`;
    const found = findCell(document, address);
    if (found) return found;
    const ns = spreadsheetNamespace(document);
    const row = ensureRow(document, rowNumber);
    const cell = document.createElementNS(ns, "c");
    cell.setAttribute("r", address);
    const style = styleSource?.getAttribute?.("s");
    if (style !== null && style !== undefined && style !== "") cell.setAttribute("s", style);
    const next = direct(row, "c").find((item) => {
      const parsed = parseAddress(item.getAttribute?.("r"));
      return parsed && parsed.columnNumber > columnNumber;
    }) || null;
    row.insertBefore(cell, next);
    return cell;
  }

  function parseMerge(ref) {
    const match = String(ref || "").trim().toUpperCase().match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    return match ? {
      startColumn: match[1], startColumnNumber: colNumber(match[1]), startRow: Number(match[2]),
      endColumn: match[3], endColumnNumber: colNumber(match[3]), endRow: Number(match[4])
    } : null;
  }

  function formatMerge(range) {
    return `${range.startColumn}${range.startRow}:${range.endColumn}${range.endRow}`;
  }

  function mergeElements(document) {
    const holder = elements(document, "mergeCells")[0];
    return holder ? direct(holder, "mergeCell") : [];
  }

  function mergeContaining(document, columnNumber, rowNumber) {
    return mergeElements(document).find((merge) => {
      const range = parseMerge(merge.getAttribute?.("ref"));
      return range && rowNumber >= range.startRow && rowNumber <= range.endRow &&
        columnNumber >= range.startColumnNumber && columnNumber <= range.endColumnNumber;
    }) || null;
  }

  function setMergeCount(document) {
    const holder = elements(document, "mergeCells")[0];
    if (holder) holder.setAttribute("count", String(direct(holder, "mergeCell").length));
  }

  function shiftRowsAndMergesDown(document, boundaryRow) {
    const rowItems = rows(document).filter((row) => Number(row.getAttribute?.("r") || 0) >= boundaryRow).sort((a, b) => Number(b.getAttribute("r")) - Number(a.getAttribute("r")));
    for (const row of rowItems) {
      const oldRow = Number(row.getAttribute("r"));
      const newRow = oldRow + 1;
      row.setAttribute("r", String(newRow));
      for (const cell of direct(row, "c")) {
        const parsed = parseAddress(cell.getAttribute?.("r"));
        if (parsed) cell.setAttribute("r", `${parsed.column}${newRow}`);
      }
    }

    for (const merge of mergeElements(document)) {
      const range = parseMerge(merge.getAttribute?.("ref"));
      if (!range) continue;
      if (range.startRow >= boundaryRow) {
        range.startRow += 1;
        range.endRow += 1;
      } else if (range.endRow >= boundaryRow) {
        range.endRow += 1;
      }
      merge.setAttribute("ref", formatMerge(range));
    }

    const dimension = elements(document, "dimension")[0];
    if (dimension) {
      const ref = String(dimension.getAttribute?.("ref") || "");
      dimension.setAttribute("ref", ref.replace(/([A-Z]+)(\d+)$/i, (match, column, rowText) => {
        const row = Number(rowText);
        return row >= boundaryRow ? `${column}${row + 1}` : match;
      }));
    }

    const rowBreaks = elements(document, "rowBreaks")[0];
    if (rowBreaks) {
      for (const item of direct(rowBreaks, "brk")) {
        const id = Number(item.getAttribute?.("id") || 0);
        if (id >= boundaryRow) item.setAttribute("id", String(id + 1));
      }
    }
  }

  function movePowerAreaUp(document, startColumn, endColumn, firstSourceRow, lastSourceRow) {
    const movingCells = cells(document).filter((cell) => {
      const parsed = parseAddress(cell.getAttribute?.("r"));
      return parsed && parsed.row >= firstSourceRow && parsed.row <= lastSourceRow &&
        parsed.columnNumber >= startColumn && parsed.columnNumber <= endColumn;
    });

    for (const cell of movingCells) cell.remove?.();
    for (const cell of movingCells) {
      const parsed = parseAddress(cell.getAttribute?.("r"));
      const newRow = parsed.row - 1;
      cell.setAttribute("r", `${parsed.column}${newRow}`);
      const row = ensureRow(document, newRow);
      const next = direct(row, "c").find((item) => {
        const other = parseAddress(item.getAttribute?.("r"));
        return other && other.columnNumber > parsed.columnNumber;
      }) || null;
      row.insertBefore(cell, next);
    }

    for (const merge of mergeElements(document)) {
      const range = parseMerge(merge.getAttribute?.("ref"));
      if (!range) continue;
      const withinColumns = range.startColumnNumber >= startColumn && range.endColumnNumber <= endColumn;
      const withinRows = range.startRow >= firstSourceRow && range.endRow <= lastSourceRow;
      if (withinColumns && withinRows) {
        range.startRow -= 1;
        range.endRow -= 1;
        merge.setAttribute("ref", formatMerge(range));
      }
    }
  }

  function normalizePowerDateText(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})$/);
    if (!match) return null;
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { month, day, label: `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}` };
  }

  function fullDateFromMonthDay(referenceDateText, month, day) {
    const match = String(referenceDateText || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const referenceYear = Number(match[1]);
    const referenceMonth = Number(match[2]);
    let year = referenceYear;
    if (referenceMonth <= 2 && month >= 11) year -= 1;
    if (referenceMonth >= 11 && month <= 2) year += 1;
    const value = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : "";
  }

  function dateCellsInRange(document, rowNumber, startColumn, endColumn, sharedStrings, parser) {
    return cells(document)
      .map((cell) => ({ cell, parsed: parseAddress(cell.getAttribute?.("r")), text: cellText(cell, sharedStrings) }))
      .filter((item) => item.parsed && item.parsed.row === rowNumber &&
        item.parsed.columnNumber >= startColumn && item.parsed.columnNumber <= endColumn && parser(item.text))
      .sort((a, b) => a.parsed.columnNumber - b.parsed.columnNumber);
  }

  function finite(value) {
    if (value === null || value === undefined || String(value).trim() === "") return null;
    const number = Number(String(value).replaceAll(",", ""));
    return Number.isFinite(number) ? number : null;
  }

  function pair(first, second) {
    const a = finite(first), b = finite(second);
    return a === null || b === null ? "" : `${a.toFixed(2)} / ${b.toFixed(2)}`;
  }

  function average(first, second) {
    const a = finite(first), b = finite(second);
    return a === null || b === null ? null : (a + b) / 2;
  }

  async function applyHistoryAlignment(worksheetDocument, sharedStrings = []) {
    const titleCandidates = cells(worksheetDocument).map((cell) => {
      const parsed = parseAddress(cell.getAttribute?.("r"));
      const text = cellText(cell, sharedStrings);
      return { cell, parsed, text };
    }).filter((item) => item.parsed && item.text);

    const bioTitles = titleCandidates.filter((item) => BIO_TITLE_PATTERN.test(item.text));
    const powerTitles = titleCandidates.filter((item) => POWER_TITLE_PATTERN.test(item.text));
    let pairTitles = null;
    for (const bio of bioTitles) {
      const power = powerTitles.find((item) => item.parsed.row === bio.parsed.row && item.parsed.columnNumber > bio.parsed.columnNumber);
      if (power) {
        pairTitles = { bio, power };
        break;
      }
    }

    if (!pairTitles) {
      return { enabled: false, rowDelta: 0, reason: "side-by-side-history-table-not-found" };
    }

    const titleRow = pairTitles.bio.parsed.row;
    const bioMerge = mergeContaining(worksheetDocument, pairTitles.bio.parsed.columnNumber, titleRow);
    const powerMerge = mergeContaining(worksheetDocument, pairTitles.power.parsed.columnNumber, titleRow);
    if (!bioMerge || !powerMerge) {
      throw new Error("Bio/전력단가 제목 병합 범위를 찾지 못했습니다.");
    }

    const bioRangeBefore = parseMerge(bioMerge.getAttribute("ref"));
    const powerRange = parseMerge(powerMerge.getAttribute("ref"));
    if (!bioRangeBefore || !powerRange || bioRangeBefore.endColumnNumber >= powerRange.startColumnNumber) {
      throw new Error("Bio/전력단가 표 열 범위를 판별하지 못했습니다.");
    }

    const headerRow = titleRow + 1;
    const powerHeaderTexts = titleCandidates.filter((item) => item.parsed.row === headerRow &&
      item.parsed.columnNumber >= powerRange.startColumnNumber && item.parsed.columnNumber <= powerRange.endColumnNumber)
      .map((item) => item.text);
    if (!["Date", "최대", "최소", "평균"].every((needle) => powerHeaderTexts.some((text) => String(text).trim().toLowerCase() === needle.toLowerCase()))) {
      return { enabled: false, rowDelta: 0, reason: "power-header-contract-not-matched" };
    }

    const powerDateRowsBefore = [];
    for (let row = titleRow + 2; row <= titleRow + 10; row += 1) {
      const found = cells(worksheetDocument).map((cell) => ({
        cell,
        parsed: parseAddress(cell.getAttribute?.("r")),
        text: cellText(cell, sharedStrings)
      })).find((item) => item.parsed && item.parsed.row === row &&
        item.parsed.columnNumber >= powerRange.startColumnNumber && item.parsed.columnNumber <= powerRange.endColumnNumber &&
        normalizePowerDateText(item.text));
      if (!found) break;
      powerDateRowsBefore.push({ row, cell: found.cell, parsedDate: normalizePowerDateText(found.text) });
    }

    if (powerDateRowsBefore.length !== 5) {
      return { enabled: false, rowDelta: 0, reason: `power-history-row-count-${powerDateRowsBefore.length}` };
    }

    const bioDateCellsBefore = dateCellsInRange(
      worksheetDocument,
      headerRow,
      bioRangeBefore.startColumnNumber,
      bioRangeBefore.endColumnNumber,
      sharedStrings,
      (text) => /\d{1,2}\s*월\s*\d{1,2}\s*일/.test(String(text || ""))
    );
    if (bioDateCellsBefore.length !== 5) {
      return { enabled: false, rowDelta: 0, reason: `bio-history-column-count-${bioDateCellsBefore.length}` };
    }

    shiftRowsAndMergesDown(worksheetDocument, headerRow);

    // Power title stays on the original row; header + five data rows must remain at their old row positions.
    movePowerAreaUp(
      worksheetDocument,
      powerRange.startColumnNumber,
      powerRange.endColumnNumber,
      titleRow + 2,
      titleRow + 7
    );

    // The Bio title alone consumes two vertical rows.
    const bioRange = parseMerge(bioMerge.getAttribute("ref"));
    bioRange.startRow = titleRow;
    bioRange.endRow = titleRow + 1;
    bioMerge.setAttribute("ref", formatMerge(bioRange));
    setMergeCount(worksheetDocument);

    const alignedBioDateRow = titleRow + 2;
    const alignedBioDateCells = dateCellsInRange(
      worksheetDocument,
      alignedBioDateRow,
      bioRange.startColumnNumber,
      bioRange.endColumnNumber,
      sharedStrings,
      (text) => /\d{1,2}\s*월\s*\d{1,2}\s*일/.test(String(text || ""))
    );

    const alignedPowerDates = [];
    for (let row = titleRow + 2; row <= titleRow + 6; row += 1) {
      const found = cells(worksheetDocument).map((cell) => ({
        cell,
        parsed: parseAddress(cell.getAttribute?.("r")),
        text: cellText(cell, sharedStrings)
      })).find((item) => item.parsed && item.parsed.row === row &&
        item.parsed.columnNumber >= powerRange.startColumnNumber && item.parsed.columnNumber <= powerRange.endColumnNumber &&
        normalizePowerDateText(item.text));
      if (!found) throw new Error(`전력단가 날짜 ${row}행을 찾지 못했습니다.`);
      alignedPowerDates.push(normalizePowerDateText(found.text));
    }

    if (alignedBioDateCells.length !== 5) {
      throw new Error("Bio 혼소율 날짜 5개 셀을 찾지 못했습니다.");
    }

    alignedBioDateCells.forEach((item, index) => {
      const date = alignedPowerDates[index];
      setCellText(worksheetDocument, item.cell, `${String(date.month).padStart(2, "0")}월 ${String(date.day).padStart(2, "0")}일`);
    });

    const provider = window.morningMeetingClosedCofiring;
    const referenceDate = typeof provider?.targetDate === "function" ? String(provider.targetDate() || "") : "";
    const fullDates = alignedPowerDates.map((item) => fullDateFromMonthDay(referenceDate, item.month, item.day));
    const missingDateKeys = fullDates.filter((date) => !date);
    if (missingDateKeys.length > 0) {
      return {
        enabled: true,
        rowDelta: 1,
        layoutAligned: true,
        valuesAligned: false,
        reason: "reference-date-unavailable",
        bioDates: alignedPowerDates.map((item) => item.label)
      };
    }

    if (!provider || typeof provider.load !== "function") {
      return {
        enabled: true,
        rowDelta: 1,
        layoutAligned: true,
        valuesAligned: false,
        reason: "closed-cofiring-provider-unavailable",
        bioDates: alignedPowerDates.map((item) => item.label)
      };
    }

    const snapshots = await Promise.all(fullDates.map(async (date) => {
      try {
        return { date, item: await provider.load(date) };
      } catch (error) {
        return { date, item: null, error: error instanceof Error ? error.message : String(error) };
      }
    }));

    const bodyRows = [titleRow + 3, titleRow + 4, titleRow + 5, titleRow + 6];
    const bodyLabels = ["#1 BLR", "#2 BLR", "Average", "Total"];
    const dateColumns = alignedBioDateCells.map((item) => item.parsed.columnNumber);
    const missingDates = [];

    snapshots.forEach((entry, index) => {
      const column = dateColumns[index];
      const styleSource = alignedBioDateCells[index]?.cell || null;
      const unitOneBio = finite(entry.item?.unitOne?.bioRatio);
      const unitOneOrganic = finite(entry.item?.unitOne?.organicRatio);
      const unitTwoBio = finite(entry.item?.unitTwo?.bioRatio);
      const unitTwoOrganic = finite(entry.item?.unitTwo?.organicRatio);
      const avgBio = average(unitOneBio, unitTwoBio);
      const avgOrganic = average(unitOneOrganic, unitTwoOrganic);
      const avgTotal = average(entry.item?.unitOne?.totalRatio, entry.item?.unitTwo?.totalRatio);
      const values = entry.item ? [
        pair(unitOneBio, unitOneOrganic),
        pair(unitTwoBio, unitTwoOrganic),
        pair(avgBio, avgOrganic),
        avgTotal === null ? "" : avgTotal.toFixed(2)
      ] : ["", "", "", ""];
      if (!entry.item) missingDates.push(entry.date);
      bodyRows.forEach((row, bodyIndex) => {
        const cell = ensureCell(worksheetDocument, row, column, styleSource);
        setCellText(worksheetDocument, cell, values[bodyIndex]);
      });
    });

    return {
      enabled: true,
      rowDelta: 1,
      layoutAligned: true,
      valuesAligned: missingDates.length === 0,
      titleMerge: bioMerge.getAttribute("ref"),
      bioDates: fullDates,
      powerDates: fullDates,
      bodyRows: Object.fromEntries(bodyLabels.map((label, index) => [label, bodyRows[index]])),
      missingDates
    };
  }

  window.morningMeetingFinalHistoryAlignmentV10 = {
    version: VERSION,
    apply: applyHistoryAlignment
  };
  window.applyMorningMeetingFinalHistoryAlignmentV10 = applyHistoryAlignment;
})();
