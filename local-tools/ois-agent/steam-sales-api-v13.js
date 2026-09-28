"use strict";

function normalizeText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalDate(value) {
  const match = normalizeText(value).match(/(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})/);
  if (!match) return "";
  return [
    match[1],
    String(match[2]).padStart(2, "0"),
    String(match[3]).padStart(2, "0")
  ].join("/");
}

function parseNumber(value) {
  const text = normalizeText(value).replace(/,/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function round3(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function parseOisSteamSalesApiResponseV13(payload, targetDate) {
  const targetSlashDate = canonicalDate(targetDate);
  if (!targetSlashDate) {
    throw new Error("증기 판매량 API 조회 날짜가 올바르지 않습니다.");
  }

  const rows = Array.isArray(payload?.result) ? payload.result : [];
  if (rows.length === 0) return null;

  const targetRows = rows.filter(row => canonicalDate(row?.entry_date) === targetSlashDate);
  if (targetRows.length === 0) return null;

  const compactProduct = row => normalizeText(row?.product).replace(/\s+/g, "").toLowerCase();
  const lowRow = targetRows.find(row => compactProduct(row) === "8bar") || null;
  const highRow = targetRows.find(row => compactProduct(row) === "34bar") || null;
  const subtotalRow = targetRows.find(row => {
    const product = compactProduct(row);
    return product === "소계" || product === "subtotal" || product === "total";
  }) || null;

  if (!lowRow || !highRow) return null;

  const low = parseNumber(lowRow.use_ton);
  const high = parseNumber(highRow.use_ton);
  const subtotal = subtotalRow ? parseNumber(subtotalRow.use_ton) : null;

  if (low === null || high === null) {
    throw new Error(`${targetSlashDate}의 8Bar·34Bar use_ton 값이 숫자가 아닙니다.`);
  }

  const steamSalesLowPressure = round3(low);
  const steamSalesHighPressure = round3(high);
  const calculatedTotal = round3(steamSalesLowPressure + steamSalesHighPressure);
  const steamSales = subtotal === null ? calculatedTotal : round3(subtotal);

  if (steamSalesLowPressure < 0 || steamSalesHighPressure < 0 || steamSales < 0) {
    throw new Error("OIS 증기 판매량 API 응답에 0 미만 값이 있습니다.");
  }

  if (subtotal !== null && Math.abs(calculatedTotal - steamSales) > 0.1) {
    throw new Error(
      `OIS 증기 판매량 API 합계가 일치하지 않습니다. 8Bar ${steamSalesLowPressure} + 34Bar ${steamSalesHighPressure} = ${calculatedTotal}, 소계 ${steamSales}`
    );
  }

  return {
    steamSalesLowPressure,
    steamSalesHighPressure,
    steamSales,
    sourceMode: "ajax-api-v13",
    targetDate: targetSlashDate,
    rows: targetRows.map(row => ({
      entry_date: normalizeText(row?.entry_date),
      product: normalizeText(row?.product),
      use_ton: normalizeText(row?.use_ton)
    }))
  };
}

module.exports = {
  parseOisSteamSalesApiResponseV13
};
