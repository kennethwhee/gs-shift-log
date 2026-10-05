/* Date-matched, saved-only co-firing values for every holiday workbook layout. */
(function (root) {
  "use strict";
  const VERSION = "20261005-v1";
  const TITLE = /Bio\s*\/\s*유기성\s*고형연료\s*혼소율/i;
  const FIELDS = ["bioRatio", "organicRatio", "totalRatio"];
  const LABELS = ["#1 BLR", "#2 BLR", "Average", "Total"];
  const text = value => String(value ?? "").trim();
  const number = value => {
    if (typeof value === "number") return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
    const raw = text(value).replaceAll(",", "").replace(/%$/, "").trim();
    if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) return null;
    const result = Number(raw);
    return Number.isFinite(result) && result >= 0 && result <= 100 ? result : null;
  };
  const validDate = value => /^20\d{2}-\d{2}-\d{2}$/.test(value || "") &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  const addDays = (date, count) => new Date(Date.parse(date + "T00:00:00Z") + count * 86400000).toISOString().slice(0, 10);
  const blocked = date => root.isMorningMeetingSelectedDateResetActive?.(date) === true ||
    root.morningMeetingClosedCofiring?.isBlocked?.(date) === true ||
    root.morningMeetingQuerySources?.resetState?.(date)?.active === true;

  function normalized(item, date) {
    if (!item || item.targetDate !== date) return null;
    const result = {targetDate: date};
    for (const unit of ["unitOne", "unitTwo", "combined"]) {
      result[unit] = Object.fromEntries(FIELDS.map(key => [key, number(item[unit]?.[key])]));
    }
    return result;
  }

  function complete(item) {
    return ["unitOne", "unitTwo"].every(unit => FIELDS.every(key => number(item?.[unit]?.[key]) !== null));
  }

  function cached(date) {
    const provider = root.morningMeetingClosedCofiring;
    const state = provider?.state?.(date);
    // peek() intentionally rejects non-visible dates. state(date) is date-keyed.
    return normalized(state?.status === "complete" ? state.item : provider?.peek?.(date), date);
  }

  function capture(options = {}) {
    const items = {};
    if (validDate(options.startDate) && validDate(options.endDate)) {
      for (let date = options.startDate, count = 0; date <= options.endDate && count <= 24; date = addDays(date, 1), count++) {
        if (!blocked(date)) {
          const item = cached(date);
          if (item) items[date] = item;
        }
      }
    }
    const doc = root.document;
    const date = text(doc?.getElementById("efficiencyMorningMeetingCofiringDate")?.textContent).match(/20\d{2}-\d{2}-\d{2}/)?.[0];
    const selected = root.morningMeetingClosedCofiring?.targetDate?.();
    if (!validDate(date) || (selected && selected !== date) || blocked(date)) return {items};
    const item = items[date] || cached(date) || normalized({targetDate: date}, date);
    let changed = false, found = false;
    for (const [unit, index] of [["unitOne", 1], ["unitTwo", 2]]) {
      for (const key of FIELDS) {
        const element = doc.getElementById(`efficiencyMorningMeetingCofiringUnit${index}${key[0].toUpperCase()}${key.slice(1)}`);
        const value = number(element?.dataset?.rawValue ?? element?.textContent);
        if (value === null) continue;
        found = true;
        const previous = number(item[unit][key]);
        // Keep saved precision when the display is only its rounded form.
        if (previous === null || previous.toFixed(2) !== value.toFixed(2)) {
          item[unit][key] = value;
          changed = true;
        }
      }
    }
    if (changed) item.combined = Object.fromEntries(FIELDS.map(key => [key, null]));
    if (found || complete(item)) items[date] = item;
    return {items};
  }

  const elements = (doc, name) => Array.from(doc.getElementsByTagNameNS(doc.documentElement.namespaceURI, name));
  function address(value) {
    const match = text(value).match(/^([A-Z]+)(\d+)$/);
    if (!match) return null;
    let col = 0;
    for (const char of match[1]) col = col * 26 + char.charCodeAt(0) - 64;
    return {column: match[1], col, row: Number(match[2])};
  }
  function cellText(cell, sharedStrings) {
    // Read inline strings, shared strings and numeric date headers without changing styles.
    const children = Array.from(cell.children || cell.childNodes || []);
    const local = name => children.find(node => (node.localName || node.tagName) === name);
    if (local("is")) return text(local("is").textContent);
    const value = text(local("v")?.textContent);
    if (cell.getAttribute("t") === "s") return text(sharedStrings[Number(value)]?.textContent ?? sharedStrings[Number(value)]?.text ?? sharedStrings[Number(value)]);
    return value || text(cell.value);
  }

  function headerDate(value, referenceDate) {
    if (validDate(value)) return value;
    const match = text(value).match(/^(\d{1,2})\s*(?:월|\/)\s*(\d{1,2})\s*일?$/);
    if (!match || !validDate(referenceDate)) return "";
    const suffix = `${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
    const year = Number(referenceDate.slice(0, 4));
    return [year, year - 1].map(y => `${y}-${suffix}`).find(date => validDate(date) && date <= referenceDate &&
      Date.parse(referenceDate) - Date.parse(date) <= 31 * 86400000) || "";
  }

  function locate(doc, sharedStrings, referenceDate) {
    const cells = elements(doc, "c").map(cell => ({cell, ...address(cell.getAttribute("r")), text: cellText(cell, sharedStrings)}));
    const titles = cells.filter(item => TITLE.test(item.text));
    if (titles.length !== 1) throw new Error("주말 혼소율 표의 제목을 확인하지 못했습니다.");
    const title = titles[0];
    const merge = elements(doc, "mergeCell").map(item => text(item.getAttribute("ref")).split(":").map(address))
      .find(([a, b]) => a && b && a.col === title.col && a.row === title.row);
    if (!merge) throw new Error("주말 혼소율 표의 병합 범위를 확인하지 못했습니다.");
    const lastCol = merge[1].col;
    const labels = LABELS.map(label => cells.find(item => item.col === title.col && item.row > merge[1].row && item.row <= merge[1].row + 6 && item.text === label));
    if (labels.some(item => !item) || labels.some((item, i) => item.row !== labels[0].row + i)) {
      throw new Error("주말 혼소율 표의 호기·평균·합계 행을 확인하지 못했습니다.");
    }
    const headers = cells.filter(item => item.row === labels[0].row - 1 && item.col > title.col && item.col <= lastCol && item.text)
      .sort((a, b) => a.col - b.col);
    if (!headers.length || headers.length > 24) throw new Error("주말 혼소율 표의 날짜 칸을 확인하지 못했습니다.");
    const dates = headers.map(item => headerDate(item.text, referenceDate));
    if (dates.some(date => !date) || new Set(dates).size !== dates.length) throw new Error("주말 혼소율 표의 날짜가 올바르지 않습니다.");
    return headers.map((item, i) => ({date: dates[i], cells: labels.map(label => {
      const target = cells.find(cell => cell.col === item.col && cell.row === label.row);
      if (!target) throw new Error(`주말 혼소율 입력셀 ${item.column}${label.row}을 찾지 못했습니다.`);
      return target.cell;
    })}));
  }

  function fillMissing(first, second, date) {
    const result = normalized(first, date) || normalized({targetDate: date}, date);
    const fallback = normalized(second, date);
    const compatible = ["unitOne", "unitTwo"].every(unit => FIELDS.every(key =>
      result[unit][key] === null || number(fallback?.[unit]?.[key]) === null ||
      result[unit][key].toFixed(2) === fallback[unit][key].toFixed(2)));
    for (const unit of ["unitOne", "unitTwo", "combined"]) {
      if (unit === "combined" && !compatible) continue;
      for (const key of FIELDS) if (result[unit][key] === null) result[unit][key] = number(fallback?.[unit]?.[key]);
    }
    return result;
  }

  function rowValues(item) {
    const pair = (a, b) => a === null || b === null ? "" : `${a.toFixed(2)} / ${b.toFixed(2)}`;
    const first = item?.unitOne || {}, second = item?.unitTwo || {};
    const average = key => {
      const saved = number(item?.combined?.[key]);
      if (saved !== null) return saved;
      const a = number(first[key]), b = number(second[key]);
      return a === null || b === null ? null : (a + b) / 2;
    };
    const total = average("totalRatio");
    return [pair(number(first.bioRatio), number(first.organicRatio)), pair(number(second.bioRatio), number(second.organicRatio)),
      pair(average("bioRatio"), average("organicRatio")), total === null ? "" : total.toFixed(2)];
  }

  function writeCell(doc, cell, value) {
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    if ("value" in cell) cell.value = value;
    cell.removeAttribute("t");
    if (!value) return;
    cell.setAttribute("t", "inlineStr");
    const inline = doc.createElementNS(doc.documentElement.namespaceURI, "is");
    const t = doc.createElementNS(doc.documentElement.namespaceURI, "t");
    t.textContent = value;
    inline.appendChild(t);
    cell.appendChild(inline);
  }

  async function apply(doc, sharedStrings = [], options = {}) {
    if (options.enabled !== true) return {enabled: false, appliedDates: [], missingDates: []};
    const targets = locate(doc, sharedStrings, options.referenceDate);
    const captured = options.captured || capture();
    const results = new Array(targets.length);
    let cursor = 0;
    // Bound saved-record reads for long holidays; never start calculation/Agent work.
    await Promise.all(Array.from({length: Math.min(3, targets.length)}, async () => {
      while (cursor < targets.length) {
        const index = cursor++, date = targets[index].date;
        let item = null, error = "";
        if (!blocked(date)) {
          item = normalized(captured.items?.[date], date) || cached(date);
          if (!complete(item)) {
            try {
              const provider = root.morningMeetingClosedCofiring;
              if (typeof provider?.loadSavedForWorkbook !== "function") throw new Error("혼소율 저장자료 읽기 기능을 불러오지 못했습니다.");
              item = fillMissing(item, await provider.loadSavedForWorkbook(date), date);
            } catch (e) { error = text(e?.message) || "저장자료 읽기 실패"; }
          }
        }
        results[index] = {date, item: blocked(date) ? null : item, error};
      }
    }));
    const appliedDates = [], missingDates = [], errors = [];
    results.forEach((result, index) => {
      const values = rowValues(blocked(result.date) ? null : result.item);
      targets[index].cells.forEach((cell, row) => writeCell(doc, cell, values[row]));
      (values.every(Boolean) ? appliedDates : missingDates).push(result.date);
      if (result.error) errors.push({date: result.date, error: result.error});
    });
    return {enabled: true, requestedCount: targets.length, appliedDates, missingDates, errors};
  }

  root.morningMeetingHolidayCofiringSavedV1 = Object.freeze({version: VERSION, capture, apply});
})(typeof window !== "undefined" ? window : globalThis);
